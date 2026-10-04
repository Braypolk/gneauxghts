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
pub(crate) enum TaskProjectionAction {
    Reconcile,
    Remove,
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
    paths: Mutex<HashMap<PathBuf, Arc<PathProjectionState>>>,
    pending: Mutex<HashMap<PathBuf, Arc<PathProjectionState>>>,
}

#[derive(Default)]
struct PathProjectionState {
    latest: Mutex<RegisteredProjection>,
}

#[derive(Default)]
struct RegisteredProjection {
    generation: Option<u64>,
    mutation: Option<CatalogMutation>,
    lexical_pending: bool,
    task_pending: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct ProjectionWork {
    target_tasks: bool,
    lexical: bool,
    tasks: bool,
    surface_task_error: bool,
}

impl ProjectionWork {
    pub(crate) fn synchronous(target_tasks: bool) -> Self {
        Self {
            target_tasks,
            lexical: true,
            tasks: target_tasks,
            surface_task_error: true,
        }
    }

    pub(crate) fn reconciliation(target_tasks: bool) -> Self {
        Self {
            surface_task_error: false,
            ..Self::synchronous(target_tasks)
        }
    }

    pub(crate) fn timeline_tasks() -> Self {
        Self {
            target_tasks: true,
            lexical: false,
            tasks: true,
            surface_task_error: true,
        }
    }

    pub(crate) fn background(target_tasks: bool, lexical: bool, tasks: bool) -> Self {
        Self {
            target_tasks,
            lexical,
            tasks,
            surface_task_error: false,
        }
    }
}

impl CatalogProjectionRetries {
    fn path_state(&self, path: &Path) -> Result<Arc<PathProjectionState>, String> {
        Ok(self
            .paths
            .lock()
            .map_err(|_| "Catalog projection retry lock poisoned".to_string())?
            .entry(path.to_path_buf())
            .or_insert_with(|| Arc::new(PathProjectionState::default()))
            .clone())
    }

    fn apply_registered(
        &self,
        lexical: &LexicalIndex,
        state: &Arc<PathProjectionState>,
        generation: u64,
        mutation: &CatalogMutation,
        work: ProjectionWork,
    ) -> Result<(), String> {
        // This lock is per path, not the catalog or global registry. It keeps
        // every projection for one logical note in catalog-generation order.
        let mut latest = state
            .latest
            .lock()
            .map_err(|_| "Path projection coordination lock poisoned".to_string())?;
        if latest.generation.is_none_or(|current| generation > current) {
            latest.generation = Some(generation);
            latest.mutation = Some(mutation.clone());
            latest.lexical_pending = true;
            latest.task_pending = work.target_tasks;
        }
        let Some(latest_mutation) = latest.mutation.clone() else {
            return Ok(());
        };
        let mut first_error = None;
        if work.lexical && latest.lexical_pending {
            match apply_lexical_projection(lexical, &latest_mutation) {
                Ok(()) => latest.lexical_pending = false,
                Err(error) => {
                    first_error = Some(error);
                }
            }
        }
        if work.tasks && latest.task_pending {
            match apply_task_projection(&latest_mutation) {
                Ok(()) => latest.task_pending = false,
                Err(error) => {
                    if work.surface_task_error {
                        first_error.get_or_insert(error);
                    }
                }
            }
        }
        if !latest.lexical_pending && !latest.task_pending {
            // Keep only the generation watermark once both projections land.
            latest.mutation = None;
        }
        // Membership changes while this path's generation lock is held. A
        // concurrent newer publication cannot lose its pending registration.
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Catalog pending projection lock poisoned".to_string())?;
        if latest.mutation.is_some() {
            pending.insert(mutation.path().to_path_buf(), Arc::clone(state));
        } else {
            pending.remove(mutation.path());
        }
        first_error.map_or(Ok(()), Err)
    }

