pub(crate) mod asset_commands;
pub(crate) mod forgotten_note_commands;
pub(crate) mod graph_commands;
mod index_bridge;
pub(crate) mod note_persistence;
mod note_session;
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
    ai::{AiSettings, AiState},
    app::AppData,
    index::AppState,
    semantic::{
        debug::SemanticDebugSnapshot, embed::SemanticModelDownloadResult, SemanticSettings,
        SemanticStatus,
    },
    services::{NoteService, SettingsService, TaskService},
    state::{current_vault_info, notes_root, VaultInfo},
    time::current_time_millis,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
#[cfg(test)]
use task_commands::find_task_key_for_line;
use task_commands::{
    list_recent_tasks as list_recent_tasks_impl, list_tasks as list_tasks_impl,
    set_note_collapsed as set_note_collapsed_impl, set_note_hidden as set_note_hidden_impl,
    set_note_order as set_note_order_impl, set_task_hidden as set_task_hidden_impl,
};
use tauri::State;
use tauri::{AppHandle, Emitter, Manager};

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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedNoteLink {
    note_id: String,
    note_path: String,
    section_label: String,
    match_text: String,
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
pub(crate) enum SearchMode {
    Current,
    All,
}

/// Phase 5: lightweight draft pointer used internally for search/related/
/// wikilink flows. The frontend sends `currentMarkdown` and
/// `currentBodyHash` as flat fields; commands assemble a `DraftRef` to call
/// [`AppState::resolve_draft_body`], which either returns the inlined body
/// (and caches it) or replays a cached body for repeat hashes — letting the
/// frontend skip resending the full markdown on every keystroke.
#[derive(Clone, Debug, Default)]
pub(crate) struct DraftRef {
    pub(crate) path: Option<String>,
    #[allow(dead_code)]
    pub(crate) title: String,
    pub(crate) hash: Option<String>,
    pub(crate) body: Option<String>,
    /// When true, the caller does not need a current-note override
    /// (e.g. wikilink resolution that targets a different note). The backend
    /// can skip body resolution entirely.
    pub(crate) body_not_needed: bool,
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
    /// Stable internal task id assigned by the SQLite task projection.
    /// Optional in the wire format so existing frontend code can ignore
    /// it; new consumers can use it instead of the derived `task_key`
    /// for cross-save identity.
    #[serde(skip_serializing_if = "Option::is_none")]
    task_id: Option<String>,
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

/// Delta returned by task mutation commands so the frontend can update its
/// store without re-fetching the full master task list. `note_tasks`
/// contains the canonical task items for the note that was mutated, in the
/// order they appear in the index. The frontend replaces all tasks for
/// `note_id` with these and merges them back into its sorted list.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskMutationDelta {
    pub(crate) note_id: String,
    pub(crate) note_path: String,
    pub(crate) note_tasks: Vec<TaskListItem>,
    /// Task key that was directly affected by the mutation, when known.
    /// For toggle this is the toggled task's key (which may differ from the
    /// frontend's pre-mutation key if the note was rewritten on disk).
    /// For delete this is the deleted task's key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) affected_task_key: Option<String>,
    /// True when the mutation removed the task. Helpful for the frontend to
    /// drop the row instead of relying on the absence of a key in `note_tasks`.
    pub(crate) removed: bool,
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
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoredForgottenNote {
    forgotten_path: String,
    restored_path: String,
    title: String,
}

/// Minimum interval between background passes of `cleanup_expired_forgotten_notes`.
/// The cleanup used to run on every save/open/list invocation; throttling it
/// keeps it off interactive hot paths while still giving the same eventual
/// purge guarantees.
const FORGOTTEN_NOTE_CLEANUP_INTERVAL: Duration = Duration::from_secs(60 * 5);

static LAST_FORGOTTEN_NOTE_CLEANUP_AT: std::sync::Mutex<Option<std::time::Instant>> =
    std::sync::Mutex::new(None);

fn maybe_run_forgotten_note_cleanup(notes_dir: &Path) -> Result<(), String> {
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
    forgotten_note_commands::cleanup_expired_forgotten_notes(notes_dir)
}

pub(crate) fn startup_cleanup_expired_forgotten_notes() -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    let mut last = LAST_FORGOTTEN_NOTE_CLEANUP_AT
        .lock()
        .map_err(|_| "Forgotten note cleanup lock poisoned".to_string())?;
    *last = Some(std::time::Instant::now());
    drop(last);
    forgotten_note_commands::cleanup_expired_forgotten_notes(&notes_dir)
}

fn prepare_notes_dir(cleanup_forgotten_notes: bool) -> Result<PathBuf, String> {
    prepare_notes_dir_with_state(cleanup_forgotten_notes, None)
}

fn prepare_notes_dir_with_state(
    cleanup_forgotten_notes: bool,
    _state: Option<&State<'_, AppState>>,
) -> Result<PathBuf, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    if cleanup_forgotten_notes {
        // The previous behaviour ran the full forgotten-note cleanup on every
        // save/open/list invocation. We now throttle to a background cadence
        // so common interactive commands no longer pay for it.
        maybe_run_forgotten_note_cleanup(&notes_dir)?;
    }
    Ok(notes_dir)
}

