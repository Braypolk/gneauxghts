use super::{
    activity::BackgroundWorkGate,
    ann::{AnnIndexState, ANN_MAX_INCREMENTAL_CHUNKS, ANN_MAX_INCREMENTAL_DOCUMENTS},
    chunking::chunk_markdown,
    db::{
        content_hash, delete_note, ensure_schema, insert_job, load_existing_chunk_embeddings,
        load_note_chunk_labels, load_note_record, load_stored_note_records, move_note,
        open_database, rebuild_edges_with_checkpoint, update_job, upsert_note_chunks,
        EdgeRebuildStats,
    },
    debug::SemanticDebugState,
    embed::{EmbeddingInputKind, EmbeddingProvider},
    RuntimeState,
};
use crate::{
    note, path_utils::collect_markdown_files_recursively, state::derive_file_stem,
    time::current_time_millis,
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::Receiver,
        Arc, Mutex,
    },
    thread,
    time::Instant,
    time::UNIX_EPOCH,
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
    pending: &Arc<Mutex<PendingIndexState>>,
    index_revision: &Arc<AtomicU64>,
    runtime: &Arc<Mutex<RuntimeState>>,
    debug: &Arc<SemanticDebugState>,
    background_gate: &Arc<BackgroundWorkGate>,
) {
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
        let has_document_mutations = !batch.note_updates.is_empty()
            || !batch.deleted_notes.is_empty()
            || !batch.moved_notes.is_empty();
        let mut handled_documents = false;
        let mut handled_automatic_rebuild = false;
        let mut handled_edges = false;
        let mut handled_snapshot = false;

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
                state.recovery_state = "waitingForIdle".to_string();
                state.rebuild_reason = Some("ANN snapshot requires fallback rebuild".to_string());
                state.indexing_in_progress = true;
                state.current_job_label = Some("Waiting for idle".to_string());
            });
            background_gate.wait_for_automatic_idle();
            update_runtime(runtime, |state| {
                state.recovery_state = "rebuilding".to_string();
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
                    };
                    ann.rebuild_from_connection_with_gate(
                        connection,
                        Some(background_gate.as_ref()),
                        true,
                        Some(&progress),
                    )?;
                    Ok(JobOutcome::default())
                },
            )
        } else if batch.edge_refresh_requested {
            handled_edges = true;
            update_runtime(runtime, |state| {
                state.recovery_state = "waitingForIdle".to_string();
                state.rebuild_reason = Some("Related-note edges are stale".to_string());
                state.indexing_in_progress = true;
                state.current_job_label = Some("Waiting for idle".to_string());
            });
            background_gate.wait_for_automatic_idle();
            update_runtime(runtime, |state| {
                state.recovery_state = "rebuilding".to_string();
            });
            run_job(
                db_path,
                runtime,
                debug,
                "Refreshing related notes",
                |connection| {
                    let started_at = Instant::now();
                    let stats = rebuild_edges_with_checkpoint(
                        connection,
                        EDGE_NEIGHBORS_PER_NOTE,
                        EDGE_MIN_SCORE,
                        |current, total| {
                            update_runtime(runtime, |state| {
                                state.progress_current = current;
                                state.progress_total = total;
                            });
                            background_gate.wait_for_automatic_idle();
                        },
                    )?;
                    record_edge_rebuild(debug, &stats, started_at.elapsed().as_millis() as u64);
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
                        Ok(JobOutcome::default())
                    },
                )
            }
        } else {
            true
        };

        if did_succeed {
            index_revision.fetch_add(1, Ordering::AcqRel);
            let last_job_scanned_count = runtime
                .lock()
                .map(|state| state.last_job_scanned_count)
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
                if handled_documents && last_job_scanned_count > 0 {
                    next.edge_refresh_requested = true;
                    update_runtime(runtime, |state| state.edges_stale = true);
                    if ann.needs_rebuild() {
                        next.automatic_rebuild_requested = true;
                    } else {
                        next.snapshot_publish_requested = true;
                    }
                }
                if batch.full_scan_requested {
                    if ann.needs_rebuild() {
                        next.automatic_rebuild_requested = true;
                    } else if last_job_scanned_count > 0 {
                        next.snapshot_publish_requested = true;
                    }
                    if last_job_scanned_count > 0 {
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
            }
            update_runtime(runtime, |state| {
                if handled_edges {
                    state.edges_stale = false;
                }
                if !state.indexing_paused {
                    state.recovery_state = if ann.needs_rebuild() {
                        "stale".to_string()
                    } else {
                        "ready".to_string()
                    };
                }
            });
        }
    }
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

