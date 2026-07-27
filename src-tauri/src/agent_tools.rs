use crate::{
    chat::{ChatAgentProposal, ChatService, ChatSource, VaultAccess},
    index::AppState,
    note::{self, DocumentKind},
    proposals::{
        preview_note_change, preview_note_change_from_working, preview_note_creation,
        preview_note_rewrite, preview_note_rewrite_from_working, ProposalPreview, ProposedTextEdit,
    },
    semantic::db::content_hash,
};
use rig_core::tool::Tool;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActiveNoteSnapshot {
    pub(crate) note_id: Option<String>,
    pub(crate) title: String,
    pub(crate) path: Option<String>,
    pub(crate) body: String,
    pub(crate) body_hash: String,
    pub(crate) selection: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityEvent {
    request_id: String,
    conversation_id: String,
    message_id: String,
    run_id: String,
    status: String,
}

struct WorkingNote {
    body: String,
    content_hash: String,
    pending_changes: bool,
    disk_hash: String,
}

#[derive(Default)]
struct ReadCoverage {
    content_hash: String,
    total_lines: usize,
    ranges: Vec<(usize, usize)>,
}

impl ReadCoverage {
    fn record(
        &mut self,
        content_hash: &str,
        start_line: usize,
        end_line: usize,
        total_lines: usize,
    ) {
        if self.content_hash != content_hash {
            self.content_hash = content_hash.to_string();
            self.ranges.clear();
        }
        self.total_lines = total_lines;
        if start_line <= end_line {
            self.ranges.push((start_line, end_line));
        }
    }

    fn complete_for(&self, content_hash: &str) -> bool {
        if self.content_hash != content_hash {
            return false;
        }
        if self.total_lines == 0 {
            return true;
        }
        let mut ranges = self.ranges.clone();
        ranges.sort_unstable();
        let mut covered_through = 0usize;
        for (start, end) in ranges {
            if start > covered_through.saturating_add(1) {
                return false;
            }
            covered_through = covered_through.max(end);
            if covered_through >= self.total_lines {
                return true;
            }
        }
        false
    }
}

#[derive(Clone)]
pub(crate) struct AgentToolContext {
    app: AppHandle,
    service: ChatService,
    request_id: String,
    run_id: String,
    conversation_id: String,
    assistant_message_id: String,
    access: VaultAccess,
    active_note: Option<ActiveNoteSnapshot>,
    surfaced: Arc<Mutex<HashSet<String>>>,
    read_coverage: Arc<Mutex<HashMap<String, ReadCoverage>>>,
    sources: Arc<Mutex<Vec<ChatSource>>>,
    proposal_lock: Arc<Mutex<()>>,
    local_model: bool,
    proposal_failures: Arc<AtomicUsize>,
}

impl AgentToolContext {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        app: AppHandle,
        service: ChatService,
        request_id: String,
        run_id: String,
        conversation_id: String,
        assistant_message_id: String,
        access: VaultAccess,
        active_note: Option<ActiveNoteSnapshot>,
        local_model: bool,
    ) -> Self {
        Self {
            app,
            service,
            request_id,
            run_id,
            conversation_id,
            assistant_message_id,
            access,
            active_note,
            surfaced: Arc::new(Mutex::new(HashSet::new())),
            read_coverage: Arc::new(Mutex::new(HashMap::new())),
            sources: Arc::new(Mutex::new(Vec::new())),
            proposal_lock: Arc::new(Mutex::new(())),
            local_model,
            proposal_failures: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub(crate) fn tools(&self) -> Vec<Box<dyn rig_core::tool::ToolDyn>> {
        vec![
            Box::new(GetActiveNoteTool(self.clone())),
            Box::new(SearchNotesTool(self.clone())),
            Box::new(ReadNoteTool(self.clone())),
            Box::new(ProposeNoteEditsTool(self.clone())),
            Box::new(ProposeNoteRewriteTool(self.clone())),
            Box::new(ProposeCreateNoteTool(self.clone())),
        ]
    }

    pub(crate) fn sources(&self) -> Vec<ChatSource> {
        self.sources
            .lock()
            .map(|items| items.clone())
            .unwrap_or_default()
    }

    pub(crate) fn explicit_wikilink_context(&self, message: &str) -> Result<String, String> {
        let titles = wikilink_titles(message);
        if titles.is_empty() || self.access == VaultAccess::None {
            return Ok(String::new());
        }
        let state = self
            .app
            .try_state::<AppState>()
            .ok_or_else(|| "The notes index is unavailable".to_string())?;
        let index = state
            .notes_index
            .lock()
            .map_err(|_| "Notes index lock poisoned".to_string())?;
        let mut attached = Vec::new();
        for title in titles {
            let Some((path, indexed)) = index.entries.iter().find(|(_, note)| {
                note.document_kind == DocumentKind::Note
                    && (note.title.eq_ignore_ascii_case(&title)
                        || note.file_name.eq_ignore_ascii_case(&title))
            }) else {
                continue;
            };
            if !self
                .service
                .note_is_allowed(&self.access, &indexed.note_id)?
            {
                continue;
            }
            let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
            let working = self
                .working_note(&indexed.note_id, &raw)
                .map_err(|error| error.to_string())?;
            let excerpt = working.body.chars().take(12_000).collect::<String>();
            self.surface(&indexed.note_id);
            if excerpt == working.body {
                self.record_read(
                    &indexed.note_id,
                    &working.content_hash,
                    1,
                    working.body.lines().count(),
                    working.body.lines().count(),
                );
            }
            self.add_source(&indexed.note_id, path, &indexed.title, &excerpt, None);
            attached.push(format!(
                "[[{}]] (noteId: {}, contentHash: {}, pendingChanges: {})\n{}",
                indexed.title,
                indexed.note_id,
                working.content_hash,
                working.pending_changes,
                excerpt
            ));
        }
        Ok(attached.join("\n\n"))
    }

    pub(crate) fn active_note_context(&self) -> Result<String, String> {
        let payload = self
            .active_note_payload()
            .map_err(|error| error.to_string())?;
        if payload.get("status").and_then(Value::as_str) != Some("ready") {
            return Ok(String::new());
        }
        serde_json::to_string_pretty(&payload)
            .map(|json| format!("Allowed active note adjacent to Chat:\n{json}"))
            .map_err(|error| error.to_string())
    }

    fn active_note_payload(&self) -> Result<Value, AgentToolError> {
        let Some(snapshot) = self.active_note.as_ref() else {
            return Ok(
                json!({"status":"unavailable","reason":"No saved active note was attached."}),
            );
        };
        let Some(note_id) = snapshot.note_id.as_deref() else {
            return Ok(
                json!({"status":"unavailable","reason":"Save the active note before using it with the agent."}),
            );
        };
        if !self.allowed(note_id)? {
            return Ok(
                json!({"status":"unavailable","reason":"The active note is not allowed by the current vault policy."}),
            );
        }
        let (path, title, _) = self.resolve_note(note_id)?;
        let raw = fs::read_to_string(&path)
            .map_err(|error| AgentToolError(format!("Unable to read active note: {error}")))?;
        let working = self.working_note(note_id, &raw)?;
        let authoritative = ActiveNoteSnapshot {
            note_id: Some(note_id.to_string()),
            title,
            path: Some(path.to_string_lossy().into_owned()),
            body: working.body,
            body_hash: working.content_hash,
            selection: snapshot.selection.clone(),
        };
        let (body, truncated) = truncate_active_body(&authoritative);
        self.surface(note_id);
        if !truncated {
            let total_lines = authoritative.body.lines().count();
            self.record_read(
                note_id,
                &authoritative.body_hash,
                1,
                total_lines,
                total_lines,
            );
        }
        self.add_source(note_id, &path, &authoritative.title, &body, None);
        Ok(json!({
            "status":"ready",
            "noteId":note_id,
            "title":authoritative.title,
            "path":authoritative.path,
            "body":body,
            "contentHash":authoritative.body_hash,
            "selection":authoritative.selection,
            "truncated":truncated,
            "pendingChanges":working.pending_changes
        }))
    }

    fn activity(&self, status: &str) {
        let _ = self.app.emit(
            "chat://activity",
            ActivityEvent {
                request_id: self.request_id.clone(),
                conversation_id: self.conversation_id.clone(),
                message_id: self.assistant_message_id.clone(),
                run_id: self.run_id.clone(),
                status: status.to_string(),
            },
        );
    }

    fn allowed(&self, note_id: &str) -> Result<bool, AgentToolError> {
        self.service
            .note_is_allowed(&self.access, note_id)
            .map_err(AgentToolError)
    }

    fn surface(&self, note_id: &str) {
        if let Ok(mut surfaced) = self.surfaced.lock() {
            surfaced.insert(note_id.to_string());
        }
    }

    fn was_surfaced(&self, note_id: &str) -> bool {
        self.surfaced
            .lock()
            .map(|surfaced| surfaced.contains(note_id))
            .unwrap_or(false)
    }

    fn record_read(
        &self,
        note_id: &str,
        content_hash: &str,
        start_line: usize,
        end_line: usize,
        total_lines: usize,
    ) {
        if let Ok(mut coverage) = self.read_coverage.lock() {
            coverage.entry(note_id.to_string()).or_default().record(
                content_hash,
                start_line,
                end_line,
                total_lines,
            );
        }
    }

    fn was_fully_read(&self, note_id: &str, content_hash: &str) -> bool {
        self.read_coverage
            .lock()
            .ok()
            .and_then(|coverage| {
                coverage
                    .get(note_id)
                    .map(|read| read.complete_for(content_hash))
            })
            .unwrap_or(false)
    }

    fn add_source(
        &self,
        note_id: &str,
        path: &Path,
        title: &str,
        excerpt: &str,
        anchor: Option<String>,
    ) {
        let relative = path
            .strip_prefix(self.service.notes_root())
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned();
        if let Ok(mut sources) = self.sources.lock() {
            if sources
                .iter()
                .any(|source| source.note_id.as_deref() == Some(note_id) && source.anchor == anchor)
            {
                return;
            }
            sources.push(ChatSource {
                kind: "note".to_string(),
                note_id: Some(note_id.to_string()),
                note_path: Some(relative),
                title: title.to_string(),
                excerpt: excerpt.chars().take(4_000).collect(),
                url: None,
                anchor,
            });
        }
    }

    fn resolve_note(&self, note_id: &str) -> Result<(PathBuf, String, u64), AgentToolError> {
        let state = self
            .app
            .try_state::<AppState>()
            .ok_or_else(|| AgentToolError("The notes index is unavailable".to_string()))?;
        let index = state
            .notes_index
            .lock()
            .map_err(|_| AgentToolError("Notes index lock poisoned".to_string()))?;
        let (path, indexed) = index
            .get_note_by_note_id(note_id)
            .ok_or_else(|| AgentToolError("Note not found".to_string()))?;
        if indexed.document_kind != DocumentKind::Note {
            return Err(AgentToolError(
                "Only ordinary notes are available".to_string(),
            ));
        }
        Ok((path.clone(), indexed.title.clone(), indexed.modified_millis))
    }

    fn working_note(&self, note_id: &str, raw: &str) -> Result<WorkingNote, AgentToolError> {
        let disk_hash = content_hash(raw);
        let Some(proposal) = self
            .service
            .pending_agent_proposal_for_note(note_id)
            .map_err(AgentToolError)?
        else {
            return Ok(WorkingNote {
                body: note::strip_frontmatter(raw).to_string(),
                content_hash: disk_hash.clone(),
                pending_changes: false,
                disk_hash,
            });
        };
        let preview: ProposalPreview =
            serde_json::from_value(proposal.preview).map_err(|error| {
                AgentToolError(format!("Stored proposal preview is invalid: {error}"))
            })?;
        let expected_disk_hash = proposal
            .base_hash
            .unwrap_or_else(|| preview.base_content_hash.clone());
        if expected_disk_hash != disk_hash {
            return Ok(WorkingNote {
                body: preview.proposed_editor_markdown.clone(),
                content_hash: content_hash(&preview.proposed_editor_markdown),
                pending_changes: true,
                disk_hash,
            });
        }
        let active_body = self.active_note.as_ref().and_then(|snapshot| {
            (snapshot.note_id.as_deref() == Some(note_id)
                && snapshot.body != preview.base_editor_markdown)
                .then(|| (snapshot.body.clone(), snapshot.body_hash.clone()))
        });
        let (body, virtual_hash) = active_body.unwrap_or_else(|| {
            let body = preview.proposed_editor_markdown;
            let hash = content_hash(&body);
            (body, hash)
        });
        Ok(WorkingNote {
            body,
            content_hash: virtual_hash,
            pending_changes: true,
            disk_hash,
        })
    }

    fn emit_proposal(&self, proposal: &ChatAgentProposal) {
        let _ = self.app.emit("chat://proposal", proposal);
    }

    fn update_target_error(
        &self,
        note_id: &str,
        expected_content_hash: &str,
        working: &WorkingNote,
    ) -> Result<Option<Value>, AgentToolError> {
        if working.content_hash != expected_content_hash {
            return Ok(Some(
                json!({"status":"error","retryable":true,"code":"content_changed","message":"The note or its pending changes changed. Read it again and retry with the new contentHash.","contentHash":working.content_hash}),
            ));
        }
        if !working.pending_changes {
            return Ok(None);
        }
        let pending = self
            .service
            .pending_agent_proposal_for_note(note_id)
            .map_err(AgentToolError)?
            .ok_or_else(|| AgentToolError("Pending proposal disappeared".to_string()))?;
        let expected_disk_hash = pending
            .base_hash
            .unwrap_or_else(|| working.disk_hash.clone());
        if expected_disk_hash != working.disk_hash {
            return Ok(Some(
                json!({"status":"error","retryable":true,"code":"content_changed","message":"The saved note changed underneath its pending proposal. Resolve the conflict before preparing more changes.","contentHash":working.disk_hash}),
            ));
        }
        Ok(None)
    }
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub(crate) struct AgentToolError(String);

#[derive(Clone)]
struct GetActiveNoteTool(AgentToolContext);

#[derive(Deserialize)]
struct EmptyArgs {}

impl Tool for GetActiveNoteTool {
    const NAME: &'static str = "get_active_note";
    type Error = AgentToolError;
    type Args = EmptyArgs;
    type Output = Value;

    fn description(&self) -> String {
        "Return the note adjacent to Chat, including its stable ID, body, selection, and content hash. Use this when the user says 'this note' or asks to change what they are viewing.".to_string()
    }

    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{},"additionalProperties":false})
    }

    async fn call(&self, _args: Self::Args) -> Result<Self::Output, Self::Error> {
        self.0.activity("Reading active note");
        self.0.active_note_payload()
    }
}

