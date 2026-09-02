//! Private post-publication coordination for authoritative ordinary-note mutations.
//!
//! `NoteTimeline` enters this helper only after canonical bytes exist on disk. From
//! that point onward failures are reported as committed-but-degraded projection
//! state; each caller decides whether its public contract must surface a
//! required read-your-writes synchronization failure.

use crate::index::{build_indexed_note, AppState, IndexedNote};
use crate::services::{note_catalog::PublicationCatalogOutcome, NoteCatalog};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum PublicationStage {
    CanonicalRead,
    CatalogUpsert,
    TaskProjectionUpsert,
    CatalogRemove,
    TaskProjectionRemove,
    SemanticUpdate,
    SemanticMove,
    DirtyRecovery,
    Revision,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PublicationIssue {
    pub(super) stage: PublicationStage,
    pub(super) message: String,
}

/// A canonical write succeeded, but one or more required read-your-write
/// projections did not. Commands return this warning as data so callers must
/// not retry the canonical mutation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CommittedMutationWarning {
    pub(super) message: String,
    pub(super) issues: Vec<PublicationIssue>,
}

#[derive(Clone, Debug)]
pub(super) struct PublicationOutcome {
    pub(super) note_id: String,
    pub(super) path: PathBuf,
    pub(super) canonical_markdown: String,
    pub(super) issues: Vec<PublicationIssue>,
}

impl PublicationOutcome {
    pub(super) fn record_issue(&mut self, stage: PublicationStage, message: String) {
        self.issues.push(PublicationIssue { stage, message });
    }

    pub(super) fn required_consistency_warning(&self) -> Option<CommittedMutationWarning> {
        let required_issues = self
            .issues
            .iter()
            .filter(|issue| issue.stage.is_required_consistency())
            .cloned()
            .collect::<Vec<_>>();
        if required_issues.is_empty() {
            return None;
        }
        let details = required_issues
            .iter()
            .map(|issue| format!("{:?}: {}", issue.stage, issue.message))
            .collect::<Vec<_>>()
            .join("; ");
        Some(CommittedMutationWarning {
            message: format!(
                "Canonical note file was saved at {}, but required catalog/task synchronization is incomplete: {}",
                self.path.display(),
                details
            ),
            issues: required_issues,
        })
    }
}

impl PublicationStage {
    fn is_required_consistency(self) -> bool {
        matches!(
            self,
            Self::CanonicalRead
                | Self::CatalogUpsert
                | Self::TaskProjectionUpsert
                | Self::CatalogRemove
                | Self::TaskProjectionRemove
        )
    }
}

#[derive(Clone)]
struct CommittedNoteMutation {
    path: PathBuf,
    previous_path: Option<PathBuf>,
    markdown: String,
    modified_millis: u64,
}

trait PublicationSink {
    fn catalog_upsert(&self, path: PathBuf, note: IndexedNote) -> PublicationCatalogOutcome;
    fn catalog_remove(&self, path: &Path) -> PublicationCatalogOutcome;
    fn clear_dirty(&self, path: &Path) -> Result<(), String>;
    fn mark_dirty(&self, path: &Path, source: &str) -> Result<(), String>;
    fn semantic_update(
        &self,
        path: &Path,
        markdown: String,
        modified_millis: u64,
    ) -> Result<(), String>;
    fn semantic_move(
        &self,
        old_path: &Path,
        new_path: &Path,
        markdown: String,
        modified_millis: u64,
    ) -> Result<(), String>;
    fn revision(&self) -> Result<u64, String>;
    fn emit_note_saved(&self, note_id: String, path: &Path, title: String, revision: u64);
}

struct AppStatePublicationSink<'a> {
    state: &'a AppState,
}

