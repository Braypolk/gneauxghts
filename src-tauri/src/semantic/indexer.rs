use super::{
    activity::BackgroundWorkGate,
    ann::{AnnIndexState, ANN_MAX_INCREMENTAL_CHUNKS, ANN_MAX_INCREMENTAL_DOCUMENTS},
    atlas::{
        atlas_structural_build_covers_epoch, atlas_visibilities_for_mutation_batch,
        AtlasGenerationKey, AtlasLabelRequest, AtlasWorkerContext, ATLAS_DEPENDENCIES_NOT_READY,
    },
    chunking::{chunk_markdown, ChunkedNote},
    db::{
        content_hash, delete_note, edge_dirty_count, edge_generation_requires_full_rebuild,
        ensure_schema, insert_job, load_existing_chunk_embeddings, load_note_ann_index_signature,
        load_note_chunk_labels, load_note_record, load_stored_note_records, move_note,
        open_database, rebuild_edges_with_provenance, repair_dirty_edges, update_job,
        update_moved_note_metadata, upsert_note_chunks, EdgeRebuildStats, SemanticNoteMetadata,
    },
    debug::SemanticDebugState,
    embed::{EmbeddingInputKind, EmbeddingProvider, EMBEDDING_BATCH_SIZE},
    note_ann::NoteAnnIndexState,
    RuntimeState, SemanticHealth, SEMANTIC_RETRY_MAX_ATTEMPTS,
};
use crate::{
    note, path_utils::collect_markdown_files_recursively, state::derive_file_stem,
    time::current_time_millis,
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc, Condvar, Mutex,
    },
    thread,
    time::UNIX_EPOCH,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ChatRecallExcerpt {
    pub(crate) anchor: String,
    pub(crate) quote: String,
}

pub(crate) fn chat_recall_content_hash(excerpts: &[ChatRecallExcerpt]) -> String {
    let identity = excerpts
        .iter()
        .map(|excerpt| format!("{}\0{}", excerpt.anchor, excerpt.quote))
        .collect::<Vec<_>>()
        .join("\0");
    content_hash(&identity)
}

#[derive(Clone)]
pub(crate) enum PendingSemanticDocument {
    NoteMarkdown(String),
    ChatRecall {
        title: String,
        excerpts: Vec<ChatRecallExcerpt>,
    },
}

#[derive(Clone)]
pub(crate) struct PendingNoteUpdate {
    pub(crate) document: PendingSemanticDocument,
    pub(crate) modified_millis: u64,
}

/// A note that moved on disk (rename or relocation) with unchanged content.
/// Carries the freshest metadata so the destination row reflects the new path
/// without re-embedding.
#[derive(Clone)]
pub(crate) struct PendingNoteMove {
    pub(crate) new_path: PathBuf,
    pub(crate) markdown: String,
    pub(crate) modified_millis: u64,
}

#[derive(Clone)]
struct SemanticDocumentBatch {
    updates: HashMap<PathBuf, PendingNoteUpdate>,
    deletes: HashSet<PathBuf>,
    moves: HashMap<PathBuf, PendingNoteMove>,
}

impl SemanticDocumentBatch {
    fn new(
        updates: HashMap<PathBuf, PendingNoteUpdate>,
        deletes: HashSet<PathBuf>,
        moves: HashMap<PathBuf, PendingNoteMove>,
    ) -> Self {
        Self {
            updates,
            deletes,
            moves,
        }
    }

    fn len(&self) -> usize {
        self.updates.len() + self.deletes.len() + self.moves.len()
    }
}

#[derive(Clone, Default)]
pub(crate) struct PendingIndexState {
    pub(crate) image_scan_requested: bool,
    pub(crate) full_scan_requested: bool,
    pub(crate) force_full_scan: bool,
    pub(crate) rebuild_requested: bool,
    pub(crate) automatic_rebuild_requested: bool,
    pub(crate) edge_refresh_requested: bool,
    pub(crate) snapshot_publish_requested: bool,
    pub(crate) note_updates: HashMap<PathBuf, PendingNoteUpdate>,
    pub(crate) deleted_notes: HashSet<PathBuf>,
    /// Keyed by the OLD path; value carries the new path + content. Processed
    /// before updates/deletes so a re-key reuses existing embeddings.
    pub(crate) moved_notes: HashMap<PathBuf, PendingNoteMove>,
    pub(crate) atlas_requests: HashMap<AtlasGenerationKey, u64>,
    pub(crate) atlas_building: HashMap<AtlasGenerationKey, u64>,
    pub(crate) atlas_label_requests: HashMap<AtlasGenerationKey, AtlasLabelRequest>,
    pub(crate) atlas_label_building: HashSet<AtlasGenerationKey>,
}

impl PendingIndexState {
    fn is_empty(&self) -> bool {
        !self.full_scan_requested
            && !self.image_scan_requested
            && !self.rebuild_requested
            && !self.automatic_rebuild_requested
            && !self.edge_refresh_requested
            && !self.snapshot_publish_requested
            && self.note_updates.is_empty()
            && self.deleted_notes.is_empty()
            && self.moved_notes.is_empty()
            && self.atlas_requests.is_empty()
            && self.atlas_label_requests.is_empty()
    }
}

pub(crate) enum WorkerSignal {
    Wake,
    Barrier(Sender<()>),
    Shutdown,
}

#[derive(Clone)]
pub(crate) struct SemanticWorkQueue {
    signal_tx: Sender<WorkerSignal>,
    pending: Arc<Mutex<PendingIndexState>>,
    wake_pending: Arc<AtomicBool>,
    accepting: Arc<Mutex<bool>>,
    changed: Arc<Condvar>,
    change_version: Arc<AtomicU64>,
    active: Arc<(Mutex<usize>, Condvar)>,
}

pub(crate) struct SemanticWorkLease {
    active: Arc<(Mutex<usize>, Condvar)>,
}

impl Drop for SemanticWorkLease {
    fn drop(&mut self) {
        let (lock, settled) = &*self.active;
        if let Ok(mut active) = lock.lock() {
            *active = active.saturating_sub(1);
            if *active == 0 {
                settled.notify_all();
            }
        }
    }
}

impl SemanticWorkQueue {
    pub(crate) fn new(initial: PendingIndexState) -> (Self, Receiver<WorkerSignal>) {
        let (signal_tx, signal_rx) = mpsc::channel();
        (
            Self {
                signal_tx,
                pending: Arc::new(Mutex::new(initial)),
                wake_pending: Arc::new(AtomicBool::new(false)),
                accepting: Arc::new(Mutex::new(true)),
                changed: Arc::new(Condvar::new()),
                change_version: Arc::new(AtomicU64::new(0)),
                active: Arc::new((Mutex::new(0), Condvar::new())),
            },
            signal_rx,
        )
    }

    pub(crate) fn enqueue<R>(
        &self,
        update: impl FnOnce(&mut PendingIndexState) -> R,
    ) -> Result<R, String> {
        let result = self.stage(update)?;
        self.request_wake()?;
        Ok(result)
    }

    pub(crate) fn stage<R>(
        &self,
        update: impl FnOnce(&mut PendingIndexState) -> R,
    ) -> Result<R, String> {
        let accepting = self
            .accepting
            .lock()
            .map_err(|_| "Semantic admission lock poisoned".to_string())?;
        if !*accepting {
            return Err("Semantic maintenance is quiesced for restart".to_string());
        }
        let result = self
            .pending
            .lock()
            .map(|mut pending| update(&mut pending))
            .map_err(|_| "Semantic pending state lock poisoned".to_string());
        self.change_version.fetch_add(1, Ordering::Release);
        self.changed.notify_all();
        result
    }

    pub(crate) fn release_initial_scan(
        &self,
        runtime: &Mutex<RuntimeState>,
        debug: &SemanticDebugState,
    ) {
        if let Ok(now) = current_time_millis() {
            if let Ok(mut runtime) = runtime.lock() {
                runtime.last_scan_requested_at_millis = Some(now);
            }
        }
        debug.record_with_metrics(
            "index",
            "enqueue_full_scan_after_warmup",
            None,
            None,
            |metrics| metrics.index_job_enqueued_count += 1,
        );
        let _ = self.enqueue(|pending| {
            if !pending.rebuild_requested {
                pending.full_scan_requested = true;
            }
        });
    }

    pub(crate) fn request_wake(&self) -> Result<(), String> {
        let accepting = self
            .accepting
            .lock()
            .map_err(|_| "Semantic admission lock poisoned".to_string())?;
        if !*accepting {
            return Err("Semantic maintenance is quiesced for restart".to_string());
        }
        if !self.wake_pending.swap(true, Ordering::AcqRel) {
            self.signal_tx
                .send(WorkerSignal::Wake)
                .map_err(|err| err.to_string())?;
        }
        Ok(())
    }

    fn clear_wake(&self) {
        self.wake_pending.store(false, Ordering::Release);
    }

    pub(crate) fn admit_work(&self) -> Result<SemanticWorkLease, String> {
        let accepting = self
            .accepting
            .lock()
            .map_err(|_| "Semantic admission lock poisoned".to_string())?;
        if !*accepting {
            return Err("Semantic maintenance is quiesced for restart".to_string());
        }
        Ok(self.track_started_work())
    }

    fn track_started_work(&self) -> SemanticWorkLease {
        let (lock, _) = &*self.active;
        if let Ok(mut active) = lock.lock() {
            *active += 1;
        }
        SemanticWorkLease {
            active: Arc::clone(&self.active),
        }
    }

    pub(crate) fn quiesce_and_discard(&self) -> Result<(), String> {
        {
            // Admission and staging share this gate, so a producer either
            // finishes staging before this clear or observes quiescence. No
            // late staged mutation can land after the discard barrier.
            let mut accepting = self
                .accepting
                .lock()
                .map_err(|_| "Semantic admission lock poisoned".to_string())?;
            *accepting = false;
            self.changed.notify_all();
            *self
                .pending
                .lock()
                .map_err(|_| "Semantic pending state lock poisoned".to_string())? =
                PendingIndexState::default();
        }
        // FIFO with previously admitted wakes. The active-work count alone is
        // insufficient because a worker can receive Wake immediately before
        // it increments that count.
        let (barrier_tx, barrier_rx) = mpsc::channel();
        self.signal_tx
            .send(WorkerSignal::Barrier(barrier_tx))
            .map_err(|_| "Semantic indexer unavailable during restart".to_string())?;
        barrier_rx
            .recv()
            .map_err(|_| "Semantic indexer stopped before restart settlement".to_string())?;
        let (lock, settled) = &*self.active;
        let mut active = lock
            .lock()
            .map_err(|_| "Semantic work settlement lock poisoned".to_string())?;
        while *active != 0 {
            active = settled
                .wait(active)
                .map_err(|_| "Semantic work settlement lock poisoned".to_string())?;
        }
        Ok(())
    }

    pub(crate) fn resume_after_failed_restart(&self) -> Result<(), String> {
        *self
            .accepting
            .lock()
            .map_err(|_| "Semantic admission lock poisoned".to_string())? = true;
        Ok(())
    }

    /// Wait only until the next retry/publication deadline or new queue work.
    /// Quiescence/shutdown wakes this same owner immediately, so barriers never
    /// wait for a stale backoff timer. Spurious wakes retain the deadline.
    fn wait_for_delay(&self, delay: Duration) -> bool {
        self.wait_for_delay_observing(delay, || {})
    }

    fn wait_for_delay_observing(&self, delay: Duration, entered: impl FnOnce()) -> bool {
        let Ok(accepting) = self.accepting.lock() else {
            return false;
        };
        let version = self.change_version.load(Ordering::Acquire);
        entered();
        self.changed
            .wait_timeout_while(accepting, delay, |accepting| {
                *accepting && self.change_version.load(Ordering::Acquire) == version
            })
            .map(|(accepting, _)| *accepting)
            .unwrap_or(false)
    }

    fn is_accepting(&self) -> bool {
        self.accepting
            .lock()
            .map(|accepting| *accepting)
            .unwrap_or(false)
    }

    pub(crate) fn stop_worker(&self) -> Result<(), String> {
        if let Ok(mut accepting) = self.accepting.lock() {
            *accepting = false;
            self.changed.notify_all();
        }
        self.signal_tx
            .send(WorkerSignal::Shutdown)
            .map_err(|error| error.to_string())
    }
}

pub(crate) struct IndexingWorkerContext {
    pub(crate) db_path: PathBuf,
    pub(crate) notes_dir: PathBuf,
    pub(crate) provider: Arc<dyn EmbeddingProvider + Send + Sync>,
    pub(crate) ann: Arc<AnnIndexState>,
    pub(crate) note_ann: Arc<NoteAnnIndexState>,
    pub(crate) image_ann: Arc<super::image_ann::ImageAnnIndex>,
    pub(crate) generation: Arc<super::generation::SemanticGeneration>,
    pub(crate) queue: SemanticWorkQueue,
    pub(crate) index_revision: Arc<AtomicU64>,
    pub(crate) runtime: Arc<Mutex<RuntimeState>>,
    pub(crate) debug: Arc<SemanticDebugState>,
    pub(crate) background_gate: Arc<BackgroundWorkGate>,
}

pub(crate) fn spawn_indexing_worker(
    context: IndexingWorkerContext,
    signal_rx: Receiver<WorkerSignal>,
) -> Result<thread::JoinHandle<()>, String> {
    thread::Builder::new()
        .name("semantic-indexer".to_string())
        .spawn(move || {
            run_worker(context, signal_rx);
        })
        .map_err(|err| err.to_string())
}

fn run_worker(context: IndexingWorkerContext, signal_rx: Receiver<WorkerSignal>) {
    loop {
        match signal_rx.recv() {
            Ok(WorkerSignal::Wake) => {
                let _work = context.queue.track_started_work();
                handle_wake(&context);
            }
            Ok(WorkerSignal::Barrier(settled)) => {
                let _ = settled.send(());
            }
            Ok(WorkerSignal::Shutdown) => return,
            Err(_) => return,
        }
    }
}

fn handle_wake(context: &IndexingWorkerContext) {
    // A consumed wake always releases its coalescing flag. If work is paused,
    // resume will request a fresh wake for anything that remains pending.
    context.queue.clear_wake();
    if context.background_gate.is_manually_paused().unwrap_or(true) {
        return;
    }
    process_pending_jobs(context);
}

fn process_pending_jobs(context: &IndexingWorkerContext) {
    process_pending_jobs_with_wait(context, |delay| context.queue.wait_for_delay(delay));
}