fn truncate_active_body(note: &ActiveNoteSnapshot) -> (String, bool) {
    if note.body.chars().count() <= 48_000 {
        return (note.body.clone(), false);
    }
    let mut output = note.body.chars().take(40_000).collect::<String>();
    if let Some(selection) = note.selection.as_deref().filter(|value| !value.is_empty()) {
        output.push_str("\n\n[Selected text]\n");
        output.extend(selection.chars().take(8_000));
    }
    (output, true)
}

#[derive(Clone)]
struct SearchNotesTool(AgentToolContext);

#[derive(Deserialize)]
struct SearchArgs {
    query: String,
    limit: Option<usize>,
    modified_after: Option<u64>,
    modified_before: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchItem {
    note_id: String,
    title: String,
    note_path: String,
    excerpt: String,
    score: f32,
    source: String,
    modified_at_millis: u64,
}

impl Tool for SearchNotesTool {
    const NAME: &'static str = "search_notes";
    type Error = AgentToolError;
    type Args = SearchArgs;
    type Output = Value;

    fn description(&self) -> String {
        "Search allowed ordinary notes across the vault using hybrid lexical and semantic retrieval. Use natural-language queries; results can then be paged with read_note.".to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{
                "query":{"type":"string"},
                "limit":{"type":["integer","null"],"minimum":1,"maximum":20},
                "modified_after":{"type":["integer","null"],"description":"Unix milliseconds"},
                "modified_before":{"type":["integer","null"],"description":"Unix milliseconds"}
            },
            "required":["query"],
            "additionalProperties":false
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        self.0.activity("Searching notes");
        if self.0.access == VaultAccess::None {
            return Ok(json!({"status":"ready","items":[]}));
        }
        let query = args.query.trim();
        if query.is_empty() {
            return Err(AgentToolError("Search query cannot be empty".to_string()));
        }
        let limit = args.limit.unwrap_or(8).clamp(1, 20);
        let state = self
            .0
            .app
            .try_state::<AppState>()
            .ok_or_else(|| AgentToolError("The notes index is unavailable".to_string()))?;
        let approved = if self.0.access == VaultAccess::Approved {
            Some(self.0.service.granted_note_ids().map_err(AgentToolError)?)
        } else {
            None
        };
        let excluded = self.0.service.excluded_note_ids().map_err(AgentToolError)?;
        let retrieved = crate::services::retrieval::retrieve_vault_notes(
            &state,
            query,
            limit,
            approved.as_ref(),
            &excluded,
            args.modified_after,
            args.modified_before,
        )
        .map_err(AgentToolError)?;
        let items = retrieved
            .iter()
            .map(|item| SearchItem {
                note_id: item.note_id.clone(),
                title: item.title.clone(),
                note_path: relative_path(self.0.service.notes_root(), &item.note_path),
                excerpt: item.excerpt.clone(),
                score: item.score,
                source: if item.lexical_score.is_some() && item.semantic_score.is_some() {
                    "hybrid"
                } else if item.semantic_score.is_some() {
                    "semantic"
                } else {
                    "lexical"
                }
                .to_string(),
                modified_at_millis: item.modified_millis,
            })
            .collect::<Vec<_>>();
        for item in &items {
            self.0.surface(&item.note_id);
            self.0.add_source(
                &item.note_id,
                &self.0.service.notes_root().join(&item.note_path),
                &item.title,
                &item.excerpt,
                None,
            );
        }
        Ok(json!({"status":"ready","items":items}))
    }
}

#[derive(Clone)]
struct ReadNoteTool(AgentToolContext);

#[derive(Deserialize)]
struct ReadArgs {
    note_id: String,
    start_line: Option<usize>,
    max_chars: Option<usize>,
}

impl Tool for ReadNoteTool {
    const NAME: &'static str = "read_note";
    type Error = AgentToolError;
    type Args = ReadArgs;
    type Output = Value;