impl PublicationSink for AppStatePublicationSink<'_> {
    fn catalog_upsert(&self, path: PathBuf, note: IndexedNote) -> PublicationCatalogOutcome {
        NoteCatalog::new(
            &self.state.notes_index,
            &self.state.lexical,
            &self.state.background_index_queue,
        )
        .synchronize_published_upsert(path, note)
    }

    fn catalog_remove(&self, path: &Path) -> PublicationCatalogOutcome {
        NoteCatalog::new(
            &self.state.notes_index,
            &self.state.lexical,
            &self.state.background_index_queue,
        )
        .synchronize_published_remove(path)
    }

    fn clear_dirty(&self, path: &Path) -> Result<(), String> {
        self.state.clear_notes_index_dirty(path)
    }

    fn mark_dirty(&self, path: &Path, source: &str) -> Result<(), String> {
        self.state.mark_notes_index_dirty(path, source)
    }

    fn semantic_update(
        &self,
        path: &Path,
        markdown: String,
        modified_millis: u64,
    ) -> Result<(), String> {
        self.state
            .semantic
            .queue_note_update(path, markdown, modified_millis)
    }

    fn semantic_move(
        &self,
        old_path: &Path,
        new_path: &Path,
        markdown: String,
        modified_millis: u64,
    ) -> Result<(), String> {
        self.state
            .semantic
            .queue_note_move(old_path, new_path, markdown, modified_millis)
    }

    fn revision(&self) -> Result<u64, String> {
        self.state
            .notes_index
            .lock()
            .map(|index| index.revision())
            .map_err(|_| "Search index lock poisoned".to_string())
    }

    fn emit_note_saved(&self, note_id: String, path: &Path, title: String, revision: u64) {
        self.state.events.note_saved(
            Some(note_id),
            Some(path.to_string_lossy().into_owned()),
            title,
            revision,
        );
    }
}

/// Synchronize a canonical file after its publication has committed. A read
/// failure uses the caller's last-known Markdown as a recovery snapshot and is
/// explicitly reported in the returned degraded outcome. This function is a
/// private implementation detail of `NoteTimeline::mutate`.
pub(super) fn synchronize_canonical_file(
    state: &AppState,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    fallback_markdown: String,
) -> PublicationOutcome {
    let sink = AppStatePublicationSink { state };
    let (markdown, read_error) = match fs::read_to_string(&path) {
        Ok(markdown) => (markdown, None),
        Err(error) => (fallback_markdown, Some(error.to_string())),
    };
    let mutation = CommittedNoteMutation {
        path,
        previous_path,
        markdown,
        modified_millis: crate::time::current_time_millis().unwrap_or(0),
    };
    let mut outcome = synchronize_committed_mutation(&sink, mutation);
    if let Some(error) = read_error {
        outcome.record_issue(PublicationStage::CanonicalRead, error);
        if let Err(recovery_error) = sink.mark_dirty(&outcome.path, "timeline-canonical-read") {
            outcome.record_issue(PublicationStage::DirtyRecovery, recovery_error);
        }
    }
    outcome
}

fn synchronize_committed_mutation(
    sink: &impl PublicationSink,
    mutation: CommittedNoteMutation,
) -> PublicationOutcome {
    let moved_from = mutation
        .previous_path
        .as_deref()
        .filter(|previous| *previous != mutation.path.as_path());
    let indexed_note =
        build_indexed_note(&mutation.path, &mutation.markdown, mutation.modified_millis);
    let note_id = indexed_note.note_id.clone();
    let title = indexed_note.title.clone();
    let mut issues = Vec::new();

    let upsert = sink.catalog_upsert(mutation.path.clone(), indexed_note);
    collect_catalog_issues(
        &mut issues,
        upsert,
        PublicationStage::CatalogUpsert,
        PublicationStage::TaskProjectionUpsert,
    );
    if issues.iter().any(|issue| {
        matches!(
            issue.stage,
            PublicationStage::CatalogUpsert | PublicationStage::TaskProjectionUpsert
        )
    }) {
        if let Err(error) = sink.mark_dirty(&mutation.path, "timeline-publication-upsert") {
            issues.push(PublicationIssue {
                stage: PublicationStage::DirtyRecovery,
                message: error,
            });
        }
    } else if let Err(error) = sink.clear_dirty(&mutation.path) {
        issues.push(PublicationIssue {
            stage: PublicationStage::DirtyRecovery,
            message: error,
        });
    }

    if let Some(previous_path) = moved_from {
        let before_remove_count = issues.len();
        let removal = sink.catalog_remove(previous_path);
        collect_catalog_issues(
            &mut issues,
            removal,
            PublicationStage::CatalogRemove,
            PublicationStage::TaskProjectionRemove,
        );
        if issues.len() > before_remove_count {
            if let Err(error) = sink.mark_dirty(previous_path, "timeline-publication-remove") {
                issues.push(PublicationIssue {
                    stage: PublicationStage::DirtyRecovery,
                    message: error,
                });
            }
        } else if let Err(error) = sink.clear_dirty(previous_path) {
            issues.push(PublicationIssue {
                stage: PublicationStage::DirtyRecovery,
                message: error,
            });
        }
        if let Err(error) = sink.semantic_move(
            previous_path,
            &mutation.path,
            mutation.markdown.clone(),
            mutation.modified_millis,
        ) {
            issues.push(PublicationIssue {
                stage: PublicationStage::SemanticMove,
                message: error,
            });
        }
    } else if let Err(error) = sink.semantic_update(
        &mutation.path,
        mutation.markdown.clone(),
        mutation.modified_millis,
    ) {
        issues.push(PublicationIssue {
            stage: PublicationStage::SemanticUpdate,
            message: error,
        });
    }

    let revision = match sink.revision() {
        Ok(revision) => revision,
        Err(error) => {
            issues.push(PublicationIssue {
                stage: PublicationStage::Revision,
                message: error,
            });
            0
        }
    };
    sink.emit_note_saved(note_id.clone(), &mutation.path, title.clone(), revision);

    PublicationOutcome {
        note_id,
        path: mutation.path,
        canonical_markdown: mutation.markdown,
        issues,
    }
}

