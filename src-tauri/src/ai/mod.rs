use crate::{
    commands::note_persistence::{persist_note_session_with_outcome, NotePersistenceMode},
    index::AppState,
    note,
    semantic::db::content_hash,
    state::{app_data_dir, is_valid_note_path, notes_root, persist_note},
    time::current_time_millis,
};
use reqwest::blocking::Client;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    thread,
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager, State};

const AI_DB_FILE_NAME: &str = "ai.sqlite3";
const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const MAX_INTEGRATE_CANDIDATE_NOTES: usize = 12;
const MAX_INTEGRATE_PACKED_NOTES: usize = 6;
const MAX_SNIPPETS_PER_NOTE: usize = 3;
const MAX_SNIPPET_CHARS: usize = 420;
const MAX_EDIT_CONTEXT_CHARS: usize = 24_000;
const AI_CONNECT_TIMEOUT_SECS: u64 = 15;
const AI_COMPLETION_TIMEOUT_SECS: u64 = 600;
const AI_MODEL_LIST_TIMEOUT_SECS: u64 = 30;

pub(crate) const INBOX_CHANGED_EVENT: &str = "inbox-changed";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RememberMode {
    Exact,
    CleanUp,
    Summarize,
    Outline,
    ActionItems,
    Decisions,
    MeetingNotes,
    Evergreen,
    Retitle,
    StudyGuide,
    SplitUp,
    Integrate,
    CustomSingleNote,
    CustomAdvanced,
}

impl RememberMode {
    fn is_exact(&self) -> bool {
        matches!(self, Self::Exact)
    }

    fn is_edit_mode(&self) -> bool {
        matches!(
            self,
            Self::CleanUp
                | Self::Summarize
                | Self::Outline
                | Self::ActionItems
                | Self::Decisions
                | Self::MeetingNotes
                | Self::Evergreen
                | Self::Retitle
                | Self::StudyGuide
                | Self::CustomSingleNote
        )
    }

    fn is_split_mode(&self) -> bool {
        matches!(self, Self::SplitUp)
    }

    fn is_integrate_mode(&self) -> bool {
        matches!(self, Self::Integrate)
    }

    fn is_custom_advanced_mode(&self) -> bool {
        matches!(self, Self::CustomAdvanced)
    }