    fn description(&self) -> String {
        "Read an allowed note by stable ID in bounded pages. When pendingChanges is true, the content is the current unapproved working copy and should be treated as the note's current text. Line numbers are 1-based.".to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{
                "note_id":{"type":"string"},
                "start_line":{"type":["integer","null"],"minimum":1},
                "max_chars":{"type":["integer","null"],"minimum":1,"maximum":24000}
            },
            "required":["note_id"],
            "additionalProperties":false
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        self.0.activity("Reading note");
        if !self.0.allowed(&args.note_id)? {
            return Ok(
                json!({"status":"unavailable","reason":"The note is not allowed by the current vault policy."}),
            );
        }
        let (path, title, _) = self.0.resolve_note(&args.note_id)?;
        let raw = fs::read_to_string(&path)
            .map_err(|error| AgentToolError(format!("Unable to read note: {error}")))?;
        let working = self.0.working_note(&args.note_id, &raw)?;
        let body = working.body.as_str();
        let start_line = args.start_line.unwrap_or(1).max(1);
        let max_chars = args.max_chars.unwrap_or(12_000).clamp(1, 24_000);
        let lines = body.lines().collect::<Vec<_>>();
        let mut content = String::new();
        let mut end_line = start_line.saturating_sub(1);
        for (index, line) in lines.iter().enumerate().skip(start_line - 1) {
            let needed = line.chars().count() + usize::from(!content.is_empty());
            if !content.is_empty() && content.chars().count() + needed > max_chars {
                break;
            }
            if !content.is_empty() {
                content.push('\n');
            }
            content.push_str(line);
            end_line = index + 1;
        }
        self.0.surface(&args.note_id);
        self.0.record_read(
            &args.note_id,
            &working.content_hash,
            start_line,
            end_line,
            lines.len(),
        );
        self.0.add_source(
            &args.note_id,
            &path,
            &title,
            &content,
            Some(format!("lines {start_line}-{end_line}")),
        );
        Ok(json!({
            "status":"ready",
            "noteId":args.note_id,
            "title":title,
            "startLine":start_line,
            "endLine":end_line,
            "hasMore":end_line < lines.len(),
            "content":content,
            "contentHash":working.content_hash,
            "pendingChanges":working.pending_changes
        }))
    }
}

#[derive(Clone)]
struct ProposeNoteEditsTool(AgentToolContext);

#[derive(Deserialize, Serialize)]
struct EditArgs {
    note_id: String,
    expected_content_hash: String,
    edits: Vec<ProposedTextEdit>,
}

impl Tool for ProposeNoteEditsTool {
    const NAME: &'static str = "propose_note_edits";
    type Error = AgentToolError;
    type Args = EditArgs;
    type Output = Value;

