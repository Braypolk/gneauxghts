use crate::{
    index::{
        build_current_override, build_indexed_note, collapse_whitespace, delete_task_in_markdown,
        normalize_search_text, task_key, toggle_task_in_markdown, AppState, IndexedNote,
        NotesIndex,
    },
    note,
    search::{build_recent_result, search_note, NoteSearchResult, MAX_SEARCH_RESULTS},
    semantic::{
        debug::SemanticDebugSnapshot, MapGraph, SemanticChunkMatch, SemanticSettings,
        SemanticStatus,
    },
    state::{
        current_vault_info, forgotten_notes_root, is_valid_note_path, notes_root, persist_note,
        prune_recent_paths, push_unique, read_state, set_notes_root, touch_recent_path,
        validate_current_path, write_state, PersistedForgottenNote, PersistedState,
        PersistedTaskTimestamps, VaultInfo,
    },
    sync::{self, SyncConflict, SyncConflictDetail, SyncStatus},
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use gneauxghts_sync_contract::RequestMagicLinkResponse;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
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

#[derive(Clone)]
struct HybridCandidate {
    lexical_score: f32,
    semantic_score: f32,
    structural_boost: f32,
    result: NoteSearchResult,
}

#[tauri::command]
pub(crate) fn load_note_session() -> Result<NoteSession, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    cleanup_expired_forgotten_notes(&notes_dir)?;
    load_note_session_from_notes_dir(&notes_dir)
}

#[tauri::command]
pub(crate) fn open_note(path: String) -> Result<NoteSession, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    cleanup_expired_forgotten_notes(&notes_dir)?;
    open_note_from_notes_dir(&notes_dir, path)
}

#[tauri::command]
pub(crate) fn read_note(path: String) -> Result<NoteSession, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    cleanup_expired_forgotten_notes(&notes_dir)?;

    let note_path = validate_current_path(Some(path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;

    read_note_session_from_path(&note_path)
}

#[tauri::command]
pub(crate) fn get_vault_info() -> Result<VaultInfo, String> {
    current_vault_info()
}

#[tauri::command]
pub(crate) fn read_image_asset_data_url(file_name: String) -> Result<String, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    let assets_dir = notes_dir.join(ASSETS_DIRECTORY_NAME);
    read_image_asset_data_url_from_assets_dir(&assets_dir, &file_name)
}

#[tauri::command]
pub(crate) fn store_pasted_image(
    bytes: Vec<u8>,
    original_name: Option<String>,
    mime_type: Option<String>,
) -> Result<StoredImageAsset, String> {
    if bytes.is_empty() {
        return Err("Pasted image is empty".to_string());
    }

    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    let assets_dir = notes_dir.join(ASSETS_DIRECTORY_NAME);
    fs::create_dir_all(&assets_dir).map_err(|err| err.to_string())?;

    let target_path = resolve_pasted_image_path(
        &assets_dir,
        original_name.as_deref(),
        mime_type.as_deref(),
    );
    fs::write(&target_path, bytes).map_err(|err| err.to_string())?;

    Ok(StoredImageAsset {
        file_name: target_path
            .file_name()
            .and_then(OsStr::to_str)
            .ok_or_else(|| "Saved image is missing a file name".to_string())?
            .to_string(),
        file_path: target_path.to_string_lossy().into_owned(),
    })
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
pub(crate) fn get_sync_conflict_detail(note_id: String) -> Result<Option<SyncConflictDetail>, String> {
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
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
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
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
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
pub(crate) fn resolve_note_link(
    state: State<'_, AppState>,
    raw_target: String,
    current_path: Option<String>,
    current_markdown: String,
) -> Result<Option<ResolvedNoteLink>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let current_override = build_current_override(current_path.as_deref(), &current_markdown);
    let target = parse_wikilink_target(&raw_target);
    let Some(note_path) = resolve_wikilink_note_path(
        &state,
        &notes_dir,
        current_path.as_deref(),
        current_override.as_ref(),
        target.note.as_deref(),
    )?
    else {
        return Ok(None);
    };

    let note = if current_path.as_deref() == Some(note_path.as_path()) {
        current_override
            .as_ref()
            .cloned()
            .or_else(|| read_indexed_note_from_path(&note_path).ok().flatten())
    } else {
        read_indexed_note_from_path(&note_path)?
    };
    let Some(note) = note else {
        return Ok(None);
    };

    Ok(Some(resolve_note_link_target(
        &note_path,
        &note,
        target.section.as_deref(),
    )))
}

#[tauri::command]
pub(crate) fn autocomplete_note_links(
    state: State<'_, AppState>,
    raw_target: String,
    current_path: Option<String>,
    current_markdown: String,
    limit: usize,
) -> Result<Vec<NoteLinkSuggestion>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let current_override = build_current_override(current_path.as_deref(), &current_markdown);
    let target = parse_wikilink_target(&raw_target);
    let limit = limit.max(1);

    if raw_target.contains('|') {
        return Ok(Vec::new());
    }

    if raw_target.contains('#') {
        let Some(note) = resolve_wikilink_note_for_sections(
            &state,
            &notes_dir,
            current_path.as_deref(),
            current_override.as_ref(),
            target.note.as_deref(),
        )?
        else {
            return Ok(Vec::new());
        };

        return Ok(build_section_suggestions(
            target.note.as_deref(),
            target.section.as_deref().unwrap_or_default(),
            note,
            limit,
        ));
    }

    Ok(build_note_suggestions(
        &state,
        &notes_dir,
        current_path.as_deref(),
        current_override.as_ref(),
        target.note.as_deref().unwrap_or_default(),
        limit,
    )?)
}

#[tauri::command]
pub(crate) fn save_note(
    state: State<'_, AppState>,
    markdown: String,
    current_path: Option<String>,
) -> Result<NoteSession, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    cleanup_expired_forgotten_notes(&notes_dir)?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let previous_note = current_path
        .as_deref()
        .map(read_indexed_note_from_path)
        .transpose()?
        .flatten();
    let saved_path = persist_note(&notes_dir, &markdown, current_path.as_deref())?;
    let timestamp_millis = current_time_millis()?;
    let persisted_markdown = saved_path
        .as_deref()
        .map(|saved_path| fs::read_to_string(saved_path).map_err(|err| err.to_string()))
        .transpose()?;
    let next_note = saved_path.as_deref().zip(persisted_markdown.as_deref()).map(
        |(saved_path, persisted_markdown)| {
            build_indexed_note(Path::new(saved_path), persisted_markdown, timestamp_millis)
        },
    );

    let mut persisted_state = read_state(&notes_dir)?;
    persisted_state.last_opened_path = saved_path.clone();
    if let Some(saved_path) = saved_path.as_ref() {
        touch_recent_path(&mut persisted_state, Path::new(saved_path));
    }
    reconcile_note_task_timestamps(
        &mut persisted_state,
        current_path.as_deref(),
        previous_note.as_ref(),
        saved_path.as_deref().map(Path::new),
        next_note.as_ref(),
        timestamp_millis,
    );
    write_state(&notes_dir, &persisted_state)?;
    if let (Some(saved_path), Some(next_note)) = (saved_path.as_deref(), next_note.as_ref()) {
        upsert_notes_index_entry(&state, PathBuf::from(saved_path), next_note.clone())?;
    }
    if let Some(previous_path) = current_path.as_deref() {
        let previous_raw_path = previous_path.to_string_lossy().into_owned();
        if saved_path.as_deref() != Some(previous_raw_path.as_str()) {
            remove_notes_index_entry(&state, previous_path)?;
        }
    }
    if let (Some(saved_path), Some(persisted_markdown)) =
        (saved_path.as_deref(), persisted_markdown.as_deref())
    {
        sync::mark_note_dirty(Path::new(saved_path), &persisted_markdown)?;
        state.semantic.queue_note_update(
            Path::new(saved_path),
            persisted_markdown.to_string(),
            timestamp_millis,
        )?;
    }
    if let Some(previous_path) = current_path.as_deref() {
        let previous_raw_path = previous_path.to_string_lossy().into_owned();
        if saved_path.as_deref() != Some(previous_raw_path.as_str()) {
            state.semantic.queue_delete_note(previous_path)?;
        }
    }

    Ok(NoteSession {
        markdown: persisted_markdown
            .as_deref()
            .map(note::strip_frontmatter)
            .unwrap_or_else(|| note::normalize_wikilink_markdown(&markdown)),
        path: saved_path,
    })
}

