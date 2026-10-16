//! Chat-owned durable working versions. The document runtime owns live edits;
//! this module checkpoints them and prepares deterministic note promotions.
use super::*;
use serde_json::json;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalDraft {
    pub(crate) version: i64,
    pub(crate) markdown: String,
    pub(crate) title: String,
    pub(crate) path: String,
    pub(crate) decisions: Value,
}

pub(super) fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
    let required: bool = connection
        .query_row(
            "SELECT \"notnull\" FROM pragma_table_info('chat_agent_proposals') WHERE name='run_id'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if required {
        // Existing proposal IDs and all recovery receipts are retained. No table
        // references proposal IDs until the working-version table below exists.
        connection.execute_batch("CREATE TABLE chat_proposals_nullable (
                id TEXT PRIMARY KEY, run_id TEXT REFERENCES chat_agent_runs(id) ON DELETE CASCADE,
                conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
                assistant_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK(kind IN ('update','create')), note_id TEXT,
                suggested_path TEXT, title TEXT NOT NULL, base_hash TEXT,
                payload_json TEXT NOT NULL, preview_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', superseded_by TEXT,
                commit_target_path TEXT, intended_editor_content_hash TEXT,
                created_at_millis INTEGER NOT NULL, updated_at_millis INTEGER NOT NULL);
            INSERT INTO chat_proposals_nullable SELECT id,run_id,conversation_id,assistant_message_id,
                kind,note_id,suggested_path,title,base_hash,payload_json,preview_json,status,
                superseded_by,commit_target_path,intended_editor_content_hash,created_at_millis,
                updated_at_millis FROM chat_agent_proposals;
            DROP TABLE chat_agent_proposals;
            ALTER TABLE chat_proposals_nullable RENAME TO chat_agent_proposals;").map_err(|e| { let _=connection.execute_batch("ROLLBACK"); e.to_string() })?;
    }
    connection.execute_batch("CREATE TABLE IF NOT EXISTS chat_proposal_drafts (
        proposal_id TEXT PRIMARY KEY REFERENCES chat_agent_proposals(id) ON DELETE CASCADE,
        version INTEGER NOT NULL, markdown TEXT NOT NULL, title TEXT NOT NULL,
        path TEXT NOT NULL, decisions_json TEXT NOT NULL DEFAULT '[]');
        CREATE TABLE IF NOT EXISTS chat_note_saves (
        save_key TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES chat_agent_proposals(id) ON DELETE CASCADE,
        committed_note_id TEXT);
        CREATE TABLE IF NOT EXISTS chat_proposal_receipts (proposal_id TEXT PRIMARY KEY REFERENCES chat_agent_proposals(id) ON DELETE CASCADE, receipt_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS chat_answer_associations(message_id TEXT PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,content_hash TEXT NOT NULL,associations_json TEXT NOT NULL);
        COMMIT;").map_err(|e| e.to_string())
}

pub(crate) use crate::proposal_policy::SaveSelection;

