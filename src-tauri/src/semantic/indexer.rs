use super::{
    ann::AnnIndexState,
    chunking::chunk_markdown,
    current_time_millis,
    db::{
        content_hash, delete_note, ensure_schema, insert_job, load_existing_chunk_embeddings,
        load_note_chunk_labels, load_stored_note_records, open_database, rebuild_edges, update_job,
        upsert_note_chunks,
    },
    debug::SemanticDebugState,
    embed::{EmbeddingInputKind, EmbeddingProvider},
    RuntimeState,
};
use crate::{index::is_note_file, state::derive_file_stem};
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

#[derive(Clone)]
pub(crate) struct PendingNoteUpdate {
    pub(crate) markdown: String,
    pub(crate) modified_millis: u64,
}

#[derive(Default)]
pub(crate) struct PendingIndexState {
    pub(crate) full_scan_requested: bool,
    pub(crate) force_full_scan: bool,
    pub(crate) rebuild_requested: bool,
    pub(crate) note_updates: HashMap<PathBuf, PendingNoteUpdate>,
    pub(crate) deleted_notes: HashSet<PathBuf>,
}

impl PendingIndexState {
    fn is_empty(&self) -> bool {
        !self.full_scan_requested
            && !self.rebuild_requested
            && self.note_updates.is_empty()
            && self.deleted_notes.is_empty()
    }
}

pub(crate) enum WorkerSignal {
    Wake,
    SetPaused { paused: bool },
}

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
            );
        })
        .map(|_| ())
        .map_err(|err| err.to_string())
}

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
                );
            }
            Err(_) => return,
        }
    }
}

fn process_pending_jobs(
    db_path: &Path,
    notes_dir: &Path,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: &Arc<AnnIndexState>,
    pending: &Arc<Mutex<PendingIndexState>>,
    index_revision: &Arc<AtomicU64>,
    runtime: &Arc<Mutex<RuntimeState>>,
    debug: &Arc<SemanticDebugState>,
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

        let did_succeed = if batch.rebuild_requested {
            let job_notes_dir = notes_dir.to_path_buf();
            let job_provider = provider.clone();
            run_job(
                db_path,
                runtime,
                debug,
                "Rebuilding semantic index",
                move |connection| process_rebuild(connection, &job_notes_dir, &job_provider, ann),
            )
        } else if batch.full_scan_requested {
            let job_notes_dir = notes_dir.to_path_buf();
            let job_provider = provider.clone();
            let force = batch.force_full_scan;
            run_job(
                db_path,
                runtime,
                debug,
                "Scanning notes",
                move |connection| {
                    process_full_scan(connection, &job_notes_dir, &job_provider, ann, force)
                },
            )
        } else {
            let job_provider = provider.clone();
            run_job(
                db_path,
                runtime,
                debug,
                "Indexing notes",
                move |connection| {
                    process_note_batch(
                        connection,
                        &job_provider,
                        ann,
                        batch.note_updates,
                        batch.deleted_notes,
                    )
                },
            )
        };

        if did_succeed {
            index_revision.fetch_add(1, Ordering::AcqRel);
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

fn process_full_scan(
    connection: &mut rusqlite::Connection,
    notes_dir: &Path,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: &Arc<AnnIndexState>,
    force: bool,
) -> Result<JobOutcome, String> {
    let stored = load_stored_note_records(connection)?;
    let mut seen_paths = HashSet::new();
    let mut scanned_count = 0usize;
    let mut embedded_count = 0usize;

    for entry in fs::read_dir(notes_dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !is_note_file(&path) {
            continue;
        }

        let raw_path = path.to_string_lossy().into_owned();
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

        let markdown = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        let next_content_hash = content_hash(&markdown);
        if !force
            && stored
                .get(&raw_path)
                .is_some_and(|note| note.content_hash == next_content_hash)
        {
            continue;
        }

        scanned_count += 1;
        embedded_count +=
            index_note_content(connection, provider, &path, &markdown, modified_millis)?
                .embedded_count;
    }

    for stale_path in stored
        .keys()
        .filter(|stored_path| !seen_paths.contains(*stored_path))
    {
        delete_note(connection, stale_path)?;
    }

    rebuild_edges(connection, 6, 0.42)?;
    if scanned_count > 0 || force || ann.needs_rebuild() {
        ann.rebuild_from_connection(connection)?;
    }
    Ok(JobOutcome {
        scanned_count,
        embedded_count,
    })
}

fn process_rebuild(
    connection: &mut rusqlite::Connection,
    notes_dir: &Path,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: &Arc<AnnIndexState>,
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
    process_full_scan(connection, notes_dir, provider, ann, true)
}

fn process_note_batch(
    connection: &mut rusqlite::Connection,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: &Arc<AnnIndexState>,
    note_updates: HashMap<PathBuf, PendingNoteUpdate>,
    deleted_notes: HashSet<PathBuf>,
) -> Result<JobOutcome, String> {
    let mut scanned_count = 0usize;
    let mut embedded_count = 0usize;
    let mut needs_ann_rebuild = ann.needs_rebuild();

    for note_path in deleted_notes {
        let previous_labels = load_note_chunk_labels(connection, &note_path.to_string_lossy())?;
        delete_note(connection, &note_path.to_string_lossy())?;
        if !ann.apply_note_delete(&previous_labels)? {
            needs_ann_rebuild = true;
        }
        scanned_count += 1;
    }

    for (note_path, update) in note_updates {
        let previous_labels = load_note_chunk_labels(connection, &note_path.to_string_lossy())?;
        let indexed_note = index_note_content(
            connection,
            provider,
            &note_path,
            &update.markdown,
            update.modified_millis,
        )?;
        embedded_count += indexed_note.embedded_count;
        if !ann.apply_note_upsert(
            &note_path,
            &previous_labels,
            &indexed_note.chunks,
            &indexed_note.embeddings,
        )? {
            needs_ann_rebuild = true;
        }
        scanned_count += 1;
    }

    if scanned_count > 0 {
        rebuild_edges(connection, 6, 0.42)?;
    }
    if needs_ann_rebuild {
        ann.rebuild_from_connection(connection)?;
    } else if scanned_count > 0 {
        ann.persist_current(connection)?;
    }

    Ok(JobOutcome {
        scanned_count,
        embedded_count,
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

struct JobOutcome {
    scanned_count: usize,
    embedded_count: usize,
}

struct IndexedNoteContent {
    embedded_count: usize,
    chunks: Vec<super::chunking::SemanticChunk>,
    embeddings: Vec<Vec<f32>>,
}
