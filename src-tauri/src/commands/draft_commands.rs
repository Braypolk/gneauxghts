use crate::{index::AppState, state::draft_recovery::DraftBackup};

#[tauri::command]
pub(crate) async fn save_draft_backup<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    draft: DraftBackup,
) -> Result<(), String> {
    super::on_app_worker(app, move |state: &AppState| {
        state.app_state_storage().save_draft_backup(draft)
    })
    .await?
}

#[tauri::command]
pub(crate) async fn list_draft_backups<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<DraftBackup>, String> {
    super::on_app_worker(app, |state: &AppState| {
        state.app_state_storage().list_draft_backups()
    })
    .await?
}

#[tauri::command]
pub(crate) async fn remove_draft_backup<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    version: u64,
) -> Result<(), String> {
    super::on_app_worker(app, move |state: &AppState| {
        state.app_state_storage().remove_draft_backup(&id, version)
    })
    .await?
}
