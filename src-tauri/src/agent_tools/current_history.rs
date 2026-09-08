use super::*;

#[derive(Clone)]
pub(super) struct CurrentNoteHistoryTool(pub(super) AgentToolContext);

#[derive(Deserialize)]
pub(super) struct CurrentHistoryArgs {
    note_id: Option<String>,
    after: Option<u64>,
    before: Option<u64>,
    offset: Option<usize>,
}

/// Explicit turn grants can add notes, but exclusion always wins, including
/// when the conversation otherwise has no vault access.
fn current_history_scope(
    access: &VaultAccess,
    granted: HashSet<String>,
    run_grants: &HashSet<String>,
    excluded: &HashSet<String>,
    note_id: Option<&str>,
) -> crate::services::note_timeline::AllowedScope {
    use crate::services::note_timeline::AllowedScope;
    let allowed = match access {
        VaultAccess::Full => None,
        VaultAccess::Approved => Some(granted.union(run_grants).cloned().collect::<HashSet<_>>()),
        VaultAccess::None => Some(run_grants.clone()),
    };
    let allowed = if let Some(id) = note_id {
        Some(if allowed.as_ref().is_none_or(|ids| ids.contains(id)) {
            HashSet::from([id.to_string()])
        } else {
            HashSet::new()
        })
    } else {
        allowed
    };
    AllowedScope::policy(allowed.as_ref(), excluded)
}

impl Tool for CurrentNoteHistoryTool {
    const NAME: &'static str = "current_note_history";
    type Error = AgentToolError;
    type Args = CurrentHistoryArgs;
    type Output = Value;

    fn description(&self) -> String {
        "On-demand history evidence about current allowed notes only. With note_id, get a page of Current-Content Provenance (body then properties, plus current title); without it, list current notes with retained transitions overlapping a half-open Unix-millisecond activity period [after, before). offset starts at 0; follow nextOffset for more. Activity counts retained transitions, never saves or keystrokes. Editing Window evidence is an interval; clockDiscontinuity/uncertainTime means overlap is uncertain, not proven. Activity includes times, Mutation Sources and current excerpts, never removed prose or historical labels. Baseline knownSince does not establish introduction. Cite returned evidence as [Title](revision:revisionId). Cannot reconstruct, search or restore historical content.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{
            "note_id":{"type":["string","null"],"description":"Stable current Note Identity; omit for activity across allowed notes"},
            "after":{"type":["integer","null"],"minimum":0,"description":"Inclusive activity start, Unix milliseconds; used only without note_id"},
            "before":{"type":["integer","null"],"minimum":0,"description":"Exclusive activity end (must exceed start), Unix milliseconds; used only without note_id"},
            "offset":{"type":["integer","null"],"minimum":0}
        },"additionalProperties":false})
    }
    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Value, AgentToolError> {
        self.0
            .service
            .mark_current_history_use(&self.0.assistant_message_id, &self.0.run_id)
            .map_err(AgentToolError)?;
        self.0.activity("Checking current-note history");
        let context = self.0.clone();
        let (payload, evidence) = run_blocking_tool(move || {
            let state = context
                .app
                .try_state::<AppState>()
                .ok_or("The notes index is unavailable")?;
            read_current_history(
                &state,
                &context.service,
                &context.access,
                &context.run_grants,
                args,
            )
        })
        .await?;
        for source in evidence {
            if let Some(id) = source.note_id.as_deref() {
                self.0.surface(id);
            }
            if let Ok(mut sources) = self.0.sources.lock() {
                if !sources
                    .iter()
                    .any(|s| s.anchor == source.anchor && s.note_id == source.note_id)
                {
                    sources.push(source);
                }
            }
        }
        Ok(payload)
    }
}

