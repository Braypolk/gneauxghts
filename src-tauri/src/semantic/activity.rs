use std::{
    sync::{Condvar, Mutex},
    time::{Duration, Instant},
};

pub(crate) const AUTOMATIC_WORK_IDLE_DELAY: Duration = Duration::from_secs(15);

struct ActivityState {
    last_activity: Instant,
    manually_paused: bool,
    foreground_in_flight: usize,
}

/// Shared cooperative gate for expensive derived work. Foreground activity
/// never cancels a rebuild; it pauses at the next checkpoint and resumes after
/// another quiet window, preserving already-completed work in memory.
pub(crate) struct BackgroundWorkGate {
    state: Mutex<ActivityState>,
    changed: Condvar,
    idle_delay: Duration,
}

impl BackgroundWorkGate {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(ActivityState {
                last_activity: Instant::now(),
                manually_paused: false,
                foreground_in_flight: 0,
            }),
            changed: Condvar::new(),
            idle_delay: AUTOMATIC_WORK_IDLE_DELAY,
        }
    }

    pub(crate) fn report_activity(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.last_activity = Instant::now();
            self.changed.notify_all();
        }
    }

    pub(crate) fn begin_foreground(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.foreground_in_flight = state.foreground_in_flight.saturating_add(1);
            state.last_activity = Instant::now();
            self.changed.notify_all();
        }
    }

    pub(crate) fn end_foreground(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.foreground_in_flight = state.foreground_in_flight.saturating_sub(1);
            state.last_activity = Instant::now();
            self.changed.notify_all();
        }
    }

    pub(crate) fn set_manually_paused(&self, paused: bool) {
        if let Ok(mut state) = self.state.lock() {
            state.manually_paused = paused;
            self.changed.notify_all();
        }
    }

    pub(crate) fn wait_for_automatic_idle(&self) {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        loop {
            let quiet_for = state.last_activity.elapsed();
            if !state.manually_paused
                && state.foreground_in_flight == 0
                && quiet_for >= self.idle_delay
            {
                return;
            }
            let timeout = if state.manually_paused || state.foreground_in_flight > 0 {
                Duration::from_secs(1)
            } else {
                self.idle_delay
                    .saturating_sub(quiet_for)
                    .max(Duration::from_millis(50))
            };
            let Ok((next, _)) = self.changed.wait_timeout(state, timeout) else {
                return;
            };
            state = next;
        }
    }

    /// Manual jobs skip the initial idle delay but still obey explicit pause.
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
    fn automatic_work_waits_for_a_complete_quiet_window() {
        let gate = Arc::new(BackgroundWorkGate {
            state: std::sync::Mutex::new(super::ActivityState {
                last_activity: std::time::Instant::now(),
                manually_paused: false,
                foreground_in_flight: 0,
            }),
            changed: std::sync::Condvar::new(),
            idle_delay: Duration::from_millis(80),
        });
        let started = Arc::new(AtomicBool::new(false));
        let worker_gate = gate.clone();
        let worker_started = started.clone();
        let worker = thread::spawn(move || {
            worker_gate.wait_for_automatic_idle();
            worker_started.store(true, Ordering::Release);
        });
        thread::sleep(Duration::from_millis(45));
        assert!(!started.load(Ordering::Acquire));
        gate.report_activity();
        thread::sleep(Duration::from_millis(50));
        assert!(!started.load(Ordering::Acquire));
        worker.join().expect("idle worker");
        assert!(started.load(Ordering::Acquire));
    }

    #[test]
    fn foreground_ipc_blocks_idle_work_until_it_finishes() {
        let gate = Arc::new(BackgroundWorkGate {
            state: std::sync::Mutex::new(super::ActivityState {
                last_activity: std::time::Instant::now(),
                manually_paused: false,
                foreground_in_flight: 0,
            }),
            changed: std::sync::Condvar::new(),
            idle_delay: Duration::from_millis(60),
        });
        gate.begin_foreground();
        let started = Arc::new(AtomicBool::new(false));
        let worker_gate = gate.clone();
        let worker_started = started.clone();
        let worker = thread::spawn(move || {
            worker_gate.wait_for_automatic_idle();
            worker_started.store(true, Ordering::Release);
        });
        thread::sleep(Duration::from_millis(90));
        assert!(!started.load(Ordering::Acquire));
        gate.end_foreground();
        worker.join().expect("foreground-gated worker");
        assert!(started.load(Ordering::Acquire));
    }
}
