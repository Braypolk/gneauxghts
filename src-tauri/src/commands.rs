use crate::{
    index::{
        build_current_override, normalize_search_text, refresh_notes_index, task_key,
        toggle_task_in_markdown, AppState, IndexedNote, NotesIndex,
    },
    semantic::{
        debug::SemanticDebugSnapshot, MapGraph, SemanticChunkMatch, SemanticSettings,
        SemanticStatus,
    },
    search::{build_recent_result, search_note, NoteSearchResult, MAX_SEARCH_RESULTS},
    state::{
        is_valid_note_path, notes_root, persist_note, prune_recent_paths, push_unique, read_state,
        touch_recent_path, validate_current_path, write_state, PersistedState,
        PersistedTaskTimestamps,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteSession {
    markdown: String,
    path: Option<String>,
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

    let mut state = read_state(&notes_dir)?;
    let Some(last_opened_path) = state.last_opened_path.clone() else {
        return Ok(NoteSession {
            markdown: String::new(),
            path: None,
        });
    };

    let note_path = PathBuf::from(last_opened_path);
    if !is_valid_note_path(&note_path, &notes_dir) {
        state.last_opened_path = None;
        state
            .recent_paths
            .retain(|path| PathBuf::from(path) != note_path);
        write_state(&notes_dir, &state)?;
        return Ok(NoteSession {
            markdown: String::new(),
            path: None,
        });
    }

    touch_recent_path(&mut state, &note_path);
    write_state(&notes_dir, &state)?;
    read_note_session_from_path(&note_path)
}

#[tauri::command]
pub(crate) fn open_note(path: String) -> Result<NoteSession, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    let note_path = validate_current_path(Some(path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;

    let mut state = read_state(&notes_dir)?;
    state.last_opened_path = Some(note_path.to_string_lossy().into_owned());
    touch_recent_path(&mut state, &note_path);
    write_state(&notes_dir, &state)?;

    read_note_session_from_path(&note_path)
}

#[tauri::command]
pub(crate) fn save_note(
    state: State<'_, AppState>,
    markdown: String,
    current_path: Option<String>,
) -> Result<NoteSession, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let previous_note = current_path
        .as_deref()
        .map(read_indexed_note_from_path)
        .transpose()?
        .flatten();
    let saved_path = persist_note(&notes_dir, &markdown, current_path.as_deref())?;
    let timestamp_millis = current_time_millis()?;
    let next_note = saved_path
        .as_deref()
        .map(|saved_path| build_indexed_note(Path::new(saved_path), &markdown, timestamp_millis))
        .transpose()?;

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
    refresh_notes_index(&state, &notes_dir)?;
    if let Some(saved_path) = saved_path.as_deref() {
        state
            .semantic
            .queue_note_update(Path::new(saved_path), markdown.clone(), timestamp_millis)?;
    }
    if let Some(previous_path) = current_path.as_deref() {
        let previous_raw_path = previous_path.to_string_lossy().into_owned();
        if saved_path.as_deref() != Some(previous_raw_path.as_str()) {
            state.semantic.queue_delete_note(previous_path)?;
        }
    }

    Ok(NoteSession {
        markdown,
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
    let next_note = remembered_path
        .as_deref()
        .map(|remembered_path| {
            build_indexed_note(Path::new(remembered_path), &markdown, timestamp_millis)
        })
        .transpose()?;

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
    refresh_notes_index(&state, &notes_dir)?;
    if let Some(remembered_path) = remembered_path.as_deref() {
        state.semantic.queue_note_update(
            Path::new(remembered_path),
            markdown,
            timestamp_millis,
        )?;
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
) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let mut persisted_state = read_state(&notes_dir)?;

    if let Some(note_path) = current_path.as_ref() {
        let previous_note = read_indexed_note_from_path(note_path)?;
        if note_path.exists() {
            fs::remove_file(note_path).map_err(|err| err.to_string())?;
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
        state.semantic.queue_delete_note(note_path)?;
    }

    write_state(&notes_dir, &persisted_state)?;
    refresh_notes_index(&state, &notes_dir)
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

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let current_override = build_current_override(current_path.as_deref(), &current_markdown);
    let mut persisted_state = read_state(&notes_dir)?;
    prune_recent_paths(&mut persisted_state, &notes_dir);
    write_state(&notes_dir, &persisted_state)?;

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh(&notes_dir)?;

    let recent_results = persisted_state
        .recent_paths
        .iter()
        .filter_map(|raw_path| {
            let path = PathBuf::from(raw_path);
            let note = if current_path.as_deref() == Some(path.as_path()) {
                current_override
                    .as_ref()
                    .or_else(|| index.entries.get(&path))
            } else {
                index.entries.get(&path)
            }?;

            Some(build_recent_result(Some(path.as_path()), note))
        })
        .take(limit)
        .collect();

    Ok(recent_results)
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
    index.refresh(&notes_dir)?;
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
            .then_with(|| left.note_title.to_lowercase().cmp(&right.note_title.to_lowercase()))
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
    index.refresh(&notes_dir)?;
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
    let updated_note = build_indexed_note(&note_path, &updated_markdown, timestamp_millis)?;
    let Some(toggled_task_key) =
        find_task_key_for_line(&note_path, &updated_note, line_number, &task_text)
    else {
        refresh_notes_index(&state, &notes_dir)?;
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
    refresh_notes_index(&state, &notes_dir)?;
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
    let mut candidates =
        collect_lexical_candidates(&state, &notes_dir, mode, current_path.as_deref(), &current_markdown, &normalized_query, &query_terms)?;

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
        let structural_boost = structural_boost(&result, &normalized_query, current_path.as_deref());
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
        let structural_boost = structural_boost_from_semantic(
            &semantic_match,
            &normalized_query,
            current_path.as_deref(),
        );

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
            metrics.search_duration_max_millis =
                metrics.search_duration_max_millis.max(elapsed);
        },
    );
    Ok(ranked
        .into_iter()
        .map(|mut candidate| {
            candidate.result.lexical_score = Some(candidate.lexical_score);
            candidate.result.semantic_score = Some(candidate.semantic_score);
            candidate.result
        })
        .collect())
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
pub(crate) fn get_semantic_status(
    state: State<'_, AppState>,
) -> Result<SemanticStatus, String> {
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
    let graph = tauri::async_runtime::spawn_blocking(move || semantic.map_graph(limit.max(24), min_score.max(0.0)))
        .await
        .map_err(|err| err.to_string())?;
    let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    match &graph {
        Ok(graph_data) => state.semantic.debug_state().record_timing(
            "map",
            "map_completed",
            Some(format!("nodes={} edges={}", graph_data.nodes.len(), graph_data.edges.len())),
            elapsed,
            |metrics| {
                metrics.map_request_count += 1;
                metrics.map_duration_total_millis += elapsed;
                metrics.map_duration_max_millis =
                    metrics.map_duration_max_millis.max(elapsed);
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
                metrics.map_duration_max_millis =
                    metrics.map_duration_max_millis.max(elapsed);
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
    index.refresh(notes_dir)?;

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
        markdown,
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

fn build_indexed_note(
    path: &Path,
    markdown: &str,
    modified_millis: u64,
) -> Result<IndexedNote, String> {
    let mut note = build_current_override(Some(path), markdown)
        .ok_or_else(|| "Unable to index note".to_string())?;
    note.modified_millis = modified_millis;
    Ok(note)
}

fn read_indexed_note_from_path(path: &Path) -> Result<Option<IndexedNote>, String> {
    if !path.is_file() {
        return Ok(None);
    }

    let markdown = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let modified_millis = read_modified_millis(path)?;
    Ok(Some(build_indexed_note(path, &markdown, modified_millis)?))
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
