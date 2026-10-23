use super::{
    note_session::read_state_with_app_index, prepare_notes_dir, RecentTaskItem, TaskFilter,
    TaskListGroup, TaskListGroupPatch, TaskListItem,
};
use crate::{
    index::AppState,
    services::note_timeline::{
        AllowedScope, CurrentContentIdentity, CurrentContentItem, CurrentContentProjection,
        MutationWarningStage, NoteMutationWarning,
    },
    services::task_mutation::{
        PreparedTaskDocumentMutation, TaskMutationKind, TaskMutationService,
    },
    state::{
        db_set_note_collapsed, db_set_note_hidden, db_set_note_order, resolve_note_path_by_id,
        task_projection::{
            list_recent_open_tasks, list_tasks_with_filter, load_task_by_id,
            load_tasks_for_note_id, set_hidden_for_task_id, ProjectionFilter, TaskRecord,
        },
    },
};
use std::collections::{HashMap, HashSet};
use tauri::State;

impl CurrentContentItem for RecentTaskItem {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_> {
        CurrentContentIdentity::Note {
            note_id: Some(&self.note_id),
            note_path: Some(&self.note_path),
        }
    }
}

impl CurrentContentItem for TaskListGroup {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_> {
        CurrentContentIdentity::Note {
            note_id: Some(&self.note_id),
            note_path: Some(&self.note_path),
        }
    }
}

impl CurrentContentItem for TaskListGroupPatch {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_> {
        CurrentContentIdentity::Note {
            note_id: Some(&self.note_id),
            note_path: self.note_path.as_deref(),
        }
    }
}

impl CurrentContentProjection for TaskListGroupPatch {
    type Item = Self;

    fn retain_current(&mut self, retains: &mut dyn FnMut(&Self) -> bool) {
        if !retains(self) {
            self.note_path = None;
            self.group = None;
        }
    }
}

