use std::sync::{Condvar, Mutex};

struct ActivityState {
    manually_paused: bool,
}

/// Shared cooperative gate for expensive derived work. Foreground activity no
/// longer delays rebuilds; only an explicit manual pause holds checkpoints.
pub(crate) struct BackgroundWorkGate {
    state: Mutex<ActivityState>,
    changed: Condvar,
}

impl BackgroundWorkGate {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(ActivityState {
                manually_paused: false,
            }),
            changed: Condvar::new(),
        }
    }

    pub(crate) fn set_manually_paused(&self, paused: bool) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Semantic background work gate lock poisoned".to_string())?;
        state.manually_paused = paused;
        self.changed.notify_all();
        Ok(())
    }

    pub(crate) fn is_manually_paused(&self) -> Result<bool, String> {
        self.state
            .lock()
            .map(|state| state.manually_paused)
            .map_err(|_| "Semantic background work gate lock poisoned".to_string())
    }

    /// Expensive jobs still obey an explicit pause without waiting for idle.
    pub(crate) fn checkpoint_manual_pause(&self) {
        self.checkpoint_observing_wait(|| {});
    }

    fn checkpoint_observing_wait(&self, mut on_wait: impl FnMut()) {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        while state.manually_paused {
            on_wait();
            let Ok(next) = self.changed.wait(state) else {
                return;
            };
            state = next;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::BackgroundWorkGate;
    use std::{
        panic::{catch_unwind, AssertUnwindSafe},
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc,
        },
        thread,
        time::Duration,
    };

    #[test]
    fn pause_during_long_work_holds_the_next_checkpoint() {
        let gate = Arc::new(BackgroundWorkGate::new());
        let finished = Arc::new(AtomicBool::new(false));
        let (first_checkpoint_tx, first_checkpoint_rx) = mpsc::channel();
        let (continue_tx, continue_rx) = mpsc::channel();
        let worker_gate = gate.clone();
        let worker_finished = finished.clone();
        let (waiting_tx, waiting_rx) = mpsc::channel();
        struct ResumeOnDrop<'a>(&'a BackgroundWorkGate);
        impl Drop for ResumeOnDrop<'_> {
            fn drop(&mut self) {
                let _ = self.0.set_manually_paused(false);
            }
        }
        thread::scope(|scope| {
            let worker = scope.spawn(move || {
                worker_gate.checkpoint_manual_pause();
                first_checkpoint_tx
                    .send(())
                    .expect("report first checkpoint");
                continue_rx
                    .recv_timeout(Duration::from_secs(2))
                    .expect("continue long work");
                worker_gate.checkpoint_observing_wait(|| {
                    let _ = waiting_tx.send(());
                });
                worker_finished.store(true, Ordering::Release);
            });
            let _resume = ResumeOnDrop(&gate);
            first_checkpoint_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("first checkpoint");
            gate.set_manually_paused(true).expect("pause gate");
            continue_tx.send(()).expect("continue to paused checkpoint");
            waiting_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("worker observed paused checkpoint");
            assert!(!finished.load(Ordering::Acquire));
            gate.set_manually_paused(false).expect("resume gate");
            worker.join().expect("pause worker");
        });
        assert!(finished.load(Ordering::Acquire));
    }

    #[test]
    fn failed_pause_mutation_is_reported() {
        let gate = BackgroundWorkGate::new();
        let _ = catch_unwind(AssertUnwindSafe(|| {
            let _state = gate.state.lock().expect("lock gate");
            panic!("poison gate");
        }));

        assert!(gate.set_manually_paused(true).is_err());
        assert!(gate.is_manually_paused().is_err());
    }
}
