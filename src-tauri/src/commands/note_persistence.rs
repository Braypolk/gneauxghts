use super::NoteSession;
use crate::{
    index::AppState,
    note,
    services::note_timeline::{MutationSource, NoteMutationResult},
};
use std::path::Path;

fn file_stem_title(path: Option<&str>) -> Option<String> {
    path.and_then(|raw_path| Path::new(raw_path).file_stem())
        .map(|stem| stem.to_string_lossy().into_owned())
}

pub(crate) fn build_note_session_from_mutation(outcome: &NoteMutationResult) -> NoteSession {
    let path = outcome.path().to_string_lossy().into_owned();
    let title = file_stem_title(Some(&path)).unwrap_or_default();
    let tags = crate::tags::read_tags(outcome.canonical_markdown());
    NoteSession {
        tags: tags.clone().unwrap_or_default(),
        tags_error: tags.err(),
        note_id: Some(outcome.note_id().as_str().to_string()),
        markdown: note::extract_file_name_title_and_body(outcome.canonical_markdown(), &title).1,
        title,
        path: Some(path),
        commit_warning: outcome.warning().cloned(),
    }
}

pub(crate) fn persist_note_session_with_outcome(
    state: &AppState,
    title: String,
    markdown: String,
    current_path: Option<String>,
) -> Result<Option<NoteSession>, String> {
    persist_note_session_with_source(state, title, markdown, current_path, MutationSource::Editor)
}

pub(crate) fn persist_task_note_session_with_outcome(
    state: &AppState,
    title: String,
    markdown: String,
    current_path: Option<String>,
) -> Result<Option<NoteSession>, String> {
    persist_note_session_with_source(
        state,
        title,
        markdown,
        current_path,
        MutationSource::TaskAction,
    )
}

fn persist_note_session_with_source(
    state: &AppState,
    title: String,
    markdown: String,
    current_path: Option<String>,
    source: MutationSource,
) -> Result<Option<NoteSession>, String> {
    let outcome = state
        .note_timeline()
        .save_note(source, &title, &markdown, current_path)
        .map_err(|error| error.to_string())?;
    if let Some(outcome) = &outcome {
        outcome.report_degraded("note persistence");
    }
    Ok(outcome.as_ref().map(build_note_session_from_mutation))
}

pub(crate) fn persist_note_session_with_tags(
    state: &AppState,
    title: String,
    markdown: String,
    current_path: Option<String>,
    source: MutationSource,
    tags: &crate::tags::TagEdit,
) -> Result<Option<NoteSession>, String> {
    let outcome = state
        .note_timeline()
        .save_note_with_tags(source, &title, &markdown, current_path, Some(tags))
        .map_err(|error| error.to_string())?;
    if let Some(outcome) = &outcome {
        outcome.report_degraded("note persistence");
    }
    Ok(outcome.as_ref().map(build_note_session_from_mutation))
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
        let session = outcome.expect("saved session");
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