// A claim removes only its own inputs. Unselected work and arrivals remain in the
// producer-owned queue, so completing a bulk scan cannot replay stale mutations.
enum SelectedJob {
    Images,
    Rebuild,
    FullScan { force: bool },
    Documents(SemanticDocumentBatch),
    RebuildAnn,
    Snapshot,
    Edges,
    Atlas(HashMap<AtlasGenerationKey, u64>),
    AtlasLabels(HashMap<AtlasGenerationKey, AtlasLabelRequest>),
}

impl SelectedJob {
    fn claim(pending: &mut PendingIndexState) -> Option<Self> {
        Some(if std::mem::take(&mut pending.rebuild_requested) {
            pending.full_scan_requested = false;
            pending.force_full_scan = false;
            Self::Rebuild
        } else if std::mem::take(&mut pending.full_scan_requested) {
            Self::FullScan {
                force: std::mem::take(&mut pending.force_full_scan),
            }
        } else if !pending.note_updates.is_empty()
            || !pending.deleted_notes.is_empty()
            || !pending.moved_notes.is_empty()
        {
            Self::Documents(SemanticDocumentBatch::new(
                std::mem::take(&mut pending.note_updates),
                std::mem::take(&mut pending.deleted_notes),
                std::mem::take(&mut pending.moved_notes),
            ))
        } else if std::mem::take(&mut pending.image_scan_requested) {
            Self::Images
        } else if std::mem::take(&mut pending.automatic_rebuild_requested) {
            // Rebuilding publishes both snapshots, subsuming the existing request.
            pending.snapshot_publish_requested = false;
            Self::RebuildAnn
        } else if std::mem::take(&mut pending.snapshot_publish_requested) {
            Self::Snapshot
        } else if std::mem::take(&mut pending.edge_refresh_requested) {
            Self::Edges
        } else if !pending.atlas_requests.is_empty() {
            Self::Atlas(std::mem::take(&mut pending.atlas_requests))
        } else if !pending.atlas_label_requests.is_empty() {
            Self::AtlasLabels(std::mem::take(&mut pending.atlas_label_requests))
        } else {
            return None;
        })
    }

    fn requeue(self, pending: &mut PendingIndexState) {
        let mut retry = PendingIndexState::default();
        match self {
            Self::Images => retry.image_scan_requested = true,
            Self::Rebuild => retry.rebuild_requested = true,
            Self::FullScan { force } => {
                retry.full_scan_requested = true;
                retry.force_full_scan = force;
            }
            Self::Documents(batch) => {
                retry.note_updates = batch.updates;
                retry.deleted_notes = batch.deletes;
                retry.moved_notes = batch.moves;
            }
            Self::RebuildAnn => retry.automatic_rebuild_requested = true,
            Self::Snapshot => retry.snapshot_publish_requested = true,
            Self::Edges => retry.edge_refresh_requested = true,
            Self::Atlas(requests) => retry.atlas_requests = requests,
            Self::AtlasLabels(requests) => retry.atlas_label_requests = requests,
        }
        merge_retry_batch(pending, retry);
    }
}

