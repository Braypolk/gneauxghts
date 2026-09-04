use super::{history_store, NoteIdentity};
use crate::index::NoteTimelineOwnerToken;
use std::{
    fmt,
    sync::{Arc, Condvar, Mutex, MutexGuard},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum IntegrityAttestation {
    Unverified,
    Verified,
    Corrupt,
}

#[derive(Clone, Copy)]
pub(super) enum RecoveryIntegrity {
    Exhaustive,
    Bounded,
}

#[derive(Default)]
struct OperationState {
    active: usize,
    closing: bool,
    closed: bool,
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
    lease: Arc<OperationLease>,
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
    current_content: Arc<CurrentContentCoordinator>,
    history_recovered: Mutex<bool>,
    integrity: Mutex<IntegrityAttestation>,
    observation_replay: Mutex<()>,
    operations: Arc<NoteTimelineOperationBarrier>,
}

impl NoteTimelineRuntime {
    pub(crate) fn new(_owner: NoteTimelineOwnerToken) -> Self {
        Self {
            current_content: Arc::new(CurrentContentCoordinator::default()),
            history_recovered: Mutex::new(false),
            integrity: Mutex::new(IntegrityAttestation::Unverified),
            observation_replay: Mutex::new(()),
            operations: Arc::new(NoteTimelineOperationBarrier::default()),
        }
    }

    pub(super) fn begin_current_content_mutation(
        &self,
    ) -> Result<CurrentContentMutationGuard, String> {
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

    pub(super) fn current_content_version(&self) -> Result<CurrentContentVersion, String> {
        self.current_content
            .state
            .lock()
            .map(|state| CurrentContentVersion {
                generation: state.generation,
            })
            .map_err(|_| "Note Timeline current-content lock poisoned".to_string())
    }

    pub(super) fn current_content_is_current(
        &self,
        version: CurrentContentVersion,
    ) -> Result<bool, String> {
        self.current_content
            .state
            .lock()
            .map(|state| state.active_mutations == 0 && state.generation == version.generation)
            .map_err(|_| "Note Timeline current-content lock poisoned".to_string())
    }

    pub(super) fn begin_operation(&self) -> Result<OperationGuard, String> {
        let mut state = self
            .operations
            .state
            .lock()
            .map_err(|_| "Note Timeline mutation barrier lock poisoned".to_string())?;
        if state.closed {
            return Err("Note Timeline is cleanly closed for vault portability".to_string());
        }
        if state.closing {
            return Err("Note Timeline is closing for vault portability".to_string());
        }
        state.active += 1;
        Ok(OperationGuard {
            lease: Arc::new(OperationLease {
                barrier: Arc::clone(&self.operations),
            }),
        })
    }

    pub(super) fn close_operations<T>(
        &self,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self
            .operations
            .state
            .lock()
            .map_err(|_| "Note Timeline mutation barrier lock poisoned".to_string())?;
        if state.closed {
            return Err(
                "Note Timeline is already cleanly closed for vault portability".to_string(),
            );
        }
        if state.closing {
            return Err("Note Timeline clean close is already in progress".to_string());
        }
        state.closing = true;
        while state.active != 0 {
            state = self
                .operations
                .settled
                .wait(state)
                .map_err(|_| "Note Timeline mutation barrier lock poisoned".to_string())?;
        }
        drop(state);

        let result = operation();
        let mut state = self
            .operations
            .state
            .lock()
            .map_err(|_| "Note Timeline mutation barrier lock poisoned".to_string())?;
        state.closing = false;
        state.closed = result.is_ok();
        self.operations.settled.notify_all();
        result
    }

    pub(super) fn is_cleanly_closed(&self) -> Result<bool, String> {
        self.operations
            .state
            .lock()
            .map(|state| state.closed)
            .map_err(|_| "Note Timeline mutation barrier lock poisoned".to_string())
    }

    pub(super) fn with_observation_replay<T>(
        &self,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let _replay = self
            .observation_replay
            .lock()
            .map_err(|_| "Note Timeline observation replay lock poisoned".to_string())?;
        operation()
    }

    pub(super) fn ensure_history_recovered(
        &self,
        integrity: RecoveryIntegrity,
        recover: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut recovered = self.lock_history_recovery()?;
        if matches!(integrity, RecoveryIntegrity::Exhaustive) {
            self.ensure_integrity_attested()?;
        }
        if *recovered {
            return Ok(());
        }
        recover()?;
        *recovered = true;
        Ok(())
    }

    pub(super) fn retry_history_recovery(
        &self,
        recover: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut recovered = self.lock_history_recovery()?;
        recover()?;
        *recovered = true;
        Ok(())
    }

    fn lock_history_recovery(&self) -> Result<MutexGuard<'_, bool>, String> {
        self.history_recovered
            .lock()
            .map_err(|_| "Note Timeline recovery lock poisoned".to_string())
    }

    fn lock_integrity(&self) -> Result<MutexGuard<'_, IntegrityAttestation>, String> {
        self.integrity
            .lock()
            .map_err(|_| "Note Timeline integrity attestation lock poisoned".to_string())
    }

    fn ensure_integrity_attested(&self) -> Result<(), String> {
        let mut attestation = self.lock_integrity()?;
        match *attestation {
            IntegrityAttestation::Verified => return Ok(()),
            IntegrityAttestation::Corrupt => {
                return Err(
                    "Note Timeline history is corrupt; canonical publication is blocked"
                        .to_string(),
                );
            }
            IntegrityAttestation::Unverified => {}
        }
        match history_store::integrity_snapshot() {
            history_store::HistoryStoreIntegrity::Verified => {
                *attestation = IntegrityAttestation::Verified;
                Ok(())
            }
            history_store::HistoryStoreIntegrity::Unavailable => {
                Err("Note Timeline history store is unavailable".to_string())
            }
            history_store::HistoryStoreIntegrity::Corrupt => {
                *attestation = IntegrityAttestation::Corrupt;
                Err(
                    "Note Timeline history is corrupt; canonical publication is blocked"
                        .to_string(),
                )
            }
        }
    }

    pub(super) fn begin_history_replacement(&self) -> Result<(), String> {
        let mut recovered = self.lock_history_recovery()?;
        let mut integrity = self.lock_integrity()?;
        *recovered = false;
        *integrity = IntegrityAttestation::Unverified;
        Ok(())
    }

    pub(super) fn fail_history_replacement(&self) -> Result<(), String> {
        *self.lock_integrity()? = IntegrityAttestation::Corrupt;
        Ok(())
    }

    pub(super) fn complete_history_replacement(&self) -> Result<(), String> {
        let mut recovered = self.lock_history_recovery()?;
        let mut integrity = self.lock_integrity()?;
        *recovered = true;
        *integrity = IntegrityAttestation::Verified;
        Ok(())
    }

    pub(super) fn history_health_snapshot(
        &self,
    ) -> Result<history_store::HistoryStoreHealth, String> {
        let mut attestation = self.lock_integrity()?;
        if *attestation == IntegrityAttestation::Corrupt {
            return Ok(history_store::HistoryStoreHealth::Corrupt);
        }
        let health = history_store::health_snapshot();
        match &health {
            history_store::HistoryStoreHealth::Available(_) => {
                *attestation = IntegrityAttestation::Verified;
            }
            history_store::HistoryStoreHealth::Corrupt => {
                *attestation = IntegrityAttestation::Corrupt;
            }
            history_store::HistoryStoreHealth::Unavailable => {}
        }
        Ok(health)
    }

    pub(super) fn note_history_health_snapshot(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<history_store::NoteHistoryStoreHealth, String> {
        let mut attestation = self.lock_integrity()?;
        if *attestation == IntegrityAttestation::Corrupt {
            return Ok(history_store::NoteHistoryStoreHealth::Corrupt);
        }
        let health = history_store::note_health_snapshot(note_id);
        if matches!(health, history_store::NoteHistoryStoreHealth::Corrupt) {
            *attestation = IntegrityAttestation::Corrupt;
        }
        Ok(health)
    }
}
