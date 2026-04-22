use super::NoteSession;
use crate::{
    note,
    state::{
        is_valid_note_path, read_state, resolve_note_path_by_id, touch_recent_note_id,
        validate_current_path, write_state,
    },
};
use std::{fs, path::Path, path::PathBuf};

fn clear_stale_last_opened_note(state: &mut crate::state::PersistedState, note_id: &str) {
    state.last_opened_note_id = None;
    state
        .recent_note_ids
        .retain(|recent_note_id| recent_note_id != note_id);
}

fn mark_note_opened(state: &mut crate::state::PersistedState, note_id: String) {
    state.last_opened_note_id = Some(note_id.clone());
    touch_recent_note_id(state, note_id);
}

pub(crate) fn load_note_session_from_notes_dir(notes_dir: &Path) -> Result<NoteSession, String> {
    let mut state = read_state(notes_dir)?;
    let Some(last_opened_note_id) = state.last_opened_note_id.clone() else {
        return Ok(NoteSession::default());
    };

    let Some(note_path) = resolve_note_path_by_id(notes_dir, &last_opened_note_id)? else {
        clear_stale_last_opened_note(&mut state, &last_opened_note_id);
        write_state(notes_dir, &state)?;
        return Ok(NoteSession::default());
    };
    if !is_valid_note_path(&note_path, notes_dir) {
        clear_stale_last_opened_note(&mut state, &last_opened_note_id);
        write_state(notes_dir, &state)?;
        return Ok(NoteSession::default());
    }

    touch_recent_note_id(&mut state, last_opened_note_id);
    write_state(notes_dir, &state)?;
    read_note_session_from_path(&note_path)
}

pub(crate) fn open_note_from_notes_dir(
    notes_dir: &Path,
    note_id: Option<String>,
    path: Option<String>,
) -> Result<NoteSession, String> {
    let note_path = resolve_note_path_input(notes_dir, note_id, path)?;
    let resolved_note_id = crate::state::resolve_note_id_from_path(&note_path)?;

    let mut state = read_state(notes_dir)?;
    mark_note_opened(&mut state, resolved_note_id);
    write_state(notes_dir, &state)?;

    read_note_session_from_path(&note_path)
}

pub(crate) fn read_note_session_from_path(note_path: &Path) -> Result<NoteSession, String> {
    let markdown = fs::read_to_string(note_path).map_err(|err| err.to_string())?;
    let fallback_title = note_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let (title, body) = note::extract_file_name_title_and_body(&markdown, &fallback_title);
    let note_id = note::note_id_from_path_or_markdown(Some(note_path), &markdown);
    Ok(NoteSession {
        note_id,
        title,
        markdown: body,
        path: Some(note_path.to_string_lossy().into_owned()),
    })
}

pub(crate) fn resolve_note_path_input(
    notes_dir: &Path,
    note_id: Option<String>,
    path: Option<String>,
) -> Result<PathBuf, String> {
    if let Some(note_path) = validate_current_path(path, notes_dir)? {
        return Ok(note_path);
    }

    if let Some(note_id) = note_id.filter(|note_id| !note_id.trim().is_empty()) {
        return resolve_note_path_by_id(notes_dir, &note_id)?
            .ok_or_else(|| "Missing note path".to_string());
    }

    Err("Missing note path".to_string())
}
