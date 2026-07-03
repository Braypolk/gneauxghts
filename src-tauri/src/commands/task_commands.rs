use super::index_bridge::upsert_notes_index_entry;
use super::{
    current_time_millis, prepare_notes_dir, RecentTaskItem, TaskFilter, TaskListGroup,
    TaskListGroupPatch, TaskListItem, INTERACTIVE_INDEX_REFRESH_MAX_AGE,
};
use crate::{
    index::{build_indexed_note, delete_task_in_markdown, toggle_task_in_markdown, AppState},
    state::{
        db_set_note_collapsed, db_set_note_hidden, db_set_note_order, read_state,
        resolve_note_path_by_id,
        task_projection::{
            delete_single_task, list_recent_open_tasks, list_tasks_with_filter, load_task_by_id,
            load_tasks_for_note_id, reconcile_note_tasks, set_hidden_for_task_id, ProjectionFilter,
            TaskRecord,
        },
        validate_current_path,
    },
};
use std::{collections::HashSet, fs};
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
    show_hidden: bool,
) -> Result<Vec<TaskListGroup>, String> {
    let notes_dir = prepare_notes_dir(false)?;
    let persisted_state = read_state(&notes_dir)?;

    state.ensure_interactive_index(&notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE, "list_tasks")?;

    let hidden_note_ids: HashSet<String> =
        persisted_state.hidden_note_ids.iter().cloned().collect();
    let collapsed_note_ids: HashSet<String> =
        persisted_state.collapsed_note_ids.iter().cloned().collect();

    let projection_filter = projection_filter_from_task_filter(&filter);

    let records = list_tasks_with_filter(
        projection_filter,
        &persisted_state.note_order_note_ids,
        &hidden_note_ids,
        &collapsed_note_ids,
    )?;

    Ok(group_task_records(
        records,
        show_hidden,
        &hidden_note_ids,
        &collapsed_note_ids,
    ))
}

pub(super) fn get_task_group(
    state: State<'_, AppState>,
    note_id: String,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    let notes_dir = prepare_notes_dir(false)?;
    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "get_task_group",
    )?;
    build_task_group_patch(&note_id, filter, show_hidden)
}

fn projection_filter_from_task_filter(filter: &TaskFilter) -> ProjectionFilter {
    match filter {
        TaskFilter::Open => ProjectionFilter::Open,
        TaskFilter::Completed => ProjectionFilter::Completed,
        TaskFilter::All => ProjectionFilter::All,
    }
}

