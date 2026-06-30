use super::index_bridge::{remove_notes_index_entry_for_save, upsert_notes_index_entry_for_save};
use crate::{
    index::build_indexed_note,
    index::AppState,
    proposals::{apply_note_changes, ApplyNoteChangesResult, NoteChange},
    state::notes_root,
    time::current_time_millis,
};
use std::{fs, path::Path};
use tauri::State;

#[tauri::command]
pub(crate) fn apply_note_change_proposal(
    state: State<'_, AppState>,
    changes: Vec<NoteChange>,
) -> Result<ApplyNoteChangesResult, String> {
    let notes_dir = notes_root()?;
    let result = apply_note_changes(&notes_dir, &changes)?;
    let timestamp = current_time_millis()?;

    for applied in &result.applied {
        if let Some(previous_path) = applied.previous_path.as_deref() {
            if applied.kind == "deleteNote" || applied.path.as_deref() != Some(previous_path) {
                remove_notes_index_entry_for_save(&state, Path::new(previous_path))?;
                state.semantic.queue_delete_note(Path::new(previous_path))?;
            }
        }
        if let Some(path) = applied.path.as_deref() {
            if let Ok(markdown) = fs::read_to_string(path) {
                let indexed_note = build_indexed_note(Path::new(path), &markdown, timestamp);
                upsert_notes_index_entry_for_save(
                    &state,
                    Path::new(path).to_path_buf(),
                    indexed_note,
                )?;
                state
                    .semantic
                    .queue_note_update(Path::new(path), markdown, timestamp)?;
            }
        }
    }

    Ok(result)
}
