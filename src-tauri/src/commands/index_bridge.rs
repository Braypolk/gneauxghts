use crate::index::{build_indexed_note, AppState, IndexedNote};
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::State;

fn read_modified_millis(path: &Path) -> Result<u64, String> {
    let modified = fs::metadata(path)
        .map_err(|err| err.to_string())?
        .modified()
        .map_err(|err| err.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();

    Ok(modified.min(u128::from(u64::MAX)) as u64)
}

pub(super) fn upsert_notes_index_entry(
    state: &State<'_, AppState>,
    path: PathBuf,
    note: IndexedNote,
) -> Result<(), String> {
    state.upsert_note_indexes(path, note)
}

pub(super) fn remove_notes_index_entry(
    state: &State<'_, AppState>,
    path: &Path,
) -> Result<(), String> {
    state.remove_note_indexes(path)
}

pub(super) fn read_indexed_note_from_path(path: &Path) -> Result<Option<IndexedNote>, String> {
    if !path.is_file() {
        return Ok(None);
    }

    let markdown = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let modified_millis = read_modified_millis(path)?;
    Ok(Some(build_indexed_note(path, &markdown, modified_millis)))
}
