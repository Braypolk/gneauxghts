//! Authoritative task-document mutations.
//!
//! Toggle and delete share one pure Markdown transform. Clean documents commit
//! through the filesystem and post-commit note boundary; dirty documents can
//! prepare the same transform without writing any canonical or derived state.

use super::{
    note_mutation::{CommittedMutationWarning, PostCommitNoteMutationOutcome},
    PostCommitNoteMutationService,
};
use crate::{
    index::{
        delete_task_in_markdown, find_unambiguous_task_line, toggle_task_in_markdown, AppState,
    },
    state::{
        atomic_write_note,
        task_projection::{load_task_by_id, TaskRecord},
        validate_current_path,
    },
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TaskMutationKind {
    Toggle,
    Delete,
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
    pub(crate) commit_warning: Option<CommittedMutationWarning>,
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
    }
}

/// Cross-boundary body fingerprint: lowercase SHA-256 hex, matching
/// `crypto.subtle.digest("SHA-256", ...)` over UTF-8 bytes in the frontend.
pub(crate) fn task_document_hash(markdown: &str) -> String {
    format!("{:x}", Sha256::digest(markdown.as_bytes()))
}

trait TaskMutationSink {
    fn read_canonical(&self, path: &Path) -> Result<String, String>;
    fn write_canonical(&self, path: &Path, markdown: &str) -> Result<(), String>;
    fn synchronize(&self, path: PathBuf, markdown: String) -> PostCommitNoteMutationOutcome;
}

struct AppStateTaskMutationSink<'a> {
    state: &'a AppState,
}

impl TaskMutationSink for AppStateTaskMutationSink<'_> {
    fn read_canonical(&self, path: &Path) -> Result<String, String> {
        fs::read_to_string(path).map_err(|error| error.to_string())
    }

    fn write_canonical(&self, path: &Path, markdown: &str) -> Result<(), String> {
        write_task_document_atomically(path, markdown)
    }

    fn synchronize(&self, path: PathBuf, markdown: String) -> PostCommitNoteMutationOutcome {
        PostCommitNoteMutationService::new(self.state).apply_canonical_file(
            path.clone(),
            Some(path),
            markdown,
        )
    }
}