fn read_current_history(
    state: &AppState,
    service: &ChatService,
    vault_access: &VaultAccess,
    run_grants: &HashSet<String>,
    args: CurrentHistoryArgs,
) -> Result<(Value, Vec<ChatSource>), String> {
    use crate::services::note_timeline::NoteIdentity;
    let excluded = service.excluded_note_ids()?;
    let granted = service.granted_note_ids()?;
    let scope = current_history_scope(
        vault_access,
        granted.clone(),
        run_grants,
        &excluded,
        args.note_id.as_deref(),
    );
    let timeline = state.note_timeline();
    let access = timeline.current_content(scope);
    let mut evidence = Vec::new();
    let mut payload = if let Some(id) = args.note_id {
        let result =
            access.provenance_page(&NoteIdentity::new(id.clone()), args.offset.unwrap_or(0));
        let Some((current, citations, next)) = result
            .map_err(|_| "Current-note history is unavailable. Retry after history recovery.")?
        else {
            return Ok((
                json!({"status":"unavailable","reason":"No current allowed history evidence is available."}),
                Vec::new(),
            ));
        };
        let path = state
            .notes_index
            .lock()
            .map_err(|_| "Notes index is unavailable")?
            .get_note_by_note_id(&id)
            .map(|(path, _)| path.clone())
            .ok_or("The current note is unavailable")?;
        let title = current.title.clone();
        evidence.extend(
            citations
                .iter()
                .cloned()
                .map(|c| (path.clone(), title.clone(), c)),
        );
        json!({"status":"ready","provenance":current,"citations":citations,"nextOffset":next})
    } else {
        let page = access.activity(args.after.unwrap_or(0), args.before.unwrap_or(u64::MAX), args.offset.unwrap_or(0), 20)
                .map_err(|_| "Current-note activity is unavailable. Check the period or retry after history recovery.")?;
        for item in &page.items {
            evidence.extend(
                item.citations
                    .iter()
                    .cloned()
                    .map(|c| (PathBuf::from(&item.note_path), item.title.clone(), c)),
            );
        }
        json!({"status":"ready","items":page.items,"nextOffset":page.next_offset})
    };
    // Policy can change while reconstruction runs. Fail closed instead of
    // delivering evidence gathered under an obsolete grant or exclusion set.
    if excluded != service.excluded_note_ids()? || granted != service.granted_note_ids()? {
        return Ok((
            json!({"status":"unavailable","reason":"Note policy changed; request current evidence again."}),
            Vec::new(),
        ));
    }
    let sources = evidence
        .into_iter()
        .map(|(path, title, revision)| ChatSource {
            kind: "revision".into(),
            note_id: Some(revision.note_id.clone()),
            note_path: Some(relative_path(service.notes_root(), &path)),
            title,
            excerpt: revision.current_excerpt.clone(),
            url: None,
            anchor: Some(revision.revision_id.clone()),
            revision: Some(revision),
        })
        .collect();
    // Tool paths are current resolved locations. Identity is the authority.
    if let Some(items) = payload.get_mut("items").and_then(Value::as_array_mut) {
        for item in items {
            if let Some(path) = item.get("notePath").and_then(Value::as_str) {
                item["notePath"] = json!(relative_path(service.notes_root(), Path::new(path)));
            }
        }
    }
    Ok((payload, sources))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{app::EventBus, semantic::SemanticState};

    #[test]
    fn chat_history_tool_rechecks_scope_identity_and_current_prose() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("chat-history-data");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("chat-history-vault");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let service =
            ChatService::new(notes.path().to_path_buf(), data.path().to_path_buf()).unwrap();
        let save = |title: &str, body: &str, path: Option<String>| {
            crate::commands::note_persistence::persist_note_session_with_outcome(
                &state,
                title.into(),
                body.into(),
                path,
            )
            .unwrap()
            .unwrap()
        };
        let first = save("Current", "removed confidential prose\nkept\n", None);
        let id = first.note_id.unwrap();
        let current = save("Current", "kept\n", first.path);
        let request = |note_id: Option<String>, access: &VaultAccess, grants: &HashSet<String>| {
            read_current_history(
                &state,
                &service,
                access,
                grants,
                CurrentHistoryArgs {
                    note_id,
                    after: None,
                    before: None,
                    offset: None,
                },
            )
            .unwrap()
        };
        let no_grants = HashSet::new();
        let (activity, citations) = request(None, &VaultAccess::Full, &no_grants);
        assert_eq!(activity["items"][0]["revisionCount"], 2);
        assert_eq!(activity["items"][0]["currentExcerpt"], "kept\n");
        assert!(!activity.to_string().contains("removed confidential"));
        assert!(!serde_json::to_string(&citations)
            .unwrap()
            .contains("removed confidential"));
        assert_eq!(
            request(None, &VaultAccess::None, &no_grants).0["items"],
            json!([])
        );
        assert_eq!(
            request(Some(id.clone()), &VaultAccess::Approved, &no_grants).0["status"],
            "unavailable"
        );
        service.grant_note(&id, "Current").unwrap();
        let (provenance, citations) = request(Some(id.clone()), &VaultAccess::Approved, &no_grants);
        assert_eq!(provenance["provenance"]["body"][0]["text"], "kept\n");
        assert!(!citations.is_empty());
        assert!(citations
            .iter()
            .all(|source| source.revision.as_ref().unwrap().note_id == id));
        let turn_grants = HashSet::from([id.clone()]);
        assert_eq!(
            request(Some(id.clone()), &VaultAccess::None, &turn_grants).0["status"],
            "ready"
        );
        service.set_note_excluded(&id, "Current", true).unwrap();
        for access in [VaultAccess::Full, VaultAccess::Approved, VaultAccess::None] {
            assert_eq!(
                request(Some(id.clone()), &access, &turn_grants).0["status"],
                "unavailable"
            );
            assert_eq!(request(None, &access, &turn_grants).0["items"], json!([]));
        }
        service.set_note_excluded(&id, "Current", false).unwrap();
        // A rename keeps stable identity and citations resolve the current path.
        let renamed = save("Renamed", "kept\n", current.path);
        let (_, sources) = request(Some(id.clone()), &VaultAccess::Full, &no_grants);
        assert!(sources
            .iter()
            .all(|source| source.note_path.as_deref() == Some("Renamed.md")));
        let mut renamed_sources = sources.clone();
        filter_revision_sources(
            &state,
            &service,
            &VaultAccess::Full,
            &no_grants,
            &mut renamed_sources,
        )
        .unwrap();
        assert!(!renamed_sources.is_empty());
        state
            .note_timeline()
            .clear_note_history(&crate::services::note_timeline::NoteIdentity::new(
                id.clone(),
            ))
            .unwrap();
        filter_revision_sources(
            &state,
            &service,
            &VaultAccess::Full,
            &no_grants,
            &mut renamed_sources,
        )
        .unwrap();
        assert!(renamed_sources.is_empty());
        // An uncaptured external edit cannot deliver the formerly current text.
        let path = PathBuf::from(renamed.path.unwrap());
        let canonical = fs::read_to_string(&path).unwrap();
        let external =
            note::replace_authored_content(&canonical, None, "external current\n").unwrap();
        fs::write(&path, external).unwrap();
        assert_eq!(
            request(None, &VaultAccess::Full, &no_grants).0["items"],
            json!([])
        );
        fs::remove_file(&path).unwrap();
        assert_eq!(
            request(Some(id), &VaultAccess::Full, &no_grants).0["status"],
            "unavailable"
        );
        crate::state::set_notes_root_override(None).unwrap();
    }
}

