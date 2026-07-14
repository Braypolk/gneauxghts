use crate::note::DocumentKind;
use crate::{
    lexical::LexicalIndex,
    note,
    path_utils::collect_markdown_files_recursively,
    semantic::SemanticState,
    state::{derive_file_stem, derive_file_stem_from_title_and_markdown},
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::UNIX_EPOCH,
    time::{Duration, Instant},
};

pub(crate) struct AppState {
    pub(crate) notes_index: Mutex<NotesIndex>,
    pub(crate) lexical: Arc<LexicalIndex>,
    pub(crate) semantic: Arc<SemanticState>,
    interactive_invalidation: Mutex<InteractiveInvalidationState>,
    /// Phase 5: bounded cache of recent draft bodies keyed by `(path, hash)`.
    /// Frontend sends only `hash` for keystroke-driven requests; backend
    /// re-uses the body it captured from the most recent request that did
    /// include the body, keeping the IPC payload small.
    draft_cache: Mutex<DraftCache>,
    /// Background worker that absorbs save-side lexical and SQLite task
    /// projection work. Save returns to the frontend after the file is on
    /// disk and the in-memory notes_index is updated; lexical/projection
    /// catch up shortly after.
    pub(crate) background_index_queue: crate::services::BackgroundIndexQueue,
    /// Counter of foreground IPC calls currently running on the hot path
    /// (note open / load session). The startup prewarm and the periodic
    /// background reconciler check it between per-note units of work and
    /// yield while the foreground is active, so the SQLite state mutex
    /// and the lexical writer do not stall a user-driven note switch.
    foreground_activity: Arc<ForegroundActivity>,
}

/// Atomic counter of foreground IPC calls currently in flight on the hot
/// path. Acquired via [`AppState::foreground_guard`] which decrements on
/// drop, so callers can not forget to release.
#[derive(Default)]
pub(crate) struct ForegroundActivity {
    in_flight: AtomicUsize,
}

impl ForegroundActivity {
    pub(crate) fn is_busy(&self) -> bool {
        self.in_flight.load(Ordering::Acquire) > 0
    }
}

/// RAII guard returned by [`AppState::foreground_guard`]. While at least
/// one guard is alive, [`ForegroundActivity::is_busy`] returns true and
/// background workers (the cold-start prewarm, the periodic reconcile,
/// the save-side index queue) will yield between per-note units of work.
pub(crate) struct ForegroundGuard {
    activity: Arc<ForegroundActivity>,
    semantic: Arc<SemanticState>,
}

impl ForegroundGuard {
    fn new(activity: Arc<ForegroundActivity>, semantic: Arc<SemanticState>) -> Self {
        activity.in_flight.fetch_add(1, Ordering::AcqRel);
        semantic.begin_foreground_activity();
        Self { activity, semantic }
    }
}

impl Drop for ForegroundGuard {
    fn drop(&mut self) {
        self.activity.in_flight.fetch_sub(1, Ordering::AcqRel);
        self.semantic.end_foreground_activity();
    }
}

#[derive(Default)]
pub(crate) struct DraftCache {
    /// Bounded map of `(path, hash) -> body`. We only need to remember the
    /// last few drafts: the active note's most recent body plus a couple of
    /// adjacent revisions to absorb out-of-order requests.
    entries: std::collections::VecDeque<(String, String, String)>,
}

const DRAFT_CACHE_MAX_ENTRIES: usize = 6;

impl DraftCache {
    fn cache_key(path: Option<&str>, hash: &str) -> String {
        format!("{}|{}", path.unwrap_or(""), hash)
    }

    pub(crate) fn get(&self, path: Option<&str>, hash: &str) -> Option<String> {
        let key = Self::cache_key(path, hash);
        self.entries
            .iter()
            .find(|(cached_key, _, _)| cached_key == &key)
            .map(|(_, _, body)| body.clone())
    }

    pub(crate) fn put(&mut self, path: Option<&str>, hash: &str, body: String) {
        let key = Self::cache_key(path, hash);
        self.entries.retain(|(cached_key, _, _)| cached_key != &key);
        self.entries.push_back((key, hash.to_string(), body));
        while self.entries.len() > DRAFT_CACHE_MAX_ENTRIES {
            self.entries.pop_front();
        }
    }
}

#[derive(Default)]
struct InteractiveInvalidationState {
    epoch: u64,
    dirty_paths: HashSet<PathBuf>,
    full_refresh_count: u64,
    incremental_update_count: u64,
    refresh_source_counts: HashMap<String, u64>,
}

enum PendingIndexUpdate {
    Upsert(PathBuf, IndexedNote),
    Remove(PathBuf),
}

/// Payload describing what to mirror into the SQLite task projection
/// after a bulk index refresh has settled.
enum ProjectionPayload {
    Upsert { path: PathBuf, note: IndexedNote },
    Remove { path: PathBuf },
}

fn apply_projection_payload(payload: ProjectionPayload) {
    match payload {
        ProjectionPayload::Upsert { path, note } => {
            if note.document_kind.is_chat_projection() {
                let timestamp = crate::time::current_time_millis().unwrap_or(0);
                let _ = crate::state::task_projection::delete_tasks_for_note_path(&path, timestamp);
                return;
            }
            let timestamp = if note.modified_millis == 0 {
                crate::time::current_time_millis().unwrap_or(0)
            } else {
                note.modified_millis
            };
            let _ = crate::state::task_projection::reconcile_note_tasks(
                &path,
                Some(&note),
                &note.note_id,
                timestamp,
            );
        }
        ProjectionPayload::Remove { path } => {
            let timestamp = crate::time::current_time_millis().unwrap_or(0);
            let _ = crate::state::task_projection::delete_tasks_for_note_path(&path, timestamp);
        }
    }
}

impl AppState {
    pub(crate) fn new(semantic: SemanticState) -> Result<Self, String> {
        let lexical = Arc::new(LexicalIndex::new()?);
        let foreground_activity = Arc::new(ForegroundActivity::default());
        let background_index_queue = crate::services::BackgroundIndexQueue::new(
            Arc::clone(&lexical),
            Arc::clone(&foreground_activity),
        );
        Ok(Self {
            notes_index: Mutex::new(NotesIndex::default()),
            lexical,
            semantic: Arc::new(semantic),
            interactive_invalidation: Mutex::new(InteractiveInvalidationState::default()),
            draft_cache: Mutex::new(DraftCache::default()),
            background_index_queue,
            foreground_activity,
        })
    }

    /// Acquire a guard that marks a foreground IPC call as in-flight.
    /// While any guard is alive, background workers yield between
    /// per-note units of work so the foreground call does not queue up
    /// behind the SQLite state mutex or the lexical writer.
    pub(crate) fn foreground_guard(&self) -> ForegroundGuard {
        ForegroundGuard::new(
            Arc::clone(&self.foreground_activity),
            Arc::clone(&self.semantic),
        )
    }

    /// Snapshot accessor for the shared foreground-busy flag. Background
    /// workers consult this between per-note units of work via the
    /// `Arc<ForegroundActivity>` they hold; this method exists for
    /// integration tests that need to assert on the flag without
    /// reaching into the queue.
    #[cfg(test)]
    pub(crate) fn is_foreground_busy(&self) -> bool {
        self.foreground_activity.is_busy()
    }

