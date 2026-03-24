use crate::{
    path_utils::unique_path_in_dir,
    state::{is_forgotten_note_path, read_state, write_state, PersistedForgottenNote},
    time::current_time_millis,
};
use std::{
    ffi::OsStr,
    path::{Component, Path, PathBuf},
};

pub(super) fn relative_sync_path(notes_dir: &Path, note_path: &Path) -> Result<String, String> {
    if is_forgotten_note_path(note_path, notes_dir) {
        let file_name = note_path
            .file_name()
            .ok_or_else(|| "Forgotten note file name is missing".to_string())?;
        return Ok(file_name.to_string_lossy().into_owned());
    }

    note_path
        .strip_prefix(notes_dir)
        .map_err(|_| "Note path is outside the vault".to_string())
        .map(|path| path.to_string_lossy().replace('\\', "/"))
}

pub(super) fn forgotten_original_relative_path(
    notes_dir: &Path,
    note_path: &Path,
) -> Result<String, String> {
    let forgotten_path = note_path.to_string_lossy().into_owned();
    let state = read_state(notes_dir)?;
    if let Some(relative_path) = state
        .forgotten_notes
        .iter()
        .find(|forgotten_note| forgotten_note.forgotten_path == forgotten_path)
        .map(|forgotten_note| {
            Path::new(&forgotten_note.original_path)
                .strip_prefix(notes_dir)
                .map(|path| path.to_string_lossy().replace('\\', "/"))
                .map_err(|_| "Forgotten note original path is outside the vault".to_string())
        })
        .transpose()?
    {
        return Ok(relative_path);
    }

    repair_missing_forgotten_original_path(notes_dir, note_path)
}

pub(super) fn validated_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(relative_path);
    if candidate.is_absolute() {
        return Err("Remote relative path must not be absolute".to_string());
    }
    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::RootDir))
    {
        return Err("Remote relative path is invalid".to_string());
    }
    Ok(candidate)
}

pub(super) fn resolve_unique_sync_path(directory: &Path, preferred_file_name: &str) -> PathBuf {
    unique_path_in_dir(directory, OsStr::new(preferred_file_name), "Untitled")
}

fn repair_missing_forgotten_original_path(
    notes_dir: &Path,
    note_path: &Path,
) -> Result<String, String> {
    let file_name = note_path
        .file_name()
        .ok_or_else(|| "Forgotten note file name is missing".to_string())?
        .to_string_lossy()
        .into_owned();
    let original_path = unique_path_in_dir(notes_dir, OsStr::new(&file_name), "Untitled");
    let title = Path::new(&file_name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let forgotten_at_millis = current_time_millis()?;
    let mut state = read_state(notes_dir)?;
    state.forgotten_notes.push(PersistedForgottenNote {
        forgotten_path: note_path.to_string_lossy().into_owned(),
        original_path: original_path.to_string_lossy().into_owned(),
        title,
        forgotten_at_millis,
        purge_after_days: 7,
        purge_at_millis: forgotten_at_millis + 7 * 24 * 60 * 60 * 1000,
    });
    write_state(notes_dir, &state)?;
    Ok(file_name)
}
