//! Background queue for save-side indexing/projection work.
//!
//! Note save is a hot path. The frontend wants the saved `NoteSession` back
//! as soon as the file is on disk so the UI can stop showing a "saving"
//! indicator and so that an immediately-following `open_note` for a
//! different note is not blocked behind lexical index and SQLite task
//! projection writes.
//!
//! This queue moves whichever derived projections the catalog policy marks as
//! deferred onto a single dedicated worker thread:
//!
//! * Lexical and task updates enter the shared per-path, generation-ordered
//!   catalog projection coordinator, so late background work cannot regress a
//!   newer synchronous reconciliation.
//! * SQLite task projection updates remain deferred for prewarm. Ordinary
//!   saves currently reconcile tasks synchronously, so their queued job only
//!   carries lexical work; startup prewarm defers both.
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

use super::note_catalog::{
    CatalogMutation, CatalogProjectionRetries, DeferredCatalogProjection, ProjectionWork,
};
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
    Apply(Box<DeferredCatalogProjection>),
    Shutdown,
}

#[derive(Default)]
struct QueueInner {
    #[cfg(test)]
    waiting_for_job: bool,
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
        projection_retries: Arc<CatalogProjectionRetries>,
    ) -> Self {
        let inner = Arc::new((Mutex::new(QueueInner::default()), Condvar::new()));
        let worker_inner = Arc::clone(&inner);
        let worker = thread::Builder::new()
            .name("notepad-bg-index".into())
            .spawn(move || {
                run_worker(
                    worker_inner,
                    lexical,
                    foreground_activity,
                    projection_retries,
                )
            })
            .ok();

        Self {
            inner,
            worker: Mutex::new(worker),
        }
    }

    #[cfg(test)]
    pub(crate) fn wait_until_idle_for_test(&self) {
        let (lock, wake) = &*self.inner;
        let state = lock.lock().expect("queue state");
        let (state, _) = wake
            .wait_timeout_while(state, Duration::from_secs(5), |state| {
                !state.waiting_for_job
            })
            .expect("queue idle notification");
        assert!(state.waiting_for_job, "worker did not reach its idle wait");
    }

    pub(crate) fn enqueue_upsert(&self, path: PathBuf, note: IndexedNote, generation: u64) {
        self.enqueue(DeferredCatalogProjection::all(
            generation,
            CatalogMutation::Upsert {
                path,
                note: Box::new(note),
            },
        ));
    }

    pub(crate) fn enqueue(&self, projection: DeferredCatalogProjection) {
        self.push(BackgroundJob::Apply(Box::new(projection)));
    }

    fn push(&self, job: BackgroundJob) {
        let path = match &job {
            BackgroundJob::Apply(projection) => Some(projection.path().to_path_buf()),
            BackgroundJob::Shutdown => None,
        };
        let (lock, cvar) = &*self.inner;
        let mut state = lock.lock().expect("background index queue lock poisoned");
        if let Some(path) = path {
            // Coalesce: if there's already a job for this path, replace it
            // in place rather than queueing a duplicate.
            if let Some(&position) = state.pending_by_path.get(&path) {
                if let Some(slot) = state.jobs.get_mut(position) {
                    let is_older = matches!(
                        (&*slot, &job),
                        (BackgroundJob::Apply(existing), BackgroundJob::Apply(incoming))
                            if incoming.generation < existing.generation
                    );
                    if is_older {
                        return;
                    }
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
    projection_retries: Arc<CatalogProjectionRetries>,
) {
    loop {
        let job = {
            let (lock, cvar) = &*inner;
            let mut state = lock.lock().expect("background index queue lock poisoned");
            while state.jobs.is_empty() {
                #[cfg(test)]
                {
                    state.waiting_for_job = true;
                    cvar.notify_all();
                }
                state = cvar
                    .wait(state)
                    .expect("background index queue cvar wait failed");
            }
            #[cfg(test)]
            {
                state.waiting_for_job = false;
            }
            // Recheck after waking for work. Foreground activity may have
            // started while this worker was idle. Keep the job queued so
            // repeated updates still coalesce during the foreground pause.
            // Shutdown itself needs no projection work and must not back off.
            if matches!(state.jobs.front(), Some(BackgroundJob::Apply(_)))
                && foreground_activity.is_busy()
            {
                drop(state);
                thread::sleep(FOREGROUND_BACKOFF);
                continue;
            }
            let job = state.jobs.pop_front().expect("non-empty queue");
            // Drop the path -> position mapping. If callers race during the
            // pop, the worst case is an extra coalesced entry (which is
            // still correct).
            match &job {
                BackgroundJob::Apply(projection) => {
                    let path = projection.path();
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
            BackgroundJob::Apply(projection) => {
                if let Err(error) = projection_retries.apply(
                    &lexical,
                    projection.generation,
                    &projection.mutation,
                    ProjectionWork::background(
                        projection.target_tasks,
                        projection.lexical,
                        projection.tasks,
                    ),
                ) {
                    eprintln!(
                        "background catalog projection failed for {:?}: {error}",
                        projection.path()
                    );
                }
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
