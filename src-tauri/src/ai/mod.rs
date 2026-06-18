use crate::{
    commands::note_persistence::{persist_note_session_with_outcome, NotePersistenceMode},
    index::AppState,
    semantic::db::content_hash,
    state::{is_valid_note_path, notes_root, persist_note},
    time::current_time_millis,
};
mod approval_service;
mod provider;
mod remember_orchestrator;
mod secret_store;
mod store;
use approval_service::{
    approve_inbox_item as approve_inbox_item_impl,
    approve_inbox_item_with_changes as approve_inbox_item_with_changes_impl,
    clear_inbox as clear_inbox_impl, reject_inbox_item as reject_inbox_item_impl,
    retry_inbox_item as retry_inbox_item_impl,
};

use provider::{
    build_provider, fetch_openai_compatible_models, parse_integrate_edit_response,
    parse_model_json, usage_to_metrics, GenerationProvider,
};
use remember_orchestrator::{spawn_worker, WorkerSignal};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
        Arc,
    },
};
use store::{
    body_markdown_from_path_and_raw, build_ai_diagnostics_metrics, build_source_snapshot,
    claim_next_queued_job, default_summary_for_job, ensure_default_settings, ensure_schema,
    fallback_title_for_path, insert_job, job_status_to_str, list_jobs,
    list_jobs_including_cancelled, load_job, load_settings, non_empty_summary, normalize_base_url,
    open_database, public_ai_settings, remember_mode_to_str, save_settings, should_skip_job_update,
    str_to_remember_mode, sum_metrics, to_detail_item, to_list_item, truncate_chars,
    update_job_status, SourceSnapshot, StoredAiJob, StoredAiSettings, AI_DB_FILE_NAME,
};
use tauri::{AppHandle, Emitter, Manager, State};

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
    /// Canonical inbox list after the clear, so the frontend can apply it
    /// without an extra `list_inbox_items` round trip.
    pub(crate) items: Vec<InboxListItem>,
}

/// Delta returned by inbox mutation commands so the frontend can apply the
/// updated list and selected detail without an additional
/// `list_inbox_items` / `get_inbox_item` round trip.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InboxMutationDelta {
    pub(crate) item: Option<InboxItemDetail>,
    pub(crate) items: Vec<InboxListItem>,
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
#[allow(clippy::enum_variant_names)]
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

#[derive(Clone, Debug)]
struct ResolvedRememberAction {
    mode: RememberMode,
    action_id: String,
    action_label: String,
    action_prompt: Option<String>,
}

pub(crate) struct AiState {
    db_path: PathBuf,
    app_handle: AppHandle,
    signal_tx: Sender<WorkerSignal>,
    wake_pending: Arc<AtomicBool>,
}

impl AiState {
    pub(crate) fn new(app_handle: AppHandle) -> Result<Self, String> {
        // Vault-local, portable: ai.sqlite3 holds vault-specific AI content
        // (jobs, proposals, history) + non-secret provider config under
        // `<vault>/.gneauxghts`. Secrets live in the app-global secret store.
        let db_path = crate::state::vault_data_dir()?.join(AI_DB_FILE_NAME);

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
        if let Some(app_data) = self.app_handle.try_state::<crate::app::AppData>() {
            app_data.events.inbox_changed();
            Ok(())
        } else {
            self.app_handle
                .emit(INBOX_CHANGED_EVENT, json!({ "updated": true }))
                .map_err(|err| err.to_string())
        }
    }

    pub(crate) fn load_public_settings(&self) -> Result<AiSettings, String> {
        let connection = self.connection()?;
        Self::load_settings_with_secret(&connection).map(public_ai_settings)
    }

    /// Load provider config from the vault DB and layer the API key in from
    /// the app-global secret store. The vault DB never holds the secret, so
    /// it must be merged here for any caller that needs the live key.
    fn load_settings_with_secret(connection: &Connection) -> Result<StoredAiSettings, String> {
        let mut settings = load_settings(connection)?;
        settings.api_key = secret_store::get_secret(secret_store::AI_API_KEY)?;
        Ok(settings)
    }

