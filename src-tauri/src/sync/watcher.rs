use super::{
    current_time_millis, get_tracked_note_by_path, open_database, VaultNoteChangeEvent,
    VAULT_NOTE_CHANGED_EVENT,
};
use crate::{
    index::{build_indexed_note, AppState},
    state::{is_forgotten_note_path, notes_root},
};
use notify::{event::ModifyKind, Event, EventKind};
use rusqlite::{params, Connection};
use std::{collections::HashSet, fs, path::Path};
use tauri::{AppHandle, Emitter, Manager};

pub(super) fn handle_watch_result(
    app_handle: &AppHandle,
    result: notify::Result<Event>,
) -> Result<(), String> {
    let event = match result {
        Ok(event) => event,
        Err(error) => return Err(error.to_string()),
    };
    if !should_process_watch_event(&event.kind) {
        return Ok(());
    }

    let notes_dir = notes_root()?;
    let Some(state) = app_handle.try_state::<AppState>() else {
        return Ok(());
    };
    let connection = open_database()?;
    let mut seen_paths = HashSet::new();

    for path in event.paths {
        if !seen_paths.insert(path.clone()) {
            continue;
        }
        if !is_watchable_markdown_path(&path) {
            continue;
        }
        handle_watched_path_change(app_handle, &connection, &state, &notes_dir, &path)?;
    }

    Ok(())
}

fn should_process_watch_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Name(_))
            | EventKind::Modify(ModifyKind::Any)
            | EventKind::Modify(ModifyKind::Metadata(_))
            | EventKind::Remove(_)
    )
}

fn is_watchable_markdown_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

fn handle_watched_path_change(
    app_handle: &AppHandle,
    connection: &Connection,
    state: &AppState,
    notes_dir: &Path,
    path: &Path,
) -> Result<(), String> {
    if path.exists() {
        let markdown = fs::read_to_string(path).map_err(|err| err.to_string())?;
        let deleted = is_forgotten_note_path(path, notes_dir);
        super::reconcile::import_local_note(connection, path, &markdown, deleted)?;
        let payload = VaultNoteChangeEvent {
            note_path: path.to_string_lossy().into_owned(),
            deleted,
        };

        if deleted {
            state.semantic.queue_delete_note(path)?;
            let mut index = state
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            index.remove_note(path);
        } else {
            let timestamp_millis = current_time_millis()?;
            let note = build_indexed_note(path, &markdown, timestamp_millis);
            {
                let mut index = state
                    .notes_index
                    .lock()
                    .map_err(|_| "Search index lock poisoned".to_string())?;
                index.upsert_note(path.to_path_buf(), note);
            }
            state
                .semantic
                .queue_note_update(path, markdown, timestamp_millis)?;
        }

        app_handle
            .emit(VAULT_NOTE_CHANGED_EVENT, payload)
            .map_err(|err| err.to_string())
    } else {
        if let Some(tracked_note) = get_tracked_note_by_path(connection, path)? {
            connection
                .execute(
                    "UPDATE tracked_notes
                     SET dirty = 1,
                         deleted = 1,
                         updated_at_millis = ?2
                     WHERE note_id = ?1",
                    params![tracked_note.note_id, current_time_millis()?],
                )
                .map_err(|err| err.to_string())?;
        }
        state.semantic.queue_delete_note(path)?;
        let mut index = state
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?;
        index.remove_note(path);
        app_handle
            .emit(
                VAULT_NOTE_CHANGED_EVENT,
                VaultNoteChangeEvent {
                    note_path: path.to_string_lossy().into_owned(),
                    deleted: true,
                },
            )
            .map_err(|err| err.to_string())
    }
}
