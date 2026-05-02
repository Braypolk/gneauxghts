//! Task application service.
//!
//! Routes the existing task command implementations through one place so
//! mutations can emit typed [`AppEvent::TaskListChanged`] events. The
//! algorithm-level logic stays inside `commands::task_commands` to
//! preserve the carefully tuned ordering / timestamp reconciliation
//! behaviour; the service layer is the public boundary.

use crate::app::AppData;
use crate::commands::task_commands::{
    delete_task as delete_task_impl, toggle_task as toggle_task_impl,
};
use crate::commands::TaskMutationDelta;
use crate::index::AppState;
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
        note_path: String,
        line_number: usize,
        task_text: String,
    ) -> Result<TaskMutationDelta, String> {
        let delta = toggle_task_impl(app_state, note_path, line_number, task_text)?;
        app_data.events.task_list_changed(delta.clone());
        Ok(delta)
    }

    pub(crate) fn delete(
        &self,
        app_data: &AppData,
        app_state: State<'_, AppState>,
        note_path: String,
        line_number: usize,
        task_text: String,
        task_key: String,
    ) -> Result<TaskMutationDelta, String> {
        let delta = delete_task_impl(app_state, note_path, line_number, task_text, task_key)?;
        app_data.events.task_list_changed(delta.clone());
        Ok(delta)
    }
}
