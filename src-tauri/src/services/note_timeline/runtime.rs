mod verification;
mod windows;
use super::{history_store, HistoryError, NoteIdentity};
use crate::index::NoteTimelineOwnerToken;
use std::{
    fmt,
    sync::{Arc, Condvar, Mutex, MutexGuard},
};
#[cfg(test)]
pub(super) use windows::{ClockSample, WindowClock};

#[derive(Default)]
struct OperationState {
    active: usize,
    closing: bool,
    closed: bool,
    close_result: Option<Result<(), HistoryError>>,
    #[cfg(test)]
    close_joiners: usize,
}

#[derive(Default)]
struct NoteTimelineOperationBarrier {
    state: Mutex<OperationState>,
    settled: Condvar,
}

#[derive(Default)]
struct CurrentContentState {
    generation: u64,
    active_mutations: usize,
}

#[derive(Default)]
struct CurrentContentCoordinator {
    state: Mutex<CurrentContentState>,
}

#[derive(Clone, Copy)]
pub(super) struct CurrentContentVersion {
    generation: u64,
}

pub(super) struct CurrentContentMutationGuard {
    coordinator: Arc<CurrentContentCoordinator>,
}

#[derive(Clone)]
pub(super) struct OperationGuard {
    _lease: Arc<OperationLease>,
}

struct OperationLease {
    barrier: Arc<NoteTimelineOperationBarrier>,
}

impl fmt::Debug for OperationGuard {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("OperationGuard")
    }
}

impl Drop for OperationLease {
    fn drop(&mut self) {
        if let Ok(mut state) = self.barrier.state.lock() {
            state.active = state.active.saturating_sub(1);
            if state.active == 0 {
                self.barrier.settled.notify_all();
            }
        }
    }
}

impl Drop for CurrentContentMutationGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = self.coordinator.state.lock() {
            state.active_mutations = state.active_mutations.saturating_sub(1);
            state.generation = state.generation.wrapping_add(1);
        }
    }
}

/// Owns every process-local coordination primitive for one vault's Note
/// Timeline. Callers can hold a `NoteTimeline` handle, but cannot assemble or
/// transition the runtime piecemeal.
pub(crate) struct NoteTimelineRuntime {
    pub(super) store: Arc<history_store::Store>,
    windows: Arc<windows::Windows>,
    worker: bool,
    verification: Arc<verification::Verification>,
    current_content: Arc<CurrentContentCoordinator>,
    history_recovered: Arc<Mutex<bool>>,
    recovery_unavailable: Arc<std::sync::atomic::AtomicBool>,
    released_capture_pending: Arc<Mutex<bool>>,
    observation_replay: Arc<Mutex<()>>,
    operations: Arc<NoteTimelineOperationBarrier>,
    #[cfg(test)]
    window_admission_provider: Mutex<Option<WindowAdmissionProvider>>,
}

#[cfg(test)]
type WindowAdmissionProvider = Arc<
    dyn Fn(
            Option<&history_store::PendingWindow>,
        ) -> Result<history_store::WindowAdmission, HistoryError>
        + Send
        + Sync,
>;

impl NoteTimelineRuntime {
    pub(crate) fn new(
        _owner: NoteTimelineOwnerToken,
        vault_root: std::path::PathBuf,
        app_data_dir: std::path::PathBuf,
    ) -> Result<Self, HistoryError> {
        Ok(Self {
            store: Arc::new(history_store::Store::new(vault_root, app_data_dir)?),
            windows: Arc::new(windows::Windows::default()),
            worker: false,
            verification: Arc::new(verification::Verification::default()),
            current_content: Arc::new(CurrentContentCoordinator::default()),
            history_recovered: Arc::new(Mutex::new(false)),
            recovery_unavailable: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            released_capture_pending: Arc::new(Mutex::new(false)),
            observation_replay: Arc::new(Mutex::new(())),
            operations: Arc::new(NoteTimelineOperationBarrier::default()),
            #[cfg(test)]
            window_admission_provider: Mutex::new(None),
        })
    }

    // Production admission uses the continuous deadline; tests can inject time.
    pub(super) fn editing_window_admission(
        &self,
        note: &NoteIdentity,
        _pending: Option<&history_store::PendingWindow>,
    ) -> Result<history_store::WindowAdmission, HistoryError> {
        #[cfg(test)]
        if let Some(provider) = self
            .window_admission_provider
            .lock()
            .map_err(|_| "Editing Window admission lock poisoned")?
            .clone()
        {
            return provider(_pending);
        }
        Ok(self.windows.admission(note, _pending)?)
    }

    pub(super) fn forget_window_clock(&self, note: &NoteIdentity) {
        self.windows.forget(note);
    }

