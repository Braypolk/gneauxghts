//! Task application service.
//!
//! Routes the existing task command implementations through one place. The
//! algorithm-level logic stays inside `commands::task_commands` to
//! preserve the carefully tuned ordering / timestamp reconciliation
//! behaviour; the service layer is the public boundary.

use crate::app::AppData;
use crate::commands::task_commands::{
    delete_task_with_view as delete_task_impl, toggle_task_with_view as toggle_task_impl,
};
use crate::commands::{TaskFilter, TaskListGroupPatch};
use crate::index::AppState;
use std::path::PathBuf;
use tauri::State;

pub(crate) struct TaskService;

impl TaskService {
    pub(crate) fn new() -> Self {
        Self
    }

    pub(crate) fn toggle(
        &self,
        app_data: &AppData,
        app_state: State<'_, AppState>,
        task_id: String,
        filter: TaskFilter,
        show_hidden: bool,
    ) -> Result<TaskListGroupPatch, String> {
        let patch = toggle_task_impl(app_state, task_id, filter, show_hidden)?;
        emit_task_note_changed(app_data, &patch);
        Ok(patch)
    }

    pub(crate) fn delete(
        &self,
        app_data: &AppData,
        app_state: State<'_, AppState>,
        task_id: String,
        filter: TaskFilter,
        show_hidden: bool,
    ) -> Result<TaskListGroupPatch, String> {
        let patch = delete_task_impl(app_state, task_id, filter, show_hidden)?;
        emit_task_note_changed(app_data, &patch);
        Ok(patch)
    }
}

fn emit_task_note_changed(app_data: &AppData, patch: &TaskListGroupPatch) {
    if let Some(note_path) = patch.note_path.as_deref() {
        app_data.events.vault_note_changed_from_source(
            &PathBuf::from(note_path),
            false,
            "taskMutation",
        );
    }
}