    fn description(&self) -> String {
        "Prepare a reviewed, no-write update for a note surfaced during this run. Use append or prepend for changes at the document boundaries; use insert only between exact, unique contextBefore/contextAfter anchors; use replace with exact non-empty oldText. Include any needed Markdown separators or newlines in newText. If the latest content has pendingChanges, edits are folded into that unapproved proposal. The user must explicitly Keep the combined preview before disk is changed.".to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{
                "note_id":{"type":"string"},
                "expected_content_hash":{"type":"string"},
                "edits":{
                    "type":"array","minItems":1,
                    "items":{
                        "type":"object",
                        "properties":{
                            "kind":{
                                "type":"string",
                                "enum":["replace","insert","append","prepend"],
                                "description":"Use append/prepend at document boundaries, replace for existing text, and insert only between exact anchors."
                            },
                            "oldText":{
                                "type":["string","null"],
                                "description":"Required and non-empty for replace; omit for insert, append, and prepend."
                            },
                            "newText":{
                                "type":"string",
                                "description":"Exact replacement or inserted Markdown, including any required leading/trailing newlines."
                            },
                            "contextBefore":{
                                "type":["string","null"],
                                "description":"For insert/replace, exact text immediately before the target. Do not use for append/prepend."
                            },
                            "contextAfter":{
                                "type":["string","null"],
                                "description":"For insert/replace, exact text immediately after the target. Do not use for append/prepend."
                            }
                        },
                        "required":["kind","newText"],
                        "additionalProperties":false
                    }
                }
            },
            "required":["note_id","expected_content_hash","edits"],
            "additionalProperties":false
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        self.0.activity("Preparing changes");
        if !self.0.allowed(&args.note_id)? || !self.0.was_surfaced(&args.note_id) {
            return Ok(
                json!({"status":"error","retryable":false,"code":"target_not_surfaced","message":"Read or search this note during the current run before proposing changes."}),
            );
        }
        let _guard = self
            .0
            .proposal_lock
            .lock()
            .map_err(|_| AgentToolError("Proposal lock poisoned".to_string()))?;
        let (path, title, _) = self.0.resolve_note(&args.note_id)?;
        let raw = fs::read_to_string(&path)
            .map_err(|error| AgentToolError(format!("Unable to read note: {error}")))?;
        let working = self.0.working_note(&args.note_id, &raw)?;
        if let Some(error) =
            self.0
                .update_target_error(&args.note_id, &args.expected_content_hash, &working)?
        {
            return Ok(error);
        }
        let preview_result = if working.pending_changes {
            preview_note_change_from_working(
                self.0.service.notes_root(),
                &path.to_string_lossy(),
                Some(&working.body),
                &args.edits,
            )
        } else {
            preview_note_change(
                self.0.service.notes_root(),
                &path.to_string_lossy(),
                &args.edits,
            )
        };
        let preview = match preview_result {
            Ok(preview) => preview,
            Err(message) => {
                let retryable = !self.0.local_model
                    || self.0.proposal_failures.fetch_add(1, Ordering::Relaxed) == 0;
                let message = if retryable {
                    message
                } else {
                    format!(
                        "{message} Repeated local-model edit failures are not retryable; stop calling tools and briefly ask the user to retry or use a stronger model."
                    )
                };
                return Ok(
                    json!({"status":"error","retryable":retryable,"code":"invalid_anchors","message":message}),
                );
            }
        };
        self.0.proposal_failures.store(0, Ordering::Relaxed);
        let payload = serde_json::to_value(&args)
            .map_err(|error| AgentToolError(format!("Unable to store proposal: {error}")))?;
        let preview_value = serde_json::to_value(&preview)
            .map_err(|error| AgentToolError(format!("Unable to store proposal: {error}")))?;
        let proposal = self
            .0
            .service
            .stage_agent_proposal(
                &self.0.run_id,
                &self.0.conversation_id,
                &self.0.assistant_message_id,
                "update",
                Some(&args.note_id),
                None,
                &title,
                Some(&working.disk_hash),
                &payload,
                &preview_value,
            )
            .map_err(AgentToolError)?;
        self.0.emit_proposal(&proposal);
        Ok(json!({"status":"pending_review","proposalId":proposal.id,"title":title}))
    }
}

#[derive(Clone)]
struct ProposeNoteRewriteTool(AgentToolContext);

#[derive(Deserialize, Serialize)]
struct RewriteArgs {
    note_id: String,
    expected_content_hash: String,
    markdown: String,
}

impl Tool for ProposeNoteRewriteTool {
    const NAME: &'static str = "propose_note_rewrite";
    type Error = AgentToolError;
    type Args = RewriteArgs;
    type Output = Value;

