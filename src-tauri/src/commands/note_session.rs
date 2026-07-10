use super::NoteSession;
use crate::{
    index::AppState,
    note,
    state::{
        db_touch_note_activity, is_valid_note_path, read_state_with_lookup,
        resolve_note_path_by_id, touch_recent_note_id, validate_current_path,
        write_last_opened_and_recents, write_state_with_lookup, NoteIdLookup, PersistedState,
    },
    time::current_time_millis,
};
use std::{fs, path::Path, path::PathBuf};
use tauri::State;

fn lookup_path_in_index(state: &State<'_, AppState>, note_id: &str) -> Option<PathBuf> {
    state
        .notes_index
        .lock()
        .ok()
        .and_then(|index| index.path_for_note_id(note_id).cloned())
}

fn resolve_note_path_by_id_with_state(
    state: Option<&State<'_, AppState>>,
    notes_dir: &Path,
    note_id: &str,
) -> Result<Option<PathBuf>, String> {
    if let Some(state) = state {
        if let Some(path) = lookup_path_in_index(state, note_id) {
            if is_valid_note_path(&path, notes_dir) {
                return Ok(Some(path));
            }
        }
    }
    resolve_note_path_by_id(notes_dir, note_id)
}

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

fn touch_note_activity(note_id: &str, count_as_open: bool) {
    if let Ok(now) = current_time_millis() {
        let _ = db_touch_note_activity(note_id, now, count_as_open);
    }
}

fn open_ui_state_already_primary(state: &PersistedState, note_id: &str) -> bool {
    let normalized = note_id.trim();
    if normalized.is_empty() {
        return false;
    }

    state.last_opened_note_id.as_deref() == Some(normalized)
        && state
            .recent_note_ids
            .first()
            .is_some_and(|recent_id| recent_id == normalized)
}

#[cfg(test)]
pub(crate) fn load_note_session_from_notes_dir(notes_dir: &Path) -> Result<NoteSession, String> {
    load_note_session_from_notes_dir_with_state(notes_dir, None)
}

pub(crate) fn load_note_session_from_notes_dir_with_state(
    notes_dir: &Path,
    app_state: Option<&State<'_, AppState>>,
) -> Result<NoteSession, String> {
    let lookup_owned: Option<Box<dyn Fn(&str) -> Option<PathBuf> + '_>> =
        app_state.map(|state| -> Box<dyn Fn(&str) -> Option<PathBuf> + '_> {
            Box::new(move |note_id: &str| lookup_path_in_index(state, note_id))
        });
    let is_warm = app_state
        .map(|state| state.has_warm_notes_index())
        .unwrap_or(false);
    let lookup = match lookup_owned.as_deref() {
        Some(closure) => NoteIdLookup::Index {
            lookup: closure,
            is_warm,
        },
        None => NoteIdLookup::Disk,
    };
    let mut persisted = read_state_with_lookup(notes_dir, &lookup)?;
    let Some(last_opened_note_id) = persisted.last_opened_note_id.clone() else {
        return Ok(NoteSession::default());
    };

    let Some(note_path) =
        resolve_note_path_by_id_with_state(app_state, notes_dir, &last_opened_note_id)?
    else {
        clear_stale_last_opened_note(&mut persisted, &last_opened_note_id);
        write_state_with_lookup(notes_dir, &persisted, &lookup)?;
        return Ok(NoteSession::default());
    };
    if !is_valid_note_path(&note_path, notes_dir) {
        clear_stale_last_opened_note(&mut persisted, &last_opened_note_id);
        write_state_with_lookup(notes_dir, &persisted, &lookup)?;
        return Ok(NoteSession::default());
    }

    touch_recent_note_id(&mut persisted, last_opened_note_id.clone());
    // Session restore updates last-viewed without counting as a fresh open,
    // so access frequency reflects intentional note switches.
    touch_note_activity(&last_opened_note_id, false);
    // Row-scoped write of the recents/last-opened only — same rationale as
    // mark_note_opened.
    write_last_opened_and_recents(&persisted)?;
    read_note_session_from_path(&note_path)
}

#[cfg(test)]
pub(crate) fn open_note_from_notes_dir(
    notes_dir: &Path,
    note_id: Option<String>,
    path: Option<String>,
) -> Result<NoteSession, String> {
    open_note_from_notes_dir_with_state(notes_dir, note_id, path, None)
}

pub(crate) fn open_note_from_notes_dir_with_state(
    notes_dir: &Path,
    note_id: Option<String>,
    path: Option<String>,
    app_state: Option<&State<'_, AppState>>,
) -> Result<NoteSession, String> {
    let note_path = resolve_note_path_input_with_state(notes_dir, note_id, path, app_state)?;
    let session = read_note_session_from_path(&note_path)?;
    let resolved_note_id = session
        .note_id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "Unable to determine note id".to_string())?;

    let lookup_owned: Option<Box<dyn Fn(&str) -> Option<PathBuf> + '_>> =
        app_state.map(|state| -> Box<dyn Fn(&str) -> Option<PathBuf> + '_> {
            Box::new(move |id: &str| lookup_path_in_index(state, id))
        });
    let is_warm = app_state
        .map(|state| state.has_warm_notes_index())
        .unwrap_or(false);
    let lookup = match lookup_owned.as_deref() {
        Some(closure) => NoteIdLookup::Index {
            lookup: closure,
            is_warm,
        },
        None => NoteIdLookup::Disk,
    };
    let persisted = read_state_with_lookup(notes_dir, &lookup)?;
    if open_ui_state_already_primary(&persisted, &resolved_note_id) {
        return Ok(session);
    }

    let mut persisted = persisted;
    mark_note_opened(&mut persisted, resolved_note_id);
    if let Some(note_id) = session.note_id.as_deref() {
        touch_note_activity(note_id, true);
    }
    // Row-scoped write: only the last_opened_note_id and recents change here.
    // Avoid the full app_state rewrite that previously fired on every note
    // switch and contended with concurrent open/save under rapid switching.
    write_last_opened_and_recents(&persisted)?;

    Ok(session)
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

pub(crate) fn resolve_note_path_input_with_state(
    notes_dir: &Path,
    note_id: Option<String>,
    path: Option<String>,
    app_state: Option<&State<'_, AppState>>,
) -> Result<PathBuf, String> {
    if let Some(note_path) = validate_current_path(path, notes_dir)? {
        return Ok(note_path);
    }

    if let Some(note_id) = note_id.filter(|note_id| !note_id.trim().is_empty()) {
        return resolve_note_path_by_id_with_state(app_state, notes_dir, &note_id)?
            .ok_or_else(|| "Missing note path".to_string());
    }

    Err("Missing note path".to_string())
}