pub(super) fn list_recent_tasks(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<RecentTaskItem>, String> {
    state
        .note_timeline()
        .current_content(AllowedScope::vault())
        .read_refreshable(|| {
            let notes_dir = prepare_notes_dir(&state, false)?;

            state.ensure_interactive_index(&notes_dir, "list_recent_tasks")?;
            let persisted_state = read_state_with_app_index(&notes_dir, Some(&state))?;

            let hidden_note_ids: HashSet<String> =
                persisted_state.hidden_note_ids.iter().cloned().collect();

            Ok(list_recent_open_tasks(limit, &hidden_note_ids)?
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
        })
}

pub(super) fn list_tasks(
    state: State<'_, AppState>,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<Vec<TaskListGroup>, String> {
    state
        .note_timeline()
        .current_content(AllowedScope::vault())
        .read_refreshable(|| {
            let notes_dir = prepare_notes_dir(&state, false)?;
            state.ensure_interactive_index(&notes_dir, "list_tasks")?;
            let persisted_state = read_state_with_app_index(&notes_dir, Some(&state))?;

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
        })
}

pub(super) fn get_task_group(
    state: State<'_, AppState>,
    note_id: String,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    state
        .note_timeline()
        .current_content(AllowedScope::vault())
        .read_refreshable(|| {
            let notes_dir = prepare_notes_dir(&state, false)?;
            state.ensure_interactive_index(&notes_dir, "get_task_group")?;
            build_task_group_patch(&state, &note_id, filter.clone(), show_hidden)
        })
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
        due_date: crate::services::task_dates::task_due_date(&record.text),
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
    let mut group_indices = HashMap::<String, usize>::new();

    for record in records {
        if !show_hidden && hidden_note_ids.contains(&record.note_id) {
            continue;
        }

        let item = make_task_list_item(record, hidden_note_ids, collapsed_note_ids);
        let group_index = match group_indices.get(&item.note_id).copied() {
            Some(index) => index,
            None => {
                let index = groups.len();
                group_indices.insert(item.note_id.clone(), index);
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
                index
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
    state: &AppState,
    note_id: &str,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    let notes_dir = prepare_notes_dir(state, false)?;
    let persisted_state = read_state_with_app_index(&notes_dir, Some(state))?;
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
        commit_warning: None,
    })
}

pub(super) fn set_task_hidden(
    state: State<'_, AppState>,
    task_id: String,
    hidden: bool,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    let _ = prepare_notes_dir(&state, false)?;
    if task_id.is_empty() {
        return Ok(TaskListGroupPatch {
            note_id: String::new(),
            note_path: None,
            group: None,
            commit_warning: None,
        });
    }
    let task = load_task_by_id(&task_id)?.ok_or_else(|| "Task not found".to_string())?;
    let note_id = task.note_id.clone();
    set_hidden_for_task_id(&task_id, hidden)?;
    build_task_group_patch(&state, &note_id, filter, show_hidden)
}

pub(super) fn set_note_hidden(
    state: State<'_, AppState>,
    note_id: String,
    hidden: bool,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    let _ = prepare_notes_dir(&state, false)?;
    db_set_note_hidden(&note_id, hidden)?;
    build_task_group_patch(&state, &note_id, filter, show_hidden)
}

pub(super) fn set_note_collapsed(
    state: State<'_, AppState>,
    note_id: String,
    collapsed: bool,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    let _ = prepare_notes_dir(&state, false)?;
    db_set_note_collapsed(&note_id, collapsed)?;
    build_task_group_patch(&state, &note_id, filter, show_hidden)
}

pub(super) fn set_note_order(
    state: State<'_, AppState>,
    note_ids: Vec<String>,
) -> Result<(), String> {
    let notes_dir = prepare_notes_dir(&state, false)?;

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
    state: &AppState,
    task_id: String,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    mutate_task_with_view(
        state,
        task_id,
        TaskMutationKind::Toggle,
        filter,
        show_hidden,
    )
}

pub(crate) fn delete_task_with_view(
    state: &AppState,
    task_id: String,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    mutate_task_with_view(
        state,
        task_id,
        TaskMutationKind::Delete,
        filter,
        show_hidden,
    )
}

pub(crate) fn set_task_due_date_with_view(
    state: &AppState,
    task_id: String,
    due_date: Option<String>,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    mutate_task_with_view(
        state,
        task_id,
        TaskMutationKind::SetDueDate { due_date },
        filter,
        show_hidden,
    )
}

fn mutate_task_with_view(
    state: &AppState,
    task_id: String,
    mutation_kind: TaskMutationKind,
    filter: TaskFilter,
    show_hidden: bool,
) -> Result<TaskListGroupPatch, String> {
    let notes_dir = prepare_notes_dir(&state, false)?;
    let committed = TaskMutationService::new(&state).commit(&notes_dir, &task_id, mutation_kind)?;
    let mut patch = match build_task_group_patch(&state, &committed.note_id, filter, show_hidden) {
        Ok(patch) => patch,
        Err(error) => TaskListGroupPatch {
            note_id: committed.note_id.clone(),
            note_path: None,
            group: None,
            commit_warning: Some(NoteMutationWarning::single(
                MutationWarningStage::TaskViewRefresh,
                format!(
                    "Canonical task mutation was saved at {}, but the task view could not refresh: {error}",
                    committed.note_path.display()
                ),
                error,
            )),
        },
    };
    patch.note_path = Some(committed.note_path.to_string_lossy().into_owned());
    if let Some(mut warning) = committed.commit_warning {
        if let Some(view_warning) = patch.commit_warning.take() {
            warning.merge(view_warning);
        }
        patch.commit_warning = Some(warning);
    }
    Ok(patch)
}

#[tauri::command]
pub(crate) fn prepare_task_document_mutation(
    state: State<'_, AppState>,
    task_id: String,
    mutation_kind: TaskMutationKind,
    working_markdown: String,
    body_hash: String,
) -> Result<PreparedTaskDocumentMutation, String> {
    TaskMutationService::prepare(
        state.running_vault().root(),
        &task_id,
        mutation_kind,
        &working_markdown,
        &body_hash,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Manager;

    #[test]
    #[ignore = "matched task-query work measurement; run with --ignored --nocapture"]
    fn task_read_work_measurement() {
        let fixture = crate::test_support::TestVault::with_notes("task-read-measurement", |root| {
            for index in 0..500 {
                let tasks = (0..10)
                    .map(|task| format!("- [ ] Task {task} for note {index}\n"))
                    .collect::<String>();
                std::fs::write(
                    root.join(format!("Note {index:04}.md")),
                    format!(
                        "---\ngneauxghts:\n  id: note-{index}\n  created_at: 2026-01-01T00:00:00Z\n  updated_at: 2026-01-01T00:00:00Z\n  trashed_at: null\n---\n\n# Note {index}\n\n{tasks}\n{}",
                        "Retained ordinary prose for the measurement.\n".repeat(24)
                    ),
                )
                .unwrap();
            }
        });
        crate::state::db_set_note_order(
            &(0..500)
                .rev()
                .map(|index| format!("note-{index}"))
                .collect::<Vec<_>>(),
        )
        .unwrap();
        for index in 0..10 {
            crate::state::db_set_note_hidden(&format!("note-{index}"), true).unwrap();
            crate::state::db_set_note_collapsed(&format!("note-{index}"), true).unwrap();
        }
        let started = std::time::Instant::now();
        let (_, cold_work) = crate::state::measure_state_prune_work(|| {
            let notes_dir = fixture.notes.path();
            fixture
                .state
                .ensure_interactive_index(notes_dir, "task-cold-measurement")
                .unwrap();
            let _persisted = read_state_with_app_index(notes_dir, Some(&fixture.state)).unwrap();
        });
        eprintln!(
            "task-read cold preparation: {:?}, {cold_work:?}",
            started.elapsed()
        );
        for repetition in 0..5 {
            let started = std::time::Instant::now();
            let (_, work) = crate::state::measure_state_prune_work(|| {
                let notes_dir = fixture.notes.path();
                fixture
                    .state
                    .ensure_interactive_index(notes_dir, "task-warm-measurement")
                    .unwrap();
                let persisted = read_state_with_app_index(notes_dir, Some(&fixture.state)).unwrap();
                let hidden = persisted.hidden_note_ids.into_iter().collect();
                let collapsed = persisted.collapsed_note_ids.into_iter().collect();
                let records = list_tasks_with_filter(
                    ProjectionFilter::All,
                    &persisted.note_order_note_ids,
                    &hidden,
                    &collapsed,
                )
                .unwrap();
                let groups = group_task_records(records, false, &hidden, &collapsed);
                assert_eq!(groups.len(), 490);
                assert_eq!(groups[0].note_id, "note-499");
                assert_eq!(groups[489].note_id, "note-10");
            });
            eprintln!(
                "task-read warm list {repetition}: {:?}, {work:?}",
                started.elapsed()
            );
        }
        let records = (0..4_000)
            .flat_map(|note| {
                (0..10).map(move |task| {
                    record(
                        &format!("note-{note}"),
                        &format!("task-{task}"),
                        "Measure grouping",
                        false,
                        false,
                    )
                })
            })
            .collect::<Vec<_>>();
        let started = std::time::Instant::now();
        let groups = group_task_records(records, false, &HashSet::new(), &HashSet::new());
        assert_eq!(groups.len(), 4_000);
        eprintln!(
            "task-read grouping 40000 records/4000 groups: {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn list_tasks_keeps_tasks_when_refreshing_a_dirty_note() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("task-list-data");
        let notes = crate::test_support::TestDir::new("task-list-notes");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Tasks".into(),
            "- [ ] Existing task".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let path = std::path::PathBuf::from(saved.path.unwrap());
        let app = tauri::test::mock_builder()
            .manage(state)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        assert_eq!(
            list_tasks(app.state(), TaskFilter::All, false)
                .unwrap()
                .len(),
            1
        );
        let markdown = std::fs::read_to_string(&path).unwrap();
        std::fs::write(&path, markdown.replace("Existing task", "Updated task")).unwrap();
        app.state::<AppState>()
            .mark_notes_index_dirty(&path, "task-list-test")
            .unwrap();
        let groups = list_tasks(app.state(), TaskFilter::All, false).unwrap();
        assert_eq!(
            groups.len(),
            1,
            "an index refresh must not look like an empty vault"
        );
        assert_eq!(groups[0].display_tasks[0].text, "Updated task");
        assert!(list_tasks(app.state(), TaskFilter::Completed, false)
            .unwrap()
            .is_empty());
        assert_eq!(list_recent_tasks(app.state(), 10).unwrap().len(), 1);
        let patch =
            get_task_group(app.state(), saved.note_id.unwrap(), TaskFilter::All, false).unwrap();
        assert_eq!(patch.group.unwrap().display_tasks[0].text, "Updated task");
        app.state::<AppState>()
            .stop_rebuildable_projection_work()
            .unwrap();
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn task_queries_reuse_index_pruning_without_changing_visibility_or_source_refresh() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("task-query-state-data");
        let notes = crate::test_support::TestDir::new("task-query-state-notes");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let write_note = |id: &str, body: &str| {
            let path = notes.path().join(format!("{id}.md"));
            std::fs::write(&path, format!("---\ngneauxghts:\n  id: {id}\n  created_at: 2026-01-01T00:00:00Z\n  updated_at: 2026-01-01T00:00:00Z\n  trashed_at: null\n---\n\n{body}")).unwrap();
            path
        };
        let a = write_note("a", "- [ ] A open\n- [x] A done");
        let b = write_note("b", "- [ ] B open");
        write_note("hidden-note", "- [ ] Hidden open");
        crate::state::db_set_note_order(&[
            "b".into(),
            "hidden-note".into(),
            "missing".into(),
            "a".into(),
        ])
        .unwrap();
        crate::state::db_set_note_hidden("hidden-note", true).unwrap();
        crate::state::db_set_note_hidden("missing", true).unwrap();
        crate::state::db_set_note_collapsed("b", true).unwrap();
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        assert!(!state.has_warm_notes_index());
        let app = tauri::test::mock_builder()
            .manage(state)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let (cold, cold_work) = crate::state::measure_state_prune_work(|| {
            list_tasks(app.state(), TaskFilter::All, false).unwrap()
        });
        assert_eq!(
            cold_work.disk_scans, 0,
            "the required cold index refresh must not be followed by a pruning vault walk"
        );
        assert_eq!(
            cold.iter()
                .map(|group| group.note_id.as_str())
                .collect::<Vec<_>>(),
            vec!["b", "a"]
        );
        assert!(cold[0].note_collapsed);
        let (warm, warm_work) = crate::state::measure_state_prune_work(|| {
            let groups = list_tasks(app.state(), TaskFilter::All, false).unwrap();
            let recent = list_recent_tasks(app.state(), 1).unwrap();
            assert_eq!(recent.len(), 1);
            assert_ne!(recent[0].note_id, "hidden-note");
            let patch = get_task_group(app.state(), "b".into(), TaskFilter::All, false).unwrap();
            assert_eq!(patch.group.unwrap().display_tasks[0].text, "B open");
            groups
        });
        assert_eq!(warm_work.disk_scans, 0);
        assert_eq!(warm_work.markdown_reads, 0);
        assert!(warm_work.indexed_path_checks > 0);
        assert_eq!(
            serde_json::to_value(&cold).unwrap(),
            serde_json::to_value(warm).unwrap()
        );
        let running = app.state::<AppState>();
        let indexed = read_state_with_app_index(notes.path(), Some(&running)).unwrap();
        let disk = crate::state::read_state(notes.path()).unwrap();
        assert_eq!(
            serde_json::to_value(indexed).unwrap(),
            serde_json::to_value(disk).unwrap()
        );

        write_note("b", "- [x] B external update");
        running
            .mark_notes_index_dirty(&b, "task-query-test")
            .unwrap();
        let updated = list_tasks(app.state(), TaskFilter::Completed, false).unwrap();
        assert_eq!(updated[0].display_tasks[0].text, "B external update");
        assert_eq!(
            list_tasks(app.state(), TaskFilter::Open, false).unwrap()[0].note_id,
            "a"
        );
        std::fs::remove_file(&a).unwrap();
        running
            .mark_notes_index_dirty(&a, "task-query-test")
            .unwrap();
        let remaining = list_tasks(app.state(), TaskFilter::All, false).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].note_id, "b");
        assert!(
            get_task_group(app.state(), "a".into(), TaskFilter::All, false)
                .unwrap()
                .group
                .is_none()
        );
        running.note_timeline().forget_note(&b, 7).unwrap();
        assert!(list_tasks(app.state(), TaskFilter::All, false)
            .unwrap()
            .is_empty());
        assert!(list_recent_tasks(app.state(), 10).unwrap().is_empty());
        assert!(
            get_task_group(app.state(), "b".into(), TaskFilter::All, true)
                .unwrap()
                .group
                .is_none()
        );
        let shown = list_tasks(app.state(), TaskFilter::All, true).unwrap();
        assert_eq!(shown.len(), 1);
        assert_eq!(shown[0].note_id, "hidden-note");
        assert!(shown[0].note_hidden);
        running.stop_rebuildable_projection_work().unwrap();
    }

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

    #[test]
    fn group_task_records_preserves_first_seen_order_for_interleaved_records() {
        let groups = group_task_records(
            vec![
                record("b", "b-hidden", "Hidden first task", false, true),
                record("a", "a-first", "A first", false, false),
                record("only-hidden", "hidden", "Never displayed", false, true),
                record(
                    "hidden-note",
                    "hidden-note-task",
                    "Hidden note",
                    false,
                    false,
                ),
                record("b", "b-visible", "B visible", false, false),
                record("a", "a-last", "A last", true, false),
            ],
            false,
            &HashSet::from(["hidden-note".to_string()]),
            &HashSet::from(["b".to_string()]),
        );
        assert_eq!(
            groups
                .iter()
                .map(|group| group.note_id.as_str())
                .collect::<Vec<_>>(),
            vec!["b", "a"]
        );
        assert_eq!(groups[0].hidden_count, 1);
        assert_eq!(groups[0].visible_count, 1);
        assert_eq!(groups[0].display_count, 1);
        assert!(groups[0].note_collapsed);
        assert_eq!(groups[0].display_tasks[0].task_id, "b-visible");
        assert_eq!(
            groups[1]
                .display_tasks
                .iter()
                .map(|item| item.task_id.as_str())
                .collect::<Vec<_>>(),
            vec!["a-first", "a-last"]
        );
    }
}