fn process_full_scan(
    connection: &mut rusqlite::Connection,
    notes_dir: &Path,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: &Arc<AnnIndexState>,
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
        let should_consider = force
            || stored
                .get(&raw_path)
                .map(|note| note.modified_millis != modified_millis)
                .unwrap_or(true);
        if !should_consider {
            continue;
        }

        let next_content_hash = content_hash(&markdown);
        if !force
            && stored
                .get(&raw_path)
                .is_some_and(|note| note.content_hash == next_content_hash)
        {
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
    let outcome = process_full_scan(connection, notes_dir, provider, ann, true, debug)?;
    let progress = |current, total| {
        update_runtime(runtime, |state| {
            state.progress_current = current;
            state.progress_total = total;
        });
    };
    ann.rebuild_from_connection_with_gate(
        connection,
        Some(background_gate.as_ref()),
        false,
        Some(&progress),
    )?;
    Ok(outcome)
}

fn process_note_batch(
    connection: &mut rusqlite::Connection,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: &Arc<AnnIndexState>,
    note_updates: HashMap<PathBuf, PendingNoteUpdate>,
    deleted_notes: HashSet<PathBuf>,
    moved_notes: HashMap<PathBuf, PendingNoteMove>,
    debug: &Arc<SemanticDebugState>,
) -> Result<JobOutcome, String> {
    let mut scanned_count = 0usize;
    let mut embedded_count = 0usize;
    let mut needs_ann_rebuild = ann.needs_rebuild();
    let mutation_count = note_updates.len() + deleted_notes.len() + moved_notes.len();
    let mut defer_ann_updates = mutation_count > ANN_MAX_INCREMENTAL_DOCUMENTS;
    let mut changed_chunk_count = 0usize;
    if defer_ann_updates {
        needs_ann_rebuild = true;
    }

    // Process moves first: re-key existing rows from old path to new path,
    // reusing stored embeddings (no embedding-server calls). A successful move
    // changes chunk ann_labels, so the ANN graph must rebuild afterwards. If
    // the source row is missing (never indexed), fall back to a normal index
    // of the new path so the content still gets embedded.
    for (old_path, moved) in moved_notes {
        let old_path_str = old_path.to_string_lossy().into_owned();
        let new_path_str = moved.new_path.to_string_lossy().into_owned();
        let moved_in_place = move_note(connection, &old_path_str, &new_path_str)?;
        if moved_in_place {
            needs_ann_rebuild = true;
        } else {
            let indexed_note = index_note_content(
                connection,
                provider,
                &moved.new_path,
                &moved.markdown,
                moved.modified_millis,
            )?;
            embedded_count += indexed_note.embedded_count;
            needs_ann_rebuild = true;
        }
        scanned_count += 1;
    }

    for note_path in deleted_notes {
        let path_str = note_path.to_string_lossy().into_owned();
        let previous_labels = load_note_chunk_labels(connection, &path_str)?;
        if previous_labels.is_empty() && load_note_record(connection, &path_str)?.is_none() {
            continue;
        }
        delete_note(connection, &path_str)?;
        changed_chunk_count = changed_chunk_count.saturating_add(previous_labels.len());
        if changed_chunk_count > ANN_MAX_INCREMENTAL_CHUNKS {
            defer_ann_updates = true;
            needs_ann_rebuild = true;
        }
        if !defer_ann_updates && !ann.apply_note_delete(&previous_labels)? {
            needs_ann_rebuild = true;
        }
        scanned_count += 1;
    }

    for (note_path, update) in note_updates {
        let previous_labels = load_note_chunk_labels(connection, &note_path.to_string_lossy())?;
        let indexed_note = match update.document {
            PendingSemanticDocument::NoteMarkdown(markdown) => {
                if !crate::note::semantic_recall_eligible(&markdown) {
                    let path_str = note_path.to_string_lossy().into_owned();
                    delete_note(connection, &path_str)?;
                    changed_chunk_count = changed_chunk_count.saturating_add(previous_labels.len());
                    if changed_chunk_count > ANN_MAX_INCREMENTAL_CHUNKS {
                        defer_ann_updates = true;
                        needs_ann_rebuild = true;
                    }
                    if !defer_ann_updates && !ann.apply_note_delete(&previous_labels)? {
                        needs_ann_rebuild = true;
                    }
                    scanned_count += 1;
                    continue;
                }
                index_note_content(
                    connection,
                    provider,
                    &note_path,
                    &markdown,
                    update.modified_millis,
                )?
            }
            PendingSemanticDocument::ChatRecall { title, excerpts } => index_chat_recall_content(
                connection,
                provider,
                &note_path,
                &title,
                &excerpts,
                update.modified_millis,
            )?,
        };
        embedded_count += indexed_note.embedded_count;
        changed_chunk_count = changed_chunk_count
            .saturating_add(previous_labels.len().max(indexed_note.chunks.len()));
        if changed_chunk_count > ANN_MAX_INCREMENTAL_CHUNKS {
            defer_ann_updates = true;
            needs_ann_rebuild = true;
        }
        if !defer_ann_updates
            && !ann.apply_note_upsert(
                &note_path,
                &previous_labels,
                &indexed_note.chunks,
                &indexed_note.embeddings,
            )?
        {
            needs_ann_rebuild = true;
        }
        scanned_count += 1;
    }

    if scanned_count > 0 && needs_ann_rebuild {
        ann.request_rebuild("incremental_update_requires_compaction");
    }
    if scanned_count > 0 {
        debug.sample_rss("index", "note_batch_completed");
    }

    Ok(JobOutcome {
        scanned_count,
        embedded_count,
    })
}

fn index_chat_recall_content(
    connection: &mut rusqlite::Connection,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    conversation_path: &Path,
    title: &str,
    excerpts: &[ChatRecallExcerpt],
    modified_millis: u64,
) -> Result<IndexedNoteContent, String> {
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
    let mut texts_to_embed = Vec::new();
    let mut embed_indexes = Vec::new();
    for (index, chunk) in chunks.iter().enumerate() {
        if let Some(existing) = stored_chunks.get(&chunk.ordinal) {
            if existing.text_hash == chunk.text_hash && !existing.embedding.is_empty() {
                embeddings[index] = existing.embedding.clone();
                continue;
            }
        }
        texts_to_embed.push(chunk.text.clone());
        embed_indexes.push(index);
    }
    let fresh = provider.embed_texts(&texts_to_embed, EmbeddingInputKind::Document)?;
    for (embedding, index) in fresh.into_iter().zip(embed_indexes) {
        embeddings[index] = embedding;
    }
    let timestamp = crate::note::timestamp_millis_to_rfc3339(modified_millis);
    upsert_note_chunks(
        connection,
        &path,
        title,
        modified_millis,
        &chat_recall_content_hash(excerpts),
        &timestamp,
        &timestamp,
        crate::note::DocumentKind::ChatIndex,
        &chunks,
        &embeddings,
    )?;
    Ok(IndexedNoteContent {
        embedded_count: texts_to_embed.len(),
        chunks,
        embeddings,
    })
}

fn index_note_content(
    connection: &mut rusqlite::Connection,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    note_path: &Path,
    markdown: &str,
    modified_millis: u64,
) -> Result<IndexedNoteContent, String> {
    let fallback_title = note_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| derive_file_stem(markdown));
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

    let mut embeddings = vec![Vec::new(); chunked_note.chunks.len()];
    let mut texts_to_embed = Vec::new();
    let mut embed_indexes = Vec::new();

    for (index, chunk) in chunked_note.chunks.iter().enumerate() {
        if let Some(existing_chunk) = stored_chunks.get(&chunk.ordinal) {
            if existing_chunk.text_hash == chunk.text_hash && !existing_chunk.embedding.is_empty() {
                embeddings[index] = existing_chunk.embedding.clone();
                continue;
            }
        }

        texts_to_embed.push(chunk.text.clone());
        embed_indexes.push(index);
    }

    let new_embeddings = provider.embed_texts(&texts_to_embed, EmbeddingInputKind::Document)?;
    for (embedding, index) in new_embeddings.into_iter().zip(embed_indexes.into_iter()) {
        embeddings[index] = embedding;
    }

    upsert_note_chunks(
        connection,
        &note_path,
        &chunked_note.title,
        modified_millis,
        &chunked_note.content_hash,
        &created_at,
        &updated_at,
        crate::note::DocumentKind::Note,
        &chunked_note.chunks,
        &embeddings,
    )?;

    Ok(IndexedNoteContent {
        embedded_count: texts_to_embed.len(),
        chunks: chunked_note.chunks,
        embeddings,
    })
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
}