fn process_pending_jobs_with_wait(
    context: &IndexingWorkerContext,
    mut wait: impl FnMut(Duration) -> bool,
) {
    let db_path = &context.db_path;
    let provider = &context.provider;
    let ann = &context.ann;
    let note_ann = &context.note_ann;
    let pending = &context.queue.pending;
    let runtime = &context.runtime;
    let debug = &context.debug;
    let background_gate = &context.background_gate;
    if runtime
        .lock()
        .map(|state| state.retry_exhausted)
        .unwrap_or(true)
    {
        return;
    }
    let mut atlas_retry_attempts = HashMap::<AtlasGenerationKey, u32>::new();
    let mut label_retry_attempts = HashMap::<AtlasGenerationKey, u32>::new();
    let mut activation_retry_attempts = 0;
    let cache_dir = db_path
        .parent()
        .map(|parent| parent.join(crate::state::VAULT_CACHE_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(crate::state::VAULT_CACHE_DIR_NAME));
    let cache_dir = if db_path.file_stem().and_then(|s| s.to_str())
        == Some(super::litert::text_namespace().as_str())
    {
        cache_dir.join(super::litert::text_namespace())
    } else {
        cache_dir
    };
    loop {
        if !context.queue.is_accepting() || background_gate.is_manually_paused().unwrap_or(true) {
            return;
        }
        let job = match pending
            .lock()
            .ok()
            .and_then(|mut pending| SelectedJob::claim(&mut pending))
        {
            Some(job) => job,
            None => {
                if !context.generation.is_active() {
                    let activation = (|| {
                        let connection = open_database(db_path)?;
                        let ready = !ann.needs_rebuild() && !note_ann.needs_rebuild();
                        let preparation = context.generation.prepare_activation(
                            &connection,
                            &context.notes_dir,
                            ready,
                        )?;
                        let next = pending
                            .lock()
                            .map_err(|_| "Semantic work queue unavailable")?;
                        if !next.is_empty() {
                            return Ok::<_, String>(ActivationOutcome::WorkQueued);
                        }
                        match preparation {
                            super::generation::ActivationPreparation::Ready(proof) => context
                                .generation
                                .publish(&connection, proof)
                                .map(|published| {
                                    if published {
                                        ActivationOutcome::Settled
                                    } else {
                                        ActivationOutcome::Retry
                                    }
                                }),
                            super::generation::ActivationPreparation::StaleSources => {
                                drop(next);
                                context.queue.enqueue(|p| p.full_scan_requested = true)?;
                                Ok(ActivationOutcome::WorkQueued)
                            }
                            super::generation::ActivationPreparation::Waiting => {
                                Ok(if ready && context.generation.reconciliation_complete() {
                                    ActivationOutcome::Retry
                                } else {
                                    ActivationOutcome::Settled
                                })
                            }
                        }
                    })();
                    match activation {
                        Ok(ActivationOutcome::WorkQueued) => continue,
                        Ok(ActivationOutcome::Retry) => {
                            activation_retry_attempts += 1;
                            if activation_retry_attempts < 10 {
                                // History/baseline work can change source admission
                                // without queuing embeddings. Retry after it settles,
                                // outside the producer lock and with shutdown support.
                                if wait(Duration::from_millis(100)) {
                                    continue;
                                }
                            } else {
                                update_runtime(runtime, |s| {
                                    s.last_error = Some("Source publication remained busy; retry local search setup.".into());
                                    s.health = SemanticHealth::Degraded;
                                    s.retry_exhausted = true;
                                });
                            }
                        }
                        Err(error) => {
                            update_runtime(runtime, |s| {
                                s.last_error = Some(error);
                                s.health = SemanticHealth::Degraded;
                            });
                        }
                        Ok(ActivationOutcome::Settled) => {}
                    }
                }
                return;
            }
        };
        let mut atlas_retry_delay = Duration::ZERO;
        let outcome = match &job {
            SelectedJob::Images => {
                run_job(db_path, runtime, debug, "Indexing images", |connection| {
                    let count = super::images::reconcile(
                        connection,
                        &context.notes_dir,
                        provider,
                        &context.image_ann,
                        || {
                            background_gate.checkpoint_manual_pause();
                            if context.queue.is_accepting() {
                                Ok(())
                            } else {
                                Err("Image indexing stopped.".into())
                            }
                        },
                    )?;
                    Ok(JobOutcome {
                        embedded_count: count,
                        ..Default::default()
                    })
                })
            }
            SelectedJob::Rebuild => run_job(
                db_path,
                runtime,
                debug,
                "Rebuilding semantic index",
                |connection| {
                    let _exclusive = context.generation.exclusive_rebuild()?;
                    process_rebuild(connection, context)
                },
            ),
            SelectedJob::FullScan { force } => {
                run_job(db_path, runtime, debug, "Scanning notes", |connection| {
                    process_full_scan(
                        connection,
                        &context.notes_dir,
                        provider,
                        ann,
                        note_ann,
                        *force,
                        debug,
                    )
                })
            }
            SelectedJob::Documents(batch) => {
                run_job(db_path, runtime, debug, "Indexing notes", |connection| {
                    update_runtime(runtime, |state| state.progress_total = batch.len());
                    process_note_batch(connection, provider, ann, note_ann, batch.clone(), debug)
                })
            }
            SelectedJob::RebuildAnn => {
                update_runtime(runtime, |state| {
                    state.health = SemanticHealth::Working;
                    state.rebuild_reason =
                        Some("ANN snapshot requires fallback rebuild".to_string());
                    state.indexing_in_progress = true;
                    state.current_job_label = Some("Rebuilding ANN snapshot".to_string());
                });
                run_job(
                    db_path,
                    runtime,
                    debug,
                    "Rebuilding ANN snapshot",
                    |connection| {
                        let progress = |current, total| {
                            update_runtime(runtime, |state| {
                                state.progress_current = current;
                                state.progress_total = total;
                            });
                            background_gate.checkpoint_manual_pause();
                        };
                        ann.rebuild_from_connection_with_gate(
                            connection,
                            Some(background_gate.as_ref()),
                            Some(&progress),
                        )?;
                        note_ann.rebuild_from_connection_with_gate(
                            connection,
                            Some(background_gate.as_ref()),
                            Some(&progress),
                        )?;
                        Ok(JobOutcome::default())
                    },
                )
            }
            SelectedJob::Edges => {
                update_runtime(runtime, |state| {
                    state.health = SemanticHealth::Working;
                    state.rebuild_reason = Some("Related-note edges are stale".to_string());
                    state.indexing_in_progress = true;
                    state.current_job_label = Some("Refreshing related notes".to_string());
                });
                run_job(
                    db_path,
                    runtime,
                    debug,
                    "Refreshing related notes",
                    |connection| {
                        let started_at = Instant::now();
                        let note_ann_status = note_ann.status_snapshot();
                        let note_ann_signature = load_note_ann_index_signature(connection)?;
                        let dirty_count = edge_dirty_count(connection)?;
                        let can_use_incremental = note_ann_status.loaded
                            && !note_ann_status.dirty
                            && !note_ann_status.rebuild_pending
                            && note_ann_status.generation_id.is_some()
                            && note_ann_signature.identities_valid
                            && dirty_count_allows_incremental(dirty_count);
                        if can_use_incremental {
                            // Publish the current in-memory note ANN first. Edge
                            // provenance therefore names a durable generation that
                            // exactly contains the mutations being repaired.
                            note_ann.persist_current(connection)?;
                        }
                        let note_ann_generation = note_ann.generation_id().unwrap_or_default();
                        let requires_full = !can_use_incremental
                            || edge_generation_requires_full_rebuild(
                                connection,
                                &note_ann_generation,
                                note_ann.model_signature(),
                            )?;
                        if requires_full {
                            let stats = rebuild_edges_with_provenance(
                                connection,
                                EDGE_NEIGHBORS_PER_NOTE,
                                provider.minimum_edge_score(),
                                &note_ann_generation,
                                note_ann.model_signature(),
                                |current, total| {
                                    update_runtime(runtime, |state| {
                                        state.progress_current = current;
                                        state.progress_total = total;
                                    });
                                    background_gate.checkpoint_manual_pause();
                                },
                            )?;
                            record_edge_rebuild(
                                debug,
                                &stats,
                                started_at.elapsed().as_millis() as u64,
                            );
                        } else {
                            repair_dirty_edges(
                                connection,
                                EDGE_NEIGHBORS_PER_NOTE,
                                provider.minimum_edge_score(),
                                EDGE_INCREMENTAL_CANDIDATE_K,
                                &note_ann_generation,
                                note_ann.model_signature(),
                                |connection, note_path, candidate_k| {
                                    note_ann
                                        .neighbors_for_note(
                                            connection,
                                            note_path,
                                            candidate_k,
                                            candidate_k,
                                        )
                                        .map(|matches| {
                                            matches
                                                .into_iter()
                                                .map(|candidate| candidate.note_path)
                                                .collect()
                                        })
                                },
                            )?;
                        }
                        // Atlas publication intentionally remains out of scope.
                        // This is the downstream scheduling hook for a future
                        // Atlas worker generation.
                        Ok(JobOutcome::default())
                    },
                )
            }
            SelectedJob::Snapshot => {
                // Coalesce edit bursts before serializing the graph generation.
                if !wait(Duration::from_secs(2)) {
                    return;
                }
                let newer_mutation_waiting = pending
                    .lock()
                    .map(|next| {
                        next.full_scan_requested
                            || next.rebuild_requested
                            || !next.note_updates.is_empty()
                            || !next.deleted_notes.is_empty()
                            || !next.moved_notes.is_empty()
                    })
                    .unwrap_or(false);
                if newer_mutation_waiting {
                    if let Ok(mut next) = pending.lock() {
                        next.snapshot_publish_requested = true;
                    }
                    Some(JobOutcome::default())
                } else {
                    run_job(
                        db_path,
                        runtime,
                        debug,
                        "Saving semantic snapshot",
                        |connection| {
                            ann.persist_current(connection)?;
                            note_ann.persist_current(connection)?;
                            Ok(JobOutcome::default())
                        },
                    )
                }
            }
            SelectedJob::Atlas(_) | SelectedJob::AtlasLabels(_) => {
                let builder = AtlasWorkerContext {
                    db_path: db_path.to_path_buf(),
                    cache_dir: cache_dir.clone(),
                    dimensions: provider.model_info().dimensions,
                    provider: provider.clone(),
                    debug: debug.clone(),
                    note_ann: note_ann.clone(),
                    pending: pending.clone(),
                };
                let labels = matches!(job, SelectedJob::AtlasLabels(_));
                let keys = match &job {
                    SelectedJob::Atlas(requests) => requests.keys().collect::<Vec<_>>(),
                    SelectedJob::AtlasLabels(requests) => requests.keys().collect::<Vec<_>>(),
                    _ => unreachable!(),
                };
                for key in keys {
                    let (result, retry) = match &job {
                        SelectedJob::Atlas(requests) => {
                            let epoch = requests[key];
                            if pending
                                .lock()
                                .map(|next| {
                                    next.atlas_requests
                                        .get(key)
                                        .is_some_and(|newer| *newer > epoch)
                                })
                                .unwrap_or(true)
                            {
                                continue;
                            }
                            (
                                run_structural_atlas_build(pending, *key, epoch, || {
                                    builder.build_and_publish(*key, epoch).map(|_| ())
                                }),
                                SelectedJob::Atlas(HashMap::from([(*key, epoch)])),
                            )
                        }
                        SelectedJob::AtlasLabels(requests) => {
                            let request = &requests[key];
                            if pending
                                .lock()
                                .map(|next| {
                                    next.atlas_label_requests
                                        .get(key)
                                        .is_some_and(|newer| newer != request)
                                })
                                .unwrap_or(true)
                            {
                                continue;
                            }
                            (
                                run_label_atlas_build(pending, *key, || {
                                    builder.build_and_publish_labels(*key, request)
                                }),
                                SelectedJob::AtlasLabels(HashMap::from([(*key, request.clone())])),
                            )
                        }
                        _ => unreachable!(),
                    };
                    let attempts = if labels {
                        &mut label_retry_attempts
                    } else {
                        &mut atlas_retry_attempts
                    };
                    match result {
                        Ok(()) => {
                            attempts.remove(key);
                        }
                        Err(error) if error == "atlas generation superseded" => {
                            attempts.remove(key);
                        }
                        Err(error) => {
                            let attempt = attempts.entry(*key).or_default();
                            *attempt = attempt.saturating_add(1);
                            atlas_retry_delay =
                                atlas_retry_delay.max(atlas_failure_backoff(*attempt));
                            if let Ok(mut next) = pending.lock() {
                                retry.requeue(&mut next);
                            }
                            let deferred = !labels && error == ATLAS_DEPENDENCIES_NOT_READY;
                            if !deferred || *attempt == 1 {
                                debug.record_with_metrics(
                                    if labels { "atlas_labels" } else { "atlas" },
                                    if deferred {
                                        "build_deferred"
                                    } else {
                                        "build_failed"
                                    },
                                    Some(error),
                                    None,
                                    |metrics| {
                                        if labels {
                                            metrics.atlas_label_failure_count += 1;
                                        }
                                    },
                                );
                            }
                        }
                    }
                }
                Some(JobOutcome::default())
            }
        };

        if let Some(outcome) = outcome {
            if matches!(job, SelectedJob::FullScan { .. } | SelectedJob::Rebuild) {
                context.generation.scan_finished();
            }
            // Image publication does not change text/aggregate geometry or Atlas epochs.
            let atlas = matches!(
                job,
                SelectedJob::Atlas(..) | SelectedJob::AtlasLabels(..) | SelectedJob::Images
            );
            let next_revision = if atlas {
                context.index_revision.load(Ordering::Acquire)
            } else {
                context
                    .index_revision
                    .fetch_add(1, Ordering::AcqRel)
                    .saturating_add(1)
            };
            if let Ok(mut next) = pending.lock() {
                if !atlas {
                    for epoch in next.atlas_requests.values_mut() {
                        *epoch = (*epoch).max(next_revision);
                    }
                }
                match &job {
                    SelectedJob::Documents(_) | SelectedJob::FullScan { .. } => {
                        next.image_scan_requested = true;
                        if matches!(job, SelectedJob::FullScan { .. }) || outcome.scanned_count > 0
                        {
                            if ann.needs_rebuild() || note_ann.needs_rebuild() {
                                next.automatic_rebuild_requested = true;
                            } else if outcome.scanned_count > 0 {
                                next.snapshot_publish_requested = true;
                            }
                            if outcome.edges_dirtied {
                                next.edge_refresh_requested = true;
                                update_runtime(runtime, |state| state.edges_stale = true);
                            }
                        }
                    }
                    SelectedJob::Rebuild | SelectedJob::RebuildAnn | SelectedJob::Snapshot => {
                        if matches!(job, SelectedJob::Rebuild) {
                            next.image_scan_requested = true;
                        }
                        // Published note ANN generations require matching edge provenance.
                        next.edge_refresh_requested = true;
                        update_runtime(runtime, |state| state.edges_stale = true);
                    }
                    _ => {}
                }
                if !atlas {
                    let visibilities = match &job {
                        SelectedJob::Documents(batch) => atlas_visibilities_for_mutation_batch(
                            batch.updates.values().any(|update| {
                                matches!(update.document, PendingSemanticDocument::NoteMarkdown(_))
                            }),
                            batch.updates.values().any(|update| {
                                matches!(
                                    update.document,
                                    PendingSemanticDocument::ChatRecall { .. }
                                )
                            }),
                            !batch.deletes.is_empty() || !batch.moves.is_empty(),
                            false,
                        ),
                        _ => atlas_visibilities_for_mutation_batch(false, false, false, true),
                    };
                    for visibility in visibilities {
                        let key = AtlasGenerationKey {
                            chat_visibility: *visibility,
                        };
                        if atlas_structural_build_covers_epoch(&next, key, next_revision) {
                            continue;
                        }
                        if cache_dir
                            .join("atlas")
                            .join(format!("ready-{}.json", visibility.signature_value()))
                            .exists()
                        {
                            next.atlas_requests
                                .entry(key)
                                .and_modify(|epoch| *epoch = (*epoch).max(next_revision))
                                .or_insert(next_revision);
                        }
                    }
                }
            }
            update_runtime(runtime, |state| {
                if matches!(job, SelectedJob::Edges) {
                    state.edges_stale = false;
                }
                state.health = if ann.needs_rebuild() || note_ann.needs_rebuild() {
                    SemanticHealth::Stale
                } else {
                    SemanticHealth::Fresh
                };
                state.retry_attempt = 0;
                state.retry_exhausted = false;
            });
        } else {
            let mut attempt = 1;
            update_runtime(runtime, |state| {
                state.retry_attempt = state.retry_attempt.saturating_add(1);
                attempt = state.retry_attempt;
                state.retry_exhausted = attempt >= SEMANTIC_RETRY_MAX_ATTEMPTS;
                state.health = if state.retry_exhausted {
                    SemanticHealth::Degraded
                } else {
                    SemanticHealth::Working
                };
            });
            if let Ok(mut next) = pending.lock() {
                job.requeue(&mut next);
            }
            if attempt >= SEMANTIC_RETRY_MAX_ATTEMPTS || !wait(semantic_failure_backoff(attempt)) {
                return;
            }
        }
        if !atlas_retry_delay.is_zero() && !wait(atlas_retry_delay) {
            return;
        }
    }
}

enum ActivationOutcome {
    Settled,
    WorkQueued,
    Retry,
}

fn atlas_failure_backoff(attempt: u32) -> Duration {
    const BASE_MILLIS: u64 = 100;
    const MAX_MILLIS: u64 = 2_000;
    let exponent = attempt.saturating_sub(1).min(5);
    Duration::from_millis(
        BASE_MILLIS
            .saturating_mul(1_u64 << exponent)
            .min(MAX_MILLIS),
    )
}

fn semantic_failure_backoff(attempt: u32) -> Duration {
    const BASE_MILLIS: u64 = 100;
    const MAX_MILLIS: u64 = 400;
    let exponent = attempt.saturating_sub(1).min(2);
    Duration::from_millis(
        BASE_MILLIS
            .saturating_mul(1_u64 << exponent)
            .min(MAX_MILLIS),
    )
}

fn merge_retry_batch(target: &mut PendingIndexState, retry: PendingIndexState) {
    // `retry` was dequeued before `target` was populated, so every document
    // mutation already in `target` is newer. Rebuild the queue in temporal
    // order instead of extending the maps: `HashMap::extend(retry)` would let
    // stale failed updates replace newer edits and could pair a newer delete
    // with the stale update, resurrecting the document when updates run last.
    let newer = std::mem::take(target);
    let newer_reconciles_every_document = newer.rebuild_requested || newer.full_scan_requested;
    let mut merged = retry;

    merged.full_scan_requested |= newer.full_scan_requested;
    merged.image_scan_requested |= newer.image_scan_requested;
    merged.force_full_scan |= newer.force_full_scan;
    merged.rebuild_requested |= newer.rebuild_requested;
    merged.automatic_rebuild_requested |= newer.automatic_rebuild_requested;
    merged.edge_refresh_requested |= newer.edge_refresh_requested;
    merged.snapshot_publish_requested |= newer.snapshot_publish_requested;

    if newer_reconciles_every_document {
        // A newer full scan/rebuild supersedes every older incremental
        // mutation. Its own queue is normally empty because enqueueing the
        // request clears it, but retain it defensively.
        merged.note_updates.clear();
        merged.deleted_notes.clear();
        merged.moved_notes.clear();
    }

    // Moves are replayed first because updates/deletes at their destination
    // represent later actions. A move following an older move is folded into
    // one source-to-final-destination operation so HashMap iteration order
    // cannot strand the original indexed path.
    for (old_path, moved) in newer.moved_notes {
        merge_newer_move(&mut merged, old_path, moved);
    }
    for path in newer.deleted_notes {
        merged.note_updates.remove(&path);
        merged.deleted_notes.insert(path);
    }
    for (path, update) in newer.note_updates {
        merged.deleted_notes.remove(&path);
        merged.note_updates.insert(path, update);
    }

    for (key, epoch) in newer.atlas_requests {
        merged
            .atlas_requests
            .entry(key)
            .and_modify(|current| *current = (*current).max(epoch))
            .or_insert(epoch);
    }
    // The live request is newer than the failed request for the same key.
    for (key, request) in newer.atlas_label_requests {
        merged.atlas_label_requests.insert(key, request);
    }
    merged.atlas_building = newer.atlas_building;
    merged.atlas_label_building = newer.atlas_label_building;
    *target = merged;
}

fn merge_newer_move(state: &mut PendingIndexState, old_path: PathBuf, moved: PendingNoteMove) {
    let mut source = old_path.clone();
    let destination = moved.new_path.clone();

    // Fold A→B followed by B→C into A→C. The newest move carries the
    // authoritative destination Markdown and timestamp.
    while let Some(previous_source) = state
        .moved_notes
        .iter()
        .find_map(|(candidate, pending)| (pending.new_path == source).then(|| candidate.clone()))
    {
        state.moved_notes.remove(&previous_source);
        source = previous_source;
    }

    // A newer move is authoritative for both of its endpoints. This mirrors
    // ordinary queueing and prevents an older update/delete from being applied
    // after the move.
    for path in [&source, &old_path, &destination] {
        state.note_updates.remove(path);
        state.deleted_notes.remove(path);
    }
    state.moved_notes.remove(&source);
    state.moved_notes.insert(source, moved);
}

fn run_structural_atlas_build<T>(
    pending: &Arc<Mutex<PendingIndexState>>,
    key: AtlasGenerationKey,
    target_epoch: u64,
    build: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if let Ok(mut state) = pending.lock() {
        state.atlas_building.insert(key, target_epoch);
    }
    let result = catch_unwind(AssertUnwindSafe(build))
        .map_err(|_| "Atlas structural build panicked".to_string())
        .and_then(|result| result);
    if let Ok(mut state) = pending.lock() {
        state.atlas_building.remove(&key);
    }
    result
}

fn run_label_atlas_build<T>(
    pending: &Arc<Mutex<PendingIndexState>>,
    key: AtlasGenerationKey,
    build: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if let Ok(mut state) = pending.lock() {
        state.atlas_label_building.insert(key);
    }
    let result = catch_unwind(AssertUnwindSafe(build))
        .map_err(|_| "Atlas label build panicked".to_string())
        .and_then(|result| result);
    if let Ok(mut state) = pending.lock() {
        state.atlas_label_building.remove(&key);
    }
    result
}

fn run_job<F>(
    db_path: &Path,
    runtime: &Arc<Mutex<RuntimeState>>,
    debug: &Arc<SemanticDebugState>,
    label: &str,
    job: F,
) -> Option<JobOutcome>
where
    F: FnOnce(&mut rusqlite::Connection) -> Result<JobOutcome, String>,
{
    let started_at = Instant::now();
    update_runtime(runtime, |state| {
        state.indexing_in_progress = true;
        state.current_job_label = Some(label.to_string());
        state.last_error = None;
        state.progress_current = 0;
        state.progress_total = 0;
        state.health = SemanticHealth::Working;
    });
    debug.record_with_metrics(
        "index",
        "job_started",
        Some(label.to_string()),
        None,
        |metrics| {
            metrics.index_job_started_count += 1;
        },
    );

    let result = (|| -> Result<JobOutcome, String> {
        let mut connection = open_database(db_path)?;
        ensure_schema(&connection)?;
        let job_id = insert_job(&connection, "running", 0, 0, None)?;
        match job(&mut connection) {
            Ok(outcome) => {
                update_job(
                    &connection,
                    job_id,
                    "completed",
                    outcome.scanned_count,
                    outcome.embedded_count,
                    None,
                )?;
                let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                debug.record_timing(
                    "index",
                    "job_completed",
                    Some(format!(
                        "{label} scanned={} embedded={}",
                        outcome.scanned_count, outcome.embedded_count
                    )),
                    elapsed,
                    |metrics| {
                        metrics.index_job_completed_count += 1;
                        metrics.index_scanned_total += outcome.scanned_count as u64;
                        metrics.index_embedded_total += outcome.embedded_count as u64;
                        metrics.index_duration_total_millis += elapsed;
                        metrics.index_duration_max_millis =
                            metrics.index_duration_max_millis.max(elapsed);
                        if outcome.scanned_count == 0 && outcome.embedded_count == 0 {
                            metrics.index_zero_work_count += 1;
                        }
                    },
                );
                Ok(outcome)
            }
            Err(error) => {
                update_job(&connection, job_id, "failed", 0, 0, Some(&error))?;
                let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                debug.record_timing(
                    "index",
                    "job_failed",
                    Some(format!("{label}: {error}")),
                    elapsed,
                    |metrics| {
                        metrics.index_job_failed_count += 1;
                        metrics.index_duration_total_millis += elapsed;
                        metrics.index_duration_max_millis =
                            metrics.index_duration_max_millis.max(elapsed);
                    },
                );
                Err(error)
            }
        }
    })();

    match result {
        Ok(outcome) => {
            let now = current_time_millis().ok();
            update_runtime(runtime, |state| {
                state.indexing_in_progress = false;
                state.current_job_label = None;
                state.last_indexed_at_millis = now;
            });
            Some(outcome)
        }
        Err(error) => {
            update_runtime(runtime, |state| {
                state.indexing_in_progress = false;
                state.current_job_label = None;
                state.last_error = Some(error);
            });
            None
        }
    }
}

/// Maximum inferred neighbors recorded per note during edge rebuild.
const EDGE_NEIGHBORS_PER_NOTE: usize = 6;
/// Dirty batches above this bound use the existing full reconciliation path.
pub(crate) const EDGE_MAX_INCREMENTAL_DIRTY_NOTES: usize = 32;
/// Search wider than the emitted top-K to catch reverse-neighbor changes.
const EDGE_INCREMENTAL_CANDIDATE_K: usize = EDGE_NEIGHBORS_PER_NOTE * 8;
/// Bump when derived, non-embedding metadata changes so existing vault rows are
/// refreshed without paying to regenerate unchanged chunk embeddings.
pub(super) const NOTE_PRESENTATION_ALGORITHM_VERSION: &str =
    "note-presentation-v3-frontmatter-tags";

fn dirty_count_allows_incremental(dirty_count: usize) -> bool {
    dirty_count > 0 && dirty_count <= EDGE_MAX_INCREMENTAL_DIRTY_NOTES
}

fn process_full_scan(
    connection: &mut rusqlite::Connection,
    notes_dir: &Path,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: &Arc<AnnIndexState>,
    note_ann: &Arc<NoteAnnIndexState>,
    force: bool,
    debug: &Arc<SemanticDebugState>,
) -> Result<JobOutcome, String> {
    let stored = load_stored_note_records(connection)?;
    let mut seen_paths = HashSet::new();
    let mut updates = HashMap::new();

    for path in collect_markdown_files_recursively(notes_dir)? {
        let raw_path = path.to_string_lossy().into_owned();
        let markdown = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        if !crate::note::semantic_recall_eligible(&markdown) {
            continue;
        }
        seen_paths.insert(raw_path.clone());
        let modified_millis = read_modified_millis(&path)?;
        let next_content_hash = content_hash(&markdown);
        let fallback_title = fallback_title_for_path(&path, &markdown);
        let chunked_note = chunk_markdown(&markdown, &fallback_title);
        let parsed_note = note::parse_note(&markdown);
        let foundation =
            note_semantic_metadata(&raw_path, &chunked_note, &parsed_note, modified_millis);
        let is_clean = stored.get(&raw_path).is_some_and(|record| {
            !record.semantic_input_hash.is_empty()
                && !record.structure_hash.is_empty()
                && !record.presentation_hash.is_empty()
                && record.stable_ann_label > 0
                && record.modified_millis == modified_millis
                && record.content_hash == next_content_hash
                && record.semantic_input_hash == foundation.semantic_input_hash
                && record.structure_hash == foundation.structure_hash
                && record.presentation_hash == foundation.presentation_hash
        });
        if !force && is_clean {
            continue;
        }

        updates.insert(
            path,
            PendingNoteUpdate {
                document: PendingSemanticDocument::NoteMarkdown(markdown),
                modified_millis,
            },
        );
    }

    let deleted_notes = stored
        .iter()
        // Chat recall is authoritative in ai.sqlite3 and is reconciled by
        // ChatService. A filesystem scan must never delete an already-correct
        // explicit recall row merely because projection Markdown is excluded.
        .filter(|(stored_path, record)| {
            record.document_kind == crate::note::DocumentKind::Note
                && !seen_paths.contains(*stored_path)
        })
        .map(|(stored_path, _)| PathBuf::from(stored_path))
        .collect::<HashSet<_>>();
    let outcome = process_note_batch(
        connection,
        provider,
        ann,
        note_ann,
        SemanticDocumentBatch::new(updates, deleted_notes, HashMap::new()),
        debug,
    )?;
    debug.sample_rss("index", "full_scan_completed");
    Ok(outcome)
}

fn record_edge_rebuild(
    debug: &Arc<SemanticDebugState>,
    stats: &EdgeRebuildStats,
    duration_millis: u64,
) {
    debug.record_timing(
        "index",
        "edge_rebuild",
        Some(format!(
            "notes={} edges={} dim={} comparisons={}",
            stats.note_count, stats.edge_count, stats.dimensions, stats.comparisons
        )),
        duration_millis,
        |metrics| {
            metrics.edge_rebuild_count += 1;
            metrics.edge_rebuild_note_count = stats.note_count as u64;
            metrics.edge_rebuild_edge_count = stats.edge_count as u64;
            metrics.edge_rebuild_dimensions = stats.dimensions as u64;
            metrics.edge_rebuild_comparisons_total += stats.comparisons;
            metrics.edge_rebuild_duration_total_millis += duration_millis;
            metrics.edge_rebuild_duration_max_millis = metrics
                .edge_rebuild_duration_max_millis
                .max(duration_millis);
        },
    );
}

fn process_rebuild(
    connection: &mut rusqlite::Connection,
    context: &IndexingWorkerContext,
) -> Result<JobOutcome, String> {
    // Reconcile in place so a provider or rebuild failure cannot erase the
    // SQLite rows backing the currently loaded last-good ANN generation.
    // `force=true` still refreshes every filesystem note, and the full-scan
    // deletion set removes notes that genuinely disappeared.
    let outcome = process_full_scan(
        connection,
        &context.notes_dir,
        &context.provider,
        &context.ann,
        &context.note_ann,
        true,
        &context.debug,
    )?;
    let progress = |current, total| {
        update_runtime(&context.runtime, |state| {
            state.progress_current = current;
            state.progress_total = total;
        });
    };
    context.ann.rebuild_from_connection_with_gate(
        connection,
        Some(context.background_gate.as_ref()),
        Some(&progress),
    )?;
    context.note_ann.rebuild_from_connection_with_gate(
        connection,
        Some(context.background_gate.as_ref()),
        Some(&progress),
    )?;
    Ok(outcome)
}

fn process_note_batch(
    connection: &mut rusqlite::Connection,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: &Arc<AnnIndexState>,
    note_ann: &Arc<NoteAnnIndexState>,
    batch: SemanticDocumentBatch,
    debug: &Arc<SemanticDebugState>,
) -> Result<JobOutcome, String> {
    let mut scanned_count = 0usize;
    let mut embedded_count = 0usize;
    let mut force_ann_rebuild = false;
    let mut force_note_ann_rebuild = false;
    let mutation_count = batch.len();
    let mut defer_ann_updates = mutation_count > ANN_MAX_INCREMENTAL_DOCUMENTS;
    let mut changed_chunk_count = 0usize;
    if defer_ann_updates {
        force_ann_rebuild = true;
        force_note_ann_rebuild = true;
    }

    // Process moves first: re-key existing rows from old path to new path,
    // reusing stored embeddings (no embedding-server calls). A successful move
    // changes chunk ann_labels, so the ANN graph must rebuild afterwards. If
    // the source row is missing (never indexed), fall back to a normal index
    // of the new path so the content still gets embedded.
    for (old_path, moved) in batch.moves {
        let old_path_str = old_path.to_string_lossy().into_owned();
        let new_path_str = moved.new_path.to_string_lossy().into_owned();
        let previous_note = load_note_record(connection, &old_path_str)?;
        let moved_in_place = move_note(connection, &old_path_str, &new_path_str)?;
        if moved_in_place {
            let fallback_title = fallback_title_for_path(&moved.new_path, &moved.markdown);
            let chunked_note = chunk_markdown(&moved.markdown, &fallback_title);
            let parsed_note = note::parse_note(&moved.markdown);
            let metadata = note_semantic_metadata(
                &new_path_str,
                &chunked_note,
                &parsed_note,
                moved.modified_millis,
            );
            let fallback_timestamp = note::timestamp_millis_to_rfc3339(moved.modified_millis);
            let created_at = parsed_note
                .frontmatter
                .managed
                .as_ref()
                .map(|metadata| metadata.created_at.trim())
                .filter(|value| !value.is_empty())
                .unwrap_or(&fallback_timestamp)
                .to_string();
            let updated_at = parsed_note
                .frontmatter
                .managed
                .as_ref()
                .map(|metadata| metadata.updated_at.trim())
                .filter(|value| !value.is_empty())
                .unwrap_or(&fallback_timestamp)
                .to_string();
            update_moved_note_metadata(
                connection,
                &new_path_str,
                &chunked_note.title,
                moved.modified_millis,
                &content_hash(&moved.markdown),
                &created_at,
                &updated_at,
                note::DocumentKind::Note,
                &metadata,
            )?;
            force_ann_rebuild = true;
            let stable_ann_label = previous_note
                .as_ref()
                .map(|note| note.stable_ann_label)
                .unwrap_or(0);
            if !note_ann.apply_note_move(stable_ann_label, &old_path_str, &new_path_str)? {
                force_note_ann_rebuild = true;
            }
        } else {
            let indexed_note = index_note_content(
                connection,
                provider,
                &moved.new_path,
                &moved.markdown,
                moved.modified_millis,
            )?;
            embedded_count += indexed_note.embedded_count;
            force_ann_rebuild = true;
            if !note_ann.apply_note_upsert(connection, &new_path_str)? {
                force_note_ann_rebuild = true;
            }
        }
        scanned_count += 1;
    }

    for note_path in batch.deletes {
        let path_str = note_path.to_string_lossy().into_owned();
        let previous_labels = load_note_chunk_labels(connection, &path_str)?;
        let previous_note = load_note_record(connection, &path_str)?;
        if previous_labels.is_empty() && previous_note.is_none() {
            continue;
        }
        delete_note(connection, &path_str)?;
        changed_chunk_count = changed_chunk_count.saturating_add(previous_labels.len());
        if changed_chunk_count > ANN_MAX_INCREMENTAL_CHUNKS {
            defer_ann_updates = true;
            force_ann_rebuild = true;
        }
        if !defer_ann_updates && !ann.apply_note_delete(&previous_labels)? {
            force_ann_rebuild = true;
        }
        if !defer_ann_updates
            && !note_ann.apply_note_delete(
                previous_note
                    .as_ref()
                    .map(|note| note.stable_ann_label)
                    .unwrap_or(0),
            )?
        {
            force_note_ann_rebuild = true;
        }
        scanned_count += 1;
    }

    // Prepare every dirty document first, then embed missing chunks across the
    // whole batch so llama-server/Metal sees large HTTP requests instead of one
    // small request per note.
    let mut pending_updates = Vec::new();
    for (note_path, update) in batch.updates {
        let path_str = note_path.to_string_lossy().into_owned();
        let previous_labels = load_note_chunk_labels(connection, &path_str)?;
        let previous_note = load_note_record(connection, &path_str)?;
        let prepared = match update.document {
            PendingSemanticDocument::NoteMarkdown(markdown) => {
                if !crate::note::semantic_recall_eligible(&markdown) {
                    delete_note(connection, &path_str)?;
                    changed_chunk_count = changed_chunk_count.saturating_add(previous_labels.len());
                    if changed_chunk_count > ANN_MAX_INCREMENTAL_CHUNKS {
                        defer_ann_updates = true;
                        force_ann_rebuild = true;
                    }
                    if !defer_ann_updates && !ann.apply_note_delete(&previous_labels)? {
                        force_ann_rebuild = true;
                    }
                    if !defer_ann_updates
                        && !note_ann.apply_note_delete(
                            previous_note
                                .as_ref()
                                .map(|note| note.stable_ann_label)
                                .unwrap_or(0),
                        )?
                    {
                        force_note_ann_rebuild = true;
                    }
                    scanned_count += 1;
                    continue;
                }
                prepare_note_content(connection, &note_path, &markdown, update.modified_millis)?
            }
            PendingSemanticDocument::ChatRecall { title, excerpts } => prepare_chat_recall_content(
                connection,
                &note_path,
                &title,
                &excerpts,
                update.modified_millis,
            )?,
        };
        pending_updates.push(PendingIndexedUpdate {
            path_str,
            previous_labels,
            prepared,
        });
    }

    embedded_count += fill_prepared_embeddings(provider, &mut pending_updates)?;

    for update in pending_updates {
        let indexed_note = persist_prepared_note(connection, &update.path_str, update.prepared)?;
        changed_chunk_count = changed_chunk_count
            .saturating_add(update.previous_labels.len().max(indexed_note.chunks.len()));
        if changed_chunk_count > ANN_MAX_INCREMENTAL_CHUNKS {
            defer_ann_updates = true;
            force_ann_rebuild = true;
        }
        if !defer_ann_updates
            && !ann.apply_note_upsert(
                load_note_record(connection, &update.path_str)?
                    .ok_or_else(|| "Indexed note row missing after upsert".to_string())?
                    .stable_ann_label,
                &update.previous_labels,
                &indexed_note.chunks,
                &indexed_note.embeddings,
            )?
        {
            force_ann_rebuild = true;
        }
        if !defer_ann_updates && !note_ann.apply_note_upsert(connection, &update.path_str)? {
            force_note_ann_rebuild = true;
        }
        scanned_count += 1;
    }

    if scanned_count > 0 && force_ann_rebuild {
        ann.request_rebuild("incremental_update_requires_compaction");
    }
    if scanned_count > 0 && force_note_ann_rebuild {
        note_ann.request_rebuild();
    }
    if scanned_count > 0 {
        debug.sample_rss("index", "note_batch_completed");
    }

    Ok(JobOutcome {
        scanned_count,
        embedded_count,
        edges_dirtied: edge_dirty_count(connection)? > 0,
    })
}

fn index_note_content(
    connection: &mut rusqlite::Connection,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    note_path: &Path,
    markdown: &str,
    modified_millis: u64,
) -> Result<IndexedNoteContent, String> {
    let prepared = prepare_note_content(connection, note_path, markdown, modified_millis)?;
    let path_str = note_path.to_string_lossy().into_owned();
    let mut pending = vec![PendingIndexedUpdate {
        path_str: path_str.clone(),
        previous_labels: HashSet::new(),
        prepared,
    }];
    let embedded_count = fill_prepared_embeddings(provider, &mut pending)?;
    let prepared = pending
        .pop()
        .ok_or_else(|| "Prepared note missing after embedding".to_string())?
        .prepared;
    let mut indexed = persist_prepared_note(connection, &path_str, prepared)?;
    indexed.embedded_count = embedded_count;
    Ok(indexed)
}

fn prepare_chat_recall_content(
    connection: &mut rusqlite::Connection,
    conversation_path: &Path,
    title: &str,
    excerpts: &[ChatRecallExcerpt],
    modified_millis: u64,
) -> Result<PreparedNoteContent, String> {
    let path = conversation_path.to_string_lossy().into_owned();
    let chunks = excerpts
        .iter()
        .enumerate()
        .map(|(ordinal, excerpt)| super::chunking::SemanticChunk {
            ordinal,
            section_label: "Remembered passage".to_string(),
            text: excerpt.quote.clone(),
            text_hash: content_hash(&excerpt.quote),
            start_line: 1,
            end_line: 1,
            block_anchor: Some(excerpt.anchor.clone()),
        })
        .collect::<Vec<_>>();
    let stored_chunks = load_existing_chunk_embeddings(connection, &path)?;
    let mut embeddings = vec![Vec::new(); chunks.len()];
    let mut pending_chunk_indexes = Vec::new();
    let mut pending_texts = Vec::new();
    for (index, chunk) in chunks.iter().enumerate() {
        if let Some(existing) = stored_chunks.get(&chunk.ordinal) {
            if existing.text_hash == chunk.text_hash && !existing.embedding.is_empty() {
                embeddings[index] = existing.embedding.clone();
                continue;
            }
        }
        pending_chunk_indexes.push(index);
        pending_texts.push(chunk.text.clone());
    }
    let timestamp = crate::note::timestamp_millis_to_rfc3339(modified_millis);
    let semantic_input_hash = hash_parts(
        std::iter::once("chatIndex")
            .chain(std::iter::once(title))
            .chain(chunks.iter().map(|chunk| chunk.text.as_str())),
    );
    let structure_hash = hash_parts(["chatIndex", path.as_str(), parent_path(&path)]);
    let presentation_hash =
        hash_parts(["chatIndex", title, timestamp.as_str(), timestamp.as_str()]);
    let metadata = SemanticNoteMetadata {
        semantic_input_hash,
        structure_hash,
        presentation_hash,
        preview: excerpts
            .first()
            .map(|excerpt| excerpt.quote.chars().take(260).collect())
            .unwrap_or_default(),
        ..SemanticNoteMetadata::default()
    };
    Ok(PreparedNoteContent {
        title: title.to_string(),
        modified_millis,
        content_hash: chat_recall_content_hash(excerpts),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        document_kind: crate::note::DocumentKind::ChatIndex,
        metadata,
        chunks,
        embeddings,
        pending_chunk_indexes,
        pending_texts,
    })
}

fn prepare_note_content(
    connection: &mut rusqlite::Connection,
    note_path: &Path,
    markdown: &str,
    modified_millis: u64,
) -> Result<PreparedNoteContent, String> {
    let fallback_title = fallback_title_for_path(note_path, markdown);
    let chunked_note = chunk_markdown(markdown, &fallback_title);
    let note_path = note_path.to_string_lossy().into_owned();
    let stored_chunks = load_existing_chunk_embeddings(connection, &note_path)?;
    let parsed_note = note::parse_note(markdown);
    let fallback_timestamp = note::timestamp_millis_to_rfc3339(modified_millis);
    let created_at = parsed_note
        .frontmatter
        .managed
        .as_ref()
        .map(|metadata| metadata.created_at.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(&fallback_timestamp)
        .to_string();
    let updated_at = parsed_note
        .frontmatter
        .managed
        .as_ref()
        .map(|metadata| metadata.updated_at.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(&fallback_timestamp)
        .to_string();
    let metadata = note_semantic_metadata(&note_path, &chunked_note, &parsed_note, modified_millis);

    let mut embeddings = vec![Vec::new(); chunked_note.chunks.len()];
    let mut pending_chunk_indexes = Vec::new();
    let mut pending_texts = Vec::new();

    for (index, chunk) in chunked_note.chunks.iter().enumerate() {
        if let Some(existing_chunk) = stored_chunks.get(&chunk.ordinal) {
            if existing_chunk.text_hash == chunk.text_hash && !existing_chunk.embedding.is_empty() {
                embeddings[index] = existing_chunk.embedding.clone();
                continue;
            }
        }

        pending_chunk_indexes.push(index);
        pending_texts.push(chunk.text.clone());
    }

    Ok(PreparedNoteContent {
        title: chunked_note.title,
        modified_millis,
        content_hash: content_hash(markdown),
        created_at,
        updated_at,
        document_kind: crate::note::DocumentKind::Note,
        metadata,
        chunks: chunked_note.chunks,
        embeddings,
        pending_chunk_indexes,
        pending_texts,
    })
}

fn fill_prepared_embeddings(
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    pending_updates: &mut [PendingIndexedUpdate],
) -> Result<usize, String> {
    let mut texts = Vec::new();
    let mut targets = Vec::new();
    for (update_index, update) in pending_updates.iter().enumerate() {
        for (pending_offset, &chunk_index) in
            update.prepared.pending_chunk_indexes.iter().enumerate()
        {
            let Some(text) = update.prepared.pending_texts.get(pending_offset) else {
                return Err("Prepared embedding text/index mismatch".to_string());
            };
            targets.push((update_index, chunk_index));
            texts.push(text.clone());
        }
    }
    if texts.is_empty() {
        return Ok(0);
    }

    // Sequential HTTP batches on purpose: llama-server (especially Metal) already
    // parallelizes inside a request via --threads/--threads-batch. Fan-out HTTP
    // mostly queues on the same GPU/CPU pool and makes indexing look idle.
    let mut embedded_count = 0usize;
    let mut offset = 0usize;
    while offset < texts.len() {
        let end = (offset + EMBEDDING_BATCH_SIZE).min(texts.len());
        let batch = &texts[offset..end];
        let vectors = provider.embed_texts(batch, EmbeddingInputKind::Document)?;
        if vectors.len() != batch.len() {
            return Err(
                "Embedding provider returned an unexpected count for an index batch".to_string(),
            );
        }
        for (batch_offset, vector) in vectors.into_iter().enumerate() {
            let (update_index, chunk_index) = targets[offset + batch_offset];
            pending_updates[update_index].prepared.embeddings[chunk_index] = vector;
        }
        embedded_count += batch.len();
        offset = end;
    }

    for update in pending_updates.iter_mut() {
        update.prepared.pending_chunk_indexes.clear();
        update.prepared.pending_texts.clear();
    }
    Ok(embedded_count)
}

fn persist_prepared_note(
    connection: &mut rusqlite::Connection,
    note_path: &str,
    prepared: PreparedNoteContent,
) -> Result<IndexedNoteContent, String> {
    upsert_note_chunks(
        connection,
        note_path,
        &prepared.title,
        prepared.modified_millis,
        &prepared.content_hash,
        &prepared.created_at,
        &prepared.updated_at,
        prepared.document_kind,
        &prepared.metadata,
        &prepared.chunks,
        &prepared.embeddings,
    )?;
    Ok(IndexedNoteContent {
        embedded_count: 0,
        chunks: prepared.chunks,
        embeddings: prepared.embeddings,
    })
}

fn fallback_title_for_path(note_path: &Path, markdown: &str) -> String {
    note_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| derive_file_stem(markdown))
}

fn note_semantic_metadata(
    note_path: &str,
    chunked_note: &ChunkedNote,
    parsed_note: &note::ParsedNote,
    modified_millis: u64,
) -> SemanticNoteMetadata {
    let mut tags = extract_tags(parsed_note, chunked_note);
    tags.sort();
    tags.dedup();
    let mut wikilink_targets = extract_wikilink_targets(&parsed_note.body);
    wikilink_targets.sort();
    wikilink_targets.dedup();
    let preview: String = chunked_note
        .chunks
        .iter()
        .find(|chunk| chunk.section_label != "Title" && !chunk.text.trim().is_empty())
        .map(|chunk| chunk.text.trim().chars().take(260).collect())
        .unwrap_or_default();
    let managed = parsed_note.frontmatter.managed.as_ref();
    let note_id = managed.map(|metadata| metadata.id.as_str()).unwrap_or("");
    let created_at = managed
        .map(|metadata| metadata.created_at.as_str())
        .unwrap_or("");
    let updated_at = managed
        .map(|metadata| metadata.updated_at.as_str())
        .unwrap_or("");
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());
    let wikilink_targets_json =
        serde_json::to_string(&wikilink_targets).unwrap_or_else(|_| "[]".to_string());

    // These identities intentionally use only data the semantic indexer already
    // has. Do not add catalog-only fields: background Atlas publication must not
    // need to reopen Markdown or consult the foreground search index.
    let semantic_input_hash = hash_parts(
        std::iter::once(note::DocumentKind::Note.as_frontmatter_value().to_string())
            .chain(std::iter::once(chunked_note.content_hash.clone()))
            .chain(chunked_note.chunks.iter().flat_map(|chunk| {
                [
                    chunk.ordinal.to_string(),
                    chunk.section_label.clone(),
                    chunk.text_hash.clone(),
                ]
            }))
            .map(|part| part.to_string()),
    );
    let structure_hash = hash_parts(
        [
            note::DocumentKind::Note.as_frontmatter_value(),
            note_path,
            parent_path(note_path),
        ]
        .into_iter()
        .map(str::to_string)
        .chain(wikilink_targets.iter().cloned()),
    );
    let presentation_hash = format!(
        "{NOTE_PRESENTATION_ALGORITHM_VERSION}:{}",
        hash_parts([
            note::DocumentKind::Note.as_frontmatter_value().to_string(),
            chunked_note.title.clone(),
            preview.clone(),
            tags_json.clone(),
            note_id.to_string(),
            created_at.to_string(),
            updated_at.to_string(),
            modified_millis.to_string(),
        ])
    );

    SemanticNoteMetadata {
        semantic_input_hash,
        structure_hash,
        presentation_hash,
        note_id: note_id.to_string(),
        preview,
        tags_json,
        wikilink_targets_json,
    }
}

fn parent_path(path: &str) -> &str {
    Path::new(path)
        .parent()
        .and_then(Path::to_str)
        .unwrap_or("")
}

fn hash_parts<I, S>(parts: I) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut hasher = blake3::Hasher::new();
    for part in parts {
        let bytes = part.as_ref().as_bytes();
        hasher.update(&(bytes.len() as u64).to_le_bytes());
        hasher.update(bytes);
    }
    hasher.finalize().to_hex().to_string()
}

