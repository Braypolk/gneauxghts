use super::index_bridge::upsert_notes_index_entry;
use super::{
    current_time_millis, prepare_notes_dir, RecentTaskItem, TaskFilter, TaskListItem,
    TaskMutationDelta, INTERACTIVE_INDEX_REFRESH_MAX_AGE,
};
use crate::{
    index::{
        build_indexed_note, delete_task_in_markdown, normalize_search_text, task_key,
        toggle_task_in_markdown, AppState, IndexedNote, NotesIndex,
    },
    state::{
        db_remove_task_timestamp, db_set_hidden_task_key, db_set_note_collapsed,
        db_set_note_hidden, db_set_note_order, db_upsert_task_timestamp, read_state,
        resolve_note_path_by_id, validate_current_path, write_state, PersistedState,
        PersistedTaskTimestamps,
    },
};
use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashMap, HashSet},
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

impl PartialEq for SortableRecentTaskItem {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == std::cmp::Ordering::Equal
    }
}

impl Eq for SortableRecentTaskItem {}

impl PartialOrd for SortableRecentTaskItem {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SortableRecentTaskItem {
    /// Ordering matches the sort comparator: a "greater" task is one that
    /// would appear earlier in the final sorted output (more recent, then
    /// title/line/text tiebreakers reversed so that the comparator agrees
    /// with the original `sort_by` semantics).
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.item
            .updated_at_millis
            .cmp(&other.item.updated_at_millis)
            .then_with(|| other.note_title_lower.cmp(&self.note_title_lower))
            .then_with(|| other.item.line_number.cmp(&self.item.line_number))
            .then_with(|| other.text_lower.cmp(&self.text_lower))
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
    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "list_recent_tasks",
    )?;
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    let did_sync_task_timestamps = should_sync_task_timestamps(&index)?
        && sync_task_timestamps_from_index(&mut persisted_state, &index);

    let tasks = select_recent_tasks(&persisted_state, &index, limit);

    drop(index);
    if did_sync_task_timestamps {
        write_state(&notes_dir, &persisted_state)?;
    }

    Ok(tasks)
}

/// Pure top-N selection over the in-memory notes index. The caller is
/// responsible for `read_state`/`ensure_interactive_index`/locking so that
/// the result can be combined with other reads (e.g. the focus loader)
/// without redundant work.
pub(super) fn select_recent_tasks(
    persisted_state: &PersistedState,
    index: &NotesIndex,
    limit: usize,
) -> Vec<RecentTaskItem> {
    if limit == 0 {
        return Vec::new();
    }

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

    // Bounded top-N selection: keep the heap at most `limit` large so we
    // avoid materializing every open task in the vault on each focus.
    let mut heap: BinaryHeap<Reverse<SortableRecentTaskItem>> = BinaryHeap::with_capacity(limit);

    for (path, note) in &index.entries {
        if hidden_note_ids.contains(note.note_id.as_str()) {
            continue;
        }

        let mut raw_path: Option<String> = None;

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

            // Cheap pre-filter: once the heap is full, only allocate the
            // RecentTaskItem if this candidate could possibly displace the
            // current min (i.e. it is at least as recent as the worst kept).
            if heap.len() >= limit {
                let worst_updated_at = heap.peek().map(|entry| entry.0.item.updated_at_millis);
                if worst_updated_at.is_some_and(|worst| updated_at_millis < worst) {
                    continue;
                }
            }

            let raw_path_str = raw_path
                .get_or_insert_with(|| path.to_string_lossy().into_owned())
                .clone();

            let candidate = SortableRecentTaskItem::new(RecentTaskItem {
                note_id: note.note_id.clone(),
                task_key,
                note_path: raw_path_str,
                note_title: note.title.clone(),
                text: task.text.clone(),
                line_number: task.line_number,
                updated_at_millis,
            });

            if heap.len() < limit {
                heap.push(Reverse(candidate));
            } else if let Some(worst) = heap.peek() {
                if candidate > worst.0 {
                    heap.pop();
                    heap.push(Reverse(candidate));
                }
            }
        }
    }

    let mut sorted = heap.into_iter().map(|entry| entry.0).collect::<Vec<_>>();
    // Heap iteration is unordered; produce final descending order using the
    // heap ordering (which already matches the desired comparator).
    sorted.sort_by(|left, right| right.cmp(left));

    sorted.into_iter().map(|task| task.item).collect()
}

