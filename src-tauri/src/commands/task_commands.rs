use super::{
    current_time_millis, prepare_notes_dir, upsert_notes_index_entry, RecentTaskItem, TaskFilter,
    TaskListItem, INTERACTIVE_INDEX_REFRESH_MAX_AGE,
};
use crate::{
    index::{
        build_indexed_note, delete_task_in_markdown, normalize_search_text, task_key,
        toggle_task_in_markdown, AppState, IndexedNote, NotesIndex,
    },
    state::{
        push_unique, read_state, resolve_note_path_by_id, validate_current_path, write_state,
        PersistedState, PersistedTaskTimestamps,
    },
    sync,
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
    sync::{LazyLock, Mutex},
};
use tauri::State;

static TASK_TIMESTAMP_SYNC_REVISION: LazyLock<Mutex<u64>> = LazyLock::new(|| Mutex::new(u64::MAX));

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

struct SortableRecentTaskItem {
    item: RecentTaskItem,
    note_title_lower: String,
    text_lower: String,
}

impl SortableRecentTaskItem {
    fn new(item: RecentTaskItem) -> Self {
        Self {
            note_title_lower: item.note_title.to_lowercase(),
            text_lower: item.text.to_lowercase(),
            item,
        }
    }
}

struct SortableTaskListItem {
    item: TaskListItem,
    note_title_lower: String,
    text_lower: String,
}

impl SortableTaskListItem {
    fn new(item: TaskListItem) -> Self {
        Self {
            note_title_lower: item.note_title.to_lowercase(),
            text_lower: item.text.to_lowercase(),
            item,
        }
    }
}

