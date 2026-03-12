use super::{
    chunking::chunk_markdown,
    db::{
        content_hash, delete_note, ensure_schema, insert_job, load_existing_chunk_embeddings,
        load_stored_note_records, open_database, rebuild_edges, update_job, upsert_note_chunks,
    },
    embed::EmbeddingProvider,
    current_time_millis, RuntimeState,
};
use crate::{index::is_note_file, state::derive_file_stem};
use std::{
    collections::{HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{mpsc::Receiver, Arc, Mutex},
    thread,
    time::UNIX_EPOCH,
};

pub(crate) enum IndexWork {
    FullScan { force: bool },
    UpsertNote {
        note_path: PathBuf,
        markdown: String,
        modified_millis: u64,
    },
    DeleteNote {
        note_path: PathBuf,
    },
    Rebuild,
    SetPaused {
        paused: bool,
    },
}

pub(crate) fn spawn_indexing_worker(
    db_path: PathBuf,
    notes_dir: PathBuf,
    provider: Arc<dyn EmbeddingProvider + Send + Sync>,
    work_rx: Receiver<IndexWork>,
    runtime: &Arc<Mutex<RuntimeState>>,
) -> Result<(), String> {
    let runtime = Arc::clone(runtime);
    thread::Builder::new()
        .name("semantic-indexer".to_string())
        .spawn(move || {
            run_worker(db_path, notes_dir, provider, work_rx, runtime);
        })
        .map(|_| ())
        .map_err(|err| err.to_string())
}

fn run_worker(
    db_path: PathBuf,
    notes_dir: PathBuf,
    provider: Arc<dyn EmbeddingProvider + Send + Sync>,
    work_rx: Receiver<IndexWork>,
    runtime: Arc<Mutex<RuntimeState>>,
) {
    let mut paused = false;
    let mut backlog = VecDeque::new();

    loop {
        let work = if paused {
            match work_rx.recv() {
                Ok(IndexWork::SetPaused { paused: false }) => {
                    paused = false;
                    update_runtime(&runtime, |state| {
                        state.indexing_paused = false;
                    });
                    continue;
                }
                Ok(work) => {
                    backlog.push_back(work);
                    continue;
                }
                Err(_) => return,
            }
        } else if let Some(work) = backlog.pop_front() {
            work
        } else {
            match work_rx.recv() {
                Ok(work) => work,
                Err(_) => return,
            }
        };

        match work {
            IndexWork::SetPaused { paused: next_paused } => {
                paused = next_paused;
                update_runtime(&runtime, |state| {
                    state.indexing_paused = next_paused;
                });
            }
            IndexWork::FullScan { force } => {
                let job_notes_dir = notes_dir.clone();
                let job_provider = provider.clone();
                run_job(
                    &db_path,
                    &runtime,
                    "Scanning notes",
                    move |connection| process_full_scan(connection, &job_notes_dir, &job_provider, force),
                );
            }
            IndexWork::UpsertNote {
                note_path,
                markdown,
                modified_millis,
            } => {
                let job_provider = provider.clone();
                run_job(
                    &db_path,
                    &runtime,
                    "Indexing note",
                    move |connection| {
                        let embedded_count = index_note_content(
                            connection,
                            &job_provider,
                            &note_path,
                            &markdown,
                            modified_millis,
                        )?;
                        rebuild_edges(connection, 6, 0.24)?;
                        Ok(JobOutcome {
                            scanned_count: 1,
                            embedded_count,
                        })
                    },
                );
            }
            IndexWork::DeleteNote { note_path } => {
                run_job(
                    &db_path,
                    &runtime,
                    "Removing note from semantic index",
                    move |connection| {
                        delete_note(connection, &note_path.to_string_lossy())?;
                        rebuild_edges(connection, 6, 0.24)?;
                        Ok(JobOutcome {
                            scanned_count: 1,
                            embedded_count: 0,
                        })
                    },
                );
            }
            IndexWork::Rebuild => {
                let job_notes_dir = notes_dir.clone();
                let job_provider = provider.clone();
                run_job(
                    &db_path,
                    &runtime,
                    "Rebuilding semantic index",
                    move |connection| process_rebuild(connection, &job_notes_dir, &job_provider),
                );
            }
        }
    }
}

fn run_job<F>(
    db_path: &Path,
    runtime: &Arc<Mutex<RuntimeState>>,
    label: &str,
    job: F,
) where
    F: FnOnce(&mut rusqlite::Connection) -> Result<JobOutcome, String>,
{
    update_runtime(runtime, |state| {
        state.indexing_in_progress = true;
        state.current_job_label = Some(label.to_string());
        state.last_error = None;
    });

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
            }
            Err(error) => {
                update_job(&connection, job_id, "failed", 0, 0, Some(&error))?;
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
        }
        Err(error) => {
            update_runtime(runtime, |state| {
                state.indexing_in_progress = false;
                state.current_job_label = None;
                state.last_error = Some(error);
            });
        }
    }
}

fn process_full_scan(
    connection: &mut rusqlite::Connection,
    notes_dir: &Path,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
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
        embedded_count += index_note_content(connection, provider, &path, &markdown, modified_millis)?;
    }

    for stale_path in stored.keys().filter(|stored_path| !seen_paths.contains(*stored_path)) {
        delete_note(connection, stale_path)?;
    }

    rebuild_edges(connection, 6, 0.24)?;
    Ok(JobOutcome {
        scanned_count,
        embedded_count,
    })
}

fn process_rebuild(
    connection: &mut rusqlite::Connection,
    notes_dir: &Path,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
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
    process_full_scan(connection, notes_dir, provider, true)
}

fn index_note_content(
    connection: &mut rusqlite::Connection,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    note_path: &Path,
    markdown: &str,
    modified_millis: u64,
) -> Result<usize, String> {
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

    let new_embeddings = provider.embed_texts(&texts_to_embed)?;
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

    Ok(texts_to_embed.len())
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
