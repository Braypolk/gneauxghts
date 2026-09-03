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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissingNoteSummary {
    note_id: String,
    path: String,
    title: String,
    file_name: String,
    missing_at_millis: u64,
    retention_days: u32,
    purge_at_millis: u64,
    timeline: HistoryModePage,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveredMissingNote {
    note_id: String,
    restored_path: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    commit_warning: Option<crate::services::note_timeline::NoteMutationWarning>,
}

#[tauri::command]
pub(crate) fn list_missing_notes(
    state: State<'_, AppState>,
) -> Result<Vec<MissingNoteSummary>, String> {
    super::prepare_notes_dir_with_state(true, Some(&state))?;
    let timeline = NoteTimeline::new(&state);
    timeline
        .missing_notes()?
        .into_iter()
        .map(|missing| {
            let mut page =
                timeline.missing_note_history_page(missing.note_id().clone(), None, 100)?;
            while let Some(cursor) = page.next_cursor().map(str::to_string) {
                page.append(timeline.missing_note_history_page(
                    missing.note_id().clone(),
                    Some(&cursor),
                    100,
                )?);
            }
            Ok(MissingNoteSummary {
                note_id: missing.note_id().as_str().to_string(),
                path: missing.path().to_string_lossy().into_owned(),
                title: missing.title().to_string(),
                file_name: missing
                    .path()
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                missing_at_millis: missing.missing_at_millis(),
                retention_days: missing.retention_days(),
                purge_at_millis: missing.purge_at_millis(),
                timeline: page,
            })
        })
        .collect()
}

#[tauri::command]
pub(crate) fn recover_missing_note(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<RecoveredMissingNote, String> {
    let note_id = NoteIdentity::new(note_id.trim());
    if note_id.as_str().is_empty() {
        return Err("Missing Note recovery requires a Note Identity".to_string());
    }
    let result = NoteTimeline::new(&state).recover_missing_note(note_id.clone())?;
    Ok(RecoveredMissingNote {
        note_id: note_id.as_str().to_string(),
        restored_path: result.receipt().path().to_string_lossy().into_owned(),
        title: result
            .receipt()
            .path()
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        commit_warning: result.commit_warning().cloned(),
    })
}

#[tauri::command]
pub(crate) fn delete_missing_notes(
    state: State<'_, AppState>,
    note_ids: Vec<String>,
) -> Result<(), String> {
    let note_ids = note_ids
        .into_iter()
        .map(|note_id| NoteIdentity::new(note_id.trim()))
        .collect::<Vec<_>>();
    if note_ids.iter().any(|note_id| note_id.as_str().is_empty()) {
        return Err("Missing Note deletion requires Note Identities".to_string());
    }
    NoteTimeline::new(&state).purge_missing_notes(&note_ids, crate::time::current_time_millis()?)
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