fn task_matches_filter(record: &TaskRecord, filter: &TaskFilter) -> bool {
    match filter {
        TaskFilter::Open => !record.completed,
        TaskFilter::Completed => record.completed,
        TaskFilter::All => true,
    }
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
        task_id: record.task_id,
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

fn group_task_records(
    records: Vec<TaskRecord>,
    show_hidden: bool,
    hidden_note_ids: &HashSet<String>,
    collapsed_note_ids: &HashSet<String>,
) -> Vec<TaskListGroup> {
    let mut groups = Vec::<TaskListGroup>::new();

    for record in records {
        if !show_hidden && hidden_note_ids.contains(&record.note_id) {
            continue;
        }

        let item = make_task_list_item(record, hidden_note_ids, collapsed_note_ids);
        let group_index = match groups
            .iter()
            .position(|group| group.note_id == item.note_id)
        {
            Some(index) => index,
            None => {
                groups.push(TaskListGroup {
                    note_id: item.note_id.clone(),
                    note_path: item.note_path.clone(),
                    note_title: item.note_title.clone(),
                    file_name: item.file_name.clone(),
                    note_hidden: item.note_hidden,
                    note_collapsed: item.note_collapsed,
                    display_tasks: Vec::new(),
                    hidden_count: 0,
                    visible_count: 0,
                    display_count: 0,
                });
                groups.len() - 1
            }
        };
        let group = &mut groups[group_index];
        group.note_hidden = item.note_hidden;
        group.note_collapsed = item.note_collapsed;
        if item.hidden {
            group.hidden_count += 1;
        } else {
            group.visible_count += 1;
        }
        if show_hidden || !item.hidden {
            group.display_tasks.push(item);
            group.display_count += 1;
        }
    }

    groups
        .into_iter()
        .filter(|group| group.display_count > 0)
        .collect()
}

fn build_task_group_patch(
    note_id: &str,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    let notes_dir = prepare_notes_dir(false)?;
    let persisted_state = read_state(&notes_dir)?;
    let hidden_note_ids: HashSet<String> =
        persisted_state.hidden_note_ids.iter().cloned().collect();
    let collapsed_note_ids: HashSet<String> =
        persisted_state.collapsed_note_ids.iter().cloned().collect();
    let records = load_tasks_for_note_id(note_id)?
        .into_iter()
        .filter(|record| task_matches_filter(record, &filter))
        .collect();
    let group = group_task_records(records, show_hidden, &hidden_note_ids, &collapsed_note_ids)
        .into_iter()
        .next();

    Ok(TaskListGroupPatch {
        note_id: note_id.to_string(),
        note_path: group.as_ref().map(|group| group.note_path.clone()),
        group,
    })
}

pub(super) fn set_task_hidden(
    task_id: String,
    hidden: bool,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    let _ = prepare_notes_dir(false)?;
    if task_id.is_empty() {
        return Ok(TaskListGroupPatch {
            note_id: String::new(),
            note_path: None,
            group: None,
        });
    }
    let task = load_task_by_id(&task_id)?.ok_or_else(|| "Task not found".to_string())?;
    let note_id = task.note_id.clone();
    set_hidden_for_task_id(&task_id, hidden)?;
    build_task_group_patch(&note_id, filter, show_hidden)
}

pub(super) fn set_note_hidden(
    note_id: String,
    hidden: bool,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    let _ = prepare_notes_dir(false)?;
    db_set_note_hidden(&note_id, hidden)?;
    build_task_group_patch(&note_id, filter, show_hidden)
}

pub(super) fn set_note_collapsed(
    note_id: String,
    collapsed: bool,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    let _ = prepare_notes_dir(false)?;
    db_set_note_collapsed(&note_id, collapsed)?;
    build_task_group_patch(&note_id, filter, show_hidden)
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

pub(crate) fn toggle_task_with_view(
    state: State<'_, AppState>,
    task_id: String,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    let notes_dir = prepare_notes_dir(false)?;
    let task = load_task_by_id(&task_id)?.ok_or_else(|| "Task not found".to_string())?;

    let note_path = validate_current_path(Some(task.note_path.clone()), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;
    let markdown = fs::read_to_string(&note_path).map_err(|err| err.to_string())?;
    let updated_markdown = toggle_task_in_markdown(&markdown, task.line_number, &task.text)?;
    crate::vault_watcher::record_self_save(&note_path);
    fs::write(&note_path, &updated_markdown).map_err(|err| err.to_string())?;
    let timestamp_millis = current_time_millis()?;
    let updated_note = build_indexed_note(&note_path, &updated_markdown, timestamp_millis);
    // Reconciles the projection synchronously. The upsert below is also
    // idempotent, but doing this first lets the event payload reflect the
    // canonical projection state immediately.
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

    let _ = notes_dir;
    let mut patch = build_task_group_patch(&updated_note.note_id, filter, show_hidden)?;
    patch.note_path = Some(note_path.to_string_lossy().into_owned());
    Ok(patch)
}

pub(crate) fn delete_task_with_view(
    state: State<'_, AppState>,
    task_id: String,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    let notes_dir = prepare_notes_dir(false)?;
    let task = load_task_by_id(&task_id)?.ok_or_else(|| "Task not found".to_string())?;

    let note_path = validate_current_path(Some(task.note_path.clone()), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;
    let markdown = fs::read_to_string(&note_path).map_err(|err| err.to_string())?;
    let updated_markdown = delete_task_in_markdown(&markdown, task.line_number, &task.text)?;
    crate::vault_watcher::record_self_save(&note_path);
    fs::write(&note_path, &updated_markdown).map_err(|err| err.to_string())?;
    let timestamp_millis = current_time_millis()?;
    let updated_note = build_indexed_note(&note_path, &updated_markdown, timestamp_millis);
    upsert_notes_index_entry(&state, note_path.clone(), updated_note.clone())?;
    delete_single_task(&task_id, timestamp_millis)?;

    state
        .semantic
        .queue_note_update(&note_path, updated_markdown, timestamp_millis)?;

    let _ = notes_dir;
    let mut patch = build_task_group_patch(&updated_note.note_id, filter, show_hidden)?;
    patch.note_path = Some(note_path.to_string_lossy().into_owned());
    Ok(patch)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(
        note_id: &str,
        task_id: &str,
        text: &str,
        completed: bool,
        hidden: bool,
    ) -> TaskRecord {
        TaskRecord {
            task_id: task_id.to_string(),
            note_id: note_id.to_string(),
            note_path: format!("/notes/{note_id}.md"),
            note_title: "Project".to_string(),
            file_name: "Project.md".to_string(),
            note_modified_millis: 100,
            task_key: format!("{note_id}:{task_id}"),
            section_label: None,
            text: text.to_string(),
            completed,
            hidden,
            depth: 0,
            line_number: 1,
            editor_line_number: Some(1),
            created_at_millis: 100,
            updated_at_millis: 100,
        }
    }

    fn one_group(
        records: Vec<TaskRecord>,
        show_hidden: bool,
        hidden_note_ids: &HashSet<String>,
    ) -> Option<TaskListGroup> {
        group_task_records(records, show_hidden, hidden_note_ids, &HashSet::new())
            .into_iter()
            .next()
    }

    #[test]
    fn task_matches_filter_honors_open_completed_and_all() {
        let open = record("note-1", "task-1", "Open task", false, false);
        let completed = record("note-1", "task-2", "Done task", true, false);

        assert!(task_matches_filter(&open, &TaskFilter::Open));
        assert!(!task_matches_filter(&completed, &TaskFilter::Open));
        assert!(!task_matches_filter(&open, &TaskFilter::Completed));
        assert!(task_matches_filter(&completed, &TaskFilter::Completed));
        assert!(task_matches_filter(&open, &TaskFilter::All));
        assert!(task_matches_filter(&completed, &TaskFilter::All));
    }

    #[test]
    fn group_task_records_hides_hidden_tasks_unless_requested() {
        let visible = record("note-1", "task-1", "Visible task", false, false);
        let hidden = record("note-1", "task-2", "Hidden task", false, true);
        let no_hidden_notes = HashSet::new();

        let hidden_off = one_group(
            vec![visible.clone(), hidden.clone()],
            false,
            &no_hidden_notes,
        )
        .unwrap();
        assert_eq!(hidden_off.display_count, 1);
        assert_eq!(hidden_off.hidden_count, 1);
        assert_eq!(hidden_off.visible_count, 1);
        assert_eq!(hidden_off.display_tasks[0].task_id, "task-1");

        let hidden_on = one_group(vec![visible, hidden], true, &no_hidden_notes).unwrap();
        assert_eq!(hidden_on.display_count, 2);
        assert_eq!(hidden_on.hidden_count, 1);
        assert_eq!(hidden_on.visible_count, 1);
    }

    #[test]
    fn group_task_records_hides_hidden_note_unless_requested() {
        let mut hidden_note_ids = HashSet::new();
        hidden_note_ids.insert("note-1".to_string());

        let hidden_off = one_group(
            vec![record("note-1", "task-1", "Visible task", false, false)],
            false,
            &hidden_note_ids,
        );
        assert!(hidden_off.is_none());

        let hidden_on = one_group(
            vec![record("note-1", "task-1", "Visible task", false, false)],
            true,
            &hidden_note_ids,
        )
        .unwrap();
        assert!(hidden_on.note_hidden);
        assert_eq!(hidden_on.display_count, 1);
    }

    #[test]
    fn group_task_records_returns_no_group_when_nothing_displays() {
        let no_hidden_notes = HashSet::new();
        let group = one_group(
            vec![record("note-1", "task-1", "Hidden task", false, true)],
            false,
            &no_hidden_notes,
        );
        assert!(group.is_none());
    }
}
