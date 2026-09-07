use super::*;
use crate::{app::EventBus, index::AppState, semantic::SemanticState};
use std::{
    fs,
    path::PathBuf,
    sync::{mpsc, Arc, Barrier},
    thread,
    time::Duration,
};

struct TestCurrentContentItem {
    note_id: String,
    note_path: String,
}

impl CurrentContentItem for TestCurrentContentItem {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_> {
        CurrentContentIdentity::Note {
            note_id: Some(&self.note_id),
            note_path: Some(&self.note_path),
        }
    }
}

fn copy_file(source: &Path, destination: &Path) {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::copy(source, destination).unwrap();
}

// Each fixture step deliberately ends an Editing Window. Autosave/window
// coalescing tests use the production command directly in editing_window_capture.
fn save_retained_state(
    state: &AppState,
    title: String,
    markdown: String,
    path: Option<String>,
) -> Result<Option<crate::commands::NoteSession>, HistoryError> {
    let outcome = crate::commands::note_persistence::persist_note_session_with_outcome(
        state, title, markdown, path,
    )?;
    if let Some(session) = outcome.as_ref().filter(|s| s.commit_warning.is_none()) {
        if let Some(id) = &session.note_id {
            state
                .note_timeline()
                .finalize_editing_window(&NoteIdentity::new(id))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(outcome)
}

fn prepare_test_history(
    source: MutationSource,
    path: &Path,
    markdown: &str,
) -> PreparedHistoryIntent {
    crate::state::ensure_vault_scaffold(&crate::state::vault_root().expect("test vault root"))
        .expect("test vault scaffold");
    history_store::prepare_publication(
        &history_store::Store::for_test(),
        source,
        path,
        markdown,
        history_store::PublicationIntentKind::Create,
        None,
    )
    .expect("prepare test history intent")
}

// Included into this module so existing qualified test names and cfg behavior stay stable.
include!("tests/history_mode.rs");
include!("tests/administration.rs");
include!("tests/publication.rs");
include!("tests/observation_lifecycle.rs");