pub(super) fn list_tasks(
    state: State<'_, AppState>,
    filter: TaskFilter,
) -> Result<Vec<TaskListItem>, String> {
    let notes_dir = prepare_notes_dir(false)?;
    let mut persisted_state = read_state(&notes_dir)?;

    state.ensure_interactive_index(&notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE, "list_tasks")?;
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
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
                editor_line_number: task.editor_line_number,
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
    // Row-scoped write: avoids the previous full DELETE+INSERT rewrite of
    // every app-state table. Empty / whitespace-only keys are still ignored
    // for parity with the old `dedupe_hidden_task_keys` pruning behaviour.
    let _ = prepare_notes_dir(false)?;
    if task_key.is_empty() {
        return Ok(());
    }
    db_set_hidden_task_key(&task_key, hidden)
}

pub(super) fn set_note_hidden(note_id: String, hidden: bool) -> Result<(), String> {
    let _ = prepare_notes_dir(false)?;
    db_set_note_hidden(&note_id, hidden)
}

pub(super) fn set_note_collapsed(note_id: String, collapsed: bool) -> Result<(), String> {
    let _ = prepare_notes_dir(false)?;
    db_set_note_collapsed(&note_id, collapsed)
}

pub(super) fn set_note_order(
    state: State<'_, AppState>,
    note_ids: Vec<String>,
) -> Result<(), String> {
    let notes_dir = prepare_notes_dir(false)?;

    let mut normalized_note_ids = Vec::new();
    let mut seen = HashSet::new();

    for note_id in note_ids {
        if !seen.contains(&note_id) {
            let resolved = {
                let index_lookup = state
                    .notes_index
                    .lock()
                    .ok()
                    .and_then(|index| index.path_for_note_id(&note_id).cloned());
                match index_lookup {
                    Some(path) => Some(path),
                    None => resolve_note_path_by_id(&notes_dir, &note_id)?,
                }
            };
            if resolved.is_none() {
                continue;
            }
            if seen.insert(note_id.clone()) {
                normalized_note_ids.push(note_id);
            }
        }
    }

    db_set_note_order(&normalized_note_ids)
}

