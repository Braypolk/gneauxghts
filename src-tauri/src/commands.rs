pub(crate) mod asset_commands;
pub(crate) mod atlas_commands;
pub(crate) mod chat_commands;
pub(crate) mod forgotten_note_commands;
pub(crate) mod history_commands;
mod index_bridge;
pub(crate) mod note_persistence;
mod note_session;
pub(crate) mod proposal_commands;
pub(crate) mod search_commands;
pub(crate) mod task_commands;
pub(crate) mod wikilink_commands;

pub(crate) use note_session::{
    load_note_session_from_notes_dir_with_state, open_note_from_notes_dir_with_state,
    read_note_session_from_path, resolve_note_path_input_with_state,
};

#[cfg(test)]
pub(crate) use note_session::{load_note_session_from_notes_dir, open_note_from_notes_dir};

use crate::{
    index::AppState,
    semantic::{
        debug::SemanticDebugSnapshot, embed::SemanticModelDownloadResult, SemanticSettings,
        SemanticStatus,
    },
    state::{
        create_vault_folder as create_vault_folder_state, current_vault_info,
        db_clear_last_opened_note, db_mark_note_opened,
        list_vault_folders as list_vault_folders_state, stage_notes_root, CreateVaultFolderResult,
        VaultFolderInfo, VaultInfo,
    },
    time::current_time_millis,
};
use note_persistence::{persist_note_session_with_outcome, persist_task_note_session_with_outcome};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use task_commands::{
    delete_task_with_view as delete_task_impl, list_recent_tasks as list_recent_tasks_impl,
    list_tasks as list_tasks_impl, set_note_collapsed as set_note_collapsed_impl,
    set_note_hidden as set_note_hidden_impl, set_note_order as set_note_order_impl,
    set_task_hidden as set_task_hidden_impl, toggle_task_with_view as toggle_task_impl,
};
use tauri::{Manager, State};

/// Keep blocking domain work and state lookup off the IPC executor. The outer
/// error is dispatch failure; each command retains its own domain error contract.
async fn on_app_worker<R, T, E>(
    app: tauri::AppHandle<R>,
    operation: impl FnOnce(&AppState) -> Result<T, E> + Send + 'static,
) -> Result<Result<T, E>, String>
where
    R: tauri::Runtime,
    T: Send + 'static,
    E: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app
            .try_state::<AppState>()
            .ok_or_else(|| "Application state unavailable".to_string())?;
        Ok(operation(&state))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Legacy "max age" parameter still passed to
