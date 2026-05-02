use super::index_bridge::upsert_notes_index_entry;
use super::{
    current_time_millis, prepare_notes_dir, RecentTaskItem, TaskFilter, TaskListItem,
    TaskMutationDelta, INTERACTIVE_INDEX_REFRESH_MAX_AGE,
};
use crate::{
    index::{
        build_indexed_note, delete_task_in_markdown, normalize_search_text, task_key,
        toggle_task_in_markdown, AppState, IndexedNote,
    },
    state::{
        db_set_note_collapsed, db_set_note_hidden, db_set_note_order, read_state,
        resolve_note_path_by_id,
        task_projection::{
            delete_single_task, list_recent_open_tasks, list_tasks_with_filter,
            load_tasks_for_note_id, reconcile_note_tasks, set_hidden_for_task_key,
            ProjectionFilter, TaskRecord,
        },
        validate_current_path,
    },
};
use std::{collections::HashSet, fs, path::Path};
use tauri::State;

pub(super) fn list_recent_tasks(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<RecentTaskItem>, String> {
    let notes_dir = prepare_notes_dir(false)?;

    let persisted_state = read_state(&notes_dir)?;
    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "list_recent_tasks",
    )?;

    let hidden_note_ids: HashSet<String> =
        persisted_state.hidden_note_ids.iter().cloned().collect();

    let records = list_recent_open_tasks(limit, &hidden_note_ids)?;
    Ok(records
        .into_iter()
        .map(|record| RecentTaskItem {
            note_id: record.note_id,
            task_key: record.task_key,
            note_path: record.note_path,
            note_title: record.note_title,
            text: record.text,
            line_number: record.line_number,
            updated_at_millis: record.updated_at_millis,
        })
        .collect())
}

pub(super) fn list_tasks(
    state: State<'_, AppState>,
    filter: TaskFilter,
) -> Result<Vec<TaskListItem>, String> {
    let notes_dir = prepare_notes_dir(false)?;
    let persisted_state = read_state(&notes_dir)?;

    state.ensure_interactive_index(&notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE, "list_tasks")?;

    let hidden_note_ids: HashSet<String> =
        persisted_state.hidden_note_ids.iter().cloned().collect();
    let collapsed_note_ids: HashSet<String> =
        persisted_state.collapsed_note_ids.iter().cloned().collect();

    let projection_filter = match filter {
        TaskFilter::Open => ProjectionFilter::Open,
        TaskFilter::Completed => ProjectionFilter::Completed,
        TaskFilter::All => ProjectionFilter::All,
    };

    let records = list_tasks_with_filter(
        projection_filter,
        &persisted_state.note_order_note_ids,
        &hidden_note_ids,
        &collapsed_note_ids,
    )?;

    Ok(records
        .into_iter()
        .map(|record| make_task_list_item(record, &hidden_note_ids, &collapsed_note_ids))
        .collect())
}

fn make_task_list_item(
    record: TaskRecord,
    hidden_note_ids: &HashSet<String>,
    collapsed_note_ids: &HashSet<String>,
) -> TaskListItem {
    let note_hidden = hidden_note_ids.contains(&record.note_id);
    let note_collapsed = collapsed_note_ids.contains(&record.note_id);
    TaskListItem {
        note_id: record.note_id,
        task_key: record.task_key,
        task_id: Some(record.task_id),
        note_path: record.note_path,
        file_name: record.file_name,
        note_title: record.note_title,
        section_label: record.section_label,
        text: record.text,
        completed: record.completed,
        hidden: record.hidden,
        note_hidden,
        note_collapsed,
        depth: record.depth,
        line_number: record.line_number,
        editor_line_number: record.editor_line_number,
        created_at_millis: record.created_at_millis,
        updated_at_millis: record.updated_at_millis,
    }
}

pub(super) fn set_task_hidden(task_key: String, hidden: bool) -> Result<(), String> {
    let _ = prepare_notes_dir(false)?;
    if task_key.is_empty() {
        return Ok(());
    }
    let _affected = set_hidden_for_task_key(&task_key, hidden)?;
    Ok(())
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

    // Reconciles the projection synchronously (also called by
    // upsert_notes_index_entry below, which is idempotent thanks to the
    // INSERT … ON CONFLICT … DO UPDATE pattern). Doing it here lets us
    // build the delta straight from the projection.
    let _ = reconcile_note_tasks(
        &note_path,
        Some(&updated_note),
        &updated_note.note_id,
        timestamp_millis,
    )?;

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

    let task_ids = set_hidden_for_task_key(&task_key, false)?;
    for task_id in task_ids {
        delete_single_task(&task_id, timestamp_millis)?;
    }

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
    let hidden_note_ids: HashSet<String> =
        persisted_state.hidden_note_ids.iter().cloned().collect();
    let collapsed_note_ids: HashSet<String> =
        persisted_state.collapsed_note_ids.iter().cloned().collect();

    let projection_tasks = load_tasks_for_note_id(&updated_note.note_id)?;
    let note_tasks: Vec<TaskListItem> = projection_tasks
        .into_iter()
        .map(|record| make_task_list_item(record, &hidden_note_ids, &collapsed_note_ids))
        .collect();

    Ok(TaskMutationDelta {
        note_id: updated_note.note_id.clone(),
        note_path: raw_path,
        note_tasks,
        affected_task_key,
        removed,
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::build_indexed_note;
    use std::path::PathBuf;

    #[test]
    fn find_task_key_for_line_prefers_exact_then_nearest() {
        let note_path = PathBuf::from("/tmp/project.md");
        let note = build_indexed_note(
            &note_path,
            "# Project\n\n- [ ] Duplicate\n- [ ] Another\n- [ ] Duplicate\n",
            10,
        );

        let exact = find_task_key_for_line(&note_path, &note, 5, "Duplicate").expect("exact key");
        assert_eq!(exact, task_key(&note.note_id, &note.tasks[2]));
    }
}