#[tauri::command]
pub(crate) fn load_note_session(state: State<'_, AppState>) -> Result<NoteSession, String> {
    // Foreground guard: while this IPC call is running the background
    // index queue (cold-start prewarm + save-side projection) yields
    // between per-note jobs so the SQLite state mutex stays free for
    // `read_state_with_lookup` / `write_last_opened_and_recents`.
    let _foreground_guard = state.foreground_guard();
    // Forgotten-note cleanup is throttled to startup + a 5-minute background
    // pass; the service intentionally skips the per-call cleanup.
    let _ = prepare_notes_dir_with_state(true, Some(&state))?;
    NoteService::new().load_session(&state)
}

#[tauri::command]
pub(crate) fn open_note(
    state: State<'_, AppState>,
    note_id: Option<String>,
    path: Option<String>,
) -> Result<NoteSession, String> {
    // See `load_note_session` for the rationale on the foreground guard.
    let _foreground_guard = state.foreground_guard();
    let _ = prepare_notes_dir_with_state(false, Some(&state))?;
    NoteService::new().open(&state, note_id, path)
}

#[tauri::command]
pub(crate) fn read_note(
    state: State<'_, AppState>,
    note_id: Option<String>,
    path: Option<String>,
) -> Result<NoteSession, String> {
    let _foreground_guard = state.foreground_guard();
    let notes_dir = prepare_notes_dir_with_state(false, Some(&state))?;

    let note_path = resolve_note_path_input_with_state(&notes_dir, note_id, path, Some(&state))?;

    read_note_session_from_path(&note_path)
}

#[tauri::command]
pub(crate) fn get_vault_info() -> Result<VaultInfo, String> {
    SettingsService::new().vault_info()
}

#[tauri::command]
pub(crate) fn set_vault_directory(
    state: State<'_, AppState>,
    app_data: State<'_, AppData>,
    path: Option<String>,
) -> Result<VaultInfo, String> {
    SettingsService::new().set_vault(&app_data, &state, path)
}

#[tauri::command]
pub(crate) fn save_note(
    state: State<'_, AppState>,
    app_data: State<'_, AppData>,
    title: String,
    markdown: String,
    current_path: Option<String>,
) -> Result<NoteSession, String> {
    NoteService::new().save(&app_data, &state, title, markdown, current_path)
}

#[tauri::command]
pub(crate) fn remember_note(
    state: State<'_, AppState>,
    app_data: State<'_, AppData>,
    title: String,
    markdown: String,
    current_path: Option<String>,
) -> Result<(), String> {
    NoteService::new().remember(&app_data, &state, title, markdown, current_path)
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
) -> Result<Vec<TaskListItem>, String> {
    list_tasks_impl(state, filter)
}

#[tauri::command]
pub(crate) fn set_task_hidden(task_key: String, hidden: bool) -> Result<(), String> {
    set_task_hidden_impl(task_key, hidden)
}

#[tauri::command]
pub(crate) fn set_note_hidden(note_id: String, hidden: bool) -> Result<(), String> {
    set_note_hidden_impl(note_id, hidden)
}

#[tauri::command]
pub(crate) fn set_note_collapsed(note_id: String, collapsed: bool) -> Result<(), String> {
    set_note_collapsed_impl(note_id, collapsed)
}

#[tauri::command]
pub(crate) fn set_note_order(
    state: State<'_, AppState>,
    note_ids: Vec<String>,
) -> Result<(), String> {
    set_note_order_impl(state, note_ids)
}

