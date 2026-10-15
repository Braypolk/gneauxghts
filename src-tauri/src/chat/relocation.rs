//! Startup rebinding of vault-owned chat locations. Content and authorization
//! receipts are unchanged: relocation is never evidence that a write completed.
use super::*;
use std::path::Component;

impl ChatService {
    pub(super) fn relocate_persisted_paths(&self) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        transaction
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS chat_vault_location (
                id INTEGER PRIMARY KEY CHECK (id = 1), root TEXT NOT NULL
             );",
            )
            .map_err(|e| e.to_string())?;
        let previous: Option<String> = transaction
            .query_row(
                "SELECT root FROM chat_vault_location WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let roots = match previous {
            Some(root) => vec![PathBuf::from(root)],
            None => self.legacy_vault_roots(&transaction)?,
        };
        let roots = roots
            .into_iter()
            .filter(|root| root != &self.inner.notes_root && clean_absolute(root))
            .collect::<Vec<_>>();
        if !roots.is_empty() {
            let relocated_conversations = {
                let mut statement = transaction
                    .prepare("SELECT conversation_id, path FROM chat_projection_files")
                    .map_err(|e| e.to_string())?;
                let rows = statement
                    .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                    .map_err(|e| e.to_string())?;
                let mut ids = HashSet::new();
                for row in rows {
                    let (id, path) = row.map_err(|e| e.to_string())?;
                    if relocated(&path, &roots, &self.inner.notes_root).is_some() {
                        ids.insert(id);
                    }
                }
                ids
            };
            // Closed list of location fields, never text, tool arguments, URLs,
            // evidence hashes or proposal status. Everything commits with root.
            for (table, column) in [
                ("chat_projection_files", "path"),
                ("chat_agent_proposals", "suggested_path"),
                ("chat_agent_proposals", "commit_target_path"),
                ("chat_proposal_drafts", "path"),
                ("chat_sources", "note_path"),
                ("chat_agent_run_context", "note_path"),
            ] {
                relocate_column(
                    &transaction,
                    table,
                    column,
                    &roots,
                    &self.inner.notes_root,
                    None,
                )?;
            }
            for (table, column, fields) in [
                (
                    "chat_agent_proposals",
                    "preview_json",
                    &["notePath", "suggestedPath"][..],
                ),
                ("chat_agent_runs", "active_note_json", &["path"][..]),
                (
                    "chat_agent_proposals",
                    "payload_json",
                    &["committedPath"][..],
                ),
            ] {
                relocate_column(
                    &transaction,
                    table,
                    column,
                    &roots,
                    &self.inner.notes_root,
                    Some(fields),
                )?;
            }
            // A prior launch may have marked the missing old container as an
            // external edit. Clear only when EVERY relocated receipt is still
            // proved by the exact published bytes in the current vault.
            for id in relocated_conversations {
                let mut statement = transaction.prepare(
                    "SELECT path, content_hash FROM chat_projection_files WHERE conversation_id = ?1",
                ).map_err(|e| e.to_string())?;
                let rows = statement
                    .query_map([&id], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    })
                    .map_err(|e| e.to_string())?;
                let mut unchanged = true;
                for row in rows {
                    let (path, hash) = row.map_err(|e| e.to_string())?;
                    let contained = fs::canonicalize(&path)
                        .ok()
                        .zip(fs::canonicalize(&self.inner.notes_root).ok())
                        .is_some_and(|(path, root)| path.starts_with(root));
                    unchanged &= contained
                        && fs::read_to_string(path)
                            .ok()
                            .is_some_and(|s| content_hash(&s) == hash);
                }
                drop(statement);
                if unchanged {
                    transaction
                        .execute(
                            "UPDATE chat_conversations SET detached = 0 WHERE id = ?1",
                            [&id],
                        )
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        transaction
            .execute(
                "INSERT INTO chat_vault_location (id, root) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET root = excluded.root",
                [self.inner.notes_root.to_string_lossy().as_ref()],
            )
            .map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())
    }

    /// Old databases have no root receipt. Infer only from the exact generated
    /// transcript layout AND its surviving managed identity in the current
    /// vault. Several old iOS containers can exist in one pre-fix database.
    /// Missing/ambiguous evidence leaves the old paths unresolved (fail closed).
    fn legacy_vault_roots(&self, connection: &Connection) -> Result<Vec<PathBuf>, String> {
        let mut roots = HashSet::new();
        let mut statement = connection
            .prepare("SELECT conversation_id, path FROM chat_projection_files")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, stored) = row.map_err(|e| e.to_string())?;
            let conversation = self.get_conversation(&id)?;
            let path = Path::new(&stored);
            let Some(filename) = path.file_name() else {
                continue;
            };
            let filename = filename.to_string_lossy();
            let valid_name = filename == "Conversation.md"
                || filename
                    .strip_prefix("Part ")
                    .and_then(|s| s.strip_suffix(".md"))
                    .is_some_and(|part| {
                        part.len() >= 3 && part.bytes().all(|b| b.is_ascii_digit())
                    });
            if !valid_name || !clean_absolute(path) {
                continue;
            }
            let expected = conversation_directory(Path::new(""), &conversation.summary)
                .join(filename.as_ref());
            if !path.ends_with(&expected) {
                continue;
            }
            let mut old_root = path.to_path_buf();
            for _ in expected.components() {
                old_root.pop();
            }
            if !clean_absolute(&old_root) {
                continue;
            }
            let current = self.inner.notes_root.join(&expected);
            // Canonical containment prevents a symlink from supplying migration
            // authority from another vault. No hash is accepted or replaced.
            let Ok(canonical) = fs::canonicalize(&current) else {
                continue;
            };
            let Ok(root) = fs::canonicalize(&self.inner.notes_root) else {
                continue;
            };
            if !canonical.starts_with(root) {
                continue;
            }
            let Ok(markdown) = fs::read_to_string(current) else {
                continue;
            };
            let Some(metadata) = crate::note::parse_note(&markdown).frontmatter.managed else {
                continue;
            };
            if metadata.chat_id.as_deref() == Some(&id)
                && matches!(
                    metadata.kind,
                    crate::note::DocumentKind::ChatIndex
                        | crate::note::DocumentKind::ChatTranscript
                )
            {
                roots.insert(old_root);
            }
        }
        let mut roots = roots.into_iter().collect::<Vec<_>>();
        // Prefer the most specific root if a vault was moved into a subfolder.
        roots.sort_by_key(|root| std::cmp::Reverse(root.components().count()));
        Ok(roots)
    }
}

