mod admission;
mod answer_stream;
pub(crate) mod citations;
pub(crate) mod date_time;
mod projection;
mod recovery;
mod runtime;
mod store;
pub(crate) mod structured_answer;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use blake3::Hasher;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

use crate::{
    proposals::{canonical_agent_commit_target, editor_visible_content_hash},
    secrets,
    semantic::db::content_hash,
    state::is_valid_note_path,
};

const DEFAULT_MODEL: &str = "gpt-5.6-terra";
const DEFAULT_LOCAL_MODEL: &str = "";
const DEFAULT_LOCAL_BASE_URL: &str = "http://localhost:1234/v1";
const MAX_PART_MESSAGES: i64 = 100;
const MAX_PART_BYTES: i64 = 256 * 1024;
const MAX_RECENT_MESSAGES: usize = 16;
const MAX_ATTACHMENTS: usize = 10;
const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES: usize = 25 * 1024 * 1024;
const DEFAULT_CONVERSATION_TITLE: &str = "New conversation";
const MAX_CONVERSATION_TITLE_CHARS: usize = 56;
static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum VaultAccess {
    None,
    Approved,
    Full,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ChatServiceTier {
    Standard,
    Flex,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WebAccess {
    Off,
    #[default]
    Auto,
}

impl WebAccess {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Auto => "auto",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "off" => Self::Off,
            _ => Self::Auto,
        }
    }
}

impl ChatServiceTier {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Flex => "flex",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "flex" => Self::Flex,
            _ => Self::Standard,
        }
    }
}