    pub(crate) fn apply(
        &self,
        lexical: &LexicalIndex,
        generation: u64,
        mutation: &CatalogMutation,
        work: ProjectionWork,
    ) -> Result<(), String> {
        let state = self.path_state(mutation.path())?;
        self.apply_registered(lexical, &state, generation, mutation, work)
    }

    pub(crate) fn retry_pending(&self, lexical: &LexicalIndex) -> Result<(), String> {
        let paths = self
            .pending
            .lock()
            .map_err(|_| "Catalog projection retry lock poisoned".to_string())?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut first_error = None;
        for state in paths {
            let pending = {
                let latest = state
                    .latest
                    .lock()
                    .map_err(|_| "Path projection coordination lock poisoned".to_string())?;
                latest
                    .generation
                    .zip(latest.mutation.clone())
                    .map(|(generation, mutation)| {
                        (
                            generation,
                            mutation,
                            latest.task_pending,
                            latest.lexical_pending,
                            latest.task_pending,
                        )
                    })
            };
            let Some((generation, mutation, target_tasks, lexical_pending, task_pending)) = pending
            else {
                continue;
            };
            if let Err(error) = self.apply(
                lexical,
                generation,
                &mutation,
                ProjectionWork::background(target_tasks, lexical_pending, task_pending),
            ) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    pub(crate) fn apply_batch<'a>(
        &self,
        lexical: &LexicalIndex,
        generation: u64,
        mutations: impl IntoIterator<Item = &'a CatalogMutation>,
        target_tasks: bool,
    ) -> Result<(), String> {
        let mut first_error = None;
        for mutation in mutations {
            if let Err(error) = self.apply(
                lexical,
                generation,
                mutation,
                ProjectionWork::reconciliation(target_tasks),
            ) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }
}

pub(crate) struct DeferredCatalogProjection {
    pub(crate) generation: u64,
    pub(crate) mutation: CatalogMutation,
    pub(crate) lexical: bool,
    pub(crate) tasks: bool,
    pub(crate) target_tasks: bool,
}

impl DeferredCatalogProjection {
    pub(crate) fn all(generation: u64, mutation: CatalogMutation) -> Self {
        Self {
            generation,
            mutation,
            lexical: true,
            tasks: true,
            target_tasks: true,
        }
    }

    pub(crate) fn lexical(generation: u64, mutation: CatalogMutation, target_tasks: bool) -> Self {
        Self {
            generation,
            mutation,
            lexical: true,
            tasks: false,
            target_tasks,
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
        let mutation = CatalogMutation::Upsert {
            path,
            note: Box::new(note),
        };

        self.retries.apply(
            self.lexical,
            generation,
            &mutation,
            ProjectionWork::synchronous(mode == CatalogWriteMode::Synchronous),
        )?;
        Ok(())
    }

    pub(crate) fn remove(&self, path: &Path, mode: CatalogWriteMode) -> Result<(), String> {
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
        self.retries.apply(
            self.lexical,
            generation,
            &mutation,
            ProjectionWork::synchronous(mode == CatalogWriteMode::Synchronous),
        )?;
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
    fn managed_chat_updates_lexical_search_without_changing_task_projection() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("catalog-managed-chat-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(app_data.path().to_path_buf())).unwrap();
        let _storage =
            crate::state::AppStateStorage::bind(&crate::state::vault_data_dir().unwrap()).unwrap();
        let notes = crate::test_support::TestDir::new("catalog-managed-chat-notes");
        let path = notes.path().join("Projection.md");
        let note = "---\ngneauxghts:\n  id: projection-id\n  kind: note\n---\n\nOld lexical body\n\n- [ ] retained ordinary task";
        let chat = "---\ngneauxghts:\n  id: projection-id\n  kind: chatTranscript\n---\n\nManaged chat lexical body\n\n- [ ] ignored chat task";
        let index = Mutex::new(NotesIndex::default());
        let lexical = Arc::new(LexicalIndex::new().unwrap());
        let retries = CatalogProjectionRetries::default();
        let catalog = NoteCatalog::new(&index, &lexical, &retries);

        catalog
            .upsert(
                path.clone(),
                build_indexed_note(&path, note, 41),
                CatalogWriteMode::Synchronous,
            )
            .unwrap();
        catalog
            .upsert(
                path.clone(),
                build_indexed_note(&path, chat, 42),
                CatalogWriteMode::ManagedProjection,
            )
            .unwrap();

        // Ordinary note search excludes managed chat transcripts; evidence search
        // deliberately retains them within the admitted cross-kind identity scope.
        assert!(lexical
            .search("managed", "managed", &["managed"], 10, None)
            .unwrap()
            .is_empty());
        let allowed_ids = std::collections::HashSet::from(["projection-id".to_string()]);
        let (matches, count) = lexical.evidence_matches("managed", &allowed_ids, 10).unwrap();
        assert_eq!(count, 1);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].0, "projection-id");
        assert_eq!(matches[0].1, "Managed chat lexical body");
        let tasks = crate::state::task_projection::load_tasks_for_note_id("projection-id").unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].text, "retained ordinary task");

        catalog
            .remove(&path, CatalogWriteMode::ManagedProjection)
            .unwrap();
        let (matches, count) = lexical.evidence_matches("managed", &allowed_ids, 10).unwrap();
        assert!(matches.is_empty());
        assert_eq!(count, 0);
        assert_eq!(
            crate::state::task_projection::load_tasks_for_note_id("projection-id")
                .unwrap()
                .len(),
            1
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn duplicate_identity_is_resolved_before_lexical_and_task_projection() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("catalog-resolved-identity-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(app_data.path().to_path_buf())).unwrap();
        let _storage =
            crate::state::AppStateStorage::bind(&crate::state::vault_data_dir().unwrap()).unwrap();
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
        let copy_tasks = crate::state::task_projection::load_tasks_for_note_id(&copy_id).unwrap();
        assert_eq!(copy_tasks.len(), 1);
        assert_eq!(copy_tasks[0].text, "distinctive copied catalog task");
        let original_tasks =
            crate::state::task_projection::load_tasks_for_note_id("shared-note-id").unwrap();
        assert_eq!(original_tasks.len(), 1);
        assert_eq!(original_tasks[0].text, "original catalog task");
    }

    #[test]
    fn deferred_publication_cannot_overwrite_newer_reconciliation() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("catalog-ordering-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("catalog-lexical-retry");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let _storage =
            crate::state::AppStateStorage::bind(&crate::state::vault_data_dir().unwrap()).unwrap();
        let path = notes.path().join("Retry.md");
        let older = "---\ngneauxghts:\n  id: retry-note-id\n  kind: note\n---\n\nObsolete payload\n\n- [ ] obsolete task";
        let newer = "---\ngneauxghts:\n  id: retry-note-id\n  kind: note\n---\n\nNewest coordinated payload\n\n- [ ] newest task";
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
        // Ordinary publication applies tasks synchronously and defers lexical.
        retries
            .apply(
                &lexical,
                1,
                &older_mutation,
                ProjectionWork::timeline_tasks(),
            )
            .unwrap();
        // A newer reconciliation completes both projections first.
        retries
            .apply(
                &lexical,
                2,
                &newer_mutation,
                ProjectionWork::synchronous(true),
            )
            .unwrap();
        // The older background lexical job arrives late and must be a no-op.
        retries
            .apply(
                &lexical,
                1,
                &older_mutation,
                ProjectionWork::background(true, true, false),
            )
            .unwrap();

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
        let tasks = crate::state::task_projection::load_tasks_for_note_id("retry-note-id").unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].text, "newest task");

        // Repeat the interleaving with a newer removal.
        retries
            .apply(
                &lexical,
                3,
                &older_mutation,
                ProjectionWork::timeline_tasks(),
            )
            .unwrap();
        let remove = CatalogMutation::Remove { path: path.clone() };
        retries
            .apply(&lexical, 4, &remove, ProjectionWork::synchronous(true))
            .unwrap();
        retries
            .apply(
                &lexical,
                3,
                &older_mutation,
                ProjectionWork::background(true, true, false),
            )
            .unwrap();
        assert!(lexical
            .search(
                "newest coordinated",
                "newest coordinated",
                &["newest", "coordinated"],
                10,
                None,
            )
            .unwrap()
            .is_empty());
        assert!(
            crate::state::task_projection::load_tasks_for_note_id("retry-note-id")
                .unwrap()
                .is_empty()
        );
        let state = retries.paths.lock().unwrap().get(&path).unwrap().clone();
        assert!(state.latest.lock().unwrap().mutation.is_none());
        crate::state::set_notes_root_override(None).unwrap();
    }
    #[test]
    fn failed_projection_remains_pending_until_retry_repairs_it() {
        let fixture = crate::test_support::TestVault::new("catalog-pending-retry");
        let path = fixture.notes.path().join("Retry.md");
        let db =
            rusqlite::Connection::open(fixture.notes.path().join(".gneauxghts/app-state.sqlite3"))
                .unwrap();
        db.execute_batch(
            "ALTER TABLE app_state_note_tasks RENAME TO temporarily_unavailable_tasks",
        )
        .unwrap();
        let index = Mutex::new(NotesIndex::default());
        let lexical = Arc::new(LexicalIndex::new().unwrap());
        let retries = CatalogProjectionRetries::default();
        let catalog = NoteCatalog::new(&index, &lexical, &retries);
        let markdown = "---\ngneauxghts:\n  id: retry-identity\n  kind: note\n---\n\n- [ ] Retained retry task";
        assert!(catalog
            .upsert(
                path.clone(),
                build_indexed_note(&path, markdown, 1),
                CatalogWriteMode::Synchronous
            )
            .is_err());
        assert_eq!(retries.pending.lock().unwrap().len(), 1);
        // Background retries deliberately suppress rebuildable task errors.
        retries.retry_pending(&lexical).unwrap();
        assert_eq!(retries.pending.lock().unwrap().len(), 1);
        db.execute_batch(
            "ALTER TABLE temporarily_unavailable_tasks RENAME TO app_state_note_tasks",
        )
        .unwrap();
        retries.retry_pending(&lexical).unwrap();
        assert!(retries.pending.lock().unwrap().is_empty());
        let tasks =
            crate::state::task_projection::load_tasks_for_note_id("retry-identity").unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].text, "Retained retry task");
    }

    #[test]
    fn settled_path_watermarks_are_not_pending_retry_work() {
        let retries = CatalogProjectionRetries::default();
        // Churn keeps compact stale-job watermarks, but none belongs to the
        // retry worklist. This would be 10,000 locks on every old retry scan.
        for index in 0..10_000 {
            let path = PathBuf::from(format!("/vault/churn/{index}.md"));
            let state = retries.path_state(&path).unwrap();
            state.latest.lock().unwrap().generation = Some(index);
        }
        assert_eq!(retries.paths.lock().unwrap().len(), 10_000);
        assert_eq!(retries.pending.lock().unwrap().len(), 0);
        retries
            .retry_pending(&LexicalIndex::new().unwrap())
            .unwrap();
        let paths = retries.paths.lock().unwrap();
        let retained_floor = paths
            .iter()
            .map(|(path, _)| {
                std::mem::size_of::<PathProjectionState>()
                    + std::mem::size_of::<PathBuf>()
                    + std::mem::size_of::<Arc<PathProjectionState>>()
                    + path.as_os_str().len()
            })
            .sum::<usize>();
        eprintln!("10k path watermarks retain at least {retained_floor} bytes (excluding allocator/hash-table overhead)");
    }
}
