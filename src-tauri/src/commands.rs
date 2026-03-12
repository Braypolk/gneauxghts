use crate::{
    index::{
        build_current_override, normalize_search_text, refresh_notes_index, task_key,
        toggle_task_in_markdown, AppState,
    },
    search::{build_recent_result, search_note, NoteSearchResult, MAX_SEARCH_RESULTS},
    state::{
        is_valid_note_path, notes_root, persist_note, prune_recent_paths, push_unique, read_state,
        touch_recent_path, validate_current_path, write_state,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
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
    let saved_path = persist_note(&notes_dir, &markdown, current_path.as_deref())?;

    let mut persisted_state = read_state(&notes_dir)?;
    persisted_state.last_opened_path = saved_path.clone();
    if let Some(saved_path) = saved_path.as_ref() {
        touch_recent_path(&mut persisted_state, Path::new(saved_path));
    }
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
    let remembered_path = if !markdown.trim().is_empty() || current_path.is_some() {
        persist_note(&notes_dir, &markdown, current_path.as_deref())?
    } else {
        None
    };

    let mut persisted_state = read_state(&notes_dir)?;
    persisted_state.last_opened_path = None;
    if let Some(remembered_path) = remembered_path.as_ref() {
        touch_recent_path(&mut persisted_state, Path::new(remembered_path));
    }
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
        if note_path.exists() {
            fs::remove_file(note_path).map_err(|err| err.to_string())?;
        }

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
        .take(limit.min(3))
        .collect();

    Ok(recent_results)
}

#[tauri::command]
pub(crate) fn list_tasks(
    state: State<'_, AppState>,
    filter: TaskFilter,
) -> Result<Vec<TaskListItem>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    let persisted_state = read_state(&notes_dir)?;
    let hidden_task_keys = persisted_state
        .hidden_task_keys
        .into_iter()
        .collect::<HashSet<_>>();
    let hidden_note_paths = persisted_state
        .hidden_note_paths
        .into_iter()
        .collect::<HashSet<_>>();
    let collapsed_note_paths = persisted_state
        .collapsed_note_paths
        .into_iter()
        .collect::<HashSet<_>>();
    let note_order = persisted_state.note_order;

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh(&notes_dir)?;

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

            tasks.push(TaskListItem {
                task_key: task_key(path, task),
                note_path: path.to_string_lossy().into_owned(),
                file_name: note.file_name.clone(),
                note_title: note.title.clone(),
                section_label: task.section_label.clone(),
                text: task.text.clone(),
                completed: task.completed,
                hidden: hidden_task_keys.contains(&task_key(path, task)),
                note_hidden: hidden_note_paths.contains(&path.to_string_lossy().into_owned()),
                note_collapsed: collapsed_note_paths.contains(&path.to_string_lossy().into_owned()),
                depth: task.depth,
                line_number: task.line_number,
            });
        }
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
    fs::write(&note_path, updated_markdown).map_err(|err| err.to_string())?;
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
