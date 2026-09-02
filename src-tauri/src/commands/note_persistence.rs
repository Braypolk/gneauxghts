use super::{prepare_notes_dir, NoteSession};
use crate::{
    index::AppState,
    note,
    services::note_timeline::{MutationSource, NoteMutation, NoteMutationWarning, NoteTimeline},
    state::{persist_note_with_preparation, validate_current_path},
};
use std::path::Path;

#[derive(Clone, Copy, Debug)]
enum NoteSaveSource {
    Editor,
    TaskAction,
}

#[derive(Clone, Debug)]
pub(crate) struct PersistNoteOutcome {
    pub(crate) session: Option<NoteSession>,
}

fn file_stem_title(path: Option<&str>) -> Option<String> {
    path.and_then(|raw_path| Path::new(raw_path).file_stem())
        .map(|stem| stem.to_string_lossy().into_owned())
}

fn build_saved_note_session(
    note_id: Option<String>,
    title: &str,
    markdown: &str,
    persisted_path: Option<String>,
    persisted_markdown: &str,
    commit_warning: Option<NoteMutationWarning>,
) -> NoteSession {
    let fallback_title = file_stem_title(persisted_path.as_deref()).unwrap_or_default();
    NoteSession {
        note_id,
        title: if fallback_title.is_empty() {
            title.trim().to_string()
        } else {
            fallback_title.clone()
        },
        markdown: if persisted_markdown.is_empty() {
            note::normalize_wikilink_markdown(markdown)
        } else {
            note::extract_file_name_title_and_body(persisted_markdown, &fallback_title).1
        },
        path: persisted_path,
        commit_warning,
    }
}

pub(crate) fn persist_note_session_with_outcome(
    state: &AppState,
    title: String,
    markdown: String,
    current_path: Option<String>,
) -> Result<PersistNoteOutcome, String> {
    persist_note_session_with_source(state, title, markdown, current_path, NoteSaveSource::Editor)
}

pub(crate) fn persist_task_note_session_with_outcome(
    state: &AppState,
    title: String,
    markdown: String,
    current_path: Option<String>,
) -> Result<PersistNoteOutcome, String> {
    persist_note_session_with_source(
        state,
        title,
        markdown,
        current_path,
        NoteSaveSource::TaskAction,
    )
}

fn persist_note_session_with_source(
    state: &AppState,
    title: String,
    markdown: String,
    current_path: Option<String>,
    save_source: NoteSaveSource,
) -> Result<PersistNoteOutcome, String> {
    // Save is a hot path; the throttled forgotten-note cleanup runs from
    // explicit forgotten-note commands and at startup instead.
    let notes_dir = prepare_notes_dir(false)?;
    let current_path = validate_current_path(current_path, &notes_dir)?;
    let is_note_creation = current_path.is_none();
    let source = if is_note_creation {
        MutationSource::NoteCreation
    } else {
        match save_source {
            NoteSaveSource::TaskAction => MutationSource::TaskAction,
            NoteSaveSource::Editor => MutationSource::Editor,
        }
    };
    let publication = persist_note_with_preparation(
        &notes_dir,
        &title,
        &markdown,
        current_path.as_deref(),
        |target_path, canonical| {
            NoteTimeline::new(state)
                .prepare_revision_publication(
                    source,
                    target_path,
                    current_path.as_deref(),
                    None,
                    canonical,
                )
                .map(|prepared| prepared.into_parts())
        },
        |path, persisted_markdown, history_intent| {
            let mutation = if is_note_creation {
                NoteMutation::note_creation(history_intent, path, None, persisted_markdown)
            } else {
                match save_source {
                    NoteSaveSource::TaskAction => NoteMutation::task_action(
                        history_intent,
                        path,
                        current_path.clone(),
                        persisted_markdown,
                    ),
                    NoteSaveSource::Editor => NoteMutation::editor(
                        history_intent,
                        path,
                        current_path.clone(),
                        persisted_markdown,
                    ),
                }
            };
            NoteTimeline::new(state).mutate(mutation)
        },
    )?;
    let (persisted_path, persisted_markdown, mutation_outcome) = publication
        .map(|(path, markdown, outcome)| (Some(path), markdown, Some(outcome)))
        .unwrap_or((None, markdown.clone(), None));

    let saved_note_id = mutation_outcome
        .as_ref()
        .map(|outcome| outcome.note_id().as_str().to_string());
    let commit_warning = mutation_outcome
        .as_ref()
        .and_then(|outcome| outcome.warning().cloned());

    let session = persisted_path.as_ref().map(|_| {
        build_saved_note_session(
            saved_note_id,
            &title,
            &persisted_markdown,
            persisted_path.clone(),
            mutation_outcome
                .as_ref()
                .map(|outcome| outcome.canonical_markdown())
                .unwrap_or(""),
            commit_warning.clone(),
        )
    });

    if let Some(outcome) = mutation_outcome.as_ref() {
        outcome.report_degraded("note persistence");
    }

    Ok(PersistNoteOutcome { session })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        app::EventBus, semantic::SemanticState, services::note_timeline::MutationWarningStage,
    };
    use std::panic::{catch_unwind, AssertUnwindSafe};

    #[test]
    fn committed_projection_failure_still_returns_authoritative_new_note_path() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("save-warning-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("save-warning-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let _ = catch_unwind(AssertUnwindSafe(|| {
            let _index = state.notes_index.lock().unwrap();
            panic!("poison notes index to force a post-commit catalog failure");
        }));

        let outcome = persist_note_session_with_outcome(
            &state,
            "Draft title".to_string(),
            "Draft body".to_string(),
            None,
        )
        .expect("canonical commit returns an outcome");
        let session = outcome.session.expect("saved session");
        let expected_path = notes.path().join("Draft title.md");

        assert_eq!(
            session.path.as_deref(),
            Some(expected_path.to_string_lossy().as_ref())
        );
        assert!(Path::new(session.path.as_deref().unwrap()).exists());
        let warning = session.commit_warning.expect("committed warning");
        assert!(warning
            .issues()
            .iter()
            .any(|issue| issue.stage() == MutationWarningStage::CatalogUpsert));
    }
}
