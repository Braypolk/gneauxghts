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
    collections::HashMap,
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
    Upsert {
        path: PathBuf,
        note: Box<IndexedNote>,
    },
    Remove {
        path: PathBuf,
    },
}

impl CatalogMutation {
    pub(crate) fn path(&self) -> &Path {
        match self {
            Self::Upsert { path, .. } | Self::Remove { path } => path,
        }
    }
}

#[derive(Default)]
pub(crate) struct CatalogProjectionRetries {
    lexical: Mutex<HashMap<PathBuf, Arc<PathProjectionState>>>,
}

#[derive(Default)]
struct PathProjectionState {
    latest: Mutex<RegisteredProjection>,
}

#[derive(Default)]
struct RegisteredProjection {
    generation: u64,
    pending: Option<CatalogMutation>,
}

impl CatalogProjectionRetries {
    fn register_lexical(
        &self,
        generation: u64,
        mutation: &CatalogMutation,
    ) -> Result<Arc<PathProjectionState>, String> {
        let state = self
            .lexical
            .lock()
            .map_err(|_| "Catalog projection retry lock poisoned".to_string())?
            .entry(mutation.path().to_path_buf())
            .or_insert_with(|| Arc::new(PathProjectionState::default()))
            .clone();
        let mut latest = state
            .latest
            .lock()
            .map_err(|_| "Path projection coordination lock poisoned".to_string())?;
        if generation >= latest.generation {
            latest.generation = generation;
            latest.pending = Some(mutation.clone());
        }
        drop(latest);
        Ok(state)
    }

    fn apply_registered(lexical: &LexicalIndex, state: &PathProjectionState) -> Result<(), String> {
        // This lock is per path, not the catalog or global retry registry.
        // It orders lexical I/O for one note while unrelated paths continue.
        let mut latest = state
            .latest
            .lock()
            .map_err(|_| "Path projection coordination lock poisoned".to_string())?;
        let Some(mutation) = latest.pending.as_ref() else {
            return Ok(());
        };
        match apply_lexical_projection(lexical, mutation) {
            Ok(()) => {
                // Retain only the generation watermark after success. The
                // potentially large indexed payload exists solely while it
                // is pending, so this registry never mirrors the catalog.
                latest.pending = None;
                Ok(())
            }
            Err(error) => Err(error),
        }
    }

    pub(crate) fn apply_lexical(
        &self,
        lexical: &LexicalIndex,
        generation: u64,
        mutation: &CatalogMutation,
    ) -> Result<(), String> {
        let state = self.register_lexical(generation, mutation)?;
        Self::apply_registered(lexical, &state)
    }

