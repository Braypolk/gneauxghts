pub(crate) mod asset_commands;
pub(crate) mod forgotten_note_commands;
mod note_persistence;
mod path_utils;
pub(crate) mod search_commands;
mod task_commands;
pub(crate) mod wikilink_commands;

use crate::{
    index::{build_indexed_note, AppState, IndexedNote},
    note,
    semantic::{debug::SemanticDebugSnapshot, MapGraph, SemanticSettings, SemanticStatus},
    state::{
        current_vault_info, is_valid_note_path, notes_root, read_state, set_notes_root,
        touch_recent_path, validate_current_path, write_state, VaultInfo,
    },
    sync::{self, SyncConflict, SyncConflictDetail, SyncStatus},
};
use gneauxghts_sync_contract::RequestMagicLinkResponse;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[cfg(test)]
use task_commands::find_task_key_for_line;
use task_commands::{
    delete_task as delete_task_impl, list_recent_tasks as list_recent_tasks_impl,
    list_tasks as list_tasks_impl, reconcile_note_task_timestamps,
    set_note_collapsed as set_note_collapsed_impl, set_note_hidden as set_note_hidden_impl,
    set_note_order as set_note_order_impl, set_task_hidden as set_task_hidden_impl,
    toggle_task as toggle_task_impl,
};
use tauri::State;