    /// Returns true if the in-memory `notes_index` has been populated at
    /// least once (cold start full scan completed). Callers on the hot
    /// path that consult the index for note-id lookup use this to decide
    /// whether to fall back to expensive disk scans or to skip pruning
    /// stale ids until the background prewarm finishes.
    pub(crate) fn has_warm_notes_index(&self) -> bool {
        self.notes_index
            .lock()
            .ok()
            .and_then(|index| index.last_refresh_at)
            .is_some()
    }

    /// Phase 5: resolve the markdown body for a draft reference.
    ///
    /// - If `body_not_needed` is set, returns `None` (caller doesn't require it).
    /// - If the request inlines the body, the cache is updated and the body is
    ///   returned.
    /// - Otherwise the cache is consulted by `(path, hash)`. A cache miss
    ///   returns an explicit error so the frontend can retry with the body.
    pub(crate) fn resolve_draft_body(
        &self,
        draft: &crate::commands::DraftRef,
    ) -> Result<Option<String>, String> {
        if draft.body_not_needed {
            return Ok(None);
        }

        if let Some(body) = draft.body.as_ref() {
            if let Some(hash) = draft.hash.as_deref() {
                let mut cache = self
                    .draft_cache
                    .lock()
                    .map_err(|_| "Draft cache lock poisoned".to_string())?;
                cache.put(draft.path.as_deref(), hash, body.clone());
            }
            return Ok(Some(body.clone()));
        }

        let Some(hash) = draft.hash.as_deref() else {
            return Ok(None);
        };

        let cache = self
            .draft_cache
            .lock()
            .map_err(|_| "Draft cache lock poisoned".to_string())?;
        match cache.get(draft.path.as_deref(), hash) {
            Some(body) => Ok(Some(body)),
            None => Err(format!(
                "draft-cache-miss:{}",
                draft.path.as_deref().unwrap_or("")
            )),
        }
    }

    pub(crate) fn upsert_note_indexes(
        &self,
        path: PathBuf,
        note: IndexedNote,
    ) -> Result<(), String> {
        self.lexical.upsert_note(&path, &note)?;
        let note_id = note.note_id.clone();
        let modified_millis = note.modified_millis;
        let note_clone_for_projection = note.clone();
        let mut index = self
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?;
        index.upsert_note(path.clone(), note);
        drop(index);
        let timestamp = if modified_millis == 0 {
            crate::time::current_time_millis().unwrap_or(modified_millis)
        } else {
            modified_millis
        };
        if note_clone_for_projection.document_kind == DocumentKind::Note {
            let _ = crate::state::task_projection::reconcile_note_tasks(
                &path,
                Some(&note_clone_for_projection),
                &note_id,
                timestamp,
            );
        } else {
            let _ = crate::state::task_projection::delete_tasks_for_note_path(&path, timestamp);
        }
        self.clear_dirty_path(&path)?;
        Ok(())
    }

    /// Save-path index update.
    ///
    /// Updates the in-memory `notes_index` and single-note task projection
    /// synchronously so search, recents, wikilinks, and the task list can
    /// react to `note-saved` immediately. The heavier lexical indexing work
    /// still runs through the background worker.
    pub(crate) fn upsert_note_indexes_for_save(
        &self,
        path: PathBuf,
        note: IndexedNote,
    ) -> Result<(), String> {
        let note_for_background = note.clone();
        let note_for_projection = note.clone();
        {
            let mut index = self
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            index.upsert_note(path.clone(), note);
        }
        let timestamp = if note_for_projection.modified_millis == 0 {
            crate::time::current_time_millis().unwrap_or(0)
        } else {
            note_for_projection.modified_millis
        };
        if note_for_projection.document_kind == DocumentKind::Note {
            let _ = crate::state::task_projection::reconcile_note_tasks(
                &path,
                Some(&note_for_projection),
                &note_for_projection.note_id,
                timestamp,
            );
        } else {
            let _ = crate::state::task_projection::delete_tasks_for_note_path(&path, timestamp);
        }
        self.clear_dirty_path(&path)?;
        self.background_index_queue
            .enqueue_upsert(path, note_for_background);
        Ok(())
    }

    /// Managed chat projections participate in the catalog and lexical
    /// search, but are deliberately isolated from task projection and the
    /// ordinary save/watcher pipeline.
    pub(crate) fn upsert_managed_chat_projection(
        &self,
        path: PathBuf,
        note: IndexedNote,
    ) -> Result<(), String> {
        self.lexical.upsert_note(&path, &note)?;
        let mut index = self
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?;
        index.upsert_note(path.clone(), note);
        drop(index);
        self.clear_dirty_path(&path)
    }

    pub(crate) fn remove_note_indexes(&self, path: &Path) -> Result<(), String> {
        self.lexical.remove_note(path)?;
        let mut index = self
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?;
        index.remove_note(path);
        drop(index);
        let timestamp = crate::time::current_time_millis().unwrap_or(0);
        let _ = crate::state::task_projection::delete_tasks_for_note_path(path, timestamp);
        self.clear_dirty_path(path)?;
        Ok(())
    }

    /// Save-path remove. Mirror of [`upsert_note_indexes_for_save`].
    pub(crate) fn remove_note_indexes_for_save(&self, path: &Path) -> Result<(), String> {
        {
            let mut index = self
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            index.remove_note(path);
        }
        self.clear_dirty_path(path)?;
        self.background_index_queue
            .enqueue_remove(path.to_path_buf());
        Ok(())
    }

    pub(crate) fn mark_notes_index_dirty(&self, path: &Path, source: &str) -> Result<(), String> {
        let mut invalidation = self
            .interactive_invalidation
            .lock()
            .map_err(|_| "Interactive invalidation lock poisoned".to_string())?;
        invalidation.epoch = invalidation.epoch.wrapping_add(1);
        invalidation.dirty_paths.insert(path.to_path_buf());
        *invalidation
            .refresh_source_counts
            .entry(format!("dirty:{source}"))
            .or_insert(0) += 1;
        Ok(())
    }

    /// Foreground hot path used by search, recents, tasks, and wikilink
    /// commands. Designed to never block on a full vault scan in normal
    /// operation:
    ///
    /// 1. Drains any watcher-marked dirty paths and applies them
    ///    incrementally (cheap — bounded by the user's recent file
    ///    activity).
    /// 2. On the very first call (the index has never been populated)
    ///    performs a synchronous full refresh so the caller has data to
    ///    work with.
    /// 3. Otherwise leaves the index alone. A separate background
    ///    reconciliation pass (see [`AppState::reconcile_full_vault_scan`])
    ///    catches any events the watcher missed without ever blocking a
    ///    keystroke or focus.
    ///
    /// The `max_age` parameter is preserved for call-site compatibility
    /// but is no longer used to gate foreground full scans.
    pub(crate) fn ensure_interactive_index(
        &self,
        notes_dir: &Path,
        _max_age: Duration,
        source: &str,
    ) -> Result<(), String> {
        let dirty_paths = {
            let mut invalidation = self
                .interactive_invalidation
                .lock()
                .map_err(|_| "Interactive invalidation lock poisoned".to_string())?;
            *invalidation
                .refresh_source_counts
                .entry(source.to_string())
                .or_insert(0) += 1;
            invalidation.dirty_paths.drain().collect::<Vec<_>>()
        };

        let had_dirty_paths = !dirty_paths.is_empty();

        if had_dirty_paths {
            self.apply_dirty_paths(dirty_paths)?;
        }

        let cold_start = self
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?
            .last_refresh_at
            .is_none();
        if cold_start {
            // Cold start: callers have no data to work with yet, so this
            // single full scan is unavoidable. Subsequent invocations rely
            // on watcher dirty paths plus the background reconciliation
            // loop and never reach this branch again.
            self.run_full_refresh(notes_dir)?;
        }

        Ok(())
    }