fn clean_absolute(path: &Path) -> bool {
    path.is_absolute()
        && path.parent().is_some()
        && path.components().all(|c| {
            matches!(
                c,
                Component::RootDir | Component::Prefix(_) | Component::Normal(_)
            )
        })
}

fn relocated(path: &str, roots: &[PathBuf], current: &Path) -> Option<String> {
    let path = Path::new(path);
    if !clean_absolute(path) {
        return None;
    }
    roots.iter().find_map(|root| {
        if current.starts_with(root) && path.starts_with(current) {
            return None;
        }
        let relative = path.strip_prefix(root).ok()?;
        if relative.as_os_str().is_empty() {
            return None;
        }
        Some(current.join(relative).to_string_lossy().into_owned())
    })
}

fn relocate_column(
    connection: &Connection,
    table: &str,
    column: &str,
    roots: &[PathBuf],
    current: &Path,
    json_fields: Option<&[&str]>,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT rowid, {column} FROM {table} WHERE {column} IS NOT NULL"
        ))
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(statement);
    for (rowid, original) in rows {
        let replacement = if let Some(fields) = json_fields {
            // Invalid stored JSON stays invalid; migration cannot repair or
            // manufacture an approvable proposal or active-note snapshot.
            let Ok(mut value) = serde_json::from_str::<Value>(&original) else {
                continue;
            };
            let mut changed = false;
            for field in fields {
                if let Some(path) = value.get(*field).and_then(Value::as_str) {
                    if let Some(path) = relocated(path, roots, current) {
                        value[*field] = Value::String(path);
                        changed = true;
                    }
                }
            }
            changed.then(|| value.to_string())
        } else {
            relocated(&original, roots, current)
        };
        if let Some(replacement) = replacement {
            connection
                .execute(
                    &format!("UPDATE {table} SET {column} = ?1 WHERE rowid = ?2"),
                    params![replacement, rowid],
                )
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::store::open_connection;
    use crate::chat::tests::{seed_agent_run, service};
    use crate::test_support::TestDir;
    use serde_json::json;

    #[test]
    fn moved_pending_proposals_commit_through_canonical_commands_and_keep_conflicts() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = TestDir::new("relocation-command-app");
        let old = TestDir::new("relocation-command-vault");
        crate::state::initialize_app_data_dir(app_data.path().into()).unwrap();
        crate::state::set_notes_root_override(Some(old.path().into())).unwrap();
        let make_state = || {
            crate::index::AppState::new(
                crate::semantic::SemanticState::new_disabled("relocation test"),
                crate::app::EventBus::disabled(),
            )
            .unwrap()
        };
        let state = make_state();
        let target = old.path().join("Existing.md");
        let note = state
            .note_timeline()
            .create_note_at(
                crate::services::note_timeline::MutationSource::AcceptedChatProposal,
                &target,
                "Original\n\nUnrelated stays.\n",
            )
            .unwrap()
            .unwrap();
        let service = ChatService::new(old.path().into(), old.path().join(".gneauxghts")).unwrap();
        let create = pending(&service, "create", &old.path().join("Created.md"));
        let c = service.create_conversation(None, None).unwrap();
        let (run, assistant) = seed_agent_run(&service, &c.summary.id, "update", 1);
        let preview = crate::proposals::preview_note_rewrite(
            old.path(),
            target.to_str().unwrap(),
            "Updated\n\nUnrelated stays.\n",
        )
        .unwrap();
        let update = service
            .stage_agent_proposal(
                &run,
                &c.summary.id,
                &assistant,
                "update",
                Some(note.note_id().as_str()),
                None,
                "Existing",
                Some(&preview.base_content_hash),
                &json!({}),
                &serde_json::to_value(&preview).unwrap(),
            )
            .unwrap();
        state.stop_rebuildable_projection_work().unwrap();
        drop(state);
        drop(service);
        let destination = TestDir::new("relocation-command-new");
        let moved = destination.path().join("Vault");
        fs::rename(old.path(), &moved).unwrap();
        crate::state::set_notes_root_override(Some(moved.clone())).unwrap();
        let state = make_state();
        let service = ChatService::new(moved.clone(), moved.join(".gneauxghts")).unwrap();
        let commit = |id: &str| {
            crate::commands::proposal_commands::commit_agent_proposal_with_state(
                &state,
                &service,
                id.into(),
                None,
            )
            .unwrap()
        };
        assert_eq!(commit(&create.id).status, "committed");
        assert!(fs::read_to_string(moved.join("Created.md"))
            .unwrap()
            .ends_with("approved"));
        let target = moved.join("Existing.md");
        let original = fs::read_to_string(&target).unwrap();
        fs::write(&target, original.replace("Original", "External")).unwrap();
        assert_eq!(commit(&update.id).status, "conflict");
        assert!(fs::read_to_string(&target).unwrap().contains("External"));
        // Restoring the exact reviewed baseline permits an explicit later Keep.
        fs::write(&target, original).unwrap();
        assert_eq!(commit(&update.id).status, "committed");
        assert!(fs::read_to_string(moved.join("Existing.md"))
            .unwrap()
            .ends_with("Updated\n\nUnrelated stays.\n"));
        assert_eq!(
            crate::commands::proposal_commands::commit_agent_proposal_with_state(
                &state, &service, create.id, None
            )
            .unwrap()
            .status,
            "committed"
        );
        // Occupancy and base-hash checks remain owned by the canonical command.
        let occupied = pending(&service, "create", &moved.join("Occupied.md"));
        fs::write(moved.join("Occupied.md"), "External").unwrap();
        assert_eq!(commit(&occupied.id).status, "conflict");
        assert_eq!(
            fs::read_to_string(moved.join("Occupied.md")).unwrap(),
            "External"
        );
        state.stop_rebuildable_projection_work().unwrap();
    }

    fn pending(service: &ChatService, kind: &str, path: &Path) -> ChatAgentProposal {
        let c = service.create_conversation(None, None).unwrap();
        let (run, assistant) = seed_agent_run(service, &c.summary.id, &c.summary.id, 1);
        service.stage_agent_proposal(&run, &c.summary.id, &assistant, kind,
            (kind == "update").then_some("note-id"),
            (kind == "create").then(|| path.to_str().unwrap()), "Target", Some("base"),
            &json!({"title":"Target", "markdown":"approved"}),
            &json!({"notePath":path, "suggestedPath":path, "proposedEditorMarkdown":"approved"}),
        ).unwrap()
    }

    #[test]
    fn vault_move_preserves_transcript_conflicts_and_proposal_locations() {
        for legacy in [false, true] {
            let (old, service) = service("chat-relocation");
            let pending = pending(&service, "create", &old.path().join("Target.md"));
            let unchanged = service.get_conversation(&pending.conversation_id).unwrap();
            let changed = service.create_conversation(None, None).unwrap();
            let changed_path = PathBuf::from(&changed.projection_path);
            fs::write(
                &changed_path,
                format!(
                    "{}\nExternal edit",
                    fs::read_to_string(&changed_path).unwrap()
                ),
            )
            .unwrap();
            let missing = service.create_conversation(None, None).unwrap();
            fs::remove_file(&missing.projection_path).unwrap();
            service
                .connection()
                .unwrap()
                .execute(
                    "UPDATE chat_conversations SET detached=1 WHERE id=?1",
                    [&unchanged.summary.id],
                )
                .unwrap();
            if legacy {
                service
                    .connection()
                    .unwrap()
                    .execute("DROP TABLE chat_vault_location", [])
                    .unwrap();
            }
            drop(service);
            let destination = TestDir::new("chat-moved-container");
            let moved = destination.path().join("Vault");
            fs::rename(old.path(), &moved).unwrap();
            let service = ChatService::new(moved.clone(), moved.join(".gneauxghts")).unwrap();
            assert!(service
                .changed_projection_path(&unchanged.summary.id)
                .unwrap()
                .is_none());
            assert!(
                !service
                    .get_conversation(&unchanged.summary.id)
                    .unwrap()
                    .summary
                    .detached
            );
            assert!(service
                .mark_projection_detached_if_needed(&changed.summary.id)
                .unwrap());
            assert!(service
                .mark_projection_detached_if_needed(&missing.summary.id)
                .unwrap());
            let proposal = service
                .list_pending_agent_proposals(&pending.conversation_id)
                .unwrap()
                .pop()
                .unwrap();
            assert_eq!(
                proposal.suggested_path.as_deref(),
                moved.join("Target.md").to_str()
            );
            assert_eq!(
                proposal.preview["suggestedPath"],
                json!(moved.join("Target.md"))
            );
            assert!(!moved.join("Target.md").exists());
            // The watcher uses the same rebased receipt as transcript admission.
            assert_eq!(
                service
                    .projection_owner_for_path(
                        &moved.join(
                            Path::new(&unchanged.projection_path)
                                .strip_prefix(old.path())
                                .unwrap()
                        )
                    )
                    .unwrap(),
                Some(unchanged.summary.id)
            );
            assert_eq!(
                service
                    .resolve_agent_proposal(&pending.id, "dismissed")
                    .unwrap()
                    .status,
                "dismissed"
            );
            drop(service);
            let reopened = ChatService::new(moved.clone(), moved.join(".gneauxghts")).unwrap();
            assert_eq!(
                reopened.get_agent_proposal(&pending.id).unwrap().status,
                "dismissed"
            );
        }
    }

    #[test]
    fn moved_interrupted_commit_requires_exact_filesystem_proof_and_never_replays() {
        let (old, service) = service("chat-moved-commit");
        let mut proposals = Vec::new();
        for (name, bytes) in [
            ("Written", Some("approved")),
            ("Changed", Some("external")),
            ("Missing", None),
        ] {
            let path = old.path().join(format!("{name}.md"));
            let proposal = pending(&service, "create", &path);
            let plan = crate::proposals::plan_agent_creation_commit(
                old.path(),
                path.to_str().unwrap(),
                "approved",
            )
            .unwrap();
            service
                .begin_agent_proposal_commit(
                    &proposal.id,
                    &plan.target_path,
                    &plan.intended_editor_content_hash,
                )
                .unwrap();
            if let Some(bytes) = bytes {
                fs::write(&path, bytes).unwrap();
            }
            proposals.push((proposal.id, name, bytes));
        }
        drop(service);
        let destination = TestDir::new("chat-moved-proof");
        let moved = destination.path().join("Vault");
        fs::rename(old.path(), &moved).unwrap();
        let service = ChatService::new(moved.clone(), moved.join(".gneauxghts")).unwrap();
        for (id, name, bytes) in proposals {
            assert_eq!(
                service.get_agent_proposal(&id).unwrap().status,
                if name == "Written" {
                    "committed"
                } else {
                    "conflict"
                }
            );
            assert_eq!(
                fs::read_to_string(moved.join(format!("{name}.md")))
                    .ok()
                    .as_deref(),
                bytes
            );
        }
        assert_eq!(service.recover_agent_proposal_commits().unwrap(), 0);
    }

    #[test]
    fn relocation_transaction_rolls_back_paths_and_root_receipt_together() {
        let (old, service) = service("chat-move-rollback");
        let proposal = pending(&service, "create", &old.path().join("Target.md"));
        service.connection().unwrap().execute_batch("CREATE TRIGGER reject_relocation BEFORE UPDATE OF preview_json ON chat_agent_proposals BEGIN SELECT RAISE(FAIL,'injected relocation failure'); END;").unwrap();
        drop(service);
        let destination = TestDir::new("chat-move-rollback-new");
        let moved = destination.path().join("Vault");
        fs::rename(old.path(), &moved).unwrap();
        assert!(ChatService::new(moved.clone(), moved.join(".gneauxghts"))
            .err()
            .unwrap()
            .contains("injected relocation failure"));
        let db = open_connection(&moved.join(".gneauxghts/ai.sqlite3")).unwrap();
        let root: String = db
            .query_row("SELECT root FROM chat_vault_location", [], |r| r.get(0))
            .unwrap();
        assert_eq!(root, old.path().to_string_lossy());
        let suggested: String = db
            .query_row(
                "SELECT suggested_path FROM chat_agent_proposals WHERE id=?1",
                [&proposal.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(suggested, old.path().join("Target.md").to_string_lossy());
        db.execute_batch("DROP TRIGGER reject_relocation").unwrap();
        drop(db);
        let service = ChatService::new(moved.clone(), moved.join(".gneauxghts")).unwrap();
        assert_eq!(
            service
                .get_agent_proposal(&proposal.id)
                .unwrap()
                .suggested_path
                .as_deref(),
            moved.join("Target.md").to_str()
        );
    }

    #[test]
    fn relocation_does_not_admit_outside_or_traversing_targets_or_rewrite_text() {
        let (old, service) = service("chat-move-containment");
        let outside = TestDir::new("chat-move-outside");
        let proposal = pending(&service, "create", &outside.path().join("Outside.md"));
        service.connection().unwrap().execute("UPDATE chat_agent_proposals SET preview_json=?1 WHERE id=?2",
            params![json!({"notePath":format!("{}/../escape.md",old.path().display()),"proposedEditorMarkdown":old.path()}).to_string(),proposal.id]).unwrap();
        drop(service);
        let destination = TestDir::new("chat-move-contained");
        let moved = destination.path().join("Vault");
        fs::rename(old.path(), &moved).unwrap();
        let service = ChatService::new(moved.clone(), moved.join(".gneauxghts")).unwrap();
        let proposal = service.get_agent_proposal(&proposal.id).unwrap();
        assert_eq!(
            proposal.suggested_path.as_deref(),
            outside.path().join("Outside.md").to_str()
        );
        assert_eq!(
            proposal.preview["proposedEditorMarkdown"],
            json!(old.path())
        );
        assert_eq!(
            proposal.preview["notePath"],
            json!(format!("{}/../escape.md", old.path().display()))
        );
        assert!(crate::proposals::plan_agent_creation_commit(
            &moved,
            proposal.suggested_path.as_deref().unwrap(),
            "approved"
        )
        .is_err());
    }
}