    fn save_settings(&self, update: AiSettingsUpdate) -> Result<AiSettings, String> {
        let connection = self.connection()?;
        let current = Self::load_settings_with_secret(&connection)?;
        // Whether the caller explicitly supplied a key field (Some, possibly
        // empty) — distinct from leaving it untouched (None).
        let api_key_provided = update.api_key.is_some();
        // Resolve the next key: an explicit new value replaces it, an
        // explicit empty value clears it, and `None` leaves the existing
        // global secret untouched.
        let next_api_key = match update.api_key {
            Some(api_key) => {
                let trimmed = api_key.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }
            None => current.api_key.clone(),
        };
        let next = StoredAiSettings {
            provider_kind: update.provider_kind,
            base_url: normalize_base_url(&update.base_url),
            model: update.model.trim().to_string(),
            api_key: next_api_key.clone(),
        };
        // Non-secret provider config goes to the vault DB (api_key column is
        // forced NULL there); the secret goes only to the global store. When
        // the caller passed an explicit api_key we always write it through
        // (covering the "clear" case); otherwise we leave the store as-is.
        save_settings(&connection, &next)?;
        if api_key_provided {
            secret_store::set_secret(secret_store::AI_API_KEY, next_api_key.as_deref())?;
        }
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
pub(crate) async fn list_ai_models(
    ai: State<'_, AiState>,
    base_url: Option<String>,
    api_key: Option<String>,
) -> Result<Vec<AiModelOption>, String> {
    let db_path = ai.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_database(&db_path)?;
        ensure_schema(&connection)?;
        ensure_default_settings(&connection)?;
        let mut settings = load_settings(&connection)?;
        settings.api_key = secret_store::get_secret(secret_store::AI_API_KEY)?;
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

        fetch_openai_compatible_models(&resolved_base_url, &resolved_api_key)
    })
    .await
    .map_err(|err| err.to_string())?
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
        let trimmed_frontend_label = action.label.trim();
        let action_label = if trimmed_frontend_label.is_empty() {
            mode.label().to_string()
        } else {
            trimmed_frontend_label.to_string()
        };
        return Ok(ResolvedRememberAction {
            action_id: remember_mode_to_str(&mode).to_string(),
            action_label,
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
) -> Result<InboxMutationDelta, String> {
    approve_inbox_item_impl(&ai, id)
}

#[tauri::command]
pub(crate) fn approve_inbox_item_with_changes(
    ai: State<'_, AiState>,
    id: i64,
    changes: Vec<AiChange>,
) -> Result<InboxMutationDelta, String> {
    approve_inbox_item_with_changes_impl(&ai, id, changes)
}

#[tauri::command]
pub(crate) fn reject_inbox_item(
    ai: State<'_, AiState>,
    id: i64,
) -> Result<InboxMutationDelta, String> {
    reject_inbox_item_impl(&ai, id)
}

#[tauri::command]
pub(crate) fn retry_inbox_item(
    ai: State<'_, AiState>,
    id: i64,
) -> Result<InboxMutationDelta, String> {
    retry_inbox_item_impl(&ai, id)
}

#[tauri::command]
pub(crate) fn clear_inbox(ai: State<'_, AiState>) -> Result<ClearInboxResult, String> {
    clear_inbox_impl(&ai)
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

#[cfg(test)]
mod tests {
    use super::store::{str_to_job_status, str_to_provider_kind};
    use super::{
        parse_integrate_edit_response, parse_model_json, AiChange, AiJobStatus, AiProviderKind,
        RememberMode, SourceSnapshot, StoredAiJob, TargetNoteContext,
    };

    mod secret_split {
        use super::super::store::{
            ensure_default_settings, ensure_schema, load_settings, open_database, save_settings,
            StoredAiSettings,
        };
        use super::super::AiProviderKind;
        use crate::test_support::{TestDir, TEST_ENV_GUARD};
        use rusqlite::Connection;

        fn raw_stored_api_key(connection: &Connection) -> Option<String> {
            connection
                .query_row("SELECT api_key FROM ai_settings WHERE id = 1", [], |row| {
                    row.get::<_, Option<String>>(0)
                })
                .expect("read raw api_key")
        }

        #[test]
        fn save_settings_never_writes_api_key_into_vault_db() {
            let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
            let dir = TestDir::new("ai-vault-no-secret");
            let db_path = dir.path().join("ai.sqlite3");
            let connection = open_database(&db_path).expect("open");
            ensure_schema(&connection).expect("schema");
            ensure_default_settings(&connection).expect("defaults");

            // Even when StoredAiSettings carries a key, the vault DB column
            // must be written NULL — the portable vault never holds secrets.
            save_settings(
                &connection,
                &StoredAiSettings {
                    provider_kind: AiProviderKind::OpenAiCompatible,
                    base_url: "https://api.example.com/v1".to_string(),
                    model: "gpt-x".to_string(),
                    api_key: Some("sk-should-not-persist".to_string()),
                },
            )
            .expect("save");

            assert_eq!(raw_stored_api_key(&connection), None);
            // Non-secret provider config is still persisted to the vault DB.
            let reloaded = load_settings(&connection).expect("reload");
            assert_eq!(reloaded.base_url, "https://api.example.com/v1");
            assert_eq!(reloaded.model, "gpt-x");
            assert_eq!(reloaded.api_key, None);
        }
    }

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