#[tauri::command]
pub(crate) fn toggle_task(
    state: State<'_, AppState>,
    app_data: State<'_, AppData>,
    note_path: String,
    line_number: usize,
    task_text: String,
) -> Result<TaskMutationDelta, String> {
    TaskService::new().toggle(&app_data, state, note_path, line_number, task_text)
}

#[tauri::command]
pub(crate) fn delete_task(
    state: State<'_, AppState>,
    app_data: State<'_, AppData>,
    note_path: String,
    line_number: usize,
    task_text: String,
    task_key: String,
) -> Result<TaskMutationDelta, String> {
    TaskService::new().delete(
        &app_data,
        state,
        note_path,
        line_number,
        task_text,
        task_key,
    )
}

#[tauri::command]
pub(crate) fn get_semantic_settings(
    state: State<'_, AppState>,
) -> Result<SemanticSettings, String> {
    state.semantic.get_settings()
}

#[tauri::command]
pub(crate) fn set_semantic_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: SemanticSettings,
) -> Result<SemanticSettings, String> {
    let next_settings = state.semantic.set_settings(settings)?;
    state.semantic.warmup_model_in_background();
    emit_semantic_status_changed(&app, &state);
    Ok(next_settings)
}

#[tauri::command]
pub(crate) fn get_semantic_status(state: State<'_, AppState>) -> Result<SemanticStatus, String> {
    state.semantic.get_status()
}