#[tauri::command]
pub(crate) fn remember_note(
    state: State<'_, AppState>,
    markdown: String,
    current_path: Option<String>,
) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    cleanup_expired_forgotten_notes(&notes_dir)?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let previous_note = current_path
        .as_deref()
        .map(read_indexed_note_from_path)
        .transpose()?
        .flatten();
    let remembered_path = if !markdown.trim().is_empty() || current_path.is_some() {
        persist_note(&notes_dir, &markdown, current_path.as_deref())?
    } else {
        None
    };
    let timestamp_millis = current_time_millis()?;
    let next_note = remembered_path.as_deref().map(|remembered_path| {
        build_indexed_note(Path::new(remembered_path), &markdown, timestamp_millis)
    });

    let mut persisted_state = read_state(&notes_dir)?;
    persisted_state.last_opened_path = None;
    if let Some(remembered_path) = remembered_path.as_ref() {
        touch_recent_path(&mut persisted_state, Path::new(remembered_path));
    }
    reconcile_note_task_timestamps(
        &mut persisted_state,
        current_path.as_deref(),
        previous_note.as_ref(),
        remembered_path.as_deref().map(Path::new),
        next_note.as_ref(),
        timestamp_millis,
    );
    write_state(&notes_dir, &persisted_state)?;
    if let (Some(remembered_path), Some(next_note)) =
        (remembered_path.as_deref(), next_note.as_ref())
    {
        upsert_notes_index_entry(&state, PathBuf::from(remembered_path), next_note.clone())?;
    }
    if let Some(previous_path) = current_path.as_deref() {
        let previous_raw_path = previous_path.to_string_lossy().into_owned();
        if remembered_path.as_deref() != Some(previous_raw_path.as_str()) {
            remove_notes_index_entry(&state, previous_path)?;
        }
    }
    if let Some(remembered_path) = remembered_path.as_deref() {
        let persisted_markdown =
            fs::read_to_string(remembered_path).map_err(|err| err.to_string())?;
        sync::mark_note_dirty(Path::new(remembered_path), &persisted_markdown)?;
        state
            .semantic
            .queue_note_update(Path::new(remembered_path), persisted_markdown, timestamp_millis)?;
    }
    if let Some(previous_path) = current_path.as_deref() {
        let previous_raw_path = previous_path.to_string_lossy().into_owned();
        if remembered_path.as_deref() != Some(previous_raw_path.as_str()) {
            state.semantic.queue_delete_note(previous_path)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn forget_note(
    state: State<'_, AppState>,
    current_path: Option<String>,
    retention_days: u32,
) -> Result<Option<ForgottenNoteSummary>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    cleanup_expired_forgotten_notes(&notes_dir)?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let mut persisted_state = read_state(&notes_dir)?;

    if let Some(note_path) = current_path.as_ref() {
        validate_retention_days(retention_days)?;
        let previous_note = read_indexed_note_from_path(note_path)?;
        let forgotten_dir = forgotten_notes_root(&notes_dir);
        fs::create_dir_all(&forgotten_dir).map_err(|err| err.to_string())?;
        let forgotten_path = resolve_forgotten_target_path(&notes_dir, note_path);
        let forgotten_at_millis = current_time_millis()?;
        let forgotten_at_rfc3339 = note::current_timestamp_rfc3339()?;
        let purge_at_millis = forgotten_at_millis
            .saturating_add(u64::from(retention_days).saturating_mul(24 * 60 * 60 * 1000));
        let note_markdown = fs::read_to_string(note_path).map_err(|err| err.to_string())?;
        let forgotten_markdown = note::prepare_note_markdown(
            &note_markdown,
            Some(&note_markdown),
            Some(Some(forgotten_at_rfc3339)),
        )?
        .0;

        if note_path.exists() {
            fs::rename(note_path, &forgotten_path).map_err(|err| err.to_string())?;
            fs::write(&forgotten_path, &forgotten_markdown).map_err(|err| err.to_string())?;
        }

        reconcile_note_task_timestamps(
            &mut persisted_state,
            Some(note_path.as_path()),
            previous_note.as_ref(),
            None,
            None,
            current_time_millis()?,
        );
        let raw_path = note_path.to_string_lossy().into_owned();
        if persisted_state.last_opened_path.as_deref() == Some(raw_path.as_str()) {
            persisted_state.last_opened_path = None;
        }
        persisted_state
            .recent_paths
            .retain(|path| path != &raw_path);
        persisted_state
            .forgotten_notes
            .push(PersistedForgottenNote {
                forgotten_path: forgotten_path.to_string_lossy().into_owned(),
                original_path: raw_path.clone(),
                title: previous_note
                    .as_ref()
                    .map(|note| note.title.clone())
                    .unwrap_or_else(|| {
                        note_path
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned()
                    }),
                forgotten_at_millis,
                purge_after_days: retention_days,
                purge_at_millis,
            });
        state.semantic.queue_delete_note(note_path)?;
        sync::mark_note_trashed(&forgotten_path, &forgotten_markdown)?;
        let summary = build_forgotten_note_summary(
            persisted_state
                .forgotten_notes
                .last()
                .expect("forgotten note just inserted"),
        );
        write_state(&notes_dir, &persisted_state)?;
        remove_notes_index_entry(&state, note_path)?;
        return Ok(Some(summary));
    }

    write_state(&notes_dir, &persisted_state)?;
    Ok(None)
}

#[tauri::command]
pub(crate) fn list_forgotten_notes() -> Result<Vec<ForgottenNoteSummary>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    cleanup_expired_forgotten_notes(&notes_dir)?;

    let mut forgotten_notes = read_state(&notes_dir)?.forgotten_notes;
    forgotten_notes.sort_by(|left, right| {
        right
            .forgotten_at_millis
            .cmp(&left.forgotten_at_millis)
            .then_with(|| left.title.cmp(&right.title))
    });

    Ok(forgotten_notes
        .iter()
        .map(build_forgotten_note_summary)
        .collect())
}

#[tauri::command]
pub(crate) fn restore_forgotten_notes(
    state: State<'_, AppState>,
    forgotten_paths: Vec<String>,
) -> Result<Vec<RestoredForgottenNote>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    cleanup_expired_forgotten_notes(&notes_dir)?;

    let selected_paths = validate_forgotten_path_inputs(forgotten_paths, &notes_dir)?;
    if selected_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut persisted_state = read_state(&notes_dir)?;
    let mut restored_notes = Vec::new();
    let mut index = 0usize;

    while index < persisted_state.forgotten_notes.len() {
        if !selected_paths.contains(&persisted_state.forgotten_notes[index].forgotten_path) {
            index += 1;
            continue;
        }

        let forgotten_note = persisted_state.forgotten_notes.remove(index);
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        if !forgotten_path.is_file() {
            write_state(&notes_dir, &persisted_state)?;
            continue;
        }

        let restored_path =
            resolve_restore_target_path(&notes_dir, Path::new(&forgotten_note.original_path));
        let markdown = fs::read_to_string(&forgotten_path).map_err(|err| err.to_string())?;
        let restored_markdown =
            note::prepare_note_markdown(&markdown, Some(&markdown), Some(None))?.0;
        let timestamp_millis = current_time_millis()?;
        fs::rename(&forgotten_path, &restored_path).map_err(|err| err.to_string())?;
        fs::write(&restored_path, &restored_markdown).map_err(|err| err.to_string())?;

        let note = build_indexed_note(&restored_path, &restored_markdown, timestamp_millis);
        upsert_notes_index_entry(&state, restored_path.clone(), note)?;
        sync::mark_note_dirty(&restored_path, &restored_markdown)?;
        state
            .semantic
            .queue_note_update(&restored_path, restored_markdown, timestamp_millis)?;

        restored_notes.push(RestoredForgottenNote {
            forgotten_path: forgotten_note.forgotten_path,
            restored_path: restored_path.to_string_lossy().into_owned(),
            title: forgotten_note.title,
        });
        write_state(&notes_dir, &persisted_state)?;
    }

    Ok(restored_notes)
}

