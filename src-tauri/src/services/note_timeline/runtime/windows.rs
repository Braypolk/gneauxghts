//! Process-local continuous deadlines. No elapsed origin survives a restart.
use super::*;
use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

#[derive(Clone, Copy, Debug)]
pub(in super::super) struct ClockSample {
    pub continuous_millis: u64,
    pub wall_millis: u64,
}
pub(in super::super) trait WindowClock: Send + Sync {
    fn sample(&self) -> Result<ClockSample, String>;
}
#[cfg(feature = "e2e-wdio")]
static E2E_CLOCK_OFFSET: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
struct SystemClock;
impl WindowClock for SystemClock {
    fn sample(&self) -> Result<ClockSample, String> {
        #[cfg(feature = "e2e-wdio")]
        let offset = E2E_CLOCK_OFFSET.load(Ordering::Acquire);
        #[cfg(not(feature = "e2e-wdio"))]
        let offset = 0;
        Ok(ClockSample {
            continuous_millis: continuous_millis()?.saturating_add(offset),
            wall_millis: crate::time::current_time_millis()?.saturating_add(offset),
        })
    }
}
// These OS clocks explicitly include suspension. Instant's platform-dependent
// sleep semantics and wall time are not deadline clocks.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn continuous_millis() -> Result<u64, String> {
    #[repr(C)]
    struct Timebase {
        numer: u32,
        denom: u32,
    }
    unsafe extern "C" {
        fn mach_continuous_time() -> u64;
        fn mach_timebase_info(info: *mut Timebase) -> i32;
    }
    let mut info = Timebase { numer: 0, denom: 0 };
    unsafe {
        if mach_timebase_info(&mut info) != 0 || info.denom == 0 {
            return Err("Continuous clock unavailable".into());
        }
        Ok((u128::from(mach_continuous_time()) * u128::from(info.numer)
            / u128::from(info.denom)
            / 1_000_000) as u64)
    }
}
#[cfg(target_os = "linux")]
fn continuous_millis() -> Result<u64, String> {
    #[repr(C)]
    struct Timespec {
        seconds: std::ffi::c_long,
        nanos: std::ffi::c_long,
    }
    unsafe extern "C" {
        fn clock_gettime(clock: i32, time: *mut Timespec) -> i32;
    }
    let mut time = Timespec {
        seconds: 0,
        nanos: 0,
    };
    if unsafe {
        clock_gettime(7 /* CLOCK_BOOTTIME */, &mut time)
    } != 0
    {
        return Err("Continuous clock unavailable".into());
    }
    Ok(time.seconds as u64 * 1000 + time.nanos as u64 / 1_000_000)
}
#[cfg(windows)]
fn continuous_millis() -> Result<u64, String> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetTickCount64() -> u64;
    }
    Ok(unsafe { GetTickCount64() })
}
#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "linux", windows)))]
fn continuous_millis() -> Result<u64, String> {
    Err("Continuous clock unsupported".into())
}