fn extract_tags(parsed_note: &note::ParsedNote, _chunked_note: &ChunkedNote) -> Vec<String> {
    crate::tags::read_frontmatter_tags(parsed_note.frontmatter.raw_other.as_deref())
        .unwrap_or_default()
}

fn extract_wikilink_targets(markdown: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut remaining = markdown;
    while let Some(start) = remaining.find("[[") {
        let after_start = &remaining[start + 2..];
        let Some(end) = after_start.find("]]") else {
            break;
        };
        let raw = &after_start[..end];
        let target = raw
            .split_once('|')
            .map(|(target, _)| target)
            .unwrap_or(raw)
            .split_once('#')
            .map(|(target, _)| target)
            .unwrap_or(raw)
            .trim();
        if !target.is_empty() {
            targets.push(target.to_string());
        }
        remaining = &after_start[end + 2..];
    }
    targets
}

fn read_modified_millis(path: &Path) -> Result<u64, String> {
    let modified = fs::metadata(path)
        .map_err(|err| err.to_string())?
        .modified()
        .map_err(|err| err.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();

    Ok(modified.min(u128::from(u64::MAX)) as u64)
}

fn update_runtime<F>(runtime: &Arc<Mutex<RuntimeState>>, mutator: F)
where
    F: FnOnce(&mut RuntimeState),
{
    if let Ok(mut state) = runtime.lock() {
        mutator(&mut state);
    }
}

#[derive(Default)]
struct JobOutcome {
    scanned_count: usize,
    embedded_count: usize,
    edges_dirtied: bool,
}

struct IndexedNoteContent {
    embedded_count: usize,
    chunks: Vec<super::chunking::SemanticChunk>,
    embeddings: Vec<Vec<f32>>,
}

struct PendingIndexedUpdate {
    path_str: String,
    previous_labels: HashSet<u64>,
    prepared: PreparedNoteContent,
}

struct PreparedNoteContent {
    title: String,
    modified_millis: u64,
    content_hash: String,
    created_at: String,
    updated_at: String,
    document_kind: crate::note::DocumentKind,
    metadata: SemanticNoteMetadata,
    chunks: Vec<super::chunking::SemanticChunk>,
    embeddings: Vec<Vec<f32>>,
    pending_chunk_indexes: Vec<usize>,
    pending_texts: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::{
        atlas_failure_backoff, dirty_count_allows_incremental, extract_tags, handle_wake,
        merge_retry_batch, process_full_scan, process_note_batch, process_pending_jobs_with_wait,
        run_label_atlas_build, run_structural_atlas_build, semantic_failure_backoff,
        ChatRecallExcerpt, IndexingWorkerContext, PendingIndexState, PendingNoteMove,
        PendingNoteUpdate, PendingSemanticDocument, SemanticDocumentBatch, SemanticWorkQueue,
        WorkerSignal, EDGE_MAX_INCREMENTAL_DIRTY_NOTES,
    };
    use crate::test_support::TestDir;
    use crate::{note, semantic::chunking::chunk_markdown};

    #[test]
    fn semantic_metadata_tags_use_only_the_authored_frontmatter_field() {
        let markdown = "---\ntags: [frontmatter-only]\n---\nBody #body-tag";
        let parsed = note::parse_note(markdown);
        let chunked = chunk_markdown(markdown, "Note");

        assert_eq!(extract_tags(&parsed, &chunked), vec!["frontmatter-only"]);
    }

    #[test]
    fn changing_tags_does_not_change_embeddings_or_atlas_geometry_inputs() {
        let before = "---\ntags: [old]\n---\n\nSame content";
        let after = "---\ntags: [renovation]\n---\n\nSame content";
        let metadata = |markdown: &str| {
            super::note_semantic_metadata(
                "/notes/Note.md",
                &chunk_markdown(markdown, "Note"),
                &note::parse_note(markdown),
                100,
            )
        };
        let before = metadata(before);
        let after = metadata(after);
        assert_eq!(before.semantic_input_hash, after.semantic_input_hash);
        assert_eq!(before.structure_hash, after.structure_hash);
        assert_ne!(before.presentation_hash, after.presentation_hash);
    }

    #[test]
    fn semantic_work_queue_coalesces_wakes_while_preserving_all_work() {
        let (queue, signals) = SemanticWorkQueue::new(PendingIndexState::default());

        queue
            .enqueue(|pending| pending.edge_refresh_requested = true)
            .expect("enqueue edge refresh");
        queue
            .enqueue(|pending| pending.snapshot_publish_requested = true)
            .expect("enqueue snapshot publish");

        assert!(matches!(signals.try_recv(), Ok(WorkerSignal::Wake)));
        assert!(signals.try_recv().is_err(), "wake should be coalesced");
        let (edges, snapshot) = queue
            .stage(|pending| {
                (
                    pending.edge_refresh_requested,
                    pending.snapshot_publish_requested,
                )
            })
            .expect("inspect pending work");
        assert!(edges);
        assert!(snapshot);
    }

    #[test]
    fn semantic_work_queue_defers_startup_work_until_ann_release() {
        let (queue, signals) = SemanticWorkQueue::new(PendingIndexState::default());
        queue
            .stage(|pending| pending.edge_refresh_requested = true)
            .expect("stage startup work");
        assert!(signals.try_recv().is_err(), "staged work must not wake");

        let runtime = Mutex::new(RuntimeState::default());
        let debug = SemanticDebugState::new();
        queue.release_initial_scan(&runtime, &debug);

        assert!(matches!(signals.try_recv(), Ok(WorkerSignal::Wake)));
        let (edges, full_scan) = queue
            .stage(|pending| (pending.edge_refresh_requested, pending.full_scan_requested))
            .expect("inspect released work");
        assert!(edges);
        assert!(full_scan);
        assert!(runtime
            .lock()
            .expect("runtime")
            .last_scan_requested_at_millis
            .is_some());
    }

    #[test]
    fn semantic_quiescence_joins_admitted_detached_work_and_rejects_late_work() {
        let (queue, signals) = SemanticWorkQueue::new(PendingIndexState::default());
        let work = queue.admit_work().expect("admit detached maintenance");
        let (barrier_seen_tx, barrier_seen_rx) = std::sync::mpsc::channel();
        let (settled_tx, settled_rx) = std::sync::mpsc::channel();

        std::thread::scope(|scope| {
            scope.spawn(move || match signals.recv().expect("restart barrier") {
                WorkerSignal::Barrier(barrier) => {
                    barrier.send(()).expect("settle barrier");
                    barrier_seen_tx.send(()).expect("observe barrier");
                }
                _ => panic!("expected restart barrier"),
            });
            scope.spawn(|| {
                queue.quiesce_and_discard().expect("quiesce queue");
                settled_tx.send(()).expect("settled queue");
            });

            barrier_seen_rx.recv().expect("barrier reached worker");
            assert!(settled_rx.try_recv().is_err());
            drop(work);
            settled_rx.recv().expect("admitted work joined");
        });

        assert!(queue.admit_work().is_err());
    }

    use crate::semantic::{
        activity::BackgroundWorkGate,
        atlas::{AtlasChatVisibilityKey, AtlasGenerationKey},
        RuntimeState, SemanticHealth, SEMANTIC_RETRY_MAX_ATTEMPTS,
    };

    #[test]
    fn queue_shutdown_interrupts_a_pending_deadline() {
        let (queue, _signals) = SemanticWorkQueue::new(PendingIndexState::default());
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let waiting = queue.clone();
        std::thread::scope(|scope| {
            scope.spawn(move || {
                done_tx
                    .send(
                        waiting.wait_for_delay_observing(std::time::Duration::from_secs(5), || {
                            ready_tx.send(()).unwrap()
                        }),
                    )
                    .unwrap();
            });
            ready_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap();
            queue.stop_worker().unwrap();
            assert!(!done_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .expect("deadline interrupted"));
        });
    }

    #[test]
    fn newer_queue_work_interrupts_a_pending_deadline_without_stopping_admission() {
        let (queue, _signals) = SemanticWorkQueue::new(PendingIndexState::default());
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let waiting = queue.clone();
        std::thread::scope(|scope| {
            scope.spawn(move || {
                done_tx
                    .send(
                        waiting.wait_for_delay_observing(std::time::Duration::from_secs(5), || {
                            ready_tx.send(()).unwrap()
                        }),
                    )
                    .unwrap();
            });
            ready_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap();
            queue
                .enqueue(|pending| pending.edge_refresh_requested = true)
                .unwrap();
            assert!(done_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .expect("new work interrupted deadline"));
            assert!(queue.pending.lock().unwrap().edge_refresh_requested);
        });
    }

    fn worker_context(
        db_path: PathBuf,
        notes_dir: PathBuf,
        provider: Arc<dyn EmbeddingProvider + Send + Sync>,
        ann: Arc<AnnIndexState>,
        note_ann: Arc<NoteAnnIndexState>,
        debug: Arc<SemanticDebugState>,
        initial: PendingIndexState,
    ) -> IndexingWorkerContext {
        let (queue, _) = SemanticWorkQueue::new(initial);
        IndexingWorkerContext {
            image_ann: Arc::new(super::super::image_ann::ImageAnnIndex::new(
                db_path.parent().unwrap().join("images"),
            )),
            generation: Arc::new(super::super::generation::SemanticGeneration::ready_for_test()),
            db_path,
            notes_dir,
            provider,
            ann,
            note_ann,
            queue,
            index_revision: Arc::new(AtomicU64::new(0)),
            runtime: Arc::new(Mutex::new(RuntimeState::default())),
            debug,
            background_gate: Arc::new(BackgroundWorkGate::new()),
        }
    }

    #[test]
    fn activation_retries_source_work_without_an_embedding_wake_and_bounds_busy_sources() {
        for settles in [true, false] {
            let temp = TestDir::new("activation-source-retry");
            let notes = temp.path().join("notes");
            fs::create_dir_all(&notes).unwrap();
            let path = temp.path().join("semantic.sqlite3");
            let connection = crate::semantic::test_support::database(&path);
            let debug = Arc::new(SemanticDebugState::new());
            let ann =
                Arc::new(AnnIndexState::new(temp.path().join("cache"), 3, debug.clone()).unwrap());
            let note_ann = test_note_ann(&temp.path().join("cache"));
            ann.rebuild_from_connection(&connection).unwrap();
            note_ann.rebuild_from_connection(&connection).unwrap();
            let mut context = worker_context(
                path,
                notes,
                Arc::new(MockEmbeddingProvider),
                ann,
                note_ann,
                debug,
                PendingIndexState::default(),
            );
            let generation = Arc::new(
                super::super::generation::SemanticGeneration::staging(&connection, "mock".into())
                    .unwrap(),
            );
            generation.scan_finished();
            generation.recall_finished();
            let (admission, mutation) =
                crate::services::note_timeline::SemanticSourceAdmission::with_pending_test_mutation(
                );
            generation.bind_sources(admission);
            context.generation = generation.clone();
            let mut mutation = Some(mutation);
            let mut waits = 0;
            process_pending_jobs_with_wait(&context, |delay| {
                assert_eq!(delay, std::time::Duration::from_millis(100));
                waits += 1;
                if settles {
                    drop(mutation.take());
                }
                true
            });
            assert_eq!(generation.is_active(), settles);
            assert_eq!(waits, if settles { 1 } else { 9 });
            assert_eq!(context.runtime.lock().unwrap().retry_exhausted, !settles);
            assert!(context.queue.pending.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn paused_wakes_release_coalescing_and_one_resume_drains_pending_work() {
        let temp = TestDir::new("paused-worker-wake");
        let semantic_dir = temp.path().join("semantic");
        let notes_dir = temp.path().join("notes");
        fs::create_dir_all(&notes_dir).expect("create notes");
        let db_path = semantic_dir.join("semantic.sqlite3");
        let connection = crate::semantic::test_support::database(&db_path);
        drop(connection);
        let debug = Arc::new(SemanticDebugState::new());
        let ann = Arc::new(
            AnnIndexState::new(semantic_dir.clone(), 3, debug.clone()).expect("create ann"),
        );
        let note_ann = test_note_ann(&semantic_dir);
        let (queue, signals) = SemanticWorkQueue::new(PendingIndexState::default());
        let gate = Arc::new(BackgroundWorkGate::new());
        let context = IndexingWorkerContext {
            image_ann: Arc::new(super::super::image_ann::ImageAnnIndex::new(
                db_path.parent().unwrap().join("images"),
            )),
            generation: Arc::new(super::super::generation::SemanticGeneration::ready_for_test()),
            db_path,
            notes_dir,
            provider: Arc::new(MockEmbeddingProvider),
            ann,
            note_ann,
            queue: queue.clone(),
            index_revision: Arc::new(AtomicU64::new(0)),
            runtime: Arc::new(Mutex::new(RuntimeState::default())),
            debug: debug.clone(),
            background_gate: gate.clone(),
        };

        gate.set_manually_paused(true).expect("pause indexing");
        queue
            .enqueue(|pending| pending.full_scan_requested = true)
            .expect("enqueue scan while paused");
        assert!(matches!(signals.recv(), Ok(WorkerSignal::Wake)));
        handle_wake(&context);
        assert!(queue.pending.lock().expect("pending").full_scan_requested);
        assert_eq!(
            debug
                .snapshot()
                .expect("paused metrics")
                .metrics
                .index_job_started_count,
            0
        );

        // A rapid resume/pause consumes the first resume wake while leaving
        // work pending. The final resume must be able to enqueue a fresh wake.
        gate.set_manually_paused(false).expect("first resume");
        queue.request_wake().expect("first resume wake");
        gate.set_manually_paused(true).expect("pause again");
        assert!(matches!(signals.recv(), Ok(WorkerSignal::Wake)));
        handle_wake(&context);
        assert!(queue.pending.lock().expect("pending").full_scan_requested);

        gate.set_manually_paused(false).expect("final resume");
        queue.request_wake().expect("final resume wake");
        queue
            .request_wake()
            .expect("coalesce duplicate resume wake");
        assert!(matches!(signals.recv(), Ok(WorkerSignal::Wake)));
        assert!(signals.try_recv().is_err(), "resume wake should coalesce");
        handle_wake(&context);

        assert!(queue.pending.lock().expect("pending").is_empty());
        let metrics = debug.snapshot().expect("completed metrics").metrics;
        assert!(metrics.index_job_completed_count > 0);
        assert_eq!(
            metrics.index_job_started_count,
            metrics.index_job_completed_count
        );
    }

    #[test]
    fn edge_dirty_threshold_forces_full_fallback() {
        assert!(dirty_count_allows_incremental(
            EDGE_MAX_INCREMENTAL_DIRTY_NOTES
        ));
        assert!(!dirty_count_allows_incremental(
            EDGE_MAX_INCREMENTAL_DIRTY_NOTES + 1
        ));
        assert!(!dirty_count_allows_incremental(0));
    }

    #[test]
    fn snapshot_publication_keeps_edge_generation_aligned_for_atlas() {
        let temp = TestDir::new("snapshot-before-edges");
        let semantic_dir = temp.path().join("semantic");
        let notes_dir = temp.path().join("notes");
        fs::create_dir_all(&notes_dir).expect("create notes dir");
        fs::write(
            notes_dir.join("Atlas.md"),
            "# Atlas\n\nA note with enough content to index.",
        )
        .expect("write note");
        let db_path = semantic_dir.join("semantic.sqlite3");
        let mut connection = crate::semantic::test_support::database(&db_path);
        let provider: Arc<dyn EmbeddingProvider + Send + Sync> = Arc::new(MockEmbeddingProvider);
        let debug = Arc::new(SemanticDebugState::new());
        let ann = Arc::new(
            AnnIndexState::new(semantic_dir.clone(), 3, debug.clone()).expect("create ann"),
        );
        let note_ann = test_note_ann(&semantic_dir);
        process_full_scan(
            &mut connection,
            &notes_dir,
            &provider,
            &ann,
            &note_ann,
            true,
            &debug,
        )
        .expect("scan");
        ann.rebuild_from_connection(&connection)
            .expect("build ANN snapshot");
        note_ann
            .rebuild_from_connection(&connection)
            .expect("build note ANN snapshot");
        drop(connection);

        let context = worker_context(
            db_path.clone(),
            notes_dir,
            provider,
            ann,
            note_ann.clone(),
            debug,
            PendingIndexState {
                edge_refresh_requested: true,
                snapshot_publish_requested: true,
                ..PendingIndexState::default()
            },
        );
        let mut waits = Vec::new();
        process_pending_jobs_with_wait(&context, |delay| {
            waits.push(delay);
            true
        });
        assert_eq!(waits, vec![std::time::Duration::from_secs(2)]);

        let connection = open_database(&db_path).expect("reopen database");
        let edge_generation = load_edge_generation(&connection)
            .expect("load edge generation")
            .expect("published edge generation");
        assert_eq!(
            Some(edge_generation.note_ann_generation.as_str()),
            note_ann.generation_id().as_deref()
        );
    }

    #[test]
    fn atlas_failure_backoff_is_bounded() {
        assert_eq!(atlas_failure_backoff(1).as_millis(), 100);
        assert_eq!(atlas_failure_backoff(2).as_millis(), 200);
        assert_eq!(atlas_failure_backoff(100).as_millis(), 2_000);
    }

    #[test]
    fn semantic_failure_backoff_is_bounded() {
        assert_eq!(semantic_failure_backoff(1).as_millis(), 100);
        assert_eq!(semantic_failure_backoff(2).as_millis(), 200);
        assert_eq!(semantic_failure_backoff(3).as_millis(), 400);
        assert_eq!(semantic_failure_backoff(100).as_millis(), 400);
    }

    #[test]
    fn scan_keeps_newer_recall_that_arrives_during_embedding() {
        let temp = TestDir::new("scan-newer-recall");
        let notes_dir = temp.path().join("notes");
        fs::create_dir_all(&notes_dir).unwrap();
        fs::write(
            notes_dir.join("Note.md"),
            "# Note\n\nTrigger scan embedding.",
        )
        .unwrap();
        let db_path = temp.path().join("semantic.sqlite3");
        let connection = crate::semantic::test_support::database(&db_path);
        let debug = Arc::new(SemanticDebugState::new());
        let ann =
            Arc::new(AnnIndexState::new(temp.path().join("cache"), 3, debug.clone()).unwrap());
        let recorder = Arc::new(RecordingEmbeddingProvider::default());
        let recall_path = temp.path().join("Chats/Conversation.md");
        let recall = |quote: &str, modified_millis| PendingNoteUpdate {
            document: PendingSemanticDocument::ChatRecall {
                title: "Conversation".into(),
                excerpts: vec![ChatRecallExcerpt {
                    anchor: "excerpt".into(),
                    quote: quote.into(),
                }],
            },
            modified_millis,
        };
        let context = worker_context(
            db_path,
            notes_dir,
            recorder.clone(),
            ann,
            test_note_ann(&temp.path().join("cache")),
            debug,
            PendingIndexState {
                full_scan_requested: true,
                note_updates: HashMap::from([(recall_path.clone(), recall("old excerpt", 1))]),
                ..PendingIndexState::default()
            },
        );
        let pending = context.queue.pending.clone();
        let update_path = recall_path.clone();
        let newer = recall("new excerpt", 2);
        *recorder.before_embed.lock().unwrap() = Some(Box::new(move || {
            pending
                .lock()
                .unwrap()
                .note_updates
                .insert(update_path, newer);
        }));
        // Stop at the snapshot coalescing delay; both indexing jobs have committed.
        process_pending_jobs_with_wait(&context, |_| false);
        let quote: String = connection
            .query_row(
                "SELECT text FROM chunks WHERE note_path = ?1",
                [recall_path.to_string_lossy().as_ref()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(quote, "new excerpt");
    }

    #[test]
    fn failed_label_claim_keeps_newer_request_and_clears_building_marker() {
        use super::{AtlasGenerationKey, AtlasLabelRequest, SelectedJob};
        let key = AtlasGenerationKey::default();
        let old = AtlasLabelRequest {
            structural_generation: "old".into(),
            membership_fingerprint: "old members".into(),
        };
        let newer = AtlasLabelRequest {
            structural_generation: "new".into(),
            membership_fingerprint: "new members".into(),
        };
        let pending = Arc::new(Mutex::new(PendingIndexState {
            atlas_label_requests: HashMap::from([(key, old)]),
            ..PendingIndexState::default()
        }));
        let job = SelectedJob::claim(&mut pending.lock().unwrap()).unwrap();
        let result: Result<(), String> = run_label_atlas_build(&pending, key, || {
            let mut next = pending.lock().unwrap();
            assert!(next.atlas_label_building.contains(&key));
            next.atlas_label_requests.insert(key, newer.clone());
            Err("deterministic build failure".into())
        });
        assert!(result.is_err());
        let mut next = pending.lock().unwrap();
        job.requeue(&mut next);
        assert_eq!(next.atlas_label_requests.get(&key), Some(&newer));
        assert!(next.atlas_label_building.is_empty());
    }

    #[test]
    fn indexing_failures_stop_at_the_retry_bound_and_keep_repair_pending() {
        let temp = TestDir::new("indexer-retry-bound");
        let semantic_dir = temp.path().join("semantic");
        let notes_dir = temp.path().join("notes");
        fs::create_dir_all(&notes_dir).expect("create notes");
        fs::write(
            notes_dir.join("Retry.md"),
            "# Retry\n\nContent requiring an embedding.",
        )
        .expect("write note");
        let db_path = semantic_dir.join("semantic.sqlite3");
        let connection = crate::semantic::test_support::database(&db_path);
        drop(connection);
        let provider: Arc<dyn EmbeddingProvider + Send + Sync> = Arc::new(FailingEmbeddingProvider);
        let debug = Arc::new(SemanticDebugState::new());
        let ann =
            Arc::new(AnnIndexState::new(semantic_dir.clone(), 3, debug.clone()).expect("ann"));
        let note_ann = test_note_ann(&semantic_dir);
        let context = worker_context(
            db_path,
            notes_dir,
            provider,
            ann,
            note_ann,
            debug.clone(),
            PendingIndexState {
                full_scan_requested: true,
                force_full_scan: true,
                ..PendingIndexState::default()
            },
        );
        let mut waits = Vec::new();
        process_pending_jobs_with_wait(&context, |delay| {
            waits.push(delay.as_millis());
            true
        });
        assert_eq!(waits, vec![100, 200]);

        let runtime = context.runtime.lock().expect("runtime");
        assert_eq!(runtime.retry_attempt, SEMANTIC_RETRY_MAX_ATTEMPTS);
        assert!(runtime.retry_exhausted);
        assert_eq!(runtime.health, SemanticHealth::Degraded);
        drop(runtime);
        assert!(
            context
                .queue
                .pending
                .lock()
                .expect("pending")
                .full_scan_requested
        );
        assert_eq!(
            debug
                .snapshot()
                .expect("debug")
                .metrics
                .index_job_failed_count,
            u64::from(SEMANTIC_RETRY_MAX_ATTEMPTS)
        );
    }

    fn pending_markdown(markdown: &str, modified_millis: u64) -> PendingNoteUpdate {
        PendingNoteUpdate {
            document: PendingSemanticDocument::NoteMarkdown(markdown.to_string()),
            modified_millis,
        }
    }

    fn markdown_from(update: &PendingNoteUpdate) -> &str {
        match &update.document {
            PendingSemanticDocument::NoteMarkdown(markdown) => markdown,
            PendingSemanticDocument::ChatRecall { .. } => panic!("expected note Markdown"),
        }
    }

    #[test]
    fn failed_batch_merge_keeps_the_newest_update_for_a_path() {
        let path = PathBuf::from("/vault/Note.md");
        let mut failed = PendingIndexState::default();
        failed
            .note_updates
            .insert(path.clone(), pending_markdown("old", 1));
        let mut live = PendingIndexState::default();
        live.note_updates
            .insert(path.clone(), pending_markdown("new", 2));

        merge_retry_batch(&mut live, failed);

        let update = live.note_updates.get(&path).expect("newest update");
        assert_eq!(markdown_from(update), "new");
        assert_eq!(update.modified_millis, 2);
        assert!(!live.deleted_notes.contains(&path));
    }

    #[test]
    fn failed_batch_merge_uses_newest_wins_for_update_and_delete() {
        let deleted_path = PathBuf::from("/vault/Deleted.md");
        let restored_path = PathBuf::from("/vault/Restored.md");
        let mut failed = PendingIndexState::default();
        failed.note_updates.insert(
            deleted_path.clone(),
            pending_markdown("must not resurrect", 1),
        );
        failed.deleted_notes.insert(restored_path.clone());
        let mut live = PendingIndexState::default();
        live.deleted_notes.insert(deleted_path.clone());
        live.note_updates
            .insert(restored_path.clone(), pending_markdown("newly restored", 2));

        merge_retry_batch(&mut live, failed);

        assert!(live.deleted_notes.contains(&deleted_path));
        assert!(!live.note_updates.contains_key(&deleted_path));
        assert!(!live.deleted_notes.contains(&restored_path));
        assert_eq!(
            markdown_from(
                live.note_updates
                    .get(&restored_path)
                    .expect("newer restoration")
            ),
            "newly restored"
        );
    }

    #[test]
    fn failed_batch_merge_folds_move_chains_and_preserves_later_destination_delete() {
        let old_path = PathBuf::from("/vault/A.md");
        let middle_path = PathBuf::from("/vault/B.md");
        let final_path = PathBuf::from("/vault/C.md");
        let mut failed = PendingIndexState::default();
        failed.moved_notes.insert(
            old_path.clone(),
            PendingNoteMove {
                new_path: middle_path.clone(),
                markdown: "old move".to_string(),
                modified_millis: 1,
            },
        );
        let mut live = PendingIndexState::default();
        live.moved_notes.insert(
            middle_path,
            PendingNoteMove {
                new_path: final_path.clone(),
                markdown: "new move".to_string(),
                modified_millis: 2,
            },
        );
        live.deleted_notes.insert(final_path.clone());

        merge_retry_batch(&mut live, failed);

        let moved = live.moved_notes.get(&old_path).expect("folded move");
        assert_eq!(moved.new_path, final_path);
        assert_eq!(moved.markdown, "new move");
        assert_eq!(moved.modified_millis, 2);
        assert!(live.deleted_notes.contains(&moved.new_path));
        assert_eq!(live.moved_notes.len(), 1);
    }

    #[test]
    fn failed_batch_merge_treats_a_newer_move_as_authoritative_for_both_endpoints() {
        let old_path = PathBuf::from("/vault/A.md");
        let new_path = PathBuf::from("/vault/B.md");
        let mut failed = PendingIndexState::default();
        failed
            .note_updates
            .insert(old_path.clone(), pending_markdown("old source", 1));
        failed
            .note_updates
            .insert(new_path.clone(), pending_markdown("old destination", 1));
        failed.deleted_notes.insert(old_path.clone());
        failed.deleted_notes.insert(new_path.clone());
        let mut live = PendingIndexState::default();
        live.moved_notes.insert(
            old_path.clone(),
            PendingNoteMove {
                new_path: new_path.clone(),
                markdown: "authoritative move".to_string(),
                modified_millis: 2,
            },
        );

        merge_retry_batch(&mut live, failed);

        assert!(live.note_updates.is_empty());
        assert!(live.deleted_notes.is_empty());
        let moved = live.moved_notes.get(&old_path).expect("newer move");
        assert_eq!(moved.new_path, new_path);
        assert_eq!(moved.markdown, "authoritative move");
    }

    #[test]
    fn newer_rebuild_discards_failed_incremental_mutations() {
        let path = PathBuf::from("/vault/Note.md");
        let mut failed = PendingIndexState::default();
        failed
            .note_updates
            .insert(path.clone(), pending_markdown("stale", 1));
        failed
            .deleted_notes
            .insert(PathBuf::from("/vault/Deleted.md"));
        let mut live = PendingIndexState {
            rebuild_requested: true,
            ..PendingIndexState::default()
        };

        merge_retry_batch(&mut live, failed);

        assert!(live.rebuild_requested);
        assert!(live.note_updates.is_empty());
        assert!(live.deleted_notes.is_empty());
        assert!(live.moved_notes.is_empty());
    }

    #[test]
    fn atlas_building_flags_clear_after_panics() {
        let pending = Arc::new(Mutex::new(PendingIndexState::default()));
        let key = AtlasGenerationKey {
            chat_visibility: AtlasChatVisibilityKey::Hidden,
        };
        assert!(
            run_structural_atlas_build::<()>(&pending, key, 7, || panic!("structural panic"))
                .is_err()
        );
        assert!(!pending
            .lock()
            .expect("pending")
            .atlas_building
            .contains_key(&key));

        assert!(run_label_atlas_build::<()>(&pending, key, || panic!("label panic")).is_err());
        assert!(!pending
            .lock()
            .expect("pending")
            .atlas_label_building
            .contains(&key));
    }
    use crate::semantic::{
        ann::AnnIndexState,
        chunking::SemanticChunk,
        db::{
            load_ann_index_signature, load_edge_generation, open_database, upsert_note_chunks,
            SemanticNoteMetadata,
        },
        debug::SemanticDebugState,
        embed::{EmbeddingInputKind, EmbeddingProvider, ModelInfo, EMBEDDING_BATCH_SIZE},
        note_ann::NoteAnnIndexState,
    };
    use std::{
        collections::{HashMap, HashSet},
        fs,
        path::{Path, PathBuf},
        sync::{atomic::AtomicU64, Arc, Mutex},
    };

    #[test]
    fn full_scan_applies_external_deletes_incrementally() {
        let temp = TestDir::new("indexer-delete");
        let semantic_dir = temp.path().join("semantic");
        let notes_dir = temp.path().join("notes");
        fs::create_dir_all(&notes_dir).expect("create notes dir");
        let db_path = semantic_dir.join("semantic.sqlite3");
        let mut connection = crate::semantic::test_support::database(&db_path);
        let provider: Arc<dyn EmbeddingProvider + Send + Sync> = Arc::new(MockEmbeddingProvider);
        let debug = Arc::new(SemanticDebugState::new());
        let ann = Arc::new(
            AnnIndexState::new(semantic_dir.clone(), 3, debug.clone()).expect("create ann"),
        );
        let note_ann = test_note_ann(&semantic_dir);

        let note_path = notes_dir.join("external-delete.md");
        fs::write(
            &note_path,
            "# External Delete\n\nFirst paragraph for indexing.\n\nSecond paragraph for indexing.",
        )
        .expect("write note");

        process_full_scan(
            &mut connection,
            &notes_dir,
            &provider,
            &ann,
            &note_ann,
            true,
            &debug,
        )
        .expect("initial full scan");
        ann.rebuild_from_connection(&connection)
            .expect("publish initial snapshot");
        assert_eq!(
            load_ann_index_signature(&connection)
                .expect("load ann signature")
                .chunk_count,
            ann.status_snapshot().indexed_chunks
        );
        assert!(ann.status_snapshot().indexed_chunks > 0);

        fs::remove_file(&note_path).expect("remove note");
        process_full_scan(
            &mut connection,
            &notes_dir,
            &provider,
            &ann,
            &note_ann,
            false,
            &debug,
        )
        .expect("scan after external delete");

        let signature = load_ann_index_signature(&connection).expect("load ann signature");
        assert_eq!(signature.chunk_count, 0);

        let status = ann.status_snapshot();
        assert!(status.loaded);
        assert_eq!(status.indexed_chunks, 0);
        assert!(ann
            .search(&[1.0, 0.0, 0.0], 8)
            .expect("ann search")
            .is_empty());
    }

    #[test]
    fn startup_scan_replaces_old_tag_heading_and_divider_chunks_without_source_edits() {
        let temp = TestDir::new("indexer-tag-divider-refresh");
        let notes_dir = temp.path().join("notes");
        let semantic_dir = temp.path().join("semantic");
        fs::create_dir_all(&notes_dir).unwrap();
        let path = notes_dir.join("Astrophotography.md");
        let markdown = "#code #astrophotography\n\n---";
        fs::write(&path, markdown).unwrap();
        let path_string = path.to_string_lossy().into_owned();
        let modified = super::read_modified_millis(&path).unwrap();
        let mut connection =
            crate::semantic::test_support::database(&semantic_dir.join("index.sqlite3"));
        let provider: Arc<dyn EmbeddingProvider + Send + Sync> = Arc::new(MockEmbeddingProvider);
        let debug = Arc::new(SemanticDebugState::new());
        let ann = Arc::new(AnnIndexState::new(semantic_dir.clone(), 3, debug.clone()).unwrap());
        let note_ann = test_note_ann(&semantic_dir);
        // Persist exactly the former extraction: a hashtag row became a
        // section heading, whose only passage was the Markdown divider.
        let old_chunks = [
            ("Title", "Astrophotography", 1),
            ("code #astrophotography", "---", 3),
        ]
        .into_iter()
        .enumerate()
        .map(|(ordinal, (label, text, line))| SemanticChunk {
            ordinal,
            section_label: label.into(),
            text: text.into(),
            text_hash: crate::semantic::db::content_hash(text),
            start_line: line,
            end_line: line,
            block_anchor: None,
        })
        .collect::<Vec<_>>();
        let old_note = crate::semantic::chunking::ChunkedNote {
            title: "Astrophotography".into(),
            content_hash: crate::semantic::db::content_hash(markdown),
            chunks: old_chunks,
        };
        let metadata = super::note_semantic_metadata(
            &path_string,
            &old_note,
            &note::parse_note(markdown),
            modified,
        );
        upsert_note_chunks(
            &mut connection,
            &path_string,
            &old_note.title,
            modified,
            &crate::semantic::db::content_hash(markdown),
            "",
            "",
            crate::note::DocumentKind::Note,
            &metadata,
            &old_note.chunks,
            &[vec![1.0, 0.0, 0.0], vec![0.0, 1.0, 0.0]],
        )
        .unwrap();
        let refreshed = process_full_scan(
            &mut connection,
            &notes_dir,
            &provider,
            &ann,
            &note_ann,
            false,
            &debug,
        )
        .unwrap();
        assert_eq!(refreshed.scanned_count, 1);
        assert_eq!(
            refreshed.embedded_count, 1,
            "reuse the unchanged title vector"
        );
        let chunks = connection
            .prepare("SELECT section_label, text FROM chunks ORDER BY ordinal")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            chunks,
            vec![
                ("Title".into(), "Astrophotography".into()),
                ("Overview".into(), "#code #astrophotography".into())
            ]
        );
        let settled = process_full_scan(
            &mut connection,
            &notes_dir,
            &provider,
            &ann,
            &note_ann,
            false,
            &debug,
        )
        .unwrap();
        assert_eq!(settled.scanned_count, 0);
        assert_eq!(settled.embedded_count, 0);
        assert_eq!(fs::read_to_string(path).unwrap(), markdown);
    }

    #[test]
    fn full_scan_indexes_nested_notes() {
        let temp = TestDir::new("indexer-nested");
        let semantic_dir = temp.path().join("semantic");
        let notes_dir = temp.path().join("notes");
        let nested_dir = notes_dir.join("Projects");
        let hidden_dir = notes_dir.join(".obsidian");
        fs::create_dir_all(&nested_dir).expect("create nested dir");
        fs::create_dir_all(&hidden_dir).expect("create hidden dir");

        fs::write(
            nested_dir.join("Roadmap.md"),
            "# Roadmap\n\nParagraph one.\n\nParagraph two.",
        )
        .expect("write nested note");
        fs::write(hidden_dir.join("Ignore.md"), "# Ignore\n\nConfig").expect("write hidden note");

        let db_path = semantic_dir.join("semantic.sqlite3");
        let mut connection = crate::semantic::test_support::database(&db_path);
        let provider: Arc<dyn EmbeddingProvider + Send + Sync> = Arc::new(MockEmbeddingProvider);
        let debug = Arc::new(SemanticDebugState::new());
        let ann = Arc::new(
            AnnIndexState::new(semantic_dir.clone(), 3, debug.clone()).expect("create ann"),
        );
        let note_ann = test_note_ann(&semantic_dir);

        let outcome = process_full_scan(
            &mut connection,
            &notes_dir,
            &provider,
            &ann,
            &note_ann,
            true,
            &debug,
        )
        .expect("scan");

        assert_eq!(outcome.scanned_count, 1);
        assert!(outcome.embedded_count > 0);

        let before = debug.snapshot().expect("debug before no-op").metrics;
        let no_op = process_full_scan(
            &mut connection,
            &notes_dir,
            &provider,
            &ann,
            &note_ann,
            false,
            &debug,
        )
        .expect("no-op scan");
        let after = debug.snapshot().expect("debug after no-op").metrics;
        assert_eq!(no_op.scanned_count, 0);
        assert_eq!(no_op.embedded_count, 0);
        assert_eq!(after.ann_rebuild_count, before.ann_rebuild_count);
        assert_eq!(after.edge_rebuild_count, before.edge_rebuild_count);

        connection
            .execute(
                "UPDATE notes SET semantic_input_hash = '', structure_hash = '',
                 presentation_hash = ''",
                [],
            )
            .expect("clear foundation hashes");
        let reconciled = process_full_scan(
            &mut connection,
            &notes_dir,
            &provider,
            &ann,
            &note_ann,
            false,
            &debug,
        )
        .expect("reconcile legacy row");
        assert_eq!(reconciled.scanned_count, 1);
        assert_eq!(
            reconciled.embedded_count, 0,
            "unchanged chunks should reuse embeddings"
        );
        let hashes: (String, String, String) = connection
            .query_row(
                "SELECT semantic_input_hash, structure_hash, presentation_hash FROM notes",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("foundation hashes");
        assert!(hashes.0.len() >= 32);
        assert!(hashes.1.len() >= 32);
        assert!(hashes.2.len() >= 32);
    }

    #[test]
    fn chat_recall_indexes_only_immutable_excerpt_chunks() {
        let temp = TestDir::new("chat-recall");
        let db_path = temp.path().join("semantic.sqlite3");
        let mut connection = crate::semantic::test_support::database(&db_path);
        let provider: Arc<dyn EmbeddingProvider + Send + Sync> = Arc::new(MockEmbeddingProvider);
        let debug = Arc::new(SemanticDebugState::new());
        let ann = Arc::new(
            AnnIndexState::new(temp.path().join("cache"), 3, debug.clone()).expect("create ann"),
        );
        let note_ann = test_note_ann(&temp.path().join("cache"));
        let path = temp.path().join("Chats/example/Conversation.md");
        let update = PendingNoteUpdate {
            document: PendingSemanticDocument::ChatRecall {
                title: "A conversation".to_string(),
                excerpts: vec![
                    ChatRecallExcerpt {
                        anchor: "excerpt_one".to_string(),
                        quote: "first selected quote".to_string(),
                    },
                    ChatRecallExcerpt {
                        anchor: "excerpt_two".to_string(),
                        quote: "second selected quote".to_string(),
                    },
                ],
            },
            modified_millis: 1,
        };
        process_note_batch(
            &mut connection,
            &provider,
            &ann,
            &note_ann,
            SemanticDocumentBatch::new(
                HashMap::from([(path.clone(), update)]),
                HashSet::new(),
                HashMap::new(),
            ),
            &debug,
        )
        .expect("index recall");

        let (kind, count): (String, usize) = connection
            .query_row(
                "SELECT document_kind, chunk_count FROM notes WHERE path = ?1",
                [path.to_string_lossy().as_ref()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("recall document");
        assert_eq!(kind, "chatIndex");
        assert_eq!(count, 2);
        let chunks = connection
            .prepare("SELECT text, block_anchor FROM chunks WHERE note_path = ?1 ORDER BY ordinal")
            .unwrap()
            .query_map([path.to_string_lossy().as_ref()], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            chunks,
            vec![
                (
                    "first selected quote".to_string(),
                    "excerpt_one".to_string()
                ),
                (
                    "second selected quote".to_string(),
                    "excerpt_two".to_string()
                ),
            ]
        );

        let empty_notes_dir = temp.path().join("notes");
        fs::create_dir_all(&empty_notes_dir).expect("create empty notes dir");
        let no_op = process_full_scan(
            &mut connection,
            &empty_notes_dir,
            &provider,
            &ann,
            &note_ann,
            false,
            &debug,
        )
        .expect("ordinary startup scan");
        assert_eq!(no_op.scanned_count, 0);
        let preserved: usize = connection
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE path = ?1",
                [path.to_string_lossy().as_ref()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(preserved, 1);

        process_note_batch(
            &mut connection,
            &provider,
            &ann,
            &note_ann,
            SemanticDocumentBatch::new(
                HashMap::new(),
                HashSet::from([path.clone()]),
                HashMap::new(),
            ),
            &debug,
        )
        .expect("delete final recall");
        let remaining: usize = connection
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE path = ?1",
                [path.to_string_lossy().as_ref()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
    }

    fn remembering_one_excerpt_sql_work(documents: usize, chunks_per_document: usize) -> usize {
        let temp = TestDir::new("chat-recall-large-corpus");
        let db_path = temp.path().join("semantic.sqlite3");
        let mut connection = crate::semantic::test_support::database(&db_path);
        for document in 0..documents {
            let chunks = (0..chunks_per_document)
                .map(|ordinal| {
                    let text = format!("document {document} chunk {ordinal}");
                    SemanticChunk {
                        ordinal,
                        section_label: format!("Chunk {ordinal}"),
                        text_hash: blake3::hash(text.as_bytes()).to_hex().to_string(),
                        text,
                        start_line: ordinal + 1,
                        end_line: ordinal + 1,
                        block_anchor: None,
                    }
                })
                .collect::<Vec<_>>();
            let embeddings = (0..chunks_per_document)
                .map(|ordinal| {
                    let mut value = vec![0.0, 0.0, 0.0];
                    value[ordinal % 3] = 1.0;
                    value
                })
                .collect::<Vec<_>>();
            upsert_note_chunks(
                &mut connection,
                &format!("/vault/note-{document}.md"),
                &format!("Note {document}"),
                1,
                &format!("hash-{document}"),
                "",
                "",
                crate::note::DocumentKind::Note,
                &SemanticNoteMetadata::default(),
                &chunks,
                &embeddings,
            )
            .expect("seed corpus");
        }

        let provider: Arc<dyn EmbeddingProvider + Send + Sync> = Arc::new(MockEmbeddingProvider);
        let debug = Arc::new(SemanticDebugState::new());
        let ann = Arc::new(
            AnnIndexState::new(temp.path().join("cache"), 3, debug.clone()).expect("create ann"),
        );
        let note_ann = test_note_ann(&temp.path().join("cache"));
        let recall_path = temp.path().join("Chats/example/Conversation.md");
        let sql_steps = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed_steps = sql_steps.clone();
        connection.progress_handler(
            1,
            Some(move || {
                observed_steps.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                false
            }),
        );
        let outcome = process_note_batch(
            &mut connection,
            &provider,
            &ann,
            &note_ann,
            SemanticDocumentBatch::new(
                HashMap::from([(
                    recall_path,
                    PendingNoteUpdate {
                        document: PendingSemanticDocument::ChatRecall {
                            title: "One memory".to_string(),
                            excerpts: vec![ChatRecallExcerpt {
                                anchor: "excerpt_one".to_string(),
                                quote: "only this passage is embedded".to_string(),
                            }],
                        },
                        modified_millis: 2,
                    },
                )]),
                HashSet::new(),
                HashMap::new(),
            ),
            &debug,
        )
        .expect("index one recall");

        connection.progress_handler(0, None::<fn() -> bool>);
        let sql_steps = sql_steps.load(std::sync::atomic::Ordering::Relaxed);
        assert_eq!(outcome.scanned_count, 1);
        assert_eq!(outcome.embedded_count, 1);
        let chunk_count: usize = connection
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
            .expect("count chunks");
        assert_eq!(chunk_count, documents * chunks_per_document + 1);
        let metrics = debug.snapshot().expect("debug snapshot").metrics;
        assert_eq!(metrics.ann_rebuild_count, 0);
        assert_eq!(metrics.edge_rebuild_count, 0);
        sql_steps
    }

    #[test]
    fn remembering_one_excerpt_has_corpus_independent_sql_work_and_no_rebuild() {
        let small = remembering_one_excerpt_sql_work(4, 8);
        let larger = remembering_one_excerpt_sql_work(40, 8);
        assert!(
            larger <= small + 100,
            "single recall SQL work grew with corpus: {small} -> {larger}"
        );
    }

    #[test]
    #[ignore = "opt-in semantic 20k-row scale distribution"]
    fn remembering_one_excerpt_twenty_thousand_chunk_scale() {
        let small = remembering_one_excerpt_sql_work(4, 8);
        let large = remembering_one_excerpt_sql_work(200, 100);
        assert!(
            large <= small + 100,
            "single recall SQL work grew with corpus: {small} -> {large}"
        );
    }

    #[test]
    fn note_batch_embeds_across_notes_in_large_provider_requests() {
        let temp = TestDir::new("indexer-cross-note-batch");
        let db_path = temp.path().join("semantic.sqlite3");
        let mut connection = crate::semantic::test_support::database(&db_path);
        let recorder = Arc::new(RecordingEmbeddingProvider::default());
        let provider: Arc<dyn EmbeddingProvider + Send + Sync> = recorder.clone();
        let debug = Arc::new(SemanticDebugState::new());
        let ann = Arc::new(
            AnnIndexState::new(temp.path().join("cache"), 3, debug.clone()).expect("create ann"),
        );
        let note_ann = test_note_ann(&temp.path().join("cache"));

        let mut updates = HashMap::new();
        for note_index in 0..5 {
            let path = temp.path().join(format!("note-{note_index}.md"));
            let body = (0..10)
                .map(|chunk_index| {
                    format!(
                        "Paragraph {note_index}.{chunk_index} with enough text to stay distinct."
                    )
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            updates.insert(
                path,
                PendingNoteUpdate {
                    document: PendingSemanticDocument::NoteMarkdown(format!(
                        "---\ntitle: Note {note_index}\n---\n\n{body}"
                    )),
                    modified_millis: note_index as u64 + 1,
                },
            );
        }

        let outcome = process_note_batch(
            &mut connection,
            &provider,
            &ann,
            &note_ann,
            SemanticDocumentBatch::new(updates, HashSet::new(), HashMap::new()),
            &debug,
        )
        .expect("index notes");

        assert!(outcome.embedded_count >= 5);
        let call_sizes = recorder.call_sizes.lock().expect("call sizes");
        assert_eq!(
            call_sizes.len(),
            1,
            "expected one cross-note embedding request, got {call_sizes:?}"
        );
        assert_eq!(call_sizes[0], outcome.embedded_count);
        assert!(call_sizes[0] <= EMBEDDING_BATCH_SIZE);
    }

    struct MockEmbeddingProvider;
    struct FailingEmbeddingProvider;

    #[derive(Default)]
    struct RecordingEmbeddingProvider {
        call_sizes: Mutex<Vec<usize>>,
        before_embed: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    }

    fn test_note_ann(cache_dir: &Path) -> Arc<NoteAnnIndexState> {
        Arc::new(
            NoteAnnIndexState::new(cache_dir.to_path_buf(), 3, "mock::mock".to_string())
                .expect("create note ann"),
        )
    }

    impl EmbeddingProvider for MockEmbeddingProvider {
        fn embed_texts(
            &self,
            texts: &[String],
            _kind: EmbeddingInputKind,
        ) -> Result<Vec<Vec<f32>>, String> {
            Ok(texts
                .iter()
                .enumerate()
                .map(|(index, text)| {
                    let mut vector = vec![0.0, 0.0, 0.0];
                    let bucket = index % vector.len();
                    vector[bucket] = text.len() as f32 + 1.0;
                    vector
                })
                .collect())
        }

        fn prepare(&self) -> Result<(), String> {
            Ok(())
        }

        fn model_info(&self) -> ModelInfo {
            ModelInfo {
                id: "mock".to_string(),
                label: "Mock".to_string(),
                dimensions: 3,
                runtime_binary_path: None,
                model_path: None,
                model_repo_id: "mock".to_string(),
                available: true,
                loading: false,
                ready: true,
                status: "ready".to_string(),
                error: None,
            }
        }

        fn shutdown(&self) {}
    }

    impl EmbeddingProvider for FailingEmbeddingProvider {
        fn embed_texts(
            &self,
            _texts: &[String],
            _kind: EmbeddingInputKind,
        ) -> Result<Vec<Vec<f32>>, String> {
            Err("deterministic embedding failure".to_string())
        }

        fn prepare(&self) -> Result<(), String> {
            Ok(())
        }

        fn model_info(&self) -> ModelInfo {
            MockEmbeddingProvider.model_info()
        }

        fn shutdown(&self) {}
    }

    impl EmbeddingProvider for RecordingEmbeddingProvider {
        fn embed_texts(
            &self,
            texts: &[String],
            kind: EmbeddingInputKind,
        ) -> Result<Vec<Vec<f32>>, String> {
            if let Some(before_embed) = self.before_embed.lock().unwrap().take() {
                before_embed();
            }
            self.call_sizes
                .lock()
                .map_err(|_| "call sizes lock poisoned".to_string())?
                .push(texts.len());
            MockEmbeddingProvider.embed_texts(texts, kind)
        }

        fn prepare(&self) -> Result<(), String> {
            Ok(())
        }

        fn model_info(&self) -> ModelInfo {
            MockEmbeddingProvider.model_info()
        }

        fn shutdown(&self) {}
    }
}