struct IndexedNoteContent {
    embedded_count: usize,
    chunks: Vec<super::chunking::SemanticChunk>,
    embeddings: Vec<Vec<f32>>,
}

#[cfg(test)]
mod tests {
    use super::{
        process_full_scan, process_note_batch, ChatRecallExcerpt, PendingNoteUpdate,
        PendingSemanticDocument,
    };
    use crate::semantic::{
        ann::AnnIndexState,
        chunking::SemanticChunk,
        db::{ensure_schema, load_ann_index_signature, open_database, upsert_note_chunks},
        debug::SemanticDebugState,
        embed::{EmbeddingInputKind, EmbeddingProvider, ModelInfo},
    };
    use std::{
        collections::{HashMap, HashSet},
        fs,
        path::{Path, PathBuf},
        sync::Arc,
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
        let ann = Arc::new(AnnIndexState::new(semantic_dir, 3, debug.clone()).expect("create ann"));

        let note_path = notes_dir.join("external-delete.md");
        fs::write(
            &note_path,
            "# External Delete\n\nFirst paragraph for indexing.\n\nSecond paragraph for indexing.",
        )
        .expect("write note");

        process_full_scan(&mut connection, &notes_dir, &provider, &ann, true, &debug)
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
        process_full_scan(&mut connection, &notes_dir, &provider, &ann, false, &debug)
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
        let ann = Arc::new(AnnIndexState::new(semantic_dir, 3, debug.clone()).expect("create ann"));

        let outcome = process_full_scan(&mut connection, &notes_dir, &provider, &ann, true, &debug)
            .expect("scan");

        assert_eq!(outcome.scanned_count, 1);
        assert!(outcome.embedded_count > 0);

        let before = debug.snapshot().expect("debug before no-op").metrics;
        let no_op = process_full_scan(&mut connection, &notes_dir, &provider, &ann, false, &debug)
            .expect("no-op scan");
        let after = debug.snapshot().expect("debug after no-op").metrics;
        assert_eq!(no_op.scanned_count, 0);
        assert_eq!(no_op.embedded_count, 0);
        assert_eq!(after.ann_rebuild_count, before.ann_rebuild_count);
        assert_eq!(after.edge_rebuild_count, before.edge_rebuild_count);
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
        let recall_path = temp.path().join("Chats/example/Conversation.md");
        let outcome = process_note_batch(
            &mut connection,
            &provider,
            &ann,
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

    struct MockEmbeddingProvider;

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
