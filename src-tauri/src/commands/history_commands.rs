use crate::{
    index::AppState,
    services::note_timeline::{
        HistoryDiffComparison, HistoryModeDiff, HistoryModePage, HistoryModeRevision, NoteIdentity,
        NoteTimeline,
    },
};
use tauri::State;

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
