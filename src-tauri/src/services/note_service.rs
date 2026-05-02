//! Note application service.
//!
//! Wraps the existing `note_persistence` orchestration so callers route
//! through `NoteService::save` / `NoteService::open` instead of poking at
//! the persistence helpers directly. The service emits typed
//! [`AppEvent::NoteSaved`] events through [`EventBus`] when a save
//! completes so the frontend can listen for one canonical signal instead
//! of stitching together polling + per-feature reloads.

use crate::app::AppData;
use crate::commands::note_persistence::{
    persist_note_session_with_outcome, NotePersistenceMode, PersistNoteOutcome,
};
use crate::commands::{
    load_note_session_from_notes_dir_with_state, open_note_from_notes_dir_with_state, NoteSession,
};
use crate::index::AppState;
use crate::state::notes_root;
use std::fs;
use std::path::PathBuf;
use tauri::State;

pub(crate) struct NoteService;

impl NoteService {
    pub(crate) fn new() -> Self {
        Self
    }

    fn ensure_notes_dir() -> Result<PathBuf, String> {
        let notes_dir = notes_root()?;
        fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
        Ok(notes_dir)
    }

    pub(crate) fn load_session(
        &self,
        app_state: &State<'_, AppState>,
    ) -> Result<NoteSession, String> {
        let notes_dir = Self::ensure_notes_dir()?;
        load_note_session_from_notes_dir_with_state(&notes_dir, Some(app_state))
    }

    pub(crate) fn open(
        &self,
        app_state: &State<'_, AppState>,
        note_id: Option<String>,
        path: Option<String>,
    ) -> Result<NoteSession, String> {
        let notes_dir = Self::ensure_notes_dir()?;
        open_note_from_notes_dir_with_state(&notes_dir, note_id, path, Some(app_state))
    }

    pub(crate) fn save(
        &self,
        app_data: &AppData,
        app_state: &State<'_, AppState>,
        title: String,
        markdown: String,
        current_path: Option<String>,
    ) -> Result<NoteSession, String> {
        let outcome = persist_note_session_with_outcome(
            app_state,
            title.clone(),
            markdown,
            current_path,
            NotePersistenceMode::Save,
        )?;
        let session = outcome
            .session
            .clone()
            .ok_or_else(|| "Saved note session is missing".to_string())?;

        emit_note_saved(app_data, app_state, &outcome, &title);
        Ok(session)
    }

    pub(crate) fn remember(
        &self,
        app_data: &AppData,
        app_state: &State<'_, AppState>,
        title: String,
        markdown: String,
        current_path: Option<String>,
    ) -> Result<(), String> {
        let outcome = persist_note_session_with_outcome(
            app_state,
            title.clone(),
            markdown,
            current_path,
            NotePersistenceMode::Remember,
        )?;
        if outcome.persisted_path.is_some() {
            emit_note_saved(app_data, app_state, &outcome, &title);
        }
        Ok(())
    }
}

fn emit_note_saved(
    app_data: &AppData,
    app_state: &State<'_, AppState>,
    outcome: &PersistNoteOutcome,
    title: &str,
) {
    let path = outcome.persisted_path.clone();
    let note_id = outcome
        .session
        .as_ref()
        .and_then(|session| session.note_id.clone());

    let revision = app_state
        .notes_index
        .lock()
        .ok()
        .map(|index| index.revision())
        .unwrap_or(0);

    app_data
        .events
        .note_saved(note_id, path, title.to_string(), revision);
}