impl ChatService {
    pub(crate) fn lock_proposal_publication(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, ()>, String> {
        self.inner
            .proposal_publication
            .lock()
            .map_err(|_| "Proposal publication lock poisoned".into())
    }
    pub(crate) fn save_proposal_receipt(
        &self,
        id: &str,
        receipt: &crate::proposals::CommitNoteReviewResult,
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO chat_proposal_receipts(proposal_id,receipt_json) VALUES(?1,?2)",
            params![
                id,
                serde_json::to_string(receipt).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
        let payload: String = tx
            .query_row(
                "SELECT payload_json FROM chat_agent_proposals WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let mut payload: Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
        payload["committedNoteId"] = json!(receipt.note_id);
        payload["committedPath"] = json!(receipt.applied.as_ref().and_then(|a| a.path.as_ref()));
        tx.execute(
            "UPDATE chat_agent_proposals SET payload_json=?2 WHERE id=?1",
            params![id, payload.to_string()],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE chat_note_saves SET committed_note_id=?2 WHERE proposal_id=?1",
            params![id, receipt.note_id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub(crate) fn proposal_receipt(
        &self,
        id: &str,
    ) -> Result<Option<crate::proposals::CommitNoteReviewResult>, String> {
        let raw: Option<String> = self
            .connection()?
            .query_row(
                "SELECT receipt_json FROM chat_proposal_receipts WHERE proposal_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let mut receipt: Option<crate::proposals::CommitNoteReviewResult> = raw
            .map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
            .transpose()?;
        if let Some(receipt) = receipt.as_mut() {
            if let Some(note_id) = receipt.note_id.as_deref() {
                if let Some(path) =
                    crate::state::resolve_note_path_by_id(&self.inner.notes_root, note_id)?
                {
                    if let Some(applied) = receipt.applied.as_mut() {
                        applied.path = Some(path.to_string_lossy().into_owned());
                    }
                }
            }
        }
        Ok(receipt)
    }

    pub(crate) fn recovered_proposal_receipt(
        &self,
        id: &str,
    ) -> Result<crate::proposals::CommitNoteReviewResult, String> {
        if let Some(receipt) = self.proposal_receipt(id)? {
            return Ok(receipt);
        }
        let proposal = self.get_agent_proposal(id)?;
        if proposal.status != "committed" {
            return Err("That proposal has no committed receipt.".into());
        }
        let path: String = self
            .connection()?
            .query_row(
                "SELECT commit_target_path FROM chat_agent_proposals WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let session = crate::commands::read_note_session_from_path(Path::new(&path))?;
        let result = crate::proposals::CommitNoteReviewResult {
            status: "committed".into(),
            note_id: session.note_id,
            committed_markdown: Some(session.markdown),
            applied: Some(crate::proposals::AppliedNoteChange {
                kind: if proposal.kind == "create" {
                    "createNote"
                } else {
                    "updateNote"
                }
                .into(),
                path: Some(path),
                previous_path: None,
            }),
            message: None,
            commit_warning: session.commit_warning,
        };
        self.save_proposal_receipt(id, &result)?;
        Ok(result)
    }

    #[cfg(test)]
    pub(crate) fn prepare_note_save(
        &self,
        conversation_id: &str,
        message_id: &str,
        copy_intent: Option<&str>,
    ) -> Result<ChatAgentProposal, String> {
        self.prepare_note_save_selection(conversation_id, message_id, copy_intent, None)
    }

    #[cfg(test)]
    pub(crate) fn prepare_note_save_selection(
        &self,
        conversation_id: &str,
        message_id: &str,
        copy_intent: Option<&str>,
        selection: Option<&SaveSelection>,
    ) -> Result<ChatAgentProposal, String> {
        self.prepare_note_save_target(
            conversation_id,
            message_id,
            copy_intent,
            selection,
            None,
            None,
            None,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare_note_save_target(
        &self,
        conversation_id: &str,
        message_id: &str,
        copy_intent: Option<&str>,
        selection: Option<&SaveSelection>,
        target_note_id: Option<&str>,
        heading: Option<&str>,
        requested_title: Option<&str>,
        requested_path: Option<&str>,
    ) -> Result<ChatAgentProposal, String> {
        let conversation = self.get_conversation(conversation_id)?;
        if conversation.summary.access == VaultAccess::None {
            return Err("Enable vault access before saving a note.".into());
        }
        let message = conversation
            .messages
            .iter()
            .find(|m| {
                m.id == message_id
                    && m.role == "assistant"
                    && m.status == "complete"
                    && !m.content.trim().is_empty()
            })
            .ok_or("Choose a completed assistant answer.")?;
        let associations:Option<String>=self.connection()?.query_row("SELECT associations_json FROM chat_answer_associations WHERE message_id=?1 AND content_hash=?2",params![message.id,crate::semantic::db::content_hash(&message.content)],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
        let associations = associations
            .map(|raw| {
                serde_json::from_str::<Vec<structured_answer::CitationAssociation>>(&raw)
                    .map_err(|e| e.to_string())
            })
            .transpose()?;
        let selected = selection
            .map(|s| {
                selected_content_with_associations(&message.content, s, associations.as_deref())
            })
            .transpose()?;
        let chosen = selected
            .as_ref()
            .map(|selected| selected.markdown.as_str())
            .unwrap_or(&message.content);
        let selector = match selected.as_ref() {
            // Preserve the existing key for the first occurrence, while later
            // identical passages retain their own durable save intent.
            Some(selected) if selected.occurrence > 0 => format!(
                "{}:occurrence:{}",
                crate::semantic::db::content_hash(chosen),
                selected.occurrence
            ),
            Some(_) => crate::semantic::db::content_hash(chosen),
            None => "whole".into(),
        };
        let key = format!(
            "{message_id}:{selector}:{}:{}:{}",
            target_note_id.unwrap_or("new"),
            heading.unwrap_or("append"),
            copy_intent.unwrap_or("original")
        );
        let connection = self.connection()?;
        if let Some(id) = connection
            .query_row(
                "SELECT proposal_id FROM chat_note_saves WHERE save_key=?1",
                [&key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            let existing = self.get_agent_proposal(&id)?;
            if existing.status == "committed" && existing.payload.get("committedNoteId").is_none() {
                self.recovered_proposal_receipt(&id)?;
                return self.get_agent_proposal(&id);
            }
            if existing.status != "dismissed" {
                return Ok(existing);
            }
        }
        let title = requested_title
            .map(str::to_string)
            .or_else(|| first_heading(chosen))
            .unwrap_or_else(|| conversation.summary.title.clone());
        let mut markdown = crate::note_promotion::promote_links_with_lookup(chosen, &message.sources, &self.inner.notes_root, |id| {
            if !self.note_is_allowed(&conversation.summary.access,id)? {return Err("Source access was revoked; Save requires current source access".into());}
            crate::note_promotion::resolve_unique_note_path(&self.inner.notes_root,id)
        })?;
        let part_path = Path::new(&conversation.projection_path)
            .parent()
            .ok_or("Chat folder unavailable")?
            .join(format!("Part {:03}.md", message.part));
        let relative = part_path
            .strip_prefix(&self.inner.notes_root)
            .map_err(|_| "Chat is outside the running vault")?
            .to_string_lossy()
            .replace('\\', "/");
        let anchor = if let (Some(selection), Some(selected)) = (selection, selected.as_ref()) {
            self.insert_excerpt(
                conversation_id,
                message_id,
                selected.range.start,
                selected.range.end,
                selection.text.trim(),
            )?
            .anchor
        } else {
            format!("msg_{}", message.id)
        };
        markdown.push_str(&format!(
            "\n\n[[{}#^{}|Open in chat]]",
            relative.trim_end_matches(".md"),
            anchor
        ));
        let (kind, path, title, base_hash, preview, mut payload, working) = if let Some(note_id) =
            target_note_id
        {
            if !self.note_is_allowed(&conversation.summary.access, note_id)? {
                return Err("That destination is not allowed.".into());
            }
            let path = crate::state::resolve_note_path_by_id(&self.inner.notes_root, note_id)?
                .ok_or("The destination note is unavailable.")?;
            let session = crate::commands::read_note_session_from_path(&path)?;
            let (working, prefix, suffix) = place_addition(&session.markdown, &markdown, heading)?;
            let preview = crate::proposals::preview_note_rewrite(
                &self.inner.notes_root,
                &path.to_string_lossy(),
                &working,
            )?;
            let payload = json!({"markdown":working,"promotion":{"addition":markdown,"heading":heading,"prefix":prefix,"suffix":suffix}});
            (
                "update",
                path.to_string_lossy().into_owned(),
                session.title,
                Some(preview.base_content_hash.clone()),
                serde_json::to_value(preview).map_err(|e| e.to_string())?,
                payload,
                working,
            )
        } else {
            let mut preview =
                crate::proposals::preview_note_creation(&self.inner.notes_root, &title, &markdown)?;
            if let Some(path) = requested_path {
                let target = self.ordinary_proposal_target(path)?;
                preview.suggested_path = crate::proposals::unique_creation_path(
                    target.parent().ok_or("Creation folder unavailable")?,
                    &target.file_stem().unwrap_or_default().to_string_lossy(),
                )
                .to_string_lossy()
                .into_owned();
            }
            (
                "create",
                preview.suggested_path.clone(),
                title.clone(),
                None,
                serde_json::to_value(preview).map_err(|e| e.to_string())?,
                json!({"title":title,"markdown":markdown}),
                markdown,
            )
        };
        payload["wholeAnswer"] = json!(selection.is_none());
        payload["originalSave"] = json!(copy_intent.is_none());
        let id = generate_id("proposal");
        let now = to_i64(now_millis())?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        // Recheck under the write reservation: two clicks must share one origin.
        if let Some(existing) = transaction.query_row("SELECT s.proposal_id FROM chat_note_saves s JOIN chat_agent_proposals p ON p.id=s.proposal_id WHERE s.save_key=?1 AND p.status!='dismissed'",
            [&key], |row| row.get::<_,String>(0)).optional().map_err(|e| e.to_string())? {
            drop(transaction); return self.get_agent_proposal(&existing);
        }
        transaction.execute("INSERT INTO chat_agent_proposals
            (id,run_id,conversation_id,assistant_message_id,kind,suggested_path,title,payload_json,preview_json,status,created_at_millis,updated_at_millis,note_id,base_hash)
            VALUES (?1,NULL,?2,?3,?9,?4,?5,?6,?7,'pending',?8,?8,?10,?11)",
            params![id,conversation_id,message_id,path,title,payload.to_string(),preview.to_string(),now,kind,target_note_id,base_hash]).map_err(|e|e.to_string())?;
        transaction.execute("INSERT INTO chat_note_saves(save_key,proposal_id) VALUES(?1,?2) ON CONFLICT(save_key) DO UPDATE SET proposal_id=excluded.proposal_id,committed_note_id=NULL",
            params![key,id]).map_err(|e| e.to_string())?;
        transaction.execute("INSERT INTO chat_proposal_drafts(proposal_id,version,markdown,title,path) VALUES(?1,0,?2,?3,?4)",
            params![id,working,title,path]).map_err(|e|e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
        self.get_agent_proposal(&id)
    }

    // Called under the proposal publication reservation after a conflict. This
    // changes only review data; a new approval is required for the new base.
    pub(crate) fn refresh_saved_addition(&self, id: &str) -> Result<bool, String> {
        let proposal = self.get_agent_proposal(id)?;
        let Some(intent) = proposal.payload.get("promotion") else {
            return Ok(false);
        };
        let draft = self.proposal_draft(id)?;
        let prefix = intent["prefix"].as_str().ok_or("Missing insertion base")?;
        let suffix = intent["suffix"].as_str().ok_or("Missing insertion base")?;
        if !draft.markdown.starts_with(prefix)
            || !draft.markdown.ends_with(suffix)
            || draft.markdown.len() < prefix.len() + suffix.len()
        {
            return Err("The draft also changes existing content. Copy or resolve those edits before refreshing.".into());
        }
        let addition = &draft.markdown[prefix.len()..draft.markdown.len() - suffix.len()];
        let note_id = proposal
            .note_id
            .as_deref()
            .ok_or("Missing destination identity")?;
        let conversation = self.get_conversation(&proposal.conversation_id)?;
        if !self.note_is_allowed(&conversation.summary.access, note_id)? {
            return Err("Destination access was revoked.".into());
        }
        let path = crate::state::resolve_note_path_by_id(&self.inner.notes_root, note_id)?
            .ok_or("The destination note is unavailable.")?;
        let session = crate::commands::read_note_session_from_path(&path)?;
        let (working, prefix, suffix) = place_addition(
            &session.markdown,
            addition.trim_matches('\n'),
            intent["heading"].as_str(),
        )?;
        let mut preview = crate::proposals::preview_note_rewrite(
            &self.inner.notes_root,
            &path.to_string_lossy(),
            &working,
        )?;
        preview.review_id = proposal.preview["reviewId"].as_str().unwrap_or(id).into();
        let mut payload = proposal.payload.clone();
        payload["markdown"] = json!(working);
        payload["promotion"]["prefix"] = json!(prefix);
        payload["promotion"]["suffix"] = json!(suffix);
        let mut connection = self.connection()?;
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let count=tx.execute("UPDATE chat_proposal_drafts SET version=version+1,markdown=?3,path=?4,decisions_json='[]' WHERE proposal_id=?1 AND version=?2 AND EXISTS(SELECT 1 FROM chat_agent_proposals WHERE id=?1 AND status='conflict')",params![id,draft.version,working,path.to_string_lossy()]).map_err(|e|e.to_string())?;
        if count != 1 {
            return Err("The review changed; reopen it.".into());
        }
        tx.execute("UPDATE chat_agent_proposals SET preview_json=?2,payload_json=?3,base_hash=?4,suggested_path=?5 WHERE id=?1",params![id,serde_json::to_string(&preview).map_err(|e|e.to_string())?,payload.to_string(),preview.base_content_hash,path.to_string_lossy()]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(true)
    }

    pub(crate) fn refresh_creation_collision(&self, id: &str) -> Result<(), String> {
        let draft = self.proposal_draft(id)?;
        let parent = Path::new(&draft.path)
            .parent()
            .ok_or("Invalid creation location")?;
        let stem = Path::new(&draft.path)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let path = crate::proposals::unique_creation_path(parent, &stem)
            .to_string_lossy()
            .into_owned();
        let mut connection = self.connection()?;
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute("UPDATE chat_proposal_drafts SET path=?2,version=version+1,decisions_json='[]' WHERE proposal_id=?1",params![id,path]).map_err(|e|e.to_string())?;
        tx.execute(
            "UPDATE chat_agent_proposals SET suggested_path=?2 WHERE id=?1 AND status='conflict'",
            params![id, path],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub(crate) fn mark_requested_review(
        &self,
        id: &str,
        run_id: &str,
    ) -> Result<ChatAgentProposal, String> {
        let _guard = self.lock_proposal_publication()?;
        let proposal = self.get_agent_proposal(id)?;
        let mut payload = proposal.payload;
        payload["reviewIntent"] = json!("requested");
        payload["refinementRunId"] = json!(run_id);
        self.connection()?.execute("UPDATE chat_agent_proposals SET payload_json=?2,run_id=COALESCE(run_id,?3) WHERE id=?1 AND status IN ('pending','conflict')",params![id,payload.to_string(),run_id]).map_err(|e|e.to_string())?;
        self.get_agent_proposal(id)
    }

    pub(crate) fn refine_proposal_draft(
        &self,
        id: &str,
        version: i64,
        markdown: &str,
        run_id: &str,
    ) -> Result<ChatAgentProposal, String> {
        let _guard = self.lock_proposal_publication()?;
        let mut proposal = self.get_agent_proposal(id)?;
        let draft = self.proposal_draft(id)?;
        if draft.version != version || !matches!(proposal.status.as_str(), "pending" | "conflict") {
            return Err(
                "The draft changed during generation. Read its latest version before refining."
                    .into(),
            );
        }
        if proposal.kind == "update" {
            let base = proposal.preview["baseEditorMarkdown"]
                .as_str()
                .ok_or("Missing review base")?;
            proposal.preview["hunks"] =
                serde_json::to_value(crate::proposals::diff_preview_hunks(base, markdown))
                    .map_err(|e| e.to_string())?;
        }
        proposal.preview["proposedEditorMarkdown"] = json!(markdown);
        proposal.payload["markdown"] = json!(markdown);
        proposal.payload["reviewIntent"] = json!("requested");
        proposal.payload["refinementRunId"] = json!(run_id);
        let mut connection = self.connection()?;
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let changed=tx.execute("UPDATE chat_proposal_drafts SET version=version+1,markdown=?3,decisions_json='[]' WHERE proposal_id=?1 AND version=?2 AND EXISTS(SELECT 1 FROM chat_agent_proposals WHERE id=?1 AND status IN ('pending','conflict'))",params![id,version,markdown]).map_err(|e|e.to_string())?;
        if changed != 1 {
            return Err("The draft changed; read it again.".into());
        }
        tx.execute("UPDATE chat_agent_proposals SET payload_json=?2,preview_json=?3,updated_at_millis=?4 WHERE id=?1",params![id,proposal.payload.to_string(),proposal.preview.to_string(),to_i64(now_millis())?]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        self.get_agent_proposal(id)
    }

    pub(crate) fn proposal_draft(&self, id: &str) -> Result<ProposalDraft, String> {
        let proposal = self.get_agent_proposal(id)?;
        if !matches!(
            proposal.status.as_str(),
            "pending" | "conflict" | "committing"
        ) {
            return Err("That review is already resolved.".into());
        }
        let connection = self.connection()?;
        let draft = connection.query_row("SELECT version,markdown,title,path,decisions_json FROM chat_proposal_drafts WHERE proposal_id=?1", [id], |row| {
            let decisions:String=row.get(4)?;
            Ok(ProposalDraft { version:row.get(0)?, markdown:row.get(1)?,title:row.get(2)?,path:row.get(3)?,decisions:serde_json::from_str(&decisions).map_err(|error|rusqlite::Error::FromSqlConversionFailure(4,rusqlite::types::Type::Text,Box::new(error)))? })
        }).optional().map_err(|e| e.to_string())?;
        if let Some(draft) = draft {
            return Ok(draft);
        }
        let markdown = proposal.preview["proposedEditorMarkdown"]
            .as_str()
            .or_else(|| proposal.payload["markdown"].as_str())
            .ok_or("Proposal content unavailable")?;
        let path = proposal
            .suggested_path
            .as_deref()
            .or_else(|| proposal.preview["notePath"].as_str())
            .ok_or("Proposal target unavailable")?;
        connection.execute("INSERT OR IGNORE INTO chat_proposal_drafts(proposal_id,version,markdown,title,path) SELECT ?1,0,?2,?3,?4 WHERE EXISTS(SELECT 1 FROM chat_agent_proposals WHERE id=?1 AND status IN ('pending','conflict','committing'))", params![id,markdown,proposal.title,path]).map_err(|e|e.to_string())?;
        self.proposal_draft(id)
    }

    fn ordinary_proposal_target(&self, path: &str) -> Result<PathBuf, String> {
        let target = canonical_agent_commit_target(&self.inner.notes_root, Path::new(path))?;
        let root = fs::canonicalize(&self.inner.notes_root).map_err(|e| e.to_string())?;
        if target.starts_with(root.join("Chats")) {
            return Err("Choose an ordinary note location inside this vault.".into());
        }
        Ok(target)
    }

    pub(crate) fn checkpoint_proposal_draft(
        &self,
        id: &str,
        version: i64,
        markdown: &str,
        title: &str,
        requested_path: Option<&str>,
        decisions: &Value,
    ) -> Result<ProposalDraft, String> {
        let _publication = self.lock_proposal_publication()?;
        let proposal = self.get_agent_proposal(id)?;
        let previous = self.proposal_draft(id)?;
        if title.trim().is_empty() || !decisions.is_array() {
            return Err("Invalid review draft".into());
        }
        let path =
            if proposal.kind == "create" && title != previous.title && requested_path.is_none() {
                crate::proposals::preview_note_creation(
                    Path::new(&previous.path)
                        .parent()
                        .ok_or("Creation folder unavailable")?,
                    title,
                    markdown,
                )?
                .suggested_path
            } else {
                requested_path.unwrap_or(&previous.path).to_string()
            };
        self.ordinary_proposal_target(&path)?;
        validate_decisions(decisions, markdown)?;
        if proposal.kind == "update" && path != previous.path {
            return Err("Existing destinations follow their note identity.".into());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let changed=transaction.execute("UPDATE chat_proposal_drafts SET version=version+1,markdown=?3,title=?4,path=?5,decisions_json=?6 WHERE proposal_id=?1 AND version=?2 AND EXISTS(SELECT 1 FROM chat_agent_proposals WHERE id=?1 AND status IN ('pending','conflict'))", params![id,version,markdown,title,path,decisions.to_string()]).map_err(|e|e.to_string())?;
        if changed != 1 {
            return Err("The review changed; reopen its latest draft.".into());
        }
        // Legacy proposal readers receive the latest working body as well.
        let mut payload = proposal.payload;
        payload["markdown"] = json!(markdown);
        payload["title"] = json!(title);
        transaction.execute("UPDATE chat_agent_proposals SET title=?2,payload_json=?3,suggested_path=CASE WHEN kind='create' THEN ?4 ELSE suggested_path END,updated_at_millis=?5 WHERE id=?1",params![id,title,payload.to_string(),path,to_i64(now_millis())?]).map_err(|e|e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
        self.proposal_draft(id)
    }
}

pub(crate) use crate::proposal_policy::validate_decisions;

use crate::proposal_policy::{first_heading, place_addition, selected_content_with_associations};
#[cfg(test)]
use crate::proposal_policy::{rendered_text, selected_content};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_handles_repeated_unicode_blocks_and_recorded_segment_sources() {
        let answer="éclair &amp; café\n\nSame **pilot**.\n\nFirst claim.\n\nSame **pilot**. [Source 2](passage:second)";
        let mut selection = SaveSelection {
            text: "pilot".into(),
            markdown: "**pilot**".into(),
            occurrence: Some(1),
        };
        assert_eq!(
            selected_content(answer, &selection).unwrap(),
            "**pilot** [Source 2](passage:second)"
        );
        selection.occurrence = None;
        assert!(selected_content(answer, &selection).is_err());
        let answer =
            "# Guidance\n\nUse **éclair**.\n\nAnother paragraph.\n\n[Source 1](passage:recorded)";
        let spans = vec![structured_answer::CitationAssociation {
            start: 0,
            end: answer.find("\n\n[Source").unwrap(),
            links: vec!["[Source 1](passage:recorded)".into()],
        }];
        let selection = SaveSelection {
            text: "éclair".into(),
            markdown: "**éclair**".into(),
            occurrence: None,
        };
        assert_eq!(
            selected_content_with_associations(answer, &selection, Some(&spans))
                .unwrap()
                .markdown,
            "**éclair** [Source 1](passage:recorded)"
        );
    }
    #[test]
    fn selection_uses_chat_highlights_table_spacing_and_literal_punctuation() {
        for (answer, text, markdown) in [
            ("Use ==pilot== next.", "pilot", "==pilot=="),
            (
                "<https://example.com/==pilot==>",
                "https://example.com/==pilot==",
                r"[https://example.com/\=\=pilot\=\=](https://example.com/==pilot==)",
            ),
            ("[[Plan|==pilot==]]", "==pilot==", "[[Plan|==pilot==]]"),
            (
                "Use ==**literal**== next.",
                "**literal**",
                "==**literal**==",
            ),
            (
                "| First | Second |\n| --- | --- |\n| One | Two |",
                "First Second One Two",
                "| First | Second |\n| --- | --- |\n| One | Two |",
            ),
            (
                r"Keep \*literal\* and \[brackets\].",
                "*literal* and [brackets]",
                r"\*literal\* and \[brackets\]",
            ),
            ("`==code==`", "==code==", "`==code==`"),
            ("```\n==code==\n```", "==code==", "```\n==code==\n```"),
        ] {
            let selection = SaveSelection {
                text: text.into(),
                markdown: markdown.into(),
                occurrence: None,
            };
            assert_eq!(selected_content(answer, &selection).unwrap(), markdown);
        }
        assert_eq!(rendered_text("Use ==pilot== next.").0, "Use pilot next.");
        assert!(selected_content(
            "Use ==pilot== next.",
            &SaveSelection {
                text: "invented".into(),
                markdown: "==invented==".into(),
                occurrence: None
            }
        )
        .is_err());
    }

    #[test]
    fn heading_addition_preserves_sections_and_rejects_ambiguous_locations() {
        assert_eq!(
            place_addition("# Plan\n\nOld\n\n# Later\n\nKeep", "New", Some("Plan"))
                .unwrap()
                .0,
            "# Plan\n\nOld\n\nNew\n\n# Later\n\nKeep"
        );
        assert!(place_addition("# Plan\n\n# Plan", "New", Some("Plan")).is_err());
        assert!(place_addition("# Other", "New", Some("Plan")).is_err());
    }
    #[test]
    fn selection_keeps_only_chosen_text_and_its_attached_citations() {
        let answer = "# Plan\n\nUse **one pilot** first. [Source 1](passage:proof)\n\nDo not copy this paragraph.";
        let chosen = SaveSelection {
            text: "one pilot".into(),
            markdown: "**one pilot**".into(),
            occurrence: None,
        };
        assert_eq!(
            selected_content(answer, &chosen).unwrap(),
            "**one pilot** [Source 1](passage:proof)"
        );
        assert!(selected_content(
            answer,
            &SaveSelection {
                text: "pilot paragraph".into(),
                markdown: "pilot paragraph".into(),
                occurrence: None
            }
        )
        .is_err());
    }

    #[test]
    fn selected_paragraph_recovers_all_three_passage_links_after_control_labels_are_removed() {
        let paragraph = "The **grocery** note links out to online recipes. Other food-related notes are shopping lists rather than full recipes.";
        let links = "[Source 1](passage:one) [Source 2](passage:two) [Source 3](passage:three)";
        let answer = format!("Earlier text.\n\n{paragraph} {links}\n\nDo not copy this.");
        let selection = SaveSelection {
            text: paragraph.replace("**", ""),
            markdown: paragraph.into(),
            occurrence: Some(0),
        };
        assert_eq!(
            selected_content(&answer, &selection).unwrap(),
            format!("{paragraph} {links}")
        );
    }
}
