use super::{
    ann::AnnIndexState,
    chunking::chunk_markdown,
    db::{
        content_hash, delete_note, ensure_schema, insert_job, load_existing_chunk_embeddings,
        load_note_chunk_labels, load_stored_note_records, move_note, open_database, rebuild_edges,
        update_job, upsert_note_chunks, EdgeRebuildStats,
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

#[derive(Clone)]
pub(crate) struct PendingNoteUpdate {
    pub(crate) markdown: String,
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
            let job_debug = debug.clone();
            run_job(
                db_path,
                runtime,
                debug,
                "Rebuilding semantic index",
                move |connection| {
                    process_rebuild(connection, &job_notes_dir, &job_provider, ann, &job_debug)
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
        } else {
            let job_provider = provider.clone();
            let job_debug = debug.clone();
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
                        batch.moved_notes,
                        &job_debug,
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
    let mut scanned_count = 0usize;
    let mut embedded_count = 0usize;
    let mut deleted_count = 0usize;

    for path in collect_markdown_files_recursively(notes_dir)? {
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
        deleted_count += 1;
    }

    let edge_started_at = Instant::now();
    let edge_stats = rebuild_edges(connection, EDGE_NEIGHBORS_PER_NOTE, EDGE_MIN_SCORE)?;
    record_edge_rebuild(
        debug,
        &edge_stats,
        edge_started_at.elapsed().as_millis() as u64,
    );
    if scanned_count > 0 || deleted_count > 0 || force || ann.needs_rebuild() {
        ann.rebuild_from_connection(connection)?;
    }
    debug.sample_rss("index", "full_scan_completed");
    Ok(JobOutcome {
        scanned_count: scanned_count + deleted_count,
        embedded_count,
    })
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
    process_full_scan(connection, notes_dir, provider, ann, true, debug)
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
        delete_note(connection, &path_str)?;
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
        let edge_started_at = Instant::now();
        let edge_stats = rebuild_edges(connection, EDGE_NEIGHBORS_PER_NOTE, EDGE_MIN_SCORE)?;
        record_edge_rebuild(
            debug,
            &edge_stats,
            edge_started_at.elapsed().as_millis() as u64,
        );
    }
    if needs_ann_rebuild {
        ann.rebuild_from_connection(connection)?;
    } else if scanned_count > 0 {
        ann.persist_current(connection)?;
    }
    if scanned_count > 0 {
        debug.sample_rss("index", "note_batch_completed");
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

#[cfg(test)]
mod tests {
    use super::process_full_scan;
    use crate::semantic::{
        ann::AnnIndexState,
        db::{ensure_schema, load_ann_index_signature, open_database},
        debug::SemanticDebugState,
        embed::{EmbeddingInputKind, EmbeddingProvider, ModelInfo},
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::Arc,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn full_scan_rebuilds_ann_when_notes_are_deleted_outside_the_app() {
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