/// [`AppState::ensure_interactive_index`] for call-site compatibility.
/// The foreground hot path no longer triggers full vault scans on
/// staleness — that work has moved to the background reconciliation
/// loop in `vault_watcher::spawn_background_reconcile_loop`. This
/// constant is kept (rather than removing every call site argument) so
/// that `ensure_interactive_index` retains a stable signature; its
/// runtime value is intentionally ignored.
const INTERACTIVE_INDEX_REFRESH_MAX_AGE: Duration = Duration::from_millis(750);
const ASSETS_DIRECTORY_NAME: &str = "assets";
const DEFAULT_PASTED_IMAGE_NAME: &str = "Pasted image";

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteSession {
    pub(crate) note_id: Option<String>,
    pub(crate) title: String,
    pub(crate) markdown: String,
    pub(crate) path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) commit_warning: Option<crate::services::note_timeline::NoteMutationWarning>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedNoteLink {
    note_id: String,
    note_path: String,
    section_label: String,
    match_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    block_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line_number: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteLinkSuggestion {
    kind: String,
    value: String,
    label: String,
    detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredImageAsset {
    file_name: String,
    file_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TaskFilter {
    Open,
    Completed,
    All,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskListItem {
    note_id: String,
    task_key: String,
    task_id: String,
    note_path: String,
    file_name: String,
    note_title: String,
    section_label: Option<String>,
    text: String,
    completed: bool,
    hidden: bool,
    note_hidden: bool,
    note_collapsed: bool,
    depth: usize,
    line_number: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    editor_line_number: Option<usize>,
    created_at_millis: u64,
    updated_at_millis: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskListGroup {
    pub(crate) note_id: String,
    pub(crate) note_path: String,
    pub(crate) note_title: String,
    pub(crate) file_name: String,
    pub(crate) note_hidden: bool,
    pub(crate) note_collapsed: bool,
    pub(crate) display_tasks: Vec<TaskListItem>,
    pub(crate) hidden_count: usize,
    pub(crate) visible_count: usize,
    pub(crate) display_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskListGroupPatch {
    pub(crate) note_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) note_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) group: Option<TaskListGroup>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) commit_warning: Option<crate::services::note_timeline::NoteMutationWarning>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentTaskItem {
    note_id: String,
    task_key: String,
    note_path: String,
    note_title: String,
    text: String,
    line_number: usize,
    updated_at_millis: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForgottenNoteSummary {
    forgotten_path: String,
    original_path: String,
    title: String,
    file_name: String,
    forgotten_at_millis: u64,
    purge_after_days: u32,
    purge_at_millis: u64,
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    commit_warning: Option<crate::services::note_timeline::NoteMutationWarning>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoredForgottenNote {
    forgotten_path: String,
    restored_path: String,
    title: String,
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    commit_warning: Option<crate::services::note_timeline::NoteMutationWarning>,
}

/// Minimum interval between background passes of `cleanup_expired_forgotten_notes`.
/// The cleanup used to run on every save/open/list invocation; throttling it
/// keeps it off interactive hot paths while still giving the same eventual
/// purge guarantees.
const FORGOTTEN_NOTE_CLEANUP_INTERVAL: Duration = Duration::from_secs(60 * 5);

static LAST_FORGOTTEN_NOTE_CLEANUP_AT: std::sync::Mutex<Option<std::time::Instant>> =
    std::sync::Mutex::new(None);

fn maybe_run_forgotten_note_cleanup(notes_dir: &Path, state: &AppState) -> Result<(), String> {
    let mut last = LAST_FORGOTTEN_NOTE_CLEANUP_AT
        .lock()
        .map_err(|_| "Forgotten note cleanup lock poisoned".to_string())?;
    let due = last
        .map(|previous| previous.elapsed() >= FORGOTTEN_NOTE_CLEANUP_INTERVAL)
        .unwrap_or(true);
    if !due {
        return Ok(());
    }
    *last = Some(std::time::Instant::now());
    drop(last);
    forgotten_note_commands::cleanup_expired_forgotten_notes(notes_dir, state)
}

pub(crate) fn startup_cleanup_expired_forgotten_notes(state: &AppState) -> Result<(), String> {
    let notes_dir = state.running_vault().root().to_path_buf();
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    let mut last = LAST_FORGOTTEN_NOTE_CLEANUP_AT
        .lock()
        .map_err(|_| "Forgotten note cleanup lock poisoned".to_string())?;
    *last = Some(std::time::Instant::now());
    drop(last);
    forgotten_note_commands::cleanup_expired_forgotten_notes(&notes_dir, state)
}

fn prepare_notes_dir(state: &AppState, cleanup_forgotten_notes: bool) -> Result<PathBuf, String> {
    prepare_notes_dir_with_state(cleanup_forgotten_notes, state)
}

fn prepare_notes_dir_with_state(
    cleanup_forgotten_notes: bool,
    state: &AppState,
) -> Result<PathBuf, String> {
    let notes_dir = state.running_vault().root().to_path_buf();
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    if cleanup_forgotten_notes {
        // The previous behaviour ran the full forgotten-note cleanup on every
        // save/open/list invocation. We now throttle to a background cadence
        // so common interactive commands no longer pay for it.
        maybe_run_forgotten_note_cleanup(&notes_dir, state)?;
    }
    Ok(notes_dir)
}

#[tauri::command]
pub(crate) async fn load_note_session<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<NoteSession, String> {
    on_app_worker(app, move |state| {
        // Foreground guard: while this IPC call is running the background
        // index queue (cold-start prewarm + save-side projection) yields
        // between per-note jobs so the SQLite state mutex stays free for
        // `read_state_with_lookup` / `write_last_opened_and_recents`.
        let _foreground_guard = state.foreground_guard();
        // Background startup maintenance owns forgotten-note cleanup and recovery.
        // Canonical session restoration never waits for that maintenance.
        let notes_dir = prepare_notes_dir_with_state(false, state)?;
        load_note_session_from_notes_dir_with_state(&notes_dir, Some(state))
    })
    .await?
}

#[tauri::command]
pub(crate) fn open_note(
    state: State<'_, AppState>,
    note_id: Option<String>,
    path: Option<String>,
) -> Result<NoteSession, String> {
    // See `load_note_session` for the rationale on the foreground guard.
    let _foreground_guard = state.foreground_guard();
    let notes_dir = prepare_notes_dir_with_state(false, &state)?;
    open_note_from_notes_dir_with_state(&notes_dir, note_id, path, Some(&state))
}

#[tauri::command]
pub(crate) fn read_note(
    state: State<'_, AppState>,
    note_id: Option<String>,
    path: Option<String>,
) -> Result<NoteSession, String> {
    let _foreground_guard = state.foreground_guard();
    let notes_dir = prepare_notes_dir_with_state(false, &state)?;

    let note_path = resolve_note_path_input_with_state(&notes_dir, note_id, path, Some(&state))?;

    read_note_session_from_path(&note_path)
}

#[tauri::command]
pub(crate) fn get_vault_info(state: State<'_, AppState>) -> Result<VaultInfo, String> {
    current_vault_info(state.running_vault())
}

#[tauri::command]
pub(crate) fn list_vault_folders() -> Result<Vec<VaultFolderInfo>, String> {
    list_vault_folders_state()
}

#[tauri::command]
pub(crate) fn create_vault_folder(name: String) -> Result<CreateVaultFolderResult, String> {
    let created = create_vault_folder_state(&name)?;
    let _ = crate::services::note_timeline::ensure_vault_scaffold(Path::new(&created.created_path));
    Ok(created)
}

#[tauri::command]
pub(crate) fn set_vault_directory(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<VaultInfo, String> {
    set_vault_directory_for_state(&state, path)
}

/// Cheap advisory observation: never resolve a path or authorize publication.
#[tauri::command]
pub(crate) async fn prepare_restart<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<crate::app::PrepareRestartReceipt, String> {
    // The desktop runtime is the production target for restart. Keeping the
    // lifecycle on a blocking worker lets active async chat/tool tasks settle
    // without deadlocking Tauri's event loop.
    tauri::async_runtime::spawn_blocking(move || {
        let lifecycle = app
            .try_state::<crate::app::AppLifecycle>()
            .ok_or_else(|| "Application lifecycle unavailable".to_string())?;
        Ok(lifecycle.prepare_restart(&app))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Cheap advisory observation: never resolve a path or authorize publication.
#[tauri::command]
pub(crate) fn get_history_readiness(
    state: State<'_, AppState>,
    note_id: Option<String>,
) -> history_commands::HistoryCommandResult<crate::services::note_timeline::HistoryReadiness> {
    let note = note_id.map(|id| crate::services::note_timeline::NoteIdentity::new(id.trim()));
    if note.as_ref().is_some_and(|id| id.as_str().is_empty()) {
        return Err(history_commands::HistoryCommandError::invalid_request(
            "get_history_readiness",
            "A supplied Note Identity must not be empty",
        ));
    }
    state
        .note_timeline()
        .history_readiness(note.as_ref())
        .map_err(|error| {
            history_commands::HistoryCommandError::from_history_error(
                "get_history_readiness",
                error,
            )
        })
}

#[tauri::command]
pub(crate) async fn get_history_health<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> history_commands::HistoryCommandResult<crate::services::note_timeline::HistoryHealthReport> {
    on_app_worker(app, move |state| {
        state.note_timeline().history_health().map_err(|error| {
            history_commands::HistoryCommandError::from_history_error("get_history_health", error)
        })
    })
    .await
    .map_err(|error| {
        history_commands::HistoryCommandError::unavailable("get_history_health", error)
    })?
}

#[cfg(feature = "e2e-wdio")]
#[tauri::command]
pub(crate) fn e2e_corrupt_history_store(
    state: State<'_, AppState>,
) -> Result<crate::services::note_timeline::HistoryHealthReport, String> {
    crate::services::note_timeline::corrupt_history_store_for_test(&state);
    state.note_timeline().history_health().map_err(Into::into)
}

#[cfg(feature = "e2e-wdio")]
#[tauri::command]
pub(crate) fn e2e_flush_vault_watcher_path(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    crate::vault_watcher::flush_path_for_test(&app, PathBuf::from(path))
}

#[tauri::command]
pub(crate) async fn get_note_history_health<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
) -> history_commands::HistoryCommandResult<crate::services::note_timeline::NoteHistoryHealth> {
    on_app_worker(app, move |state| {
        if note_id.trim().is_empty() {
            return Err(history_commands::HistoryCommandError::invalid_request(
                "get_note_history_health",
                "Note history health requires a Note Identity",
            ));
        }
        state
            .note_timeline()
            .note_history_health(&crate::services::note_timeline::NoteIdentity::new(
                note_id.trim(),
            ))
            .map_err(|error| {
                history_commands::HistoryCommandError::from_history_error(
                    "get_note_history_health",
                    error,
                )
            })
    })
    .await
    .map_err(|error| {
        history_commands::HistoryCommandError::unavailable("get_note_history_health", error)
    })?
}

#[tauri::command]
pub(crate) async fn retry_history_recovery<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> history_commands::HistoryCommandResult<crate::services::note_timeline::HistoryHealthReport> {
    on_app_worker(app, move |state| {
        let root = state.running_vault().root();
        state
            .note_timeline()
            .retry_history_recovery(root)
            .map_err(|error| {
                history_commands::HistoryCommandError::from_history_error(
                    "retry_history_recovery",
                    error,
                )
            })
    })
    .await
    .map_err(|error| {
        history_commands::HistoryCommandError::unavailable("retry_history_recovery", error)
    })?
}

#[tauri::command]
pub(crate) async fn reset_corrupt_history<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    confirmed: bool,
) -> history_commands::HistoryCommandResult<crate::services::note_timeline::HistoryResetReceipt> {
    on_app_worker(app, move |state| {
        if !confirmed {
            return Err(history_commands::HistoryCommandError::invalid_request(
                "reset_corrupt_history",
                "Corrupt history reset requires explicit confirmation",
            ));
        }
        let root = state.running_vault().root();
        state
            .note_timeline()
            .reset_corrupt_history(root, confirmed)
            .map_err(|error| {
                history_commands::HistoryCommandError::from_history_error(
                    "reset_corrupt_history",
                    error,
                )
            })
    })
    .await
    .map_err(|error| {
        history_commands::HistoryCommandError::unavailable("reset_corrupt_history", error)
    })?
}

fn set_vault_directory_for_state(
    state: &AppState,
    path: Option<String>,
) -> Result<VaultInfo, String> {
    let requested_path = path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from);
    let info = stage_notes_root(state.running_vault(), requested_path.as_deref())?;
    state.events.vault_changed(info.clone());
    Ok(info)
}

#[tauri::command]
pub(crate) async fn save_note<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    title: String,
    markdown: String,
    current_path: Option<String>,
) -> Result<NoteSession, String> {
    on_app_worker(app, move |state| {
        let outcome = persist_note_session_with_outcome(state, title, markdown, current_path)?;
        outcome.ok_or_else(|| "Saved note session is missing".to_string())
    })
    .await?
}

#[tauri::command]
pub(crate) async fn save_task_note<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    title: String,
    markdown: String,
    current_path: Option<String>,
) -> Result<NoteSession, String> {
    on_app_worker(app, move |state| {
        let outcome = persist_task_note_session_with_outcome(state, title, markdown, current_path)?;
        outcome.ok_or_else(|| "Saved note session is missing".to_string())
    })
    .await?
}

#[tauri::command]
pub(crate) fn mark_note_opened(note_id: String) -> Result<(), String> {
    db_mark_note_opened(&note_id)
}

#[tauri::command]
pub(crate) fn clear_last_opened_note() -> Result<(), String> {
    db_clear_last_opened_note()
}

#[tauri::command]
pub(crate) fn list_recent_tasks(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<RecentTaskItem>, String> {
    list_recent_tasks_impl(state, limit)
}

#[tauri::command]
pub(crate) fn list_tasks(
    state: State<'_, AppState>,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<Vec<TaskListGroup>, String> {
    list_tasks_impl(state, filter, show_hidden)
}

#[tauri::command]
pub(crate) fn get_task_group(
    state: State<'_, AppState>,
    note_id: String,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    task_commands::get_task_group(state, note_id, filter, show_hidden)
}

#[tauri::command]
pub(crate) fn set_task_hidden(
    state: State<'_, AppState>,
    task_id: String,
    hidden: bool,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    set_task_hidden_impl(state, task_id, hidden, filter, show_hidden)
}

#[tauri::command]
pub(crate) fn set_note_hidden(
    state: State<'_, AppState>,
    note_id: String,
    hidden: bool,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    set_note_hidden_impl(state, note_id, hidden, filter, show_hidden)
}

#[tauri::command]
pub(crate) fn set_note_collapsed(
    state: State<'_, AppState>,
    note_id: String,
    collapsed: bool,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    set_note_collapsed_impl(state, note_id, collapsed, filter, show_hidden)
}

#[tauri::command]
pub(crate) fn set_note_order(
    state: State<'_, AppState>,
    note_ids: Vec<String>,
) -> Result<(), String> {
    set_note_order_impl(state, note_ids)
}

#[tauri::command]
pub(crate) async fn toggle_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    task_id: String,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    on_app_worker(app, move |state| {
        let patch = toggle_task_impl(state, task_id, filter, show_hidden)?;
        emit_task_note_changed(state, &patch);
        Ok(patch)
    })
    .await?
}

#[tauri::command]
pub(crate) async fn delete_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    task_id: String,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    on_app_worker(app, move |state| {
        let patch = delete_task_impl(state, task_id, filter, show_hidden)?;
        emit_task_note_changed(state, &patch);
        Ok(patch)
    })
    .await?
}

fn emit_task_note_changed(state: &AppState, patch: &TaskListGroupPatch) {
    if let Some(note_path) = patch.note_path.as_deref() {
        state.events.vault_note_changed_from_source(
            &PathBuf::from(note_path),
            false,
            "taskMutation",
        );
    }
}

#[tauri::command]
pub(crate) fn get_semantic_settings(
    state: State<'_, AppState>,
) -> Result<SemanticSettings, String> {
    state.semantic.get_settings()
}

#[tauri::command]
pub(crate) fn set_semantic_settings(
    state: State<'_, AppState>,
    settings: SemanticSettings,
) -> Result<SemanticSettings, String> {
    let next_settings = state.semantic.set_settings(settings)?;
    state.semantic.warmup_model_in_background();
    emit_semantic_status_changed(&state);
    Ok(next_settings)
}

#[tauri::command]
pub(crate) fn get_semantic_status(state: State<'_, AppState>) -> Result<SemanticStatus, String> {
    state.semantic.get_status()
}

#[tauri::command]
pub(crate) fn rebuild_semantic_index(state: State<'_, AppState>) -> Result<(), String> {
    state.semantic.rebuild_index()?;
    emit_semantic_status_changed(&state);
    Ok(())
}

#[tauri::command]
pub(crate) fn retry_semantic_index(state: State<'_, AppState>) -> Result<(), String> {
    state.semantic.retry_indexing_now()?;
    emit_semantic_status_changed(&state);
    Ok(())
}

#[tauri::command]
pub(crate) fn pause_semantic_indexing(state: State<'_, AppState>) -> Result<(), String> {
    state.semantic.pause_indexing()?;
    emit_semantic_status_changed(&state);
    Ok(())
}

#[tauri::command]
pub(crate) fn resume_semantic_indexing(state: State<'_, AppState>) -> Result<(), String> {
    state.semantic.resume_indexing()?;
    emit_semantic_status_changed(&state);
    Ok(())
}

#[tauri::command]
pub(crate) async fn prepare_semantic_model(state: State<'_, AppState>) -> Result<(), String> {
    let semantic = state.semantic.clone();
    tauri::async_runtime::spawn_blocking(move || semantic.prepare_model())
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) async fn download_semantic_embedding_model(
    state: State<'_, AppState>,
) -> Result<SemanticModelDownloadResult, String> {
    let semantic = state.semantic.clone();
    tauri::async_runtime::spawn_blocking(move || semantic.download_embedding_model())
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) fn get_semantic_debug_metrics(
    state: State<'_, AppState>,
) -> Result<SemanticDebugSnapshot, String> {
    state.semantic.debug_snapshot()
}

#[tauri::command]
pub(crate) fn clear_semantic_debug_metrics(state: State<'_, AppState>) -> Result<(), String> {
    state.semantic.clear_debug_metrics()
}

/// Best-effort emit of the current semantic status to the frontend.
/// Used by mutation commands so the UI can reduce/avoid polling.
pub(crate) fn emit_semantic_status_changed(state: &AppState) {
    if let Ok(status) = state.semantic.get_status() {
        state.events.semantic_status_changed(status);
    }
}

/// Bundled startup payload returned by `bootstrap_app`. Consolidates the
/// per-mount fan-out of `load_note_session` + `get_vault_info` +
/// `get_semantic_status` (and the index revision) into
/// a single round trip. The original commands continue to work for
/// callers that already use them.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BootstrapAppPayload {
    vault: VaultInfo,
    note_session: NoteSession,
    semantic_status: SemanticStatus,
    index_revision: u64,
}

#[tauri::command]
pub(crate) async fn bootstrap_app<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<BootstrapAppPayload, String> {
    on_app_worker(app, move |state| {
        let _foreground_guard = state.foreground_guard();
        let notes_dir = prepare_notes_dir_with_state(false, state)?;
        let note_session = load_note_session_from_notes_dir_with_state(&notes_dir, Some(state))?;
        let vault = current_vault_info(state.running_vault())?;
        let semantic_status = state.semantic.get_status()?;
        let index_revision = state.semantic.current_index_revision();
        Ok(BootstrapAppPayload {
            vault,
            note_session,
            semantic_status,
            index_revision,
        })
    })
    .await?
}

/// Bundled settings payload returned by `get_settings_view`. Replaces the
/// settings store's parallel fan-out of three semantic invokes plus
/// `get_vault_info` with a single call.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsViewPayload {
    vault: VaultInfo,
    history_health: crate::services::note_timeline::HistoryHealthReport,
    semantic_status: SemanticStatus,
    semantic_settings: SemanticSettings,
    semantic_debug: SemanticDebugSnapshot,
}

#[tauri::command]
pub(crate) async fn get_settings_view<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<SettingsViewPayload, String> {
    on_app_worker(app, move |state| {
        let vault = current_vault_info(state.running_vault())?;
        let history_health = state.note_timeline().history_health()?;
        let semantic_status = state.semantic.get_status()?;
        let semantic_settings = state.semantic.get_settings()?;
        let semantic_debug = state.semantic.debug_snapshot()?;
        Ok(SettingsViewPayload {
            vault,
            history_health,
            semantic_status,
            semantic_settings,
            semantic_debug,
        })
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::asset_commands::{
        asset_extension_from_mime_type, mime_type_from_asset_name,
        read_image_asset_data_url_from_assets_dir, resolve_asset_image_path,
        resolve_pasted_image_path, sanitize_asset_file_stem,
    };
    use super::search_commands::{collect_recent_note_results, merge_hybrid_candidates};
    use super::wikilink_commands::{
        note_matches_reference, parse_wikilink_target, resolve_note_link_target,
        ParsedWikilinkTarget,
    };
    use super::{
        load_note_session_from_notes_dir, open_note_from_notes_dir, read_note_session_from_path,
        set_vault_directory_for_state, NoteSession, RecentTaskItem, ResolvedNoteLink, TaskListItem,
    };
    use crate::{
        index::{build_indexed_note, NotesIndex},
        note,
        search::{NoteSearchResult, ScoredSearchResult},
        state::initialize_app_data_dir,
        state::{persist_note, read_state, resolve_note_id_from_path, write_state, PersistedState},
        test_support::{lock_test_env, TestDir},
    };
    use serde_json::json;
    use std::{fs, path::PathBuf};

    #[test]
    fn applying_vault_selection_keeps_the_running_vault_usable() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("commands-vault-switch-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let active = TestDir::new("commands-vault-switch-active");
        let selected = TestDir::new("commands-vault-switch-selected");
        crate::state::set_notes_root_override(None).unwrap();
        crate::state::write_vault_config(&crate::state::VaultConfig {
            notes_root: Some(active.path().to_string_lossy().into_owned()),
        })
        .unwrap();
        crate::state::ensure_vault_scaffold(active.path()).unwrap();
        let canonical_active = fs::canonicalize(active.path()).unwrap();
        let note_path = canonical_active.join("Active.md");
        fs::write(
            &note_path,
            "---\ngneauxghts:\n  id: switch-active-note\n  kind: note\n---\n\nActive",
        )
        .unwrap();
        let running = crate::state::RunningVault::resolve(app_data.path().to_path_buf()).unwrap();
        let state = crate::index::AppState::new_with_running_vault(
            running,
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        state
            .note_timeline()
            .initialize_existing_notes(&canonical_active)
            .unwrap();

        let info = set_vault_directory_for_state(
            &state,
            Some(selected.path().to_string_lossy().into_owned()),
        )
        .unwrap();

        assert_eq!(
            crate::state::read_vault_config()
                .unwrap()
                .notes_root
                .as_deref(),
            Some(
                fs::canonicalize(selected.path())
                    .unwrap()
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert_eq!(
            info.running_path,
            fs::canonicalize(active.path()).unwrap().to_string_lossy()
        );
        assert_eq!(
            info.selected_path,
            fs::canonicalize(selected.path()).unwrap().to_string_lossy()
        );
        assert!(info.requires_restart);
        let prepared = state
            .note_timeline()
            .prepare_revision_publication(
                crate::services::note_timeline::MutationSource::Editor,
                &note_path,
                Some(&note_path),
                Some(&crate::services::note_timeline::NoteIdentity::new(
                    "switch-active-note",
                )),
                "Changed after switch",
            )
            .expect("staging a selection must not stop running-vault mutations");
        prepared.into_parts().1.abandon().unwrap();
        assert!(!state.note_timeline().is_cleanly_closed().unwrap());
        let externally_changed = "---\ngneauxghts:\n  id: switch-active-note\n  kind: note\n---\n\nChanged by the old watcher";
        fs::write(&note_path, externally_changed).unwrap();
        state
            .note_timeline()
            .observe(
                crate::services::note_timeline::VaultObservation::external_edit(
                    note_path.clone(),
                    1_700_000_000_000,
                    None,
                )
                .with_canonical_markdown(externally_changed.to_string()),
            )
            .expect("a captured running-vault watcher callback must remain admitted after Apply");

        crate::state::db_mark_note_opened("switch-active-note").unwrap();
        assert!(active
            .path()
            .join(".gneauxghts/app-state.sqlite3")
            .is_file());
        assert!(!selected
            .path()
            .join(".gneauxghts/app-state.sqlite3")
            .is_file());

        drop(state);
        let restarted_running =
            crate::state::RunningVault::resolve(app_data.path().to_path_buf()).unwrap();
        assert_eq!(
            fs::canonicalize(restarted_running.root()).unwrap(),
            fs::canonicalize(selected.path()).unwrap()
        );
        let restarted_state = crate::index::AppState::new_with_running_vault(
            restarted_running,
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        crate::state::db_mark_note_opened("switch-selected-note").unwrap();
        assert!(selected
            .path()
            .join(".gneauxghts/app-state.sqlite3")
            .is_file());
        drop(restarted_state);
    }

    #[test]
    fn vault_selection_can_be_replaced_cleared_by_alias_and_fail_without_closing() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("commands-vault-stage-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let documents = TestDir::new("commands-vault-stage-documents");
        crate::state::initialize_documents_dir(documents.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(None).unwrap();
        let active = TestDir::new("commands-vault-stage-active");
        let selected_b = TestDir::new("commands-vault-stage-b");
        let selected_c = TestDir::new("commands-vault-stage-c");
        crate::state::write_vault_config(&crate::state::VaultConfig {
            notes_root: Some(active.path().to_string_lossy().into_owned()),
        })
        .unwrap();
        crate::state::ensure_vault_scaffold(active.path()).unwrap();
        let running = crate::state::RunningVault::resolve(app_data.path().to_path_buf()).unwrap();
        let state = crate::index::AppState::new_with_running_vault(
            running,
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();

        let expected_default = crate::state::default_notes_root().unwrap();
        let staged_default = set_vault_directory_for_state(&state, None).unwrap();
        let canonical_default = fs::canonicalize(&expected_default).unwrap();
        assert_eq!(crate::state::read_vault_config().unwrap().notes_root, None);
        assert_eq!(
            PathBuf::from(&staged_default.selected_path),
            canonical_default
        );
        assert!(staged_default.requires_restart);
        assert!(expected_default.is_dir());
        assert!(expected_default.join(".gneauxghts/vault.json").is_file());

        let staged_b = set_vault_directory_for_state(
            &state,
            Some(selected_b.path().to_string_lossy().into_owned()),
        )
        .unwrap();
        assert_eq!(
            staged_b.selected_path,
            fs::canonicalize(selected_b.path())
                .unwrap()
                .to_string_lossy()
        );
        let staged_c = set_vault_directory_for_state(
            &state,
            Some(selected_c.path().to_string_lossy().into_owned()),
        )
        .unwrap();
        assert_eq!(
            staged_c.selected_path,
            fs::canonicalize(selected_c.path())
                .unwrap()
                .to_string_lossy()
        );

        let running_alias = active.path().join(".");
        let cleared = set_vault_directory_for_state(
            &state,
            Some(running_alias.to_string_lossy().into_owned()),
        )
        .unwrap();
        assert!(!cleared.requires_restart);
        assert_eq!(
            fs::canonicalize(&cleared.running_path).unwrap(),
            PathBuf::from(&cleared.selected_path)
        );

        crate::state::inject_vault_config_publication_failure_once();
        let error = set_vault_directory_for_state(
            &state,
            Some(selected_b.path().to_string_lossy().into_owned()),
        )
        .expect_err("injected publication failure");
        assert!(error.contains("Injected vault config publication failure"));
        assert!(!state.note_timeline().is_cleanly_closed().unwrap());

        let invalid = app_data.path().join("not-a-directory");
        fs::write(&invalid, "occupied").unwrap();
        assert!(set_vault_directory_for_state(
            &state,
            Some(invalid.to_string_lossy().into_owned()),
        )
        .is_err());
        assert_eq!(fs::read_to_string(invalid).unwrap(), "occupied");
    }

    #[test]
    fn load_note_session_from_notes_dir_clears_stale_last_opened_path() {
        let _guard = lock_test_env();
        let app_data_dir = TestDir::new("commands-app-data-load");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("commands-load-session");
        let notes_dir = temp.path();
        crate::state::set_notes_root_override(Some(notes_dir.to_path_buf()))
            .expect("override notes root");
        let stale_note_id = "missing-note".to_string();
        write_state(
            notes_dir,
            &PersistedState {
                last_opened_note_id: Some(stale_note_id.clone()),
                recent_note_ids: vec![stale_note_id],
                ..PersistedState::default()
            },
        )
        .expect("write state");

        let session = load_note_session_from_notes_dir(notes_dir).expect("load note session");
        let state = read_state(notes_dir).expect("read state");

        assert_eq!(session.title, "");
        assert_eq!(session.markdown, "");
        assert_eq!(session.note_id, None);
        assert_eq!(session.path, None);
        assert_eq!(state.last_opened_note_id, None);
        assert!(state.recent_note_ids.is_empty());
    }

    #[test]
    fn open_note_from_notes_dir_updates_last_opened_and_recents() {
        let _guard = lock_test_env();
        let app_data_dir = TestDir::new("commands-app-data-open");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("commands-open-note");
        let notes_dir = temp.path();
        crate::state::set_notes_root_override(Some(notes_dir.to_path_buf()))
            .expect("override notes root");
        let note_path = notes_dir.join("Open Me.md");
        fs::write(&note_path, "# Open Me\n\nBody").expect("write note");

        let indexed_note = build_indexed_note(&note_path, "# Open Me\n\nBody", 10);
        let session = open_note_from_notes_dir(notes_dir, Some(indexed_note.note_id.clone()), None)
            .expect("open note");
        let state = read_state(notes_dir).expect("read state");

        assert_eq!(session.note_id, Some(indexed_note.note_id.clone()));
        assert_eq!(session.path, Some(note_path.to_string_lossy().into_owned()));
        assert_eq!(session.title, "Open Me");
        assert_eq!(session.markdown, "Body");
        assert_eq!(
            state.last_opened_note_id,
            Some(indexed_note.note_id.clone())
        );
        assert_eq!(state.recent_note_ids, vec![indexed_note.note_id]);
    }

    #[test]
    fn open_note_from_notes_dir_resolves_safe_vault_relative_paths() {
        let _guard = lock_test_env();
        let app_data_dir = TestDir::new("commands-app-data-open-relative");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("commands-open-relative-note");
        let notes_dir = temp.path();
        crate::state::set_notes_root_override(Some(notes_dir.to_path_buf()))
            .expect("override notes root");
        let nested_dir = notes_dir.join("Projects");
        fs::create_dir_all(&nested_dir).expect("create nested directory");
        let note_path = nested_dir.join("Plan.md");
        fs::write(&note_path, "# Plan\n\nBody").expect("write note");

        let session =
            open_note_from_notes_dir(notes_dir, None, Some("Projects/Plan.md".to_string()))
                .expect("open relative note reference");

        assert_eq!(session.path, Some(note_path.to_string_lossy().into_owned()));
        assert_eq!(session.title, "Plan");

        let error = open_note_from_notes_dir(notes_dir, None, Some("../Outside.md".to_string()))
            .expect_err("reject parent traversal");
        assert_eq!(error, "Current note path is outside the notes directory");
    }

    #[test]
    fn open_note_follows_note_id_when_supplied_path_was_externally_renamed() {
        let _guard = lock_test_env();
        let app_data_dir = TestDir::new("commands-app-data-open-renamed");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("commands-open-renamed-note");
        let notes_dir = temp.path();
        crate::state::set_notes_root_override(Some(notes_dir.to_path_buf()))
            .expect("override notes root");

        let original_path = PathBuf::from(
            persist_note(notes_dir, "Original", "Body", None)
                .expect("persist note")
                .expect("saved path"),
        );
        let note_id = resolve_note_id_from_path(&original_path).expect("managed note id");
        let renamed_path = notes_dir.join("Renamed.md");
        fs::rename(&original_path, &renamed_path).expect("external rename");

        let session = open_note_from_notes_dir(
            notes_dir,
            Some(note_id.clone()),
            Some(original_path.to_string_lossy().into_owned()),
        )
        .expect("follow renamed note by id");

        assert_eq!(session.note_id, Some(note_id));
        assert_eq!(
            session.path,
            Some(renamed_path.to_string_lossy().into_owned())
        );
        assert_eq!(session.title, "Renamed");
        assert_eq!(session.markdown, "Body");
        assert!(!original_path.exists());
    }

    #[test]
    fn open_note_row_scoped_write_preserves_unrelated_state_fields() {
        let _guard = lock_test_env();
        let app_data_dir = TestDir::new("commands-app-data-open-rowscope");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("commands-open-note-rowscope");
        let notes_dir = temp.path();
        crate::state::set_notes_root_override(Some(notes_dir.to_path_buf()))
            .expect("override notes root");
        let note_path = notes_dir.join("Switch Target.md");
        let other_path = notes_dir.join("Other.md");
        let pinned_path = notes_dir.join("Pinned.md");
        fs::write(&note_path, "# Switch Target\n\nBody").expect("write note");
        fs::write(&other_path, "# Other\n\nBody").expect("write other note");
        fs::write(&pinned_path, "# Pinned\n\nBody").expect("write pinned note");

        let switch_target = build_indexed_note(&note_path, "# Switch Target\n\nBody", 10);
        let other = build_indexed_note(&other_path, "# Other\n\nBody", 20);
        let pinned = build_indexed_note(&pinned_path, "# Pinned\n\nBody", 30);

        // Seed state with real-note-id entries in the unrelated fields so
        // pruning won't drop them. The point of this test is to verify
        // that switching notes does not clobber hidden/order/collapsed
        // rows that were not changed.
        write_state(
            notes_dir,
            &PersistedState {
                last_opened_note_id: Some(other.note_id.clone()),
                recent_note_ids: vec![other.note_id.clone()],
                pinned_note_ids: vec![pinned.note_id.clone()],
                hidden_note_ids: vec![pinned.note_id.clone()],
                note_order_note_ids: vec![pinned.note_id.clone()],
                collapsed_note_ids: vec![pinned.note_id.clone()],
                ..PersistedState::default()
            },
        )
        .expect("seed state");

        // Switching notes goes through the row-scoped write path.
        open_note_from_notes_dir(notes_dir, Some(switch_target.note_id.clone()), None)
            .expect("open note");
        let state = read_state(notes_dir).expect("read state after switch");

        assert_eq!(
            state.last_opened_note_id,
            Some(switch_target.note_id.clone())
        );
        assert_eq!(
            state.recent_note_ids,
            vec![switch_target.note_id, other.note_id]
        );
        // Unrelated fields must be preserved by the row-scoped write.
        assert_eq!(state.pinned_note_ids, vec![pinned.note_id.clone()]);
        assert_eq!(state.hidden_note_ids, vec![pinned.note_id.clone()]);
        assert_eq!(state.note_order_note_ids, vec![pinned.note_id.clone()]);
        assert_eq!(state.collapsed_note_ids, vec![pinned.note_id]);
    }

    #[test]
    fn read_note_session_from_path_does_not_update_last_opened_or_recents() {
        let _guard = lock_test_env();
        let app_data_dir = TestDir::new("commands-app-data-read");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("commands-read-note");
        let notes_dir = temp.path();
        crate::state::set_notes_root_override(Some(notes_dir.to_path_buf()))
            .expect("override notes root");
        let note_path = notes_dir.join("Read Me.md");
        let existing_open_path = notes_dir.join("Already Open.md");
        fs::write(&note_path, "# Read Me\n\nBody").expect("write note");
        fs::write(&existing_open_path, "# Already Open\n\nBody").expect("write open note");
        let existing_note = build_indexed_note(&existing_open_path, "# Already Open\n\nBody", 10);
        write_state(
            notes_dir,
            &PersistedState {
                last_opened_note_id: Some(existing_note.note_id.clone()),
                recent_note_ids: vec![existing_note.note_id.clone()],
                ..PersistedState::default()
            },
        )
        .expect("write state");

        let session = read_note_session_from_path(&note_path).expect("read note");
        let state = read_state(notes_dir).expect("read state");

        assert_eq!(
            session.note_id,
            note::note_id_from_path_or_markdown(
                Some(note_path.as_path()),
                &fs::read_to_string(&note_path).expect("read note markdown")
            )
        );
        assert_eq!(session.path, Some(note_path.to_string_lossy().into_owned()));
        assert_eq!(session.title, "Read Me");
        assert_eq!(session.markdown, "Body");
        assert_eq!(
            state.last_opened_note_id,
            Some(existing_note.note_id.clone())
        );
        assert_eq!(state.recent_note_ids, vec![existing_note.note_id]);
    }

    #[test]
    fn collect_recent_note_results_skips_current_note() {
        let current_path = PathBuf::from("/tmp/current.md");
        let other_path = PathBuf::from("/tmp/other.md");
        let mut index = NotesIndex::default();
        index.upsert_note(
            current_path.clone(),
            build_indexed_note(&current_path, "# Current\n\nBody", 10),
        );
        index.upsert_note(
            other_path.clone(),
            build_indexed_note(&other_path, "# Other\n\nElsewhere", 20),
        );

        let results = collect_recent_note_results(
            &[
                index.entries[&current_path].note_id.clone(),
                index.entries[&other_path].note_id.clone(),
            ],
            Some(index.entries[&current_path].note_id.as_str()),
            &index,
            12,
        );

        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].note_path.as_deref(),
            Some(other_path.to_string_lossy().as_ref())
        );
        assert_eq!(results[0].file_name, "other");
    }

    #[test]
    fn merge_hybrid_candidates_applies_labels_scores_and_limit() {
        let lexical = vec![
            ScoredSearchResult {
                score: 100,
                result: NoteSearchResult {
                    document_kind: crate::note::DocumentKind::Note,
                    note_id: Some("note-a".to_string()),
                    block_anchor: None,
                    note_path: Some("/notes/a.md".to_string()),
                    file_name: "a".to_string(),
                    section_label: "Paragraph 1".to_string(),
                    excerpt: "hybrid search ranking".to_string(),
                    highlight_ranges: Vec::new(),
                    match_text: "hybrid search".to_string(),
                    reason_labels: Vec::new(),
                    lexical_score: None,
                    semantic_score: None,
                    start_line: None,
                    end_line: None,
                },
            },
            ScoredSearchResult {
                score: 40,
                result: NoteSearchResult {
                    document_kind: crate::note::DocumentKind::Note,
                    note_id: Some("note-b".to_string()),
                    block_anchor: None,
                    note_path: Some("/notes/b.md".to_string()),
                    file_name: "b".to_string(),
                    section_label: "Paragraph 1".to_string(),
                    excerpt: "keyword only".to_string(),
                    highlight_ranges: Vec::new(),
                    match_text: "keyword".to_string(),
                    reason_labels: Vec::new(),
                    lexical_score: None,
                    semantic_score: None,
                    start_line: None,
                    end_line: None,
                },
            },
        ];
        let semantic = vec![crate::semantic::SemanticChunkMatch {
            note_path: "/notes/c.md".to_string(),
            note_title: "c".to_string(),
            section_label: "Research".to_string(),
            excerpt: "conceptual match".to_string(),
            match_text: "conceptual match".to_string(),
            score: 0.9,
            start_line: 7,
            end_line: 8,
            document_kind: crate::note::DocumentKind::Note,
            block_anchor: None,
        }];

        let results = merge_hybrid_candidates(
            lexical,
            semantic,
            "hybrid search",
            Some(PathBuf::from("/notes/current.md").as_path()),
            2,
            0.5,
            0.4,
            &std::collections::HashMap::new(),
            &super::search_commands::NoteAccessLookup::empty(),
            0,
        );

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].file_name, "a");
        assert_eq!(results[0].reason_labels, vec!["keyword".to_string()]);
        assert_eq!(results[0].lexical_score, Some(1.0));
        assert_eq!(results[0].semantic_score, Some(0.0));

        assert_eq!(results[1].file_name, "c");
        assert_eq!(results[1].reason_labels, vec!["semantic".to_string()]);
        assert_eq!(results[1].lexical_score, Some(0.0));
        assert_eq!(results[1].semantic_score, Some(1.0));
    }

    #[test]
    fn semantic_only_chat_match_keeps_kind_and_anchor() {
        let semantic = vec![crate::semantic::SemanticChunkMatch {
            note_path: "/notes/Chats/example/Conversation.md".to_string(),
            note_title: "A useful discussion".to_string(),
            section_label: "Remembered passage".to_string(),
            excerpt: "the exact remembered passage".to_string(),
            match_text: "the exact remembered passage".to_string(),
            score: 0.9,
            start_line: 1,
            end_line: 1,
            document_kind: crate::note::DocumentKind::ChatIndex,
            block_anchor: Some("excerpt_stable".to_string()),
        }];

        let results = merge_hybrid_candidates(
            Vec::new(),
            semantic,
            "remembered passage",
            None,
            5,
            0.5,
            0.5,
            &std::collections::HashMap::new(),
            &super::search_commands::NoteAccessLookup::empty(),
            0,
        );

        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].document_kind,
            crate::note::DocumentKind::ChatIndex
        );
        assert_eq!(results[0].block_anchor.as_deref(), Some("excerpt_stable"));
        assert_eq!(results[0].reason_labels, vec!["semantic".to_string()]);
    }

    #[test]
    fn merge_hybrid_candidates_boosts_frequently_opened_notes() {
        let lexical = vec![
            ScoredSearchResult {
                score: 50,
                result: NoteSearchResult {
                    document_kind: crate::note::DocumentKind::Note,
                    note_id: Some("rarely-opened".to_string()),
                    block_anchor: None,
                    note_path: Some("/notes/rare.md".to_string()),
                    file_name: "rare".to_string(),
                    section_label: "Paragraph 1".to_string(),
                    excerpt: "shared topic".to_string(),
                    highlight_ranges: Vec::new(),
                    match_text: "shared topic".to_string(),
                    reason_labels: Vec::new(),
                    lexical_score: None,
                    semantic_score: None,
                    start_line: None,
                    end_line: None,
                },
            },
            ScoredSearchResult {
                score: 48,
                result: NoteSearchResult {
                    document_kind: crate::note::DocumentKind::Note,
                    note_id: Some("often-opened".to_string()),
                    block_anchor: None,
                    note_path: Some("/notes/often.md".to_string()),
                    file_name: "often".to_string(),
                    section_label: "Paragraph 1".to_string(),
                    excerpt: "shared topic".to_string(),
                    highlight_ranges: Vec::new(),
                    match_text: "shared topic".to_string(),
                    reason_labels: Vec::new(),
                    lexical_score: None,
                    semantic_score: None,
                    start_line: None,
                    end_line: None,
                },
            },
        ];
        let now = 1_700_000_000_000u64;
        let mut activity = std::collections::HashMap::new();
        activity.insert(
            "often-opened".to_string(),
            crate::state::NoteActivity {
                last_viewed_at_millis: now,
                open_count: 40,
                last_counted_open_at_millis: now,
            },
        );
        let mut note_lookup = super::search_commands::NoteAccessLookup::empty();
        note_lookup
            .modified_by_note_id
            .insert("often-opened".to_string(), now);
        note_lookup
            .modified_by_note_id
            .insert("rarely-opened".to_string(), now);

        let results = merge_hybrid_candidates(
            lexical,
            Vec::new(),
            "shared topic",
            None,
            2,
            0.5,
            0.4,
            &activity,
            &note_lookup,
            now,
        );

        assert_eq!(results[0].file_name, "often");
        assert!(results[0]
            .reason_labels
            .iter()
            .any(|label| label == "frequently opened"));
    }

    #[test]
    fn merge_hybrid_candidates_idle_decay_removes_access_boost() {
        let lexical = vec![
            ScoredSearchResult {
                score: 50,
                result: NoteSearchResult {
                    document_kind: crate::note::DocumentKind::Note,
                    note_id: Some("stale-popular".to_string()),
                    block_anchor: None,
                    note_path: Some("/notes/stale.md".to_string()),
                    file_name: "stale".to_string(),
                    section_label: "Paragraph 1".to_string(),
                    excerpt: "shared topic".to_string(),
                    highlight_ranges: Vec::new(),
                    match_text: "shared topic".to_string(),
                    reason_labels: Vec::new(),
                    lexical_score: None,
                    semantic_score: None,
                    start_line: None,
                    end_line: None,
                },
            },
            ScoredSearchResult {
                score: 48,
                result: NoteSearchResult {
                    document_kind: crate::note::DocumentKind::Note,
                    note_id: Some("fresh".to_string()),
                    block_anchor: None,
                    note_path: Some("/notes/fresh.md".to_string()),
                    file_name: "fresh".to_string(),
                    section_label: "Paragraph 1".to_string(),
                    excerpt: "shared topic".to_string(),
                    highlight_ranges: Vec::new(),
                    match_text: "shared topic".to_string(),
                    reason_labels: Vec::new(),
                    lexical_score: None,
                    semantic_score: None,
                    start_line: None,
                    end_line: None,
                },
            },
        ];
        let now = 1_700_000_000_000u64;
        let idle_viewed = now - (crate::state::OPEN_COUNT_DECAY_INTERVAL_MS * 40);
        let mut activity = std::collections::HashMap::new();
        activity.insert(
            "stale-popular".to_string(),
            crate::state::NoteActivity {
                last_viewed_at_millis: idle_viewed,
                open_count: 40,
                last_counted_open_at_millis: idle_viewed,
            },
        );
        let mut note_lookup = super::search_commands::NoteAccessLookup::empty();
        note_lookup
            .modified_by_note_id
            .insert("stale-popular".to_string(), idle_viewed);
        note_lookup
            .modified_by_note_id
            .insert("fresh".to_string(), now);

        let results = merge_hybrid_candidates(
            lexical,
            Vec::new(),
            "shared topic",
            None,
            2,
            0.5,
            0.4,
            &activity,
            &note_lookup,
            now,
        );

        assert_eq!(results[0].file_name, "stale");
        assert!(!results[0]
            .reason_labels
            .iter()
            .any(|label| label == "frequently opened"));
    }

    #[test]
    fn parse_wikilink_target_supports_aliases_and_same_note_sections() {
        assert_eq!(
            parse_wikilink_target("Project Atlas#Paragraph 2|Atlas"),
            ParsedWikilinkTarget {
                note: Some("Project Atlas".to_string()),
                section: Some("Paragraph 2".to_string()),
            }
        );
        assert_eq!(
            parse_wikilink_target("#Ideas"),
            ParsedWikilinkTarget {
                note: None,
                section: Some("Ideas".to_string()),
            }
        );
    }

    #[test]
    fn resolve_note_link_target_prefers_paragraph_numbers_and_falls_back_to_title() {
        let note_path = PathBuf::from("/tmp/project-atlas.md");
        let note = build_indexed_note(
            &note_path,
            "# Project Atlas\n\nFirst paragraph.\n\n## Ideas\n\nSecond paragraph with link target.\n",
            10,
        );

        let paragraph_target = resolve_note_link_target(&note_path, &note, Some("Paragraph 2"));
        let heading_target = resolve_note_link_target(&note_path, &note, Some("Ideas"));
        let fallback_target = resolve_note_link_target(&note_path, &note, Some("Missing"));

        assert_eq!(paragraph_target.note_path, "/tmp/project-atlas.md");
        assert_eq!(paragraph_target.section_label, "Paragraph 2");
        assert_eq!(paragraph_target.match_text, "## Ideas");

        assert_eq!(heading_target.section_label, "Paragraph 2");
        assert_eq!(heading_target.match_text, "## Ideas");

        assert_eq!(fallback_target.section_label, "Title");
        assert_eq!(fallback_target.match_text, "project-atlas");
    }

    #[test]
    fn resolve_note_link_target_supports_stable_block_ids() {
        let note_path = PathBuf::from("/tmp/Chats/2026-07-12-planning/Part 001.md");
        let note = build_indexed_note(
            &note_path,
            "# Planning\n\nA durable response. ^msg_01ABC\n\nAnother response.",
            10,
        );

        let target = resolve_note_link_target(&note_path, &note, Some("^msg_01ABC"));

        assert_eq!(target.block_id.as_deref(), Some("msg_01ABC"));
        assert_eq!(target.line_number, Some(3));
        assert_eq!(target.match_text, "A durable response. ^msg_01ABC");
    }

    #[test]
    fn path_qualified_note_references_match_relative_vault_paths() {
        let notes_dir = PathBuf::from("/vault");
        let note_path = notes_dir.join("Chats/2026-07-12-planning/Part 001.md");
        let note = build_indexed_note(&note_path, "Transcript", 10);

        assert!(note_matches_reference(
            "Chats/2026-07-12-planning/Part 001",
            &note_path,
            &note,
            &notes_dir,
        ));
        assert!(note_matches_reference(
            "Chats\\2026-07-12-planning\\Part 001.md",
            &note_path,
            &note,
            &notes_dir,
        ));
        assert!(!note_matches_reference(
            "Other/Part 001",
            &note_path,
            &note,
            &notes_dir,
        ));
    }

    #[test]
    fn sanitize_asset_file_stem_normalizes_invalid_characters() {
        assert_eq!(
            sanitize_asset_file_stem(r#" ../Pasted:image*2024?.png "#),
            "Pasted image 2024"
        );
    }

    #[test]
    fn asset_extension_from_mime_type_covers_common_images() {
        assert_eq!(asset_extension_from_mime_type("image/png"), Some("png"));
        assert_eq!(asset_extension_from_mime_type("image/jpeg"), Some("jpg"));
        assert_eq!(asset_extension_from_mime_type("application/json"), None);
    }

    #[test]
    fn resolve_pasted_image_path_avoids_collisions() {
        let temp = TestDir::new("commands-image-assets");
        let assets_dir = temp.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("Pasted image 20240605160000.png"), b"one")
            .expect("write existing image");

        let resolved_path = resolve_pasted_image_path(
            &assets_dir,
            Some("Pasted image 20240605160000.png"),
            Some("image/png"),
        );

        assert_eq!(
            resolved_path.file_name().and_then(|value| value.to_str()),
            Some("Pasted image 20240605160000 1.png")
        );
    }

    #[test]
    fn resolve_asset_image_path_rejects_nested_paths() {
        let temp = TestDir::new("commands-image-assets-paths");
        let assets_dir = temp.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");

        let result = resolve_asset_image_path(&assets_dir, "../secret.png");

        assert!(result.is_err());
    }

    #[test]
    fn read_image_asset_data_url_from_assets_dir_encodes_image_bytes() {
        let temp = TestDir::new("commands-image-assets-data-url");
        let assets_dir = temp.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("diagram.png"), [0_u8, 1, 2, 3]).expect("write asset");

        let data_url = read_image_asset_data_url_from_assets_dir(&assets_dir, "diagram.png")
            .expect("data url");

        assert!(data_url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn mime_type_from_asset_name_defaults_for_known_extensions() {
        assert_eq!(mime_type_from_asset_name("diagram.png"), "image/png");
        assert_eq!(mime_type_from_asset_name("photo.jpg"), "image/jpeg");
        assert_eq!(mime_type_from_asset_name("vector.svg"), "image/svg+xml");
    }

    #[test]
    fn command_payload_json_contracts_remain_stable() {
        let session = NoteSession {
            note_id: Some("note-1".to_string()),
            title: "Title".to_string(),
            markdown: "Body".to_string(),
            path: Some("/notes/title.md".to_string()),
            commit_warning: None,
        };
        let resolved_note_link = ResolvedNoteLink {
            note_id: "note-1".to_string(),
            note_path: "/notes/title.md".to_string(),
            section_label: "Paragraph 2".to_string(),
            match_text: "Ship beta".to_string(),
            block_id: None,
            line_number: None,
        };
        let task = TaskListItem {
            note_id: "note-1".to_string(),
            task_key: "task-key".to_string(),
            task_id: "t_note1_abc123".to_string(),
            note_path: "/notes/title.md".to_string(),
            file_name: "title".to_string(),
            note_title: "Title".to_string(),
            section_label: Some("Tasks".to_string()),
            text: "Ship beta".to_string(),
            completed: false,
            hidden: true,
            note_hidden: false,
            note_collapsed: true,
            depth: 2,
            line_number: 14,
            editor_line_number: Some(9),
            created_at_millis: 111,
            updated_at_millis: 222,
        };
        let recent_task = RecentTaskItem {
            note_id: "note-1".to_string(),
            task_key: "recent-task".to_string(),
            note_path: "/notes/title.md".to_string(),
            note_title: "Title".to_string(),
            text: "Ship beta".to_string(),
            line_number: 14,
            updated_at_millis: 222,
        };

        assert_eq!(
            serde_json::to_value(session).expect("serialize note session"),
            json!({
                "noteId": "note-1",
                "title": "Title",
                "markdown": "Body",
                "path": "/notes/title.md",
            })
        );
        assert_eq!(
            serde_json::to_value(task).expect("serialize task item"),
            json!({
                "noteId": "note-1",
                "taskKey": "task-key",
                "taskId": "t_note1_abc123",
                "notePath": "/notes/title.md",
                "fileName": "title",
                "noteTitle": "Title",
                "sectionLabel": "Tasks",
                "text": "Ship beta",
                "completed": false,
                "hidden": true,
                "noteHidden": false,
                "noteCollapsed": true,
                "depth": 2,
                "lineNumber": 14,
                "editorLineNumber": 9,
                "createdAtMillis": 111,
                "updatedAtMillis": 222,
            })
        );
        assert_eq!(
            serde_json::to_value(resolved_note_link).expect("serialize resolved note link"),
            json!({
                "noteId": "note-1",
                "notePath": "/notes/title.md",
                "sectionLabel": "Paragraph 2",
                "matchText": "Ship beta",
            })
        );
        assert_eq!(
            serde_json::to_value(recent_task).expect("serialize recent task"),
            json!({
                "noteId": "note-1",
                "taskKey": "recent-task",
                "notePath": "/notes/title.md",
                "noteTitle": "Title",
                "text": "Ship beta",
                "lineNumber": 14,
                "updatedAtMillis": 222,
            })
        );
    }
}
