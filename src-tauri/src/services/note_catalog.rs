//! Shared note-catalog and derived-projection policy.
//!
//! The filesystem remains authoritative. This service only coordinates the
//! in-memory catalog plus the lexical and task projections after callers have
//! already decided that a document should be reflected in the catalog.

use crate::{
    index::{IndexedNote, NotesIndex},
    lexical::LexicalIndex,
    note::DocumentKind,
};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CatalogWriteMode {
    /// Apply lexical and task projections before returning.
    Synchronous,
    /// Managed chat projections belong in catalog and lexical search, but
    /// never participate in the ordinary task projection.
    ManagedProjection,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProjectionTiming {
    Synchronous,
    Excluded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TaskProjectionAction {
    Reconcile,
    Remove,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ProjectionPlan {
    pub(crate) lexical: ProjectionTiming,
    pub(crate) tasks: ProjectionTiming,
    pub(crate) task_action: TaskProjectionAction,
}

impl ProjectionPlan {
    pub(crate) fn for_upsert(mode: CatalogWriteMode, kind: DocumentKind) -> Self {
        let task_action = task_projection_action(kind);
        match mode {
            CatalogWriteMode::Synchronous => Self {
                lexical: ProjectionTiming::Synchronous,
                tasks: ProjectionTiming::Synchronous,
                task_action,
            },
            CatalogWriteMode::ManagedProjection => Self {
                lexical: ProjectionTiming::Synchronous,
                tasks: ProjectionTiming::Excluded,
                task_action,
            },
        }
    }

    pub(crate) fn for_remove(mode: CatalogWriteMode) -> Self {
        match mode {
            CatalogWriteMode::Synchronous => Self {
                lexical: ProjectionTiming::Synchronous,
                tasks: ProjectionTiming::Synchronous,
                task_action: TaskProjectionAction::Remove,
            },
            CatalogWriteMode::ManagedProjection => Self {
                lexical: ProjectionTiming::Synchronous,
                tasks: ProjectionTiming::Excluded,
                task_action: TaskProjectionAction::Remove,
            },
        }
    }
}

#[derive(Clone)]
pub(crate) enum CatalogMutation {
    Upsert { path: PathBuf, note: IndexedNote },
    Remove { path: PathBuf },
}

impl CatalogMutation {
    pub(crate) fn path(&self) -> &Path {
        match self {
            Self::Upsert { path, .. } | Self::Remove { path } => path,
        }
    }
}

pub(crate) struct DeferredCatalogProjection {
    pub(crate) mutation: CatalogMutation,
    pub(crate) lexical: bool,
    pub(crate) tasks: bool,
}

impl DeferredCatalogProjection {
    pub(crate) fn all(mutation: CatalogMutation) -> Self {
        Self {
            mutation,
            lexical: true,
            tasks: true,
        }
    }

    pub(crate) fn lexical(mutation: CatalogMutation) -> Self {
        Self {
            mutation,
            lexical: true,
            tasks: false,
        }
    }

    pub(crate) fn path(&self) -> &Path {
        self.mutation.path()
    }
}

pub(crate) struct NoteCatalog<'a> {
    notes_index: &'a Mutex<NotesIndex>,
    lexical: &'a Arc<LexicalIndex>,
}

impl<'a> NoteCatalog<'a> {
    pub(crate) fn new(notes_index: &'a Mutex<NotesIndex>, lexical: &'a Arc<LexicalIndex>) -> Self {
        Self {
            notes_index,
            lexical,
        }
    }

    pub(crate) fn upsert(
        &self,
        path: PathBuf,
        note: IndexedNote,
        mode: CatalogWriteMode,
    ) -> Result<(), String> {
        let plan = ProjectionPlan::for_upsert(mode, note.document_kind);

        if plan.lexical == ProjectionTiming::Synchronous {
            self.lexical.upsert_note(&path, &note)?;
        }

        self.notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?
            .upsert_note(path.clone(), note.clone());

        if plan.tasks == ProjectionTiming::Synchronous {
            let _ = apply_task_projection(&CatalogMutation::Upsert { path, note });
        }
        Ok(())
    }

    pub(crate) fn remove(&self, path: &Path, mode: CatalogWriteMode) -> Result<(), String> {
        let plan = ProjectionPlan::for_remove(mode);

        if plan.lexical == ProjectionTiming::Synchronous {
            self.lexical.remove_note(path)?;
        }

        self.notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?
            .remove_note(path);

        let mutation = CatalogMutation::Remove {
            path: path.to_path_buf(),
        };
        if plan.tasks == ProjectionTiming::Synchronous {
            let _ = apply_task_projection(&mutation);
        }
        Ok(())
    }
}

pub(crate) fn task_projection_action(kind: DocumentKind) -> TaskProjectionAction {
    if kind == DocumentKind::Note {
        TaskProjectionAction::Reconcile
    } else {
        TaskProjectionAction::Remove
    }
}

pub(crate) fn apply_lexical_projection(
    lexical: &LexicalIndex,
    mutation: &CatalogMutation,
) -> Result<(), String> {
    match mutation {
        CatalogMutation::Upsert { path, note } => lexical.upsert_note(path, note),
        CatalogMutation::Remove { path } => lexical.remove_note(path),
    }
}

pub(crate) fn apply_task_projection(mutation: &CatalogMutation) -> Result<(), String> {
    match mutation {
        CatalogMutation::Upsert { path, note } => {
            let timestamp = projection_timestamp(note.modified_millis);
            match task_projection_action(note.document_kind) {
                TaskProjectionAction::Reconcile => {
                    crate::state::task_projection::reconcile_note_tasks(
                        path,
                        Some(note),
                        &note.note_id,
                        timestamp,
                    )
                    .map(|_| ())
                }
                TaskProjectionAction::Remove => {
                    crate::state::task_projection::delete_tasks_for_note_path(path, timestamp)
                        .map(|_| ())
                }
            }
        }
        CatalogMutation::Remove { path } => {
            crate::state::task_projection::delete_tasks_for_note_path(path, projection_timestamp(0))
                .map(|_| ())
        }
    }
}

fn projection_timestamp(modified_millis: u64) -> u64 {
    if modified_millis == 0 {
        crate::time::current_time_millis().unwrap_or(0)
    } else {
        modified_millis
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_projection_policy_covers_document_kinds_and_execution_modes() {
        let cases = [
            (
                CatalogWriteMode::Synchronous,
                DocumentKind::Note,
                ProjectionTiming::Synchronous,
                ProjectionTiming::Synchronous,
                TaskProjectionAction::Reconcile,
            ),
            (
                CatalogWriteMode::Synchronous,
                DocumentKind::ChatIndex,
                ProjectionTiming::Synchronous,
                ProjectionTiming::Synchronous,
                TaskProjectionAction::Remove,
            ),
            (
                CatalogWriteMode::Synchronous,
                DocumentKind::ChatTranscript,
                ProjectionTiming::Synchronous,
                ProjectionTiming::Synchronous,
                TaskProjectionAction::Remove,
            ),
            (
                CatalogWriteMode::ManagedProjection,
                DocumentKind::ChatTranscript,
                ProjectionTiming::Synchronous,
                ProjectionTiming::Excluded,
                TaskProjectionAction::Remove,
            ),
        ];

        for (mode, kind, lexical, tasks, task_action) in cases {
            assert_eq!(
                ProjectionPlan::for_upsert(mode, kind),
                ProjectionPlan {
                    lexical,
                    tasks,
                    task_action,
                }
            );
        }
    }

    #[test]
    fn remove_projection_policy_distinguishes_synchronous_and_managed_paths() {
        let cases = [
            (
                CatalogWriteMode::Synchronous,
                ProjectionTiming::Synchronous,
                ProjectionTiming::Synchronous,
            ),
            (
                CatalogWriteMode::ManagedProjection,
                ProjectionTiming::Synchronous,
                ProjectionTiming::Excluded,
            ),
        ];

        for (mode, lexical, tasks) in cases {
            let plan = ProjectionPlan::for_remove(mode);
            assert_eq!(plan.lexical, lexical);
            assert_eq!(plan.tasks, tasks);
            assert_eq!(plan.task_action, TaskProjectionAction::Remove);
        }
    }
}