    fn worker_clone(&self) -> Self {
        Self {
            store: Arc::clone(&self.store),
            windows: Arc::clone(&self.windows),
            worker: true,
            verification: Arc::clone(&self.verification),
            current_content: Arc::clone(&self.current_content),
            history_recovered: Arc::clone(&self.history_recovered),
            recovery_unavailable: Arc::clone(&self.recovery_unavailable),
            released_capture_pending: Arc::clone(&self.released_capture_pending),
            observation_replay: Arc::clone(&self.observation_replay),
            operations: Arc::clone(&self.operations),
            #[cfg(test)]
            window_admission_provider: Mutex::new(None),
        }
    }

    #[cfg(test)]
    pub(super) fn set_window_admission_provider(&self, provider: WindowAdmissionProvider) {
        *self.window_admission_provider.lock().unwrap() = Some(provider);
    }

    pub(super) fn begin_current_content_mutation(
        &self,
    ) -> Result<CurrentContentMutationGuard, HistoryError> {
        let mut state = self
            .current_content
            .state
            .lock()
            .map_err(|_| "Note Timeline current-content lock poisoned".to_string())?;
        state.active_mutations = state.active_mutations.saturating_add(1);
        state.generation = state.generation.wrapping_add(1);
        drop(state);
        Ok(CurrentContentMutationGuard {
            coordinator: Arc::clone(&self.current_content),
        })
    }

    pub(super) fn current_content_version(&self) -> Result<CurrentContentVersion, HistoryError> {
        Ok(self
            .current_content
            .state
            .lock()
            .map(|state| CurrentContentVersion {
                generation: state.generation,
            })
            .map_err(|_| "Note Timeline current-content lock poisoned".to_string())?)
    }

    pub(super) fn current_content_is_current(
        &self,
        version: CurrentContentVersion,
    ) -> Result<bool, HistoryError> {
        Ok(self
            .current_content
            .state
            .lock()
            .map(|state| state.active_mutations == 0 && state.generation == version.generation)
            .map_err(|_| "Note Timeline current-content lock poisoned".to_string())?)
    }

    pub(super) fn begin_operation(&self) -> Result<OperationGuard, HistoryError> {
        let mut state = self
            .operations
            .state
            .lock()
            .map_err(|_| "Note Timeline mutation barrier lock poisoned".to_string())?;
        if state.closed {
            return Err("Note Timeline is cleanly closed for vault portability"
                .to_string()
                .into());
        }
        if state.closing {
            return Err("Note Timeline is closing for vault portability"
                .to_string()
                .into());
        }
        state.active += 1;
        Ok(OperationGuard {
            _lease: Arc::new(OperationLease {
                barrier: Arc::clone(&self.operations),
            }),
        })
    }

    pub(super) fn close_operations(
        &self,
        operation: impl FnOnce() -> Result<(), HistoryError>,
    ) -> Result<(), HistoryError> {
        let mut state = self
            .operations
            .state
            .lock()
            .map_err(|_| "Note Timeline mutation barrier lock poisoned".to_string())?;
        if state.closed {
            return Ok(());
        }
        if state.closing {
            #[cfg(test)]
            {
                state.close_joiners += 1;
                self.operations.settled.notify_all();
            }
            while state.closing {
                state = self
                    .operations
                    .settled
                    .wait(state)
                    .map_err(|_| "Note Timeline mutation barrier lock poisoned".to_string())?;
            }
            #[cfg(test)]
            {
                state.close_joiners = state.close_joiners.saturating_sub(1);
            }
            return state.close_result.clone().unwrap_or_else(|| {
                Err("Note Timeline clean close finished without an outcome"
                    .to_string()
                    .into())
            });
        }
        state.closing = true;
        state.close_result = None;
        self.stop_verification();
        while state.active != 0 {
            state = self
                .operations
                .settled
                .wait(state)
                .map_err(|_| "Note Timeline mutation barrier lock poisoned".to_string())?;
        }
        drop(state);

        // Starting close-settlement verification is itself part of the close
        // attempt. Capture its failure so the barrier is always released and
        // concurrent callers receive the same completed outcome.
        let mut result = self
            .allow_close_settlement_verification()
            .and_then(|()| operation());
        if result.is_err() {
            if let Err(reopen_error) = self.replace_verification(false) {
                result = Err(HistoryError::Unavailable(format!(
                    "{}; Note Timeline verification could not be restored: {reopen_error}",
                    result.expect_err("checked error")
                )));
            }
        }
        let mut state = self
            .operations
            .state
            .lock()
            .map_err(|_| "Note Timeline mutation barrier lock poisoned".to_string())?;
        state.closing = false;
        state.closed = result.is_ok();
        state.close_result = Some(result.clone());
        if result.is_ok() {
            self.stop_verification();
            self.windows.stop();
        }
        self.operations.settled.notify_all();
        drop(state);
        result
    }

    #[cfg(test)]
    pub(super) fn is_cleanly_closed(&self) -> Result<bool, HistoryError> {
        Ok(self
            .operations
            .state
            .lock()
            .map(|state| state.closed)
            .map_err(|_| "Note Timeline mutation barrier lock poisoned".to_string())?)
    }

