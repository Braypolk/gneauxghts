//! Authoritative task-document mutations.
//!
//! Toggle and delete share one pure Markdown transform. Clean documents commit
//! through the filesystem and post-commit note boundary; dirty documents can
//! prepare the same transform without writing any canonical or derived state.

use super::note_timeline::{MutationSource, NoteIdentity, NoteMutationWarning};
use crate::{
    index::{
        delete_task_in_markdown, find_unambiguous_task_line, toggle_task_in_markdown, AppState,
    },
    state::{
        task_projection::{load_task_by_id, TaskRecord},
        validate_current_path,
    },
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum TaskMutationKind {
    Toggle,
    Delete,
    SetDueDate { due_date: Option<String> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedTaskDocumentMutation {
    pub(crate) task_id: String,
    pub(crate) note_id: String,
    pub(crate) note_path: String,
    pub(crate) base_hash: String,
    pub(crate) updated_editor_markdown: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CommittedTaskMutation {
    pub(crate) note_id: String,
    pub(crate) note_path: PathBuf,
    pub(crate) commit_warning: Option<NoteMutationWarning>,
}

#[derive(Clone, Debug)]
struct TaskMutationTarget {
    task_id: String,
    note_id: String,
    note_path: PathBuf,
    line_number: usize,
    text: String,
}

impl From<TaskRecord> for TaskMutationTarget {
    fn from(task: TaskRecord) -> Self {
        Self {
            task_id: task.task_id,
            note_id: task.note_id,
            note_path: PathBuf::from(task.note_path),
            line_number: task.line_number,
            text: task.text,
        }
    }
}

pub(crate) fn transform_task_document(
    mutation_kind: TaskMutationKind,
    markdown: &str,
    line_number: usize,
    task_text: &str,
) -> Result<String, String> {
    match mutation_kind {
        TaskMutationKind::Toggle => toggle_task_in_markdown(markdown, line_number, task_text),
        TaskMutationKind::Delete => delete_task_in_markdown(markdown, line_number, task_text),
        TaskMutationKind::SetDueDate { due_date } => super::task_dates::set_due_date_in_markdown(
            markdown,
            line_number,
            task_text,
            due_date.as_deref(),
        ),
    }
}

/// Cross-boundary body fingerprint: lowercase SHA-256 hex, matching
/// `crypto.subtle.digest("SHA-256", ...)` over UTF-8 bytes in the frontend.
pub(crate) fn task_document_hash(markdown: &str) -> String {
    format!("{:x}", Sha256::digest(markdown.as_bytes()))
}

pub(crate) struct TaskMutationService<'a> {
    state: &'a AppState,
}

impl<'a> TaskMutationService<'a> {
    pub(crate) fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub(crate) fn commit(
        &self,
        notes_dir: &Path,
        task_id: &str,
        mutation_kind: TaskMutationKind,
    ) -> Result<CommittedTaskMutation, String> {
        let target = load_task_target(task_id)?;
        let note_path = validate_current_path(
            Some(target.note_path.to_string_lossy().into_owned()),
            notes_dir,
        )?
        .ok_or_else(|| "Missing note path".to_string())?;
        let target = TaskMutationTarget {
            note_path,
            ..target
        };
        let outcome = self.state.note_timeline().edit_note(
            MutationSource::TaskAction,
            &target.note_path,
            Some(&NoteIdentity::new(&target.note_id)),
            |markdown| {
                transform_task_document(mutation_kind, markdown, target.line_number, &target.text)
                    .map_err(Into::into)
            },
        )?;
        outcome.report_degraded("task mutation");
        Ok(CommittedTaskMutation {
            note_id: outcome.note_id().as_str().to_string(),
            note_path: target.note_path,
            commit_warning: outcome.warning().cloned(),
        })
    }

    pub(crate) fn prepare(
        notes_dir: &Path,
        task_id: &str,
        mutation_kind: TaskMutationKind,
        working_markdown: &str,
        body_hash: &str,
    ) -> Result<PreparedTaskDocumentMutation, String> {
        let mut target = load_task_target(task_id)?;
        target.note_path = validate_current_path(
            Some(target.note_path.to_string_lossy().into_owned()),
            notes_dir,
        )?
        .ok_or_else(|| "Missing note path".to_string())?;
        prepare_loaded_task(target, mutation_kind, working_markdown, body_hash)
    }
}

fn load_task_target(task_id: &str) -> Result<TaskMutationTarget, String> {
    load_task_by_id(task_id)?
        .map(TaskMutationTarget::from)
        .ok_or_else(|| "Task not found".to_string())
}

fn prepare_loaded_task(
    target: TaskMutationTarget,
    mutation_kind: TaskMutationKind,
    working_markdown: &str,
    body_hash: &str,
) -> Result<PreparedTaskDocumentMutation, String> {
    let actual_hash = task_document_hash(working_markdown);
    if actual_hash != body_hash {
        return Err("Working document hash does not match its Markdown".to_string());
    }
    let unambiguous_line = find_unambiguous_task_line(working_markdown, &target.text)?;
    let updated_editor_markdown = transform_task_document(
        mutation_kind,
        working_markdown,
        unambiguous_line,
        &target.text,
    )?;
    Ok(PreparedTaskDocumentMutation {
        task_id: target.task_id,
        note_id: target.note_id,
        note_path: target.note_path.to_string_lossy().into_owned(),
        base_hash: actual_hash,
        updated_editor_markdown,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::note_timeline::MutationWarningStage;
    use std::fs;
    fn seed_task(fixture: &crate::test_support::TestVault, markdown: &str) -> TaskRecord {
        let saved = crate::test_support::save_and_finalize(
            &fixture.state,
            "Tasks".into(),
            markdown.into(),
            None,
        )
        .unwrap()
        .unwrap();
        crate::state::task_projection::load_tasks_for_note_id(saved.note_id.as_deref().unwrap())
            .unwrap()
            .remove(0)
    }

    fn target() -> TaskMutationTarget {
        TaskMutationTarget {
            task_id: "task-1".to_string(),
            note_id: "note-1".to_string(),
            note_path: PathBuf::from("/vault/Tasks.md"),
            line_number: 3,
            text: "Ship it".to_string(),
        }
    }

    #[test]
    fn pure_transform_dispatches_each_mutation_kind() {
        let markdown = "# Tasks\n\n- [ ] Ship it\n- [ ] Keep";
        for (kind, expected) in [
            (
                TaskMutationKind::Toggle,
                "# Tasks\n\n- [x] Ship it\n- [ ] Keep",
            ),
            (TaskMutationKind::Delete, "# Tasks\n\n- [ ] Keep"),
            (
                TaskMutationKind::SetDueDate {
                    due_date: Some("2026-10-02".into()),
                },
                "# Tasks\n\n- [ ] Ship it due @due(2026-10-02)\n- [ ] Keep",
            ),
        ] {
            let actual = transform_task_document(kind, markdown, 3, "Ship it").unwrap();
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn preparation_is_non_writing_and_verifies_the_supplied_body_hash() {
        let markdown = "- [ ] Ship it";
        let target = target();
        let prepared = prepare_loaded_task(
            target.clone(),
            TaskMutationKind::Toggle,
            markdown,
            &task_document_hash(markdown),
        )
        .unwrap();
        assert_eq!(prepared.task_id, target.task_id);
        assert_eq!(prepared.note_id, target.note_id);
        assert_eq!(prepared.note_path, "/vault/Tasks.md");
        assert_eq!(prepared.base_hash, task_document_hash(markdown));
        assert!(prepared.updated_editor_markdown.contains("- [x] Ship it"));
        assert_eq!(
            prepare_loaded_task(target, TaskMutationKind::Toggle, markdown, "stale-hash",)
                .unwrap_err(),
            "Working document hash does not match its Markdown"
        );
    }

    #[test]
    fn dirty_preparation_rejects_duplicate_task_text_instead_of_guessing_by_stale_line() {
        let markdown = "- [ ] Ship it\nnew line\n- [ ] Ship it";
        let error = prepare_loaded_task(
            target(),
            TaskMutationKind::Toggle,
            markdown,
            &task_document_hash(markdown),
        )
        .unwrap_err();

        assert!(error.contains("ambiguous"));
    }

    #[test]
    fn service_preparation_reads_projection_but_does_not_write_file_or_projection() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("task-prepare-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("task-prepare-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let path = notes.path().join("Tasks.md");
        let canonical_markdown = "# Tasks\n\n- [ ] Ship it";
        let working_markdown = "- [ ] Ship it";
        fs::write(&path, canonical_markdown).unwrap();
        let indexed = crate::index::build_indexed_note(&path, canonical_markdown, 42);
        let projection = crate::state::task_projection::reconcile_note_tasks(
            &path,
            Some(&indexed),
            &indexed.note_id,
            42,
        )
        .unwrap();
        let task = projection.tasks.first().expect("projected task");

        let prepared = TaskMutationService::prepare(
            notes.path(),
            &task.task_id,
            TaskMutationKind::Toggle,
            working_markdown,
            &task_document_hash(working_markdown),
        )
        .unwrap();

        assert!(prepared.updated_editor_markdown.contains("- [x] Ship it"));
        assert_eq!(fs::read_to_string(&path).unwrap(), canonical_markdown);
        let unchanged = load_task_by_id(&task.task_id)
            .unwrap()
            .expect("task remains");
        assert!(!unchanged.completed);
    }

    #[test]
    fn due_preparation_and_commit_share_the_authoritative_transform() {
        let working = "- [ ] Ship it\n  - [ ] Child @due(2026-10-01)\n";
        let prepared = prepare_loaded_task(
            target(),
            TaskMutationKind::SetDueDate {
                due_date: Some("2026-10-02".into()),
            },
            working,
            &task_document_hash(working),
        )
        .unwrap();
        assert_eq!(
            prepared.updated_editor_markdown,
            "- [ ] Ship it due @due(2026-10-02)\n  - [ ] Child @due(2026-10-01)\n"
        );
        let fixture = crate::test_support::TestVault::new("task-due-commit");
        let task = seed_task(&fixture, working);
        let committed = TaskMutationService::new(&fixture.state)
            .commit(
                fixture.notes.path(),
                &task.task_id,
                TaskMutationKind::SetDueDate {
                    due_date: Some("2026-10-02".into()),
                },
            )
            .unwrap();
        let canonical = fs::read_to_string(committed.note_path).unwrap();
        assert_eq!(
            crate::note::parse_note(&canonical).body,
            prepared.updated_editor_markdown
        );
        assert_eq!(
            serde_json::to_value(TaskMutationKind::SetDueDate {
                due_date: Some("2026-10-02".into())
            })
            .unwrap(),
            serde_json::json!({"setDueDate": {"dueDate": "2026-10-02"}})
        );
    }

    #[test]
    fn task_document_hash_matches_web_crypto_sha256_vector() {
        assert_eq!(
            task_document_hash("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn clean_commit_returns_authoritative_identity_and_immediate_task_projection() {
        let fixture = crate::test_support::TestVault::new("task-clean-commit");
        let task = seed_task(&fixture, "- [ ] Ship it");
        let outcome = TaskMutationService::new(&fixture.state)
            .commit(
                fixture.notes.path(),
                &task.task_id,
                TaskMutationKind::Toggle,
            )
            .unwrap();
        assert_eq!(outcome.note_id, task.note_id);
        assert_eq!(outcome.note_path, PathBuf::from(&task.note_path));
        assert!(fs::read_to_string(&outcome.note_path)
            .unwrap()
            .contains("- [x] Ship it"));
        assert!(load_task_by_id(&task.task_id).unwrap().unwrap().completed);
    }

    #[test]
    fn failed_task_publication_abandons_its_history_intent_immediately() {
        let fixture = crate::test_support::TestVault::new("task-publication-fault");
        let task = seed_task(&fixture, "- [ ] Ship it");
        let before = fs::read(&task.note_path).unwrap();
        crate::state::inject_note_publication_failure_once();
        let error = TaskMutationService::new(&fixture.state)
            .commit(
                fixture.notes.path(),
                &task.task_id,
                TaskMutationKind::Toggle,
            )
            .unwrap_err();
        assert!(error.contains("injected note publication failure"));
        assert_eq!(fs::read(&task.note_path).unwrap(), before);
        assert!(!load_task_by_id(&task.task_id).unwrap().unwrap().completed);
        assert_eq!(
            crate::services::note_timeline::prepared_history_intent_count_for_test("prepared"),
            0
        );
    }

    #[test]
    fn history_failure_returns_committed_warning_without_repeating_the_task_action() {
        let fixture = crate::test_support::TestVault::new("task-committed-warning");
        let task = seed_task(&fixture, "- [ ] Ship it");
        crate::services::note_timeline::inject_history_finalization_failure_once();
        let outcome = TaskMutationService::new(&fixture.state)
            .commit(
                fixture.notes.path(),
                &task.task_id,
                TaskMutationKind::Toggle,
            )
            .unwrap();
        assert!(fs::read_to_string(&outcome.note_path)
            .unwrap()
            .contains("- [x] Ship it"));
        assert!(load_task_by_id(&task.task_id).unwrap().unwrap().completed);
        assert!(outcome
            .commit_warning
            .unwrap()
            .issues()
            .iter()
            .any(|issue| issue.stage() == MutationWarningStage::HistoryFinalization));
        fixture
            .state
            .note_timeline()
            .await_history_readiness(&NoteIdentity::new(&task.note_id))
            .unwrap();
        assert!(fs::read_to_string(&outcome.note_path)
            .unwrap()
            .contains("- [x] Ship it"));
    }
}