fn collect_catalog_issues(
    issues: &mut Vec<PublicationIssue>,
    outcome: PublicationCatalogOutcome,
    catalog_stage: PublicationStage,
    task_stage: PublicationStage,
) {
    if let Some(message) = outcome.catalog_error {
        issues.push(PublicationIssue {
            stage: catalog_stage,
            message,
        });
    }
    if let Some(message) = outcome.task_projection_error {
        issues.push(PublicationIssue {
            stage: task_stage,
            message,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::VecDeque};

    #[derive(Default)]
    struct FakeSink {
        calls: RefCell<Vec<String>>,
        catalog_results: RefCell<VecDeque<PublicationCatalogOutcome>>,
        semantic_error: RefCell<Option<String>>,
        revision: u64,
    }

    impl FakeSink {
        fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl PublicationSink for FakeSink {
        fn catalog_upsert(&self, path: PathBuf, _note: IndexedNote) -> PublicationCatalogOutcome {
            self.calls
                .borrow_mut()
                .push(format!("upsert:{}", path.display()));
            self.catalog_results
                .borrow_mut()
                .pop_front()
                .unwrap_or_default()
        }

        fn catalog_remove(&self, path: &Path) -> PublicationCatalogOutcome {
            self.calls
                .borrow_mut()
                .push(format!("remove:{}", path.display()));
            self.catalog_results
                .borrow_mut()
                .pop_front()
                .unwrap_or_default()
        }

        fn clear_dirty(&self, path: &Path) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(format!("clear:{}", path.display()));
            Ok(())
        }

        fn mark_dirty(&self, path: &Path, _source: &str) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(format!("dirty:{}", path.display()));
            Ok(())
        }

        fn semantic_update(
            &self,
            path: &Path,
            _markdown: String,
            _modified_millis: u64,
        ) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(format!("semantic-update:{}", path.display()));
            self.semantic_error.borrow_mut().take().map_or(Ok(()), Err)
        }

        fn semantic_move(
            &self,
            old_path: &Path,
            new_path: &Path,
            _markdown: String,
            _modified_millis: u64,
        ) -> Result<(), String> {
            self.calls.borrow_mut().push(format!(
                "semantic-move:{}->{}",
                old_path.display(),
                new_path.display()
            ));
            self.semantic_error.borrow_mut().take().map_or(Ok(()), Err)
        }

        fn revision(&self) -> Result<u64, String> {
            Ok(self.revision)
        }

        fn emit_note_saved(&self, _note_id: String, path: &Path, _title: String, revision: u64) {
            self.calls
                .borrow_mut()
                .push(format!("event:{}:{revision}", path.display()));
        }
    }

    fn mutation(path: &str, previous_path: Option<&str>) -> CommittedNoteMutation {
        CommittedNoteMutation {
            path: PathBuf::from(path),
            previous_path: previous_path.map(PathBuf::from),
            markdown: "---\ngneauxghts:\n  id: note-1\n  kind: note\n---\n\n# Note\n\n- [ ] task"
                .to_string(),
            modified_millis: 42,
        }
    }

    #[test]
    fn create_and_update_apply_one_upsert_without_a_remove() {
        let cases = [
            mutation("/vault/Note.md", None),
            mutation("/vault/Note.md", Some("/vault/Note.md")),
        ];

        for mutation in cases {
            let sink = FakeSink {
                revision: 7,
                ..FakeSink::default()
            };
            let outcome = synchronize_committed_mutation(&sink, mutation);
            assert!(outcome.issues.is_empty());
            assert_eq!(
                sink.calls(),
                vec![
                    "upsert:/vault/Note.md",
                    "clear:/vault/Note.md",
                    "semantic-update:/vault/Note.md",
                    "event:/vault/Note.md:7",
                ]
            );
        }
    }

    #[test]
    fn move_removes_the_previous_path_and_queues_one_semantic_move() {
        let sink = FakeSink {
            revision: 9,
            ..FakeSink::default()
        };
        synchronize_committed_mutation(&sink, mutation("/vault/Renamed.md", Some("/vault/Old.md")));
        assert_eq!(
            sink.calls(),
            vec![
                "upsert:/vault/Renamed.md",
                "clear:/vault/Renamed.md",
                "remove:/vault/Old.md",
                "clear:/vault/Old.md",
                "semantic-move:/vault/Old.md->/vault/Renamed.md",
                "event:/vault/Renamed.md:9",
            ]
        );
    }

    #[test]
    fn required_and_derived_failures_remain_distinguishable_after_commit() {
        let sink = FakeSink {
            catalog_results: RefCell::new(VecDeque::from([PublicationCatalogOutcome {
                catalog_error: None,
                task_projection_error: Some("tasks unavailable".to_string()),
            }])),
            semantic_error: RefCell::new(Some("semantic queue unavailable".to_string())),
            revision: 11,
            ..FakeSink::default()
        };
        let outcome = synchronize_committed_mutation(&sink, mutation("/vault/Note.md", None));

        assert!(!outcome.issues.is_empty());
        assert!(outcome
            .issues
            .iter()
            .any(|issue| issue.stage == PublicationStage::TaskProjectionUpsert));
        assert!(outcome
            .issues
            .iter()
            .any(|issue| issue.stage == PublicationStage::SemanticUpdate));
        assert!(sink.calls().contains(&"dirty:/vault/Note.md".to_string()));
        assert!(sink
            .calls()
            .contains(&"event:/vault/Note.md:11".to_string()));
        let warning = outcome
            .required_consistency_warning()
            .expect("task projection failure is required");
        assert!(warning.message.starts_with(
            "Canonical note file was saved at /vault/Note.md, but required catalog/task synchronization is incomplete"
        ));
        assert!(warning
            .message
            .contains("TaskProjectionUpsert: tasks unavailable"));
        assert!(!warning.message.contains("semantic queue unavailable"));
        assert_eq!(warning.issues.len(), 1);
        assert_eq!(
            warning.issues[0].stage,
            PublicationStage::TaskProjectionUpsert
        );
    }

    #[test]
    fn derived_failures_do_not_fail_required_consistency_policy() {
        let sink = FakeSink {
            semantic_error: RefCell::new(Some("semantic queue unavailable".to_string())),
            revision: 13,
            ..FakeSink::default()
        };
        let outcome = synchronize_committed_mutation(&sink, mutation("/vault/Note.md", None));

        assert!(!outcome.issues.is_empty());
        assert!(outcome
            .issues
            .iter()
            .any(|issue| issue.stage == PublicationStage::SemanticUpdate));
        assert_eq!(outcome.required_consistency_warning(), None);
    }

    #[test]
    fn canonical_read_failure_is_required_even_with_a_fallback_catalog_snapshot() {
        let sink = FakeSink {
            revision: 17,
            ..FakeSink::default()
        };
        let mut outcome = synchronize_committed_mutation(&sink, mutation("/vault/Note.md", None));
        outcome.record_issue(
            PublicationStage::CanonicalRead,
            "canonical bytes unavailable".to_string(),
        );

        let warning = outcome
            .required_consistency_warning()
            .expect("canonical read is required");
        assert!(warning
            .message
            .contains("CanonicalRead: canonical bytes unavailable"));
    }
}