pub(super) fn list_recent_tasks(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<RecentTaskItem>, String> {
    let notes_dir = prepare_notes_dir(false)?;

    let mut persisted_state = read_state(&notes_dir)?;
    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh_if_stale(&notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?;
    let did_sync_task_timestamps = should_sync_task_timestamps(&index)?
        && sync_task_timestamps_from_index(&mut persisted_state, &index);
    let hidden_task_keys = persisted_state
        .hidden_task_keys
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let hidden_note_ids = persisted_state
        .hidden_note_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();

    let mut tasks = Vec::new();

    for (path, note) in &index.entries {
        let raw_path = path.to_string_lossy().into_owned();
        if hidden_note_ids.contains(note.note_id.as_str()) {
            continue;
        }

        for task in &note.tasks {
            if task.completed {
                continue;
            }

            let task_key = task_key(&note.note_id, task);
            if hidden_task_keys.contains(task_key.as_str()) {
                continue;
            }

            let updated_at_millis = persisted_state
                .task_timestamps
                .get(&task_key)
                .map(|timestamps| timestamps.updated_at_millis)
                .unwrap_or(note.modified_millis);

            tasks.push(SortableRecentTaskItem::new(RecentTaskItem {
                note_id: note.note_id.clone(),
                task_key,
                note_path: raw_path.clone(),
                note_title: note.title.clone(),
                text: task.text.clone(),
                line_number: task.line_number,
                updated_at_millis,
            }));
        }
    }

    drop(index);
    if did_sync_task_timestamps {
        write_state(&notes_dir, &persisted_state)?;
    }

    tasks.sort_by(|left, right| {
        right
            .item
            .updated_at_millis
            .cmp(&left.item.updated_at_millis)
            .then_with(|| left.note_title_lower.cmp(&right.note_title_lower))
            .then_with(|| left.item.line_number.cmp(&right.item.line_number))
            .then_with(|| left.text_lower.cmp(&right.text_lower))
    });
    tasks.truncate(limit);

    Ok(tasks.into_iter().map(|task| task.item).collect())
}

pub(super) fn list_tasks(
    state: State<'_, AppState>,
    filter: TaskFilter,
) -> Result<Vec<TaskListItem>, String> {
    let notes_dir = prepare_notes_dir(false)?;
    let mut persisted_state = read_state(&notes_dir)?;

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh_if_stale(&notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?;
    let did_sync_task_timestamps = should_sync_task_timestamps(&index)?
        && sync_task_timestamps_from_index(&mut persisted_state, &index);
    let hidden_task_keys = persisted_state
        .hidden_task_keys
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let hidden_note_ids = persisted_state
        .hidden_note_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let collapsed_note_ids = persisted_state
        .collapsed_note_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();

    let mut tasks = Vec::new();

    for (path, note) in &index.entries {
        let raw_path = path.to_string_lossy().into_owned();
        let note_hidden = hidden_note_ids.contains(note.note_id.as_str());
        let note_collapsed = collapsed_note_ids.contains(note.note_id.as_str());
        for task in &note.tasks {
            let matches_filter = match filter {
                TaskFilter::Open => !task.completed,
                TaskFilter::Completed => task.completed,
                TaskFilter::All => true,
            };

            if !matches_filter {
                continue;
            }

            let task_key = task_key(&note.note_id, task);
            let timestamps = persisted_state
                .task_timestamps
                .get(&task_key)
                .cloned()
                .unwrap_or(PersistedTaskTimestamps {
                    created_at_millis: note.modified_millis,
                    updated_at_millis: note.modified_millis,
                });

            tasks.push(SortableTaskListItem::new(TaskListItem {
                note_id: note.note_id.clone(),
                task_key: task_key.clone(),
                note_path: raw_path.clone(),
                file_name: note.file_name.clone(),
                note_title: note.title.clone(),
                section_label: task.section_label.clone(),
                text: task.text.clone(),
                completed: task.completed,
                hidden: hidden_task_keys.contains(task_key.as_str()),
                note_hidden,
                note_collapsed,
                depth: task.depth,
                line_number: task.line_number,
                created_at_millis: timestamps.created_at_millis,
                updated_at_millis: timestamps.updated_at_millis,
            }));
        }
    }

    drop(index);
    if did_sync_task_timestamps {
        write_state(&notes_dir, &persisted_state)?;
    }

    let note_order_index = persisted_state
        .note_order_note_ids
        .iter()
        .enumerate()
        .map(|(index, note_id)| (note_id.as_str(), index))
        .collect::<HashMap<_, _>>();

    tasks.sort_by(|left, right| {
        let left_rank = note_order_index
            .get(left.item.note_id.as_str())
            .copied()
            .unwrap_or(usize::MAX);
        let right_rank = note_order_index
            .get(right.item.note_id.as_str())
            .copied()
            .unwrap_or(usize::MAX);
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.note_title_lower.cmp(&right.note_title_lower))
            .then_with(|| left.item.line_number.cmp(&right.item.line_number))
            .then_with(|| left.text_lower.cmp(&right.text_lower))
    });

    Ok(tasks.into_iter().map(|task| task.item).collect())
}

pub(super) fn set_task_hidden(task_key: String, hidden: bool) -> Result<(), String> {
    let notes_dir = prepare_notes_dir(false)?;

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

pub(super) fn set_note_hidden(note_id: String, hidden: bool) -> Result<(), String> {
    let notes_dir = prepare_notes_dir(false)?;

    let mut state = read_state(&notes_dir)?;
    if hidden {
        push_unique(&mut state.hidden_note_ids, note_id);
    } else {
        state
            .hidden_note_ids
            .retain(|existing_note_id| existing_note_id != &note_id);
    }
    write_state(&notes_dir, &state)
}

pub(super) fn set_note_collapsed(note_id: String, collapsed: bool) -> Result<(), String> {
    let notes_dir = prepare_notes_dir(false)?;

    let mut state = read_state(&notes_dir)?;
    if collapsed {
        push_unique(&mut state.collapsed_note_ids, note_id);
    } else {
        state
            .collapsed_note_ids
            .retain(|existing_note_id| existing_note_id != &note_id);
    }
    write_state(&notes_dir, &state)
}

pub(super) fn set_note_order(note_ids: Vec<String>) -> Result<(), String> {
    let notes_dir = prepare_notes_dir(false)?;

    let mut normalized_note_ids = Vec::new();
    let mut seen = HashSet::new();

    for note_id in note_ids {
        let Some(_validated_path) = resolve_note_path_by_id(&notes_dir, &note_id)? else {
            continue;
        };

        if seen.insert(note_id.clone()) {
            normalized_note_ids.push(note_id);
        }
    }

    let mut state = read_state(&notes_dir)?;
    state.note_order_note_ids = normalized_note_ids;
    write_state(&notes_dir, &state)
}

pub(super) fn toggle_task(
    state: State<'_, AppState>,
    note_path: String,
    line_number: usize,
    task_text: String,
) -> Result<(), String> {
    let notes_dir = prepare_notes_dir(false)?;

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

pub(super) fn delete_task(
    state: State<'_, AppState>,
    note_path: String,
    line_number: usize,
    task_text: String,
    task_key: String,
) -> Result<(), String> {
    let notes_dir = prepare_notes_dir(false)?;

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
    persisted_state
        .hidden_task_keys
        .retain(|key| key != &task_key);
    persisted_state.task_timestamps.remove(&task_key);
    write_state(&notes_dir, &persisted_state)?;

    state
        .semantic
        .queue_note_update(&note_path, updated_markdown, timestamp_millis)?;
    Ok(())
}

pub(super) fn reconcile_note_task_timestamps(
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

pub(super) fn sync_task_timestamps_from_index(
    state: &mut PersistedState,
    index: &NotesIndex,
) -> bool {
    let mut changed = false;
    let mut active_task_keys = HashSet::new();

    for note in index.entries.values() {
        for task in &note.tasks {
            let task_key = task_key(&note.note_id, task);
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

fn should_sync_task_timestamps(index: &NotesIndex) -> Result<bool, String> {
    let revision = index.revision();
    let mut last_synced_revision = TASK_TIMESTAMP_SYNC_REVISION
        .lock()
        .map_err(|_| "Task timestamp revision lock poisoned".to_string())?;
    if *last_synced_revision == revision {
        return Ok(false);
    }

    *last_synced_revision = revision;
    Ok(true)
}

pub(super) fn find_task_key_for_line(
    _note_path: &Path,
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
        .map(|task| task_key(&note.note_id, task))
}

fn collect_task_timestamp_candidates(
    _note_path: &Path,
    note: &IndexedNote,
) -> Vec<TaskTimestampCandidate> {
    note.tasks
        .iter()
        .map(|task| TaskTimestampCandidate {
            key: task_key(&note.note_id, task),
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
        .filter(|(index, candidate)| {
            !used_indexes.contains(index) && predicate(candidate, next_task)
        })
        .min_by_key(|(_, candidate)| candidate.line_number.abs_diff(next_task.line_number))
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
