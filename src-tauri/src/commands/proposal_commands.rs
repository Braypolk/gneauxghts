use super::index_bridge::{remove_notes_index_entry_for_save, upsert_notes_index_entry_for_save};
use crate::{
    index::build_indexed_note,
    index::AppState,
    proposals::{
        apply_note_changes, commit_note_review as commit_review, preview_note_change,
        ApplyNoteChangesResult, CommitNoteReviewResult, NoteChange, ProposalPreview,
        ProposedTextEdit,
    },
    semantic::db::content_hash,
    state::{is_valid_note_path, notes_root},
    time::current_time_millis,
};
use std::{fs, path::Path};
use tauri::State;

#[tauri::command]
pub(crate) fn hash_markdown_content(markdown: String) -> String {
    content_hash(&markdown)
}

/// Hash the on-disk note file bytes. Proposal OCC must use this — session
/// `lastSavedMarkdown` is body-only (frontmatter / title heading stripped).
#[tauri::command]
pub(crate) fn hash_note_at_path(path: String) -> Result<String, String> {
    let notes_dir = notes_root()?;
    let note_path = Path::new(&path);
    if !is_valid_note_path(note_path, &notes_dir) {
        return Err(format!("Invalid note path: {path}"));
    }
    if !note_path.is_file() {
        return Err(format!("Note does not exist: {path}"));
    }
    let markdown = fs::read_to_string(note_path).map_err(|err| err.to_string())?;
    Ok(content_hash(&markdown))
}

#[tauri::command]
pub(crate) fn apply_note_change_proposal(
    state: State<'_, AppState>,
    changes: Vec<NoteChange>,
) -> Result<ApplyNoteChangesResult, String> {
    let notes_dir = notes_root()?;
    let result = apply_note_changes(&notes_dir, &changes)?;
    refresh_after_apply(&state, &result);
    Ok(result)
}

#[tauri::command]
pub(crate) fn preview_note_change_proposal(
    path: String,
    edits: Vec<ProposedTextEdit>,
) -> Result<ProposalPreview, String> {
    let notes_dir = notes_root()?;
    preview_note_change(&notes_dir, &path, &edits)
}

#[tauri::command]
pub(crate) fn commit_note_review(
    state: State<'_, AppState>,
    path: String,
    expected_base_hash: String,
    markdown: String,
) -> Result<CommitNoteReviewResult, String> {
    let notes_dir = notes_root()?;
    let result = commit_review(&notes_dir, path, expected_base_hash, markdown)?;
    if let Some(applied) = result.applied.as_ref() {
        let saved = applied
            .path
            .as_deref()
            .and_then(|path| refresh_saved_note_best_effort(&state, Path::new(path)));
        if let Some((note_id, title, revision)) = saved {
            state.events.note_saved(Some(note_id), applied.path.clone(), title, revision);
        }
    }
    Ok(result)
}

fn refresh_after_apply(state: &State<'_, AppState>, result: &ApplyNoteChangesResult) {
    let timestamp = current_time_millis().unwrap_or(0);

    for applied in &result.applied {
        if let Some(previous_path) = applied.previous_path.as_deref() {
            if applied.kind == "deleteNote" || applied.path.as_deref() != Some(previous_path) {
                let _ = remove_notes_index_entry_for_save(state, Path::new(previous_path));
                let _ = state.semantic.queue_delete_note(Path::new(previous_path));
            }
        }
        if let Some(path) = applied.path.as_deref() {
            let _ = refresh_saved_note_best_effort_at(state, Path::new(path), timestamp);
        }
    }

}

/// Secondary save-side work must never turn a completed atomic write into a
/// failed review. Return metadata only when enough work succeeded to emit the
/// same useful event shape as an ordinary save.
fn refresh_saved_note_best_effort(
    state: &State<'_, AppState>,
    path: &Path,
) -> Option<(String, String, u64)> {
    refresh_saved_note_best_effort_at(state, path, current_time_millis().unwrap_or(0))
}

fn refresh_saved_note_best_effort_at(
    state: &State<'_, AppState>,
    path: &Path,
    timestamp: u64,
) -> Option<(String, String, u64)> {
    let markdown = fs::read_to_string(path).ok()?;
    let indexed_note = build_indexed_note(path, &markdown, timestamp);
    let note_id = indexed_note.note_id.clone();
    let title = indexed_note.title.clone();
    let _ = upsert_notes_index_entry_for_save(state, path.to_path_buf(), indexed_note);
    let _ = state.semantic.queue_note_update(path, markdown, timestamp);
    let revision = state
        .notes_index
        .lock()
        .ok()
        .map(|index| index.revision())
        .unwrap_or(0);
    Some((note_id, title, revision))
}
