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

    pub(crate) fn report_activity(&self) {
        // Rebuilds run immediately; activity reporting is retained for callers
        // that still notify the gate around interactive work.
    }

    pub(crate) fn begin_foreground(&self) {}

    pub(crate) fn end_foreground(&self) {}

    pub(crate) fn set_manually_paused(&self, paused: bool) {
        if let Ok(mut state) = self.state.lock() {
            state.manually_paused = paused;
            self.changed.notify_all();
        }
    }

    /// Expensive jobs still obey an explicit pause without waiting for idle.
    pub(crate) fn checkpoint_manual_pause(&self) {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        while state.manually_paused {
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
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        thread,
        time::Duration,
    };

    #[test]
    fn checkpoint_waits_only_while_manually_paused() {
        let gate = Arc::new(BackgroundWorkGate::new());
        gate.set_manually_paused(true);
        let started = Arc::new(AtomicBool::new(false));
        let worker_gate = gate.clone();
        let worker_started = started.clone();
        let worker = thread::spawn(move || {
            worker_gate.checkpoint_manual_pause();
            worker_started.store(true, Ordering::Release);
        });
        thread::sleep(Duration::from_millis(40));
        assert!(!started.load(Ordering::Acquire));
        gate.set_manually_paused(false);
        worker.join().expect("pause worker");
        assert!(started.load(Ordering::Acquire));
    }

    #[test]
    fn checkpoint_returns_immediately_when_not_paused() {
        let gate = BackgroundWorkGate::new();
        gate.checkpoint_manual_pause();
    }
}