    fn description(&self) -> String {
        "Prepare a reviewed, no-write complete rewrite of a note fully read during this run. Use this for whole-note cleanup, restructuring, translation, or tone changes; use propose_note_edits for localized changes. Read every page of the current note first. markdown must contain the complete replacement body, including every part that should be retained, and must omit managed frontmatter. If pendingChanges is true, rewrite the complete current unapproved working copy. The user must explicitly Keep the preview before disk is changed.".to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{
                "note_id":{"type":"string"},
                "expected_content_hash":{"type":"string"},
                "markdown":{
                    "type":"string",
                    "minLength":1,
                    "description":"Complete replacement Markdown body. Include all content to retain; omit managed frontmatter."
                }
            },
            "required":["note_id","expected_content_hash","markdown"],
            "additionalProperties":false
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        self.0.activity("Preparing rewrite");
        if !self.0.allowed(&args.note_id)? || !self.0.was_surfaced(&args.note_id) {
            return Ok(
                json!({"status":"error","retryable":false,"code":"target_not_surfaced","message":"Read or search this note during the current run before proposing a rewrite."}),
            );
        }
        let _guard = self
            .0
            .proposal_lock
            .lock()
            .map_err(|_| AgentToolError("Proposal lock poisoned".to_string()))?;
        let (path, title, _) = self.0.resolve_note(&args.note_id)?;
        let raw = fs::read_to_string(&path)
            .map_err(|error| AgentToolError(format!("Unable to read note: {error}")))?;
        let working = self.0.working_note(&args.note_id, &raw)?;
        if !self.0.was_fully_read(&args.note_id, &working.content_hash) {
            return Ok(
                json!({"status":"error","retryable":true,"code":"note_not_fully_read","message":"Read the complete current note with read_note, paging from line 1 until hasMore is false, before proposing a complete rewrite."}),
            );
        }
        if let Some(error) =
            self.0
                .update_target_error(&args.note_id, &args.expected_content_hash, &working)?
        {
            return Ok(error);
        }
        let preview_result = if working.pending_changes {
            preview_note_rewrite_from_working(
                self.0.service.notes_root(),
                &path.to_string_lossy(),
                Some(&working.body),
                &args.markdown,
            )
        } else {
            preview_note_rewrite(
                self.0.service.notes_root(),
                &path.to_string_lossy(),
                &args.markdown,
            )
        };
        let preview = match preview_result {
            Ok(preview) => preview,
            Err(message) => {
                return Ok(
                    json!({"status":"error","retryable":false,"code":"invalid_rewrite","message":message}),
                );
            }
        };
        let payload = serde_json::to_value(&args)
            .map_err(|error| AgentToolError(format!("Unable to store proposal: {error}")))?;
        let preview_value = serde_json::to_value(&preview)
            .map_err(|error| AgentToolError(format!("Unable to store proposal: {error}")))?;
        let proposal = self
            .0
            .service
            .stage_agent_proposal(
                &self.0.run_id,
                &self.0.conversation_id,
                &self.0.assistant_message_id,
                "update",
                Some(&args.note_id),
                None,
                &title,
                Some(&working.disk_hash),
                &payload,
                &preview_value,
            )
            .map_err(AgentToolError)?;
        self.0.emit_proposal(&proposal);
        Ok(json!({"status":"pending_review","proposalId":proposal.id,"title":title}))
    }
}

#[derive(Clone)]
struct ProposeCreateNoteTool(AgentToolContext);

#[derive(Deserialize, Serialize)]
struct CreateArgs {
    title: String,
    markdown: String,
}

impl Tool for ProposeCreateNoteTool {
    const NAME: &'static str = "propose_create_note";
    type Error = AgentToolError;
    type Args = CreateArgs;
    type Output = Value;