pub(crate) fn toggle_task(
    state: State<'_, AppState>,
    note_path: String,
    line_number: usize,
    task_text: String,
) -> Result<TaskMutationDelta, String> {
    let notes_dir = prepare_notes_dir(false)?;

    let note_path = validate_current_path(Some(note_path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;
    let markdown = fs::read_to_string(&note_path).map_err(|err| err.to_string())?;
    let updated_markdown = toggle_task_in_markdown(&markdown, line_number, &task_text)?;
    crate::vault_watcher::record_self_save(&note_path);
    fs::write(&note_path, &updated_markdown).map_err(|err| err.to_string())?;
    let timestamp_millis = current_time_millis()?;
    let updated_note = build_indexed_note(&note_path, &updated_markdown, timestamp_millis);
    let toggled_task_key =
        find_task_key_for_line(&note_path, &updated_note, line_number, &task_text);

    if let Some(toggled_task_key) = toggled_task_key.as_ref() {
        // Row-scoped upsert of the toggled task timestamp; no need to rewrite every
        // app-state table on a single task toggle.
        let mut persisted_state = read_state(&notes_dir)?;
        let fallback_timestamp = updated_note.modified_millis;
        let timestamps = persisted_state
            .task_timestamps
            .entry(toggled_task_key.clone())
            .or_insert(PersistedTaskTimestamps {
                created_at_millis: fallback_timestamp,
                updated_at_millis: fallback_timestamp,
            });
        timestamps.updated_at_millis = timestamp_millis;
        let updated_timestamps = timestamps.clone();
        db_upsert_task_timestamp(toggled_task_key, &updated_timestamps)?;
    }

    upsert_notes_index_entry(&state, note_path.clone(), updated_note.clone())?;
    state
        .semantic
        .queue_note_update(&note_path, updated_markdown, timestamp_millis)?;

    let delta = build_task_mutation_delta(
        &notes_dir,
        &note_path,
        &updated_note,
        toggled_task_key,
        false,
    )?;
    Ok(delta)
}

pub(crate) fn delete_task(
    state: State<'_, AppState>,
    note_path: String,
    line_number: usize,
    task_text: String,
    task_key: String,
) -> Result<TaskMutationDelta, String> {
    let notes_dir = prepare_notes_dir(false)?;

    let note_path = validate_current_path(Some(note_path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;
    let markdown = fs::read_to_string(&note_path).map_err(|err| err.to_string())?;
    let updated_markdown = delete_task_in_markdown(&markdown, line_number, &task_text)?;
    crate::vault_watcher::record_self_save(&note_path);
    fs::write(&note_path, &updated_markdown).map_err(|err| err.to_string())?;
    let timestamp_millis = current_time_millis()?;
    let updated_note = build_indexed_note(&note_path, &updated_markdown, timestamp_millis);
    upsert_notes_index_entry(&state, note_path.clone(), updated_note.clone())?;

    // Row-scoped: clear hidden flag + drop the timestamp for the deleted task
    // without rewriting the rest of app-state.
    db_set_hidden_task_key(&task_key, false)?;
    db_remove_task_timestamp(&task_key)?;

    state
        .semantic
        .queue_note_update(&note_path, updated_markdown, timestamp_millis)?;

    let delta =
        build_task_mutation_delta(&notes_dir, &note_path, &updated_note, Some(task_key), true)?;
    Ok(delta)
}

fn build_task_mutation_delta(
    notes_dir: &Path,
    note_path: &Path,
    updated_note: &IndexedNote,
    affected_task_key: Option<String>,
    removed: bool,
) -> Result<TaskMutationDelta, String> {
    let persisted_state = read_state(notes_dir)?;
    let raw_path = note_path.to_string_lossy().into_owned();
    let hidden_task_keys = persisted_state
        .hidden_task_keys
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let note_hidden = persisted_state
        .hidden_note_ids
        .iter()
        .any(|note_id| note_id == &updated_note.note_id);
    let note_collapsed = persisted_state
        .collapsed_note_ids
        .iter()
        .any(|note_id| note_id == &updated_note.note_id);

    let mut note_tasks = Vec::with_capacity(updated_note.tasks.len());
    for task in &updated_note.tasks {
        let key = task_key(&updated_note.note_id, task);
        let timestamps = persisted_state
            .task_timestamps
            .get(&key)
            .cloned()
            .unwrap_or(PersistedTaskTimestamps {
                created_at_millis: updated_note.modified_millis,
                updated_at_millis: updated_note.modified_millis,
            });
        note_tasks.push(TaskListItem {
            note_id: updated_note.note_id.clone(),
            task_key: key.clone(),
            note_path: raw_path.clone(),
            file_name: updated_note.file_name.clone(),
            note_title: updated_note.title.clone(),
            section_label: task.section_label.clone(),
            text: task.text.clone(),
            completed: task.completed,
            hidden: hidden_task_keys.contains(key.as_str()),
            note_hidden,
            note_collapsed,
            depth: task.depth,
            line_number: task.line_number,
            editor_line_number: task.editor_line_number,
            created_at_millis: timestamps.created_at_millis,
            updated_at_millis: timestamps.updated_at_millis,
        });
    }

    Ok(TaskMutationDelta {
        note_id: updated_note.note_id.clone(),
        note_path: raw_path,
        note_tasks,
        affected_task_key,
        removed,
    })
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

pub(super) fn should_sync_task_timestamps(index: &NotesIndex) -> Result<bool, String> {
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
