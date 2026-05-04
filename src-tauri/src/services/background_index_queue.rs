//! Background queue for save-side indexing/projection work.
//!
//! Save (`NoteService::save`) is a hot path. The frontend wants the saved
//! `NoteSession` back as soon as the file is on disk so the UI can stop
//! showing a "saving" indicator and so that an immediately-following
//! `open_note` for a different note is not blocked behind lexical index
//! and SQLite task projection writes.
//!
//! This queue moves those two pieces of work onto a single dedicated worker
//! thread:
//!
//! * Lexical (`Arc<LexicalIndex>`) updates apply via `upsert_note` /
//!   `remove_note`.
//! * SQLite task projection updates apply via `task_projection::*`.
//!
//! The in-memory `notes_index` (search/recents/wikilinks) is still updated
//! synchronously on the save path because it is fast and is consulted by
//! the immediately-following render.
//!
//! Coalescing semantics:
//! * Updates are processed in submission order.
//! * For the same path, a later message supersedes any earlier message
//!   that is still queued. This prevents pile-up under rapid saves to the
//!   same note while still giving callers eventual consistency.

use crate::index::{ForegroundActivity, IndexedNote};
use crate::lexical::LexicalIndex;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

/// How long to back off when the foreground IPC path is in flight before
/// re-checking. Short enough that throughput recovers immediately when
/// the user stops interacting; long enough that the worker is not
/// spinning on the activity flag.
const FOREGROUND_BACKOFF: Duration = Duration::from_millis(25);

enum BackgroundJob {
    Upsert { path: PathBuf, note: IndexedNote },
    Remove { path: PathBuf },
    Shutdown,
}

#[derive(Default)]
struct QueueInner {
    /// FIFO of jobs waiting to be processed. We collapse repeated jobs for
    /// the same path on enqueue, so the deque holds at most one pending
    /// job per path.
    jobs: VecDeque<BackgroundJob>,
    /// path -> queue position so we can coalesce repeats for the same path
    /// without scanning the deque on every enqueue.
    pending_by_path: HashMap<PathBuf, usize>,
}

pub(crate) struct BackgroundIndexQueue {
    inner: Arc<(Mutex<QueueInner>, Condvar)>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

impl BackgroundIndexQueue {
    pub(crate) fn new(
        lexical: Arc<LexicalIndex>,
        foreground_activity: Arc<ForegroundActivity>,
    ) -> Self {
        let inner = Arc::new((Mutex::new(QueueInner::default()), Condvar::new()));
        let worker_inner = Arc::clone(&inner);
        let worker = thread::Builder::new()
            .name("notepad-bg-index".into())
            .spawn(move || run_worker(worker_inner, lexical, foreground_activity))
            .ok();

        Self {
            inner,
            worker: Mutex::new(worker),
        }
    }

    pub(crate) fn enqueue_upsert(&self, path: PathBuf, note: IndexedNote) {
        self.push(BackgroundJob::Upsert { path, note });
    }

    pub(crate) fn enqueue_remove(&self, path: PathBuf) {
        self.push(BackgroundJob::Remove { path });
    }

    fn push(&self, job: BackgroundJob) {
        let path = match &job {
            BackgroundJob::Upsert { path, .. } | BackgroundJob::Remove { path } => {
                Some(path.clone())
            }
            BackgroundJob::Shutdown => None,
        };
        let (lock, cvar) = &*self.inner;
        let mut state = lock.lock().expect("background index queue lock poisoned");
        if let Some(path) = path {
            // Coalesce: if there's already a job for this path, replace it
            // in place rather than queueing a duplicate.
            if let Some(&position) = state.pending_by_path.get(&path) {
                if let Some(slot) = state.jobs.get_mut(position) {
                    *slot = job;
                    cvar.notify_one();
                    return;
                }
            }
            let position = state.jobs.len();
            state.jobs.push_back(job);
            state.pending_by_path.insert(path, position);
        } else {
            state.jobs.push_back(job);
        }
        cvar.notify_one();
    }
}

fn run_worker(
    inner: Arc<(Mutex<QueueInner>, Condvar)>,
    lexical: Arc<LexicalIndex>,
    foreground_activity: Arc<ForegroundActivity>,
) {
    loop {
        // Cooperative back-off before each job: if a foreground IPC call
        // is currently in flight, sleep briefly and re-check. This keeps
        // the lexical writer mutex and the global SQLite state mutex
        // free for the foreground while we still drain the queue
        // promptly during idle periods. The check is per-job rather
        // than per-message in flight so the worker continues making
        // progress under sustained foreground activity (the user's
        // typing produces many guards but each is short-lived).
        while foreground_activity.is_busy() {
            thread::sleep(FOREGROUND_BACKOFF);
        }

        let job = {
            let (lock, cvar) = &*inner;
            let mut state = lock.lock().expect("background index queue lock poisoned");
            while state.jobs.is_empty() {
                state = cvar
                    .wait(state)
                    .expect("background index queue cvar wait failed");
            }
            let job = state.jobs.pop_front().expect("non-empty queue");
            // Drop the path -> position mapping. If callers race during the
            // pop, the worst case is an extra coalesced entry (which is
            // still correct).
            match &job {
                BackgroundJob::Upsert { path, .. } | BackgroundJob::Remove { path } => {
                    if state.pending_by_path.get(path) == Some(&0) {
                        state.pending_by_path.remove(path);
                    }
                    // Shift remaining positions down since we popped index 0.
                    for value in state.pending_by_path.values_mut() {
                        if *value > 0 {
                            *value -= 1;
                        }
                    }
                }
                BackgroundJob::Shutdown => {}
            }
            job
        };

        match job {
            BackgroundJob::Upsert { path, note } => {
                if let Err(error) = lexical.upsert_note(&path, &note) {
                    eprintln!("background lexical upsert failed for {path:?}: {error}");
                }
                let timestamp = if note.modified_millis == 0 {
                    crate::time::current_time_millis().unwrap_or(0)
                } else {
                    note.modified_millis
                };
                let note_id = note.note_id.clone();
                let _ = crate::state::task_projection::reconcile_note_tasks(
                    &path,
                    Some(&note),
                    &note_id,
                    timestamp,
                );
            }
            BackgroundJob::Remove { path } => {
                if let Err(error) = lexical.remove_note(&path) {
                    eprintln!("background lexical remove failed for {path:?}: {error}");
                }
                let timestamp = crate::time::current_time_millis().unwrap_or(0);
                let _ = crate::state::task_projection::delete_tasks_for_note_path(&path, timestamp);
            }
            BackgroundJob::Shutdown => return,
        }
    }
}

impl Drop for BackgroundIndexQueue {
    fn drop(&mut self) {
        self.push(BackgroundJob::Shutdown);
        if let Ok(mut handle) = self.worker.lock() {
            if let Some(join) = handle.take() {
                let _ = join.join();
            }
        }
    }
}
