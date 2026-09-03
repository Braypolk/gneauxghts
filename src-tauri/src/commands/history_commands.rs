use crate::{
    commands::{note_persistence::build_note_session_from_mutation, NoteSession},
    index::AppState,
    services::note_timeline::{
        HistoryDiffComparison, HistoryModeDiff, HistoryModePage, HistoryModeRevision,
        HistoryRestorePreview, NoteIdentity, NoteTimeline, RevisionIdentity,
    },
};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VersionRestoreCommit {
    revision_id: String,
    session: NoteSession,
}

fn history_access<'a>(
    state: &'a AppState,
    note_id: String,
) -> Result<crate::services::note_timeline::HistoryModeAccess<'a>, String> {
    let note_id = note_id.trim();
    if note_id.is_empty() {
        return Err("History Mode requires a Note Identity".to_string());
    }
    Ok(NoteTimeline::new(state).open_history_mode(NoteIdentity::new(note_id)))
}

#[tauri::command]
pub(crate) fn get_note_history_page(
    state: State<'_, AppState>,
    note_id: String,
    cursor: Option<String>,
    limit: usize,
) -> Result<HistoryModePage, String> {
    history_access(&state, note_id)?.page(cursor.as_deref(), limit)
}

#[tauri::command]
pub(crate) fn get_note_history_revision(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
) -> Result<HistoryModeRevision, String> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err("History Mode requires a Revision Identity".to_string());
    }
    history_access(&state, note_id)?.revision(revision_id)
}

#[tauri::command]
pub(crate) fn get_note_history_diff(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
    comparison: HistoryDiffComparison,
) -> Result<HistoryModeDiff, String> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err("History Mode requires a Revision Identity".to_string());
    }
    history_access(&state, note_id)?.diff(revision_id, comparison)
}

#[tauri::command]
pub(crate) fn preview_note_revision_restore(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
) -> Result<HistoryRestorePreview, String> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err("Version Restore requires a Revision Identity".to_string());
    }
    history_access(&state, note_id)?.restore_preview(revision_id)
}

#[tauri::command]
pub(crate) fn restore_note_revision(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
    expected_current_authored_content_hash: String,
    confirmed: bool,
) -> Result<VersionRestoreCommit, String> {
    if !confirmed {
        return Err("Version Restore requires explicit confirmation".to_string());
    }
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err("Version Restore requires a Revision Identity".to_string());
    }
    let restored = history_access(&state, note_id)?
        .confirm_restore(revision_id, &expected_current_authored_content_hash)?;
    let outcome = restored.mutation();
    outcome.report_degraded("Version Restore");
    Ok(VersionRestoreCommit {
        revision_id: restored.revision_id().as_str().to_string(),
        session: build_note_session_from_mutation(outcome),
    })
}

#[tauri::command]
pub(crate) fn name_note_revision(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
    label: String,
) -> Result<(), String> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err("Naming history requires a Revision Identity".to_string());
    }
    history_access(&state, note_id)?
        .name_revision(&RevisionIdentity::from_persisted(revision_id), &label)
}

#[tauri::command]
pub(crate) fn remove_note_revision_name(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
) -> Result<(), String> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err("Removing a history name requires a Revision Identity".to_string());
    }
    history_access(&state, note_id)?
        .remove_revision_name(&RevisionIdentity::from_persisted(revision_id))
}

#[tauri::command]
pub(crate) fn clear_note_history(
    state: State<'_, AppState>,
    note_id: String,
    confirmed: bool,
) -> Result<(), String> {
    if !confirmed {
        return Err("Clearing note history requires explicit confirmation".to_string());
    }
    let note_id = note_id.trim();
    if note_id.is_empty() {
        return Err("Clearing note history requires a Note Identity".to_string());
    }
    NoteTimeline::new(&state)
        .clear_note_history(&NoteIdentity::new(note_id))
        .map(|_| ())
}

#[tauri::command]
pub(crate) fn clear_vault_history(
    state: State<'_, AppState>,
    confirmed: bool,
) -> Result<(), String> {
    if !confirmed {
        return Err("Clearing vault history requires explicit confirmation".to_string());
    }
    let vault_root = crate::state::vault_root()?;
    NoteTimeline::new(&state)
        .clear_vault_history(&vault_root)
        .map(|_| ())
}