fn write_task_document_atomically(path: &Path, markdown: &str) -> Result<(), String> {
    let expected_write = crate::vault_watcher::record_expected_write(path, markdown);
    atomic_write_note(path, markdown.as_bytes())?;
    expected_write.commit();
    Ok(())
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
        commit_loaded_task(
            &AppStateTaskMutationSink { state: self.state },
            target,
            mutation_kind,
        )
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

fn commit_loaded_task(
    sink: &impl TaskMutationSink,
    target: TaskMutationTarget,
    mutation_kind: TaskMutationKind,
) -> Result<CommittedTaskMutation, String> {
    let markdown = sink.read_canonical(&target.note_path)?;
    let updated_markdown =
        transform_task_document(mutation_kind, &markdown, target.line_number, &target.text)?;
    sink.write_canonical(&target.note_path, &updated_markdown)?;

    let outcome = sink.synchronize(target.note_path.clone(), updated_markdown);
    outcome.report_degraded("task mutation");
    let commit_warning = outcome.required_consistency_warning();
    Ok(CommittedTaskMutation {
        note_id: outcome.note_id,
        note_path: target.note_path,
        commit_warning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::note_mutation::{PostCommitIssue, PostCommitStage};
    use std::cell::{Cell, RefCell};

    struct FakeSink {
        canonical: RefCell<String>,
        writes: Cell<usize>,
        outcome_issues: Vec<PostCommitIssue>,
    }

    impl FakeSink {
        fn new(markdown: &str, outcome_issues: Vec<PostCommitIssue>) -> Self {
            Self {
                canonical: RefCell::new(markdown.to_string()),
                writes: Cell::new(0),
                outcome_issues,
            }
        }
    }

    impl TaskMutationSink for FakeSink {
        fn read_canonical(&self, _path: &Path) -> Result<String, String> {
            Ok(self.canonical.borrow().clone())
        }

        fn write_canonical(&self, _path: &Path, markdown: &str) -> Result<(), String> {
            self.writes.set(self.writes.get() + 1);
            *self.canonical.borrow_mut() = markdown.to_string();
            Ok(())
        }

        fn synchronize(&self, path: PathBuf, markdown: String) -> PostCommitNoteMutationOutcome {
            PostCommitNoteMutationOutcome {
                note_id: "note-1".to_string(),
                path: path.clone(),
                canonical_markdown: markdown,
                issues: self.outcome_issues.clone(),
            }
        }
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
    fn pure_transform_matches_legacy_toggle_and_delete_behavior() {
        let markdown = "# Tasks\n\n- [ ] Ship it\n- [ ] Keep";
        for kind in [TaskMutationKind::Toggle, TaskMutationKind::Delete] {
            let actual = transform_task_document(kind, markdown, 3, "Ship it").unwrap();
            let expected = match kind {
                TaskMutationKind::Toggle => {
                    toggle_task_in_markdown(markdown, 3, "Ship it").unwrap()
                }
                TaskMutationKind::Delete => {
                    delete_task_in_markdown(markdown, 3, "Ship it").unwrap()
                }
            };
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
    fn dirty_preparation_tracks_a_unique_task_after_unsaved_line_changes() {
        let markdown = "new heading\n\n- [ ] Ship it";
        let prepared = prepare_loaded_task(
            target(),
            TaskMutationKind::Toggle,
            markdown,
            &task_document_hash(markdown),
        )
        .unwrap();

        assert_eq!(
            prepared.updated_editor_markdown,
            "new heading\n\n- [x] Ship it"
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
    fn task_document_hash_matches_web_crypto_sha256_vector() {
        assert_eq!(
            task_document_hash("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn clean_commit_writes_once_and_returns_authoritative_identity() {
        let sink = FakeSink::new("# Tasks\n\n- [ ] Ship it", Vec::new());
        let outcome = commit_loaded_task(&sink, target(), TaskMutationKind::Toggle).unwrap();

        assert_eq!(sink.writes.get(), 1);
        assert!(sink.canonical.borrow().contains("- [x] Ship it"));
        assert_eq!(outcome.note_id, "note-1");
        assert_eq!(outcome.note_path, PathBuf::from("/vault/Tasks.md"));
    }

    #[test]
    fn canonical_task_writer_atomically_replaces_the_existing_note() {
        let notes = crate::test_support::TestDir::new("task-canonical-write");
        let path = notes.path().join("Tasks.md");
        fs::write(&path, "- [ ] Ship it").unwrap();

        write_task_document_atomically(&path, "- [x] Ship it").unwrap();

        assert_eq!(fs::read_to_string(path).unwrap(), "- [x] Ship it");
    }

    #[test]
    fn required_failure_returns_committed_warning_after_one_write() {
        let sink = FakeSink::new(
            "# Tasks\n\n- [ ] Ship it",
            vec![PostCommitIssue {
                stage: PostCommitStage::TaskProjectionUpsert,
                message: "task database unavailable".to_string(),
            }],
        );
        let outcome = commit_loaded_task(&sink, target(), TaskMutationKind::Delete).unwrap();

        assert_eq!(sink.writes.get(), 1);
        assert!(!sink.canonical.borrow().contains("Ship it"));
        let warning = outcome.commit_warning.expect("committed warning");
        assert!(warning.message.contains("Canonical note file was saved"));
        assert_eq!(
            warning.issues[0].stage,
            PostCommitStage::TaskProjectionUpsert
        );
    }

    #[test]
    fn derived_failure_does_not_turn_a_committed_write_into_an_error() {
        let sink = FakeSink::new(
            "# Tasks\n\n- [ ] Ship it",
            vec![PostCommitIssue {
                stage: PostCommitStage::SemanticUpdate,
                message: "semantic queue unavailable".to_string(),
            }],
        );
        let outcome = commit_loaded_task(&sink, target(), TaskMutationKind::Toggle).unwrap();

        assert_eq!(sink.writes.get(), 1);
        assert_eq!(outcome.note_id, "note-1");
    }
}