#[tauri::command]
pub(crate) fn delete_forgotten_notes(forgotten_paths: Vec<String>) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    cleanup_expired_forgotten_notes(&notes_dir)?;

    let selected_paths = validate_forgotten_path_inputs(forgotten_paths, &notes_dir)?;
    if selected_paths.is_empty() {
        return Ok(());
    }

    let mut persisted_state = read_state(&notes_dir)?;
    let mut index = 0usize;

    while index < persisted_state.forgotten_notes.len() {
        if !selected_paths.contains(&persisted_state.forgotten_notes[index].forgotten_path) {
            index += 1;
            continue;
        }

        let forgotten_note = persisted_state.forgotten_notes.remove(index);
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        if forgotten_path.exists() {
            if let Ok(markdown) = fs::read_to_string(&forgotten_path) {
                let _ = sync::mark_note_trashed(&forgotten_path, &markdown);
            }
            fs::remove_file(&forgotten_path).map_err(|err| err.to_string())?;
        }
        write_state(&notes_dir, &persisted_state)?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn list_recent_notes(
    state: State<'_, AppState>,
    limit: usize,
    current_path: Option<String>,
    current_markdown: String,
) -> Result<Vec<NoteSearchResult>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    cleanup_expired_forgotten_notes(&notes_dir)?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let _ = current_markdown;
    let mut persisted_state = read_state(&notes_dir)?;
    prune_recent_paths(&mut persisted_state, &notes_dir);
    write_state(&notes_dir, &persisted_state)?;

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh_if_stale(&notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?;

    let recent_results = collect_recent_note_results(
        &persisted_state.recent_paths,
        current_path.as_deref(),
        &index,
        limit,
    );

    Ok(recent_results)
}

fn collect_recent_note_results(
    recent_paths: &[String],
    current_path: Option<&Path>,
    index: &NotesIndex,
    limit: usize,
) -> Vec<NoteSearchResult> {
    recent_paths
        .iter()
        .filter_map(|raw_path| {
            let path = PathBuf::from(raw_path);
            if current_path == Some(path.as_path()) {
                return None;
            }

            let note = index.entries.get(&path)?;
            Some(build_recent_result(Some(path.as_path()), note))
        })
        .take(limit)
        .collect()
}

#[tauri::command]
pub(crate) fn list_recent_tasks(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<RecentTaskItem>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let mut persisted_state = read_state(&notes_dir)?;
    let hidden_task_keys = persisted_state
        .hidden_task_keys
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let hidden_note_paths = persisted_state
        .hidden_note_paths
        .iter()
        .cloned()
        .collect::<HashSet<_>>();

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh_if_stale(&notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?;
    let did_sync_task_timestamps = sync_task_timestamps_from_index(&mut persisted_state, &index);

    let mut tasks = Vec::new();

    for (path, note) in &index.entries {
        let raw_path = path.to_string_lossy().into_owned();
        if hidden_note_paths.contains(&raw_path) {
            continue;
        }

        for task in &note.tasks {
            if task.completed {
                continue;
            }

            let task_key = task_key(path, task);
            if hidden_task_keys.contains(&task_key) {
                continue;
            }

            let updated_at_millis = persisted_state
                .task_timestamps
                .get(&task_key)
                .map(|timestamps| timestamps.updated_at_millis)
                .unwrap_or(note.modified_millis);

            tasks.push(RecentTaskItem {
                task_key,
                note_path: raw_path.clone(),
                note_title: note.title.clone(),
                text: task.text.clone(),
                line_number: task.line_number,
                updated_at_millis,
            });
        }
    }

    drop(index);
    if did_sync_task_timestamps {
        write_state(&notes_dir, &persisted_state)?;
    }

    tasks.sort_by(|left, right| {
        right
            .updated_at_millis
            .cmp(&left.updated_at_millis)
            .then_with(|| {
                left.note_title
                    .to_lowercase()
                    .cmp(&right.note_title.to_lowercase())
            })
            .then_with(|| left.line_number.cmp(&right.line_number))
            .then_with(|| left.text.to_lowercase().cmp(&right.text.to_lowercase()))
    });
    tasks.truncate(limit);

    Ok(tasks)
}

#[tauri::command]
pub(crate) fn list_tasks(
    state: State<'_, AppState>,
    filter: TaskFilter,
) -> Result<Vec<TaskListItem>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    let mut persisted_state = read_state(&notes_dir)?;
    let hidden_task_keys = persisted_state
        .hidden_task_keys
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let hidden_note_paths = persisted_state
        .hidden_note_paths
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let collapsed_note_paths = persisted_state
        .collapsed_note_paths
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let note_order = persisted_state.note_order.clone();

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh_if_stale(&notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?;
    let did_sync_task_timestamps = sync_task_timestamps_from_index(&mut persisted_state, &index);

    let mut tasks = Vec::new();

    for (path, note) in &index.entries {
        for task in &note.tasks {
            let matches_filter = match filter {
                TaskFilter::Open => !task.completed,
                TaskFilter::Completed => task.completed,
                TaskFilter::All => true,
            };

            if !matches_filter {
                continue;
            }

            let task_key = task_key(path, task);
            let timestamps = persisted_state
                .task_timestamps
                .get(&task_key)
                .cloned()
                .unwrap_or(PersistedTaskTimestamps {
                    created_at_millis: note.modified_millis,
                    updated_at_millis: note.modified_millis,
                });

            tasks.push(TaskListItem {
                task_key: task_key.clone(),
                note_path: path.to_string_lossy().into_owned(),
                file_name: note.file_name.clone(),
                note_title: note.title.clone(),
                section_label: task.section_label.clone(),
                text: task.text.clone(),
                completed: task.completed,
                hidden: hidden_task_keys.contains(&task_key),
                note_hidden: hidden_note_paths.contains(&path.to_string_lossy().into_owned()),
                note_collapsed: collapsed_note_paths.contains(&path.to_string_lossy().into_owned()),
                depth: task.depth,
                line_number: task.line_number,
                created_at_millis: timestamps.created_at_millis,
                updated_at_millis: timestamps.updated_at_millis,
            });
        }
    }

    drop(index);
    if did_sync_task_timestamps {
        write_state(&notes_dir, &persisted_state)?;
    }

    let note_order_index = note_order
        .iter()
        .enumerate()
        .map(|(index, path)| (path.as_str(), index))
        .collect::<HashMap<_, _>>();

    tasks.sort_by(|left, right| {
        let left_note_rank = note_order_index.get(left.note_path.as_str()).copied();
        let right_note_rank = note_order_index.get(right.note_path.as_str()).copied();

        match (left_note_rank, right_note_rank) {
            (Some(left_rank), Some(right_rank)) => left_rank.cmp(&right_rank),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        }
        .then_with(|| {
            left.note_title
                .to_lowercase()
                .cmp(&right.note_title.to_lowercase())
        })
        .then_with(|| left.line_number.cmp(&right.line_number))
        .then_with(|| left.text.to_lowercase().cmp(&right.text.to_lowercase()))
    });

    Ok(tasks)
}

#[tauri::command]
pub(crate) fn set_task_hidden(task_key: String, hidden: bool) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let mut state = read_state(&notes_dir)?;
    if hidden {
        push_unique(&mut state.hidden_task_keys, task_key);
    } else {
        state
            .hidden_task_keys
            .retain(|existing_key| existing_key != &task_key);
    }
    write_state(&notes_dir, &state)
}

#[tauri::command]
pub(crate) fn set_note_hidden(note_path: String, hidden: bool) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let validated_path = validate_current_path(Some(note_path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;
    let raw_path = validated_path.to_string_lossy().into_owned();

    let mut state = read_state(&notes_dir)?;
    if hidden {
        push_unique(&mut state.hidden_note_paths, raw_path);
    } else {
        state
            .hidden_note_paths
            .retain(|existing_path| existing_path != &raw_path);
    }
    write_state(&notes_dir, &state)
}

#[tauri::command]
pub(crate) fn set_note_collapsed(note_path: String, collapsed: bool) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let validated_path = validate_current_path(Some(note_path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;
    let raw_path = validated_path.to_string_lossy().into_owned();

    let mut state = read_state(&notes_dir)?;
    if collapsed {
        push_unique(&mut state.collapsed_note_paths, raw_path);
    } else {
        state
            .collapsed_note_paths
            .retain(|existing_path| existing_path != &raw_path);
    }
    write_state(&notes_dir, &state)
}

#[tauri::command]
pub(crate) fn set_note_order(note_paths: Vec<String>) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let mut normalized_paths = Vec::new();
    let mut seen = HashSet::new();

    for note_path in note_paths {
        let Some(validated_path) = validate_current_path(Some(note_path), &notes_dir)? else {
            continue;
        };

        if !is_valid_note_path(&validated_path, &notes_dir) {
            continue;
        }

        let raw_path = validated_path.to_string_lossy().into_owned();
        if seen.insert(raw_path.clone()) {
            normalized_paths.push(raw_path);
        }
    }

    let mut state = read_state(&notes_dir)?;
    state.note_order = normalized_paths;
    write_state(&notes_dir, &state)
}

#[tauri::command]
pub(crate) fn toggle_task(
    state: State<'_, AppState>,
    note_path: String,
    line_number: usize,
    task_text: String,
) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let note_path = validate_current_path(Some(note_path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;
    let markdown = fs::read_to_string(&note_path).map_err(|err| err.to_string())?;
    let updated_markdown = toggle_task_in_markdown(&markdown, line_number, &task_text)?;
    fs::write(&note_path, &updated_markdown).map_err(|err| err.to_string())?;
    let timestamp_millis = current_time_millis()?;
    let updated_note = build_indexed_note(&note_path, &updated_markdown, timestamp_millis);
    let Some(toggled_task_key) =
        find_task_key_for_line(&note_path, &updated_note, line_number, &task_text)
    else {
        sync::mark_note_dirty(&note_path, &updated_markdown)?;
        upsert_notes_index_entry(&state, note_path.clone(), updated_note)?;
        return Ok(());
    };

    let mut persisted_state = read_state(&notes_dir)?;
    let fallback_timestamp = updated_note.modified_millis;
    let timestamps = persisted_state
        .task_timestamps
        .entry(toggled_task_key)
        .or_insert(PersistedTaskTimestamps {
            created_at_millis: fallback_timestamp,
            updated_at_millis: fallback_timestamp,
    });
    timestamps.updated_at_millis = timestamp_millis;
    write_state(&notes_dir, &persisted_state)?;
    sync::mark_note_dirty(&note_path, &updated_markdown)?;
    upsert_notes_index_entry(&state, note_path.clone(), updated_note)?;
    state
        .semantic
        .queue_note_update(&note_path, updated_markdown, timestamp_millis)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_task(
    state: State<'_, AppState>,
    note_path: String,
    line_number: usize,
    task_text: String,
    task_key: String,
) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let note_path = validate_current_path(Some(note_path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;
    let markdown = fs::read_to_string(&note_path).map_err(|err| err.to_string())?;
    let updated_markdown = delete_task_in_markdown(&markdown, line_number, &task_text)?;
    fs::write(&note_path, &updated_markdown).map_err(|err| err.to_string())?;
    let timestamp_millis = current_time_millis()?;
    let updated_note = build_indexed_note(&note_path, &updated_markdown, timestamp_millis);
    sync::mark_note_dirty(&note_path, &updated_markdown)?;
    upsert_notes_index_entry(&state, note_path.clone(), updated_note)?;

    let mut persisted_state = read_state(&notes_dir)?;
    persisted_state.hidden_task_keys.retain(|k| k != &task_key);
    persisted_state.task_timestamps.remove(&task_key);
    write_state(&notes_dir, &persisted_state)?;

    state
        .semantic
        .queue_note_update(&note_path, updated_markdown, timestamp_millis)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn search_notes(
    state: State<'_, AppState>,
    query: String,
    mode: SearchMode,
    current_path: Option<String>,
    current_markdown: String,
) -> Result<Vec<NoteSearchResult>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let normalized_query = normalize_search_text(&query);
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    let query_terms = normalized_query
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    if query_terms.is_empty() {
        return Ok(Vec::new());
    }

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let mut candidates = collect_lexical_candidates(
        &state,
        &notes_dir,
        mode,
        current_path.as_deref(),
        &current_markdown,
        &normalized_query,
        &query_terms,
    )?;

    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.result.file_name.cmp(&right.result.file_name))
            .then_with(|| left.result.section_label.cmp(&right.result.section_label))
            .then_with(|| left.result.note_path.cmp(&right.result.note_path))
    });
    candidates.truncate(MAX_SEARCH_RESULTS);

    Ok(candidates
        .into_iter()
        .map(|candidate| candidate.result)
        .collect())
}

#[tauri::command]
pub(crate) async fn search_notes_hybrid(
    state: State<'_, AppState>,
    query: String,
    mode: SearchMode,
    current_path: Option<String>,
    current_markdown: String,
    limit: usize,
    semantic_weight: Option<f32>,
    lexical_weight: Option<f32>,
) -> Result<Vec<NoteSearchResult>, String> {
    let started_at = Instant::now();
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let normalized_query = normalize_search_text(&query);
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    let query_terms = normalized_query
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    if query_terms.is_empty() {
        return Ok(Vec::new());
    }

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let lexical_candidates = collect_lexical_candidates(
        &state,
        &notes_dir,
        mode.clone(),
        current_path.as_deref(),
        &current_markdown,
        &normalized_query,
        &query_terms,
    )?;
    let settings = state.semantic.get_settings()?;
    let lexical_weight = lexical_weight.unwrap_or(settings.lexical_weight).max(0.0);
    let semantic_weight = semantic_weight.unwrap_or(settings.semantic_weight).max(0.0);
    let current_path_raw = current_path
        .as_deref()
        .map(|path| path.to_string_lossy().into_owned());
    let should_use_semantic = settings.semantic_search_enabled
        && matches!(mode, SearchMode::All)
        && (normalized_query.len() >= 6 || query_terms.len() >= 2);

    if !should_use_semantic {
        let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        let debug = state.semantic.debug_state();
        debug.record_timing(
            "search",
            "search_completed",
            Some("semantic_skipped".to_string()),
            elapsed,
            |metrics| {
                metrics.search_request_count += 1;
                metrics.search_semantic_skipped_count += 1;
                metrics.search_duration_total_millis += elapsed;
                metrics.search_duration_max_millis =
                    metrics.search_duration_max_millis.max(elapsed);
            },
        );
        return Ok(finalize_lexical_results(lexical_candidates, limit));
    }

    let semantic = state.semantic.clone();
    let semantic_query = query.clone();
    let semantic_matches = tauri::async_runtime::spawn_blocking(move || {
        semantic.semantic_matches_for_text(
            &semantic_query,
            current_path_raw.as_deref(),
            limit.saturating_mul(3).max(limit),
        )
    })
    .await
    .map_err(|err| err.to_string())??;

    let ranked = merge_hybrid_candidates(
        lexical_candidates,
        semantic_matches,
        &normalized_query,
        current_path.as_deref(),
        limit,
        lexical_weight,
        semantic_weight,
    );
    let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    state.semantic.debug_state().record_timing(
        "search",
        "search_completed",
        Some(format!("semantic_used results={}", ranked.len())),
        elapsed,
        |metrics| {
            metrics.search_request_count += 1;
            metrics.search_semantic_used_count += 1;
            metrics.search_duration_total_millis += elapsed;
            metrics.search_duration_max_millis = metrics.search_duration_max_millis.max(elapsed);
        },
    );
    Ok(ranked)
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

fn collect_lexical_candidates(
    state: &State<'_, AppState>,
    notes_dir: &Path,
    mode: SearchMode,
    current_path: Option<&Path>,
    current_markdown: &str,
    normalized_query: &str,
    query_terms: &[&str],
) -> Result<Vec<crate::search::ScoredSearchResult>, String> {
    let current_override = build_current_override(current_path, current_markdown);
    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh_if_stale(notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?;

    let mut candidates = Vec::new();
    match mode {
        SearchMode::Current => {
            if let Some(current_note) = current_override.as_ref() {
                candidates.extend(search_note(
                    current_path,
                    current_note,
                    normalized_query,
                    query_terms,
                ));
            }
        }
        SearchMode::All => {
            if let Some(current_note) = current_override.as_ref() {
                candidates.extend(search_note(
                    current_path,
                    current_note,
                    normalized_query,
                    query_terms,
                ));
            }

            for (path, note) in &index.entries {
                if current_path == Some(path.as_path()) {
                    continue;
                }

                candidates.extend(search_note(
                    Some(path.as_path()),
                    note,
                    normalized_query,
                    query_terms,
                ));
            }
        }
    }

    Ok(candidates)
}

#[derive(Debug, PartialEq, Eq)]
struct ParsedWikilinkTarget {
    note: Option<String>,
    section: Option<String>,
}

fn parse_wikilink_target(raw_target: &str) -> ParsedWikilinkTarget {
    let target = raw_target
        .split_once('|')
        .map(|(target, _)| target)
        .unwrap_or(raw_target)
        .trim();
    let (note, section) = target
        .split_once('#')
        .map(|(note, section)| (Some(note), Some(section)))
        .unwrap_or((Some(target), None));

    ParsedWikilinkTarget {
        note: note
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        section: section
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    }
}

fn normalize_note_reference(value: &str) -> String {
    let trimmed = value.trim();
    let without_extension = trimmed
        .strip_suffix(".md")
        .or_else(|| trimmed.strip_suffix(".MD"))
        .unwrap_or(trimmed);
    normalize_search_text(without_extension)
}

fn note_matches_reference(reference: &str, note: &IndexedNote) -> bool {
    let normalized_reference = normalize_note_reference(reference);
    !normalized_reference.is_empty()
        && (normalized_reference == note.title_lower
            || normalized_reference == note.file_name_lower)
}

fn resolve_wikilink_note_path(
    state: &State<'_, AppState>,
    notes_dir: &Path,
    current_path: Option<&Path>,
    current_override: Option<&IndexedNote>,
    note_reference: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let Some(note_reference) = note_reference else {
        return Ok(current_path.map(Path::to_path_buf));
    };

    if let (Some(current_path), Some(current_override)) = (current_path, current_override) {
        if note_matches_reference(note_reference, current_override) {
            return Ok(Some(current_path.to_path_buf()));
        }
    }

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh_if_stale(notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?;

    Ok(index
        .entries
        .iter()
        .find(|(_, note)| note_matches_reference(note_reference, note))
        .map(|(path, _)| path.clone()))
}

fn resolve_wikilink_note_for_sections(
    state: &State<'_, AppState>,
    notes_dir: &Path,
    current_path: Option<&Path>,
    current_override: Option<&IndexedNote>,
    note_reference: Option<&str>,
) -> Result<Option<IndexedNote>, String> {
    let Some(note_reference) = note_reference else {
        return Ok(current_override.cloned().or_else(|| {
            current_path.and_then(|path| read_indexed_note_from_path(path).ok().flatten())
        }));
    };

    if let Some(current_override) = current_override {
        if note_matches_reference(note_reference, current_override) {
            return Ok(Some(current_override.clone()));
        }
    }

    let Some(note_path) = resolve_wikilink_note_path(
        state,
        notes_dir,
        current_path,
        current_override,
        Some(note_reference),
    )?
    else {
        return Ok(None);
    };

    read_indexed_note_from_path(&note_path)
}

fn display_text_for_section(text: &str) -> String {
    let normalized_lines = text
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            let trimmed = if trimmed.starts_with('#') {
                trimmed.trim_start_matches('#').trim()
            } else if let Some(rest) = trimmed.strip_prefix("> ") {
                rest.trim()
            } else if let Some(rest) = trimmed
                .strip_prefix("- [ ] ")
                .or_else(|| trimmed.strip_prefix("- [x] "))
                .or_else(|| trimmed.strip_prefix("- [X] "))
                .or_else(|| trimmed.strip_prefix("* [ ] "))
                .or_else(|| trimmed.strip_prefix("* [x] "))
                .or_else(|| trimmed.strip_prefix("* [X] "))
            {
                rest.trim()
            } else if let Some(rest) = trimmed
                .strip_prefix("- ")
                .or_else(|| trimmed.strip_prefix("* "))
            {
                rest.trim()
            } else {
                trimmed
            };

            trimmed
                .replace("[[", "")
                .replace("]]", "")
                .replace('`', "")
                .replace('*', "")
                .replace('_', "")
                .replace('~', "")
        })
        .collect::<Vec<_>>();

    collapse_whitespace(&normalized_lines.join(" "))
}

fn build_note_suggestions(
    state: &State<'_, AppState>,
    notes_dir: &Path,
    current_path: Option<&Path>,
    current_override: Option<&IndexedNote>,
    query: &str,
    limit: usize,
) -> Result<Vec<NoteLinkSuggestion>, String> {
    let normalized_query = normalize_note_reference(query);
    let mut suggestions = Vec::<(u8, String, NoteLinkSuggestion)>::new();
    let mut seen_values = HashSet::<String>::new();

    if let (Some(_current_path), Some(current_override)) = (current_path, current_override) {
        let label = current_override.title.clone();
        let value = label.clone();
        let note_label = current_override.title_lower.clone();
        let file_label = current_override.file_name_lower.clone();
        let matches_query = normalized_query.is_empty()
            || note_label.contains(&normalized_query)
            || file_label.contains(&normalized_query);

        if matches_query && seen_values.insert(value.clone()) {
            let rank = if note_label.starts_with(&normalized_query)
                || file_label.starts_with(&normalized_query)
            {
                0
            } else {
                1
            };

            suggestions.push((
                rank,
                label.to_lowercase(),
                NoteLinkSuggestion {
                    kind: "note".to_string(),
                    value,
                    label: label.clone(),
                    detail: "Current note".to_string(),
                },
            ));
        }
    }

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh_if_stale(notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?;

    for (path, note) in &index.entries {
        if current_path.is_some_and(|current_path| current_path == path.as_path()) {
            continue;
        }

        let matches_query = normalized_query.is_empty()
            || note.title_lower.contains(&normalized_query)
            || note.file_name_lower.contains(&normalized_query);
        if !matches_query {
            continue;
        }

        let value = note.title.clone();
        if !seen_values.insert(value.clone()) {
            continue;
        }

        let rank = if note.title_lower.starts_with(&normalized_query)
            || note.file_name_lower.starts_with(&normalized_query)
        {
            0
        } else {
            1
        };
        let detail = if note.file_name == note.title {
            "Note".to_string()
        } else {
            note.file_name.clone()
        };

        suggestions.push((
            rank,
            note.title_lower.clone(),
            NoteLinkSuggestion {
                kind: "note".to_string(),
                value,
                label: note.title.clone(),
                detail,
            },
        ));
    }

    suggestions.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    suggestions.truncate(limit);

    Ok(suggestions
        .into_iter()
        .map(|(_, _, suggestion)| suggestion)
        .collect())
}

fn build_section_suggestions(
    note_reference: Option<&str>,
    query: &str,
    note: IndexedNote,
    limit: usize,
) -> Vec<NoteLinkSuggestion> {
    let normalized_query = normalize_section_reference(query);
    let prefix = note_reference
        .map(|note_reference| format!("{}#", note_reference.trim()))
        .unwrap_or_else(|| "#".to_string());
    let mut suggestions = Vec::<(u8, String, NoteLinkSuggestion)>::new();
    let mut seen_values = HashSet::<String>::new();

    for paragraph in note
        .paragraphs
        .iter()
        .filter(|paragraph| paragraph.section_label != "Title")
    {
        let label = display_text_for_section(&paragraph.text);
        if label.is_empty() {
            continue;
        }

        let normalized_label = normalize_search_text(&label);
        if !normalized_query.is_empty() && !normalized_label.contains(&normalized_query) {
            continue;
        }

        let value = format!("{prefix}{label}");
        if !seen_values.insert(value.clone()) {
            continue;
        }

        let rank = if normalized_label.starts_with(&normalized_query) {
            0
        } else {
            1
        };
        let detail = if paragraph.text.trim_start().starts_with('#') {
            format!("Header in {}", note.title)
        } else {
            format!("{} in {}", paragraph.section_label, note.title)
        };

        suggestions.push((
            rank,
            normalized_label.clone(),
            NoteLinkSuggestion {
                kind: "section".to_string(),
                value,
                label,
                detail,
            },
        ));
    }

    suggestions.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    suggestions.truncate(limit);

    suggestions
        .into_iter()
        .map(|(_, _, suggestion)| suggestion)
        .collect()
}

fn normalize_section_reference(value: &str) -> String {
    normalize_search_text(value.trim().trim_start_matches('^'))
}

fn resolve_note_link_target(
    note_path: &Path,
    note: &IndexedNote,
    section_reference: Option<&str>,
) -> ResolvedNoteLink {
    let fallback = ResolvedNoteLink {
        note_path: note_path.to_string_lossy().into_owned(),
        section_label: "Title".to_string(),
        match_text: note.title.clone(),
    };

    let Some(section_reference) = section_reference else {
        return fallback;
    };

    let normalized_reference = normalize_section_reference(section_reference);
    if normalized_reference.is_empty() {
        return fallback;
    }

    if normalized_reference == "title" {
        return fallback;
    }

    let paragraph_number = normalized_reference
        .strip_prefix("paragraph ")
        .and_then(|value| value.parse::<usize>().ok());

    let matched_paragraph = note
        .paragraphs
        .iter()
        .find(|paragraph| {
            paragraph_number.is_some_and(|paragraph_number| {
                paragraph.paragraph_index == Some(paragraph_number.saturating_sub(1))
            })
        })
        .or_else(|| {
            note.paragraphs.iter().find(|paragraph| {
                normalize_search_text(&paragraph.section_label) == normalized_reference
            })
        })
        .or_else(|| {
            note.paragraphs
                .iter()
                .find(|paragraph| paragraph.text_lower == normalized_reference)
        })
        .or_else(|| {
            note.paragraphs.iter().find(|paragraph| {
                paragraph.text_lower.starts_with(&normalized_reference)
                    || paragraph.text_lower.contains(&normalized_reference)
            })
        });

    matched_paragraph.map_or(fallback, |paragraph| ResolvedNoteLink {
        note_path: note_path.to_string_lossy().into_owned(),
        section_label: paragraph.section_label.clone(),
        match_text: paragraph.text.clone(),
    })
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

fn finalize_lexical_results(
    mut candidates: Vec<crate::search::ScoredSearchResult>,
    limit: usize,
) -> Vec<NoteSearchResult> {
    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.result.file_name.cmp(&right.result.file_name))
            .then_with(|| left.result.section_label.cmp(&right.result.section_label))
            .then_with(|| left.result.note_path.cmp(&right.result.note_path))
    });
    candidates.truncate(limit.max(1));
    candidates
        .into_iter()
        .map(|mut candidate| {
            candidate.result.lexical_score = Some(candidate.score as f32);
            candidate.result.reason_labels = vec!["keyword".to_string()];
            candidate.result
        })
        .collect()
}

fn merge_hybrid_candidates(
    lexical_candidates: Vec<crate::search::ScoredSearchResult>,
    semantic_matches: Vec<SemanticChunkMatch>,
    normalized_query: &str,
    current_path: Option<&Path>,
    limit: usize,
    lexical_weight: f32,
    semantic_weight: f32,
) -> Vec<NoteSearchResult> {
    let max_lexical = lexical_candidates
        .iter()
        .map(|candidate| candidate.score as f32)
        .fold(0.0, f32::max);
    let max_semantic = semantic_matches
        .iter()
        .map(|candidate| candidate.score)
        .fold(0.0, f32::max);
    let mut merged = HashMap::<String, HybridCandidate>::new();

    for lexical_candidate in lexical_candidates {
        let mut result = lexical_candidate.result;
        let lexical_score = if max_lexical > 0.0 {
            lexical_candidate.score as f32 / max_lexical
        } else {
            0.0
        };
        result.reason_labels.push("keyword".to_string());
        result.lexical_score = Some(lexical_score);
        let structural_boost = structural_boost(&result, normalized_query, current_path);
        merged.insert(
            hybrid_candidate_key(&result),
            HybridCandidate {
                lexical_score,
                semantic_score: 0.0,
                structural_boost,
                result,
            },
        );
    }

    for semantic_match in semantic_matches {
        let semantic_score = if max_semantic > 0.0 {
            semantic_match.score / max_semantic
        } else {
            0.0
        };
        let key = format!(
            "{}::{}::{}::{}",
            semantic_match.note_path,
            semantic_match.section_label,
            semantic_match.start_line,
            semantic_match.end_line
        );
        let file_name = Path::new(&semantic_match.note_path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(&semantic_match.note_title)
            .to_string();
        let structural_boost =
            structural_boost_from_semantic(&semantic_match, normalized_query, current_path);

        let entry = merged.entry(key).or_insert_with(|| HybridCandidate {
            lexical_score: 0.0,
            semantic_score: 0.0,
            structural_boost,
            result: NoteSearchResult {
                note_path: Some(semantic_match.note_path.clone()),
                file_name,
                section_label: semantic_match.section_label.clone(),
                excerpt: semantic_match.excerpt.clone(),
                highlight_ranges: Vec::new(),
                match_text: semantic_match.match_text.clone(),
                reason_labels: vec!["semantic".to_string()],
                lexical_score: None,
                semantic_score: Some(semantic_score),
                start_line: Some(semantic_match.start_line),
                end_line: Some(semantic_match.end_line),
            },
        });

        entry.semantic_score = entry.semantic_score.max(semantic_score);
        entry.result.semantic_score = Some(entry.semantic_score);
        if !entry
            .result
            .reason_labels
            .iter()
            .any(|label| label == "semantic")
        {
            entry.result.reason_labels.push("semantic".to_string());
        }
        entry.structural_boost = entry.structural_boost.max(structural_boost);
    }

    let mut ranked = merged.into_values().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        let left_score = lexical_weight * left.lexical_score
            + semantic_weight * left.semantic_score
            + 0.10 * left.structural_boost;
        let right_score = lexical_weight * right.lexical_score
            + semantic_weight * right.semantic_score
            + 0.10 * right.structural_boost;
        right_score
            .total_cmp(&left_score)
            .then_with(|| left.result.file_name.cmp(&right.result.file_name))
            .then_with(|| left.result.section_label.cmp(&right.result.section_label))
    });

    ranked.truncate(limit.max(1));
    ranked
        .into_iter()
        .map(|mut candidate| {
            candidate.result.lexical_score = Some(candidate.lexical_score);
            candidate.result.semantic_score = Some(candidate.semantic_score);
            candidate.result
        })
        .collect()
}

fn hybrid_candidate_key(result: &NoteSearchResult) -> String {
    format!(
        "{}::{}::{}",
        result.note_path.as_deref().unwrap_or("draft"),
        result.section_label,
        result.match_text
    )
}

fn structural_boost(
    result: &NoteSearchResult,
    normalized_query: &str,
    current_path: Option<&Path>,
) -> f32 {
    let mut boost = 0.0;
    let excerpt = normalize_search_text(&result.excerpt);
    let file_name = normalize_search_text(&result.file_name);
    let section_label = normalize_search_text(&result.section_label);

    if file_name.contains(normalized_query) {
        boost += 1.0;
    }
    if section_label.contains(normalized_query) {
        boost += 0.7;
    }
    if excerpt.contains(normalized_query) {
        boost += 0.9;
    }
    if current_path
        .and_then(|path| path.to_str())
        .zip(result.note_path.as_deref())
        .is_some_and(|(current, result_path)| current == result_path)
    {
        boost -= 0.2;
    }

    boost
}

fn structural_boost_from_semantic(
    result: &SemanticChunkMatch,
    normalized_query: &str,
    current_path: Option<&Path>,
) -> f32 {
    let mut boost = 0.0;
    let title = normalize_search_text(&result.note_title);
    let excerpt = normalize_search_text(&result.excerpt);

    if title.contains(normalized_query) {
        boost += 1.0;
    }
    if excerpt.contains(normalized_query) {
        boost += 0.8;
    }
    if current_path
        .and_then(|path| path.to_str())
        .is_some_and(|current| current == result.note_path)
    {
        boost -= 0.2;
    }
    boost
}

fn read_note_session_from_path(note_path: &Path) -> Result<NoteSession, String> {
    let markdown = fs::read_to_string(note_path).map_err(|err| err.to_string())?;
    Ok(NoteSession {
        markdown: note::strip_frontmatter(&markdown),
        path: Some(note_path.to_string_lossy().into_owned()),
    })
}

#[derive(Clone)]
struct TaskTimestampCandidate {
    key: String,
    text_lower: String,
    section_label: Option<String>,
    completed: bool,
    depth: usize,
    line_number: usize,
    fallback_millis: u64,
}

fn validate_retention_days(retention_days: u32) -> Result<(), String> {
    match retention_days {
        1 | 7 | 30 => Ok(()),
        _ => Err("Unsupported forgotten note retention window".to_string()),
    }
}

fn build_forgotten_note_summary(forgotten_note: &PersistedForgottenNote) -> ForgottenNoteSummary {
    ForgottenNoteSummary {
        forgotten_path: forgotten_note.forgotten_path.clone(),
        original_path: forgotten_note.original_path.clone(),
        title: forgotten_note.title.clone(),
        file_name: Path::new(&forgotten_note.original_path)
            .file_stem()
            .unwrap_or_else(|| OsStr::new("untitled"))
            .to_string_lossy()
            .into_owned(),
        forgotten_at_millis: forgotten_note.forgotten_at_millis,
        purge_after_days: forgotten_note.purge_after_days,
        purge_at_millis: forgotten_note.purge_at_millis,
    }
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

fn validate_forgotten_path_inputs(
    forgotten_paths: Vec<String>,
    notes_dir: &Path,
) -> Result<HashSet<String>, String> {
    let forgotten_root = forgotten_notes_root(notes_dir);
    let mut selected = HashSet::new();

    for raw_path in forgotten_paths {
        let path = PathBuf::from(&raw_path);
        if !path.starts_with(&forgotten_root) {
            return Err("Forgotten note path is outside the forgotten notes directory".to_string());
        }
        if !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            return Err("Forgotten note path is not a markdown file".to_string());
        }
        selected.insert(raw_path);
    }

    Ok(selected)
}

fn resolve_forgotten_target_path(notes_dir: &Path, original_path: &Path) -> PathBuf {
    unique_path_in_dir(
        &forgotten_notes_root(notes_dir),
        original_path
            .file_name()
            .unwrap_or_else(|| OsStr::new("Untitled Note.md")),
    )
}

fn resolve_restore_target_path(notes_dir: &Path, original_path: &Path) -> PathBuf {
    if original_path.parent() == Some(notes_dir) && !original_path.exists() {
        return original_path.to_path_buf();
    }

    unique_path_in_dir(
        notes_dir,
        original_path
            .file_name()
            .unwrap_or_else(|| OsStr::new("Untitled Note.md")),
    )
}

fn unique_path_in_dir(directory: &Path, preferred_file_name: &OsStr) -> PathBuf {
    let preferred_path = directory.join(preferred_file_name);
    if !preferred_path.exists() {
        return preferred_path;
    }

    let preferred_path = Path::new(preferred_file_name);
    let stem = preferred_path
        .file_stem()
        .unwrap_or_else(|| OsStr::new("Untitled Note"))
        .to_string_lossy();
    let extension = preferred_path
        .extension()
        .map(|value| value.to_string_lossy());

    for suffix in 2.. {
        let candidate_name = match extension.as_deref() {
            Some(extension) if !extension.is_empty() => format!("{stem} {suffix}.{extension}"),
            _ => format!("{stem} {suffix}"),
        };
        let candidate = directory.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    unreachable!("unbounded path search always returns")
}

fn cleanup_expired_forgotten_notes(notes_dir: &Path) -> Result<(), String> {
    let now = current_time_millis()?;
    let mut persisted_state = read_state(notes_dir)?;
    let original_len = persisted_state.forgotten_notes.len();
    let mut kept_notes = Vec::with_capacity(original_len);

    for forgotten_note in persisted_state.forgotten_notes.drain(..) {
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        if forgotten_note.purge_at_millis <= now {
            if forgotten_path.exists() {
                fs::remove_file(&forgotten_path).map_err(|err| err.to_string())?;
            }
            continue;
        }
        kept_notes.push(forgotten_note);
    }

    if kept_notes.len() != original_len {
        persisted_state.forgotten_notes = kept_notes;
        write_state(notes_dir, &persisted_state)?;
    }

    Ok(())
}

fn read_image_asset_data_url_from_assets_dir(
    assets_dir: &Path,
    file_name: &str,
) -> Result<String, String> {
    let asset_path = resolve_asset_image_path(assets_dir, file_name)?;
    let asset_bytes = fs::read(&asset_path).map_err(|err| err.to_string())?;
    let mime_type = mime_type_from_asset_name(file_name);
    Ok(format!(
        "data:{mime_type};base64,{}",
        BASE64_STANDARD.encode(asset_bytes)
    ))
}

fn resolve_asset_image_path(assets_dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err("Image asset name is empty".to_string());
    }

    let file_path = Path::new(trimmed);
    if file_path.components().count() != 1 || file_path.file_name().and_then(OsStr::to_str) != Some(trimmed) {
        return Err("Image asset path must be a file name".to_string());
    }

    let asset_path = assets_dir.join(trimmed);
    if !asset_path.is_file() {
        return Err("Image asset was not found".to_string());
    }

    Ok(asset_path)
}

fn mime_type_from_asset_name(file_name: &str) -> &'static str {
    match asset_extension_from_name(file_name)
        .unwrap_or("png")
        .to_ascii_lowercase()
        .as_str()
    {
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

fn resolve_pasted_image_path(
    assets_dir: &Path,
    original_name: Option<&str>,
    mime_type: Option<&str>,
) -> PathBuf {
    let sanitized_stem = original_name
        .map(sanitize_asset_file_stem)
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| DEFAULT_PASTED_IMAGE_NAME.to_string());
    let extension = original_name
        .and_then(asset_extension_from_name)
        .or_else(|| mime_type.and_then(asset_extension_from_mime_type))
        .unwrap_or("png");

    resolve_unique_path(assets_dir, &format!("{sanitized_stem}.{extension}"))
}

fn sanitize_asset_file_stem(name: &str) -> String {
    let candidate = Path::new(name)
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or(name)
        .trim();
    let mut sanitized = String::new();
    let mut previous_was_space = false;

    for ch in candidate.chars() {
        let mapped = match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            _ => ch,
        };

        if mapped.is_control() {
            continue;
        }

        if mapped.is_whitespace() {
            if previous_was_space {
                continue;
            }

            sanitized.push(' ');
            previous_was_space = true;
            continue;
        }

        sanitized.push(mapped);
        previous_was_space = false;
    }

    sanitized.trim().trim_matches('.').to_string()
}