#[tauri::command]
pub(crate) fn rebuild_semantic_index(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.semantic.rebuild_index()?;
    emit_semantic_status_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn pause_semantic_indexing(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.semantic.pause_indexing()?;
    emit_semantic_status_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn resume_semantic_indexing(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.semantic.resume_indexing()?;
    emit_semantic_status_changed(&app, &state);
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

/// Re-export of the typed event channel name so legacy callers keep
/// linking against `commands::SEMANTIC_STATUS_CHANGED_EVENT`.
pub(crate) use crate::app::events::SEMANTIC_STATUS_CHANGED_EVENT;

/// Best-effort emit of the current semantic status to the frontend.
/// Used by mutation commands so the UI can reduce/avoid polling.
/// Now routed through the typed event bus when an [`AppData`] state is
/// available; falls back to the raw AppHandle emit as a safety net.
pub(crate) fn emit_semantic_status_changed(app: &AppHandle, state: &AppState) {
    if let Ok(status) = state.semantic.get_status() {
        if let Some(app_data) = app.try_state::<AppData>() {
            app_data.events.semantic_status_changed(status);
        } else {
            let _ = app.emit(SEMANTIC_STATUS_CHANGED_EVENT, status);
        }
    }
}

/// Bundled startup payload returned by `bootstrap_app`. Consolidates the
/// per-mount fan-out of `load_note_session` + `get_vault_info` +
/// `get_semantic_status` + `get_ai_settings` (and the index revision) into
/// a single round trip. The original commands continue to work for
/// callers that already use them.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BootstrapAppPayload {
    vault: VaultInfo,
    note_session: NoteSession,
    semantic_status: SemanticStatus,
    ai_settings: Option<AiSettings>,
    index_revision: u64,
}

#[tauri::command]
pub(crate) fn bootstrap_app(
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
) -> Result<BootstrapAppPayload, String> {
    let notes_dir = prepare_notes_dir_with_state(true, Some(&state))?;
    let note_session = load_note_session_from_notes_dir_with_state(&notes_dir, Some(&state))?;
    let vault = current_vault_info()?;
    let semantic_status = state.semantic.get_status()?;
    let ai_settings = ai.load_public_settings().ok();
    let index_revision = state.semantic.current_index_revision();
    Ok(BootstrapAppPayload {
        vault,
        note_session,
        semantic_status,
        ai_settings,
        index_revision,
    })
}

/// Bundled settings payload returned by `get_settings_view`. Replaces the
/// settings store's parallel fan-out of three semantic invokes plus
/// `get_vault_info` and `get_ai_settings` with a single call.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsViewPayload {
    vault: VaultInfo,
    semantic_status: SemanticStatus,
    semantic_settings: SemanticSettings,
    semantic_debug: SemanticDebugSnapshot,
    ai_settings: Option<AiSettings>,
}

#[tauri::command]
pub(crate) fn get_settings_view(
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
) -> Result<SettingsViewPayload, String> {
    let vault = current_vault_info()?;
    let semantic_status = state.semantic.get_status()?;
    let semantic_settings = state.semantic.get_settings()?;
    let semantic_debug = state.semantic.debug_snapshot()?;
    let ai_settings = ai.load_public_settings().ok();
    Ok(SettingsViewPayload {
        vault,
        semantic_status,
        semantic_settings,
        semantic_debug,
        ai_settings,
    })
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
        parse_wikilink_target, resolve_note_link_target, ParsedWikilinkTarget,
    };
    use super::{
        find_task_key_for_line, load_note_session_from_notes_dir, open_note_from_notes_dir,
        read_note_session_from_path, NoteSession, RecentTaskItem, ResolvedNoteLink, TaskListItem,
    };
    use crate::{
        index::{build_indexed_note, task_key, NotesIndex},
        note,
        search::{NoteSearchResult, ScoredSearchResult},
        state::initialize_app_data_dir,
        state::{read_state, write_state, PersistedState},
        test_support::{TestDir, TEST_ENV_GUARD},
    };
    use serde_json::json;
    use std::{fs, path::PathBuf};

    #[test]
    fn load_note_session_from_notes_dir_clears_stale_last_opened_path() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
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
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
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
    fn open_note_row_scoped_write_preserves_unrelated_state_fields() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
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
        assert_eq!(state.hidden_note_ids, vec![pinned.note_id.clone()]);
        assert_eq!(state.note_order_note_ids, vec![pinned.note_id.clone()]);
        assert_eq!(state.collapsed_note_ids, vec![pinned.note_id]);
    }

    #[test]
    fn read_note_session_from_path_does_not_update_last_opened_or_recents() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
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
    fn find_task_key_for_line_prefers_exact_line_then_nearest_match() {
        let note_path = PathBuf::from("/tmp/project.md");
        let note = build_indexed_note(
            &note_path,
            "# Project\n\n- [ ] Duplicate\n- [ ] Another\n- [ ] Duplicate\n",
            10,
        );

        let exact = find_task_key_for_line(&note_path, &note, 5, "Duplicate").expect("exact key");
        let nearest =
            find_task_key_for_line(&note_path, &note, 99, "Duplicate").expect("nearest key");

        assert_eq!(exact, task_key(&note.note_id, &note.tasks[2]));
        assert_eq!(nearest, task_key(&note.note_id, &note.tasks[2]));
    }

    #[test]
    fn merge_hybrid_candidates_applies_labels_scores_and_limit() {
        let lexical = vec![
            ScoredSearchResult {
                score: 100,
                result: NoteSearchResult {
                    note_id: Some("note-a".to_string()),
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
                    note_id: Some("note-b".to_string()),
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
        }];

        let results = merge_hybrid_candidates(
            lexical,
            semantic,
            "hybrid search",
            Some(PathBuf::from("/notes/current.md").as_path()),
            2,
            0.5,
            0.4,
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
        let note_path = PathBuf::from("/tmp/project.md");
        let note = build_indexed_note(
            &note_path,
            "# Project Atlas\n\nFirst paragraph.\n\n## Ideas\n\nSecond paragraph with link target.\n",
            10,
        );

        let paragraph_target = resolve_note_link_target(&note_path, &note, Some("Paragraph 2"));
        let heading_target = resolve_note_link_target(&note_path, &note, Some("Ideas"));
        let fallback_target = resolve_note_link_target(&note_path, &note, Some("Missing"));

        assert_eq!(paragraph_target.note_path, "/tmp/project.md");
        assert_eq!(paragraph_target.section_label, "Paragraph 2");
        assert_eq!(paragraph_target.match_text, "## Ideas");

        assert_eq!(heading_target.section_label, "Paragraph 2");
        assert_eq!(heading_target.match_text, "## Ideas");

        assert_eq!(fallback_target.section_label, "Title");
        assert_eq!(fallback_target.match_text, "project");
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
        };
        let resolved_note_link = ResolvedNoteLink {
            note_id: "note-1".to_string(),
            note_path: "/notes/title.md".to_string(),
            section_label: "Paragraph 2".to_string(),
            match_text: "Ship beta".to_string(),
        };
        let task = TaskListItem {
            note_id: "note-1".to_string(),
            task_key: "task-key".to_string(),
            task_id: Some("t_note1_abc123".to_string()),
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