    fn label(&self) -> &'static str {
        match self {
            Self::Exact => "Remember Exact",
            Self::CleanUp => "Clean Up",
            Self::Summarize => "Summarize",
            Self::Outline => "Outline",
            Self::ActionItems => "Action Items",
            Self::Decisions => "Decisions",
            Self::MeetingNotes => "Meeting Notes",
            Self::Evergreen => "Evergreen",
            Self::Retitle => "Retitle",
            Self::StudyGuide => "Study Guide",
            Self::SplitUp => "Split Up",
            Self::Integrate => "Integrate",
            Self::CustomSingleNote => "Custom Single Note",
            Self::CustomAdvanced => "Custom Advanced",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RememberActionKind {
    Exact,
    SingleNote,
    Advanced,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RememberActionInput {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) description: String,
    pub(crate) family: String,
    pub(crate) built_in: bool,
    pub(crate) action_kind: RememberActionKind,
    pub(crate) prompt: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CleanUpApplyPolicy {
    AutoApply,
    RequireApproval,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AiProviderKind {
    OpenAiCompatible,
    LlamaServer,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AiJobStatus {
    Queued,
    Running,
    PendingApproval,
    Applied,
    Rejected,
    Failed,
    Stale,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RememberAiStatus {
    NotRequested,
    Queued,
    FailedToQueue,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RememberDispatchResult {
    pub(crate) source_path: Option<String>,
    pub(crate) source_content_hash: Option<String>,
    pub(crate) ai_job_id: Option<i64>,
    pub(crate) ai_status: RememberAiStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiSettings {
    pub(crate) provider_kind: AiProviderKind,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) api_key_configured: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiModelOption {
    pub(crate) id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClearInboxResult {
    pub(crate) cancelled_jobs: usize,
    pub(crate) removed_jobs: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiDiagnosticsSnapshot {
    pub(crate) captured_at_millis: u64,
    pub(crate) metrics: AiDiagnosticsMetrics,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiDiagnosticsMetrics {
    pub(crate) run_count: u64,
    pub(crate) prompt_tokens_total: u64,
    pub(crate) completion_tokens_total: u64,
    pub(crate) total_tokens_total: u64,
    pub(crate) prompt_tokens_max: u64,
    pub(crate) completion_tokens_max: u64,
    pub(crate) total_tokens_max: u64,
    pub(crate) last_run: Option<AiDiagnosticsLastRun>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiDiagnosticsLastRun {
    pub(crate) kind: RememberMode,
    pub(crate) action_label: String,
    pub(crate) status: AiJobStatus,
    pub(crate) model: Option<String>,
    pub(crate) prompt_tokens: Option<u64>,
    pub(crate) completion_tokens: Option<u64>,
    pub(crate) total_tokens: Option<u64>,
    pub(crate) elapsed_millis: u64,
    pub(crate) updated_at_millis: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiSettingsUpdate {
    pub(crate) provider_kind: AiProviderKind,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) api_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum AiChange {
    UpdateNote {
        path: String,
        base_content_hash: String,
        new_title: String,
        new_markdown: String,
    },
    CreateNote {
        suggested_title: String,
        markdown: String,
    },
    DeleteNote {
        path: String,
        base_content_hash: String,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiChangePreview {
    pub(crate) change: AiChange,
    pub(crate) current_title: Option<String>,
    pub(crate) current_markdown: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InboxListItem {
    pub(crate) id: i64,
    pub(crate) kind: RememberMode,
    pub(crate) action_label: String,
    pub(crate) status: AiJobStatus,
    pub(crate) title: String,
    pub(crate) summary: String,
    pub(crate) source_path: String,
    pub(crate) source_title: String,
    pub(crate) affected_notes: Vec<String>,
    pub(crate) created_at_millis: u64,
    pub(crate) updated_at_millis: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InboxItemDetail {
    pub(crate) id: i64,
    pub(crate) kind: RememberMode,
    pub(crate) action_label: String,
    pub(crate) status: AiJobStatus,
    pub(crate) title: String,
    pub(crate) summary: String,
    pub(crate) source_path: String,
    pub(crate) source_title: String,
    pub(crate) source_markdown: String,
    pub(crate) source_content_hash: String,
    pub(crate) provider_kind: Option<AiProviderKind>,
    pub(crate) model: Option<String>,
    pub(crate) requires_approval: bool,
    pub(crate) failure_reason: Option<String>,
    pub(crate) metrics: Option<AiRunMetrics>,
    pub(crate) proposed_changes: Vec<AiChange>,
    pub(crate) change_previews: Vec<AiChangePreview>,
    pub(crate) created_at_millis: u64,
    pub(crate) updated_at_millis: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiRunMetrics {
    pub(crate) elapsed_millis: u64,
    pub(crate) prompt_tokens: Option<u64>,
    pub(crate) completion_tokens: Option<u64>,
    pub(crate) total_tokens: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceSnapshot {
    path: String,
    title: String,
    markdown: String,
    content_hash: String,
}

#[derive(Clone, Debug)]
struct StoredAiSettings {
    provider_kind: AiProviderKind,
    base_url: String,
    model: String,
    api_key: Option<String>,
}

#[derive(Clone, Debug)]
struct StoredAiJob {
    id: i64,
    kind: RememberMode,
    action_id: String,
    action_label: String,
    action_prompt: Option<String>,
    status: AiJobStatus,
    source: SourceSnapshot,
    requires_approval: bool,
    summary: String,
    proposed_changes: Vec<AiChange>,
    failure_reason: Option<String>,
    provider_kind: Option<AiProviderKind>,
    model: Option<String>,
    metrics: Option<AiRunMetrics>,
    created_at_millis: u64,
    updated_at_millis: u64,
    retry_of_job_id: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CleanUpProposal {
    summary: String,
    changes: Vec<AiChange>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegratePlanResponse {
    summary: String,
    confidence: String,
    strategy: String,
    target_note_paths: Vec<String>,
    delete_source: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrateEditResponse {
    summary: String,
    changes: Vec<AiChange>,
}

#[derive(Clone, Debug)]
struct CandidateNote {
    path: String,
    title: String,
    snippets: Vec<CandidateSnippet>,
}

#[derive(Clone, Debug)]
struct CandidateSnippet {
    section_label: String,
    excerpt: String,
    score: f32,
}

#[derive(Clone, Debug)]
struct TargetNoteContext {
    path: String,
    title: String,
    markdown: String,
    content_hash: String,
}

#[derive(Clone, Debug)]
struct GeneratedProposal {
    summary: String,
    changes: Vec<AiChange>,
    provider_kind: AiProviderKind,
    model: String,
    metrics: AiRunMetrics,
}

#[derive(Clone, Debug, Default)]
struct UsageTotals {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

#[derive(Clone, Debug)]
struct ResolvedRememberAction {
    mode: RememberMode,
    action_id: String,
    action_label: String,
    action_prompt: Option<String>,
}

#[derive(Clone, Debug)]
struct ModelCompletion {
    text: String,
    model: String,
    usage: UsageTotals,
}

trait GenerationProvider {
    fn complete_json(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<ModelCompletion, String>;
    fn provider_kind(&self) -> AiProviderKind;
}

struct OpenAiCompatibleProvider {
    client: Client,
    base_url: String,
    model: String,
    api_key: String,
}

enum WorkerSignal {
    Wake,
}

pub(crate) struct AiState {
    db_path: PathBuf,
    app_handle: AppHandle,
    signal_tx: Sender<WorkerSignal>,
    wake_pending: Arc<AtomicBool>,
}

impl AiState {
    pub(crate) fn new(app_handle: AppHandle) -> Result<Self, String> {
        let db_path = app_data_dir()?.join("ai").join(AI_DB_FILE_NAME);
        {
            let connection = open_database(&db_path)?;
            ensure_schema(&connection)?;
            ensure_default_settings(&connection)?;
        }

        let wake_pending = Arc::new(AtomicBool::new(false));
        let (signal_tx, signal_rx) = mpsc::channel();
        spawn_worker(
            app_handle.clone(),
            db_path.clone(),
            signal_rx,
            Arc::clone(&wake_pending),
        )?;

        let state = Self {
            db_path,
            app_handle,
            signal_tx,
            wake_pending,
        };
        state.request_wake()?;
        Ok(state)
    }

    fn request_wake(&self) -> Result<(), String> {
        if !self.wake_pending.swap(true, Ordering::AcqRel) {
            self.signal_tx
                .send(WorkerSignal::Wake)
                .map_err(|err| err.to_string())?;
        }
        Ok(())
    }

    fn connection(&self) -> Result<Connection, String> {
        let connection = open_database(&self.db_path)?;
        ensure_schema(&connection)?;
        ensure_default_settings(&connection)?;
        Ok(connection)
    }

    fn emit_inbox_changed(&self) -> Result<(), String> {
        self.app_handle
            .emit(INBOX_CHANGED_EVENT, json!({ "updated": true }))
            .map_err(|err| err.to_string())
    }

    fn load_public_settings(&self) -> Result<AiSettings, String> {
        let connection = self.connection()?;
        load_settings(&connection).map(public_ai_settings)
    }

    fn save_settings(&self, update: AiSettingsUpdate) -> Result<AiSettings, String> {
        let connection = self.connection()?;
        let current = load_settings(&connection)?;
        let next = StoredAiSettings {
            provider_kind: update.provider_kind,
            base_url: normalize_base_url(&update.base_url),
            model: update.model.trim().to_string(),
            api_key: match update.api_key {
                Some(api_key) => {
                    let trimmed = api_key.trim().to_string();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed)
                    }
                }
                None => current.api_key,
            },
        };
        save_settings(&connection, &next)?;
        Ok(public_ai_settings(next))
    }

    fn enqueue_job(
        &self,
        action: ResolvedRememberAction,
        source: SourceSnapshot,
        requires_approval: bool,
        retry_of_job_id: Option<i64>,
    ) -> Result<i64, String> {
        let connection = self.connection()?;
        let job_id = insert_job(
            &connection,
            &StoredAiJob {
                id: 0,
                kind: action.mode,
                action_id: action.action_id,
                action_label: action.action_label,
                action_prompt: action.action_prompt,
                status: AiJobStatus::Queued,
                source,
                requires_approval,
                summary: String::new(),
                proposed_changes: Vec::new(),
                failure_reason: None,
                provider_kind: None,
                model: None,
                metrics: None,
                created_at_millis: current_time_millis()?,
                updated_at_millis: current_time_millis()?,
                retry_of_job_id,
            },
        )?;
        self.emit_inbox_changed()?;
        self.request_wake()?;
        Ok(job_id)
    }

    fn record_failed_job(
        &self,
        action: ResolvedRememberAction,
        source: SourceSnapshot,
        failure_reason: String,
        retry_of_job_id: Option<i64>,
    ) -> Result<i64, String> {
        let connection = self.connection()?;
        let now = current_time_millis()?;
        let job_id = insert_job(
            &connection,
            &StoredAiJob {
                id: 0,
                kind: action.mode,
                action_id: action.action_id,
                action_label: action.action_label,
                action_prompt: action.action_prompt,
                status: AiJobStatus::Failed,
                source,
                requires_approval: true,
                summary: failure_reason.clone(),
                proposed_changes: Vec::new(),
                failure_reason: Some(failure_reason),
                provider_kind: None,
                model: None,
                metrics: None,
                created_at_millis: now,
                updated_at_millis: now,
                retry_of_job_id,
            },
        )?;
        self.emit_inbox_changed()?;
        Ok(job_id)
    }
}

#[tauri::command]
pub(crate) fn get_ai_settings(ai: State<'_, AiState>) -> Result<AiSettings, String> {
    ai.load_public_settings()
}

#[tauri::command]
pub(crate) fn set_ai_settings(
    ai: State<'_, AiState>,
    settings: AiSettingsUpdate,
) -> Result<AiSettings, String> {
    ai.save_settings(settings)
}

#[tauri::command]
pub(crate) fn get_ai_diagnostics(ai: State<'_, AiState>) -> Result<AiDiagnosticsSnapshot, String> {
    let connection = ai.connection()?;
    let jobs = list_jobs_including_cancelled(&connection)?;
    Ok(AiDiagnosticsSnapshot {
        captured_at_millis: current_time_millis()?,
        metrics: build_ai_diagnostics_metrics(&jobs),
    })
}

#[tauri::command]
pub(crate) fn clear_ai_diagnostics(ai: State<'_, AiState>) -> Result<(), String> {
    let connection = ai.connection()?;
    connection
        .execute(
            "UPDATE ai_jobs
             SET metrics_json = NULL,
                 updated_at_millis = ?1
             WHERE metrics_json IS NOT NULL",
            params![current_time_millis()?],
        )
        .map_err(|err| err.to_string())?;
    ai.emit_inbox_changed()?;
    Ok(())
}

#[tauri::command]
pub(crate) fn list_ai_models(
    ai: State<'_, AiState>,
    base_url: Option<String>,
    api_key: Option<String>,
) -> Result<Vec<AiModelOption>, String> {
    let connection = ai.connection()?;
    let settings = load_settings(&connection)?;
    let provider_kind = settings.provider_kind.clone();
    if provider_kind != AiProviderKind::OpenAiCompatible {
        return Err(
            "Model discovery is only available for OpenAI-compatible providers.".to_string(),
        );
    }

    let resolved_base_url =
        normalize_base_url(base_url.as_deref().unwrap_or(settings.base_url.as_str()));
    let resolved_api_key = api_key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or(settings.api_key)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Set an API key before loading models.".to_string())?;

    let models = fetch_openai_compatible_models(&resolved_base_url, &resolved_api_key)?;
    Ok(models)
}

#[tauri::command]
pub(crate) fn remember_with_mode(
    app_state: State<'_, AppState>,
    ai: State<'_, AiState>,
    mode: RememberMode,
    clean_up_apply_policy: CleanUpApplyPolicy,
    title: String,
    markdown: String,
    current_path: Option<String>,
) -> Result<RememberDispatchResult, String> {
    let resolved_action = ResolvedRememberAction {
        action_id: remember_mode_to_str(&mode).to_string(),
        action_label: mode.label().to_string(),
        action_prompt: None,
        mode,
    };
    dispatch_remember_action(
        &app_state,
        &ai,
        resolved_action,
        clean_up_apply_policy,
        title,
        markdown,
        current_path,
    )
}

#[tauri::command]
pub(crate) fn remember_with_action(
    app_state: State<'_, AppState>,
    ai: State<'_, AiState>,
    action: RememberActionInput,
    clean_up_apply_policy: CleanUpApplyPolicy,
    title: String,
    markdown: String,
    current_path: Option<String>,
) -> Result<RememberDispatchResult, String> {
    let resolved_action = resolve_action_input(action)?;
    dispatch_remember_action(
        &app_state,
        &ai,
        resolved_action,
        clean_up_apply_policy,
        title,
        markdown,
        current_path,
    )
}

fn dispatch_remember_action(
    app_state: &State<'_, AppState>,
    ai: &State<'_, AiState>,
    action: ResolvedRememberAction,
    clean_up_apply_policy: CleanUpApplyPolicy,
    title: String,
    markdown: String,
    current_path: Option<String>,
) -> Result<RememberDispatchResult, String> {
    let outcome = persist_note_session_with_outcome(
        app_state,
        title,
        markdown,
        current_path,
        NotePersistenceMode::Remember,
    )?;

    let Some(source_path) = outcome.persisted_path else {
        return Ok(RememberDispatchResult {
            source_path: None,
            source_content_hash: None,
            ai_job_id: None,
            ai_status: RememberAiStatus::NotRequested,
        });
    };
    let Some(saved_markdown) = outcome.persisted_markdown else {
        return Ok(RememberDispatchResult {
            source_path: Some(source_path),
            source_content_hash: None,
            ai_job_id: None,
            ai_status: RememberAiStatus::NotRequested,
        });
    };
    let source = build_source_snapshot(&source_path, &saved_markdown);

    if action.mode.is_exact() {
        return Ok(RememberDispatchResult {
            source_path: Some(source.path),
            source_content_hash: Some(source.content_hash),
            ai_job_id: None,
            ai_status: RememberAiStatus::NotRequested,
        });
    }

    let requires_approval = if action.mode.is_split_mode()
        || action.mode.is_integrate_mode()
        || action.mode.is_custom_advanced_mode()
    {
        true
    } else {
        clean_up_apply_policy == CleanUpApplyPolicy::RequireApproval
    };

    match ai.enqueue_job(action.clone(), source.clone(), requires_approval, None) {
        Ok(job_id) => Ok(RememberDispatchResult {
            source_path: Some(source.path),
            source_content_hash: Some(source.content_hash),
            ai_job_id: Some(job_id),
            ai_status: RememberAiStatus::Queued,
        }),
        Err(error) => {
            let failed_job_id = ai
                .record_failed_job(action, source.clone(), error.clone(), None)
                .ok();
            Ok(RememberDispatchResult {
                source_path: Some(source.path),
                source_content_hash: Some(source.content_hash),
                ai_job_id: failed_job_id,
                ai_status: RememberAiStatus::FailedToQueue,
            })
        }
    }
}

fn resolve_action_input(action: RememberActionInput) -> Result<ResolvedRememberAction, String> {
    if action.built_in {
        let mode = str_to_remember_mode(action.id.as_str())?;
        return Ok(ResolvedRememberAction {
            action_id: remember_mode_to_str(&mode).to_string(),
            action_label: mode.label().to_string(),
            action_prompt: None,
            mode,
        });
    }

    let label = action.label.trim().to_string();
    if label.is_empty() {
        return Err("Custom actions need a label.".to_string());
    }
    let prompt = action
        .prompt
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Custom actions need a prompt.".to_string())?;
    let mode = match action.action_kind {
        RememberActionKind::Exact => {
            return Err("Custom actions cannot use the exact action kind.".to_string())
        }
        RememberActionKind::SingleNote => RememberMode::CustomSingleNote,
        RememberActionKind::Advanced => RememberMode::CustomAdvanced,
    };

    Ok(ResolvedRememberAction {
        action_id: action.id.trim().to_string(),
        action_label: label,
        action_prompt: Some(prompt),
        mode,
    })
}

#[tauri::command]
pub(crate) fn list_inbox_items(ai: State<'_, AiState>) -> Result<Vec<InboxListItem>, String> {
    let connection = ai.connection()?;
    let jobs = list_jobs(&connection)?;
    Ok(jobs.into_iter().map(to_list_item).collect())
}

#[tauri::command]
pub(crate) fn get_inbox_item(
    ai: State<'_, AiState>,
    id: i64,
) -> Result<Option<InboxItemDetail>, String> {
    let connection = ai.connection()?;
    let Some(job) = load_job(&connection, id)? else {
        return Ok(None);
    };
    Ok(Some(to_detail_item(&job)?))
}

#[tauri::command]
pub(crate) fn approve_inbox_item(
    ai: State<'_, AiState>,
    id: i64,
) -> Result<Option<InboxItemDetail>, String> {
    let connection = ai.connection()?;
    let Some(job) = load_job(&connection, id)? else {
        return Ok(None);
    };
    if job.status != AiJobStatus::PendingApproval {
        return Ok(Some(to_detail_item(&job)?));
    }

    let updated = apply_pending_job(&ai, &job)?;
    ai.emit_inbox_changed()?;
    Ok(Some(to_detail_item(&updated)?))
}

#[tauri::command]
pub(crate) fn approve_inbox_item_with_changes(
    ai: State<'_, AiState>,
    id: i64,
    changes: Vec<AiChange>,
) -> Result<Option<InboxItemDetail>, String> {
    let connection = ai.connection()?;
    let Some(job) = load_job(&connection, id)? else {
        return Ok(None);
    };
    if job.status != AiJobStatus::PendingApproval {
        return Ok(Some(to_detail_item(&job)?));
    }

    if changes.is_empty() {
        let updated = update_job_status(
            &connection,
            job.id,
            AiJobStatus::Rejected,
            Some("Proposal rejected".to_string()),
            job.failure_reason.clone(),
            Some(Vec::new()),
            job.provider_kind.clone(),
            job.model.clone(),
            job.metrics.clone(),
        )?;
        ai.emit_inbox_changed()?;
        return Ok(Some(to_detail_item(&updated)?));
    }

    validate_override_changes(&job, &changes)?;
    let updated = update_job_status(
        &connection,
        job.id,
        AiJobStatus::PendingApproval,
        Some(job.summary.clone()),
        None,
        Some(changes),
        job.provider_kind.clone(),
        job.model.clone(),
        job.metrics.clone(),
    )?;
    let applied = apply_pending_job(&ai, &updated)?;
    ai.emit_inbox_changed()?;
    Ok(Some(to_detail_item(&applied)?))
}

#[tauri::command]
pub(crate) fn reject_inbox_item(
    ai: State<'_, AiState>,
    id: i64,
) -> Result<Option<InboxItemDetail>, String> {
    let connection = ai.connection()?;
    let Some(job) = load_job(&connection, id)? else {
        return Ok(None);
    };
    let updated = update_job_status(
        &connection,
        job.id,
        AiJobStatus::Rejected,
        Some("Proposal rejected".to_string()),
        job.failure_reason.clone(),
        Some(job.proposed_changes.clone()),
        job.provider_kind.clone(),
        job.model.clone(),
        job.metrics.clone(),
    )?;
    ai.emit_inbox_changed()?;
    Ok(Some(to_detail_item(&updated)?))
}

#[tauri::command]
pub(crate) fn retry_inbox_item(
    ai: State<'_, AiState>,
    id: i64,
) -> Result<Option<InboxItemDetail>, String> {
    let connection = ai.connection()?;
    let Some(job) = load_job(&connection, id)? else {
        return Ok(None);
    };
    if job.kind.is_exact() {
        return Ok(Some(to_detail_item(&job)?));
    }
    let retry_id = ai.enqueue_job(
        ResolvedRememberAction {
            mode: job.kind.clone(),
            action_id: job.action_id.clone(),
            action_label: job.action_label.clone(),
            action_prompt: job.action_prompt.clone(),
        },
        job.source.clone(),
        job.requires_approval,
        Some(id),
    )?;
    let retried =
        load_job(&connection, retry_id)?.ok_or_else(|| "Retry job disappeared".to_string())?;
    Ok(Some(to_detail_item(&retried)?))
}

#[tauri::command]
pub(crate) fn clear_inbox(ai: State<'_, AiState>) -> Result<ClearInboxResult, String> {
    let connection = ai.connection()?;
    let now = current_time_millis()?;
    let cancelled_jobs = connection
        .execute(
            "UPDATE ai_jobs
             SET status = ?1,
                 summary = COALESCE(NULLIF(summary, ''), 'Job cancelled'),
                 updated_at_millis = ?2
             WHERE status IN ('queued', 'running')",
            params![job_status_to_str(&AiJobStatus::Cancelled), now],
        )
        .map_err(|err| err.to_string())?;
    let removed_jobs = connection
        .execute(
            "DELETE FROM ai_jobs
             WHERE status IN ('applied', 'failed', 'stale', 'rejected')",
            [],
        )
        .map_err(|err| err.to_string())?;
    ai.emit_inbox_changed()?;
    Ok(ClearInboxResult {
        cancelled_jobs,
        removed_jobs,
    })
}

fn spawn_worker(
    app_handle: AppHandle,
    db_path: PathBuf,
    signal_rx: Receiver<WorkerSignal>,
    wake_pending: Arc<AtomicBool>,
) -> Result<(), String> {
    thread::Builder::new()
        .name("ai-job-worker".to_string())
        .spawn(move || worker_loop(app_handle, db_path, signal_rx, wake_pending))
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn worker_loop(
    app_handle: AppHandle,
    db_path: PathBuf,
    signal_rx: Receiver<WorkerSignal>,
    wake_pending: Arc<AtomicBool>,
) {
    while signal_rx.recv().is_ok() {
        wake_pending.store(false, Ordering::Release);
        loop {
            match claim_next_queued_job(&db_path) {
                Ok(Some(job)) => {
                    if let Err(error) = process_job(&app_handle, &db_path, job) {
                        eprintln!("ai job worker error: {error}");
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    eprintln!("ai job queue error: {error}");
                    break;
                }
            }
        }
    }
}

fn process_job(app_handle: &AppHandle, db_path: &Path, job: StoredAiJob) -> Result<(), String> {
    let started_at = Instant::now();
    let connection = open_database(db_path)?;
    ensure_schema(&connection)?;
    let settings = load_settings(&connection)?;
    let provider = build_provider(&settings)?;
    let proposal = if job.kind.is_exact() {
        return Ok(());
    } else if job.kind.is_edit_mode() {
        run_edit_job(&job, provider.as_ref())
    } else if job.kind.is_split_mode() {
        run_split_up_job(app_handle, &job, provider.as_ref())
    } else if job.kind.is_custom_advanced_mode() {
        run_custom_advanced_job(app_handle, &job, provider.as_ref())
    } else {
        run_integrate_job(app_handle, &job, provider.as_ref())
    };

    match proposal {
        Ok(mut proposal) => {
            if should_skip_job_update(&connection, job.id)? {
                return Ok(());
            }
            proposal.metrics.elapsed_millis =
                started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
            validate_job_changes(&job, &proposal.changes)?;
            if job.requires_approval {
                let updated = update_job_status(
                    &connection,
                    job.id,
                    AiJobStatus::PendingApproval,
                    Some(non_empty_summary(
                        proposal.summary,
                        default_summary_for_job(&job, "Proposal ready"),
                    )),
                    None,
                    Some(proposal.changes),
                    Some(proposal.provider_kind),
                    Some(proposal.model),
                    Some(proposal.metrics),
                )?;
                emit_inbox_changed(app_handle)?;
                let _ = updated;
            } else {
                if should_skip_job_update(&connection, job.id)? {
                    return Ok(());
                }
                let pending = update_job_status(
                    &connection,
                    job.id,
                    AiJobStatus::Running,
                    Some(non_empty_summary(
                        proposal.summary.clone(),
                        default_summary_for_job(&job, "Applying proposal"),
                    )),
                    None,
                    Some(proposal.changes.clone()),
                    Some(proposal.provider_kind.clone()),
                    Some(proposal.model.clone()),
                    Some(proposal.metrics.clone()),
                )?;
                let applied = apply_pending_job_inner(db_path, app_handle, &pending)?;
                let _ = applied;
                emit_inbox_changed(app_handle)?;
            }
        }
        Err(error) => {
            if should_skip_job_update(&connection, job.id)? {
                return Ok(());
            }
            update_job_status(
                &connection,
                job.id,
                AiJobStatus::Failed,
                Some(non_empty_summary(
                    error.clone(),
                    default_summary_for_job(&job, "AI job failed"),
                )),
                Some(error),
                None,
                Some(provider.provider_kind()),
                Some(load_settings(&connection)?.model),
                Some(AiRunMetrics {
                    elapsed_millis: started_at.elapsed().as_millis().min(u128::from(u64::MAX))
                        as u64,
                    prompt_tokens: None,
                    completion_tokens: None,
                    total_tokens: None,
                }),
            )?;
            emit_inbox_changed(app_handle)?;
        }
    }

    Ok(())
}

fn apply_pending_job(ai: &AiState, job: &StoredAiJob) -> Result<StoredAiJob, String> {
    let updated = apply_pending_job_inner(&ai.db_path, &ai.app_handle, job)?;
    Ok(updated)
}

fn apply_pending_job_inner(
    db_path: &Path,
    app_handle: &AppHandle,
    job: &StoredAiJob,
) -> Result<StoredAiJob, String> {
    let connection = open_database(db_path)?;
    ensure_schema(&connection)?;
    if should_skip_job_update(&connection, job.id)? {
        return load_job(&connection, job.id)?
            .ok_or_else(|| "Inbox item disappeared before apply".to_string());
    }
    match apply_job_changes(job) {
        Ok(()) => update_job_status(
            &connection,
            job.id,
            AiJobStatus::Applied,
            Some(non_empty_summary(
                job.summary.clone(),
                default_summary_for_job(job, "Applied"),
            )),
            None,
            Some(job.proposed_changes.clone()),
            job.provider_kind.clone(),
            job.model.clone(),
            job.metrics.clone(),
        ),
        Err(ApplyError::Stale(reason)) => update_job_status(
            &connection,
            job.id,
            AiJobStatus::Stale,
            Some("Proposal went stale".to_string()),
            Some(reason),
            Some(job.proposed_changes.clone()),
            job.provider_kind.clone(),
            job.model.clone(),
            job.metrics.clone(),
        ),
        Err(ApplyError::Failed(reason)) => update_job_status(
            &connection,
            job.id,
            AiJobStatus::Failed,
            Some("Applying the proposal failed".to_string()),
            Some(reason),
            Some(job.proposed_changes.clone()),
            job.provider_kind.clone(),
            job.model.clone(),
            job.metrics.clone(),
        ),
    }
    .inspect(|_| {
        let _ = emit_inbox_changed(app_handle);
    })
}

struct EditPromptProfile {
    system_prompt: &'static str,
    rules: Vec<&'static str>,
}

struct IntegratePromptProfile {
    plan_system_prompt: &'static str,
    edit_system_prompt: &'static str,
    plan_rules: Vec<&'static str>,
    edit_rules: Vec<&'static str>,
}

fn edit_prompt_profile(mode: &RememberMode) -> EditPromptProfile {
    let mut rules = vec![
        "Do not add new facts.",
        "Return only changes for the source note.",
        "Set newTitle to the current note title unless you are intentionally renaming the note.",
        "Use one updateNote change or an empty changes array.",
    ];

    let system_prompt = match mode {
        RememberMode::CleanUp => {
            "You aggressively clean up rough markdown notes without adding new facts. Preserve intent and meaning, but reorganize, reorder, rewrite, and structure the note so it becomes usable. Keep markdown plain. Return JSON only."
        }
        RememberMode::Summarize => {
            rules.push("Compress the note into a brief summary with concise supporting bullets.");
            rules.push("Prefer the highest-signal points and remove repetition, filler, and low-value detail.");
            "You condense rough markdown notes into short, high-signal summaries without adding new facts. Keep markdown plain. Return JSON only."
        }
        RememberMode::Outline => {
            rules.push("Reshape the note into a hierarchical outline with clear headings and nested bullets.");
            rules.push("Prefer structure and scanability over preserving the original prose.");
            "You transform rough markdown notes into clear outlines without adding new facts. Keep markdown plain. Return JSON only."
        }
        RememberMode::ActionItems => {
            rules.push("Center the note on next steps, blockers, and follow-up tasks.");
            rules.push("When the source implies a missing next step or unresolved issue, represent it as a markdown task using '* [ ]'.");
            "You rewrite rough markdown notes into action-oriented working notes without adding new facts. Emphasize tasks, blockers, and follow-ups. Keep markdown plain. Return JSON only."
        }
        RememberMode::Decisions => {
            rules.push("Pull explicit decisions, assumptions, and unresolved questions into clearly labeled sections.");
            rules.push("If the note contains uncertainty, preserve it as an open question rather than smoothing it over.");
            "You rewrite rough markdown notes into decision logs without adding new facts. Highlight decisions, assumptions, and unresolved questions. Keep markdown plain. Return JSON only."
        }
        RememberMode::MeetingNotes => {
            rules.push("Organize the note as a structured meeting record with sections such as context, discussion, decisions, and action items when supported by the source.");
            rules.push("Do not invent attendees, dates, or agenda items that are not present or implied.");
            "You rewrite rough markdown notes into structured meeting notes without adding new facts. Keep markdown plain. Return JSON only."
        }
        RememberMode::Evergreen => {
            rules.push("Rewrite fleeting phrasing into durable reference language when the meaning is clear.");
            rules.push("Prefer stable headings and reusable phrasing over journal-style narration.");
            "You transform rough markdown notes into durable evergreen notes without adding new facts. Preserve meaning while making the result reference-friendly. Keep markdown plain. Return JSON only."
        }
        RememberMode::Retitle => {
            rules.push("Choose a more specific, searchable title when the current title is vague or generic.");
            rules.push("Only make light body edits needed to align the note with the improved title.");
            "You improve note titles and lightly clean the supporting markdown without adding new facts. Prefer specific, searchable titles. Keep markdown plain. Return JSON only."
        }
        RememberMode::StudyGuide => {
            rules.push("Turn the note into a review sheet with key concepts, compact explanations, and self-check questions answerable from the source.");
            rules.push("Do not add answers or concepts that are not already supported by the source.");
            "You transform rough markdown notes into study guides without adding new facts. Emphasize concepts, memory cues, and self-check questions. Keep markdown plain. Return JSON only."
        }
        _ => {
            "You aggressively clean up rough markdown notes without adding new facts. Preserve intent and meaning, but reorganize, reorder, rewrite, and structure the note so it becomes usable. Keep markdown plain. Return JSON only."
        }
    };

    rules.insert(
        1,
        "You may rewrite wording, reorder content, improve structure, add headings, and add wikilinks when it clearly helps the chosen transformation."
    );
    rules.insert(
        2,
        "Preserve the note's intent and meaning even when changing its format.",
    );
    rules.insert(
        3,
        "You may collapse repetition and fix obvious inconsistencies when the intended meaning is clear."
    );

    EditPromptProfile {
        system_prompt,
        rules,
    }
}

fn integrate_prompt_profile(_mode: &RememberMode) -> IntegratePromptProfile {
    let plan_rules = vec![
        "Decide whether the source note should stay separate, integrate with existing notes, or merge into other notes.",
        "Prefer conservative decisions when confidence is low.",
        "Prefer absorbing content into existing notes when it clearly belongs there instead of keeping a separate note with wikilinks.",
        "A single source note may map to multiple existing notes when different sections clearly belong in different places.",
        "If most of the source can be absorbed, prefer integrate or merge over keepSeparate.",
        "Set deleteSource to true only when the meaningful content of the source should be fully absorbed elsewhere.",
        "Set deleteSource to false when meaningful remainder content should stay in the source note because it does not fit the chosen target notes.",
        "Only select targetNotePaths from candidateNotes.",
        "deleteSource may only be true when the source should be absorbed into another note.",
    ];
    let edit_rules = vec![
        "Return note-level changes only.",
        "updateNote and deleteNote paths must refer only to the source note or targetNotes paths provided here.",
        "createNote may be used when a new standalone note is better than overloading an existing note.",
        "deleteNote is allowed only for the source note and only if the source should be merged into other notes.",
        "Do not add new facts.",
        "Prefer direct integration over wikilinks when the content can naturally fit into an existing note.",
        "A single source note may be split across multiple target notes when different sections clearly belong in different places.",
        "Rewrite target notes so the absorbed content reads naturally there instead of feeling appended.",
        "Deduplicate overlapping information instead of keeping the same idea in multiple places.",
        "If content from the source does not fit the target notes, keep that meaningful remainder in the source note rather than forcing it elsewhere.",
        "If the source is fully absorbed into target notes, delete the source note.",
        "If the source is only partially absorbed, update the source note so it contains only the meaningful remainder.",
        "Only use wikilinks when they still add navigation value after integration, not as a substitute for integration.",
        "If a real ambiguity or missing context blocks clean integration, add follow-up tasks in markdown task format using '* [ ]' in the most relevant updated note.",
        "Every updateNote MUST include path, baseContentHash, newTitle, and newMarkdown.",
        "Every deleteNote MUST include path and baseContentHash.",
        "For updateNote, use the field name newMarkdown, not markdown.",
        "Copy baseContentHash exactly from sourceNote or targetNotes for the matching path.",
        "If you are not renaming a note, set newTitle to the current note title.",
    ];

    IntegratePromptProfile {
        plan_system_prompt: "You plan how a source note should be absorbed into a markdown knowledge base. Prefer real integration over superficial linking. Return JSON only.",
        edit_system_prompt: "You rewrite markdown notes so source content is actually integrated into the note set. Prefer absorbing content into the best existing notes over adding wikilinks. Return JSON only.",
        plan_rules,
        edit_rules,
    }
}

fn run_edit_job(
    job: &StoredAiJob,
    provider: &dyn GenerationProvider,
) -> Result<GeneratedProposal, String> {
    let user_instructions = if job.kind == RememberMode::CustomSingleNote {
        Some(
            job.action_prompt
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "Custom single-note action is missing its prompt.".to_string())?,
        )
    } else {
        None
    };
    let profile = if job.kind == RememberMode::CustomSingleNote {
        EditPromptProfile {
            system_prompt: "You apply a user-defined single-note transformation to markdown notes without adding new facts. Keep markdown plain and return JSON only.",
            rules: vec![
                "Do not add new facts.",
                "Return only changes for the source note.",
                "Preserve the note's meaning unless the user prompt explicitly asks for a stronger transformation.",
                "Use the user's instructions as the primary goal.",
                "Set newTitle to the current note title unless you are intentionally renaming the note.",
                "Use one updateNote change or an empty changes array.",
            ],
        }
    } else {
        edit_prompt_profile(&job.kind)
    };
    let mut user_prompt = json!({
        "task": remember_mode_to_str(&job.kind),
        "sourceNote": {
            "path": job.source.path,
            "title": job.source.title,
            "markdown": job.source.markdown,
            "baseContentHash": job.source.content_hash
        },
        "mode": remember_mode_to_str(&job.kind),
        "rules": profile.rules,
        "outputSchema": {
            "summary": "string",
            "changes": [
                {
                    "kind": "updateNote",
                    "path": "string",
                    "baseContentHash": "string",
                    "newTitle": "string",
                    "newMarkdown": "string"
                }
            ]
        }
    });
    if let Some(prompt) = user_instructions {
        user_prompt["userInstructions"] = Value::String(prompt);
    }
    let completion = provider.complete_json(profile.system_prompt, &user_prompt.to_string())?;
    let proposal: CleanUpProposal = parse_model_json(&completion.text)?;
    Ok(GeneratedProposal {
        summary: proposal.summary,
        changes: proposal.changes,
        provider_kind: provider.provider_kind(),
        model: completion.model,
        metrics: usage_to_metrics(completion.usage),
    })
}

fn run_custom_advanced_job(
    app_handle: &AppHandle,
    job: &StoredAiJob,
    provider: &dyn GenerationProvider,
) -> Result<GeneratedProposal, String> {
    let prompt = job
        .action_prompt
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Custom advanced action is missing its prompt.".to_string())?;
    let candidates = retrieve_optional_split_candidates(app_handle, &job.source);
    let target_context = load_split_target_note_contexts(&candidates, &job.source)?;
    let mut packed_targets = Vec::<Value>::new();
    for target in &target_context {
        packed_targets.push(json!({
            "path": target.path,
            "title": target.title,
            "markdown": target.markdown,
            "baseContentHash": target.content_hash
        }));
    }

    let user_prompt = json!({
        "task": "customAdvanced",
        "mode": "customAdvanced",
        "actionLabel": job.action_label,
        "sourceNote": {
            "path": job.source.path,
            "title": job.source.title,
            "markdown": job.source.markdown,
            "baseContentHash": job.source.content_hash
        },
        "candidateNotes": pack_candidate_notes(&candidates)?,
        "targetNotes": packed_targets,
        "userInstructions": prompt,
        "rules": [
            "Treat the user instructions as the primary goal.",
            "You may update the source note, update candidate target notes provided here, create new notes, and delete the source note when the user instructions clearly justify it.",
            "Only update existing notes when the fit is high confidence.",
            "Prefer creating new notes over forcing weak integrations into existing notes unless the user instructions clearly prefer integration.",
            "Do not add new facts.",
            "Avoid duplicating the same content across multiple notes.",
            "Every updateNote MUST include path, baseContentHash, newTitle, and newMarkdown.",
            "Every createNote MUST include suggestedTitle and markdown.",
            "Every deleteNote MUST include path and baseContentHash.",
            "For updateNote, use the field name newMarkdown, not markdown.",
            "Copy baseContentHash exactly from sourceNote or targetNotes for the matching path.",
            "If you are not renaming a note, set newTitle to the current note title."
        ],
        "outputSchema": {
            "summary": "string",
            "changes": [
                {
                    "kind": "updateNote",
                    "path": "string",
                    "baseContentHash": "string",
                    "newTitle": "string",
                    "newMarkdown": "string"
                },
                {
                    "kind": "createNote",
                    "suggestedTitle": "string",
                    "markdown": "string"
                },
                {
                    "kind": "deleteNote",
                    "path": "string",
                    "baseContentHash": "string"
                }
            ]
        }
    })
    .to_string();
    let completion = provider.complete_json(
        "You perform user-defined advanced note organization tasks across a markdown vault. Use the user's instructions, but stay structurally valid and do not add new facts. Return JSON only.",
        &user_prompt,
    )?;
    let response = parse_integrate_edit_response(&completion.text, job, &target_context)?;
    Ok(GeneratedProposal {
        summary: non_empty_summary(
            response.summary,
            default_summary_for_job(job, "Custom action proposal ready"),
        ),
        changes: response.changes,
        provider_kind: provider.provider_kind(),
        model: completion.model,
        metrics: usage_to_metrics(completion.usage),
    })
}

fn run_split_up_job(
    app_handle: &AppHandle,
    job: &StoredAiJob,
    provider: &dyn GenerationProvider,
) -> Result<GeneratedProposal, String> {
    let candidates = retrieve_optional_split_candidates(app_handle, &job.source);
    let target_context = load_split_target_note_contexts(&candidates, &job.source)?;
    let mut packed_targets = Vec::<Value>::new();
    for target in &target_context {
        packed_targets.push(json!({
            "path": target.path,
            "title": target.title,
            "markdown": target.markdown,
            "baseContentHash": target.content_hash
        }));
    }

    let user_prompt = json!({
        "task": "splitUp",
        "mode": "splitUp",
        "sourceNote": {
            "path": job.source.path,
            "title": job.source.title,
            "markdown": job.source.markdown,
            "baseContentHash": job.source.content_hash
        },
        "candidateNotes": pack_candidate_notes(&candidates)?,
        "targetNotes": packed_targets,
        "rules": [
            "Split the source note only when there are genuinely distinct themes, topics, or projects mixed together.",
            "Prefer creating new focused notes over editing existing notes.",
            "Only update an existing target note when the fit is high confidence and the source material clearly belongs there.",
            "You may update the source note and any targetNotes provided here.",
            "You may create multiple new notes when the source covers multiple themes.",
            "Do not delete any note.",
            "If splitting is useful, update the source note into a short index, overview, or meaningful remainder note instead of leaving it unchanged.",
            "If the source is already coherent as a single note, avoid unnecessary splitting.",
            "Choose specific, searchable titles for any createNote changes.",
            "Avoid duplicating the same content across multiple notes.",
            "Do not add new facts.",
            "Every updateNote MUST include path, baseContentHash, newTitle, and newMarkdown.",
            "Every createNote MUST include suggestedTitle and markdown.",
            "For updateNote, use the field name newMarkdown, not markdown.",
            "Copy baseContentHash exactly from sourceNote or targetNotes for the matching path.",
            "If you are not renaming a note, set newTitle to the current note title."
        ],
        "outputSchema": {
            "summary": "string",
            "changes": [
                {
                    "kind": "updateNote",
                    "path": "string",
                    "baseContentHash": "string",
                    "newTitle": "string",
                    "newMarkdown": "string"
                },
                {
                    "kind": "createNote",
                    "suggestedTitle": "string",
                    "markdown": "string"
                }
            ]
        }
    })
    .to_string();

    let completion = provider.complete_json(
        "You split mixed-topic markdown notes into focused notes. Prefer creating new notes for distinct themes. If an existing note is an excellent fit, you may integrate into it. Return JSON only.",
        &user_prompt,
    )?;
    let response = parse_integrate_edit_response(&completion.text, job, &target_context)?;
    Ok(GeneratedProposal {
        summary: non_empty_summary(
            response.summary,
            default_summary_for_job(job, "Split-up proposal ready"),
        ),
        changes: response.changes,
        provider_kind: provider.provider_kind(),
        model: completion.model,
        metrics: usage_to_metrics(completion.usage),
    })
}

fn run_integrate_job(
    app_handle: &AppHandle,
    job: &StoredAiJob,
    provider: &dyn GenerationProvider,
) -> Result<GeneratedProposal, String> {
    let profile = integrate_prompt_profile(&job.kind);
    let candidates = retrieve_integrate_candidates(app_handle, &job.source)?;
    let planning_completion = provider.complete_json(
        profile.plan_system_prompt,
        &build_integrate_plan_prompt(job, &candidates, &profile)?,
    )?;
    let plan: IntegratePlanResponse = parse_model_json(&planning_completion.text)?;
    let target_context = load_target_note_contexts(&plan, &candidates, &job.source)?;
    let edit_completion = provider.complete_json(
        profile.edit_system_prompt,
        &build_integrate_edit_prompt(job, &plan, &target_context, &profile)?,
    )?;
    let edit_response = parse_integrate_edit_response(&edit_completion.text, job, &target_context)?;
    let metrics = sum_metrics(
        usage_to_metrics(planning_completion.usage),
        usage_to_metrics(edit_completion.usage),
    );
    let summary = if edit_response.summary.trim().is_empty() {
        plan.summary
    } else {
        edit_response.summary
    };
    Ok(GeneratedProposal {
        summary: non_empty_summary(
            summary,
            default_summary_for_job(job, "Integration proposal ready"),
        ),
        changes: edit_response.changes,
        provider_kind: provider.provider_kind(),
        model: edit_completion.model,
        metrics,
    })
}

fn retrieve_optional_split_candidates(
    app_handle: &AppHandle,
    source: &SourceSnapshot,
) -> Vec<CandidateNote> {
    match retrieve_integrate_candidates(app_handle, source) {
        Ok(candidates) => candidates,
        Err(error) => {
            eprintln!("split-up candidate lookup skipped: {error}");
            Vec::new()
        }
    }
}

fn load_split_target_note_contexts(
    candidates: &[CandidateNote],
    source: &SourceSnapshot,
) -> Result<Vec<TargetNoteContext>, String> {
    let notes_dir = notes_root()?;
    let mut loaded = Vec::new();
    let mut consumed_chars = source.markdown.chars().count();

    for candidate in candidates.iter().take(MAX_INTEGRATE_PACKED_NOTES) {
        let path_buf = PathBuf::from(&candidate.path);
        if !is_valid_note_path(&path_buf, &notes_dir) || !path_buf.is_file() {
            continue;
        }
        let raw_markdown = fs::read_to_string(&path_buf).map_err(|err| err.to_string())?;
        let body = body_markdown_from_path_and_raw(&candidate.path, &raw_markdown);
        let next_chars = consumed_chars + body.chars().count();
        if !loaded.is_empty() && next_chars > MAX_EDIT_CONTEXT_CHARS {
            break;
        }
        consumed_chars = next_chars;
        loaded.push(TargetNoteContext {
            path: candidate.path.clone(),
            title: candidate.title.clone(),
            markdown: body,
            content_hash: content_hash(&raw_markdown),
        });
    }

    Ok(loaded)
}

fn retrieve_integrate_candidates(
    app_handle: &AppHandle,
    source: &SourceSnapshot,
) -> Result<Vec<CandidateNote>, String> {
    let state = app_handle
        .try_state::<AppState>()
        .ok_or_else(|| "App state is unavailable".to_string())?;
    let semantic_status = state.semantic.get_status()?;
    if !semantic_status.platform_supported {
        return Err(semantic_status
            .disabled_reason
            .unwrap_or_else(|| "Integrate requires semantic search support.".to_string()));
    }
    if !semantic_status.settings.semantic_search_enabled {
        return Err("Integrate requires semantic search to be enabled.".to_string());
    }

    let matches = state.semantic.semantic_matches_for_text(
        &source.markdown,
        Some(source.path.as_str()),
        MAX_INTEGRATE_CANDIDATE_NOTES * MAX_SNIPPETS_PER_NOTE * 2,
    )?;

    let mut grouped = Vec::<CandidateNote>::new();
    let mut by_path = HashMap::<String, usize>::new();
    for semantic_match in matches {
        if semantic_match.note_path == source.path {
            continue;
        }
        let index = if let Some(existing) = by_path.get(&semantic_match.note_path).copied() {
            existing
        } else {
            if grouped.len() >= MAX_INTEGRATE_CANDIDATE_NOTES {
                continue;
            }
            let next_index = grouped.len();
            by_path.insert(semantic_match.note_path.clone(), next_index);
            grouped.push(CandidateNote {
                path: semantic_match.note_path.clone(),
                title: semantic_match.note_title.clone(),
                snippets: Vec::new(),
            });
            next_index
        };
        if grouped[index].snippets.len() >= MAX_SNIPPETS_PER_NOTE {
            continue;
        }
        grouped[index].snippets.push(CandidateSnippet {
            section_label: semantic_match.section_label,
            excerpt: truncate_chars(&semantic_match.excerpt, MAX_SNIPPET_CHARS),
            score: semantic_match.score,
        });
    }

    Ok(grouped)
}

fn build_integrate_plan_prompt(
    job: &StoredAiJob,
    candidates: &[CandidateNote],
    profile: &IntegratePromptProfile,
) -> Result<String, String> {
    let packed_candidates = pack_candidate_notes(candidates)?;
    Ok(json!({
        "task": format!("{}-plan", remember_mode_to_str(&job.kind)),
        "mode": remember_mode_to_str(&job.kind),
        "sourceNote": {
            "path": job.source.path,
            "title": job.source.title,
            "markdown": job.source.markdown,
            "baseContentHash": job.source.content_hash
        },
        "candidateNotes": packed_candidates,
        "rules": profile.plan_rules,
        "outputSchema": {
            "summary": "string",
            "confidence": "low | medium | high",
            "strategy": "keepSeparate | integrate | merge",
            "targetNotePaths": ["string"],
            "deleteSource": "boolean"
        }
    })
    .to_string())
}

fn build_integrate_edit_prompt(
    job: &StoredAiJob,
    plan: &IntegratePlanResponse,
    targets: &[TargetNoteContext],
    profile: &IntegratePromptProfile,
) -> Result<String, String> {
    let mut packed_targets = Vec::<Value>::new();
    for target in targets {
        packed_targets.push(json!({
            "path": target.path,
            "title": target.title,
            "markdown": target.markdown,
            "baseContentHash": target.content_hash
        }));
    }
    Ok(json!({
        "task": format!("{}-edit", remember_mode_to_str(&job.kind)),
        "mode": remember_mode_to_str(&job.kind),
        "plan": plan,
        "sourceNote": {
            "path": job.source.path,
            "title": job.source.title,
            "markdown": job.source.markdown,
            "baseContentHash": job.source.content_hash
        },
        "targetNotes": packed_targets,
        "rules": profile.edit_rules,
        "outputSchema": {
            "summary": "string",
            "changes": [
                {
                    "kind": "updateNote",
                    "path": "string",
                    "baseContentHash": "string",
                    "newTitle": "string",
                    "newMarkdown": "string"
                },
                {
                    "kind": "createNote",
                    "suggestedTitle": "string",
                    "markdown": "string"
                },
                {
                    "kind": "deleteNote",
                    "path": "string",
                    "baseContentHash": "string"
                }
            ]
        }
    })
    .to_string())
}

fn load_target_note_contexts(
    plan: &IntegratePlanResponse,
    candidates: &[CandidateNote],
    source: &SourceSnapshot,
) -> Result<Vec<TargetNoteContext>, String> {
    let notes_dir = notes_root()?;
    let candidate_lookup = candidates
        .iter()
        .map(|candidate| (candidate.path.as_str(), candidate))
        .collect::<HashMap<_, _>>();
    let mut seen = HashSet::new();
    let mut loaded = Vec::new();
    let mut consumed_chars = source.markdown.chars().count();

    for path in &plan.target_note_paths {
        if !seen.insert(path.clone()) {
            continue;
        }
        let Some(candidate) = candidate_lookup.get(path.as_str()) else {
            continue;
        };
        let path_buf = PathBuf::from(&candidate.path);
        if !is_valid_note_path(&path_buf, &notes_dir) || !path_buf.is_file() {
            continue;
        }
        let raw_markdown = fs::read_to_string(&path_buf).map_err(|err| err.to_string())?;
        let body = body_markdown_from_path_and_raw(&candidate.path, &raw_markdown);
        let next_chars = consumed_chars + body.chars().count();
        if !loaded.is_empty() && next_chars > MAX_EDIT_CONTEXT_CHARS {
            break;
        }
        consumed_chars = next_chars;
        loaded.push(TargetNoteContext {
            path: candidate.path.clone(),
            title: candidate.title.clone(),
            markdown: body,
            content_hash: content_hash(&raw_markdown),
        });
    }

    Ok(loaded)
}

fn pack_candidate_notes(candidates: &[CandidateNote]) -> Result<Vec<Value>, String> {
    let mut packed = Vec::new();
    let mut consumed = 0usize;
    for candidate in candidates.iter().take(MAX_INTEGRATE_CANDIDATE_NOTES) {
        if packed.len() >= MAX_INTEGRATE_PACKED_NOTES {
            break;
        }
        let snippets = candidate
            .snippets
            .iter()
            .map(|snippet| {
                json!({
                    "sectionLabel": snippet.section_label,
                    "excerpt": snippet.excerpt,
                    "score": snippet.score
                })
            })
            .collect::<Vec<_>>();
        let candidate_value = json!({
            "path": candidate.path,
            "title": candidate.title,
            "snippets": snippets
        });
        let candidate_len = candidate_value.to_string().chars().count();
        if !packed.is_empty() && consumed + candidate_len > MAX_EDIT_CONTEXT_CHARS {
            break;
        }
        consumed += candidate_len;
        packed.push(candidate_value);
    }
    Ok(packed)
}

fn validate_job_changes(job: &StoredAiJob, changes: &[AiChange]) -> Result<(), String> {
    let mut update_paths = HashSet::new();
    let mut delete_paths = HashSet::new();
    for change in changes {
        match change {
            AiChange::UpdateNote { path, .. } => {
                if !update_paths.insert(path.clone()) {
                    return Err("Duplicate updateNote paths are not allowed.".to_string());
                }
            }
            AiChange::CreateNote { .. } => {}
            AiChange::DeleteNote { path, .. } => {
                if !job.kind.is_integrate_mode() && !job.kind.is_custom_advanced_mode() {
                    return Err("deleteNote is only allowed for integrate jobs.".to_string());
                }
                if path != &job.source.path {
                    return Err("deleteNote may only target the source note in v1.".to_string());
                }
                if !delete_paths.insert(path.clone()) {
                    return Err("Duplicate deleteNote paths are not allowed.".to_string());
                }
            }
        }
    }
    Ok(())
}

fn validate_override_changes(job: &StoredAiJob, changes: &[AiChange]) -> Result<(), String> {
    validate_job_changes(job, changes)?;

    let mut original_updates = HashMap::<&str, &str>::new();
    let mut original_deletes = HashMap::<&str, &str>::new();
    let mut original_creates = HashSet::<(&str, &str)>::new();
    for change in &job.proposed_changes {
        match change {
            AiChange::UpdateNote {
                path,
                base_content_hash,
                ..
            } => {
                original_updates.insert(path.as_str(), base_content_hash.as_str());
            }
            AiChange::CreateNote {
                suggested_title,
                markdown,
            } => {
                original_creates.insert((suggested_title.as_str(), markdown.as_str()));
            }
            AiChange::DeleteNote {
                path,
                base_content_hash,
            } => {
                original_deletes.insert(path.as_str(), base_content_hash.as_str());
            }
        }
    }

    for change in changes {
        match change {
            AiChange::UpdateNote {
                path,
                base_content_hash,
                ..
            } => {
                let Some(expected_hash) = original_updates.get(path.as_str()) else {
                    return Err(format!(
                        "Edited approval may only update notes from the original proposal: {path}"
                    ));
                };
                if expected_hash != &base_content_hash.as_str() {
                    return Err(format!(
                        "Edited approval must preserve the original base content hash for {path}"
                    ));
                }
            }
            AiChange::CreateNote {
                suggested_title,
                markdown,
            } => {
                if !original_creates.contains(&(suggested_title.as_str(), markdown.as_str())) {
                    return Err(
                        "Edited approval may only keep or drop createNote proposals as-is."
                            .to_string(),
                    );
                }
            }
            AiChange::DeleteNote {
                path,
                base_content_hash,
            } => {
                let Some(expected_hash) = original_deletes.get(path.as_str()) else {
                    return Err(format!(
                        "Edited approval may only delete notes from the original proposal: {path}"
                    ));
                };
                if expected_hash != &base_content_hash.as_str() {
                    return Err(format!(
                        "Edited approval must preserve the original base content hash for {path}"
                    ));
                }
            }
        }
    }

    Ok(())
}

fn apply_job_changes(job: &StoredAiJob) -> Result<(), ApplyError> {
    let notes_dir = notes_root().map_err(ApplyError::Failed)?;
    let raw_source_markdown =
        fs::read_to_string(&job.source.path).map_err(|err| ApplyError::Stale(err.to_string()))?;
    if content_hash(&raw_source_markdown) != job.source.content_hash {
        return Err(ApplyError::Stale(
            "The source note changed after the AI job was created.".to_string(),
        ));
    }

    let mut validated_updates = Vec::new();
    let mut validated_deletes = Vec::new();
    for change in &job.proposed_changes {
        match change {
            AiChange::UpdateNote {
                path,
                base_content_hash,
                ..
            } => {
                let path_buf = PathBuf::from(path);
                if !is_valid_note_path(&path_buf, &notes_dir) || !path_buf.is_file() {
                    return Err(ApplyError::Stale(format!("Note no longer exists: {path}")));
                }
                let current = fs::read_to_string(&path_buf)
                    .map_err(|err| ApplyError::Stale(err.to_string()))?;
                if content_hash(&current) != *base_content_hash {
                    return Err(ApplyError::Stale(format!(
                        "Note changed since the proposal was generated: {path}"
                    )));
                }
                validated_updates.push((change.clone(), path_buf));
            }
            AiChange::CreateNote { .. } => {}
            AiChange::DeleteNote {
                path,
                base_content_hash,
            } => {
                let path_buf = PathBuf::from(path);
                if !is_valid_note_path(&path_buf, &notes_dir) || !path_buf.is_file() {
                    return Err(ApplyError::Stale(format!("Note no longer exists: {path}")));
                }
                let current = fs::read_to_string(&path_buf)
                    .map_err(|err| ApplyError::Stale(err.to_string()))?;
                if content_hash(&current) != *base_content_hash {
                    return Err(ApplyError::Stale(format!(
                        "Note changed since the proposal was generated: {path}"
                    )));
                }
                validated_deletes.push(path_buf);
            }
        }
    }

    for change in &job.proposed_changes {
        match change {
            AiChange::UpdateNote {
                path,
                new_title,
                new_markdown,
                ..
            } => {
                let current_path = PathBuf::from(path);
                let resolved_title = if new_title.trim().is_empty() {
                    fallback_title_for_path(path)
                } else {
                    new_title.clone()
                };
                persist_note(
                    &notes_dir,
                    &resolved_title,
                    new_markdown,
                    Some(current_path.as_path()),
                )
                .map_err(ApplyError::Failed)?
                .ok_or_else(|| ApplyError::Failed("Failed to persist updated note.".to_string()))?;
            }
            AiChange::CreateNote {
                suggested_title,
                markdown,
            } => {
                persist_note(&notes_dir, suggested_title, markdown, None)
                    .map_err(ApplyError::Failed)?
                    .ok_or_else(|| ApplyError::Failed("Failed to create new note.".to_string()))?;
            }
            AiChange::DeleteNote { path, .. } => {
                fs::remove_file(path).map_err(|err| ApplyError::Failed(err.to_string()))?;
            }
        }
    }

    let _ = validated_updates;
    let _ = validated_deletes;
    Ok(())
}

fn to_list_item(job: StoredAiJob) -> InboxListItem {
    InboxListItem {
        id: job.id,
        kind: job.kind.clone(),
        action_label: job.action_label.clone(),
        status: job.status.clone(),
        title: job_title(&job),
        summary: non_empty_summary(job.summary.clone(), default_summary_for_job(&job, "Ready")),
        source_path: job.source.path.clone(),
        source_title: job.source.title.clone(),
        affected_notes: affected_notes(&job.proposed_changes),
        created_at_millis: job.created_at_millis,
        updated_at_millis: job.updated_at_millis,
    }
}

fn to_detail_item(job: &StoredAiJob) -> Result<InboxItemDetail, String> {
    Ok(InboxItemDetail {
        id: job.id,
        kind: job.kind.clone(),
        action_label: job.action_label.clone(),
        status: job.status.clone(),
        title: job_title(job),
        summary: non_empty_summary(job.summary.clone(), default_summary_for_job(job, "Ready")),
        source_path: job.source.path.clone(),
        source_title: job.source.title.clone(),
        source_markdown: job.source.markdown.clone(),
        source_content_hash: job.source.content_hash.clone(),
        provider_kind: job.provider_kind.clone(),
        model: job.model.clone(),
        requires_approval: job.requires_approval,
        failure_reason: job.failure_reason.clone(),
        metrics: job.metrics.clone(),
        proposed_changes: job.proposed_changes.clone(),
        change_previews: build_change_previews(&job.proposed_changes)?,
        created_at_millis: job.created_at_millis,
        updated_at_millis: job.updated_at_millis,
    })
}

fn build_change_previews(changes: &[AiChange]) -> Result<Vec<AiChangePreview>, String> {
    let mut previews = Vec::new();
    for change in changes {
        match change {
            AiChange::UpdateNote { path, .. } | AiChange::DeleteNote { path, .. } => {
                let path_buf = PathBuf::from(path);
                let (current_title, current_markdown) = if path_buf.is_file() {
                    let raw = fs::read_to_string(&path_buf).map_err(|err| err.to_string())?;
                    let title = fallback_title_for_path(path);
                    let (resolved_title, body) =
                        note::extract_file_name_title_and_body(&raw, &title);
                    (Some(resolved_title), Some(body))
                } else {
                    (None, None)
                };
                previews.push(AiChangePreview {
                    change: change.clone(),
                    current_title,
                    current_markdown,
                });
            }
            AiChange::CreateNote { .. } => previews.push(AiChangePreview {
                change: change.clone(),
                current_title: None,
                current_markdown: None,
            }),
        }
    }
    Ok(previews)
}

fn build_provider(
    settings: &StoredAiSettings,
) -> Result<Box<dyn GenerationProvider + Send + Sync>, String> {
    match settings.provider_kind {
        AiProviderKind::OpenAiCompatible => {
            let api_key = settings
                .api_key
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    "Set an API key in Settings before using AI remember modes.".to_string()
                })?;
            if settings.model.trim().is_empty() {
                return Err("Set a model in Settings before using AI remember modes.".to_string());
            }
            Ok(Box::new(OpenAiCompatibleProvider {
                client: Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(AI_CONNECT_TIMEOUT_SECS))
                    .timeout(std::time::Duration::from_secs(AI_COMPLETION_TIMEOUT_SECS))
                    .build()
                    .map_err(|err| err.to_string())?,
                base_url: normalize_base_url(&settings.base_url),
                model: settings.model.clone(),
                api_key,
            }))
        }
        AiProviderKind::LlamaServer => Err(
            "The local llama-server generation provider is reserved for future support."
                .to_string(),
        ),
    }
}

impl GenerationProvider for OpenAiCompatibleProvider {
    fn complete_json(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<ModelCompletion, String> {
        let response = self
            .client
            .post(format!(
                "{}/chat/completions",
                self.base_url.trim_end_matches('/')
            ))
            .bearer_auth(&self.api_key)
            .json(&json!({
                "model": self.model,
                "response_format": { "type": "text" },
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": user_prompt }
                ]
            }))
            .send()
            .map_err(|err| err.to_string())?;

        if !response.status().is_success() {
            return Err(response
                .text()
                .unwrap_or_else(|_| "Model request failed".to_string()));
        }

        let body: Value = response.json().map_err(|err| err.to_string())?;
        let content = extract_completion_text(&body)?;
        let model = body
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or(self.model.as_str())
            .to_string();
        Ok(ModelCompletion {
            text: content,
            model,
            usage: UsageTotals {
                prompt_tokens: body
                    .get("usage")
                    .and_then(|usage| usage.get("prompt_tokens"))
                    .and_then(Value::as_u64),
                completion_tokens: body
                    .get("usage")
                    .and_then(|usage| usage.get("completion_tokens"))
                    .and_then(Value::as_u64),
                total_tokens: body
                    .get("usage")
                    .and_then(|usage| usage.get("total_tokens"))
                    .and_then(Value::as_u64),
            },
        })
    }

    fn provider_kind(&self) -> AiProviderKind {
        AiProviderKind::OpenAiCompatible
    }
}

fn fetch_openai_compatible_models(
    base_url: &str,
    api_key: &str,
) -> Result<Vec<AiModelOption>, String> {
    let client = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(AI_CONNECT_TIMEOUT_SECS))
        .timeout(std::time::Duration::from_secs(AI_MODEL_LIST_TIMEOUT_SECS))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(format!("{}/models", base_url.trim_end_matches('/')))
        .bearer_auth(api_key)
        .send()
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(response
            .text()
            .unwrap_or_else(|_| "Model discovery failed".to_string()));
    }

    let body: Value = response.json().map_err(|err| err.to_string())?;
    let mut models = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "Model response did not include a data array.".to_string())?
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .filter(|id| !id.trim().is_empty())
        .map(|id| AiModelOption { id: id.to_string() })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    Ok(models)
}

fn extract_completion_text(body: &Value) -> Result<String, String> {
    let Some(choice) = body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
    else {
        return Err("Model response did not include any choices.".to_string());
    };

    let Some(message) = choice.get("message") else {
        return Err("Model response did not include a message.".to_string());
    };

    if let Some(content) = message
        .get("content")
        .and_then(Value::as_str)
        .filter(|content| !content.trim().is_empty())
    {
        return Ok(content.to_string());
    }

    if let Some(parts) = message.get("content").and_then(Value::as_array) {
        let mut text = String::new();
        for part in parts {
            if let Some(part_text) = part.get("text").and_then(Value::as_str) {
                text.push_str(part_text);
            }
        }
        if !text.trim().is_empty() {
            return Ok(text);
        }
    }

    if message
        .get("reasoning_content")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(
            "Model returned reasoning text but no final assistant content. Choose a non-thinking model or disable reasoning output in the server."
                .to_string(),
        );
    }

    Err("Model response did not include text content.".to_string())
}

fn parse_model_json<T>(value: &str) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let trimmed = value.trim();
    let without_fence = trimmed
        .strip_prefix("```json")
        .and_then(|rest| rest.strip_suffix("```"))
        .or_else(|| {
            trimmed
                .strip_prefix("```")
                .and_then(|rest| rest.strip_suffix("```"))
        })
        .map(str::trim)
        .unwrap_or(trimmed);
    let candidate = extract_first_json_value(without_fence).unwrap_or(without_fence);
    serde_json::from_str(candidate).map_err(|err| err.to_string())
}

fn parse_integrate_edit_response(
    value: &str,
    job: &StoredAiJob,
    targets: &[TargetNoteContext],
) -> Result<IntegrateEditResponse, String> {
    let trimmed = value.trim();
    let without_fence = trimmed
        .strip_prefix("```json")
        .and_then(|rest| rest.strip_suffix("```"))
        .or_else(|| {
            trimmed
                .strip_prefix("```")
                .and_then(|rest| rest.strip_suffix("```"))
        })
        .map(str::trim)
        .unwrap_or(trimmed);
    let candidate = extract_first_json_value(without_fence).unwrap_or(without_fence);
    let mut root: Value = serde_json::from_str(candidate).map_err(|err| err.to_string())?;

    let mut known_paths = HashMap::<String, (String, String)>::new();
    known_paths.insert(
        job.source.path.clone(),
        (job.source.content_hash.clone(), job.source.title.clone()),
    );
    for target in targets {
        known_paths.insert(
            target.path.clone(),
            (target.content_hash.clone(), target.title.clone()),
        );
    }

    if let Some(changes) = root.get_mut("changes").and_then(Value::as_array_mut) {
        for change in changes {
            let Some(object) = change.as_object_mut() else {
                continue;
            };
            let kind = object
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let path = object
                .get("path")
                .and_then(Value::as_str)
                .map(str::to_string);

            if kind == "updateNote" {
                if !object.contains_key("newMarkdown") {
                    if let Some(markdown) = object.remove("markdown") {
                        object.insert("newMarkdown".to_string(), markdown);
                    }
                }
                if let Some(path) = path.as_ref() {
                    if let Some((content_hash, title)) = known_paths.get(path) {
                        if !object.contains_key("baseContentHash") {
                            object.insert(
                                "baseContentHash".to_string(),
                                Value::String(content_hash.clone()),
                            );
                        }
                        if !object.contains_key("newTitle")
                            || object
                                .get("newTitle")
                                .and_then(Value::as_str)
                                .is_some_and(|value| value.trim().is_empty())
                        {
                            object.insert("newTitle".to_string(), Value::String(title.clone()));
                        }
                    }
                }
            } else if kind == "deleteNote" {
                if let Some(path) = path.as_ref() {
                    if let Some((content_hash, _)) = known_paths.get(path) {
                        if !object.contains_key("baseContentHash") {
                            object.insert(
                                "baseContentHash".to_string(),
                                Value::String(content_hash.clone()),
                            );
                        }
                    }
                }
            }
        }
    }

    serde_json::from_value(root).map_err(|err| err.to_string())
}

fn extract_first_json_value(value: &str) -> Option<&str> {
    let start = value.char_indices().find_map(|(index, ch)| match ch {
        '{' | '[' => Some((index, ch)),
        _ => None,
    })?;
    let (start_index, opening) = start;
    let closing = match opening {
        '{' => '}',
        '[' => ']',
        _ => return None,
    };

    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in value[start_index..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match ch {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' if opening == '{' => depth += 1,
            '[' if opening == '[' => depth += 1,
            ch if ch == closing => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let end_index = start_index + index + ch.len_utf8();
                    return Some(value[start_index..end_index].trim());
                }
            }
            _ => {}
        }
    }

    None
}

fn build_source_snapshot(path: &str, raw_markdown: &str) -> SourceSnapshot {
    SourceSnapshot {
        path: path.to_string(),
        title: fallback_title_for_path(path),
        markdown: body_markdown_from_path_and_raw(path, raw_markdown),
        content_hash: content_hash(raw_markdown),
    }
}

fn body_markdown_from_path_and_raw(path: &str, raw_markdown: &str) -> String {
    let fallback_title = fallback_title_for_path(path);
    let (_, body) = note::extract_file_name_title_and_body(raw_markdown, &fallback_title);
    body
}

fn fallback_title_for_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn job_title(job: &StoredAiJob) -> String {
    if job.kind.is_exact() {
        format!("Remember exact: {}", job.source.title)
    } else {
        format!("{}: {}", job.action_label, job.source.title)
    }
}

fn default_summary_for_job(job: &StoredAiJob, fallback: &str) -> String {
    if job.kind.is_exact() {
        fallback.to_string()
    } else {
        format!("{fallback} for \"{}\".", job.source.title)
    }
}

fn affected_notes(changes: &[AiChange]) -> Vec<String> {
    let mut affected = Vec::new();
    let mut seen = HashSet::new();
    for change in changes {
        let label = match change {
            AiChange::UpdateNote { path, .. } | AiChange::DeleteNote { path, .. } => {
                fallback_title_for_path(path)
            }
            AiChange::CreateNote {
                suggested_title, ..
            } => suggested_title.clone(),
        };
        if seen.insert(label.clone()) {
            affected.push(label);
        }
    }
    affected
}

fn usage_to_metrics(usage: UsageTotals) -> AiRunMetrics {
    AiRunMetrics {
        elapsed_millis: 0,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
    }
}

fn sum_metrics(left: AiRunMetrics, right: AiRunMetrics) -> AiRunMetrics {
    AiRunMetrics {
        elapsed_millis: 0,
        prompt_tokens: sum_optional(left.prompt_tokens, right.prompt_tokens),
        completion_tokens: sum_optional(left.completion_tokens, right.completion_tokens),
        total_tokens: sum_optional(left.total_tokens, right.total_tokens),
    }
}

fn sum_optional(left: Option<u64>, right: Option<u64>) -> Option<u64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left + right),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn non_empty_summary(summary: String, fallback: String) -> String {
    if summary.trim().is_empty() {
        fallback
    } else {
        summary
    }
}

fn normalize_base_url(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        DEFAULT_OPENAI_BASE_URL.to_string()
    } else {
        trimmed.to_string()
    }
}

fn public_ai_settings(settings: StoredAiSettings) -> AiSettings {
    AiSettings {
        provider_kind: settings.provider_kind,
        base_url: settings.base_url,
        model: settings.model,
        api_key_configured: settings
            .api_key
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty()),
    }
}

fn open_database(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let connection = Connection::open(path).map_err(|err| err.to_string())?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|err| err.to_string())?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|err| err.to_string())?;
    Ok(connection)
}

fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS ai_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                provider_kind TEXT NOT NULL,
                base_url TEXT NOT NULL,
                model TEXT NOT NULL,
                api_key TEXT,
                updated_at_millis INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                action_id TEXT NOT NULL DEFAULT '',
                action_label TEXT NOT NULL DEFAULT '',
                action_prompt TEXT,
                status TEXT NOT NULL,
                source_path TEXT NOT NULL,
                source_title TEXT NOT NULL,
                source_markdown TEXT NOT NULL,
                source_content_hash TEXT NOT NULL,
                requires_approval INTEGER NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                proposed_changes_json TEXT,
                failure_reason TEXT,
                provider_kind TEXT,
                model TEXT,
                metrics_json TEXT,
                retry_of_job_id INTEGER,
                created_at_millis INTEGER NOT NULL,
                updated_at_millis INTEGER NOT NULL
            );
            ",
        )
        .map_err(|err| err.to_string())?;
    ensure_column(
        connection,
        "ALTER TABLE ai_jobs ADD COLUMN action_id TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        connection,
        "ALTER TABLE ai_jobs ADD COLUMN action_label TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        connection,
        "ALTER TABLE ai_jobs ADD COLUMN action_prompt TEXT",
    )?;
    Ok(())
}

fn ensure_column(connection: &Connection, statement: &str) -> Result<(), String> {
    match connection.execute(statement, []) {
        Ok(_) => Ok(()),
        Err(err) if err.to_string().contains("duplicate column name") => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

fn ensure_default_settings(connection: &Connection) -> Result<(), String> {
    let exists = connection
        .query_row("SELECT COUNT(*) FROM ai_settings WHERE id = 1", [], |row| {
            row.get::<_, usize>(0)
        })
        .map_err(|err| err.to_string())?;
    if exists > 0 {
        return Ok(());
    }
    connection
        .execute(
            "INSERT INTO ai_settings (
                id,
                provider_kind,
                base_url,
                model,
                api_key,
                updated_at_millis
             ) VALUES (1, ?1, ?2, ?3, NULL, ?4)",
            params![
                provider_kind_to_str(&AiProviderKind::OpenAiCompatible),
                DEFAULT_OPENAI_BASE_URL,
                "",
                current_time_millis()?,
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn load_settings(connection: &Connection) -> Result<StoredAiSettings, String> {
    connection
        .query_row(
            "SELECT provider_kind, base_url, model, api_key FROM ai_settings WHERE id = 1",
            [],
            |row| {
                let provider_kind = str_to_provider_kind(row.get::<_, String>(0)?.as_str())
                    .map_err(|err| {
                        rusqlite::Error::FromSqlConversionFailure(
                            0,
                            rusqlite::types::Type::Text,
                            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
                        )
                    })?;
                Ok(StoredAiSettings {
                    provider_kind,
                    base_url: row.get(1)?,
                    model: row.get(2)?,
                    api_key: row.get(3)?,
                })
            },
        )
        .map_err(|err| err.to_string())
}

fn save_settings(connection: &Connection, settings: &StoredAiSettings) -> Result<(), String> {
    connection
        .execute(
            "UPDATE ai_settings
             SET provider_kind = ?1,
                 base_url = ?2,
                 model = ?3,
                 api_key = ?4,
                 updated_at_millis = ?5
             WHERE id = 1",
            params![
                provider_kind_to_str(&settings.provider_kind),
                settings.base_url,
                settings.model,
                settings.api_key,
                current_time_millis()?,
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn insert_job(connection: &Connection, job: &StoredAiJob) -> Result<i64, String> {
    connection
        .execute(
            "INSERT INTO ai_jobs (
                kind,
                action_id,
                action_label,
                action_prompt,
                status,
                source_path,
                source_title,
                source_markdown,
                source_content_hash,
                requires_approval,
                summary,
                proposed_changes_json,
                failure_reason,
                provider_kind,
                model,
                metrics_json,
                retry_of_job_id,
                created_at_millis,
                updated_at_millis
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                remember_mode_to_str(&job.kind),
                job.action_id,
                job.action_label,
                job.action_prompt,
                job_status_to_str(&job.status),
                job.source.path,
                job.source.title,
                job.source.markdown,
                job.source.content_hash,
                if job.requires_approval { 1 } else { 0 },
                job.summary,
                serialize_changes(&job.proposed_changes)?,
                job.failure_reason,
                job.provider_kind.as_ref().map(provider_kind_to_str),
                job.model,
                serialize_metrics(&job.metrics)?,
                job.retry_of_job_id,
                job.created_at_millis,
                job.updated_at_millis,
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(connection.last_insert_rowid())
}

fn list_jobs(connection: &Connection) -> Result<Vec<StoredAiJob>, String> {
    list_jobs_with_filter(connection, true)
}

fn list_jobs_including_cancelled(connection: &Connection) -> Result<Vec<StoredAiJob>, String> {
    list_jobs_with_filter(connection, false)
}

fn list_jobs_with_filter(
    connection: &Connection,
    hide_cancelled: bool,
) -> Result<Vec<StoredAiJob>, String> {
    let filter_clause = if hide_cancelled {
        "WHERE status != 'cancelled'"
    } else {
        ""
    };
    let mut statement = connection
        .prepare(&format!(
            "SELECT
                id,
                kind,
                action_id,
                action_label,
                action_prompt,
                status,
                source_path,
                source_title,
                source_markdown,
                source_content_hash,
                requires_approval,
                summary,
                proposed_changes_json,
                failure_reason,
                provider_kind,
                model,
                metrics_json,
                retry_of_job_id,
                created_at_millis,
                updated_at_millis
             FROM ai_jobs
             {filter_clause}
             ORDER BY updated_at_millis DESC, id DESC"
        ))
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| row_to_job(row))
        .map_err(|err| err.to_string())?;
    let mut jobs = Vec::new();
    for row in rows {
        jobs.push(row.map_err(|err| err.to_string())?);
    }
    Ok(jobs)
}

fn load_job(connection: &Connection, id: i64) -> Result<Option<StoredAiJob>, String> {
    connection
        .query_row(
            "SELECT
                id,
                kind,
                action_id,
                action_label,
                action_prompt,
                status,
                source_path,
                source_title,
                source_markdown,
                source_content_hash,
                requires_approval,
                summary,
                proposed_changes_json,
                failure_reason,
                provider_kind,
                model,
                metrics_json,
                retry_of_job_id,
                created_at_millis,
                updated_at_millis
             FROM ai_jobs
             WHERE id = ?1",
            params![id],
            |row| row_to_job(row),
        )
        .optional()
        .map_err(|err| err.to_string())
}

fn claim_next_queued_job(db_path: &Path) -> Result<Option<StoredAiJob>, String> {
    let connection = open_database(db_path)?;
    ensure_schema(&connection)?;
    let Some(job) = connection
        .query_row(
            "SELECT
                id,
                kind,
                action_id,
                action_label,
                action_prompt,
                status,
                source_path,
                source_title,
                source_markdown,
                source_content_hash,
                requires_approval,
                summary,
                proposed_changes_json,
                failure_reason,
                provider_kind,
                model,
                metrics_json,
                retry_of_job_id,
                created_at_millis,
                updated_at_millis
             FROM ai_jobs
             WHERE status = 'queued'
             ORDER BY created_at_millis ASC, id ASC
             LIMIT 1",
            [],
            |row| row_to_job(row),
        )
        .optional()
        .map_err(|err| err.to_string())?
    else {
        return Ok(None);
    };

    let updated = update_job_status(
        &connection,
        job.id,
        AiJobStatus::Running,
        Some("AI job is running".to_string()),
        None,
        Some(job.proposed_changes.clone()),
        job.provider_kind.clone(),
        job.model.clone(),
        job.metrics.clone(),
    )?;
    Ok(Some(updated))
}

fn update_job_status(
    connection: &Connection,
    id: i64,
    status: AiJobStatus,
    summary: Option<String>,
    failure_reason: Option<String>,
    proposed_changes: Option<Vec<AiChange>>,
    provider_kind: Option<AiProviderKind>,
    model: Option<String>,
    metrics: Option<AiRunMetrics>,
) -> Result<StoredAiJob, String> {
    let current = load_job(connection, id)?.ok_or_else(|| "Inbox item not found".to_string())?;
    let next_summary = summary.unwrap_or(current.summary);
    let next_failure_reason = failure_reason.or(current.failure_reason);
    let next_changes = proposed_changes.unwrap_or(current.proposed_changes);
    let next_provider_kind = provider_kind.or(current.provider_kind);
    let next_model = model.or(current.model);
    let next_metrics = metrics.or(current.metrics);
    let now = current_time_millis()?;

    connection
        .execute(
            "UPDATE ai_jobs
             SET status = ?2,
                 summary = ?3,
                 failure_reason = ?4,
                 proposed_changes_json = ?5,
                 provider_kind = ?6,
                 model = ?7,
                 metrics_json = ?8,
                 updated_at_millis = ?9
             WHERE id = ?1",
            params![
                id,
                job_status_to_str(&status),
                next_summary,
                next_failure_reason,
                serialize_changes(&next_changes)?,
                next_provider_kind.as_ref().map(provider_kind_to_str),
                next_model,
                serialize_metrics(&next_metrics)?,
                now,
            ],
        )
        .map_err(|err| err.to_string())?;

    load_job(connection, id)?.ok_or_else(|| "Inbox item disappeared after update".to_string())
}

fn should_skip_job_update(connection: &Connection, id: i64) -> Result<bool, String> {
    let Some(job) = load_job(connection, id)? else {
        return Ok(true);
    };
    Ok(job.status == AiJobStatus::Cancelled)
}

fn row_to_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredAiJob> {
    let kind_text = row.get::<_, String>(1)?;
    let status_text = row.get::<_, String>(5)?;
    let provider_kind = row
        .get::<_, Option<String>>(14)?
        .map(|value| str_to_provider_kind(value.as_str()))
        .transpose()
        .map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                14,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?;
    let proposed_changes_json = row.get::<_, Option<String>>(12)?;
    let metrics_json = row.get::<_, Option<String>>(16)?;
    Ok(StoredAiJob {
        id: row.get(0)?,
        kind: str_to_remember_mode(kind_text.as_str()).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                1,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?,
        action_id: row.get(2)?,
        action_label: row.get(3)?,
        action_prompt: row.get(4)?,
        status: str_to_job_status(status_text.as_str()).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?,
        source: SourceSnapshot {
            path: row.get(6)?,
            title: row.get(7)?,
            markdown: row.get(8)?,
            content_hash: row.get(9)?,
        },
        requires_approval: row.get::<_, i64>(10)? == 1,
        summary: row.get(11)?,
        proposed_changes: deserialize_changes(proposed_changes_json.as_deref()).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                12,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?,
        failure_reason: row.get(13)?,
        provider_kind,
        model: row.get(15)?,
        metrics: deserialize_metrics(metrics_json.as_deref()).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                16,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?,
        retry_of_job_id: row.get(17)?,
        created_at_millis: row.get(18)?,
        updated_at_millis: row.get(19)?,
    })
}

fn serialize_changes(changes: &[AiChange]) -> Result<Option<String>, String> {
    if changes.is_empty() {
        return Ok(None);
    }
    serde_json::to_string(changes)
        .map(Some)
        .map_err(|err| err.to_string())
}

fn deserialize_changes(value: Option<&str>) -> Result<Vec<AiChange>, String> {
    match value {
        Some(value) => serde_json::from_str(value).map_err(|err| err.to_string()),
        None => Ok(Vec::new()),
    }
}

fn serialize_metrics(metrics: &Option<AiRunMetrics>) -> Result<Option<String>, String> {
    match metrics {
        Some(metrics) => serde_json::to_string(metrics)
            .map(Some)
            .map_err(|err| err.to_string()),
        None => Ok(None),
    }
}

fn deserialize_metrics(value: Option<&str>) -> Result<Option<AiRunMetrics>, String> {
    match value {
        Some(value) => serde_json::from_str(value)
            .map(Some)
            .map_err(|err| err.to_string()),
        None => Ok(None),
    }
}

fn remember_mode_to_str(mode: &RememberMode) -> &'static str {
    match mode {
        RememberMode::Exact => "exact",
        RememberMode::CleanUp => "cleanUp",
        RememberMode::Summarize => "summarize",
        RememberMode::Outline => "outline",
        RememberMode::ActionItems => "actionItems",
        RememberMode::Decisions => "decisions",
        RememberMode::MeetingNotes => "meetingNotes",
        RememberMode::Evergreen => "evergreen",
        RememberMode::Retitle => "retitle",
        RememberMode::StudyGuide => "studyGuide",
        RememberMode::SplitUp => "splitUp",
        RememberMode::Integrate => "integrate",
        RememberMode::CustomSingleNote => "customSingleNote",
        RememberMode::CustomAdvanced => "customAdvanced",
    }
}

fn str_to_remember_mode(value: &str) -> Result<RememberMode, String> {
    match value {
        "exact" => Ok(RememberMode::Exact),
        "cleanUp" => Ok(RememberMode::CleanUp),
        "summarize" => Ok(RememberMode::Summarize),
        "outline" => Ok(RememberMode::Outline),
        "actionItems" => Ok(RememberMode::ActionItems),
        "decisions" => Ok(RememberMode::Decisions),
        "meetingNotes" => Ok(RememberMode::MeetingNotes),
        "evergreen" => Ok(RememberMode::Evergreen),
        "retitle" => Ok(RememberMode::Retitle),
        "studyGuide" => Ok(RememberMode::StudyGuide),
        "splitUp" => Ok(RememberMode::SplitUp),
        "integrate" => Ok(RememberMode::Integrate),
        "customSingleNote" => Ok(RememberMode::CustomSingleNote),
        "customAdvanced" => Ok(RememberMode::CustomAdvanced),
        _ => Err(format!("Unknown remember mode: {value}")),
    }
}

fn job_status_to_str(status: &AiJobStatus) -> &'static str {
    match status {
        AiJobStatus::Queued => "queued",
        AiJobStatus::Running => "running",
        AiJobStatus::PendingApproval => "pendingApproval",
        AiJobStatus::Applied => "applied",
        AiJobStatus::Rejected => "rejected",
        AiJobStatus::Failed => "failed",
        AiJobStatus::Stale => "stale",
        AiJobStatus::Cancelled => "cancelled",
    }
}

fn str_to_job_status(value: &str) -> Result<AiJobStatus, String> {
    match value {
        "queued" => Ok(AiJobStatus::Queued),
        "running" => Ok(AiJobStatus::Running),
        "pendingApproval" => Ok(AiJobStatus::PendingApproval),
        "applied" => Ok(AiJobStatus::Applied),
        "rejected" => Ok(AiJobStatus::Rejected),
        "failed" => Ok(AiJobStatus::Failed),
        "stale" => Ok(AiJobStatus::Stale),
        "cancelled" => Ok(AiJobStatus::Cancelled),
        _ => Err(format!("Unknown ai job status: {value}")),
    }
}

fn provider_kind_to_str(value: &AiProviderKind) -> &'static str {
    match value {
        AiProviderKind::OpenAiCompatible => "openAiCompatible",
        AiProviderKind::LlamaServer => "llamaServer",
    }
}

fn str_to_provider_kind(value: &str) -> Result<AiProviderKind, String> {
    match value {
        "openAiCompatible" => Ok(AiProviderKind::OpenAiCompatible),
        "llamaServer" => Ok(AiProviderKind::LlamaServer),
        _ => Err(format!("Unknown ai provider kind: {value}")),
    }
}

fn emit_inbox_changed(app_handle: &AppHandle) -> Result<(), String> {
    app_handle
        .emit(INBOX_CHANGED_EVENT, json!({ "updated": true }))
        .map_err(|err| err.to_string())
}

fn build_ai_diagnostics_metrics(jobs: &[StoredAiJob]) -> AiDiagnosticsMetrics {
    let mut metrics = AiDiagnosticsMetrics::default();
    for job in jobs {
        let Some(run_metrics) = job.metrics.as_ref() else {
            continue;
        };
        metrics.run_count += 1;
        let prompt_tokens = run_metrics.prompt_tokens.unwrap_or(0);
        let completion_tokens = run_metrics.completion_tokens.unwrap_or(0);
        let total_tokens = run_metrics
            .total_tokens
            .unwrap_or(prompt_tokens + completion_tokens);
        metrics.prompt_tokens_total += prompt_tokens;
        metrics.completion_tokens_total += completion_tokens;
        metrics.total_tokens_total += total_tokens;
        metrics.prompt_tokens_max = metrics.prompt_tokens_max.max(prompt_tokens);
        metrics.completion_tokens_max = metrics.completion_tokens_max.max(completion_tokens);
        metrics.total_tokens_max = metrics.total_tokens_max.max(total_tokens);
        let should_replace_last_run = match metrics.last_run.as_ref() {
            Some(last_run) => job.updated_at_millis > last_run.updated_at_millis,
            None => true,
        };
        if should_replace_last_run {
            metrics.last_run = Some(AiDiagnosticsLastRun {
                kind: job.kind.clone(),
                action_label: job.action_label.clone(),
                status: job.status.clone(),
                model: job.model.clone(),
                prompt_tokens: run_metrics.prompt_tokens,
                completion_tokens: run_metrics.completion_tokens,
                total_tokens: run_metrics.total_tokens,
                elapsed_millis: run_metrics.elapsed_millis,
                updated_at_millis: job.updated_at_millis,
            });
        }
    }
    metrics
}

enum ApplyError {
    Stale(String),
    Failed(String),
}

#[cfg(test)]
mod tests {
    use super::{
        parse_integrate_edit_response, parse_model_json, str_to_job_status, str_to_provider_kind,
        validate_job_changes, validate_override_changes, AiChange, AiJobStatus, AiProviderKind,
        RememberMode, SourceSnapshot, StoredAiJob, TargetNoteContext,
    };

    #[test]
    fn parse_model_json_accepts_code_fences() {
        let proposal: serde_json::Value =
            parse_model_json("```json\n{\"summary\":\"ok\",\"changes\":[]}\n```")
                .expect("parse fenced json");
        assert_eq!(proposal["summary"], "ok");
    }

    #[test]
    fn parse_model_json_ignores_trailing_special_tokens() {
        let proposal: serde_json::Value =
            parse_model_json("{\"summary\":\"ok\",\"changes\":[]}\n<|im_end|>\n")
                .expect("parse json with trailing token");
        assert_eq!(proposal["summary"], "ok");
    }

    #[test]
    fn parse_integrate_edit_response_normalizes_common_model_shape_errors() {
        let job = StoredAiJob {
            id: 1,
            kind: RememberMode::Integrate,
            action_id: "integrate".to_string(),
            action_label: "Integrate".to_string(),
            action_prompt: None,
            status: AiJobStatus::Running,
            source: SourceSnapshot {
                path: "/notes/Character.md".to_string(),
                title: "Character".to_string(),
                markdown: "source body".to_string(),
                content_hash: "source-hash".to_string(),
            },
            requires_approval: true,
            summary: String::new(),
            proposed_changes: Vec::new(),
            failure_reason: None,
            provider_kind: None,
            model: None,
            metrics: None,
            created_at_millis: 0,
            updated_at_millis: 0,
            retry_of_job_id: None,
        };
        let targets = vec![TargetNoteContext {
            path: "/notes/DND Character Upu Dupu.md".to_string(),
            title: "DND Character Upu Dupu".to_string(),
            markdown: "target body".to_string(),
            content_hash: "target-hash".to_string(),
        }];

        let response = parse_integrate_edit_response(
            r#"{
              "summary": "Merged character note",
              "changes": [
                {
                  "kind": "updateNote",
                  "path": "/notes/DND Character Upu Dupu.md",
                  "markdown": "merged markdown"
                },
                {
                  "kind": "deleteNote",
                  "path": "/notes/Character.md"
                }
              ]
            }<|im_end|>"#,
            &job,
            &targets,
        )
        .expect("normalize integrate edit response");

        assert_eq!(response.changes.len(), 2);
        match &response.changes[0] {
            AiChange::UpdateNote {
                path,
                base_content_hash,
                new_title,
                new_markdown,
            } => {
                assert_eq!(path, "/notes/DND Character Upu Dupu.md");
                assert_eq!(base_content_hash, "target-hash");
                assert_eq!(new_title, "DND Character Upu Dupu");
                assert_eq!(new_markdown, "merged markdown");
            }
            other => panic!("expected updateNote, got {other:?}"),
        }
        match &response.changes[1] {
            AiChange::DeleteNote {
                path,
                base_content_hash,
            } => {
                assert_eq!(path, "/notes/Character.md");
                assert_eq!(base_content_hash, "source-hash");
            }
            other => panic!("expected deleteNote, got {other:?}"),
        }
    }

    #[test]
    fn delete_note_is_rejected_for_cleanup_jobs() {
        let job = StoredAiJob {
            id: 1,
            kind: RememberMode::CleanUp,
            action_id: "cleanUp".to_string(),
            action_label: "Clean Up".to_string(),
            action_prompt: None,
            status: AiJobStatus::Queued,
            source: SourceSnapshot {
                path: "/tmp/Source.md".to_string(),
                title: "Source".to_string(),
                markdown: "Body".to_string(),
                content_hash: "hash".to_string(),
            },
            requires_approval: false,
            summary: String::new(),
            proposed_changes: Vec::new(),
            failure_reason: None,
            provider_kind: None,
            model: None,
            metrics: None,
            created_at_millis: 0,
            updated_at_millis: 0,
            retry_of_job_id: None,
        };
        let error = validate_job_changes(
            &job,
            &[AiChange::DeleteNote {
                path: "/tmp/Source.md".to_string(),
                base_content_hash: "hash".to_string(),
            }],
        )
        .expect_err("cleanup delete should fail");
        assert!(error.contains("deleteNote"));
    }

    #[test]
    fn validate_override_changes_accepts_update_subset_with_same_base_hash() {
        let job = StoredAiJob {
            id: 1,
            kind: RememberMode::Integrate,
            action_id: "integrate".to_string(),
            action_label: "Integrate".to_string(),
            action_prompt: None,
            status: AiJobStatus::PendingApproval,
            source: SourceSnapshot {
                path: "/notes/source.md".to_string(),
                title: "Source".to_string(),
                markdown: "Body".to_string(),
                content_hash: "source-hash".to_string(),
            },
            requires_approval: true,
            summary: String::new(),
            proposed_changes: vec![AiChange::UpdateNote {
                path: "/notes/target.md".to_string(),
                base_content_hash: "target-hash".to_string(),
                new_title: "Target".to_string(),
                new_markdown: "proposed".to_string(),
            }],
            failure_reason: None,
            provider_kind: None,
            model: None,
            metrics: None,
            created_at_millis: 0,
            updated_at_millis: 0,
            retry_of_job_id: None,
        };

        validate_override_changes(
            &job,
            &[AiChange::UpdateNote {
                path: "/notes/target.md".to_string(),
                base_content_hash: "target-hash".to_string(),
                new_title: "Target".to_string(),
                new_markdown: "edited".to_string(),
            }],
        )
        .expect("allow edited markdown with same base hash");
    }

    #[test]
    fn validate_override_changes_rejects_unknown_update_paths() {
        let job = StoredAiJob {
            id: 1,
            kind: RememberMode::Integrate,
            action_id: "integrate".to_string(),
            action_label: "Integrate".to_string(),
            action_prompt: None,
            status: AiJobStatus::PendingApproval,
            source: SourceSnapshot {
                path: "/notes/source.md".to_string(),
                title: "Source".to_string(),
                markdown: "Body".to_string(),
                content_hash: "source-hash".to_string(),
            },
            requires_approval: true,
            summary: String::new(),
            proposed_changes: vec![AiChange::UpdateNote {
                path: "/notes/target.md".to_string(),
                base_content_hash: "target-hash".to_string(),
                new_title: "Target".to_string(),
                new_markdown: "proposed".to_string(),
            }],
            failure_reason: None,
            provider_kind: None,
            model: None,
            metrics: None,
            created_at_millis: 0,
            updated_at_millis: 0,
            retry_of_job_id: None,
        };

        let error = validate_override_changes(
            &job,
            &[AiChange::UpdateNote {
                path: "/notes/other.md".to_string(),
                base_content_hash: "target-hash".to_string(),
                new_title: "Other".to_string(),
                new_markdown: "edited".to_string(),
            }],
        )
        .expect_err("reject unknown path");
        assert!(error.contains("original proposal"));
    }

    #[test]
    fn provider_kind_parsing_handles_reserved_local_provider() {
        assert_eq!(
            str_to_provider_kind("llamaServer").expect("parse provider"),
            AiProviderKind::LlamaServer
        );
    }

    #[test]
    fn job_status_round_trips_pending_approval() {
        assert_eq!(
            str_to_job_status("pendingApproval").expect("parse status"),
            AiJobStatus::PendingApproval
        );
    }
}
