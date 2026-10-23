use super::NoteSession;
use crate::{
    index::AppState,
    note,
    services::note_timeline::{MutationSource, NoteIdentity, NoteMutationResult},
};
use std::path::Path;

fn file_stem_title(path: Option<&str>) -> Option<String> {
    path.and_then(|raw_path| Path::new(raw_path).file_stem())
        .map(|stem| stem.to_string_lossy().into_owned())
}

pub(crate) fn build_note_session_from_mutation(outcome: &NoteMutationResult) -> NoteSession {
    let path = outcome.path().to_string_lossy().into_owned();
    let title = file_stem_title(Some(&path)).unwrap_or_default();
    let (title, markdown) =
        note::extract_file_name_title_and_body(outcome.canonical_markdown(), &title);
    let tags = crate::tags::read_tags(outcome.canonical_markdown());
    NoteSession {
        tags: tags.clone().unwrap_or_default(),
        tags_error: tags.err(),
        note_id: Some(outcome.note_id().as_str().to_string()),
        markdown,
        title,
        path: Some(path),
        commit_warning: outcome.warning().cloned(),
    }
}

#[cfg(test)]
pub(crate) fn persist_note_session_with_outcome(
    state: &AppState,
    title: String,
    markdown: String,
    current_path: Option<String>,
) -> Result<Option<NoteSession>, String> {
    persist_note_session_with_source(state, title, markdown, current_path, MutationSource::Editor)
}

#[cfg(test)]
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

#[cfg(test)]
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

/// A saved editor captures identity together with its path before waiting for
/// publication. The timeline checks that pair again under canonical ownership.
pub(crate) fn persist_note_session_with_expected_identity(
    state: &AppState,
    title: String,
    markdown: String,
    current_path: Option<String>,
    expected_note_id: Option<String>,
    source: MutationSource,
    tags: Option<&crate::tags::TagEdit>,
) -> Result<Option<NoteSession>, String> {
    let expected_identity = expected_note_id
        .map(|id| {
            if id.trim().is_empty() {
                Err("Saved note identity is empty".to_string())
            } else {
                Ok(NoteIdentity::new(id))
            }
        })
        .transpose()?;
    let outcome = state
        .note_timeline()
        .save_note_with_expected_identity(
            source,
            &title,
            &markdown,
            current_path,
            expected_identity.as_ref(),
            tags,
        )
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
    fn ordinary_capture_uses_first_line_and_explicit_title_without_inference() {
        let vault = crate::test_support::TestVault::new("ordinary-note-naming");
        let saved = persist_note_session_with_outcome(
            &vault.state,
            String::new(),
            "Garden watering plan\n\nCollect rainwater for tomatoes.".into(),
            None,
        )
        .unwrap()
        .unwrap();
        assert_eq!(saved.title, "Garden watering plan");
        assert!(saved
            .path
            .as_ref()
            .unwrap()
            .ends_with("Garden watering plan.md"));
        assert!(saved.markdown.contains("Collect rainwater"));
        let renamed = persist_note_session_with_outcome(
            &vault.state,
            "Summer garden".into(),
            saved.markdown,
            saved.path.clone(),
        )
        .unwrap()
        .unwrap();
        assert_eq!(renamed.title, "Summer garden");
        assert_eq!(renamed.note_id, saved.note_id);
        assert!(renamed.path.unwrap().ends_with("Summer garden.md"));
        assert!(!Path::new(&saved.path.unwrap()).exists());
    }

    #[test]
    fn retired_blank_title_capture_is_readable_and_uses_ordinary_naming_on_save() {
        let vault = crate::test_support::TestVault::new("retired-blank-title");
        let path = vault.notes.path().join("Untitled Note retired-capture.md");
        let raw = "---\ngneauxghts:\n  id: retired-capture\n  created_at: 2026-10-22T00:00:00Z\n  updated_at: 2026-10-22T00:00:00Z\n  untitled: true\n---\n\nKeep this recovered idea";
        std::fs::write(&path, raw).unwrap();
        let (title, markdown) =
            note::extract_file_name_title_and_body(raw, "Untitled Note retired-capture");
        assert_eq!(title, "");
        let saved = persist_note_session_with_outcome(
            &vault.state,
            title,
            markdown,
            Some(path.to_string_lossy().into_owned()),
        )
        .unwrap()
        .unwrap();
        assert_eq!(saved.title, "Keep this recovered idea");
        assert_eq!(saved.note_id.as_deref(), Some("retired-capture"));
        assert!(!path.exists());
        let canonical = std::fs::read_to_string(saved.path.unwrap()).unwrap();
        assert!(
            !note::parse_note(&canonical)
                .frontmatter
                .managed
                .unwrap()
                .untitled
        );
    }

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