    pub(crate) fn retry_lexical(&self, lexical: &LexicalIndex) -> Result<(), String> {
        let paths = self
            .lexical
            .lock()
            .map_err(|_| "Catalog projection retry lock poisoned".to_string())?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut first_error = None;
        for state in paths {
            if let Err(error) = Self::apply_registered(lexical, &state) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    pub(crate) fn apply_lexical_batch<'a>(
        &self,
        lexical: &LexicalIndex,
        generation: u64,
        mutations: impl IntoIterator<Item = &'a CatalogMutation>,
    ) -> Result<(), String> {
        let mut first_error = None;
        for mutation in mutations {
            if let Err(error) = self.apply_lexical(lexical, generation, mutation) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
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
    retries: &'a CatalogProjectionRetries,
}

impl<'a> NoteCatalog<'a> {
    pub(crate) fn new(
        notes_index: &'a Mutex<NotesIndex>,
        lexical: &'a Arc<LexicalIndex>,
        retries: &'a CatalogProjectionRetries,
    ) -> Self {
        Self {
            notes_index,
            lexical,
            retries,
        }
    }

    pub(crate) fn upsert(
        &self,
        path: PathBuf,
        note: IndexedNote,
        mode: CatalogWriteMode,
    ) -> Result<(), String> {
        let (note, generation) = {
            let mut index = self
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            let note = index.upsert_note(path.clone(), note);
            (note, index.revision())
        };
        let plan = ProjectionPlan::for_upsert(mode, note.document_kind);
        let mutation = CatalogMutation::Upsert {
            path,
            note: Box::new(note),
        };

        if plan.lexical == ProjectionTiming::Synchronous {
            self.retries
                .apply_lexical(self.lexical, generation, &mutation)?;
        }

        if plan.tasks == ProjectionTiming::Synchronous {
            let _ = apply_task_projection(&mutation);
        }
        Ok(())
    }

    pub(crate) fn remove(&self, path: &Path, mode: CatalogWriteMode) -> Result<(), String> {
        let plan = ProjectionPlan::for_remove(mode);
        let generation = {
            let mut index = self
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            index.remove_note(path);
            index.revision()
        };

        let mutation = CatalogMutation::Remove {
            path: path.to_path_buf(),
        };
        if plan.lexical == ProjectionTiming::Synchronous {
            self.retries
                .apply_lexical(self.lexical, generation, &mutation)?;
        }
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
    use crate::index::build_indexed_note;

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

    #[test]
    fn duplicate_identity_is_resolved_before_lexical_and_task_projection() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("catalog-resolved-identity-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(app_data.path().to_path_buf())).unwrap();
        let notes = crate::test_support::TestDir::new("catalog-resolved-identity-notes");
        let original_path = notes.path().join("Original.md");
        let copy_path = notes.path().join("Copy.md");
        let original = "---\ngneauxghts:\n  id: shared-note-id\n  kind: note\n---\n\n- [ ] original catalog task";
        let copy = "---\ngneauxghts:\n  id: shared-note-id\n  kind: note\n---\n\n- [ ] distinctive copied catalog task";
        let index = Mutex::new(NotesIndex::default());
        let lexical = Arc::new(LexicalIndex::new().unwrap());
        let retries = CatalogProjectionRetries::default();
        let catalog = NoteCatalog::new(&index, &lexical, &retries);

        catalog
            .upsert(
                original_path.clone(),
                build_indexed_note(&original_path, original, 41),
                CatalogWriteMode::Synchronous,
            )
            .unwrap();
        catalog
            .upsert(
                copy_path.clone(),
                build_indexed_note(&copy_path, copy, 42),
                CatalogWriteMode::Synchronous,
            )
            .unwrap();

        let resolved_copy = index
            .lock()
            .unwrap()
            .entries
            .get(&copy_path)
            .unwrap()
            .clone();
        let copy_id = resolved_copy.note_id.clone();
        assert_ne!(copy_id, "shared-note-id");
        let lexical_results = lexical
            .search(
                "distinctive copied",
                "distinctive copied",
                &["distinctive", "copied"],
                10,
                None,
            )
            .unwrap();
        assert_eq!(
            lexical_results[0].result.note_id.as_deref(),
            Some(copy_id.as_str())
        );
        apply_task_projection(&CatalogMutation::Upsert {
            path: copy_path,
            note: Box::new(resolved_copy),
        })
        .unwrap();
        let copy_tasks = crate::state::task_projection::load_tasks_for_note_id(&copy_id).unwrap();
        assert_eq!(copy_tasks.len(), 1);
        assert_eq!(copy_tasks[0].text, "distinctive copied catalog task");
        let original_tasks =
            crate::state::task_projection::load_tasks_for_note_id("shared-note-id").unwrap();
        assert_eq!(original_tasks.len(), 1);
        assert_eq!(original_tasks[0].text, "original catalog task");
    }

    #[test]
    fn newer_registered_projection_cannot_be_replaced_or_cleared_by_older_work() {
        let notes = crate::test_support::TestDir::new("catalog-lexical-retry");
        let path = notes.path().join("Retry.md");
        let older = "---\ngneauxghts:\n  id: retry-note-id\n  kind: note\n---\n\nObsolete payload";
        let newer = "---\ngneauxghts:\n  id: retry-note-id\n  kind: note\n---\n\nNewest coordinated payload";
        let older_mutation = CatalogMutation::Upsert {
            path: path.clone(),
            note: Box::new(build_indexed_note(&path, older, 91)),
        };
        let newer_mutation = CatalogMutation::Upsert {
            path: path.clone(),
            note: Box::new(build_indexed_note(&path, newer, 92)),
        };
        let lexical = LexicalIndex::new().unwrap();
        let retries = CatalogProjectionRetries::default();
        retries.register_lexical(2, &newer_mutation).unwrap();
        retries.register_lexical(1, &older_mutation).unwrap();

        retries.retry_lexical(&lexical).unwrap();
        retries.apply_lexical(&lexical, 1, &older_mutation).unwrap();

        let results = lexical
            .search(
                "newest coordinated",
                "newest coordinated",
                &["newest", "coordinated"],
                10,
                None,
            )
            .unwrap();
        assert_eq!(results[0].result.note_id.as_deref(), Some("retry-note-id"));
        assert!(lexical
            .search("obsolete", "obsolete", &["obsolete"], 10, None)
            .unwrap()
            .is_empty());
        let state = retries.lexical.lock().unwrap().get(&path).unwrap().clone();
        assert!(state.latest.lock().unwrap().pending.is_none());
    }
}
