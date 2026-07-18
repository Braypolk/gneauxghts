use super::{
    activity::BackgroundWorkGate,
    ann::{AnnIndexState, ANN_MAX_INCREMENTAL_CHUNKS, ANN_MAX_INCREMENTAL_DOCUMENTS},
    atlas::{AtlasChatVisibilityKey, AtlasGenerationKey, AtlasLabelRequest, AtlasWorkerContext},
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
    RuntimeState,
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
        mpsc::Receiver,
        Arc, Mutex,
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

#[derive(Default)]
pub(crate) struct PendingIndexState {
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
    SetPaused { paused: bool },
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_indexing_worker(
    db_path: PathBuf,
    notes_dir: PathBuf,
    provider: Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: Arc<AnnIndexState>,
    note_ann: Arc<NoteAnnIndexState>,
    signal_rx: Receiver<WorkerSignal>,
    pending: Arc<Mutex<PendingIndexState>>,
    wake_pending: Arc<AtomicBool>,
    index_revision: Arc<AtomicU64>,
    runtime: &Arc<Mutex<RuntimeState>>,
    debug: Arc<SemanticDebugState>,
    background_gate: Arc<BackgroundWorkGate>,
) -> Result<(), String> {
    let runtime = Arc::clone(runtime);
    thread::Builder::new()
        .name("semantic-indexer".to_string())
        .spawn(move || {
            run_worker(
                db_path,
                notes_dir,
                provider,
                ann,
                note_ann,
                signal_rx,
                pending,
                wake_pending,
                index_revision,
                runtime,
                debug,
                background_gate,
            );
        })
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[allow(clippy::too_many_arguments)]
fn run_worker(
    db_path: PathBuf,
    notes_dir: PathBuf,
    provider: Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: Arc<AnnIndexState>,
    note_ann: Arc<NoteAnnIndexState>,
    signal_rx: Receiver<WorkerSignal>,
    pending: Arc<Mutex<PendingIndexState>>,
    wake_pending: Arc<AtomicBool>,
    index_revision: Arc<AtomicU64>,
    runtime: Arc<Mutex<RuntimeState>>,
    debug: Arc<SemanticDebugState>,
    background_gate: Arc<BackgroundWorkGate>,
) {
    let mut paused = false;

    loop {
        match signal_rx.recv() {
            Ok(WorkerSignal::SetPaused {
                paused: next_paused,
            }) => {
                paused = next_paused;
                update_runtime(&runtime, |state| {
                    state.indexing_paused = next_paused;
                });
                if !paused {
                    wake_pending.store(false, Ordering::Release);
                    process_pending_jobs(
                        &db_path,
                        &notes_dir,
                        &provider,
                        &ann,
                        &note_ann,
                        &pending,
                        &index_revision,
                        &runtime,
                        &debug,
                        &background_gate,
                    );
                }
            }
            Ok(WorkerSignal::Wake) => {
                if paused {
                    continue;
                }

                wake_pending.store(false, Ordering::Release);
                process_pending_jobs(
                    &db_path,
                    &notes_dir,
                    &provider,
                    &ann,
                    &note_ann,
                    &pending,
                    &index_revision,
                    &runtime,
                    &debug,
                    &background_gate,
                );
            }
            Err(_) => return,
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn process_pending_jobs(
    db_path: &Path,
    notes_dir: &Path,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: &Arc<AnnIndexState>,
    note_ann: &Arc<NoteAnnIndexState>,
    pending: &Arc<Mutex<PendingIndexState>>,
    index_revision: &Arc<AtomicU64>,
    runtime: &Arc<Mutex<RuntimeState>>,
    debug: &Arc<SemanticDebugState>,
    background_gate: &Arc<BackgroundWorkGate>,
) {
    let mut atlas_retry_attempts = HashMap::<AtlasGenerationKey, u32>::new();
    let mut label_retry_attempts = HashMap::<AtlasGenerationKey, u32>::new();
    loop {
        let batch = {
            let mut pending = match pending.lock() {
                Ok(pending) => pending,
                Err(_) => return,
            };
            if pending.is_empty() {
                return;
            }
            std::mem::take(&mut *pending)
        };
        let deferred_explicit_updates = if batch.rebuild_requested || batch.full_scan_requested {
            Some((
                batch.note_updates.clone(),
                batch.deleted_notes.clone(),
                batch.moved_notes.clone(),
            ))
        } else {
            None
        };
        let deferred_atlas_requests = batch.atlas_requests.clone();
        let deferred_atlas_label_requests = batch.atlas_label_requests.clone();
        let has_document_mutations = !batch.note_updates.is_empty()
            || !batch.deleted_notes.is_empty()
            || !batch.moved_notes.is_empty();
        let mut handled_documents = false;
        let mut handled_automatic_rebuild = false;
        let mut handled_edges = false;
        let mut handled_snapshot = false;
        let mut handled_atlas = false;
        let mut handled_structural_atlas = false;
        let mut handled_label_atlas = false;
        let mut atlas_retry_delay = Duration::ZERO;

        let did_succeed = if batch.rebuild_requested {
            let job_notes_dir = notes_dir.to_path_buf();
            let job_provider = provider.clone();
            let job_debug = debug.clone();
            run_job(
                db_path,
                runtime,
                debug,
                "Rebuilding semantic index",
                move |connection| {
                    process_rebuild(
                        connection,
                        &job_notes_dir,
                        &job_provider,
                        ann,
                        note_ann,
                        &job_debug,
                        background_gate,
                        runtime,
                    )
                },
            )
        } else if batch.full_scan_requested {
            let job_notes_dir = notes_dir.to_path_buf();
            let job_provider = provider.clone();
            let job_debug = debug.clone();
            let force = batch.force_full_scan;
            run_job(
                db_path,
                runtime,
                debug,
                "Scanning notes",
                move |connection| {
                    process_full_scan(
                        connection,
                        &job_notes_dir,
                        &job_provider,
                        ann,
                        note_ann,
                        force,
                        &job_debug,
                    )
                },
            )
        } else if has_document_mutations {
            handled_documents = true;
            let mutation_count =
                batch.note_updates.len() + batch.deleted_notes.len() + batch.moved_notes.len();
            let job_provider = provider.clone();
            let job_debug = debug.clone();
            run_job(
                db_path,
                runtime,
                debug,
                "Indexing notes",
                move |connection| {
                    update_runtime(runtime, |state| {
                        state.progress_current = 0;
                        state.progress_total = mutation_count;
                    });
                    process_note_batch(
                        connection,
                        &job_provider,
                        ann,
                        note_ann,
                        batch.note_updates,
                        batch.deleted_notes,
                        batch.moved_notes,
                        &job_debug,
                    )
                },
            )
        } else if batch.automatic_rebuild_requested {
            handled_automatic_rebuild = true;
            update_runtime(runtime, |state| {
                state.recovery_state = "rebuilding".to_string();
                state.rebuild_reason = Some("ANN snapshot requires fallback rebuild".to_string());
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
        } else if batch.edge_refresh_requested {
            handled_edges = true;
            update_runtime(runtime, |state| {
                state.recovery_state = "rebuilding".to_string();
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
                            EDGE_MIN_SCORE,
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
                        record_edge_rebuild(debug, &stats, started_at.elapsed().as_millis() as u64);
                    } else {
                        repair_dirty_edges(
                            connection,
                            EDGE_NEIGHBORS_PER_NOTE,
                            EDGE_MIN_SCORE,
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
        } else if batch.snapshot_publish_requested {
            handled_snapshot = true;
            // Coalesce edit bursts before serializing the graph generation.
            thread::sleep(std::time::Duration::from_secs(2));
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
                true
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
        } else if !batch.atlas_requests.is_empty() {
            handled_atlas = true;
            handled_structural_atlas = true;
            let cache_dir = db_path
                .parent()
                .map(|parent| parent.join(crate::state::VAULT_CACHE_DIR_NAME))
                .unwrap_or_else(|| PathBuf::from(crate::state::VAULT_CACHE_DIR_NAME));
            let builder = AtlasWorkerContext {
                db_path: db_path.to_path_buf(),
                cache_dir,
                dimensions: provider.model_info().dimensions,
                provider: provider.clone(),
                debug: debug.clone(),
                note_ann: note_ann.clone(),
                pending: pending.clone(),
            };
            for (key, target_epoch) in batch.atlas_requests {
                let newer_waiting = pending
                    .lock()
                    .map(|state| {
                        state
                            .atlas_requests
                            .get(&key)
                            .is_some_and(|epoch| *epoch > target_epoch)
                    })
                    .unwrap_or(true);
                if newer_waiting {
                    continue;
                }
                let result = run_structural_atlas_build(pending, key, target_epoch, || {
                    builder.build_and_publish(key, target_epoch)
                });
                match result {
                    Ok(_) => {
                        atlas_retry_attempts.remove(&key);
                    }
                    Err(error) if error == "atlas generation superseded" => {
                        atlas_retry_attempts.remove(&key);
                    }
                    Err(error) => {
                        let attempt = atlas_retry_attempts.entry(key).or_default();
                        *attempt = attempt.saturating_add(1);
                        atlas_retry_delay = atlas_retry_delay.max(atlas_failure_backoff(*attempt));
                        if let Ok(mut state) = pending.lock() {
                            state
                                .atlas_requests
                                .entry(key)
                                .and_modify(|epoch| *epoch = (*epoch).max(target_epoch))
                                .or_insert(target_epoch);
                        }
                        debug.record_with_metrics(
                            "atlas",
                            "build_failed",
                            Some(error),
                            None,
                            |_| {},
                        );
                    }
                }
            }
            true
        } else if !batch.atlas_label_requests.is_empty() {
            handled_atlas = true;
            handled_label_atlas = true;
            let cache_dir = db_path
                .parent()
                .map(|parent| parent.join(crate::state::VAULT_CACHE_DIR_NAME))
                .unwrap_or_else(|| PathBuf::from(crate::state::VAULT_CACHE_DIR_NAME));
            let builder = AtlasWorkerContext {
                db_path: db_path.to_path_buf(),
                cache_dir,
                dimensions: provider.model_info().dimensions,
                provider: provider.clone(),
                debug: debug.clone(),
                note_ann: note_ann.clone(),
                pending: pending.clone(),
            };
            for (key, request) in batch.atlas_label_requests {
                let superseded = pending
                    .lock()
                    .map(|state| {
                        state
                            .atlas_label_requests
                            .get(&key)
                            .is_some_and(|newer| newer != &request)
                    })
                    .unwrap_or(true);
                if superseded {
                    continue;
                }
                let result = run_label_atlas_build(pending, key, || {
                    builder.build_and_publish_labels(key, &request)
                });
                match result {
                    Ok(()) => {
                        label_retry_attempts.remove(&key);
                    }
                    Err(error) if error == "atlas generation superseded" => {
                        label_retry_attempts.remove(&key);
                    }
                    Err(error) => {
                        let attempt = label_retry_attempts.entry(key).or_default();
                        *attempt = attempt.saturating_add(1);
                        atlas_retry_delay = atlas_retry_delay.max(atlas_failure_backoff(*attempt));
                        if let Ok(mut state) = pending.lock() {
                            state.atlas_label_requests.insert(key, request.clone());
                        }
                        debug.record_with_metrics(
                            "atlas_labels",
                            "build_failed",
                            Some(error),
                            None,
                            |metrics| metrics.atlas_label_failure_count += 1,
                        );
                    }
                }
            }
            true
        } else {
            true
        };

        if did_succeed {
            let next_revision = if handled_atlas {
                index_revision.load(Ordering::Acquire)
            } else {
                index_revision
                    .fetch_add(1, Ordering::AcqRel)
                    .saturating_add(1)
            };
            let (last_job_scanned_count, last_job_edges_dirtied) = runtime
                .lock()
                .map(|state| (state.last_job_scanned_count, state.last_job_edges_dirtied))
                .unwrap_or_default();
            // A filesystem scan/rebuild cannot reconstruct ChatRecall
            // documents. Replay any coalesced explicit mutations after the
            // bulk operation instead of dropping them with the batch.
            if let Some((updates, deletes, moves)) = deferred_explicit_updates {
                if !updates.is_empty() || !deletes.is_empty() || !moves.is_empty() {
                    if let Ok(mut next) = pending.lock() {
                        next.note_updates.extend(updates);
                        next.deleted_notes.extend(deletes);
                        next.moved_notes.extend(moves);
                    }
                }
            }
            if let Ok(mut next) = pending.lock() {
                if !handled_structural_atlas {
                    for (key, epoch) in deferred_atlas_requests {
                        let epoch = epoch.max(next_revision);
                        next.atlas_requests
                            .entry(key)
                            .and_modify(|target| *target = (*target).max(epoch))
                            .or_insert(epoch);
                    }
                }
                if !handled_label_atlas {
                    for (key, request) in deferred_atlas_label_requests {
                        next.atlas_label_requests.entry(key).or_insert(request);
                    }
                }
                if handled_documents && last_job_scanned_count > 0 {
                    if last_job_edges_dirtied {
                        next.edge_refresh_requested = true;
                        update_runtime(runtime, |state| state.edges_stale = true);
                    }
                    if ann.needs_rebuild() || note_ann.needs_rebuild() {
                        next.automatic_rebuild_requested = true;
                    } else {
                        next.snapshot_publish_requested = true;
                    }
                }
                if batch.full_scan_requested {
                    if ann.needs_rebuild() || note_ann.needs_rebuild() {
                        next.automatic_rebuild_requested = true;
                    } else if last_job_scanned_count > 0 {
                        next.snapshot_publish_requested = true;
                    }
                    if last_job_edges_dirtied {
                        next.edge_refresh_requested = true;
                        update_runtime(runtime, |state| state.edges_stale = true);
                    }
                }
                if batch.rebuild_requested {
                    next.edge_refresh_requested = true;
                    update_runtime(runtime, |state| state.edges_stale = true);
                }
                if !handled_automatic_rebuild && batch.automatic_rebuild_requested {
                    next.automatic_rebuild_requested = true;
                }
                if !handled_edges && batch.edge_refresh_requested {
                    next.edge_refresh_requested = true;
                }
                if !handled_snapshot
                    && batch.snapshot_publish_requested
                    && !handled_automatic_rebuild
                {
                    next.snapshot_publish_requested = true;
                }
                if !handled_atlas {
                    let cache_dir = db_path
                        .parent()
                        .map(|parent| parent.join(crate::state::VAULT_CACHE_DIR_NAME))
                        .unwrap_or_else(|| PathBuf::from(crate::state::VAULT_CACHE_DIR_NAME));
                    for visibility in [
                        AtlasChatVisibilityKey::Hidden,
                        AtlasChatVisibilityKey::Remembered,
                        AtlasChatVisibilityKey::All,
                    ] {
                        let key = AtlasGenerationKey {
                            chat_visibility: visibility,
                        };
                        let pointer = cache_dir
                            .join("atlas")
                            .join(format!("ready-{}.json", visibility.signature_value()));
                        if pointer.exists() {
                            next.atlas_requests
                                .entry(key)
                                .and_modify(|epoch| *epoch = (*epoch).max(next_revision))
                                .or_insert(next_revision);
                        }
                    }
                }
            }
            update_runtime(runtime, |state| {
                if handled_edges {
                    state.edges_stale = false;
                }
                if !state.indexing_paused {
                    state.recovery_state = if ann.needs_rebuild() || note_ann.needs_rebuild() {
                        "stale".to_string()
                    } else {
                        "ready".to_string()
                    };
                }
            });
        }
        if !atlas_retry_delay.is_zero() {
            thread::sleep(atlas_retry_delay);
        }
    }
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
) -> bool
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
        if label == "Scanning notes" || label == "Indexing notes" {
            state.recovery_state = "catchingUp".to_string();
        }
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

    let result = (|| -> Result<(), String> {
        let mut connection = open_database(db_path)?;
        ensure_schema(&connection)?;
        let job_id = insert_job(&connection, "running", 0, 0, None)?;
        match job(&mut connection) {
            Ok(outcome) => {
                update_runtime(runtime, |state| {
                    state.last_job_scanned_count = outcome.scanned_count;
                    state.last_job_edges_dirtied = outcome.edges_dirtied;
                });
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
                return Err(error);
            }
        }
        Ok(())
    })();

    match result {
        Ok(()) => {
            let now = current_time_millis().ok();
            update_runtime(runtime, |state| {
                state.indexing_in_progress = false;
                state.current_job_label = None;
                state.last_indexed_at_millis = now;
            });
            true
        }
        Err(error) => {
            update_runtime(runtime, |state| {
                state.indexing_in_progress = false;
                state.current_job_label = None;
                state.last_error = Some(error);
            });
            false
        }
    }
}

/// Maximum inferred neighbors recorded per note during edge rebuild.
const EDGE_NEIGHBORS_PER_NOTE: usize = 6;
/// Minimum cosine similarity for two notes to be linked.
const EDGE_MIN_SCORE: f32 = 0.42;
/// Dirty batches above this bound use the existing full reconciliation path.
pub(crate) const EDGE_MAX_INCREMENTAL_DIRTY_NOTES: usize = 32;
/// Search wider than the emitted top-K to catch reverse-neighbor changes.
const EDGE_INCREMENTAL_CANDIDATE_K: usize = EDGE_NEIGHBORS_PER_NOTE * 8;

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
        updates,
        deleted_notes,
        HashMap::new(),
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
    notes_dir: &Path,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: &Arc<AnnIndexState>,
    note_ann: &Arc<NoteAnnIndexState>,
    debug: &Arc<SemanticDebugState>,
    background_gate: &Arc<BackgroundWorkGate>,
    runtime: &Arc<Mutex<RuntimeState>>,
) -> Result<JobOutcome, String> {
    connection
        .execute_batch(
            "
            DELETE FROM chunks;
            DELETE FROM note_embeddings;
            DELETE FROM edges;
            DELETE FROM notes;
            ",
        )
        .map_err(|err| err.to_string())?;
    let outcome = process_full_scan(connection, notes_dir, provider, ann, note_ann, true, debug)?;
    let progress = |current, total| {
        update_runtime(runtime, |state| {
            state.progress_current = current;
            state.progress_total = total;
        });
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
    Ok(outcome)
}

fn process_note_batch(
    connection: &mut rusqlite::Connection,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: &Arc<AnnIndexState>,
    note_ann: &Arc<NoteAnnIndexState>,
    note_updates: HashMap<PathBuf, PendingNoteUpdate>,
    deleted_notes: HashSet<PathBuf>,
    moved_notes: HashMap<PathBuf, PendingNoteMove>,
    debug: &Arc<SemanticDebugState>,
) -> Result<JobOutcome, String> {
    let mut scanned_count = 0usize;
    let mut embedded_count = 0usize;
    let mut force_ann_rebuild = false;
    let mut force_note_ann_rebuild = false;
    let mutation_count = note_updates.len() + deleted_notes.len() + moved_notes.len();
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
    for (old_path, moved) in moved_notes {
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

    for note_path in deleted_notes {
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
    for (note_path, update) in note_updates {
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
            PendingSemanticDocument::ChatRecall { title, excerpts } => {
                prepare_chat_recall_content(
                    connection,
                    &note_path,
                    &title,
                    &excerpts,
                    update.modified_millis,
                )?
            }
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
        for (pending_offset, &chunk_index) in update.prepared.pending_chunk_indexes.iter().enumerate()
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
    let presentation_hash = hash_parts([
        note::DocumentKind::Note.as_frontmatter_value().to_string(),
        chunked_note.title.clone(),
        preview.clone(),
        tags_json.clone(),
        note_id.to_string(),
        created_at.to_string(),
        updated_at.to_string(),
        modified_millis.to_string(),
    ]);

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

fn extract_tags(parsed_note: &note::ParsedNote, chunked_note: &ChunkedNote) -> Vec<String> {
    let mut tags = Vec::new();
    if let Some(frontmatter) = parsed_note.frontmatter.raw_other.as_deref() {
        collect_frontmatter_tags(frontmatter, &mut tags);
    }
    for chunk in &chunked_note.chunks {
        collect_hashtags(&chunk.text, &mut tags);
    }
    tags
}

fn collect_frontmatter_tags(frontmatter: &str, tags: &mut Vec<String>) {
    let mut in_tag_list = false;
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if let Some(raw) = trimmed.strip_prefix("tags:") {
            in_tag_list = raw.trim().is_empty();
            collect_tag_values(raw, tags);
        } else if in_tag_list {
            if let Some(raw) = trimmed.strip_prefix('-') {
                collect_tag_values(raw, tags);
            } else if !trimmed.is_empty() {
                in_tag_list = false;
            }
        }
    }
}

fn collect_tag_values(raw: &str, tags: &mut Vec<String>) {
    for value in raw.trim().trim_matches(['[', ']']).split(',') {
        let tag = value
            .trim()
            .trim_matches(['"', '\''])
            .trim_start_matches('#')
            .trim();
        if !tag.is_empty() && tag.chars().all(is_tag_char) {
            tags.push(tag.to_lowercase());
        }
    }
}

fn collect_hashtags(text: &str, tags: &mut Vec<String>) {
    for word in text.split_whitespace() {
        let tag = word
            .strip_prefix('#')
            .unwrap_or("")
            .trim_matches(|character: char| !is_tag_char(character));
        if !tag.is_empty() && tag.chars().all(is_tag_char) {
            tags.push(tag.to_lowercase());
        }
    }
}

fn is_tag_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
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
        atlas_failure_backoff, dirty_count_allows_incremental, process_full_scan,
        process_note_batch, run_label_atlas_build, run_structural_atlas_build, ChatRecallExcerpt,
        PendingIndexState, PendingNoteUpdate, PendingSemanticDocument,
        EDGE_MAX_INCREMENTAL_DIRTY_NOTES,
    };
    use crate::semantic::atlas::{AtlasChatVisibilityKey, AtlasGenerationKey};

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
    fn atlas_failure_backoff_is_bounded() {
        assert_eq!(atlas_failure_backoff(1).as_millis(), 100);
        assert_eq!(atlas_failure_backoff(2).as_millis(), 200);
        assert_eq!(atlas_failure_backoff(100).as_millis(), 2_000);
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
            ensure_schema, load_ann_index_signature, open_database, upsert_note_chunks,
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
        sync::{Arc, Mutex},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn full_scan_applies_external_deletes_incrementally() {
        let temp = TestDir::new("indexer-delete");
        let semantic_dir = temp.path().join("semantic");
        let notes_dir = temp.path().join("notes");
        fs::create_dir_all(&notes_dir).expect("create notes dir");
        let db_path = semantic_dir.join("semantic.sqlite3");
        let mut connection = open_database(&db_path).expect("open database");
        ensure_schema(&connection).expect("ensure schema");
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
        let mut connection = open_database(&db_path).expect("open database");
        ensure_schema(&connection).expect("ensure schema");
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
        let mut connection = open_database(&db_path).expect("open database");
        ensure_schema(&connection).expect("ensure schema");
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
            HashMap::from([(path.clone(), update)]),
            HashSet::new(),
            HashMap::new(),
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
            HashMap::new(),
            HashSet::from([path.clone()]),
            HashMap::new(),
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

    #[test]
    fn remembering_one_excerpt_does_not_rebuild_or_walk_a_twenty_thousand_chunk_corpus() {
        let temp = TestDir::new("chat-recall-large-corpus");
        let db_path = temp.path().join("semantic.sqlite3");
        let mut connection = open_database(&db_path).expect("open database");
        ensure_schema(&connection).expect("ensure schema");
        for document in 0..200 {
            let chunks = (0..100)
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
            let embeddings = (0..100)
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
        let outcome = process_note_batch(
            &mut connection,
            &provider,
            &ann,
            &note_ann,
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
            &debug,
        )
        .expect("index one recall");

        assert_eq!(outcome.scanned_count, 1);
        assert_eq!(outcome.embedded_count, 1);
        let chunk_count: usize = connection
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
            .expect("count chunks");
        assert_eq!(chunk_count, 20_001);
        let metrics = debug.snapshot().expect("debug snapshot").metrics;
        assert_eq!(metrics.ann_rebuild_count, 0);
        assert_eq!(metrics.edge_rebuild_count, 0);
    }

    #[test]
    fn note_batch_embeds_across_notes_in_large_provider_requests() {
        let temp = TestDir::new("indexer-cross-note-batch");
        let db_path = temp.path().join("semantic.sqlite3");
        let mut connection = open_database(&db_path).expect("open database");
        ensure_schema(&connection).expect("ensure schema");
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
                    format!("Paragraph {note_index}.{chunk_index} with enough text to stay distinct.")
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
            updates,
            HashSet::new(),
            HashMap::new(),
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

    #[derive(Default)]
    struct RecordingEmbeddingProvider {
        call_sizes: Mutex<Vec<usize>>,
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
                local_only: true,
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

    impl EmbeddingProvider for RecordingEmbeddingProvider {
        fn embed_texts(
            &self,
            texts: &[String],
            kind: EmbeddingInputKind,
        ) -> Result<Vec<Vec<f32>>, String> {
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

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos();
            let path = std::env::temp_dir().join(format!("gneauxghts-{label}-{unique}"));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}