    #[cfg(test)]
    pub(super) fn wait_for_close_joiner(&self) {
        let state = self.operations.state.lock().expect("timeline barrier");
        let (state, _) = self
            .operations
            .settled
            .wait_timeout_while(state, std::time::Duration::from_secs(1), |state| {
                state.close_joiners == 0
            })
            .expect("timeline close joiner");
        assert!(state.close_joiners > 0, "clean close caller did not join");
    }

    pub(super) fn with_observation_replay<T>(
        &self,
        operation: impl FnOnce() -> Result<T, HistoryError>,
    ) -> Result<T, HistoryError> {
        let _replay = self
            .observation_replay
            .lock()
            .map_err(|_| "Note Timeline observation replay lock poisoned".to_string())?;
        self.track_owned_history_result(operation())
    }

    pub(super) fn ensure_history_recovered(
        &self,
        recover: impl FnOnce() -> Result<(), HistoryError>,
    ) -> Result<(), HistoryError> {
        if self.store_replacement_pending()? {
            return Err("History store replacement is pending".into());
        }
        let result = self.with_history_result(|| {
            let mut recovered = self.lock_history_recovery()?;
            self.require_integrity_available()?;
            if !*recovered {
                history_store::admit_current_store(&self.store)?;
                recover()?;
                *recovered = true;
            }
            // Share the same recovery owner across readers and prepared writers.
            // The hot successful path does not reopen SQLite or scan receipts.
            let mut pending = self
                .released_capture_pending
                .lock()
                .map_err(|_| "Note Timeline capture recovery lock poisoned")?;
            if *pending {
                history_store::recover_released_publications(&self.store)?;
                *pending = false;
            }
            drop(pending);
            drop(recovered);
            self.maybe_start_history_verification();
            Ok(())
        });
        self.recovery_unavailable
            .store(result.is_err(), std::sync::atomic::Ordering::Release);
        result
    }

    pub(super) fn require_released_capture_recovery(&self) -> Result<(), HistoryError> {
        *self
            .released_capture_pending
            .lock()
            .map_err(|_| "Note Timeline capture recovery lock poisoned")? = true;
        Ok(())
    }

    pub(super) fn retry_history_recovery(
        &self,
        recover: impl FnOnce() -> Result<(), HistoryError>,
    ) -> Result<(), HistoryError> {
        let mut recovered = self.lock_history_recovery()?;
        recover()?;
        *recovered = true;
        Ok(())
    }

    pub(super) fn history_needs_recovery(&self) -> Result<bool, HistoryError> {
        Ok(!*self.lock_history_recovery()?)
    }

    pub(super) fn retry_startup_after_failed_deletion(&self) -> Result<(), HistoryError> {
        *self.lock_history_recovery()? = false;
        Ok(())
    }

    fn lock_history_recovery(&self) -> Result<MutexGuard<'_, bool>, HistoryError> {
        Ok(self
            .history_recovered
            .lock()
            .map_err(|_| "Note Timeline recovery lock poisoned".to_string())?)
    }

    pub(super) fn begin_history_replacement(&self) -> Result<(), HistoryError> {
        self.windows.reset();
        self.replace_verification(true)?;
        let mut recovered = self.lock_history_recovery()?;
        *recovered = false;
        Ok(())
    }

    pub(super) fn complete_history_replacement(&self) -> Result<(), HistoryError> {
        let mut recovered = self.lock_history_recovery()?;
        *recovered = true;
        drop(recovered);
        self.finish_store_replacement()?;
        Ok(())
    }

    pub(super) fn history_health_snapshot(
        &self,
    ) -> Result<history_store::HistoryStoreHealth, HistoryError> {
        if self.require_integrity_available().is_err() {
            return Ok(history_store::HistoryStoreHealth::Corrupt);
        }
        let (generation, replacement, stop) = self.diagnostic_scope()?;
        let health = history_store::health_snapshot(&self.store, stop);
        match self.apply_diagnostic(
            generation,
            replacement,
            matches!(health, history_store::HistoryStoreHealth::Corrupt),
        ) {
            Err(HistoryError::Corrupt(_)) => Ok(history_store::HistoryStoreHealth::Corrupt),
            Err(error) => Err(error),
            Ok(()) => Ok(health),
        }
    }

    pub(super) fn note_history_health_snapshot(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<history_store::NoteHistoryStoreHealth, HistoryError> {
        if self.require_integrity_available().is_err() {
            return Ok(history_store::NoteHistoryStoreHealth::Corrupt);
        }
        let (generation, replacement, stop) = self.diagnostic_scope()?;
        let health = history_store::note_health_snapshot(&self.store, note_id, stop);
        match self.apply_diagnostic(
            generation,
            replacement,
            matches!(health, history_store::NoteHistoryStoreHealth::Corrupt),
        ) {
            Err(HistoryError::Corrupt(_)) => Ok(history_store::NoteHistoryStoreHealth::Corrupt),
            Err(error) => Err(error),
            Ok(()) => Ok(health),
        }
    }
}

impl Drop for NoteTimelineRuntime {
    fn drop(&mut self) {
        if !self.worker {
            self.windows.stop();
            self.stop_verification();
        }
    }
}
