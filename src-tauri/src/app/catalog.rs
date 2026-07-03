//! Note read-model facade.
//!
//! `NoteCatalog` provides one read-model keyed by note id and path. The
//! canonical write-side store remains [`crate::index::NotesIndex`] inside
//! the existing `AppState`; that index
//! already maintains both `entries: HashMap<PathBuf, IndexedNote>` and
//! `by_id: HashMap<String, PathBuf>`. Reimplementing storage here would
//! force a costly second copy on every save.
//!
//! Instead `NoteCatalog` is a thin facade over the Tauri-managed `AppState`
//! that exposes a stable, service-friendly API for read-only catalog
//! lookups (`path_for_id`, `id_for_path`, `summary`). Services depend on
//! this facade rather than reaching into `AppState` directly so the
//! storage layer can evolve independently.

use crate::index::AppState;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;

/// Lightweight summary of a note as exposed to service layers and the
/// frontend. Mirrors the fields needed by lists and pickers without
/// dragging the full paragraph/task vectors of `IndexedNote` around.
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct NoteSummary {
    pub note_id: String,
    pub path: PathBuf,
    pub title: String,
    pub file_name: String,
    pub modified_millis: u64,
}

/// Read-only catalog handle. The actual storage lives inside `AppState`
/// (see [`crate::index::NotesIndex`]). This struct is intentionally a
/// zero-sized marker so it can be cheaply stored inside [`super::AppData`]
/// without owning the index itself.
#[derive(Clone, Default)]
pub(crate) struct NoteCatalog;

#[allow(dead_code)]
impl NoteCatalog {
    pub(crate) fn new() -> Self {
        Self
    }

    /// Resolve a note id to its canonical path, falling back to `None` if
    /// the index has not seen the note yet (cold start, never opened).
    pub(crate) fn path_for_id(&self, app_state: &AppState, note_id: &str) -> Option<PathBuf> {
        app_state
            .notes_index
            .lock()
            .ok()
            .and_then(|index| index.path_for_note_id(note_id).cloned())
    }

    /// Reverse lookup: which note id, if any, is associated with this path.
    pub(crate) fn id_for_path(&self, app_state: &AppState, path: &Path) -> Option<String> {
        app_state
            .notes_index
            .lock()
            .ok()
            .and_then(|index| index.entries.get(path).map(|note| note.note_id.clone()))
    }

    /// Build a [`NoteSummary`] for a given path if known to the index.
    pub(crate) fn summary_for_path(
        &self,
        app_state: &AppState,
        path: &Path,
    ) -> Option<NoteSummary> {
        let index = app_state.notes_index.lock().ok()?;
        let note = index.entries.get(path)?;
        Some(NoteSummary {
            note_id: note.note_id.clone(),
            path: path.to_path_buf(),
            title: note.title.clone(),
            file_name: note.file_name.clone(),
            modified_millis: note.modified_millis,
        })
    }

    /// Convenience wrapper over `path_for_id` that uses a Tauri `State`.
    pub(crate) fn path_for_id_via_state(
        &self,
        state: &State<'_, Arc<AppState>>,
        note_id: &str,
    ) -> Option<PathBuf> {
        self.path_for_id(state.inner().as_ref(), note_id)
    }
}