impl VaultAccess {
    fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Approved => "approved",
            Self::Full => "full",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "none" => Self::None,
            "full" => Self::Full,
            "approved" | "limited" => Self::Approved,
            _ => Self::Approved,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatDefaults {
    pub(crate) provider: String,
    pub(crate) model: String,
    #[serde(default = "default_openai_model")]
    pub(crate) openai_model: String,
    #[serde(default = "default_local_model")]
    pub(crate) local_model: String,
    #[serde(default = "default_local_base_url")]
    pub(crate) local_base_url: String,
    #[serde(default = "default_reasoning_effort")]
    pub(crate) reasoning_effort: String,
    pub(crate) service_tier: ChatServiceTier,
    #[serde(default)]
    pub(crate) web_access: WebAccess,
    pub(crate) default_access: VaultAccess,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatSettings {
    pub(crate) provider: String,
    pub(crate) model: String,
    #[serde(default = "default_openai_model")]
    pub(crate) openai_model: String,
    #[serde(default = "default_local_model")]
    pub(crate) local_model: String,
    #[serde(default = "default_local_base_url")]
    pub(crate) local_base_url: String,
    #[serde(default = "default_reasoning_effort")]
    pub(crate) reasoning_effort: String,
    pub(crate) service_tier: ChatServiceTier,
    #[serde(default)]
    pub(crate) web_access: WebAccess,
    pub(crate) default_access: VaultAccess,
    pub(crate) atlas_visibility: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalModelCapabilitySelection {
    pub(crate) images: bool,
    pub(crate) tools: bool,
    pub(crate) audio: bool,
    pub(crate) video: bool,
    pub(crate) reasoning_effort: String,
}

impl Default for LocalModelCapabilitySelection {
    fn default() -> Self {
        Self {
            images: false,
            tools: true,
            audio: false,
            video: false,
            reasoning_effort: DEFAULT_REASONING_EFFORT.to_string(),
        }
    }
}

impl Default for ChatSettings {
    fn default() -> Self {
        Self {
            provider: "openai".to_string(),
            model: DEFAULT_MODEL.to_string(),
            openai_model: DEFAULT_MODEL.to_string(),
            local_model: DEFAULT_LOCAL_MODEL.to_string(),
            local_base_url: DEFAULT_LOCAL_BASE_URL.to_string(),
            reasoning_effort: DEFAULT_REASONING_EFFORT.to_string(),
            service_tier: ChatServiceTier::Standard,
            web_access: WebAccess::Auto,
            default_access: VaultAccess::Full,
            atlas_visibility: "hidden".to_string(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatConversationSummary {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) access: VaultAccess,
    pub(crate) status: String,
    pub(crate) created_at_millis: u64,
    pub(crate) updated_at_millis: u64,
    pub(crate) message_count: usize,
    pub(crate) detached: bool,
    pub(crate) provider: String,
    pub(crate) model: String,
    pub(crate) reasoning_effort: String,
}

fn default_openai_model() -> String {
    DEFAULT_MODEL.to_string()
}

fn default_local_model() -> String {
    DEFAULT_LOCAL_MODEL.to_string()
}

fn default_local_base_url() -> String {
    DEFAULT_LOCAL_BASE_URL.to_string()
}

const DEFAULT_REASONING_EFFORT: &str = "medium";

fn default_reasoning_effort() -> String {
    DEFAULT_REASONING_EFFORT.to_string()
}

fn validate_reasoning_effort(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if matches!(value, "low" | "medium" | "high" | "xhigh" | "max") {
        Ok(value)
    } else {
        Err("Reasoning effort must be low, medium, high, xhigh, or max".to_string())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatMessage {
    pub(crate) id: String,
    pub(crate) conversation_id: String,
    pub(crate) ordinal: i64,
    pub(crate) role: String,
    pub(crate) status: String,
    pub(crate) content: String,
    pub(crate) error: Option<String>,
    pub(crate) part: i64,
    pub(crate) created_at_millis: u64,
    pub(crate) sources: Vec<ChatSource>,
    #[serde(skip)]
    has_revision_evidence: bool,
    // Navigation metadata only: never expose working-copy text as a source.
    #[serde(skip)]
    note_reference_ids: Vec<String>,
    pub(crate) attachments: Vec<ChatAttachment>,
    pub(crate) agent_events: Vec<ChatAgentEventEnvelope>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatAttachmentInput {
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) mime_type: String,
    pub(crate) size_bytes: usize,
    pub(crate) data_base64: String,
}

#[derive(Clone, Debug)]
pub(crate) enum ChatRequest {
    New {
        conversation_id: String,
        content: String,
        attachments: Vec<ChatAttachmentInput>,
        force_web_search: bool,
        active_note: Option<crate::agent_tools::ActiveNoteSnapshot>,
        selected_context: Vec<ChatRunContextItem>,
        date_time_context: Option<date_time::DateTimeContext>,
    },
    Retry {
        conversation_id: String,
        user_message_id: String,
        failed_assistant_message_id: String,
        date_time_context: Option<date_time::DateTimeContext>,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatAttachment {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) mime_type: String,
    pub(crate) size_bytes: usize,
    pub(crate) data_base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatSource {
    pub(crate) kind: String,
    pub(crate) note_id: Option<String>,
    pub(crate) note_path: Option<String>,
    pub(crate) title: String,
    pub(crate) excerpt: String,
    pub(crate) url: Option<String>,
    pub(crate) anchor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) revision: Option<crate::services::note_timeline::RevisionCitation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) passage: Option<crate::services::evidence::PassageCitation>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatRunContextItem {
    pub(crate) note_id: String,
    pub(crate) note_path: String,
    pub(crate) title: String,
    pub(crate) section_label: Option<String>,
    pub(crate) excerpt: String,
    pub(crate) content_hash: String,
    pub(crate) reason: String,
    pub(crate) start_line: Option<usize>,
    pub(crate) end_line: Option<usize>,
    pub(crate) block_anchor: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatConversation {
    #[serde(flatten)]
    pub(crate) summary: ChatConversationSummary,
    pub(crate) messages: Vec<ChatMessage>,
    pub(crate) excerpts: Vec<ChatExcerpt>,
    pub(crate) projection_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatExcerpt {
    pub(crate) id: String,
    pub(crate) conversation_id: String,
    pub(crate) message_id: String,
    pub(crate) start_offset: usize,
    pub(crate) end_offset: usize,
    pub(crate) quote: String,
    pub(crate) anchor: String,
    pub(crate) remembered: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct ChatRecallDocument {
    pub(crate) path: PathBuf,
    pub(crate) title: String,
    pub(crate) modified_millis: u64,
    pub(crate) excerpts: Vec<crate::semantic::indexer::ChatRecallExcerpt>,
}

#[derive(Clone, Debug)]
pub(crate) struct ChatForgottenFolderSnapshot {
    pub(crate) title: String,
    pub(crate) original_path: PathBuf,
    pub(crate) archived: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct ChatProjectionRelocation {
    pub(crate) previous_paths: Vec<PathBuf>,
    pub(crate) current_paths: Vec<PathBuf>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatGrant {
    pub(crate) note_id: String,
    pub(crate) note_path: Option<String>,
    pub(crate) title: String,
    pub(crate) granted_at_millis: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatNotePolicy {
    pub(crate) note_id: String,
    pub(crate) note_path: Option<String>,
    pub(crate) title: String,
    pub(crate) disposition: String,
    pub(crate) updated_at_millis: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatRequestAccepted {
    pub(crate) request_id: String,
    pub(crate) conversation_id: String,
    pub(crate) user_message_id: String,
    pub(crate) assistant_message_id: String,
    #[serde(skip_serializing)]
    automatic_title_fallback: Option<String>,
}

struct ActiveChatRun {
    app: AppHandle,
    request_id: String,
    conversation_id: String,
    user_message_id: String,
    assistant_message_id: String,
    run_id: String,
    force_web_search: bool,
    active_note: Option<crate::agent_tools::ActiveNoteSnapshot>,
    selected_context: Vec<ChatRunContextItem>,
    date_time_context: Option<date_time::DateTimeContext>,
    cancelled: CancellationToken,
    automatic_title_fallback: Option<String>,
    _work: ChatWorkLease,
}

struct RetryRunContext {
    user_message_id: String,
    force_web_search: bool,
    active_note: Option<crate::agent_tools::ActiveNoteSnapshot>,
    selected_context: Vec<ChatRunContextItem>,
}

struct AgentResponseFailure {
    partial: Option<String>,
    error: String,
    sources: Vec<ChatSource>,
    stats: crate::agent_guardrails::AgentRunStats,
}

struct AgentResponseSuccess {
    structured: bool,
    content: String,
    sources: Vec<ChatSource>,
    note_reference_ids: Vec<String>,
    usage: crate::agent_runtime::AgentUsage,
    stats: crate::agent_guardrails::AgentRunStats,
}

#[derive(Clone, Debug)]
struct ChatContextCompaction {
    through_ordinal: i64,
    summary: String,
}

impl From<String> for AgentResponseFailure {
    fn from(error: String) -> Self {
        Self {
            partial: None,
            error,
            sources: Vec::new(),
            stats: Default::default(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatAgentEventEnvelope {
    #[serde(default = "agent_event_schema_version")]
    pub(crate) schema_version: u16,
    pub(crate) request_id: String,
    pub(crate) conversation_id: String,
    pub(crate) message_id: String,
    pub(crate) run_id: String,
    pub(crate) sequence: u64,
    pub(crate) created_at_millis: u64,
    pub(crate) event: crate::agent_runtime::AgentEvent,
}

fn agent_event_schema_version() -> u16 {
    2
}

fn terminal_reason_from_error(error: &str) -> &'static str {
    if error.contains("time limit") {
        "timeBudgetExceeded"
    } else if error.contains("token budget") {
        "tokenBudgetExceeded"
    } else if error.contains("tool-call limit") {
        "toolCallBudgetExceeded"
    } else if error.contains("repeated") && error.contains("same input") {
        "repeatedToolCall"
    } else {
        "runtimeError"
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatAgentProposal {
    pub(crate) id: String,
    pub(crate) run_id: String,
    pub(crate) conversation_id: String,
    pub(crate) assistant_message_id: String,
    pub(crate) kind: String,
    pub(crate) note_id: Option<String>,
    pub(crate) suggested_path: Option<String>,
    pub(crate) title: String,
    pub(crate) base_hash: Option<String>,
    pub(crate) payload: Value,
    pub(crate) preview: Value,
    pub(crate) status: String,
    pub(crate) created_at_millis: u64,
    pub(crate) updated_at_millis: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AgentProposalCommitIntent {
    pub(crate) proposal_id: String,
    pub(crate) target_path: PathBuf,
    pub(crate) intended_editor_content_hash: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatStreamEvent {
    request_id: String,
    conversation_id: String,
    message_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    conversation: Option<ChatConversationSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<ChatSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attempt: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatTitleUpdatedEvent {
    conversation_id: String,
    conversation: ChatConversationSummary,
}

#[derive(Clone)]
pub(crate) struct ChatService {
    inner: Arc<ChatServiceInner>,
}

pub(crate) struct ProjectionConflictConversion {
    pub(crate) title: String,
    pub(crate) markdown: String,
}

struct ChatServiceInner {
    db_path: PathBuf,
    notes_root: PathBuf,
    work: Arc<ChatWorkTracker>,
    permission_broker: crate::agent_permissions::AgentPermissionBroker,
    projection_sink: Arc<dyn ChatProjectionSink>,
    projection_publication: Mutex<()>,
}

#[derive(Default)]
struct ChatWorkState {
    accepting: bool,
    active: usize,
    cancellations: HashMap<String, CancellationToken>,
}

struct ChatWorkTracker {
    state: Mutex<ChatWorkState>,
    settled: Condvar,
}

struct ChatWorkLease {
    tracker: Arc<ChatWorkTracker>,
    id: String,
}

impl ChatWorkTracker {
    fn new() -> Self {
        Self {
            state: Mutex::new(ChatWorkState {
                accepting: true,
                ..Default::default()
            }),
            settled: Condvar::new(),
        }
    }

    fn admit(
        self: &Arc<Self>,
        id: String,
        cancellation: CancellationToken,
    ) -> Result<ChatWorkLease, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Chat work lock poisoned".to_string())?;
        if !state.accepting {
            return Err("Chat work is quiesced for restart".to_string());
        }
        state.active += 1;
        state.cancellations.insert(id.clone(), cancellation);
        Ok(ChatWorkLease {
            tracker: Arc::clone(self),
            id,
        })
    }

    fn cancel(&self, id: &str) -> Result<(), String> {
        self.state
            .lock()
            .map_err(|_| "Chat work lock poisoned".to_string())?
            .cancellations
            .get(id)
            .ok_or_else(|| "That chat request is no longer active".to_string())?
            .cancel();
        Ok(())
    }

    fn cancel_all(&self) {
        if let Ok(state) = self.state.lock() {
            for token in state.cancellations.values() {
                token.cancel();
            }
        }
    }

    fn quiesce_and_wait(&self) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Chat work lock poisoned".to_string())?;
        state.accepting = false;
        for token in state.cancellations.values() {
            token.cancel();
        }
        while state.active != 0 {
            state = self
                .settled
                .wait(state)
                .map_err(|_| "Chat work lock poisoned".to_string())?;
        }
        Ok(())
    }

    fn resume(&self) -> Result<(), String> {
        self.state
            .lock()
            .map_err(|_| "Chat work lock poisoned".to_string())?
            .accepting = true;
        Ok(())
    }
}

impl Drop for ChatWorkLease {
    fn drop(&mut self) {
        if let Ok(mut state) = self.tracker.state.lock() {
            state.cancellations.remove(&self.id);
            state.active = state.active.saturating_sub(1);
            if state.active == 0 {
                self.tracker.settled.notify_all();
            }
        }
    }
}

trait ChatProjectionSink: Send + Sync {
    /// Publish a projection and return whether its bytes changed.
    fn publish(&self, path: &Path, markdown: &str) -> Result<bool, String>;
}

struct FilesystemChatProjectionSink {
    app_handle: Option<AppHandle>,
}

impl ChatProjectionSink for FilesystemChatProjectionSink {
    fn publish(&self, path: &Path, markdown: &str) -> Result<bool, String> {
        if fs::read_to_string(path).ok().as_deref() == Some(markdown) {
            return Ok(false);
        }

        let expected_write = self
            .app_handle
            .is_some()
            .then(|| crate::vault_watcher::record_expected_write(path, markdown));
        fs::write(path, markdown).map_err(|error| error.to_string())?;
        if let Some(expected_write) = expected_write {
            expected_write.commit();
        }

        if let Some(app_handle) = self.app_handle.as_ref() {
            if let Some(state) = app_handle.try_state::<crate::index::AppState>() {
                let modified_millis = now_millis();
                let note = crate::index::build_indexed_note(path, markdown, modified_millis);
                if let Err(error) = state.upsert_managed_chat_projection(path.to_path_buf(), note) {
                    eprintln!(
                        "chat projection derived-index update failed for {}: {error}",
                        path.display()
                    );
                    // The authoritative chat write succeeded. Leave an
                    // explicit derived-index retry for the next interactive
                    // catalog pass rather than failing the chat operation.
                    let _ = state.mark_notes_index_dirty(path, "chat-projection-retry");
                }
            }
        }
        Ok(true)
    }
}

impl ChatService {
    #[cfg(test)]
    pub(crate) fn new(notes_root: PathBuf, vault_data_dir: PathBuf) -> Result<Self, String> {
        Self::new_with_sink(notes_root, vault_data_dir, None)
    }

    pub(crate) fn new_managed(
        notes_root: PathBuf,
        vault_data_dir: PathBuf,
        app_handle: AppHandle,
    ) -> Result<Self, String> {
        Self::new_with_sink(notes_root, vault_data_dir, Some(app_handle))
    }

    fn new_with_sink(
        notes_root: PathBuf,
        vault_data_dir: PathBuf,
        app_handle: Option<AppHandle>,
    ) -> Result<Self, String> {
        let service = Self {
            inner: Arc::new(ChatServiceInner {
                db_path: vault_data_dir.join("ai.sqlite3"),
                notes_root,
                work: Arc::new(ChatWorkTracker::new()),
                permission_broker: crate::agent_permissions::AgentPermissionBroker::default(),
                projection_sink: Arc::new(FilesystemChatProjectionSink { app_handle }),
                projection_publication: Mutex::new(()),
            }),
        };
        service.initialize()?;
        Ok(service)
    }

    pub(crate) fn get_settings(&self) -> Result<ChatSettings, String> {
        self.connection()?
            .query_row(
                "SELECT provider, model, openai_model, local_model, local_base_url,
                        reasoning_effort, service_tier, default_access, atlas_visibility, web_access
                 FROM chat_settings WHERE id = 1",
                [],
                |row| {
                    Ok(ChatSettings {
                        provider: row.get(0)?,
                        model: row.get(1)?,
                        openai_model: row.get(2)?,
                        local_model: row.get(3)?,
                        local_base_url: row.get(4)?,
                        reasoning_effort: row.get(5)?,
                        service_tier: ChatServiceTier::parse(&row.get::<_, String>(6)?),
                        default_access: VaultAccess::parse(&row.get::<_, String>(7)?),
                        atlas_visibility: row.get(8)?,
                        web_access: WebAccess::parse(&row.get::<_, String>(9)?),
                    })
                },
            )
            .map_err(|error| error.to_string())
    }

    pub(crate) fn set_defaults(&self, settings: ChatDefaults) -> Result<ChatSettings, String> {
        let model = settings.model.trim();
        if model.is_empty() {
            return Err("A model is required".to_string());
        }
        if settings.provider != "openai" && settings.provider != "local" {
            return Err("Provider must be openai or local".to_string());
        }
        let reasoning_effort = validate_reasoning_effort(&settings.reasoning_effort)?;
        crate::agent_runtime::validate_local_base_url(&settings.local_base_url)?;
        self.connection()?
            .execute(
                "UPDATE chat_settings
                 SET provider = ?1, model = ?2, openai_model = ?3, local_model = ?4,
                     local_base_url = ?5, reasoning_effort = ?6, service_tier = ?7,
                     default_access = ?8, web_access = ?9
                 WHERE id = 1",
                params![
                    settings.provider,
                    model,
                    settings.openai_model.trim(),
                    settings.local_model.trim(),
                    settings.local_base_url.trim(),
                    reasoning_effort,
                    settings.service_tier.as_str(),
                    settings.default_access.as_str(),
                    settings.web_access.as_str()
                ],
            )
            .map_err(|error| error.to_string())?;
        self.get_settings()
    }

    pub(crate) fn set_atlas_visibility(&self, visibility: &str) -> Result<(), String> {
        if !matches!(visibility, "hidden" | "remembered" | "all") {
            return Err("Atlas visibility must be hidden, remembered, or all".to_string());
        }
        self.connection()?
            .execute(
                "UPDATE chat_settings SET atlas_visibility = ?1 WHERE id = 1",
                [visibility],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) fn local_model_capabilities(
        &self,
        model: &str,
    ) -> Result<LocalModelCapabilitySelection, String> {
        let model = model.trim();
        if model.is_empty() {
            return Ok(LocalModelCapabilitySelection::default());
        }
        self.connection()?
            .query_row(
                "SELECT images, tools, audio, video, reasoning_effort
                 FROM chat_local_model_capabilities WHERE model = ?1",
                [model],
                |row| {
                    Ok(LocalModelCapabilitySelection {
                        images: row.get::<_, i64>(0)? != 0,
                        tools: row.get::<_, i64>(1)? != 0,
                        audio: row.get::<_, i64>(2)? != 0,
                        video: row.get::<_, i64>(3)? != 0,
                        reasoning_effort: row.get(4)?,
                    })
                },
            )
            .optional()
            .map(|selection| selection.unwrap_or_default())
            .map_err(|error| error.to_string())
    }

    pub(crate) fn set_local_model_capabilities(
        &self,
        model: &str,
        mut capabilities: LocalModelCapabilitySelection,
    ) -> Result<LocalModelCapabilitySelection, String> {
        let model = model.trim();
        if model.is_empty() {
            return Err("A local model is required".to_string());
        }
        capabilities.reasoning_effort =
            validate_reasoning_effort(&capabilities.reasoning_effort)?.to_string();
        self.connection()?
            .execute(
                "INSERT INTO chat_local_model_capabilities
                   (model, images, tools, audio, video, reasoning_effort, updated_at_millis)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(model) DO UPDATE SET
                   images = excluded.images,
                   tools = excluded.tools,
                   audio = excluded.audio,
                   video = excluded.video,
                   reasoning_effort = excluded.reasoning_effort,
                   updated_at_millis = excluded.updated_at_millis",
                params![
                    model,
                    capabilities.images,
                    capabilities.tools,
                    capabilities.audio,
                    capabilities.video,
                    capabilities.reasoning_effort,
                    to_i64(now_millis())?
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(capabilities)
    }

    /// Unsent composer text for a slot. A slot is either a conversation or a
    /// pane that has not created its conversation yet.
    pub(crate) fn get_composer_draft(&self, slot: &str) -> Result<String, String> {
        let slot = normalize_composer_draft_slot(slot)?;
        self.connection()?
            .query_row(
                "SELECT body FROM chat_composer_drafts WHERE slot = ?1",
                [&slot],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map(|body| body.unwrap_or_default())
            .map_err(|error| error.to_string())
    }

    pub(crate) fn set_composer_draft(&self, slot: &str, body: &str) -> Result<(), String> {
        let slot = normalize_composer_draft_slot(slot)?;
        let connection = self.connection()?;

        // An empty draft is an absence, not a value worth keeping around.
        if body.is_empty() {
            connection
                .execute("DELETE FROM chat_composer_drafts WHERE slot = ?1", [&slot])
                .map(|_| ())
                .map_err(|error| error.to_string())
        } else {
            connection
                .execute(
                    "INSERT INTO chat_composer_drafts (slot, body, updated_at_millis)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(slot) DO UPDATE SET body = excluded.body,
                       updated_at_millis = excluded.updated_at_millis",
                    params![slot, body, to_i64(now_millis())?],
                )
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn create_conversation(
        &self,
        title: Option<String>,
        access: Option<VaultAccess>,
    ) -> Result<ChatConversation, String> {
        self.create_conversation_with_config(title, access, None, None, None)
    }

    pub(crate) fn create_conversation_with_config(
        &self,
        title: Option<String>,
        access: Option<VaultAccess>,
        provider: Option<String>,
        model: Option<String>,
        reasoning_effort: Option<String>,
    ) -> Result<ChatConversation, String> {
        let settings = self.get_settings()?;
        let provider = provider
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| settings.provider.clone());
        if !matches!(provider.as_str(), "openai" | "local") {
            return Err("Provider must be openai or local".to_string());
        }
        let model = model
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                if provider == settings.provider {
                    settings.model.clone()
                } else if provider == "local" {
                    settings.local_model.clone()
                } else {
                    settings.openai_model.clone()
                }
            });
        if model.is_empty() {
            return Err("A model is required".to_string());
        }
        let local_reasoning_effort = (provider == "local")
            .then(|| self.local_model_capabilities(&model))
            .transpose()?
            .map(|configuration| configuration.reasoning_effort);
        let reasoning_effort = reasoning_effort
            .as_deref()
            .map(validate_reasoning_effort)
            .transpose()?
            .or(local_reasoning_effort.as_deref())
            .unwrap_or(settings.reasoning_effort.as_str());
        let now = now_millis();
        let id = generate_id("chat");
        let title = title
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_CONVERSATION_TITLE.to_string());
        let access = access.unwrap_or(settings.default_access);
        self.connection()?
            .execute(
                "INSERT INTO chat_conversations
                 (id, title, mode, access, provider, model, reasoning_effort,
                  created_at_millis, updated_at_millis)
                 VALUES (?1, ?2, 'auto', ?3, ?4, ?5, ?7, ?6, ?6)",
                params![
                    id,
                    title,
                    access.as_str(),
                    provider,
                    model,
                    to_i64(now)?,
                    reasoning_effort
                ],
            )
            .map_err(|error| error.to_string())?;
        self.write_projection(&id, true)?;
        self.get_conversation(&id)
    }

    /// Creates a durable transcript branch ending at a completed assistant
    /// message. Branching copies user-visible history and source/attachment
    /// evidence; future runs receive that history as normal conversation input.
    pub(crate) fn branch_from_message(&self, message_id: &str) -> Result<ChatConversation, String> {
        let connection = self.connection()?;
        let source_conversation_id: String = connection
            .query_row(
                "SELECT conversation_id FROM chat_messages WHERE id = ?1",
                [message_id],
                |row| row.get(0),
            )
            .map_err(|_| "Checkpoint message was not found".to_string())?;
        let source = self.get_conversation(&source_conversation_id)?;
        let checkpoint = source
            .messages
            .iter()
            .find(|message| message.id == message_id)
            .ok_or_else(|| "Checkpoint message was not found".to_string())?;
        if checkpoint.role != "assistant" || checkpoint.status != "complete" {
            return Err("Only completed assistant messages can become checkpoints".to_string());
        }
        let messages = source
            .messages
            .iter()
            .filter(|message| message.ordinal <= checkpoint.ordinal)
            .cloned()
            .collect::<Vec<_>>();
        drop(connection);

        let branch_id = generate_id("chat");
        let now = now_millis();
        let title = format!("{} (branch)", source.summary.title.trim());
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO chat_conversations
                 (id, title, mode, access, provider, model, reasoning_effort, created_at_millis,
                  updated_at_millis, current_part, branched_from_conversation_id,
                  branched_from_message_id)
                 VALUES (?1, ?2, 'auto', ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10)",
                params![
                    branch_id,
                    title,
                    source.summary.access.as_str(),
                    source.summary.provider,
                    source.summary.model,
                    source.summary.reasoning_effort,
                    to_i64(now)?,
                    checkpoint.part,
                    source_conversation_id,
                    message_id,
                ],
            )
            .map_err(|error| error.to_string())?;
        let mut copied_message_ids: HashMap<String, String> = HashMap::new();
        for message in messages {
            let copied_message_id = generate_id("msg");
            let is_assistant = message.role == "assistant";
            transaction
                .execute(
                    "INSERT INTO chat_messages
                     (id, conversation_id, ordinal, role, status, content, error,
                      part, created_at_millis, provider, model, has_revision_evidence, note_reference_ids_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    params![
                        copied_message_id,
                        branch_id,
                        message.ordinal,
                        message.role,
                        message.status,
                        message.content,
                        message.error,
                        message.part,
                        to_i64(message.created_at_millis)?,
                        (message.role == "assistant").then_some(source.summary.provider.as_str()),
                        (message.role == "assistant").then_some(source.summary.model.as_str()),
                        message.has_revision_evidence,
                        serde_json::to_string(&message.note_reference_ids).map_err(|e| e.to_string())?,
                    ],
                )
                .map_err(|error| error.to_string())?;
            for attachment in message.attachments {
                transaction
                    .execute(
                        "INSERT INTO chat_message_attachments
                         (id, message_id, kind, name, mime_type, size_bytes,
                          data_base64, created_at_millis)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                        params![
                            generate_id("attachment"),
                            copied_message_id,
                            attachment.kind,
                            attachment.name,
                            attachment.mime_type,
                            to_i64(attachment.size_bytes as u64)?,
                            attachment.data_base64,
                            to_i64(message.created_at_millis)?,
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            for source in message.sources {
                transaction
                    .execute(
                        "INSERT INTO chat_sources
                         (message_id, kind, note_id, note_path, title, excerpt, url, anchor, revision_json, passage_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                        params![
                            copied_message_id,
                            source.kind,
                            source.note_id,
                            source.note_path,
                            source.title,
                            source.excerpt,
                            source.url,
                            source.anchor,
                            source.revision.as_ref().map(serde_json::to_string).transpose().map_err(|e| e.to_string())?,
                            source.passage.as_ref().map(serde_json::to_string).transpose().map_err(|e| e.to_string())?,
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            let original_run: Option<(String, String, bool, Option<String>, Option<String>)> = transaction.query_row(
                "SELECT id, user_message_id, force_web_search, active_note_json, retry_of_message_id
                 FROM chat_agent_runs WHERE conversation_id=?1 AND assistant_message_id=?2
                 ORDER BY created_at_millis DESC LIMIT 1",
                params![source_conversation_id, message.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            ).optional().map_err(|e| e.to_string())?;
            if is_assistant && original_run.is_none() && !message.agent_events.is_empty() {
                return Err("Checkpoint assistant message has no durable run lineage".into());
            }
            if let Some((
                original_run_id,
                original_user_id,
                force_web_search,
                active_note_json,
                retry_of,
            )) = original_run.filter(|_| is_assistant)
            {
                let copied_user_id = copied_message_ids
                    .get(&original_user_id)
                    .filter(|_| {
                        source
                            .messages
                            .iter()
                            .any(|m| m.id == original_user_id && m.role == "user")
                    })
                    .ok_or_else(|| {
                        "Checkpoint assistant message has no original user message".to_string()
                    })?;
                let copied_retry_of = retry_of
                    .as_ref()
                    .map(|id| {
                        copied_message_ids.get(id).cloned().ok_or_else(|| {
                            "Checkpoint retry has no original assistant message".to_string()
                        })
                    })
                    .transpose()?;
                let copied_run_id = generate_id("run");
                transaction
                    .execute(
                        "INSERT INTO chat_agent_runs
                         (id, conversation_id, user_message_id, assistant_message_id,
                          retry_of_message_id, provider, model, reasoning_effort, status,
                          input_tokens, output_tokens, created_at_millis, updated_at_millis,
                          force_web_search, active_note_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 0, ?10, ?10, ?11, ?12)",
                        params![
                            copied_run_id,
                            branch_id,
                            copied_user_id,
                            copied_message_id,
                            copied_retry_of,
                            source.summary.provider,
                            source.summary.model,
                            source.summary.reasoning_effort,
                            if message.status == "complete" {
                                "completed"
                            } else {
                                message.status.as_str()
                            },
                            to_i64(message.created_at_millis)?,
                            force_web_search,
                            active_note_json,
                        ],
                    )
                    .map_err(|error| error.to_string())?;
                transaction.execute("INSERT INTO chat_agent_run_context (run_id, ordinal, note_id, note_path, title, section_label, excerpt, content_hash, reason, start_line, end_line, block_anchor) SELECT ?1, ordinal, note_id, note_path, title, section_label, excerpt, content_hash, reason, start_line, end_line, block_anchor FROM chat_agent_run_context WHERE run_id=?2", params![copied_run_id,original_run_id]).map_err(|e| e.to_string())?;
                for envelope in message.agent_events {
                    let event_json = serde_json::to_string(&envelope.event)
                        .map_err(|error| error.to_string())?;
                    transaction
                        .execute(
                            "INSERT INTO chat_agent_events
                             (run_id, sequence, request_id, conversation_id,
                              message_id, event_json, created_at_millis)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                            params![
                                copied_run_id,
                                to_i64(envelope.sequence)?,
                                envelope.request_id,
                                branch_id,
                                copied_message_id,
                                event_json,
                                to_i64(envelope.created_at_millis)?,
                            ],
                        )
                        .map_err(|error| error.to_string())?;
                }
            }
            copied_message_ids.insert(message.id.clone(), copied_message_id);
        }
        transaction.commit().map_err(|error| error.to_string())?;
        self.write_projection(&branch_id, true)?;
        self.get_conversation(&branch_id)
    }

    pub(crate) fn list_conversations(&self) -> Result<Vec<ChatConversationSummary>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT c.id, c.title, c.access, c.status,
                        c.created_at_millis, c.updated_at_millis, c.detached,
                        COUNT(m.id), c.provider, c.model, c.reasoning_effort
                 FROM chat_conversations c
                 LEFT JOIN chat_messages m ON m.conversation_id = c.id
                 GROUP BY c.id
                 ORDER BY c.updated_at_millis DESC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], summary_from_row)
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn get_conversation(&self, id: &str) -> Result<ChatConversation, String> {
        let connection = self.connection()?;
        let summary = connection
            .query_row(
                "SELECT c.id, c.title, c.access, c.status,
                        c.created_at_millis, c.updated_at_millis, c.detached,
                        COUNT(m.id), c.provider, c.model, c.reasoning_effort
                 FROM chat_conversations c
                 LEFT JOIN chat_messages m ON m.conversation_id = c.id
                 WHERE c.id = ?1 GROUP BY c.id",
                [id],
                summary_from_row,
            )
            .map_err(|error| error.to_string())?;
        let messages = load_messages(&connection, id)?;
        let excerpts = load_excerpts(&connection, id)?;
        let projection_path = conversation_directory(&self.inner.notes_root, &summary)
            .join("Conversation.md")
            .to_string_lossy()
            .into_owned();
        Ok(ChatConversation {
            summary,
            messages,
            excerpts,
            projection_path,
        })
    }

    pub(crate) fn rename_conversation(
        &self,
        id: &str,
        title: &str,
    ) -> Result<ChatConversation, String> {
        let title = title.trim();
        if title.is_empty() {
            return Err("A conversation title is required".to_string());
        }
        self.connection()?
            .execute(
                "UPDATE chat_conversations SET title = ?2, updated_at_millis = ?3 WHERE id = ?1",
                params![id, title, to_i64(now_millis())?],
            )
            .map_err(|error| error.to_string())?;
        self.write_projection(id, false)?;
        self.get_conversation(id)
    }

    pub(crate) fn forgotten_folder_snapshot(
        &self,
        id: &str,
    ) -> Result<ChatForgottenFolderSnapshot, String> {
        let conversation = self.get_conversation(id)?;
        Ok(ChatForgottenFolderSnapshot {
            original_path: conversation_directory(&self.inner.notes_root, &conversation.summary),
            title: conversation.summary.title,
            archived: conversation.summary.status == "archived",
        })
    }

    pub(crate) fn archive_conversation_folder(
        &self,
        id: &str,
        forgotten_directory: &Path,
    ) -> Result<ChatProjectionRelocation, String> {
        if self.mark_projection_detached_if_needed(id)? {
            return Err(
                "Chat transcript was edited outside Gneauxghts; resolve that edit before forgetting it"
                    .to_string(),
            );
        }
        let snapshot = self.forgotten_folder_snapshot(id)?;
        if snapshot.archived {
            return Ok(ChatProjectionRelocation {
                previous_paths: Vec::new(),
                current_paths: Vec::new(),
            });
        }
        self.relocate_conversation_folder(
            id,
            &snapshot.original_path,
            forgotten_directory,
            "archived",
        )
    }

    pub(crate) fn restore_conversation_folder(
        &self,
        id: &str,
        forgotten_directory: &Path,
        original_directory: &Path,
    ) -> Result<ChatProjectionRelocation, String> {
        self.relocate_conversation_folder(id, forgotten_directory, original_directory, "active")
    }

    pub(crate) fn delete_archived_conversation(&self, id: &str) -> Result<(), String> {
        delete_archived_conversation_from_database(&self.inner.db_path, id)
    }

    pub(crate) fn delete_persisted_conversation(
        vault_data_dir: &Path,
        id: &str,
    ) -> Result<(), String> {
        let database_path = vault_data_dir.join("ai.sqlite3");
        if !database_path.is_file() {
            return Ok(());
        }
        delete_archived_conversation_from_database(&database_path, id)
    }

    fn relocate_conversation_folder(
        &self,
        id: &str,
        source_directory: &Path,
        target_directory: &Path,
        status: &str,
    ) -> Result<ChatProjectionRelocation, String> {
        if !source_directory.is_dir() {
            return Err(format!(
                "Chat transcript folder is missing: {}",
                source_directory.display()
            ));
        }
        if target_directory.exists() {
            return Err(format!(
                "Chat transcript restore location already exists: {}",
                target_directory.display()
            ));
        }
        let target_parent = target_directory
            .parent()
            .ok_or_else(|| "Chat transcript target has no parent directory".to_string())?;
        fs::create_dir_all(target_parent).map_err(|error| error.to_string())?;

        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT path FROM chat_projection_files WHERE conversation_id = ?1")
            .map_err(|error| error.to_string())?;
        let previous_paths = statement
            .query_map([id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(PathBuf::from)
            .collect::<Vec<_>>();
        drop(statement);
        let current_paths = previous_paths
            .iter()
            .map(|path| {
                let relative = path.strip_prefix(source_directory).map_err(|_| {
                    format!(
                        "Chat projection is outside its transcript folder: {}",
                        path.display()
                    )
                })?;
                Ok(target_directory.join(relative))
            })
            .collect::<Result<Vec<_>, String>>()?;

        let mut expected_moves = Vec::with_capacity(previous_paths.len());
        for (previous, current) in previous_paths.iter().zip(&current_paths) {
            let markdown = fs::read_to_string(previous).map_err(|error| error.to_string())?;
            expected_moves.push(crate::vault_watcher::record_expected_move(
                previous, current, &markdown,
            ));
        }
        fs::rename(source_directory, target_directory).map_err(|error| error.to_string())?;
        for expected_move in expected_moves {
            expected_move.commit();
        }

        let database_result = (|| -> Result<(), String> {
            let mut connection = self.connection()?;
            let transaction = connection
                .transaction()
                .map_err(|error| error.to_string())?;
            for (previous, current) in previous_paths.iter().zip(&current_paths) {
                transaction
                    .execute(
                        "UPDATE chat_projection_files
                         SET path = ?3
                         WHERE conversation_id = ?1 AND path = ?2",
                        params![
                            id,
                            previous.to_string_lossy().as_ref(),
                            current.to_string_lossy().as_ref()
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            transaction
                .execute(
                    "UPDATE chat_conversations
                     SET status = ?2, detached = 0, updated_at_millis = ?3
                     WHERE id = ?1",
                    params![id, status, to_i64(now_millis())?],
                )
                .map_err(|error| error.to_string())?;
            transaction.commit().map_err(|error| error.to_string())
        })();
        if let Err(error) = database_result {
            let _ = fs::rename(target_directory, source_directory);
            return Err(error);
        }

        Ok(ChatProjectionRelocation {
            previous_paths,
            current_paths,
        })
    }

    pub(crate) fn update_conversation_policy(
        &self,
        id: &str,
        access: VaultAccess,
    ) -> Result<ChatConversation, String> {
        self.connection()?
            .execute(
                "UPDATE chat_conversations SET access = ?2, updated_at_millis = ?3 WHERE id = ?1",
                params![id, access.as_str(), to_i64(now_millis())?],
            )
            .map_err(|error| error.to_string())?;
        self.cancel_active_requests();
        self.get_conversation(id)
    }

    pub(crate) fn update_conversation_provider(
        &self,
        id: &str,
        provider: &str,
        model: &str,
        reasoning_effort: &str,
    ) -> Result<ChatConversation, String> {
        let provider = provider.trim();
        let model = model.trim();
        if !matches!(provider, "openai" | "local") {
            return Err("Provider must be openai or local".to_string());
        }
        if model.is_empty() {
            return Err("A model is required".to_string());
        }
        let reasoning_effort = validate_reasoning_effort(reasoning_effort)?;
        let connection = self.connection()?;
        let has_running_run = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM chat_agent_runs
                   WHERE conversation_id = ?1 AND status = 'running'
                 )",
                [id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| error.to_string())?;
        if has_running_run {
            return Err(
                "Wait for the current response to finish before changing chat configuration."
                    .to_string(),
            );
        }
        connection
            .execute(
                "UPDATE chat_conversations
                 SET provider = ?2, model = ?3, updated_at_millis = ?4
                     , reasoning_effort = ?5
                 WHERE id = ?1",
                params![id, provider, model, to_i64(now_millis())?, reasoning_effort],
            )
            .map_err(|error| error.to_string())?;
        self.get_conversation(id)
    }

    pub(crate) fn begin_request(
        &self,
        request: ChatRequest,
        app: AppHandle,
    ) -> Result<ChatRequestAccepted, String> {
        let request_id = generate_id("req");
        let cancelled = CancellationToken::new();
        let work = self
            .inner
            .work
            .admit(request_id.clone(), cancelled.clone())?;
        let admission::ChatAdmission {
            accepted,
            run_id,
            force_web_search,
            active_note,
            selected_context,
            date_time_context,
            provider,
        } = self.admit_request(request, request_id.clone())?;
        let automatic_title_fallback = accepted
            .automatic_title_fallback
            .clone()
            .filter(|_| supports_background_title_refinement(&provider));
        let run = ActiveChatRun {
            app,
            request_id,
            conversation_id: accepted.conversation_id.clone(),
            user_message_id: accepted.user_message_id.clone(),
            assistant_message_id: accepted.assistant_message_id.clone(),
            run_id,
            force_web_search,
            active_note,
            selected_context,
            date_time_context,
            cancelled,
            automatic_title_fallback,
            _work: work,
        };
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            service.run_request(run).await;
        });
        Ok(accepted)
    }

    fn append_agent_event(&self, envelope: &ChatAgentEventEnvelope) -> Result<(), String> {
        let event_json =
            serde_json::to_string(&envelope.event).map_err(|error| error.to_string())?;
        self.connection()?
            .execute(
                "INSERT OR IGNORE INTO chat_agent_events
                 (run_id, sequence, request_id, conversation_id, message_id, event_json, created_at_millis)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    envelope.run_id,
                    to_i64(envelope.sequence)?,
                    envelope.request_id,
                    envelope.conversation_id,
                    envelope.message_id,
                    event_json,
                    to_i64(envelope.created_at_millis)?,
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) fn mark_current_history_use(
        &self,
        message_id: &str,
        run_id: &str,
    ) -> Result<(), String> {
        let changed = self.connection()?.execute(
            "UPDATE chat_messages SET has_revision_evidence = 1 WHERE id = ?1 AND EXISTS
             (SELECT 1 FROM chat_agent_runs r WHERE r.id = ?2 AND r.assistant_message_id = chat_messages.id)",
            params![message_id, run_id],
        ).map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("The current chat run is unavailable".into());
        }
        Ok(())
    }

    #[cfg(test)]
    fn finish_message(
        &self,
        message_id: &str,
        status: &str,
        content: &str,
        error: Option<&str>,
        sources: &[ChatSource],
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        Self::store_terminal_message(&transaction, message_id, status, content, error, sources, &[])?;
        transaction.commit().map_err(|e| e.to_string())
    }

    pub(crate) fn cancel_request(&self, request_id: &str) -> Result<(), String> {
        self.inner.work.cancel(request_id)
    }

    pub(crate) fn decide_agent_permission(
        &self,
        command: crate::agent_permissions::AgentPermissionDecisionCommand,
    ) -> Result<crate::agent_permissions::AgentPermissionResolution, String> {
        self.inner.permission_broker.decide(command)
    }

    fn cancel_active_requests(&self) {
        self.inner.work.cancel_all();
    }

    pub(crate) fn quiesce_for_restart(&self) -> Result<(), String> {
        self.inner.permission_broker.cancel_all();
        self.inner.work.quiesce_and_wait()
    }

    pub(crate) fn resume_after_failed_restart(&self) -> Result<(), String> {
        self.inner.work.resume()
    }

    pub(crate) fn create_excerpt(
        &self,
        conversation_id: &str,
        message_id: &str,
        start_offset: usize,
        end_offset: usize,
    ) -> Result<ChatExcerpt, String> {
        let connection = self.connection()?;
        let content: String = connection
            .query_row(
                "SELECT content FROM chat_messages WHERE id = ?1 AND conversation_id = ?2",
                params![message_id, conversation_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if start_offset >= end_offset
            || end_offset > content.len()
            || !content.is_char_boundary(start_offset)
            || !content.is_char_boundary(end_offset)
        {
            return Err("Select a valid non-empty passage".to_string());
        }
        let quote = content[start_offset..end_offset].to_string();
        self.insert_excerpt(
            conversation_id,
            message_id,
            start_offset,
            end_offset,
            &quote,
        )
    }

    pub(crate) fn create_excerpt_from_selection(
        &self,
        conversation_id: &str,
        message_id: &str,
        selected_text: &str,
        suggested_range: Option<(usize, usize)>,
    ) -> Result<ChatExcerpt, String> {
        let quote = selected_text.trim();
        if quote.is_empty() {
            return Err("Select a valid non-empty passage".to_string());
        }
        let connection = self.connection()?;
        let content: String = connection
            .query_row(
                "SELECT content FROM chat_messages WHERE id = ?1 AND conversation_id = ?2",
                params![message_id, conversation_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;

        let exact_range = suggested_range
            .filter(|(start, end)| {
                *start < *end
                    && *end <= content.len()
                    && content.is_char_boundary(*start)
                    && content.is_char_boundary(*end)
                    && &content[*start..*end] == quote
            })
            .or_else(|| {
                content
                    .find(quote)
                    .map(|start| (start, start + quote.len()))
            });

        let (start_offset, end_offset) = if let Some(range) = exact_range {
            range
        } else {
            let content_tokens = excerpt_match_tokens(&content);
            let quote_tokens = excerpt_match_tokens(quote);
            if quote_tokens.is_empty()
                || !tokens_are_ordered_subsequence(&quote_tokens, &content_tokens)
            {
                return Err("The selected passage does not belong to this message".to_string());
            }
            // Rendered Markdown does not always have a one-to-one byte range in
            // the source. The immutable quote and message ID remain authoritative.
            (0, 0)
        };
        self.insert_excerpt(conversation_id, message_id, start_offset, end_offset, quote)
    }

    fn insert_excerpt(
        &self,
        conversation_id: &str,
        message_id: &str,
        start_offset: usize,
        end_offset: usize,
        quote: &str,
    ) -> Result<ChatExcerpt, String> {
        let connection = self.connection()?;
        let id = generate_id("excerpt");
        let anchor = format!("excerpt_{id}");
        connection
            .execute(
                "INSERT INTO chat_excerpts
                 (id, conversation_id, message_id, start_offset, end_offset, quote, anchor, created_at_millis)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, conversation_id, message_id, to_i64(start_offset as u64)?, to_i64(end_offset as u64)?, quote, anchor, to_i64(now_millis())?],
            )
            .map_err(|error| error.to_string())?;
        self.write_projection(conversation_id, false)?;
        self.get_excerpt(&id)
    }

    pub(crate) fn set_excerpt_remembered(
        &self,
        id: &str,
        remembered: bool,
    ) -> Result<ChatExcerpt, String> {
        let connection = self.connection()?;
        let conversation_id: String = connection
            .query_row(
                "SELECT conversation_id FROM chat_excerpts WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "UPDATE chat_excerpts SET remembered = ?2 WHERE id = ?1",
                params![id, if remembered { 1 } else { 0 }],
            )
            .map_err(|error| error.to_string())?;
        self.write_projection(&conversation_id, false)?;
        self.get_excerpt(id)
    }

    fn get_excerpt(&self, id: &str) -> Result<ChatExcerpt, String> {
        self.connection()?
            .query_row(
                "SELECT id, conversation_id, message_id, start_offset, end_offset, quote, anchor, remembered
                 FROM chat_excerpts WHERE id = ?1",
                [id],
                excerpt_from_row,
            )
            .map_err(|error| error.to_string())
    }

    pub(crate) fn grant_note(&self, note_id: &str, title: &str) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO chat_limited_grants (note_id, title, granted_at_millis)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(note_id) DO UPDATE SET title = excluded.title",
                params![note_id, title, to_i64(now_millis())?],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO chat_note_policies (note_id, disposition, title, updated_at_millis)
                 VALUES (?1, 'approved', ?2, ?3)
                 ON CONFLICT(note_id) DO UPDATE SET disposition = 'approved',
                   title = excluded.title, updated_at_millis = excluded.updated_at_millis",
                params![note_id, title, to_i64(now_millis())?],
            )
            .map_err(|error| error.to_string())?;
        self.cancel_active_requests();
        Ok(())
    }

    pub(crate) fn revoke_note(&self, note_id: &str) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute(
                "DELETE FROM chat_limited_grants WHERE note_id = ?1",
                [note_id],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "DELETE FROM chat_note_policies
                 WHERE note_id = ?1 AND disposition = 'approved'",
                [note_id],
            )
            .map_err(|error| error.to_string())?;
        self.cancel_active_requests();
        Ok(())
    }

    pub(crate) fn granted_note_ids(&self) -> Result<HashSet<String>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT note_id FROM chat_note_policies WHERE disposition = 'approved'")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<HashSet<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn list_grants(&self) -> Result<Vec<ChatGrant>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT note_id, title, updated_at_millis
                 FROM chat_note_policies WHERE disposition = 'approved' ORDER BY title",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(ChatGrant {
                    note_id: row.get(0)?,
                    note_path: None,
                    title: row.get(1)?,
                    granted_at_millis: row.get::<_, i64>(2)?.max(0) as u64,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn list_note_policies(&self) -> Result<Vec<ChatNotePolicy>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT note_id, title, disposition, updated_at_millis
                 FROM chat_note_policies ORDER BY disposition, title",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(ChatNotePolicy {
                    note_id: row.get(0)?,
                    note_path: None,
                    title: row.get(1)?,
                    disposition: row.get(2)?,
                    updated_at_millis: row.get::<_, i64>(3)?.max(0) as u64,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn set_note_excluded(
        &self,
        note_id: &str,
        title: &str,
        excluded: bool,
    ) -> Result<(), String> {
        let connection = self.connection()?;
        if excluded {
            connection
                .execute(
                    "INSERT INTO chat_note_policies
                     (note_id, disposition, title, updated_at_millis)
                     VALUES (?1, 'excluded', ?2, ?3)
                     ON CONFLICT(note_id) DO UPDATE SET disposition = 'excluded',
                       title = excluded.title, updated_at_millis = excluded.updated_at_millis",
                    params![note_id, title, to_i64(now_millis())?],
                )
                .map_err(|error| error.to_string())?;
            connection
                .execute(
                    "DELETE FROM chat_limited_grants WHERE note_id = ?1",
                    [note_id],
                )
                .map_err(|error| error.to_string())?;
        } else {
            connection
                .execute(
                    "DELETE FROM chat_note_policies
                     WHERE note_id = ?1 AND disposition = 'excluded'",
                    [note_id],
                )
                .map_err(|error| error.to_string())?;
        }
        // A policy change invalidates any in-flight tool view.
        self.cancel_active_requests();
        Ok(())
    }

    pub(crate) fn excluded_note_ids(&self) -> Result<HashSet<String>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT note_id FROM chat_note_policies WHERE disposition = 'excluded'")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<HashSet<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn note_is_allowed(
        &self,
        access: &VaultAccess,
        note_id: &str,
    ) -> Result<bool, String> {
        if self.excluded_note_ids()?.contains(note_id) {
            return Ok(false);
        }
        match access {
            VaultAccess::None => Ok(false),
            VaultAccess::Full => Ok(true),
            VaultAccess::Approved => Ok(self.granted_note_ids()?.contains(note_id)),
        }
    }

    pub(crate) fn notes_root(&self) -> &Path {
        &self.inner.notes_root
    }

    pub(crate) fn source_run_grants(&self, message_id: &str) -> Result<HashSet<String>, String> {
        let connection = self.connection()?;
        let mut query = connection.prepare("SELECT DISTINCT c.note_id FROM chat_agent_run_context c JOIN chat_agent_runs r ON r.id = c.run_id WHERE r.assistant_message_id = ?1").map_err(|e| e.to_string())?;
        let result = query
            .query_map([message_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(|e| e.to_string());
        result
    }

    /// Retry lineage follows the durable run, even when newer turns precede
    /// an appended retry in transcript order. Missing legacy context remains
    /// an error: transcript proximity cannot reconstruct an authoritative pair.
    pub(crate) fn retry_user_message_id(
        &self,
        conversation_id: &str,
        assistant_message_id: &str,
    ) -> Result<String, String> {
        Ok(self
            .retry_run_context(conversation_id, assistant_message_id)?
            .user_message_id)
    }

    fn retry_run_context(
        &self,
        conversation_id: &str,
        assistant_message_id: &str,
    ) -> Result<RetryRunContext, String> {
        let connection = self.connection()?;
        let (run_id, force_web_search, active_note_json, user_message_id) = connection
            .query_row(
                "SELECT id, force_web_search, active_note_json, user_message_id
                 FROM chat_agent_runs
                 WHERE conversation_id = ?1 AND assistant_message_id = ?2
                 ORDER BY created_at_millis DESC LIMIT 1",
                params![conversation_id, assistant_message_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)? != 0,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .map_err(|_| "The original agent run context is missing".to_string())?;
        let active_note = active_note_json
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|error| format!("Stored retry context is invalid: {error}"))?;
        let selected_context = load_agent_run_context(&connection, &run_id)?;
        Ok(RetryRunContext {
            user_message_id,
            force_web_search,
            active_note,
            selected_context,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn stage_agent_proposal(
        &self,
        run_id: &str,
        conversation_id: &str,
        assistant_message_id: &str,
        kind: &str,
        note_id: Option<&str>,
        suggested_path: Option<&str>,
        title: &str,
        base_hash: Option<&str>,
        payload: &Value,
        preview: &Value,
    ) -> Result<ChatAgentProposal, String> {
        let target = note_id.or(suggested_path).ok_or_else(|| {
            "A proposal must identify an existing note or suggested path".to_string()
        })?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let existing: Option<String> = transaction
            .query_row(
                "SELECT id FROM chat_agent_proposals
                 WHERE status IN ('pending', 'conflict')
                   AND COALESCE(note_id, suggested_path) = ?1
                 ORDER BY created_at_millis DESC LIMIT 1",
                [target],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let id = generate_id("proposal");
        let now = to_i64(now_millis())?;
        transaction
            .execute(
                "INSERT INTO chat_agent_proposals
                 (id, run_id, conversation_id, assistant_message_id, kind, note_id,
                  suggested_path, title, base_hash, payload_json, preview_json,
                  status, created_at_millis, updated_at_millis)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                         'pending', ?12, ?12)",
                params![
                    id,
                    run_id,
                    conversation_id,
                    assistant_message_id,
                    kind,
                    note_id,
                    suggested_path,
                    title,
                    base_hash,
                    payload.to_string(),
                    preview.to_string(),
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
        if let Some(existing_id) = existing {
            transaction
                .execute(
                    "UPDATE chat_agent_proposals
                     SET status = 'superseded', superseded_by = ?2,
                         updated_at_millis = ?3
                     WHERE id = ?1",
                    params![existing_id, id, now],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        self.get_agent_proposal(&id)
    }

    pub(crate) fn pending_agent_proposal_for_note(
        &self,
        note_id: &str,
    ) -> Result<Option<ChatAgentProposal>, String> {
        self.connection()?
            .query_row(
                "SELECT id, run_id, conversation_id, assistant_message_id, kind,
                        note_id, suggested_path, title, base_hash, payload_json,
                        preview_json, status, created_at_millis, updated_at_millis
                 FROM chat_agent_proposals
                 WHERE note_id = ?1 AND kind = 'update'
                   AND status IN ('pending', 'conflict')
                 ORDER BY created_at_millis DESC LIMIT 1",
                [note_id],
                proposal_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn get_agent_proposal(&self, id: &str) -> Result<ChatAgentProposal, String> {
        self.connection()?
            .query_row(
                "SELECT id, run_id, conversation_id, assistant_message_id, kind,
                        note_id, suggested_path, title, base_hash, payload_json,
                        preview_json, status, created_at_millis, updated_at_millis
                 FROM chat_agent_proposals WHERE id = ?1",
                [id],
                proposal_from_row,
            )
            .map_err(|error| error.to_string())
    }

    pub(crate) fn list_pending_agent_proposals(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ChatAgentProposal>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT id, run_id, conversation_id, assistant_message_id, kind,
                        note_id, suggested_path, title, base_hash, payload_json,
                        preview_json, status, created_at_millis, updated_at_millis
                 FROM chat_agent_proposals
                 WHERE conversation_id = ?1 AND status IN ('pending', 'conflict')
                 ORDER BY created_at_millis",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([conversation_id], proposal_from_row)
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn resolve_agent_proposal(
        &self,
        proposal_id: &str,
        status: &str,
    ) -> Result<ChatAgentProposal, String> {
        if !matches!(status, "committed" | "dismissed" | "conflict") {
            return Err("Invalid proposal resolution".to_string());
        }
        self.connection()?
            .execute(
                "UPDATE chat_agent_proposals SET status = ?2, updated_at_millis = ?3
                 WHERE id = ?1 AND status IN ('pending', 'conflict')",
                params![proposal_id, status, to_i64(now_millis())?],
            )
            .map_err(|error| error.to_string())?;
        self.get_agent_proposal(proposal_id)
    }

    pub(crate) fn begin_agent_proposal_commit(
        &self,
        proposal_id: &str,
        target_path: &Path,
        intended_editor_content_hash: &str,
    ) -> Result<AgentProposalCommitIntent, String> {
        if intended_editor_content_hash.trim().is_empty() {
            return Err("A proposal commit intent requires a content hash".to_string());
        }
        let target_path = canonical_agent_commit_target(&self.inner.notes_root, target_path)?;
        let target = target_path.to_string_lossy().into_owned();
        let now = to_i64(now_millis())?;
        let connection = self.connection()?;
        let changed = connection
            .execute(
                "UPDATE chat_agent_proposals
                 SET status = 'committing', commit_target_path = ?2,
                     intended_editor_content_hash = ?3, updated_at_millis = ?4
                 WHERE id = ?1 AND status IN ('pending', 'conflict')",
                params![proposal_id, target, intended_editor_content_hash, now],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            let existing = connection
                .query_row(
                    "SELECT status, commit_target_path, intended_editor_content_hash
                     FROM chat_agent_proposals WHERE id = ?1",
                    [proposal_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                        ))
                    },
                )
                .optional()
                .map_err(|error| error.to_string())?;
            match existing {
                Some((status, existing_target, existing_hash))
                    if status == "committing"
                        && existing_target.as_deref() == Some(target.as_str())
                        && existing_hash.as_deref() == Some(intended_editor_content_hash) => {}
                Some((status, _, _)) => {
                    return Err(format!(
                        "Proposal cannot enter committing state from {status}"
                    ));
                }
                None => return Err("Proposal not found".to_string()),
            }
        }
        Ok(AgentProposalCommitIntent {
            proposal_id: proposal_id.to_string(),
            target_path,
            intended_editor_content_hash: intended_editor_content_hash.to_string(),
        })
    }

    pub(crate) fn finish_agent_proposal_commit(
        &self,
        proposal_id: &str,
        status: &str,
    ) -> Result<ChatAgentProposal, String> {
        if !matches!(status, "committed" | "conflict") {
            return Err("Invalid proposal commit resolution".to_string());
        }
        let connection = self.connection()?;
        let changed = connection
            .execute(
                "UPDATE chat_agent_proposals SET status = ?2, updated_at_millis = ?3
                 WHERE id = ?1 AND status = 'committing'",
                params![proposal_id, status, to_i64(now_millis())?],
            )
            .map_err(|error| error.to_string())?;
        let proposal = self.get_agent_proposal(proposal_id)?;
        if changed == 0 && proposal.status != status {
            return Err(format!(
                "Proposal commit cannot resolve as {status} from {}",
                proposal.status
            ));
        }
        Ok(proposal)
    }

    /// Resolve interrupted proposal commits from filesystem proof only. This
    /// never reapplies a proposal: exact editor-visible content at the recorded
    /// target proves commit, and every other state becomes a conflict.
    pub(crate) fn recover_agent_proposal_commits(&self) -> Result<usize, String> {
        let connection = self.connection()?;
        let intents = {
            let mut statement = connection
                .prepare(
                    "SELECT id, commit_target_path, intended_editor_content_hash
                     FROM chat_agent_proposals
                     WHERE status = 'committing'
                     ORDER BY created_at_millis, id",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };
        drop(connection);

        for (proposal_id, target_path, intended_hash) in &intents {
            self.recover_agent_proposal_commit_intent(
                proposal_id,
                target_path.as_deref(),
                intended_hash.as_deref(),
            )?;
        }
        Ok(intents.len())
    }

    /// Recover one known in-process failure without resolving unrelated
    /// commits that may still be between their durable intent and file write.
    pub(crate) fn recover_agent_proposal_commit(&self, proposal_id: &str) -> Result<bool, String> {
        let intent = self
            .connection()?
            .query_row(
                "SELECT commit_target_path, intended_editor_content_hash
                 FROM chat_agent_proposals
                 WHERE id = ?1 AND status = 'committing'",
                [proposal_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((target_path, intended_hash)) = intent else {
            return Ok(false);
        };
        self.recover_agent_proposal_commit_intent(
            proposal_id,
            target_path.as_deref(),
            intended_hash.as_deref(),
        )?;
        Ok(true)
    }

    fn recover_agent_proposal_commit_intent(
        &self,
        proposal_id: &str,
        target_path: Option<&str>,
        intended_hash: Option<&str>,
    ) -> Result<(), String> {
        let proved = target_path
            .zip(intended_hash)
            .is_some_and(|(target_path, intended_hash)| {
                self.proposal_commit_target_matches(target_path, intended_hash)
            });
        self.finish_agent_proposal_commit(
            proposal_id,
            if proved { "committed" } else { "conflict" },
        )?;
        Ok(())
    }

    fn proposal_commit_target_matches(&self, target_path: &str, intended_hash: &str) -> bool {
        let Ok(notes_root) = fs::canonicalize(&self.inner.notes_root) else {
            return false;
        };
        let Ok(target_path) = fs::canonicalize(target_path) else {
            return false;
        };
        if !is_valid_note_path(&target_path, &notes_root) || !target_path.is_file() {
            return false;
        }
        let Ok(markdown) = fs::read_to_string(&target_path) else {
            return false;
        };
        if crate::note::reject_chat_projection_write(&markdown).is_err() {
            return false;
        }
        editor_visible_content_hash(&target_path, &markdown) == intended_hash
    }

    fn refresh_continuation_summary(&self, conversation_id: &str) -> Result<(), String> {
        let connection = self.connection()?;
        let messages = load_messages(&connection, conversation_id)?;
        if messages.len() <= MAX_RECENT_MESSAGES {
            return Ok(());
        }
        let older = &messages[..messages.len() - MAX_RECENT_MESSAGES];
        let mut summary = "[Current-evidence context v1]\n".to_string();
        let mut transcript_hasher = Hasher::new();
        let mut complete_count = 0usize;
        let mut through_ordinal = 0i64;
        let mut summary_truncated = false;
        for message in older {
            if message.status != "complete" {
                continue;
            }
            transcript_hasher.update(message.role.as_bytes());
            transcript_hasher.update(&message.ordinal.to_le_bytes());
            transcript_hasher.update(message.content.as_bytes());
            complete_count += 1;
            through_ordinal = through_ordinal.max(message.ordinal);
            let line = format!(
                "{}: {}\n",
                message.role,
                compact_text(model_history_content(message), 600)
            );
            if summary.len() + line.len() <= 12_000 {
                summary.push_str(&line);
            } else {
                summary_truncated = true;
            }
        }
        if summary.is_empty() {
            return Ok(());
        }
        if summary_truncated {
            summary.push_str(
                "[Some earlier message detail was compacted to stay within the context budget.]\n",
            );
        }
        let now = to_i64(now_millis())?;
        let transcript_hash = transcript_hasher.finalize().to_hex().to_string();
        let estimated_tokens = (summary.chars().count().div_ceil(4)) as i64;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO chat_context_compactions
                 (conversation_id, through_ordinal, transcript_hash, summary,
                  message_count, estimated_tokens, created_at_millis, updated_at_millis)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                 ON CONFLICT(conversation_id) DO UPDATE SET
                   through_ordinal = excluded.through_ordinal,
                   transcript_hash = excluded.transcript_hash,
                   summary = excluded.summary,
                   message_count = excluded.message_count,
                   estimated_tokens = excluded.estimated_tokens,
                   updated_at_millis = excluded.updated_at_millis",
                params![
                    conversation_id,
                    through_ordinal,
                    transcript_hash,
                    summary,
                    complete_count as i64,
                    estimated_tokens,
                    now,
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE chat_conversations SET continuation_summary = ?2 WHERE id = ?1",
                params![conversation_id, summary],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(())
    }

    fn context_compaction(
        &self,
        conversation_id: &str,
    ) -> Result<Option<ChatContextCompaction>, String> {
        self.connection()?
            .query_row(
                "SELECT through_ordinal, summary
                 FROM chat_context_compactions WHERE conversation_id = ?1",
                [conversation_id],
                |row| {
                    Ok(ChatContextCompaction {
                        through_ordinal: row.get(0)?,
                        summary: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }
}

fn delete_archived_conversation_from_database(
    database_path: &Path,
    id: &str,
) -> Result<(), String> {
    let connection = store::open_connection(database_path)?;
    let status = connection
        .query_row(
            "SELECT status FROM chat_conversations WHERE id = ?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    match status.as_deref() {
        None => Ok(()),
        Some("archived") => {
            connection
                .execute(
                    "DELETE FROM chat_composer_drafts WHERE slot = ?1",
                    [composer_draft_slot_for_conversation(id)],
                )
                .map_err(|error| error.to_string())?;
            connection
                .execute("DELETE FROM chat_conversations WHERE id = ?1", [id])
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        Some(_) => Err("Only archived conversations can be permanently deleted".to_string()),
    }
}

/// Mirrors the frontend slot naming so a deleted conversation takes its
/// unsent composer text with it.
fn composer_draft_slot_for_conversation(conversation_id: &str) -> String {
    format!("conversation:{conversation_id}")
}

const MAX_COMPOSER_DRAFT_SLOT_LEN: usize = 200;

fn normalize_composer_draft_slot(slot: &str) -> Result<String, String> {
    let slot = slot.trim();
    if slot.is_empty() {
        return Err("Composer draft slot is required".to_string());
    }
    if slot.len() > MAX_COMPOSER_DRAFT_SLOT_LEN {
        return Err("Composer draft slot is too long".to_string());
    }
    Ok(slot.to_string())
}

fn summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatConversationSummary> {
    Ok(ChatConversationSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        access: VaultAccess::parse(&row.get::<_, String>(2)?),
        status: row.get(3)?,
        created_at_millis: row.get::<_, i64>(4)?.max(0) as u64,
        updated_at_millis: row.get::<_, i64>(5)?.max(0) as u64,
        detached: row.get::<_, i64>(6)? != 0,
        message_count: row.get::<_, i64>(7)?.max(0) as usize,
        provider: row.get(8)?,
        model: row.get(9)?,
        reasoning_effort: row.get(10)?,
    })
}

fn proposal_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatAgentProposal> {
    let payload_json: String = row.get(9)?;
    let preview_json: String = row.get(10)?;
    Ok(ChatAgentProposal {
        id: row.get(0)?,
        run_id: row.get(1)?,
        conversation_id: row.get(2)?,
        assistant_message_id: row.get(3)?,
        kind: row.get(4)?,
        note_id: row.get(5)?,
        suggested_path: row.get(6)?,
        title: row.get(7)?,
        base_hash: row.get(8)?,
        payload: serde_json::from_str(&payload_json).unwrap_or(Value::Null),
        preview: serde_json::from_str(&preview_json).unwrap_or(Value::Null),
        status: row.get(11)?,
        created_at_millis: row.get::<_, i64>(12)?.max(0) as u64,
        updated_at_millis: row.get::<_, i64>(13)?.max(0) as u64,
    })
}

fn load_messages(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Vec<ChatMessage>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, conversation_id, ordinal, role, status, content, error, part, created_at_millis,
                    has_revision_evidence, note_reference_ids_json
             FROM chat_messages WHERE conversation_id = ?1 ORDER BY ordinal",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([conversation_id], |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                ordinal: row.get(2)?,
                role: row.get(3)?,
                status: row.get(4)?,
                content: row.get(5)?,
                error: row.get(6)?,
                part: row.get(7)?,
                created_at_millis: row.get::<_, i64>(8)?.max(0) as u64,
                sources: Vec::new(),
                has_revision_evidence: row.get(9)?,
                note_reference_ids: serde_json::from_str(&row.get::<_, String>(10)?).map_err(
                    |e| rusqlite::Error::FromSqlConversionFailure(
                        10, rusqlite::types::Type::Text, Box::new(e),
                    ),
                )?,
                attachments: Vec::new(),
                agent_events: Vec::new(),
            })
        })
        .map_err(|error| error.to_string())?;
    let mut messages = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    for message in &mut messages {
        message.sources = load_sources(connection, &message.id)?;
        message.attachments = load_attachments(connection, &message.id)?;
        message.agent_events = load_agent_events(connection, &message.id)?;
    }
    Ok(messages)
}

fn load_agent_events(
    connection: &Connection,
    message_id: &str,
) -> Result<Vec<ChatAgentEventEnvelope>, String> {
    let mut statement = connection
        .prepare(
            "SELECT request_id, conversation_id, message_id, run_id, sequence, created_at_millis, event_json
             FROM chat_agent_events WHERE message_id = ?1
             ORDER BY created_at_millis, run_id, sequence",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([message_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut events = Vec::new();
    for row in rows {
        let (
            request_id,
            conversation_id,
            message_id,
            run_id,
            sequence,
            created_at_millis,
            event_json,
        ) = row.map_err(|error| error.to_string())?;
        // Structured events are a replayable projection, not canonical chat
        // content. Retired or future event variants must not prevent an
        // existing vault from opening after the event contract changes.
        let Ok(event) = serde_json::from_str(&event_json) else {
            continue;
        };
        events.push(ChatAgentEventEnvelope {
            schema_version: 2,
            request_id,
            conversation_id,
            message_id,
            run_id,
            sequence: sequence.max(0) as u64,
            created_at_millis: created_at_millis.max(0) as u64,
            event,
        });
    }
    Ok(events)
}

fn load_agent_run_context(
    connection: &Connection,
    run_id: &str,
) -> Result<Vec<ChatRunContextItem>, String> {
    let mut statement = connection
        .prepare(
            "SELECT note_id, note_path, title, section_label, excerpt,
                    content_hash, reason, start_line, end_line, block_anchor
             FROM chat_agent_run_context
             WHERE run_id = ?1 ORDER BY ordinal",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([run_id], |row| {
            Ok(ChatRunContextItem {
                note_id: row.get(0)?,
                note_path: row.get(1)?,
                title: row.get(2)?,
                section_label: row.get(3)?,
                excerpt: row.get(4)?,
                content_hash: row.get(5)?,
                reason: row.get(6)?,
                start_line: row
                    .get::<_, Option<i64>>(7)?
                    .map(|value| value.max(0) as usize),
                end_line: row
                    .get::<_, Option<i64>>(8)?
                    .map(|value| value.max(0) as usize),
                block_anchor: row.get(9)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_attachments(
    connection: &Connection,
    message_id: &str,
) -> Result<Vec<ChatAttachment>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, kind, name, mime_type, size_bytes, data_base64
             FROM chat_message_attachments
             WHERE message_id = ?1 ORDER BY created_at_millis, id",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([message_id], |row| {
            Ok(ChatAttachment {
                id: row.get(0)?,
                kind: row.get(1)?,
                name: row.get(2)?,
                mime_type: row.get(3)?,
                size_bytes: row.get::<_, i64>(4)?.max(0) as usize,
                data_base64: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_sources(connection: &Connection, message_id: &str) -> Result<Vec<ChatSource>, String> {
    let mut statement = connection
        .prepare(
            "SELECT kind, note_id, note_path, title, excerpt, url, anchor, revision_json, passage_json
             FROM chat_sources s
             WHERE message_id = ?1
               AND (
                 s.note_id IS NULL OR NOT EXISTS (
                   SELECT 1 FROM chat_note_policies p
                   WHERE p.note_id = s.note_id AND p.disposition = 'excluded'
                 )
               )
             ORDER BY id",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([message_id], |row| {
            Ok(ChatSource {
                kind: row.get(0)?,
                note_id: row.get(1)?,
                note_path: row.get(2)?,
                title: row.get(3)?,
                excerpt: row.get(4)?,
                url: row.get(5)?,
                anchor: row.get(6)?,
                passage: row
                    .get::<_, Option<String>>(8)?
                    .map(|json| serde_json::from_str(&json))
                    .transpose()
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            8,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                revision: row
                    .get::<_, Option<String>>(7)?
                    .map(|json| serde_json::from_str(&json))
                    .transpose()
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            7,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_excerpts(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Vec<ChatExcerpt>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, conversation_id, message_id, start_offset, end_offset, quote, anchor, remembered
             FROM chat_excerpts WHERE conversation_id = ?1 ORDER BY created_at_millis",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([conversation_id], excerpt_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn excerpt_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatExcerpt> {
    Ok(ChatExcerpt {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        message_id: row.get(2)?,
        start_offset: row.get::<_, i64>(3)?.max(0) as usize,
        end_offset: row.get::<_, i64>(4)?.max(0) as usize,
        quote: row.get(5)?,
        anchor: row.get(6)?,
        remembered: row.get::<_, i64>(7)? != 0,
    })
}

fn choose_part(connection: &Connection, conversation_id: &str) -> Result<i64, String> {
    let current: i64 = connection
        .query_row(
            "SELECT current_part FROM chat_conversations WHERE id = ?1",
            [conversation_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let (count, bytes): (i64, i64) = connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(content)), 0)
             FROM chat_messages WHERE conversation_id = ?1 AND part = ?2",
            params![conversation_id, current],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    Ok(if count >= MAX_PART_MESSAGES || bytes >= MAX_PART_BYTES {
        current + 1
    } else {
        current.max(1)
    })
}

fn model_history_content(message: &ChatMessage) -> &str {
    if message.role == "assistant"
        && (message.has_revision_evidence || message.sources.iter().any(|s| s.kind != "web"))
    {
        "[Earlier note-based answer omitted. Retrieve fresh note evidence with the available tools.]"
    } else {
        &message.content
    }
}

fn note_reference_context(metadata: &Value, items: &[Value]) -> String {
    let mut group = metadata.clone();
    group["notes"] = serde_json::json!(items);
    format!("\n{group}\n")
}

struct NormalizedHistory {
    messages: Vec<rig_core::completion::Message>,
    admitted_note_ids: HashSet<String>,
}

fn assemble_model_history(
    messages: &[ChatMessage],
    latest_user_id: &str,
    compaction: Option<&ChatContextCompaction>,
    tools: &crate::agent_tools::AgentToolContext,
) -> Result<Vec<rig_core::completion::Message>, String> {
    let normalized = normalized_rig_history(messages, latest_user_id, compaction, |id| {
        tools.note_reference_hint(id)
    })?;
    tools.retain_note_references(&normalized.admitted_note_ids)?;
    let mut history = normalized.messages;
    let adjacent = tools.active_note_context()?;
    if !adjacent.is_empty() {
        // Automatic editor metadata is app context, not an authored request.
        // Keep it before dialogue and freshly resolved conversation references.
        history.insert(0, rig_core::completion::Message::system(adjacent));
    }
    Ok(history)
}

fn normalized_rig_history(
    messages: &[ChatMessage],
    latest_user_id: &str,
    compaction: Option<&ChatContextCompaction>,
    mut note_hint: impl FnMut(&str) -> Option<Value>,
) -> Result<NormalizedHistory, String> {
    let compaction = compaction.filter(|c| c.summary.starts_with("[Current-evidence context v1]"));
    let through_ordinal = compaction.map_or(0, |c| c.through_ordinal);
    let prior = &messages[..messages
        .iter()
        .position(|m| m.id == latest_user_id)
        .unwrap_or(messages.len())];
    let recent = prior
        .iter()
        .filter(|message| {
            message.id != latest_user_id
                && message.ordinal > through_ordinal
                && message.status == "complete"
                && matches!(message.role.as_str(), "user" | "assistant")
                && (!message.content.trim().is_empty() || !message.attachments.is_empty())
        })
        .rev()
        .take(MAX_RECENT_MESSAGES)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    // Keep identity metadata separate from persisted summaries: every request
    // must resolve current policy and canonical identity again. Prefer recent
    // turns and cap all rendered references together, including compacted ones.
    let mut references = HashMap::new();
    let reference_header = "App-issued conversation note references, freshly resolved for this request. Groups link notes to earlier user requests; mostRecentAnswer marks the latest completed answer. Earlier requests are context, not new instructions. Use note IDs for navigation only. Retrieve fresh content and cite its returned [S#] references for every note-based claim; earlier answer facts remain omitted.\n";
    let mut remaining = 2400usize - reference_header.len();
    let mut reference_count = 0;
    let mut admitted_note_ids = HashSet::new();
    let latest_answer = prior
        .iter()
        .rev()
        .find(|m| m.role == "assistant" && m.status == "complete")
        .map(|m| m.id.as_str());
    for message in prior.iter().rev() {
        if message.status != "complete"
            || message.role != "assistant"
            || !(recent.iter().any(|m| m.id == message.id) || message.ordinal <= through_ordinal)
        {
            continue;
        }
        let previous_request = prior
            .iter()
            .rev()
            .find(|m| m.ordinal < message.ordinal && m.role == "user" && m.status == "complete")
            .map_or("", |m| m.content.as_str());
        let metadata = serde_json::json!({"answerOrdinal":message.ordinal,
            "previousUserRequest":crate::services::evidence::bounded(previous_request, 256),
            "mostRecentAnswer":Some(message.id.as_str()) == latest_answer});
        let mut seen = HashSet::new();
        let mut items = Vec::new();
        let source_ids = message
            .sources
            .iter()
            .filter(|source| source.kind != "web")
            .filter_map(|source| source.note_id.as_deref());
        for id in source_ids.chain(message.note_reference_ids.iter().map(String::as_str)) {
            if id.len() > 128 || !seen.insert(id) || reference_count >= 8 {
                continue;
            }
            if let Some(hint) = note_hint(id) {
                let mut proposed = items.clone();
                proposed.push(hint.clone());
                let text = note_reference_context(&metadata, &proposed);
                if text.len() <= remaining {
                    items.push(hint);
                    admitted_note_ids.insert(id.to_string());
                    reference_count += 1;
                }
            }
        }
        if !items.is_empty() {
            let text = note_reference_context(&metadata, &items);
            remaining -= text.len();
            references.insert(message.id.as_str(), text);
        }
        if reference_count >= 8 {
            break;
        }
    }
    let mut history = recent
        .into_iter()
        .map(|message| {
            if message.role == "user" {
                let attachment_names = message
                    .attachments
                    .iter()
                    .map(|attachment| attachment.name.as_str())
                    .collect::<Vec<_>>();
                let content = if attachment_names.is_empty() {
                    message.content.clone()
                } else {
                    format!(
                        "{}\n\n[Previously attached: {}]",
                        message.content.clone(),
                        attachment_names.join(", ")
                    )
                };
                Ok(rig_core::completion::Message::user(content))
            } else {
                Ok(rig_core::completion::Message::assistant(
                    model_history_content(message).to_string(),
                ))
            }
        })
        .collect::<Result<Vec<_>, String>>()?;
    if let Some(compaction) = compaction {
        history.insert(
            0,
            rig_core::completion::Message::system(crate::services::evidence::bounded(
                &compaction.summary,
                12_000,
            )),
        );
    }
    if !references.is_empty() {
        let context = prior
            .iter()
            .filter_map(|m| references.get(m.id.as_str()))
            .cloned()
            .collect::<Vec<_>>()
            .join("");
        // These identities were issued by the app for this request, not copied
        // from old assistant prose. Keep that distinction visible to the model.
        history.push(rig_core::completion::Message::system(format!(
            "{reference_header}{context}"
        )));
    }
    Ok(NormalizedHistory {
        messages: history,
        admitted_note_ids,
    })
}

fn validate_attachments(
    attachments: Vec<ChatAttachmentInput>,
) -> Result<Vec<ChatAttachment>, String> {
    const IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];
    const AUDIO_TYPES: &[&str] = &[
        "audio/wav",
        "audio/x-wav",
        "audio/mpeg",
        "audio/mp3",
        "audio/aiff",
        "audio/aac",
        "audio/ogg",
        "audio/flac",
        "audio/mp4",
        "audio/x-m4a",
    ];
    const VIDEO_TYPES: &[&str] = &[
        "video/avi",
        "video/x-msvideo",
        "video/mp4",
        "video/mpeg",
        "video/quicktime",
        "video/webm",
    ];
    const FILE_TYPES: &[&str] = &[
        "application/pdf",
        "text/plain",
        "text/markdown",
        "text/csv",
        "text/html",
        "text/css",
        "text/javascript",
        "text/x-python",
        "application/json",
        "application/xml",
        "application/rtf",
    ];

    if attachments.len() > MAX_ATTACHMENTS {
        return Err(format!("Attach up to {MAX_ATTACHMENTS} files per message"));
    }
    let mut total_bytes = 0usize;
    let mut validated = Vec::with_capacity(attachments.len());
    for attachment in attachments {
        let mime_type = attachment.mime_type.trim().to_ascii_lowercase();
        let expected_kind = if IMAGE_TYPES.contains(&mime_type.as_str()) {
            "image"
        } else if AUDIO_TYPES.contains(&mime_type.as_str())
            || VIDEO_TYPES.contains(&mime_type.as_str())
            || FILE_TYPES.contains(&mime_type.as_str())
        {
            "file"
        } else {
            return Err(format!(
                "“{}” has an unsupported attachment type",
                attachment.name
            ));
        };
        if attachment.kind != expected_kind {
            return Err(format!(
                "“{}” has invalid attachment metadata",
                attachment.name
            ));
        }
        if attachment.data_base64.len() > (MAX_ATTACHMENT_BYTES * 4 / 3) + 8 {
            return Err(format!("“{}” is larger than 10 MB", attachment.name));
        }
        let decoded = BASE64_STANDARD
            .decode(&attachment.data_base64)
            .map_err(|_| format!("“{}” contains invalid attachment data", attachment.name))?;
        if decoded.len() != attachment.size_bytes || decoded.len() > MAX_ATTACHMENT_BYTES {
            return Err(format!(
                "“{}” has an invalid attachment size",
                attachment.name
            ));
        }
        if expected_kind == "file"
            && mime_type != "application/pdf"
            && !mime_type.starts_with("audio/")
            && !mime_type.starts_with("video/")
        {
            std::str::from_utf8(&decoded)
                .map_err(|_| format!("“{}” is not valid UTF-8 text", attachment.name))?;
        }
        total_bytes = total_bytes
            .checked_add(decoded.len())
            .ok_or_else(|| "Attachment size exceeds the allowed limit".to_string())?;
        if total_bytes > MAX_ATTACHMENT_TOTAL_BYTES {
            return Err("Attachments can total up to 25 MB per message".to_string());
        }
        let name = attachment
            .name
            .trim()
            .chars()
            .filter(|character| !character.is_control())
            .take(255)
            .collect::<String>();
        validated.push(ChatAttachment {
            id: generate_id("attachment"),
            kind: expected_kind.to_string(),
            name: if name.is_empty() {
                "Attachment".to_string()
            } else {
                name
            },
            mime_type,
            size_bytes: decoded.len(),
            data_base64: attachment.data_base64,
        });
    }
    Ok(validated)
}

fn rig_user_message(
    text: String,
    attachments: &[ChatAttachment],
) -> Result<rig_core::completion::Message, String> {
    use rig_core::{
        completion::Message,
        message::{
            AudioMediaType, Document, DocumentMediaType, DocumentSourceKind, ImageDetail,
            ImageMediaType, UserContent, VideoMediaType,
        },
    };

    let mut content = Vec::new();
    if !text.trim().is_empty() {
        content.push(UserContent::text(text));
    }
    for attachment in attachments {
        content.push(UserContent::text(format!(
            "Attached {}: {}",
            attachment.kind, attachment.name
        )));
        if attachment.kind == "image" {
            let media_type = match attachment.mime_type.as_str() {
                "image/png" => ImageMediaType::PNG,
                "image/jpeg" => ImageMediaType::JPEG,
                "image/webp" => ImageMediaType::WEBP,
                "image/gif" => ImageMediaType::GIF,
                other => return Err(format!("Unsupported image type '{other}'")),
            };
            content.push(UserContent::image_base64(
                attachment.data_base64.clone(),
                Some(media_type),
                Some(ImageDetail::Auto),
            ));
            continue;
        }
        if attachment.mime_type.starts_with("audio/") {
            let media_type = match attachment.mime_type.as_str() {
                "audio/wav" | "audio/x-wav" => AudioMediaType::WAV,
                "audio/mpeg" | "audio/mp3" => AudioMediaType::MP3,
                "audio/aiff" => AudioMediaType::AIFF,
                "audio/aac" => AudioMediaType::AAC,
                "audio/ogg" => AudioMediaType::OGG,
                "audio/flac" => AudioMediaType::FLAC,
                "audio/mp4" | "audio/x-m4a" => AudioMediaType::M4A,
                other => return Err(format!("Unsupported audio type '{other}'")),
            };
            content.push(UserContent::audio_base64(
                attachment.data_base64.clone(),
                Some(media_type),
            ));
            continue;
        }
        if attachment.mime_type.starts_with("video/") {
            let media_type = match attachment.mime_type.as_str() {
                "video/avi" | "video/x-msvideo" => VideoMediaType::AVI,
                "video/mp4" => VideoMediaType::MP4,
                "video/mpeg" => VideoMediaType::MPEG,
                "video/quicktime" => VideoMediaType::MOV,
                "video/webm" => VideoMediaType::WEBM,
                other => return Err(format!("Unsupported video type '{other}'")),
            };
            content.push(UserContent::video_base64(
                attachment.data_base64.clone(),
                Some(media_type),
            ));
            continue;
        }
        if attachment.mime_type == "application/pdf" {
            content.push(UserContent::Document(Document {
                data: DocumentSourceKind::Base64(attachment.data_base64.clone()),
                media_type: Some(DocumentMediaType::PDF),
                additional_params: None,
            }));
            continue;
        }
        let bytes = BASE64_STANDARD
            .decode(&attachment.data_base64)
            .map_err(|_| format!("“{}” contains invalid attachment data", attachment.name))?;
        let document = String::from_utf8(bytes)
            .map_err(|_| format!("“{}” is not valid UTF-8 text", attachment.name))?;
        content.push(UserContent::document_text(
            document,
            Some(document_media_type(&attachment.mime_type)),
        ));
    }
    if content.is_empty() {
        return Err("A message or attachment is required".to_string());
    }
    Ok(Message::User { content })
}

fn document_media_type(mime_type: &str) -> rig_core::message::DocumentMediaType {
    use rig_core::message::DocumentMediaType;
    match mime_type {
        "text/markdown" => DocumentMediaType::MARKDOWN,
        "text/csv" => DocumentMediaType::CSV,
        "text/html" => DocumentMediaType::HTML,
        "text/css" => DocumentMediaType::CSS,
        "text/javascript" => DocumentMediaType::Javascript,
        "text/x-python" => DocumentMediaType::Python,
        "application/xml" => DocumentMediaType::XML,
        "application/rtf" => DocumentMediaType::RTF,
        _ => DocumentMediaType::TXT,
    }
}

pub(crate) fn agent_preamble(
    _provider: &crate::agent_runtime::AgentProvider,
    tools_enabled: bool,
) -> String {
    let mut instructions = include_str!("chat/assistant_instructions.txt")
        .trim()
        .to_string();
    if !tools_enabled {
        instructions.push_str("\n\nTools are unavailable for this request. Answer from supplied messages and context, and state when missing evidence prevents an answer. Do not claim to search or change notes.");
    }
    instructions
}

fn web_sources_from_text(content: &str) -> Vec<ChatSource> {
    let mut seen = HashSet::new();
    let mut sources = Vec::new();
    let mut cursor = 0;
    while cursor < content.len() {
        let remaining = &content[cursor..];
        let Some(offset) = ["https://", "http://"]
            .into_iter()
            .filter_map(|scheme| remaining.find(scheme))
            .min()
        else {
            break;
        };
        let start = cursor + offset;
        let tail = &content[start..];
        let end = tail
            .char_indices()
            .find_map(|(index, ch)| {
                (index > 0
                    && (ch.is_whitespace() || matches!(ch, ')' | ']' | '>' | '"' | '\'' | '`')))
                .then_some(index)
            })
            .unwrap_or(tail.len());
        let url = tail[..end]
            .trim_end_matches([',', '.', ';', ':', '!'])
            .to_string();
        cursor = start + end.max(1);
        if seen.insert(url.clone()) {
            sources.push(ChatSource {
                kind: "web".to_string(),
                note_id: None,
                note_path: None,
                title: url.clone(),
                excerpt: String::new(),
                url: Some(url),
                anchor: None,
                revision: None,
                passage: None,
            });
        }
    }
    sources
}

fn projection_frontmatter(
    kind: &str,
    chat_id: &str,
    part: Option<i64>,
    projection_hash: &str,
    created_at_millis: u64,
) -> String {
    let part = part
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());
    format!(
        "---\ngneauxghts:\n  id: {}\n  created_at: {}\n  updated_at: {}\n  trashed_at: null\n  kind: {}\n  chat_id: {}\n  part: {}\n  projection_hash: {}\n---",
        generate_stable_projection_id(chat_id, part.as_bytes()),
        created_at_millis,
        created_at_millis,
        kind,
        chat_id,
        part,
        projection_hash
    )
}

fn write_projected_file(
    connection: &Connection,
    sink: &dyn ChatProjectionSink,
    conversation_id: &str,
    path: &Path,
    body: &str,
) -> Result<(), String> {
    let body_without_pending = body.replace("projection_hash: PENDING", "projection_hash: managed");
    let hash = content_hash(&body_without_pending);
    sink.publish(path, &body_without_pending)?;
    connection
        .execute(
            "INSERT INTO chat_projection_files (conversation_id, path, content_hash)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(conversation_id, path) DO UPDATE SET content_hash = excluded.content_hash",
            params![conversation_id, path.to_string_lossy(), hash],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn conversation_directory(notes_root: &Path, summary: &ChatConversationSummary) -> PathBuf {
    let days = summary.created_at_millis / 86_400_000;
    let date = civil_date_from_days(days as i64);
    notes_root
        .join("Chats")
        // Keep copied transcript links stable when the user renames the chat.
        .join(format!("{date}-{}", short_id(&summary.id)))
}

fn civil_date_from_days(days_since_epoch: i64) -> String {
    // Howard Hinnant's civil-from-days algorithm.
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    format!("{year:04}-{month:02}-{day:02}")
}

fn part_link(_directory: &Path, part: i64) -> String {
    format!("Part {part:03}")
}

fn message_part(messages: &[ChatMessage], id: &str) -> i64 {
    messages
        .iter()
        .find(|message| message.id == id)
        .map(|message| message.part)
        .unwrap_or(1)
}

fn converted_note_title(content: &str) -> String {
    content
        .lines()
        .find_map(|line| line.strip_prefix("# "))
        .map(slugify)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Converted chat".to_string())
}

fn generate_id(prefix: &str) -> String {
    let now = now_millis();
    let count = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut hasher = Hasher::new();
    hasher.update(prefix.as_bytes());
    hasher.update(&now.to_be_bytes());
    hasher.update(&count.to_be_bytes());
    format!("{prefix}_{}", &hasher.finalize().to_hex()[..20])
}

fn generate_stable_projection_id(chat_id: &str, discriminator: &[u8]) -> String {
    let mut hasher = Hasher::new();
    hasher.update(chat_id.as_bytes());
    hasher.update(discriminator);
    format!("CHAT{}", &hasher.finalize().to_hex()[..20].to_uppercase())
}

fn short_id(id: &str) -> &str {
    id.rsplit('_').next().unwrap_or(id).get(..6).unwrap_or(id)
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    for character in value.chars() {
        if character.is_alphanumeric() || character == ' ' || character == '-' || character == '_' {
            slug.push(character);
        }
    }
    let slug = slug.split_whitespace().collect::<Vec<_>>().join(" ");
    slug.chars().take(60).collect()
}

fn first_user_attachment_names(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT attachment.name
             FROM chat_message_attachments attachment
             JOIN chat_messages message ON message.id = attachment.message_id
             WHERE message.conversation_id = ?1
               AND message.role = 'user'
               AND message.ordinal = (
                 SELECT MIN(first_user.ordinal)
                 FROM chat_messages first_user
                 WHERE first_user.conversation_id = ?1
                   AND first_user.role = 'user'
               )
             ORDER BY attachment.created_at_millis ASC",
        )
        .map_err(|error| error.to_string())?;
    let names = statement
        .query_map([conversation_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(names)
}

fn automatic_conversation_title(content: &str, attachment_names: &[String]) -> String {
    let mut title = content.split_whitespace().collect::<Vec<_>>().join(" ");
    title = title
        .trim_matches(|character: char| {
            character.is_whitespace()
                || matches!(
                    character,
                    '"' | '\'' | '`' | '#' | '*' | '_' | '-' | ':' | ',' | '.' | '?' | '!'
                )
        })
        .to_string();

    // Remove conversational scaffolding while leaving the meaningful request.
    // Run repeatedly so "Hey, could you please help me …" is cleaned in layers.
    const LEADING_PHRASES: &[&str] = &[
        "hey, ",
        "hey ",
        "hi, ",
        "hi ",
        "hello, ",
        "hello ",
        "can you ",
        "could you ",
        "would you ",
        "will you ",
        "please ",
        "help me ",
        "i want you to ",
        "i need you to ",
        "i'd like you to ",
        "i would like you to ",
    ];
    loop {
        let lowered = title.to_lowercase();
        let Some(prefix) = LEADING_PHRASES
            .iter()
            .find(|prefix| lowered.starts_with(**prefix))
        else {
            break;
        };
        title = title[prefix.len()..]
            .trim_start_matches(|character: char| {
                character.is_whitespace() || matches!(character, ',' | ':' | '-' | '—')
            })
            .to_string();
    }

    if title.is_empty() {
        title = attachment_names
            .first()
            .map(|name| {
                let stem = Path::new(name)
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or(name);
                format!("Discuss {stem}")
            })
            .unwrap_or_else(|| DEFAULT_CONVERSATION_TITLE.to_string());
    }

    let mut compact = String::new();
    for word in title.split_whitespace().take(9) {
        let separator = usize::from(!compact.is_empty());
        if compact.chars().count() + separator + word.chars().count() > MAX_CONVERSATION_TITLE_CHARS
        {
            break;
        }
        if !compact.is_empty() {
            compact.push(' ');
        }
        compact.push_str(word);
    }
    if compact.is_empty() {
        compact = title.chars().take(MAX_CONVERSATION_TITLE_CHARS).collect();
    }
    compact = compact
        .trim_end_matches(|character: char| {
            character.is_whitespace()
                || matches!(character, ',' | ';' | ':' | '.' | '?' | '!' | '-')
        })
        .to_string();
    if let Some(first) = compact.chars().next() {
        if first.is_lowercase() {
            let first_len = first.len_utf8();
            compact.replace_range(..first_len, &first.to_uppercase().collect::<String>());
        }
    }
    compact
}

fn supports_background_title_refinement(provider: &str) -> bool {
    matches!(
        crate::agent_runtime::AgentProvider::parse(provider),
        Ok(crate::agent_runtime::AgentProvider::Openai)
    )
}

fn normalize_generated_conversation_title(output: &str) -> Option<String> {
    let mut title = output
        .lines()
        .find(|line| !line.trim().is_empty())?
        .trim()
        .to_string();
    title = title
        .trim_matches(|character: char| {
            character.is_whitespace()
                || matches!(
                    character,
                    '"' | '\'' | '`' | '#' | '*' | '_' | ':' | ',' | '.' | '?' | '!'
                )
        })
        .to_string();
    if title.to_lowercase().starts_with("title:") {
        title = title["title:".len()..].trim().to_string();
    }
    title = title
        .trim_matches(|character: char| {
            character.is_whitespace()
                || matches!(character, '*' | '_' | ':' | ',' | '.' | '?' | '!')
        })
        .to_string();
    if title.is_empty() || title.eq_ignore_ascii_case(DEFAULT_CONVERSATION_TITLE) {
        return None;
    }

    let mut compact = String::new();
    for word in title.split_whitespace().take(9) {
        let separator = usize::from(!compact.is_empty());
        if compact.chars().count() + separator + word.chars().count() > MAX_CONVERSATION_TITLE_CHARS
        {
            break;
        }
        if !compact.is_empty() {
            compact.push(' ');
        }
        compact.push_str(word);
    }
    (!compact.is_empty()).then_some(compact)
}

fn compact_text(value: &str, max: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(max).collect()
}

fn excerpt_match_tokens(value: &str) -> Vec<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(str::to_lowercase)
        .collect()
}

fn tokens_are_ordered_subsequence(needles: &[String], haystack: &[String]) -> bool {
    let mut next = 0;
    for token in haystack {
        if needles.get(next) == Some(token) {
            next += 1;
            if next == needles.len() {
                return true;
            }
        }
    }
    false
}

fn stream_payload(request_id: &str, conversation_id: &str, message_id: &str) -> ChatStreamEvent {
    ChatStreamEvent {
        request_id: request_id.to_string(),
        conversation_id: conversation_id.to_string(),
        message_id: message_id.to_string(),
        conversation: None,
        delta: None,
        content: None,
        source: None,
        attempt: None,
        sequence: None,
        error: None,
    }
}

fn now_millis() -> u64 {
    crate::time::current_time_millis().unwrap_or(0)
}

fn to_i64(value: u64) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| "Value exceeds SQLite integer range".to_string())
}

#[cfg(test)]
mod grounding_evaluation;

#[cfg(test)]
mod citation_evaluation;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod structured_streaming_tests;