fn asset_extension_from_name(name: &str) -> Option<&str> {
    Path::new(name)
        .extension()
        .and_then(OsStr::to_str)
        .map(str::trim)
        .filter(|extension| !extension.is_empty())
        .map(|extension| {
            if extension.eq_ignore_ascii_case("jpeg") {
                "jpg"
            } else {
                extension
            }
        })
}

fn asset_extension_from_mime_type(mime_type: &str) -> Option<&'static str> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/avif" => Some("avif"),
        "image/bmp" => Some("bmp"),
        "image/gif" => Some("gif"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/svg+xml" => Some("svg"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

fn resolve_unique_path(directory: &Path, preferred_name: &str) -> PathBuf {
    let preferred_path = directory.join(preferred_name);
    if !preferred_path.exists() {
        return preferred_path;
    }

    let preferred_path = Path::new(preferred_name);
    let file_stem = preferred_path
        .file_stem()
        .and_then(OsStr::to_str)
        .filter(|stem| !stem.trim().is_empty())
        .unwrap_or(DEFAULT_PASTED_IMAGE_NAME);
    let extension = preferred_path
        .extension()
        .and_then(OsStr::to_str)
        .filter(|extension| !extension.trim().is_empty());

    let mut suffix = 1usize;
    loop {
        let candidate_name = match extension {
            Some(extension) => format!("{file_stem} {suffix}.{extension}"),
            None => format!("{file_stem} {suffix}"),
        };
        let candidate_path = directory.join(candidate_name);
        if !candidate_path.exists() {
            return candidate_path;
        }

        suffix += 1;
    }
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

fn collect_task_timestamp_candidates(
    note_path: &Path,
    note: &IndexedNote,
) -> Vec<TaskTimestampCandidate> {
    note.tasks
        .iter()
        .map(|task| TaskTimestampCandidate {
            key: task_key(note_path, task),
            text_lower: normalize_search_text(&task.text),
            section_label: task.section_label.clone(),
            completed: task.completed,
            depth: task.depth,
            line_number: task.line_number,
            fallback_millis: note.modified_millis,
        })
        .collect()
}

fn select_matching_previous_task<F>(
    previous_tasks: &[TaskTimestampCandidate],
    used_indexes: &HashSet<usize>,
    next_task: &TaskTimestampCandidate,
    predicate: F,
) -> Option<usize>
where
    F: Fn(&TaskTimestampCandidate, &TaskTimestampCandidate) -> bool,
{
    previous_tasks
        .iter()
        .enumerate()
        .filter(|entry| {
            let (index, candidate) = entry;
            !used_indexes.contains(index) && predicate(candidate, next_task)
        })
        .min_by_key(|entry| {
            let (_, candidate) = entry;
            candidate.line_number.abs_diff(next_task.line_number)
        })
        .map(|(index, _)| index)
}

fn find_matching_previous_task_index(
    previous_tasks: &[TaskTimestampCandidate],
    used_indexes: &HashSet<usize>,
    next_task: &TaskTimestampCandidate,
) -> Option<usize> {
    select_matching_previous_task(previous_tasks, used_indexes, next_task, |previous, next| {
        previous.text_lower == next.text_lower
            && previous.section_label == next.section_label
            && previous.depth == next.depth
    })
    .or_else(|| {
        select_matching_previous_task(previous_tasks, used_indexes, next_task, |previous, next| {
            previous.text_lower == next.text_lower && previous.section_label == next.section_label
        })
    })
    .or_else(|| {
        select_matching_previous_task(previous_tasks, used_indexes, next_task, |previous, next| {
            previous.text_lower == next.text_lower
        })
    })
}

fn reconcile_note_task_timestamps(
    state: &mut PersistedState,
    previous_path: Option<&Path>,
    previous_note: Option<&IndexedNote>,
    next_path: Option<&Path>,
    next_note: Option<&IndexedNote>,
    timestamp_millis: u64,
) {
    let previous_tasks = previous_path
        .zip(previous_note)
        .map(|(path, note)| collect_task_timestamp_candidates(path, note))
        .unwrap_or_default();
    let next_tasks = next_path
        .zip(next_note)
        .map(|(path, note)| collect_task_timestamp_candidates(path, note))
        .unwrap_or_default();
    let mut used_previous_indexes = HashSet::new();

    for next_task in &next_tasks {
        let timestamps = if let Some(previous_index) =
            find_matching_previous_task_index(&previous_tasks, &used_previous_indexes, next_task)
        {
            used_previous_indexes.insert(previous_index);
            let previous_task = &previous_tasks[previous_index];
            let mut timestamps = state.task_timestamps.remove(&previous_task.key).unwrap_or(
                PersistedTaskTimestamps {
                    created_at_millis: previous_task.fallback_millis,
                    updated_at_millis: previous_task.fallback_millis,
                },
            );
            if previous_task.completed != next_task.completed {
                timestamps.updated_at_millis = timestamp_millis;
            }
            timestamps
        } else {
            PersistedTaskTimestamps {
                created_at_millis: timestamp_millis,
                updated_at_millis: timestamp_millis,
            }
        };

        state
            .task_timestamps
            .insert(next_task.key.clone(), timestamps);
    }

    for (index, previous_task) in previous_tasks.into_iter().enumerate() {
        if !used_previous_indexes.contains(&index) {
            state.task_timestamps.remove(&previous_task.key);
        }
    }
}

fn sync_task_timestamps_from_index(state: &mut PersistedState, index: &NotesIndex) -> bool {
    let mut changed = false;
    let mut active_task_keys = HashSet::new();

    for (path, note) in &index.entries {
        for task in &note.tasks {
            let task_key = task_key(path, task);
            active_task_keys.insert(task_key.clone());
            state.task_timestamps.entry(task_key).or_insert_with(|| {
                changed = true;
                PersistedTaskTimestamps {
                    created_at_millis: note.modified_millis,
                    updated_at_millis: note.modified_millis,
                }
            });
        }
    }

    let existing_count = state.task_timestamps.len();
    state
        .task_timestamps
        .retain(|task_key, _| active_task_keys.contains(task_key));
    changed || existing_count != state.task_timestamps.len()
}

fn find_task_key_for_line(
    note_path: &Path,
    note: &IndexedNote,
    line_number: usize,
    task_text: &str,
) -> Option<String> {
    let normalized_task_text = normalize_search_text(task_text);

    note.tasks
        .iter()
        .find(|task| {
            task.line_number == line_number
                && normalize_search_text(&task.text) == normalized_task_text
        })
        .or_else(|| {
            note.tasks
                .iter()
                .filter(|task| normalize_search_text(&task.text) == normalized_task_text)
                .min_by_key(|task| task.line_number.abs_diff(line_number))
        })
        .map(|task| task_key(note_path, task))
}

#[cfg(test)]
mod tests {
    use super::{
        asset_extension_from_mime_type, collect_recent_note_results, find_task_key_for_line,
        load_note_session_from_notes_dir, merge_hybrid_candidates, mime_type_from_asset_name,
        open_note_from_notes_dir, parse_wikilink_target, read_image_asset_data_url_from_assets_dir,
        read_note_session_from_path, reconcile_note_task_timestamps, resolve_asset_image_path,
        resolve_note_link_target, resolve_pasted_image_path, sanitize_asset_file_stem, NoteSession,
        ParsedWikilinkTarget, RecentTaskItem, ResolvedNoteLink, TaskListItem,
    };
    use crate::{
        index::{build_indexed_note, task_key, NotesIndex},
        search::{NoteSearchResult, ScoredSearchResult},
        state::{read_state, write_state, PersistedState, PersistedTaskTimestamps},
        test_support::TestDir,
    };
    use serde_json::json;
    use std::{collections::HashMap, fs, path::PathBuf};

    #[test]
    fn load_note_session_from_notes_dir_clears_stale_last_opened_path() {
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

        let data_url =
            read_image_asset_data_url_from_assets_dir(&assets_dir, "diagram.png").expect("data url");

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