    fn description(&self) -> String {
        "Prepare a reviewed, no-write new Markdown note. The user must explicitly Keep the preview before a uniquely named file is created.".to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{
                "title":{"type":"string","minLength":1},
                "markdown":{"type":"string"}
            },
            "required":["title","markdown"],
            "additionalProperties":false
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        self.0.activity("Preparing new note");
        if self.0.access == VaultAccess::None {
            return Ok(
                json!({"status":"error","retryable":false,"code":"vault_access_disabled","message":"Enable vault access before creating a note."}),
            );
        }
        let _guard = self
            .0
            .proposal_lock
            .lock()
            .map_err(|_| AgentToolError("Proposal lock poisoned".to_string()))?;
        let preview =
            preview_note_creation(self.0.service.notes_root(), &args.title, &args.markdown)
                .map_err(AgentToolError)?;
        let payload = serde_json::to_value(&args)
            .map_err(|error| AgentToolError(format!("Unable to store proposal: {error}")))?;
        let preview_value = serde_json::to_value(&preview)
            .map_err(|error| AgentToolError(format!("Unable to store proposal: {error}")))?;
        let proposal = self
            .0
            .service
            .stage_agent_proposal(
                &self.0.run_id,
                &self.0.conversation_id,
                &self.0.assistant_message_id,
                "create",
                None,
                Some(&preview.suggested_path),
                &preview.title,
                None,
                &payload,
                &preview_value,
            )
            .map_err(AgentToolError)?;
        self.0.emit_proposal(&proposal);
        Ok(json!({
            "status":"pending_review",
            "proposalId":proposal.id,
            "title":preview.title,
            "suggestedPath":preview.suggested_path
        }))
    }
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

fn wikilink_titles(message: &str) -> Vec<String> {
    let mut rest = message;
    let mut titles = Vec::new();
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else { break };
        let target = rest[..end]
            .split('|')
            .next()
            .unwrap_or_default()
            .split('#')
            .next()
            .unwrap_or_default()
            .trim();
        if !target.is_empty() {
            titles.push(target.trim_end_matches(".md").to_string());
        }
        rest = &rest[end + 2..];
    }
    titles
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_coverage_requires_contiguous_pages_from_the_current_content() {
        let mut coverage = ReadCoverage::default();
        coverage.record("hash-1", 1, 3, 8);
        coverage.record("hash-1", 6, 8, 8);
        assert!(!coverage.complete_for("hash-1"));

        coverage.record("hash-1", 4, 5, 8);
        assert!(coverage.complete_for("hash-1"));

        coverage.record("hash-2", 7, 8, 8);
        assert!(!coverage.complete_for("hash-1"));
        assert!(!coverage.complete_for("hash-2"));
    }

    #[test]
    fn active_note_context_is_bounded_but_keeps_selection() {
        let note = ActiveNoteSnapshot {
            note_id: Some("n".into()),
            title: "Long".into(),
            path: None,
            body: "a".repeat(50_000),
            body_hash: "hash".into(),
            selection: Some("important".into()),
        };
        let (body, truncated) = truncate_active_body(&note);
        assert!(truncated);
        assert!(body.contains("important"));
        assert!(body.chars().count() <= 48_100);
    }
}
