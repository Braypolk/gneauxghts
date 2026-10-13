//! Durable chat terminal operations. Message, source proofs and run receipt
//! commit together; application events are emitted only after this operation.
use super::*;
pub(super) fn open_connection(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|e| e.to_string())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    Ok(connection)
}

// Reuse one configured connection for a running response while committing each
// ordinary-text delta independently. Structured drafts deliberately never use this
// checkpoint: their Markdown and sources become durable only at final validation.
pub(super) struct StreamingCheckpoint {
    connection: Connection,
    message_id: String,
}
impl StreamingCheckpoint {
    pub(super) fn write(&self, content: &str) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE chat_messages SET content=?2 WHERE id=?1 AND status='streaming'",
                params![self.message_id, content],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

impl ChatService {
    pub(super) fn streaming_checkpoint(
        &self,
        message_id: &str,
    ) -> Result<StreamingCheckpoint, String> {
        Ok(StreamingCheckpoint {
            connection: self.connection()?,
            message_id: message_id.into(),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn store_terminal_message(
        connection: &Connection,
        message_id: &str,
        status: &str,
        content: &str,
        error: Option<&str>,
        sources: &[ChatSource],
        note_reference_ids: &[String],
    ) -> Result<(), String> {
        connection
            .execute(
                "UPDATE chat_messages SET status = ?2, content = ?3, error = ?4, has_revision_evidence = MAX(has_revision_evidence, ?5), note_reference_ids_json = ?6 WHERE id = ?1",
                params![message_id, status, content, error,
                    !note_reference_ids.is_empty() || sources.iter().any(|source| source.note_id.is_some()),
                    serde_json::to_string(note_reference_ids).map_err(|e| e.to_string())?],
            )
            .map_err(|value| value.to_string())?;
        connection
            .execute(
                "DELETE FROM chat_sources WHERE message_id = ?1",
                [message_id],
            )
            .map_err(|value| value.to_string())?;
        for source in sources {
            connection
                .execute(
                    "INSERT INTO chat_sources
                     (message_id, kind, note_id, note_path, title, excerpt, url, anchor, revision_json, passage_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        message_id,
                        source.kind,
                        source.note_id,
                        source.note_path,
                        source.title,
                        source.excerpt,
                        source.url,
                        source.anchor,
                        source.revision.as_ref().map(serde_json::to_string).transpose().map_err(|e| e.to_string())?,
                        source.passage.as_ref().map(serde_json::to_string).transpose().map_err(|e| e.to_string())?
                    ],
                )
                .map_err(|value| value.to_string())?;
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn persist_terminal_outcome(
        &self,
        message_id: &str,
        run_id: &str,
        status: &str,
        content: &str,
        error: Option<&str>,
        sources: &[ChatSource],
        note_reference_ids: &[String],
        usage: &(u64, u64),
        stats: &crate::agent_guardrails::AgentRunStats,
        reason: Option<&str>,
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        let run_status = if status == "complete" {
            "completed"
        } else {
            status
        };
        let changed = tx.execute("UPDATE chat_agent_runs SET status = ?3, input_tokens = ?4,
            output_tokens = ?5, tool_call_count = ?6, model_call_count = ?7, elapsed_millis = ?8,
            terminal_reason = ?9, updated_at_millis = ?10 WHERE id = ?1 AND assistant_message_id = ?2",
            params![run_id, message_id, run_status, to_i64(usage.0)?, to_i64(usage.1)?,
                to_i64(stats.tool_calls as u64)?, to_i64(stats.model_calls as u64)?, to_i64(stats.elapsed_millis)?, reason, to_i64(now_millis())?])
            .map_err(|e| e.to_string())?;
        if changed != 1 {
            return Err("The current chat run is unavailable".into());
        }
        Self::store_terminal_message(
            &tx,
            message_id,
            status,
            content,
            error,
            sources,
            note_reference_ids,
        )?;
        tx.commit().map_err(|e| e.to_string())
    }
    // Best-effort terminal recovery after source/receipt persistence fails.
    // Preserve the last durable partial text, remove uncommitted source claims,
    // and allow Retry immediately whenever the database can still write.
    pub(super) fn fail_terminal_outcome(
        &self,
        message_id: &str,
        run_id: &str,
        error: &str,
    ) -> Result<(), String> {
        let partial: String = self
            .connection()?
            .query_row(
                "SELECT content FROM chat_messages WHERE id=?1",
                [message_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        self.persist_terminal_outcome(
            message_id,
            run_id,
            "error",
            &partial,
            Some(error),
            &[],
            &[],
            &(0, 0),
            &Default::default(),
            Some("runtimeError"),
        )
    }

    pub(super) fn connection(&self) -> Result<Connection, String> {
        open_connection(&self.inner.db_path)
    }

    pub(super) fn initialize(&self) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 CREATE TABLE IF NOT EXISTS chat_settings (
                   id INTEGER PRIMARY KEY CHECK (id = 1),
                   provider TEXT NOT NULL,
                   model TEXT NOT NULL,
                   reasoning_effort TEXT NOT NULL DEFAULT 'medium',
                   service_tier TEXT NOT NULL DEFAULT 'standard',
                   default_access TEXT NOT NULL,
                   default_mode TEXT NOT NULL DEFAULT 'auto',
                   web_access TEXT NOT NULL DEFAULT 'auto',
                   atlas_visibility TEXT NOT NULL DEFAULT 'hidden'
                 );
                 CREATE TABLE IF NOT EXISTS chat_conversations (
                   id TEXT PRIMARY KEY,
                   title TEXT NOT NULL,
                   mode TEXT NOT NULL,
                   access TEXT NOT NULL,
                   status TEXT NOT NULL DEFAULT 'active',
                   created_at_millis INTEGER NOT NULL,
                   updated_at_millis INTEGER NOT NULL,
                   current_part INTEGER NOT NULL DEFAULT 1,
                   detached INTEGER NOT NULL DEFAULT 0,
                   continuation_summary TEXT NOT NULL DEFAULT '',
                   reasoning_effort TEXT NOT NULL DEFAULT 'medium',
                   branched_from_conversation_id TEXT,
                   branched_from_message_id TEXT
                 );
                 CREATE TABLE IF NOT EXISTS chat_messages (
                   id TEXT PRIMARY KEY,
                   conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
                   ordinal INTEGER NOT NULL,
                   role TEXT NOT NULL,
                   status TEXT NOT NULL,
                   content TEXT NOT NULL,
                   error TEXT,
                   part INTEGER NOT NULL,
                   created_at_millis INTEGER NOT NULL,
                   UNIQUE(conversation_id, ordinal)
                 );
                 CREATE TABLE IF NOT EXISTS chat_sources (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
                   kind TEXT NOT NULL,
                   note_id TEXT,
                   note_path TEXT,
                   title TEXT NOT NULL,
                   excerpt TEXT NOT NULL,
                   url TEXT,
                   anchor TEXT
                 );
                 CREATE TABLE IF NOT EXISTS chat_message_attachments (
                   id TEXT PRIMARY KEY,
                   message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
                   kind TEXT NOT NULL CHECK (kind IN ('image', 'file')),
                   name TEXT NOT NULL,
                   mime_type TEXT NOT NULL,
                   size_bytes INTEGER NOT NULL,
                   data_base64 TEXT NOT NULL,
                   created_at_millis INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS chat_excerpts (
                   id TEXT PRIMARY KEY,
                   conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
                   message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
                   start_offset INTEGER NOT NULL,
                   end_offset INTEGER NOT NULL,
                   quote TEXT NOT NULL,
                   anchor TEXT NOT NULL UNIQUE,
                   remembered INTEGER NOT NULL DEFAULT 0,
                   created_at_millis INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS chat_limited_grants (
                   note_id TEXT PRIMARY KEY,
                   title TEXT NOT NULL,
                   granted_at_millis INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS chat_note_policies (
                   note_id TEXT PRIMARY KEY,
                   disposition TEXT NOT NULL CHECK (disposition IN ('approved', 'excluded')),
                   title TEXT NOT NULL DEFAULT '',
                   updated_at_millis INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS chat_agent_runs (
                   id TEXT PRIMARY KEY,
                   conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
                   user_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
                   assistant_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
                   retry_of_message_id TEXT,
                   provider TEXT NOT NULL,
                   model TEXT NOT NULL,
                   reasoning_effort TEXT NOT NULL DEFAULT 'medium',
                   force_web_search INTEGER NOT NULL DEFAULT 0,
                   active_note_json TEXT,
                   terminal_reason TEXT,
                   model_call_count INTEGER NOT NULL DEFAULT 0,
                   tool_call_count INTEGER NOT NULL DEFAULT 0,
                   elapsed_millis INTEGER NOT NULL DEFAULT 0,
                   status TEXT NOT NULL,
                   input_tokens INTEGER NOT NULL DEFAULT 0,
                   output_tokens INTEGER NOT NULL DEFAULT 0,
                   created_at_millis INTEGER NOT NULL,
                   updated_at_millis INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS chat_agent_events (
                   run_id TEXT NOT NULL REFERENCES chat_agent_runs(id) ON DELETE CASCADE,
                   sequence INTEGER NOT NULL,
                   request_id TEXT NOT NULL,
                   conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
                   message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
                   event_json TEXT NOT NULL,
                   created_at_millis INTEGER NOT NULL,
                   PRIMARY KEY(run_id, sequence)
                 );
                 CREATE TABLE IF NOT EXISTS chat_agent_run_context (
                   run_id TEXT NOT NULL REFERENCES chat_agent_runs(id) ON DELETE CASCADE,
                   ordinal INTEGER NOT NULL,
                   note_id TEXT NOT NULL,
                   note_path TEXT NOT NULL,
                   title TEXT NOT NULL,
                   section_label TEXT,
                   excerpt TEXT NOT NULL,
                   content_hash TEXT NOT NULL,
                   reason TEXT NOT NULL,
                   start_line INTEGER,
                   end_line INTEGER,
                   block_anchor TEXT,
                   PRIMARY KEY(run_id, ordinal)
                 );
                 CREATE TABLE IF NOT EXISTS chat_context_compactions (
                   conversation_id TEXT PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
                   through_ordinal INTEGER NOT NULL,
                   transcript_hash TEXT NOT NULL,
                   summary TEXT NOT NULL,
                   message_count INTEGER NOT NULL,
                   estimated_tokens INTEGER NOT NULL,
                   created_at_millis INTEGER NOT NULL,
                   updated_at_millis INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_chat_agent_events_message
                   ON chat_agent_events(message_id, created_at_millis, run_id, sequence);
                 CREATE TABLE IF NOT EXISTS chat_agent_proposals (
                   id TEXT PRIMARY KEY,
                   run_id TEXT NOT NULL REFERENCES chat_agent_runs(id) ON DELETE CASCADE,
                   conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
                   assistant_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
                   kind TEXT NOT NULL CHECK (kind IN ('update', 'create')),
                   note_id TEXT,
                   suggested_path TEXT,
                   title TEXT NOT NULL,
                   base_hash TEXT,
                   payload_json TEXT NOT NULL,
                   preview_json TEXT NOT NULL,
                   status TEXT NOT NULL DEFAULT 'pending',
                   superseded_by TEXT,
                   commit_target_path TEXT,
                   intended_editor_content_hash TEXT,
                   created_at_millis INTEGER NOT NULL,
                   updated_at_millis INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS chat_projection_files (
                   conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
                   path TEXT NOT NULL,
                   content_hash TEXT NOT NULL,
                   PRIMARY KEY(conversation_id, path)
                 );
                 -- Unsent composer text. `slot` is a conversation or an unsent
                 -- pane draft, so it is deliberately not a foreign key.
                 CREATE TABLE IF NOT EXISTS chat_composer_drafts (
                   slot TEXT PRIMARY KEY,
                   body TEXT NOT NULL,
                   updated_at_millis INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS chat_local_model_capabilities (
                   model TEXT PRIMARY KEY,
                   images INTEGER NOT NULL DEFAULT 0,
                   tools INTEGER NOT NULL DEFAULT 1,
                   audio INTEGER NOT NULL DEFAULT 0,
                   video INTEGER NOT NULL DEFAULT 0,
                   reasoning_effort TEXT NOT NULL DEFAULT 'medium',
                   updated_at_millis INTEGER NOT NULL
                 );",
            )
            .map_err(|error| error.to_string())?;
        // Vaults created by an earlier chat schema gain the settings columns in place.
        let _ = connection.execute(
            "ALTER TABLE chat_settings ADD COLUMN default_mode TEXT NOT NULL DEFAULT 'auto'",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_settings ADD COLUMN atlas_visibility TEXT NOT NULL DEFAULT 'hidden'",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_settings ADD COLUMN service_tier TEXT NOT NULL DEFAULT 'standard'",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_settings ADD COLUMN web_access TEXT NOT NULL DEFAULT 'auto'",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_settings ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'medium'",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_local_model_capabilities ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'medium'",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_conversations ADD COLUMN branched_from_conversation_id TEXT",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_conversations ADD COLUMN branched_from_message_id TEXT",
            [],
        );
        let openai_model_added = connection.execute(
            "ALTER TABLE chat_settings ADD COLUMN openai_model TEXT NOT NULL DEFAULT 'gpt-5.6-terra'",
            [],
        ).is_ok();
        let _ = connection.execute(
            "ALTER TABLE chat_settings ADD COLUMN local_model TEXT NOT NULL DEFAULT ''",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_settings ADD COLUMN local_base_url TEXT NOT NULL DEFAULT 'http://localhost:1234/v1'",
            [],
        );
        let conversation_provider_added = connection
            .execute(
                "ALTER TABLE chat_conversations ADD COLUMN provider TEXT NOT NULL DEFAULT 'openai'",
                [],
            )
            .is_ok();
        let conversation_model_added = connection.execute(
            "ALTER TABLE chat_conversations ADD COLUMN model TEXT NOT NULL DEFAULT 'gpt-5.6-terra'",
            [],
        ).is_ok();
        let _ = connection.execute(
            "ALTER TABLE chat_conversations ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'medium'",
            [],
        );
        let _ = connection.execute("ALTER TABLE chat_sources ADD COLUMN revision_json TEXT", []);
        let _ = connection.execute("ALTER TABLE chat_sources ADD COLUMN passage_json TEXT", []);
        let _ = connection.execute(
            "ALTER TABLE chat_messages ADD COLUMN has_revision_evidence INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_messages ADD COLUMN note_reference_ids_json TEXT NOT NULL DEFAULT '[]'",
            [],
        );
        connection.execute("UPDATE chat_messages SET has_revision_evidence = 1 WHERE has_revision_evidence = 0 AND EXISTS (SELECT 1 FROM chat_sources s WHERE s.message_id = chat_messages.id AND s.kind != 'web')", []).map_err(|e| e.to_string())?;

        let _ = connection.execute("ALTER TABLE chat_messages ADD COLUMN provider TEXT", []);
        let _ = connection.execute("ALTER TABLE chat_messages ADD COLUMN model TEXT", []);
        let _ = connection.execute(
            "ALTER TABLE chat_agent_runs ADD COLUMN force_web_search INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_agent_runs ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'medium'",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_agent_runs ADD COLUMN active_note_json TEXT",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_agent_runs ADD COLUMN terminal_reason TEXT",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_agent_runs ADD COLUMN model_call_count INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_agent_runs ADD COLUMN tool_call_count INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_agent_runs ADD COLUMN elapsed_millis INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_agent_proposals ADD COLUMN commit_target_path TEXT",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE chat_agent_proposals ADD COLUMN intended_editor_content_hash TEXT",
            [],
        );
        let defaults = ChatSettings::default();
        connection
            .execute(
                "INSERT OR IGNORE INTO chat_settings (id, provider, model, default_access)
                 VALUES (1, ?1, ?2, ?3)",
                params![
                    defaults.provider,
                    defaults.model,
                    defaults.default_access.as_str()
                ],
            )
            .map_err(|error| error.to_string())?;
        if openai_model_added {
            connection
                .execute(
                    "UPDATE chat_settings SET openai_model = model WHERE id = 1",
                    [],
                )
                .map_err(|error| error.to_string())?;
        }
        if conversation_provider_added {
            connection
                .execute(
                    "UPDATE chat_conversations
                     SET provider = (SELECT provider FROM chat_settings WHERE id = 1)",
                    [],
                )
                .map_err(|error| error.to_string())?;
        }
        if conversation_model_added {
            connection
                .execute(
                    "UPDATE chat_conversations
                     SET model = (SELECT model FROM chat_settings WHERE id = 1)",
                    [],
                )
                .map_err(|error| error.to_string())?;
        }
        connection
            .execute_batch(
                "UPDATE chat_settings SET default_access = 'approved' WHERE default_access = 'limited';
                 UPDATE chat_conversations SET access = 'approved' WHERE access = 'limited';
                 INSERT OR IGNORE INTO chat_note_policies
                   (note_id, disposition, title, updated_at_millis)
                 SELECT note_id, 'approved', title, granted_at_millis FROM chat_limited_grants;",
            )
            .map_err(|error| error.to_string())?;
        drop(connection);
        // Paths must belong to this startup's Running Vault before either
        // interrupted commits or transcript observations inspect the filesystem.
        self.relocate_persisted_paths()?;
        self.recover_agent_proposal_commits()?;
        let interrupted_conversations = self.recover_interrupted_requests()?;
        for conversation_id in interrupted_conversations {
            // The database is authoritative and has already committed atomically.
            // Projection refresh is best effort, matching ordinary chat completion.
            let _ = self.write_projection(&conversation_id, false);
        }
        self.backfill_default_conversation_titles()?;
        self.recover_transcript_conversations()?;
        Ok(())
    }

    pub(super) fn recover_interrupted_requests(&self) -> Result<Vec<String>, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let conversation_ids = {
            let mut statement = transaction
                .prepare(
                    "SELECT conversation_id
                     FROM chat_agent_runs
                     WHERE status = 'running'
                     UNION
                     SELECT conversation_id
                     FROM chat_messages
                     WHERE role = 'assistant' AND status = 'streaming'
                     ORDER BY conversation_id",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };
        if conversation_ids.is_empty() {
            transaction.commit().map_err(|error| error.to_string())?;
            return Ok(conversation_ids);
        }

        let now = to_i64(now_millis())?;
        transaction
            .execute(
                "UPDATE chat_agent_runs
                 SET status = CASE (
                       SELECT status
                       FROM chat_messages
                       WHERE id = chat_agent_runs.assistant_message_id
                     )
                       WHEN 'complete' THEN 'completed'
                       WHEN 'error' THEN 'error'
                       WHEN 'cancelled' THEN 'cancelled'
                       WHEN 'streaming' THEN 'cancelled'
                       ELSE 'cancelled'
                     END,
                     updated_at_millis = ?1
                 WHERE status = 'running'",
                [now],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE chat_messages
                 SET status = 'cancelled'
                 WHERE role = 'assistant' AND status = 'streaming'",
                [],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(conversation_ids)
    }

    pub(super) fn backfill_default_conversation_titles(&self) -> Result<(), String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT c.id, m.content
                 FROM chat_conversations c
                 JOIN chat_messages m ON m.id = (
                   SELECT first_user.id
                   FROM chat_messages first_user
                   WHERE first_user.conversation_id = c.id
                     AND first_user.role = 'user'
                   ORDER BY first_user.ordinal ASC
                   LIMIT 1
                 )
                 WHERE LOWER(TRIM(c.title)) = 'new conversation'",
            )
            .map_err(|error| error.to_string())?;
        let conversations = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        drop(statement);

        let mut renamed = Vec::new();
        for (conversation_id, content) in conversations {
            let attachment_names = first_user_attachment_names(&connection, &conversation_id)?;
            let title = automatic_conversation_title(&content, &attachment_names);
            let changed = connection
                .execute(
                    "UPDATE chat_conversations
                     SET title = ?2
                     WHERE id = ?1 AND LOWER(TRIM(title)) = 'new conversation'",
                    params![conversation_id, title],
                )
                .map_err(|error| error.to_string())?;
            if changed > 0 {
                renamed.push(conversation_id);
            }
        }
        drop(connection);

        for conversation_id in renamed {
            // A title backfill should never prevent a vault from opening. The
            // next ordinary projection write will also bring the heading up to date.
            let _ = self.write_projection(&conversation_id, false);
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn create_agent_run(
        &self,
        conversation_id: &str,
        user_message_id: &str,
        assistant_message_id: &str,
        retry_of_message_id: Option<&str>,
        provider: &str,
        model: &str,
    ) -> Result<String, String> {
        self.create_agent_run_with_context(
            conversation_id,
            user_message_id,
            assistant_message_id,
            retry_of_message_id,
            provider,
            model,
            DEFAULT_REASONING_EFFORT,
            false,
            None,
            &[],
        )
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(test)]
    pub(super) fn create_agent_run_with_context(
        &self,
        conversation_id: &str,
        user_message_id: &str,
        assistant_message_id: &str,
        retry_of_message_id: Option<&str>,
        provider: &str,
        model: &str,
        reasoning_effort: &str,
        force_web_search: bool,
        active_note: Option<&crate::agent_tools::ActiveNoteSnapshot>,
        selected_context: &[ChatRunContextItem],
    ) -> Result<String, String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        let id = Self::insert_agent_run_with_context(
            &transaction,
            conversation_id,
            user_message_id,
            assistant_message_id,
            retry_of_message_id,
            provider,
            model,
            reasoning_effort,
            force_web_search,
            active_note,
            selected_context,
        )?;
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(id)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn insert_agent_run_with_context(
        connection: &Connection,
        conversation_id: &str,
        user_message_id: &str,
        assistant_message_id: &str,
        retry_of_message_id: Option<&str>,
        provider: &str,
        model: &str,
        reasoning_effort: &str,
        force_web_search: bool,
        active_note: Option<&crate::agent_tools::ActiveNoteSnapshot>,
        selected_context: &[ChatRunContextItem],
    ) -> Result<String, String> {
        let id = generate_id("run");
        let now = to_i64(now_millis())?;
        let active_note_json = active_note
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO chat_agent_runs
                 (id, conversation_id, user_message_id, assistant_message_id,
                  retry_of_message_id, provider, model, reasoning_effort,
                  force_web_search, active_note_json, status,
                  created_at_millis, updated_at_millis)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'running', ?11, ?11)",
                params![
                    id,
                    conversation_id,
                    user_message_id,
                    assistant_message_id,
                    retry_of_message_id,
                    provider,
                    model,
                    reasoning_effort,
                    force_web_search,
                    active_note_json,
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
        for (ordinal, item) in selected_context.iter().enumerate() {
            connection
                .execute(
                    "INSERT INTO chat_agent_run_context
                     (run_id, ordinal, note_id, note_path, title, section_label,
                      excerpt, content_hash, reason, start_line, end_line, block_anchor)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        id,
                        to_i64(ordinal as u64)?,
                        item.note_id,
                        item.note_path,
                        item.title,
                        item.section_label,
                        item.excerpt,
                        item.content_hash,
                        item.reason,
                        item.start_line.map(|value| value as i64),
                        item.end_line.map(|value| value as i64),
                        item.block_anchor,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(id)
    }
}