#[derive(Clone)]
struct Origin {
    sample: ClockSample,
    window: Option<(String, u64)>,
}
pub(super) struct Windows {
    clock: Mutex<Arc<dyn WindowClock>>,
    origins: Mutex<HashMap<String, Origin>>,
    stop: Mutex<bool>,
    wake: Condvar,
    started: AtomicBool,
}
impl Default for Windows {
    fn default() -> Self {
        Self {
            clock: Mutex::new(Arc::new(SystemClock)),
            origins: Mutex::new(HashMap::new()),
            stop: Mutex::new(false),
            wake: Condvar::new(),
            started: AtomicBool::new(false),
        }
    }
}
impl Windows {
    pub(super) fn admission(
        &self,
        note: &NoteIdentity,
        pending: Option<&history_store::PendingWindow>,
    ) -> Result<history_store::WindowAdmission, String> {
        let sample = self
            .clock
            .lock()
            .map_err(|_| "Window clock lock poisoned")?
            .sample()?;
        let mut origins = self
            .origins
            .lock()
            .map_err(|_| "Window origin lock poisoned")?;
        let (elapsed, discontinuity) = if let Some(pending) = pending {
            let origin = origins
                .get_mut(note.as_str())
                .ok_or("Surviving Editing Window requires startup recovery")?;
            let identity = (pending.window_id.clone(), pending.generation);
            if origin
                .window
                .as_ref()
                .is_some_and(|value| *value != identity)
            {
                return Err("Stale Editing Window clock origin".into());
            }
            origin.window = Some(identity);
            let elapsed = sample
                .continuous_millis
                .checked_sub(origin.sample.continuous_millis)
                .ok_or("Continuous clock regressed")?;
            let offset_change = (i128::from(sample.wall_millis)
                - i128::from(origin.sample.wall_millis)
                - i128::from(elapsed))
            .abs();
            (elapsed, offset_change > 2)
        } else {
            origins.insert(
                note.as_str().into(),
                Origin {
                    sample,
                    window: None,
                },
            );
            self.wake.notify_all();
            (0, false)
        };
        Ok(history_store::WindowAdmission {
            window_id: pending.map(|w| w.window_id.clone()),
            elapsed_millis: elapsed,
            wall_millis: sample.wall_millis,
            clock_discontinuity: discontinuity,
        })
    }
    pub(super) fn forget(&self, note: &NoteIdentity) {
        if let Ok(mut origins) = self.origins.lock() {
            origins.remove(note.as_str());
        }
    }
    pub(super) fn reset(&self) {
        if let Ok(mut origins) = self.origins.lock() {
            origins.clear();
        }
    }
    pub(super) fn stop(&self) {
        if let Ok(mut stop) = self.stop.lock() {
            *stop = true;
            self.wake.notify_all();
        }
    }
    fn next_wait(&self) -> Duration {
        let Ok(origins) = self.origins.lock() else {
            return Duration::from_secs(1);
        };
        let Ok(clock) = self.clock.lock() else {
            return Duration::from_secs(1);
        };
        let Ok(sample) = clock.sample() else {
            return Duration::from_secs(1);
        };
        let remaining = origins
            .values()
            .map(|origin| {
                origin
                    .sample
                    .continuous_millis
                    .saturating_add(super::super::editing_window_policy::WINDOW_MILLIS)
                    .saturating_sub(sample.continuous_millis)
            })
            .min()
            .unwrap_or(1000);
        // Rearm at the nearest deadline. A bounded wake also checks resume and
        // retries failures without relying on a sleep-pausing timer for admission.
        Duration::from_millis(if remaining == 0 {
            100
        } else {
            remaining.min(1000)
        })
    }
    fn has_due(&self) -> Result<bool, String> {
        let origins = self
            .origins
            .lock()
            .map_err(|_| "Window origin lock poisoned")?;
        if origins.is_empty() {
            return Ok(false);
        }
        let now = self
            .clock
            .lock()
            .map_err(|_| "Window clock lock poisoned")?
            .sample()?
            .continuous_millis;
        Ok(origins.values().any(|origin| {
            now.saturating_sub(origin.sample.continuous_millis)
                >= super::super::editing_window_policy::WINDOW_MILLIS
        }))
    }
    fn tick(
        &self,
        store: &history_store::Store,
        ensure_ready: impl Fn(&NoteIdentity) -> Result<(), HistoryError>,
        begin_mutation: impl FnOnce() -> Result<CurrentContentMutationGuard, HistoryError>,
    ) -> Result<(), HistoryError> {
        if !self.has_due()? {
            return Ok(());
        }
        let pending = history_store::pending_windows(store)?;
        self.origins
            .lock()
            .map_err(|_| "Window origin lock poisoned")?
            .retain(|note, _| pending.iter().any(|window| window.note_id == *note));
        let mut due = Vec::new();
        let mut errors = Vec::new();
        for window in pending {
            let note = NoteIdentity::new(&window.note_id);
            if !self
                .origins
                .lock()
                .map_err(|_| "Window origin lock poisoned")?
                .contains_key(note.as_str())
            {
                continue;
            }
            match self.admission(&note, Some(&window)) {
                Ok(admission)
                    if admission.elapsed_millis
                        >= super::super::editing_window_policy::WINDOW_MILLIS =>
                {
                    due.push((note, window, admission.clock_discontinuity))
                }
                Err(error) => errors.push(HistoryError::from(error)),
                _ => {}
            }
        }
        if !due.is_empty() {
            let _mutation = begin_mutation()?;
            for (note, window, discontinuity) in due {
                let result = ensure_ready(&note)
                    .and_then(|_| {
                        history_store::mark_window_clock_discontinuity(
                            store,
                            &note,
                            &window.window_id,
                            window.generation,
                            discontinuity,
                        )
                    })
                    .and_then(|_| {
                        history_store::seal_pending_window(
                            store,
                            &note,
                            &window.window_id,
                            window.generation,
                        )
                    });
                match result {
                    Ok(_) => self.forget(&note),
                    Err(error) => errors.push(error),
                }
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            let corrupt = errors
                .iter()
                .any(|error| matches!(error, HistoryError::Corrupt(_)));
            let causes = errors
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; ");
            Err(if corrupt {
                HistoryError::Corrupt(causes)
            } else {
                HistoryError::Unavailable(causes)
            })
        }
    }
}

impl NoteTimelineRuntime {
    #[cfg(feature = "e2e-wdio")]
    pub(in super::super) fn advance_window_clock_for_e2e(&self, millis: u64) {
        E2E_CLOCK_OFFSET.fetch_add(millis, Ordering::AcqRel);
        self.windows.wake.notify_all();
    }
    #[cfg(test)]
    pub(in super::super) fn set_window_clock(&self, clock: Arc<dyn WindowClock>) {
        *self.window_admission_provider.lock().unwrap() = None;
        *self.windows.clock.lock().unwrap() = clock;
    }
    /// Same callback in native tests and the worker; lock order matches writers.
    pub(in super::super) fn poll_window_deadlines(&self) -> Result<(), HistoryError> {
        if !self.windows.has_due()? {
            return Ok(());
        }
        Ok(crate::state::with_note_file_mutation(|| {
            if *self
                .windows
                .stop
                .lock()
                .map_err(|_| "Window scheduler lock poisoned")?
            {
                return Ok(());
            }
            let _operation = self.begin_operation()?;
            self.with_observation_replay(|| {
                if !*self.lock_history_recovery()? {
                    return Ok(());
                }
                // The observation owner excludes concurrent replay. A retained
                // external snapshot follows this durable successful endpoint,
                // so sealing it cannot replace or reorder the observed bytes.
                self.ensure_history_recovered(|| Ok(()))?;
                self.windows.tick(
                    &self.store,
                    |note| self.ensure_note_ready(note),
                    || self.begin_current_content_mutation(),
                )
            })
        })?)
    }
    #[cfg(test)]
    pub(in super::super) fn scheduler_lifetime_probe(&self) -> impl Fn() -> bool {
        let weak = Arc::downgrade(&self.windows);
        move || weak.upgrade().is_some()
    }
    pub(in super::super) fn start_window_scheduler(&self) {
        if self.windows.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let worker = self.worker_clone();
        // Holds only runtime coordination, never AppState, a vault projection,
        // or an application handle. The owning runtime signals shutdown on drop.
        std::thread::Builder::new()
            .name("note-window-deadlines".into())
            .spawn(move || loop {
                let stop = worker.windows.stop.lock().unwrap();
                if *stop {
                    break;
                }
                let (stop, _) = worker
                    .windows
                    .wake
                    .wait_timeout(stop, worker.windows.next_wait())
                    .unwrap();
                if *stop {
                    break;
                }
                drop(stop);
                if let Err(error) = worker.poll_window_deadlines() {
                    eprintln!("Editing Window deadline remains retryable: {error}");
                }
            })
            .expect("start Editing Window scheduler");
    }
}
