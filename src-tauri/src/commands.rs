use crate::{
    index::{
        build_current_override, normalize_search_text, refresh_notes_index, task_key,
        toggle_task_in_markdown, AppState, IndexedNote, NotesIndex,
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
    time::{SystemTime, UNIX_EPOCH},
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
    refresh_notes_index(&state, &notes_dir)
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
    refresh_notes_index(&state, &notes_dir)
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
    let current_override = build_current_override(current_path.as_deref(), &current_markdown);

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh(&notes_dir)?;

    let mut candidates = Vec::new();

    match mode {
        SearchMode::Current => {
            if let Some(current_note) = current_override.as_ref() {
                candidates.extend(search_note(
                    current_path.as_deref(),
                    current_note,
                    &normalized_query,
                    &query_terms,
                ));
            }
        }
        SearchMode::All => {
            if let Some(current_note) = current_override.as_ref() {
                candidates.extend(search_note(
                    current_path.as_deref(),
                    current_note,
                    &normalized_query,
                    &query_terms,
                ));
            }

            for (path, note) in &index.entries {
                if current_path.as_deref() == Some(path.as_path()) {
                    continue;
                }

                candidates.extend(search_note(
                    Some(path.as_path()),
                    note,
                    &normalized_query,
                    &query_terms,
                ));
            }
        }
    }

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