    fn apply_dirty_paths(&self, dirty_paths: Vec<PathBuf>) -> Result<bool, String> {
        let existing_signatures = {
            let index = self
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            dirty_paths
                .iter()
                .filter_map(|path| {
                    index
                        .entries
                        .get(path)
                        .map(|note| (path.clone(), note.signature.clone()))
                })
                .collect::<HashMap<_, _>>()
        };
        let updates = collect_dirty_updates(dirty_paths, &existing_signatures)?;
        // Phase 5 write-through: mirror dirty updates into the lexical
        // index before they land in `notes_index`, so search no longer
        // needs to clone+resync the full entries map on every query.
        for update in &updates {
            match update {
                PendingIndexUpdate::Upsert(path, note) => {
                    self.lexical.upsert_note(path, note)?;
                }
                PendingIndexUpdate::Remove(path) => {
                    self.lexical.remove_note(path)?;
                }
            }
        }
        let projection_payloads: Vec<ProjectionPayload> = updates
            .iter()
            .map(|update| match update {
                PendingIndexUpdate::Upsert(path, note) => ProjectionPayload::Upsert {
                    path: path.clone(),
                    note: note.clone(),
                },
                PendingIndexUpdate::Remove(path) => {
                    ProjectionPayload::Remove { path: path.clone() }
                }
            })
            .collect();
        let changed = {
            let mut index = self
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            let changed = index.apply_pending_updates(updates);
            index.mark_refreshed(changed);
            changed
        };
        for payload in projection_payloads {
            apply_projection_payload(payload);
        }
        let mut invalidation = self
            .interactive_invalidation
            .lock()
            .map_err(|_| "Interactive invalidation lock poisoned".to_string())?;
        invalidation.incremental_update_count =
            invalidation.incremental_update_count.wrapping_add(1);
        Ok(changed)
    }

    fn run_full_refresh(&self, notes_dir: &Path) -> Result<bool, String> {
        let (existing_signatures, existing_paths, managed_chat_paths) = {
            let index = self
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            (
                index
                    .entries
                    .iter()
                    .map(|(path, note)| (path.clone(), note.signature.clone()))
                    .collect::<HashMap<_, _>>(),
                index.entries.keys().cloned().collect::<Vec<_>>(),
                index
                    .entries
                    .iter()
                    .filter(|(_, note)| note.document_kind.is_chat_projection())
                    .map(|(path, _)| path.clone())
                    .collect::<HashSet<_>>(),
            )
        };
        let (mut updates, seen_paths) = collect_refresh_updates(notes_dir, &existing_signatures)?;
        // Managed chat writes update the catalog directly. If the bytes on
        // disk later diverge, the chat conflict pipeline owns that state; a
        // generic reconciliation pass must not index the external edit.
        updates.retain(|(path, _)| !managed_chat_paths.contains(path));
        // Phase 5 write-through: incrementally update the lexical mirror
        // for every changed/added entry, and remove stale entries that
        // disappeared from disk.
        for (path, note) in &updates {
            self.lexical.upsert_note(path, note)?;
        }
        let stale_lexical_paths: Vec<PathBuf> = existing_paths
            .iter()
            .filter(|path| !seen_paths.contains(*path))
            .cloned()
            .collect();
        for path in &stale_lexical_paths {
            self.lexical.remove_note(path)?;
        }
        let projection_payloads: Vec<ProjectionPayload> = updates
            .iter()
            .map(|(path, note)| ProjectionPayload::Upsert {
                path: path.clone(),
                note: note.clone(),
            })
            .chain(
                stale_lexical_paths
                    .iter()
                    .map(|path| ProjectionPayload::Remove { path: path.clone() }),
            )
            .collect();
        let changed = {
            let mut index = self
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            index.apply_refresh_updates(updates, seen_paths)
        };
        for payload in projection_payloads {
            apply_projection_payload(payload);
        }
        let mut invalidation = self
            .interactive_invalidation
            .lock()
            .map_err(|_| "Interactive invalidation lock poisoned".to_string())?;
        invalidation.full_refresh_count = invalidation.full_refresh_count.wrapping_add(1);
        Ok(changed)
    }

    /// Background reconciliation: rescans the vault on disk and applies
    /// any updates the watcher may have missed. Designed to be invoked
    /// from a long-running background thread; the foreground hot path
    /// never calls this directly.
    pub(crate) fn reconcile_full_vault_scan(&self, notes_dir: &Path) -> Result<bool, String> {
        self.run_full_refresh(notes_dir)
    }

    /// Lightweight cold-start prewarm. Populates the in-memory
    /// `notes_index` (so `prune_state_in_place` resolves note ids via
    /// O(1) hashmap lookups and so the first search/recents/wikilinks
    /// call does not pay the full-vault scan) without performing the
    /// heavy lexical writer commits or per-note SQLite task projection
    /// transactions inline.
    ///
    /// Why this matters: the previous prewarm walked the vault, then on
    /// the same thread did N lexical commits and N SQLite transactions
    /// (one per note). The lexical writer mutex and the global SQLite
    /// state mutex are also taken by foreground commands (`open_note`,
    /// `load_note_session`, search, recents). On a vault with a few
    /// hundred notes, that loop monopolised the SQLite mutex for several
    /// seconds and the first user-driven note switch waited behind it.
    ///
    /// New shape:
    ///
    /// 1. Off-lock disk pass collects updates (unchanged).
    /// 2. A single brief `notes_index` lock swap inserts every entry.
    ///    `notes_index` is a plain in-memory map with no IPC contention,
    ///    so the swap is cheap.
    /// 3. The heavy lexical + SQLite projection writes are enqueued onto
    ///    the existing [`crate::services::BackgroundIndexQueue`]. The
    ///    queue worker yields between jobs while the foreground is
    ///    busy, so a user-driven `open_note` is no longer queued
    ///    behind hundreds of projection transactions.
    ///
    /// The 60-second background reconciler still calls the heavier
    /// [`AppState::reconcile_full_vault_scan`], which catches genuine
    /// drift after the foreground has settled.
    pub(crate) fn prewarm_notes_index(&self, notes_dir: &Path) -> Result<bool, String> {
        let existing_signatures = {
            let index = self
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            index
                .entries
                .iter()
                .map(|(path, note)| (path.clone(), note.signature.clone()))
                .collect::<HashMap<_, _>>()
        };
        let (updates, seen_paths) = collect_refresh_updates(notes_dir, &existing_signatures)?;

        // Capture payloads for the background queue before we move
        // `updates` into the in-memory swap below. The queue applies
        // each (path, note) to the lexical writer and to the SQLite
        // task projection one entry at a time, yielding while the
        // foreground is busy.
        let queue_payloads: Vec<(PathBuf, IndexedNote)> = updates
            .iter()
            .map(|(path, note)| (path.clone(), note.clone()))
            .collect();

        let changed = {
            let mut index = self
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            index.apply_refresh_updates(updates, seen_paths)
        };

        for (path, note) in queue_payloads {
            self.background_index_queue.enqueue_upsert(path, note);
        }

        let mut invalidation = self
            .interactive_invalidation
            .lock()
            .map_err(|_| "Interactive invalidation lock poisoned".to_string())?;
        invalidation.full_refresh_count = invalidation.full_refresh_count.wrapping_add(1);
        Ok(changed)
    }