pub(crate) fn filter_revision_sources(
    state: &AppState,
    service: &ChatService,
    vault_access: &VaultAccess,
    run_grants: &HashSet<String>,
    sources: &mut Vec<ChatSource>,
) -> Result<(), String> {
    let excluded = service.excluded_note_ids()?;
    let scope = current_history_scope(
        vault_access,
        service.granted_note_ids()?,
        run_grants,
        &excluded,
        None,
    );
    let timeline = state.note_timeline();
    let current = timeline.current_content(scope);
    let evidence: Vec<_> = sources
        .iter()
        .filter_map(|source| source.revision.clone())
        .collect();
    let valid = current
        .current_citations(&evidence)
        .map_err(|_| "Current citation evidence is unavailable")?;
    sources.retain_mut(|source| {
        let Some(citation) = &source.revision else {
            return true;
        };
        if !valid.iter().any(|c| {
            c.note_id == citation.note_id
                && c.revision_id == citation.revision_id
                && c.current_excerpt == citation.current_excerpt
        }) {
            return false;
        }
        let Ok(index) = state.notes_index.lock() else {
            return false;
        };
        let Some((path, note)) = index.get_note_by_note_id(&citation.note_id) else {
            return false;
        };
        source.note_path = Some(relative_path(service.notes_root(), path));
        source.title = note.title.clone();
        true
    });
    Ok(())
}