const INTERACTIVE_INDEX_REFRESH_MAX_AGE: Duration = Duration::from_millis(750);
const ASSETS_DIRECTORY_NAME: &str = "assets";
const DEFAULT_PASTED_IMAGE_NAME: &str = "Pasted image";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteSession {
    markdown: String,
    path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedNoteLink {
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
    task_key: String,
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
    created_at_millis: u64,
    updated_at_millis: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentTaskItem {
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

fn prepare_notes_dir(cleanup_forgotten_notes: bool) -> Result<PathBuf, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    if cleanup_forgotten_notes {
        forgotten_note_commands::cleanup_expired_forgotten_notes(&notes_dir)?;
    }
    Ok(notes_dir)
}

#[tauri::command]
pub(crate) fn load_note_session() -> Result<NoteSession, String> {
    let notes_dir = prepare_notes_dir(true)?;
    load_note_session_from_notes_dir(&notes_dir)
}

#[tauri::command]
pub(crate) fn open_note(path: String) -> Result<NoteSession, String> {
    let notes_dir = prepare_notes_dir(true)?;
    open_note_from_notes_dir(&notes_dir, path)
}

#[tauri::command]
pub(crate) fn read_note(path: String) -> Result<NoteSession, String> {
    let notes_dir = prepare_notes_dir(true)?;

    let note_path = validate_current_path(Some(path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;

    read_note_session_from_path(&note_path)
}

#[tauri::command]
pub(crate) fn get_vault_info() -> Result<VaultInfo, String> {
    current_vault_info()
}

#[tauri::command]
pub(crate) fn set_vault_directory(path: Option<String>) -> Result<VaultInfo, String> {
    match path.as_deref().map(str::trim) {
        Some("") => set_notes_root(None),
        Some(path) => set_notes_root(Some(Path::new(path))),
        None => set_notes_root(None),
    }
}

#[tauri::command]
pub(crate) fn get_sync_status() -> Result<SyncStatus, String> {
    sync::get_sync_status()
}

#[tauri::command]
pub(crate) fn list_sync_conflicts() -> Result<Vec<SyncConflict>, String> {
    sync::list_sync_conflicts()
}

#[tauri::command]
pub(crate) fn get_sync_conflict_detail(
    note_id: String,
) -> Result<Option<SyncConflictDetail>, String> {
    sync::get_sync_conflict_detail(&note_id)
}

#[tauri::command]
pub(crate) async fn request_sync_magic_link(
    sync_base_url: String,
    email: String,
) -> Result<RequestMagicLinkResponse, String> {
    tauri::async_runtime::spawn_blocking(move || sync::request_magic_link(&sync_base_url, &email))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) async fn complete_sync_sign_in(
    sync_base_url: String,
    email: String,
    magic_link_token: String,
    device_name: Option<String>,
) -> Result<SyncStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sync::complete_magic_link(
            &sync_base_url,
            &email,
            &magic_link_token,
            device_name.as_deref(),
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) fn sync_now(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    let notes_dir = prepare_notes_dir(false)?;
    sync::sync_now(&state, &notes_dir)
}

#[tauri::command]
pub(crate) fn dismiss_sync_conflict(note_id: String) -> Result<SyncStatus, String> {
    sync::dismiss_sync_conflict(&note_id)
}

#[tauri::command]
pub(crate) fn resolve_sync_conflict_keep_local(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<SyncStatus, String> {
    let notes_dir = prepare_notes_dir(false)?;
    sync::resolve_sync_conflict_keep_local(&state, &notes_dir, &note_id)
}

#[tauri::command]
pub(crate) fn resolve_sync_conflict_keep_remote(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<SyncStatus, String> {
    sync::resolve_sync_conflict_keep_remote(&state, &note_id)
}

#[tauri::command]
pub(crate) fn sign_out_sync(keep_server_url: Option<bool>) -> Result<SyncStatus, String> {
    sync::sign_out(keep_server_url.unwrap_or(true))
}

#[tauri::command]
pub(crate) fn set_sync_paused(paused: bool) -> Result<SyncStatus, String> {
    sync::set_sync_paused(paused)
}

#[tauri::command]
pub(crate) fn save_note(
    state: State<'_, AppState>,
    markdown: String,
    current_path: Option<String>,
) -> Result<NoteSession, String> {
    note_persistence::persist_note_session(
        &state,
        markdown,
        current_path,
        note_persistence::NotePersistenceMode::Save,
    )?
    .ok_or_else(|| "Saved note session is missing".to_string())
}

#[tauri::command]
pub(crate) fn remember_note(
    state: State<'_, AppState>,
    markdown: String,
    current_path: Option<String>,
) -> Result<(), String> {
    note_persistence::persist_note_session(
        &state,
        markdown,
        current_path,
        note_persistence::NotePersistenceMode::Remember,
    )?;
    Ok(())
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
pub(crate) fn set_note_hidden(note_path: String, hidden: bool) -> Result<(), String> {
    set_note_hidden_impl(note_path, hidden)
}

#[tauri::command]
pub(crate) fn set_note_collapsed(note_path: String, collapsed: bool) -> Result<(), String> {
    set_note_collapsed_impl(note_path, collapsed)
}

#[tauri::command]
pub(crate) fn set_note_order(note_paths: Vec<String>) -> Result<(), String> {
    set_note_order_impl(note_paths)
}

#[tauri::command]
pub(crate) fn toggle_task(
    state: State<'_, AppState>,
    note_path: String,
    line_number: usize,
    task_text: String,
) -> Result<(), String> {
    toggle_task_impl(state, note_path, line_number, task_text)
}

#[tauri::command]
pub(crate) fn delete_task(
    state: State<'_, AppState>,
    note_path: String,
    line_number: usize,
    task_text: String,
    task_key: String,
) -> Result<(), String> {
    delete_task_impl(state, note_path, line_number, task_text, task_key)
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
    Ok(next_settings)
}

#[tauri::command]
pub(crate) fn get_semantic_status(state: State<'_, AppState>) -> Result<SemanticStatus, String> {
    state.semantic.get_status()
}

#[tauri::command]
pub(crate) fn rebuild_semantic_index(state: State<'_, AppState>) -> Result<(), String> {
    state.semantic.rebuild_index()
}

#[tauri::command]
pub(crate) fn pause_semantic_indexing(state: State<'_, AppState>) -> Result<(), String> {
    state.semantic.pause_indexing()
}

#[tauri::command]
pub(crate) fn resume_semantic_indexing(state: State<'_, AppState>) -> Result<(), String> {
    state.semantic.resume_indexing()
}

#[tauri::command]
pub(crate) async fn prepare_semantic_model(state: State<'_, AppState>) -> Result<(), String> {
    let semantic = state.semantic.clone();
    tauri::async_runtime::spawn_blocking(move || semantic.prepare_model())
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) async fn get_map_graph(
    state: State<'_, AppState>,
    _view: Option<String>,
    limit: usize,
    min_score: f32,
) -> Result<MapGraph, String> {
    let started_at = Instant::now();
    let semantic = state.semantic.clone();
    let graph = tauri::async_runtime::spawn_blocking(move || {
        semantic.map_graph(limit.max(24), min_score.max(0.0))
    })
    .await
    .map_err(|err| err.to_string())?;
    let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    match &graph {
        Ok(graph_data) => state.semantic.debug_state().record_timing(
            "map",
            "map_completed",
            Some(format!(
                "nodes={} edges={}",
                graph_data.nodes.len(),
                graph_data.edges.len()
            )),
            elapsed,
            |metrics| {
                metrics.map_request_count += 1;
                metrics.map_duration_total_millis += elapsed;
                metrics.map_duration_max_millis = metrics.map_duration_max_millis.max(elapsed);
            },
        ),
        Err(error) => state.semantic.debug_state().record_timing(
            "map",
            "map_failed",
            Some(error.clone()),
            elapsed,
            |metrics| {
                metrics.map_request_count += 1;
                metrics.map_duration_total_millis += elapsed;
                metrics.map_duration_max_millis = metrics.map_duration_max_millis.max(elapsed);
            },
        ),
    }
    graph
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

fn load_note_session_from_notes_dir(notes_dir: &Path) -> Result<NoteSession, String> {
    let mut state = read_state(notes_dir)?;
    let Some(last_opened_path) = state.last_opened_path.clone() else {
        return Ok(NoteSession {
            markdown: String::new(),
            path: None,
        });
    };

    let note_path = PathBuf::from(last_opened_path);
    if !is_valid_note_path(&note_path, notes_dir) {
        state.last_opened_path = None;
        state
            .recent_paths
            .retain(|path| PathBuf::from(path) != note_path);
        write_state(notes_dir, &state)?;
        return Ok(NoteSession {
            markdown: String::new(),
            path: None,
        });
    }

    touch_recent_path(&mut state, &note_path);
    write_state(notes_dir, &state)?;
    read_note_session_from_path(&note_path)
}

fn open_note_from_notes_dir(notes_dir: &Path, path: String) -> Result<NoteSession, String> {
    let note_path = validate_current_path(Some(path), notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;

    let mut state = read_state(notes_dir)?;
    state.last_opened_path = Some(note_path.to_string_lossy().into_owned());
    touch_recent_path(&mut state, &note_path);
    write_state(notes_dir, &state)?;

    read_note_session_from_path(&note_path)
}

fn read_note_session_from_path(note_path: &Path) -> Result<NoteSession, String> {
    let markdown = fs::read_to_string(note_path).map_err(|err| err.to_string())?;
    Ok(NoteSession {
        markdown: note::strip_frontmatter(&markdown),
        path: Some(note_path.to_string_lossy().into_owned()),
    })
}

fn current_time_millis() -> Result<u64, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();
    Ok(now.min(u128::from(u64::MAX)) as u64)
}

fn read_modified_millis(path: &Path) -> Result<u64, String> {
    let modified = fs::metadata(path)
        .map_err(|err| err.to_string())?
        .modified()
        .map_err(|err| err.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();

    Ok(modified.min(u128::from(u64::MAX)) as u64)
}

fn upsert_notes_index_entry(
    state: &State<'_, AppState>,
    path: PathBuf,
    note: IndexedNote,
) -> Result<(), String> {
    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.upsert_note(path, note);
    Ok(())
}

fn remove_notes_index_entry(state: &State<'_, AppState>, path: &Path) -> Result<(), String> {
    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.remove_note(path);
    Ok(())
}

fn read_indexed_note_from_path(path: &Path) -> Result<Option<IndexedNote>, String> {
    if !path.is_file() {
        return Ok(None);
    }

    let markdown = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let modified_millis = read_modified_millis(path)?;
    Ok(Some(build_indexed_note(path, &markdown, modified_millis)))
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
        read_note_session_from_path, reconcile_note_task_timestamps, NoteSession, RecentTaskItem,
        ResolvedNoteLink, TaskListItem,
    };
    use crate::{
        index::{build_indexed_note, task_key, NotesIndex},
        search::{NoteSearchResult, ScoredSearchResult},
        state::initialize_app_data_dir,
        state::{read_state, write_state, PersistedState, PersistedTaskTimestamps},
        test_support::{TestDir, TEST_ENV_GUARD},
    };
    use serde_json::json;
    use std::{collections::HashMap, fs, path::PathBuf};

    #[test]
    fn load_note_session_from_notes_dir_clears_stale_last_opened_path() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("commands-app-data-load");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("commands-load-session");
        let notes_dir = temp.path();
        let stale_path = notes_dir.join("Missing.md");
        write_state(
            notes_dir,
            &PersistedState {
                last_opened_path: Some(stale_path.to_string_lossy().into_owned()),
                recent_paths: vec![stale_path.to_string_lossy().into_owned()],
                ..PersistedState::default()
            },
        )
        .expect("write state");

        let session = load_note_session_from_notes_dir(notes_dir).expect("load note session");
        let state = read_state(notes_dir).expect("read state");

        assert_eq!(session.markdown, "");
        assert_eq!(session.path, None);
        assert_eq!(state.last_opened_path, None);
        assert!(state.recent_paths.is_empty());
    }

    #[test]
    fn open_note_from_notes_dir_updates_last_opened_and_recents() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("commands-app-data-open");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("commands-open-note");
        let notes_dir = temp.path();
        let note_path = notes_dir.join("Open Me.md");
        fs::write(&note_path, "# Open Me\n\nBody").expect("write note");

        let session = open_note_from_notes_dir(notes_dir, note_path.to_string_lossy().into_owned())
            .expect("open note");
        let state = read_state(notes_dir).expect("read state");

        assert_eq!(session.path, Some(note_path.to_string_lossy().into_owned()));
        assert_eq!(session.markdown, "# Open Me\n\nBody");
        assert_eq!(
            state.last_opened_path,
            Some(note_path.to_string_lossy().into_owned())
        );
        assert_eq!(
            state.recent_paths,
            vec![note_path.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn read_note_session_from_path_does_not_update_last_opened_or_recents() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("commands-app-data-read");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("commands-read-note");
        let notes_dir = temp.path();
        let note_path = notes_dir.join("Read Me.md");
        let existing_open_path = notes_dir.join("Already Open.md");
        fs::write(&note_path, "# Read Me\n\nBody").expect("write note");
        fs::write(&existing_open_path, "# Already Open\n\nBody").expect("write open note");
        write_state(
            notes_dir,
            &PersistedState {
                last_opened_path: Some(existing_open_path.to_string_lossy().into_owned()),
                recent_paths: vec![existing_open_path.to_string_lossy().into_owned()],
                ..PersistedState::default()
            },
        )
        .expect("write state");

        let session = read_note_session_from_path(&note_path).expect("read note");
        let state = read_state(notes_dir).expect("read state");

        assert_eq!(session.path, Some(note_path.to_string_lossy().into_owned()));
        assert_eq!(session.markdown, "# Read Me\n\nBody");
        assert_eq!(
            state.last_opened_path,
            Some(existing_open_path.to_string_lossy().into_owned())
        );
        assert_eq!(
            state.recent_paths,
            vec![existing_open_path.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn collect_recent_note_results_skips_current_note() {
        let current_path = PathBuf::from("/tmp/current.md");
        let other_path = PathBuf::from("/tmp/other.md");
        let mut index = NotesIndex::default();
        index.entries.insert(
            current_path.clone(),
            build_indexed_note(&current_path, "# Current\n\nBody", 10),
        );
        index.entries.insert(
            other_path.clone(),
            build_indexed_note(&other_path, "# Other\n\nElsewhere", 20),
        );

        let results = collect_recent_note_results(
            &[
                current_path.to_string_lossy().into_owned(),
                other_path.to_string_lossy().into_owned(),
            ],
            Some(current_path.as_path()),
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
    fn reconcile_note_task_timestamps_preserves_identity_across_reordering() {
        let note_path = PathBuf::from("/tmp/project.md");
        let previous_markdown = "# Project\n\n- [ ] Alpha\n- [ ] Beta\n";
        let next_markdown = "# Project\n\n- [ ] Beta\n- [ ] Alpha\n";
        let previous_note = build_indexed_note(&note_path, previous_markdown, 10);
        let next_note = build_indexed_note(&note_path, next_markdown, 20);
        let previous_alpha = task_key(&note_path, &previous_note.tasks[0]);
        let previous_beta = task_key(&note_path, &previous_note.tasks[1]);
        let next_beta = task_key(&note_path, &next_note.tasks[0]);
        let next_alpha = task_key(&note_path, &next_note.tasks[1]);

        let mut state = PersistedState {
            task_timestamps: HashMap::from([
                (
                    previous_alpha,
                    PersistedTaskTimestamps {
                        created_at_millis: 101,
                        updated_at_millis: 111,
                    },
                ),
                (
                    previous_beta,
                    PersistedTaskTimestamps {
                        created_at_millis: 202,
                        updated_at_millis: 222,
                    },
                ),
            ]),
            ..PersistedState::default()
        };

        reconcile_note_task_timestamps(
            &mut state,
            Some(note_path.as_path()),
            Some(&previous_note),
            Some(note_path.as_path()),
            Some(&next_note),
            999,
        );

        assert_eq!(state.task_timestamps[&next_alpha].created_at_millis, 101);
        assert_eq!(state.task_timestamps[&next_alpha].updated_at_millis, 111);
        assert_eq!(state.task_timestamps[&next_beta].created_at_millis, 202);
        assert_eq!(state.task_timestamps[&next_beta].updated_at_millis, 222);
    }

    #[test]
    fn reconcile_note_task_timestamps_updates_timestamp_when_completion_changes() {
        let note_path = PathBuf::from("/tmp/project.md");
        let previous_note = build_indexed_note(&note_path, "# Project\n\n- [ ] Ship beta\n", 10);
        let next_note = build_indexed_note(&note_path, "# Project\n\n- [x] Ship beta\n", 20);
        let previous_key = task_key(&note_path, &previous_note.tasks[0]);
        let next_key = task_key(&note_path, &next_note.tasks[0]);

        let mut state = PersistedState {
            task_timestamps: HashMap::from([(
                previous_key,
                PersistedTaskTimestamps {
                    created_at_millis: 123,
                    updated_at_millis: 456,
                },
            )]),
            ..PersistedState::default()
        };

        reconcile_note_task_timestamps(
            &mut state,
            Some(note_path.as_path()),
            Some(&previous_note),
            Some(note_path.as_path()),
            Some(&next_note),
            999,
        );

        assert_eq!(state.task_timestamps[&next_key].created_at_millis, 123);
        assert_eq!(state.task_timestamps[&next_key].updated_at_millis, 999);
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

        assert_eq!(exact, task_key(&note_path, &note.tasks[2]));
        assert_eq!(nearest, task_key(&note_path, &note.tasks[2]));
    }

    #[test]
    fn merge_hybrid_candidates_applies_labels_scores_and_limit() {
        let lexical = vec![
            ScoredSearchResult {
                score: 100,
                result: NoteSearchResult {
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
        assert_eq!(fallback_target.match_text, "Project Atlas");
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
            markdown: "# Title".to_string(),
            path: Some("/notes/title.md".to_string()),
        };
        let resolved_note_link = ResolvedNoteLink {
            note_path: "/notes/title.md".to_string(),
            section_label: "Paragraph 2".to_string(),
            match_text: "Ship beta".to_string(),
        };
        let task = TaskListItem {
            task_key: "task-key".to_string(),
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
            created_at_millis: 111,
            updated_at_millis: 222,
        };
        let recent_task = RecentTaskItem {
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
                "markdown": "# Title",
                "path": "/notes/title.md",
            })
        );
        assert_eq!(
            serde_json::to_value(task).expect("serialize task item"),
            json!({
                "taskKey": "task-key",
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
                "createdAtMillis": 111,
                "updatedAtMillis": 222,
            })
        );
        assert_eq!(
            serde_json::to_value(resolved_note_link).expect("serialize resolved note link"),
            json!({
                "notePath": "/notes/title.md",
                "sectionLabel": "Paragraph 2",
                "matchText": "Ship beta",
            })
        );
        assert_eq!(
            serde_json::to_value(recent_task).expect("serialize recent task"),
            json!({
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