    fn clear_dirty_path(&self, path: &Path) -> Result<(), String> {
        let mut invalidation = self
            .interactive_invalidation
            .lock()
            .map_err(|_| "Interactive invalidation lock poisoned".to_string())?;
        invalidation.dirty_paths.remove(path);
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct NotesIndex {
    pub(crate) entries: HashMap<PathBuf, IndexedNote>,
    by_id: HashMap<String, PathBuf>,
    /// Pre-built read model of open (non-completed) tasks for the
    /// `list_recent_*` focus path. Maintained on every `insert_entry` /
    /// `remove_entry` so the focus loader does not have to walk every
    /// `IndexedNote` and re-clone per-task strings on each invocation.
    /// Notes with zero open tasks contribute nothing — they are absent
    /// from the map entirely.
    open_tasks_by_path: HashMap<PathBuf, Vec<OpenTaskSummary>>,
    last_refresh_at: Option<Instant>,
    revision: u64,
}

/// Pre-computed slice of an open task plus the surrounding note metadata
/// the focus loader needs. Strings are cloned once at index-update time
/// so the read path can hand out `&OpenTaskSummary` borrows without
/// touching `IndexedNote` again. Retained primarily for the in-memory
/// open-task tests; the production focus path now reads from the
/// SQLite-backed task projection.
#[allow(dead_code)]
#[derive(Clone)]
pub(crate) struct OpenTaskSummary {
    pub(crate) note_id: String,
    pub(crate) task_key: String,
    pub(crate) note_path_string: String,
    pub(crate) note_title: String,
    pub(crate) text: String,
    pub(crate) line_number: usize,
    pub(crate) note_modified_millis: u64,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct FileSignature {
    modified_millis: u64,
    len: u64,
}

#[derive(Clone)]
pub(crate) struct IndexedParagraphLine {
    pub(crate) start_offset: usize,
    pub(crate) end_offset: usize,
    pub(crate) line_number: usize,
}

#[derive(Clone)]
pub(crate) struct IndexedParagraph {
    pub(crate) section_label: String,
    pub(crate) text: String,
    pub(crate) text_lower: String,
    pub(crate) paragraph_index: Option<usize>,
    pub(crate) lines: Vec<IndexedParagraphLine>,
}

#[derive(Clone)]
pub(crate) struct IndexedTask {
    pub(crate) section_label: Option<String>,
    pub(crate) text: String,
    pub(crate) completed: bool,
    pub(crate) depth: usize,
    pub(crate) line_number: usize,
    /// 1-based line number in the editor body (`strip_leading_title_heading(strip_frontmatter(file))`).
    pub(crate) editor_line_number: Option<usize>,
}

#[derive(Clone)]
pub(crate) struct IndexedNote {
    signature: FileSignature,
    pub(crate) note_id: String,
    pub(crate) modified_millis: u64,
    pub(crate) document_kind: DocumentKind,
    pub(crate) title: String,
    pub(crate) title_lower: String,
    pub(crate) file_name: String,
    pub(crate) file_name_lower: String,
    pub(crate) paragraphs: Vec<IndexedParagraph>,
    pub(crate) tasks: Vec<IndexedTask>,
}

impl NotesIndex {
    pub(crate) fn upsert_note(&mut self, path: PathBuf, note: IndexedNote) -> bool {
        if self
            .entries
            .get(&path)
            .is_some_and(|existing_note| existing_note.signature() == note.signature())
        {
            return false;
        }

        self.insert_entry(path, note);
        self.last_refresh_at = Some(Instant::now());
        self.revision = self.revision.wrapping_add(1);
        true
    }

    pub(crate) fn remove_note(&mut self, path: &Path) -> bool {
        if self.remove_entry(path).is_none() {
            return false;
        }
        self.last_refresh_at = Some(Instant::now());
        self.revision = self.revision.wrapping_add(1);
        true
    }

    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }

    pub(crate) fn path_for_note_id(&self, note_id: &str) -> Option<&PathBuf> {
        self.by_id.get(note_id)
    }

    pub(crate) fn get_note_by_note_id(&self, note_id: &str) -> Option<(&PathBuf, &IndexedNote)> {
        self.by_id
            .get(note_id)
            .and_then(|path| self.entries.get(path).map(|note| (path, note)))
    }

    /// Iterate the maintained open-task read model. Each yielded slice
    /// contains the open tasks of a single note, keyed by its absolute
    /// path; notes with no open tasks are absent from the iterator.
    #[allow(dead_code)]
    pub(crate) fn open_task_summaries(
        &self,
    ) -> impl Iterator<Item = (&PathBuf, &Vec<OpenTaskSummary>)> {
        self.open_tasks_by_path.iter()
    }

    fn insert_entry(&mut self, path: PathBuf, note: IndexedNote) {
        if let Some(previous) = self.entries.get(&path) {
            if previous.note_id != note.note_id {
                let stale = self.by_id.get(&previous.note_id).cloned();
                if stale.as_deref() == Some(path.as_path()) {
                    self.by_id.remove(&previous.note_id);
                }
            }
        }
        self.by_id.insert(note.note_id.clone(), path.clone());
        let summaries = build_open_task_summaries(&path, &note);
        if summaries.is_empty() {
            self.open_tasks_by_path.remove(&path);
        } else {
            self.open_tasks_by_path.insert(path.clone(), summaries);
        }
        self.entries.insert(path, note);
    }

    fn remove_entry(&mut self, path: &Path) -> Option<IndexedNote> {
        let removed = self.entries.remove(path)?;
        if self.by_id.get(&removed.note_id).map(PathBuf::as_path) == Some(path) {
            self.by_id.remove(&removed.note_id);
        }
        self.open_tasks_by_path.remove(path);
        Some(removed)
    }

    fn apply_pending_updates(&mut self, updates: Vec<PendingIndexUpdate>) -> bool {
        let mut changed = false;
        for update in updates {
            match update {
                PendingIndexUpdate::Upsert(path, note) => {
                    self.insert_entry(path, note);
                    changed = true;
                }
                PendingIndexUpdate::Remove(path) => {
                    changed = self.remove_entry(&path).is_some() || changed;
                }
            }
        }
        changed
    }

    fn apply_refresh_updates(
        &mut self,
        updates: Vec<(PathBuf, IndexedNote)>,
        seen_paths: HashSet<PathBuf>,
    ) -> bool {
        let mut changed = false;
        for (path, note) in updates {
            self.insert_entry(path, note);
            changed = true;
        }

        let stale_paths = self
            .entries
            .keys()
            .filter(|path| !seen_paths.contains(*path))
            .cloned()
            .collect::<Vec<_>>();
        for stale_path in stale_paths {
            changed = self.remove_entry(&stale_path).is_some() || changed;
        }

        self.mark_refreshed(changed);
        changed
    }

    fn mark_refreshed(&mut self, changed: bool) {
        self.last_refresh_at = Some(Instant::now());
        if changed {
            self.revision = self.revision.wrapping_add(1);
        }
    }
}

/// Pre-build the open-task summaries for a single note. Returns an empty
/// vector for notes whose tasks are all completed; the index drops empty
/// entries entirely so iteration only walks notes with open work.
fn build_open_task_summaries(path: &Path, note: &IndexedNote) -> Vec<OpenTaskSummary> {
    let mut summaries = Vec::new();
    let mut path_string: Option<String> = None;
    for task in &note.tasks {
        if task.completed {
            continue;
        }
        let raw_path = path_string
            .get_or_insert_with(|| path.to_string_lossy().into_owned())
            .clone();
        summaries.push(OpenTaskSummary {
            note_id: note.note_id.clone(),
            task_key: task_key(&note.note_id, task),
            note_path_string: raw_path,
            note_title: note.title.clone(),
            text: task.text.clone(),
            line_number: task.line_number,
            note_modified_millis: note.modified_millis,
        });
    }
    summaries
}

fn collect_dirty_updates(
    dirty_paths: Vec<PathBuf>,
    existing_signatures: &HashMap<PathBuf, FileSignature>,
) -> Result<Vec<PendingIndexUpdate>, String> {
    let mut updates = Vec::new();

    for path in dirty_paths {
        if is_note_file(&path) {
            let signature = read_file_signature(&path)?;
            if existing_signatures
                .get(&path)
                .is_some_and(|existing_signature| existing_signature == &signature)
            {
                continue;
            }
            updates.push(PendingIndexUpdate::Upsert(
                path.clone(),
                load_indexed_note(&path, signature)?,
            ));
        } else {
            updates.push(PendingIndexUpdate::Remove(path));
        }
    }

    Ok(updates)
}

fn collect_refresh_updates(
    notes_dir: &Path,
    existing_signatures: &HashMap<PathBuf, FileSignature>,
) -> Result<(Vec<(PathBuf, IndexedNote)>, HashSet<PathBuf>), String> {
    let mut seen_paths = HashSet::new();
    let mut updates = Vec::new();

    for path in collect_markdown_files_recursively(notes_dir)? {
        seen_paths.insert(path.clone());
        let signature = read_file_signature(&path)?;
        let should_reload = existing_signatures
            .get(&path)
            .map(|existing_signature| existing_signature != &signature)
            .unwrap_or(true);

        if should_reload {
            updates.push((path.clone(), load_indexed_note(&path, signature)?));
        }
    }

    Ok((updates, seen_paths))
}

impl IndexedNote {
    pub(crate) fn signature(&self) -> &FileSignature {
        &self.signature
    }
}

pub(crate) fn is_note_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

pub(crate) fn build_current_override(
    current_path: Option<&Path>,
    current_title: &str,
    markdown: &str,
) -> Option<IndexedNote> {
    if markdown.trim().is_empty() && current_path.is_none() && current_title.trim().is_empty() {
        return None;
    }

    Some(build_current_override_with_signature(
        current_path,
        current_title,
        markdown,
        FileSignature {
            modified_millis: 0,
            len: markdown.len() as u64,
        },
    ))
}

pub(crate) fn build_indexed_note(path: &Path, markdown: &str, modified_millis: u64) -> IndexedNote {
    build_indexed_note_with_signature(
        Some(path),
        markdown,
        FileSignature {
            modified_millis,
            len: markdown.len() as u64,
        },
    )
}

pub(crate) fn task_key(note_id: &str, task: &IndexedTask) -> String {
    format!(
        "{}::{}::{}::{}",
        note_id,
        task.line_number,
        task.section_label.as_deref().unwrap_or_default(),
        task.text.to_lowercase()
    )
}

pub(crate) fn toggle_task_in_markdown(
    markdown: &str,
    line_number: usize,
    task_text: &str,
) -> Result<String, String> {
    let normalized = markdown.replace("\r\n", "\n");
    let had_trailing_newline = normalized.ends_with('\n');
    let mut lines = normalized.lines().map(str::to_string).collect::<Vec<_>>();
    let normalized_task_text = normalize_search_text(task_text);

    if lines.is_empty() {
        return Err("Task not found".to_string());
    }

    let preferred_index = line_number.saturating_sub(1);
    if preferred_index < lines.len()
        && task_line_matches(&lines[preferred_index], &normalized_task_text)
        && toggle_task_line(&mut lines[preferred_index]).is_some()
    {
        return Ok(join_task_lines(lines, had_trailing_newline));
    }

    let fallback_index = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| task_line_matches(line, &normalized_task_text))
        .min_by_key(|(index, _)| index.abs_diff(preferred_index))
        .map(|(index, _)| index)
        .ok_or_else(|| "Task not found".to_string())?;

    toggle_task_line(&mut lines[fallback_index]).ok_or_else(|| "Task not found".to_string())?;
    Ok(join_task_lines(lines, had_trailing_newline))
}

pub(crate) fn delete_task_in_markdown(
    markdown: &str,
    line_number: usize,
    task_text: &str,
) -> Result<String, String> {
    let normalized = markdown.replace("\r\n", "\n");
    let had_trailing_newline = normalized.ends_with('\n');
    let mut lines = normalized.lines().map(str::to_string).collect::<Vec<_>>();
    let normalized_task_text = normalize_search_text(task_text);

    if lines.is_empty() {
        return Err("Task not found".to_string());
    }

    let preferred_index = line_number.saturating_sub(1);
    let remove_index = if preferred_index < lines.len()
        && task_line_matches(&lines[preferred_index], &normalized_task_text)
    {
        preferred_index
    } else {
        lines
            .iter()
            .enumerate()
            .filter(|(_, line)| task_line_matches(line, &normalized_task_text))
            .min_by_key(|(index, _)| index.abs_diff(preferred_index))
            .map(|(index, _)| index)
            .ok_or_else(|| "Task not found".to_string())?
    };

    let parent_indent = indentation_width(&lines[remove_index]);
    lines.remove(remove_index);

    // Remove subtasks: any following lines that are task lines with deeper indentation
    while remove_index < lines.len() {
        let line = &lines[remove_index];
        let is_task = parse_task_line(line).is_some();
        let indent = indentation_width(line);
        if is_task && indent > parent_indent {
            lines.remove(remove_index);
        } else {
            break;
        }
    }

    Ok(join_task_lines(lines, had_trailing_newline))
}

pub(crate) fn normalize_search_text(value: &str) -> String {
    collapse_whitespace(value).to_lowercase()
}

pub(crate) fn collapse_whitespace(value: &str) -> String {
    let mut collapsed = String::with_capacity(value.len());
    for segment in value.split_whitespace() {
        if !collapsed.is_empty() {
            collapsed.push(' ');
        }
        collapsed.push_str(segment);
    }
    collapsed
}

fn read_file_signature(path: &Path) -> Result<FileSignature, String> {
    let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|err| err.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();
    let modified = modified.min(u128::from(u64::MAX)) as u64;

    Ok(FileSignature {
        modified_millis: modified,
        len: metadata.len(),
    })
}

fn load_indexed_note(path: &Path, signature: FileSignature) -> Result<IndexedNote, String> {
    let markdown = fs::read_to_string(path).map_err(|err| err.to_string())?;
    Ok(build_indexed_note_with_signature(
        Some(path),
        &markdown,
        signature,
    ))
}

fn build_indexed_note_with_signature(
    path: Option<&Path>,
    markdown: &str,
    signature: FileSignature,
) -> IndexedNote {
    let modified_millis = signature.modified_millis;
    let fallback_file_name = path
        .and_then(|path| path.file_stem())
        .and_then(|file_name| file_name.to_str())
        .filter(|file_name| !file_name.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| derive_file_stem(markdown));

    let (title, body) = note::extract_file_name_title_and_body(markdown, &fallback_file_name);
    let file_name = fallback_file_name;
    let note_id =
        note::note_id_from_path_or_markdown(path, markdown).unwrap_or_else(|| file_name.clone());

    IndexedNote {
        signature,
        note_id,
        modified_millis,
        document_kind: note::document_kind(markdown),
        title: title.clone(),
        title_lower: title.to_lowercase(),
        file_name_lower: file_name.to_lowercase(),
        paragraphs: build_paragraphs(&title, &body),
        tasks: if note::document_kind(markdown) == DocumentKind::Note {
            build_tasks(markdown)
        } else {
            Vec::new()
        },
        file_name,
    }
}

fn build_current_override_with_signature(
    path: Option<&Path>,
    current_title: &str,
    markdown: &str,
    signature: FileSignature,
) -> IndexedNote {
    let modified_millis = signature.modified_millis;
    let file_name = if current_title.trim().is_empty() {
        path.and_then(|path| path.file_stem())
            .and_then(|file_name| file_name.to_str())
            .filter(|file_name| !file_name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| derive_file_stem(markdown))
    } else {
        derive_file_stem_from_title_and_markdown(current_title, markdown)
    };

    let title = current_title.trim().to_string();
    let effective_title = if title.is_empty() {
        file_name.clone()
    } else {
        title
    };
    let note_id =
        note::note_id_from_path_or_markdown(path, markdown).unwrap_or_else(|| file_name.clone());

    IndexedNote {
        signature,
        note_id,
        modified_millis,
        document_kind: note::document_kind(markdown),
        title: effective_title.clone(),
        title_lower: effective_title.to_lowercase(),
        file_name_lower: file_name.to_lowercase(),
        paragraphs: build_paragraphs(&effective_title, markdown),
        tasks: if note::document_kind(markdown) == DocumentKind::Note {
            build_tasks(markdown)
        } else {
            Vec::new()
        },
        file_name,
    }
}

fn build_paragraphs(title: &str, body: &str) -> Vec<IndexedParagraph> {
    let mut paragraphs = Vec::new();

    let normalized_title = collapse_whitespace(title);
    if !normalized_title.is_empty() {
        paragraphs.push(IndexedParagraph {
            section_label: "Title".to_string(),
            text_lower: normalized_title.to_lowercase(),
            text: normalized_title,
            paragraph_index: None,
            lines: Vec::new(),
        });
    }

    let mut current_lines = Vec::new();
    let mut paragraph_number = 0;

    let normalized_body;
    let body = if body.contains("\r\n") {
        normalized_body = body.replace("\r\n", "\n");
        normalized_body.as_str()
    } else {
        body
    };

    for (line_index, line) in body.lines().enumerate() {
        if line.trim().is_empty() {
            if let Some(paragraph) = finalize_paragraph(&current_lines, paragraph_number) {
                paragraph_number += 1;
                paragraphs.push(paragraph);
            }
            current_lines.clear();
            continue;
        }

        current_lines.push((line_index + 1, line.trim()));
    }

    if let Some(paragraph) = finalize_paragraph(&current_lines, paragraph_number) {
        paragraphs.push(paragraph);
    }

    paragraphs
}

fn finalize_paragraph(lines: &[(usize, &str)], paragraph_index: usize) -> Option<IndexedParagraph> {
    let joined = lines
        .iter()
        .map(|(_, line)| *line)
        .collect::<Vec<_>>()
        .join(" ");
    let text = collapse_whitespace(&joined);
    if text.is_empty() {
        return None;
    }

    let mut line_spans = Vec::new();
    let mut cursor = 0usize;
    for (line_number, line) in lines {
        let normalized_line = collapse_whitespace(line);
        if normalized_line.is_empty() {
            continue;
        }

        if cursor > 0 {
            cursor += 1;
        }

        let start_offset = cursor;
        cursor += normalized_line.len();
        line_spans.push(IndexedParagraphLine {
            start_offset,
            end_offset: cursor,
            line_number: *line_number,
        });
    }

    Some(IndexedParagraph {
        section_label: format!("Paragraph {}", paragraph_index + 1),
        text_lower: text.to_lowercase(),
        text,
        paragraph_index: Some(paragraph_index),
        lines: line_spans,
    })
}

fn build_tasks(markdown: &str) -> Vec<IndexedTask> {
    let normalized_markdown;
    let normalized = if markdown.contains("\r\n") {
        normalized_markdown = markdown.replace("\r\n", "\n");
        normalized_markdown.as_str()
    } else {
        markdown
    };
    let lines = normalized.lines().collect::<Vec<_>>();
    let first_content_index = lines.iter().position(|line| !line.trim().is_empty());
    let editor_line_numbers = build_editor_line_number_map(&lines, first_content_index);
    let mut section_label = None;
    let mut indent_levels = Vec::new();
    let mut tasks = Vec::new();

    for (line_index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if Some(line_index) == first_content_index && trimmed.starts_with("# ") {
            continue;
        }

        if let Some(next_heading) = parse_heading(trimmed) {
            section_label = Some(next_heading);
            indent_levels.clear();
            continue;
        }

        if let Some((completed, text, indentation_width)) = parse_task_line(line) {
            let file_line = line_index + 1;
            tasks.push(IndexedTask {
                section_label: section_label.clone(),
                text,
                completed,
                depth: task_depth(indentation_width, &mut indent_levels),
                line_number: file_line,
                editor_line_number: editor_line_numbers[line_index],
            });
        }
    }

    tasks
}

fn build_editor_line_number_map(
    lines: &[&str],
    first_content_index: Option<usize>,
) -> Vec<Option<usize>> {
    let mut editor_line_numbers = vec![None; lines.len()];
    let mut body_start_index = 0usize;

    if lines.first().is_some_and(|line| *line == "---") {
        if let Some(closing_index) = lines
            .iter()
            .enumerate()
            .skip(1)
            .find_map(|(index, line)| (*line == "---").then_some(index))
        {
            body_start_index = closing_index + 1;
            if lines
                .get(body_start_index)
                .is_some_and(|line| line.trim().is_empty())
            {
                body_start_index += 1;
            }
        }
    }

    let first_body_content_index = lines
        .iter()
        .enumerate()
        .skip(body_start_index)
        .find_map(|(index, line)| (!line.trim().is_empty()).then_some(index));
    let stripped_heading_index = first_body_content_index
        .or(first_content_index.filter(|&index| index >= body_start_index))
        .filter(|&index| lines[index].trim().starts_with("# "));
    let stripped_heading_blank_index = stripped_heading_index.and_then(|index| {
        let next_index = index + 1;
        (next_index < lines.len() && lines[next_index].trim().is_empty()).then_some(next_index)
    });

    let mut editor_line_number = 1usize;
    for (index, editor_line) in editor_line_numbers
        .iter_mut()
        .enumerate()
        .skip(body_start_index)
    {
        if Some(index) == stripped_heading_index || Some(index) == stripped_heading_blank_index {
            continue;
        }

        *editor_line = Some(editor_line_number);
        editor_line_number += 1;
    }

    editor_line_numbers
}

fn parse_heading(line: &str) -> Option<String> {
    let heading = line.trim_start_matches('#');
    if heading.len() == line.len() || !line.starts_with('#') {
        return None;
    }

    let heading = heading.trim();
    if heading.is_empty() {
        return None;
    }

    Some(heading.to_string())
}

fn parse_task_line(line: &str) -> Option<(bool, String, usize)> {
    let indentation_width = indentation_width(line);
    let trimmed = line.trim_start();
    let rest = trimmed
        .strip_prefix("* ")
        .or_else(|| trimmed.strip_prefix("- "))?;
    let (completed, text) = if let Some(text) = rest.strip_prefix("[ ]") {
        (false, text)
    } else if let Some(text) = rest
        .strip_prefix("[x]")
        .or_else(|| rest.strip_prefix("[X]"))
    {
        (true, text)
    } else {
        return None;
    };

    let text = collapse_whitespace(text);
    if text.is_empty() {
        return None;
    }

    Some((completed, text, indentation_width))
}

fn indentation_width(line: &str) -> usize {
    line.chars()
        .take_while(|character| character.is_whitespace())
        .map(|character| match character {
            '\t' => 2,
            _ => 1,
        })
        .sum()
}

fn task_depth(indentation_width: usize, indent_levels: &mut Vec<usize>) -> usize {
    while indent_levels
        .last()
        .is_some_and(|level| *level > indentation_width)
    {
        indent_levels.pop();
    }

    if let Some(last_level) = indent_levels.last() {
        if *last_level < indentation_width {
            indent_levels.push(indentation_width);
            return indent_levels.len() - 1;
        }

        return indent_levels.len().saturating_sub(1);
    }

    indent_levels.push(indentation_width);
    0
}

fn join_task_lines(lines: Vec<String>, had_trailing_newline: bool) -> String {
    let mut markdown = lines.join("\n");
    if had_trailing_newline {
        markdown.push('\n');
    }
    markdown
}

fn task_line_matches(line: &str, normalized_task_text: &str) -> bool {
    parse_task_line(line).is_some_and(|(_, text, _)| {
        normalized_task_text.is_empty() || normalize_search_text(&text) == normalized_task_text
    })
}

fn toggle_task_line(line: &mut String) -> Option<()> {
    let indentation_len = line.len() - line.trim_start().len();
    let indentation = &line[..indentation_len];
    let trimmed = &line[indentation_len..];
    let (bullet, rest) = if let Some(rest) = trimmed.strip_prefix("* ") {
        ("* ", rest)
    } else if let Some(rest) = trimmed.strip_prefix("- ") {
        ("- ", rest)
    } else {
        return None;
    };

    let toggled_rest = if let Some(rest) = rest.strip_prefix("[ ]") {
        format!("[x]{rest}")
    } else if let Some(rest) = rest
        .strip_prefix("[x]")
        .or_else(|| rest.strip_prefix("[X]"))
    {
        format!("[ ]{rest}")
    } else {
        return None;
    };

    *line = format!("{indentation}{bullet}{toggled_rest}");
    Some(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_indexed_note, build_tasks, collect_dirty_updates, collect_refresh_updates,
        read_file_signature, toggle_task_in_markdown, AppState, Duration, NotesIndex,
    };
    use crate::test_support::{fixture_path, load_fixture, load_json_fixture, TestDir};
    use serde_json::json;
    use std::{collections::HashMap, fs, path::PathBuf};

    #[test]
    fn build_indexed_note_matches_project_atlas_fixture() {
        let markdown = load_fixture("project-atlas.md");
        let note = build_indexed_note(&fixture_path("project-atlas.md"), &markdown, 42);

        let actual = json!({
            "title": note.title,
            "fileName": note.file_name,
            "paragraphs": note.paragraphs.iter().map(|paragraph| json!({
                "sectionLabel": paragraph.section_label,
                "text": paragraph.text,
            })).collect::<Vec<_>>(),
            "tasks": note.tasks.iter().map(|task| json!({
                "sectionLabel": task.section_label,
                "text": task.text,
                "completed": task.completed,
                "depth": task.depth,
                "lineNumber": task.line_number,
                "editorLineNumber": task.editor_line_number,
            })).collect::<Vec<_>>(),
        });

        assert_eq!(actual, load_json_fixture("project-atlas.index.json"));
    }

    #[test]
    fn toggle_task_in_markdown_uses_exact_line_then_nearest_match() {
        let markdown = "\
# Duplicate Tasks

- [ ] Review search ranking
- [ ] Another task
- [ ] Review search ranking
";

        let exact_toggle = toggle_task_in_markdown(markdown, 5, "Review search ranking")
            .expect("toggle exact line");
        let exact_lines = exact_toggle.lines().collect::<Vec<_>>();
        assert_eq!(exact_lines[2], "- [ ] Review search ranking");
        assert_eq!(exact_lines[4], "- [x] Review search ranking");

        let fallback_toggle = toggle_task_in_markdown(markdown, 99, "Review search ranking")
            .expect("toggle nearest line");
        let fallback_lines = fallback_toggle.lines().collect::<Vec<_>>();
        assert_eq!(fallback_lines[2], "- [ ] Review search ranking");
        assert_eq!(fallback_lines[4], "- [x] Review search ranking");
    }

    #[test]
    fn build_tasks_maps_editor_lines_without_matching_duplicate_text() {
        let markdown = "\
---
gneauxghts:
  id: 01TEST
---

# Duplicate Tasks

- [ ] Review search ranking
- [ ] Another task
- [ ] Review search ranking
";

        let tasks = build_tasks(markdown);

        assert_eq!(tasks.len(), 3);
        assert_eq!(tasks[0].line_number, 8);
        assert_eq!(tasks[0].editor_line_number, Some(1));
        assert_eq!(tasks[2].line_number, 10);
        assert_eq!(tasks[2].editor_line_number, Some(3));
    }

    #[test]
    fn build_tasks_maps_crlf_editor_lines() {
        let markdown = "# Tasks\r\n\r\n- [ ] First\r\n- [x] Second\r\n";

        let tasks = build_tasks(markdown);

        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].line_number, 3);
        assert_eq!(tasks[0].editor_line_number, Some(1));
        assert_eq!(tasks[1].line_number, 4);
        assert_eq!(tasks[1].editor_line_number, Some(2));
    }

    #[test]
    fn dirty_update_skips_unchanged_file_signatures() {
        let temp = TestDir::new("index-dirty-unchanged");
        let note_path = temp.path().join("Stable.md");
        fs::write(&note_path, "# Stable\n\n- [ ] Ship").expect("write note");
        let signature = read_file_signature(&note_path).expect("read signature");
        let mut existing_signatures = HashMap::new();
        existing_signatures.insert(note_path.clone(), signature);

        let updates =
            collect_dirty_updates(vec![note_path], &existing_signatures).expect("collect updates");

        assert!(updates.is_empty());
    }

    #[test]
    fn full_refresh_collects_no_updates_for_unchanged_signatures() {
        let temp = TestDir::new("index-refresh-unchanged");
        let note_path = temp.path().join("Stable.md");
        fs::write(&note_path, "# Stable\n\nBody").expect("write note");
        let signature = read_file_signature(&note_path).expect("read signature");
        let mut existing_signatures = HashMap::new();
        existing_signatures.insert(note_path.clone(), signature);

        let (updates, seen_paths) =
            collect_refresh_updates(temp.path(), &existing_signatures).expect("collect refresh");

        assert!(updates.is_empty());
        assert!(seen_paths.contains(&note_path));
    }

    #[test]
    fn open_task_summaries_track_only_open_tasks_and_drop_completed_notes() {
        let temp = TestDir::new("index-open-task-summaries");
        let mixed_path = temp.path().join("Mixed.md");
        let completed_only_path = temp.path().join("Done.md");
        fs::write(
            &mixed_path,
            "# Mixed\n\n- [ ] Open one\n- [x] Done one\n- [ ] Open two\n",
        )
        .expect("write mixed note");
        fs::write(&completed_only_path, "# Done\n\n- [x] Already done\n")
            .expect("write completed note");

        let mut index = NotesIndex::default();
        let mixed_note = build_indexed_note(
            &mixed_path,
            &fs::read_to_string(&mixed_path).expect("read mixed"),
            10,
        );
        let completed_note = build_indexed_note(
            &completed_only_path,
            &fs::read_to_string(&completed_only_path).expect("read completed"),
            20,
        );
        index.upsert_note(mixed_path.clone(), mixed_note);
        index.upsert_note(completed_only_path.clone(), completed_note);

        let mut summaries: Vec<&PathBuf> =
            index.open_task_summaries().map(|(path, _)| path).collect();
        summaries.sort();
        assert_eq!(summaries, vec![&mixed_path]);

        let mixed_open: Vec<String> = index
            .open_task_summaries()
            .find(|(path, _)| *path == &mixed_path)
            .map(|(_, summaries)| summaries.iter().map(|task| task.text.clone()).collect())
            .unwrap_or_default();
        assert_eq!(
            mixed_open,
            vec!["Open one".to_string(), "Open two".to_string()]
        );

        // Replace mixed note with one whose tasks are all complete; entry
        // should disappear from the maintained read model.
        fs::write(&mixed_path, "# Mixed\n\n- [x] Closed\n").expect("rewrite mixed");
        let next_mixed = build_indexed_note(
            &mixed_path,
            &fs::read_to_string(&mixed_path).expect("read mixed"),
            30,
        );
        index.upsert_note(mixed_path.clone(), next_mixed);
        let summaries: Vec<&PathBuf> = index.open_task_summaries().map(|(path, _)| path).collect();
        assert!(
            summaries.is_empty(),
            "completed-only notes should not show up"
        );

        // Removing a path drops its entry too.
        index.remove_note(&completed_only_path);
        assert!(index.open_task_summaries().next().is_none());
    }

    #[test]
    fn prewarm_notes_index_populates_in_memory_map_and_warms_state() {
        use crate::semantic::SemanticState;

        let temp = TestDir::new("index-prewarm-warms");
        fs::write(temp.path().join("Alpha.md"), "# Alpha\n\nBody").expect("write alpha");
        fs::write(temp.path().join("Beta.md"), "# Beta\n\nBody").expect("write beta");

        let state =
            AppState::new(SemanticState::new_disabled("disabled")).expect("construct app state");
        assert!(!state.has_warm_notes_index(), "starts cold");

        state
            .prewarm_notes_index(temp.path())
            .expect("prewarm completes");

        // The in-memory map must be populated (so prune resolves note
        // ids via O(1) lookups) and the warm flag must flip.
        assert_eq!(state.notes_index.lock().unwrap().entries.len(), 2);
        assert!(state.has_warm_notes_index(), "prewarm warms the index");
    }

    #[test]
    fn background_queue_yields_to_foreground_then_drains() {
        use crate::semantic::SemanticState;

        let temp = TestDir::new("index-bg-queue-yields");
        let note_path = temp.path().join("Solo.md");
        fs::write(&note_path, "# Solo\n\nBody").expect("write solo");

        let state =
            AppState::new(SemanticState::new_disabled("disabled")).expect("construct app state");

        // Hold a foreground guard, then push the note's payload through
        // the prewarm — which enqueues it to the background queue. The
        // queue worker should observe `is_busy() == true` and yield
        // before processing, so the job stays unprocessed.
        let guard = state.foreground_guard();
        state
            .prewarm_notes_index(temp.path())
            .expect("prewarm completes");
        // Give the worker a window to (incorrectly) process the job.
        std::thread::sleep(Duration::from_millis(100));
        // The notes_index map is populated regardless (that work happens
        // on the prewarm thread, not the queue), so we use the lexical
        // signatures map as the "did the queue process the job yet"
        // signal: `lexical.upsert_note` is what the queue calls.
        assert!(
            !state.lexical.contains_signature_for_test(&note_path),
            "queue must not process while foreground guard is alive"
        );

        // Release the guard; the worker should now drain the job.
        drop(guard);
        let drained_at = std::time::Instant::now();
        loop {
            if state.lexical.contains_signature_for_test(&note_path) {
                break;
            }
            if drained_at.elapsed() > Duration::from_secs(5) {
                panic!("queue did not drain after foreground released");
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn foreground_guard_marks_state_busy_until_dropped() {
        use crate::semantic::SemanticState;

        let state =
            AppState::new(SemanticState::new_disabled("disabled")).expect("construct app state");
        assert!(!state.is_foreground_busy(), "starts idle");

        let outer = state.foreground_guard();
        assert!(state.is_foreground_busy(), "guard marks busy");

        let inner = state.foreground_guard();
        assert!(state.is_foreground_busy(), "still busy with two guards");
        drop(inner);
        assert!(state.is_foreground_busy(), "still busy with one guard left");

        drop(outer);
        assert!(!state.is_foreground_busy(), "idle once both dropped");
    }

    #[test]
    fn ensure_interactive_index_skips_full_scan_after_cold_start() {
        use crate::semantic::SemanticState;

        let temp = TestDir::new("index-skip-full-scan");
        fs::write(temp.path().join("First.md"), "# First\n\nBody").expect("write first");

        let state =
            AppState::new(SemanticState::new_disabled("disabled")).expect("construct app state");

        // First call is the cold start: this is allowed to do a full scan.
        state
            .ensure_interactive_index(temp.path(), Duration::from_millis(0), "test_cold")
            .expect("cold start");
        let cold_full_refresh_count = state
            .interactive_invalidation
            .lock()
            .unwrap()
            .full_refresh_count;
        assert_eq!(
            cold_full_refresh_count, 1,
            "cold start must populate the index"
        );

        // Now write a new file *without* invalidating dirty paths and
        // pause past the legacy max-age. The foreground call must NOT do
        // another full scan; it should leave the new file unseen until
        // the watcher (or background reconciliation) reports it.
        fs::write(temp.path().join("Second.md"), "# Second\n\nBody").expect("write second");
        std::thread::sleep(Duration::from_millis(50));
        state
            .ensure_interactive_index(temp.path(), Duration::from_millis(10), "test_warm")
            .expect("warm call");
        let warm_full_refresh_count = state
            .interactive_invalidation
            .lock()
            .unwrap()
            .full_refresh_count;
        assert_eq!(
            cold_full_refresh_count, warm_full_refresh_count,
            "warm call must not increment the full-refresh counter"
        );
        assert_eq!(
            state.notes_index.lock().unwrap().entries.len(),
            1,
            "warm foreground path must not pick up new files on its own"
        );

        // Background reconciliation, on the other hand, *does* discover
        // the new file.
        state
            .reconcile_full_vault_scan(temp.path())
            .expect("reconcile");
        assert_eq!(state.notes_index.lock().unwrap().entries.len(), 2);
    }

    #[test]
    fn refresh_discovers_nested_notes_and_skips_hidden_directories() {
        let temp = TestDir::new("index-refresh-nested");
        let nested_dir = temp.path().join("Projects");
        let hidden_dir = temp.path().join(".obsidian");
        fs::create_dir_all(&nested_dir).expect("create nested dir");
        fs::create_dir_all(&hidden_dir).expect("create hidden dir");

        let nested_note = nested_dir.join("Roadmap.md");
        let hidden_note = hidden_dir.join("Hidden.md");
        fs::write(&nested_note, "# Roadmap\n\nBody").expect("write nested note");
        fs::write(&hidden_note, "# Hidden\n\nBody").expect("write hidden note");

        let mut index = NotesIndex::default();
        let (updates, seen_paths) =
            collect_refresh_updates(temp.path(), &HashMap::new()).expect("collect refresh updates");
        index.apply_refresh_updates(updates, seen_paths);

        assert_eq!(index.entries.len(), 1);
        assert!(index.entries.contains_key(&nested_note));
        assert!(!index.entries.contains_key(&hidden_note));
    }
}
