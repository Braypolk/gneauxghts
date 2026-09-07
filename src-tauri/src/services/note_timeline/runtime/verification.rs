use super::*;
use std::{
    collections::{HashMap, HashSet},
    sync::atomic::{AtomicBool, Ordering},
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum NoteProof {
    Running,
    Replacing,
    Ready,
    Unavailable,
}
struct Entry {
    identity: u64,
    proof: NoteProof,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Coverage {
    Idle,
    Running,
    Complete,
    Unavailable,
    Stopped,
    Settling,
}

#[derive(Default)]
pub(super) struct Verification {
    state: Mutex<VerificationState>,
    changed: Condvar,
    #[cfg(test)]
    enabled: AtomicBool,
    #[cfg(test)]
    hook: Mutex<Option<VerificationHook>>,
    #[cfg(test)]
    replacement_hook: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
    #[cfg(test)]
    completion_hook: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}
#[cfg(test)]
type VerificationHook =
    Arc<dyn Fn(&NoteIdentity, &AtomicBool) -> Result<(), HistoryError> + Send + Sync>;
struct VerificationState {
    scope: String,
    generation: u64,
    next_identity: u64,
    notes: HashMap<NoteIdentity, Entry>,
    verified: usize,
    total: Option<usize>,
    stop: Arc<AtomicBool>,
    coverage: Coverage,
    corrupt: bool,
    replacement: u64,
    replacing_store: bool,
    active_replacements: usize,
}
// A target proof survives unrelated replacements; a whole-store result does not.
#[derive(Clone, Copy)]
enum CheckScope<'a> {
    Note(&'a NoteIdentity, u64, u64),
    Store(u64, u64),
}
impl Default for VerificationState {
    fn default() -> Self {
        Self {
            scope: crate::note::generate_unique_id(),
            generation: 0,
            next_identity: 0,
            notes: HashMap::new(),
            verified: 0,
            total: None,
            stop: Arc::new(AtomicBool::new(false)),
            coverage: Coverage::Idle,
            corrupt: false,
            replacement: 0,
            replacing_store: false,
            active_replacements: 0,
        }
    }
}
impl Verification {
    fn lock(&self) -> Result<MutexGuard<'_, VerificationState>, HistoryError> {
        self.state
            .lock()
            .map_err(|_| "History verification lock poisoned".into())
    }
}
impl VerificationState {
    fn available(&self) -> Result<(), HistoryError> {
        if self.corrupt {
            Err(HistoryError::Corrupt(
                "Note Timeline history is corrupt; canonical publication is blocked".into(),
            ))
        } else {
            Ok(())
        }
    }
    fn current(&self, scope: CheckScope<'_>) -> bool {
        !self.replacing_store
            && match scope {
                CheckScope::Note(note, generation, identity) => {
                    self.generation == generation
                        && self
                            .notes
                            .get(note)
                            .is_some_and(|entry| entry.identity == identity)
                }
                CheckScope::Store(generation, replacement) => {
                    self.generation == generation
                        && self.replacement == replacement
                        && self.active_replacements == 0
                }
            }
    }
    // Scope is checked before either success or corruption changes live state.
    fn accept<T>(
        &mut self,
        scope: CheckScope<'_>,
        result: Result<T, HistoryError>,
    ) -> Result<T, HistoryError> {
        if !self.current(scope) {
            return Err(HistoryError::Stale(
                "History verification was replaced".into(),
            ));
        }
        if let CheckScope::Note(note, _, _) = scope {
            let proof = if result.is_ok() {
                NoteProof::Ready
            } else {
                NoteProof::Unavailable
            };
            self.set_note(note.clone(), proof);
        }
        self.corrupt |= matches!(result, Err(HistoryError::Corrupt(_)));
        result.and_then(|value| self.available().map(|()| value))
    }
    fn set_note(&mut self, note: NoteIdentity, proof: NoteProof) -> u64 {
        self.next_identity += 1;
        let identity = self.next_identity;
        let old = self.notes.insert(note, Entry { identity, proof });
        self.verified -= usize::from(old.is_some_and(|e| e.proof == NoteProof::Ready));
        self.verified += usize::from(proof == NoteProof::Ready);
        identity
    }
    fn invalidate_coverage(&mut self) {
        self.replacement += 1;
        if matches!(self.coverage, Coverage::Complete | Coverage::Unavailable) {
            self.coverage = Coverage::Idle;
        }
    }
}
pub(in super::super) struct NoteVerificationReplacement {
    runtime: NoteTimelineRuntime,
    note: NoteIdentity,
    identity: u64,
}
impl Drop for NoteVerificationReplacement {
    fn drop(&mut self) {
        if let Ok(mut state) = self.runtime.verification.lock() {
            if state
                .notes
                .get(&self.note)
                .is_some_and(|entry| entry.identity == self.identity)
            {
                state.notes.remove(&self.note);
                state.active_replacements -= 1;
                state.invalidate_coverage();
            }
        }
        self.runtime.verification.changed.notify_all();
        self.runtime.maybe_start_history_verification();
    }
}

impl NoteTimelineRuntime {
    #[cfg(test)]
    pub(in super::super) fn diagnostic_scope_for_test(&self) -> (u64, u64) {
        let (generation, replacement, _) = self.diagnostic_scope().unwrap();
        (generation, replacement)
    }
    #[cfg(test)]
    pub(in super::super) fn apply_diagnostic_for_test(
        &self,
        scope: (u64, u64),
        corrupt: bool,
    ) -> Result<(), HistoryError> {
        self.apply_diagnostic(scope.0, scope.1, corrupt)
    }
    #[cfg(test)]
    pub(in super::super) fn set_verification_hook(&self, hook: VerificationHook) {
        *self.verification.hook.lock().unwrap() = Some(hook);
    }
    #[cfg(test)]
    pub(in super::super) fn set_replacement_hook(&self, hook: Arc<dyn Fn() + Send + Sync>) {
        *self.verification.replacement_hook.lock().unwrap() = Some(hook);
    }
    #[cfg(test)]
    pub(in super::super) fn set_verification_completion_hook(
        &self,
        hook: Arc<dyn Fn() + Send + Sync>,
    ) {
        *self.verification.completion_hook.lock().unwrap() = Some(hook);
    }
    /// Recheck admission inside the file owner without waiting for a verifier
    /// or recovery. Replacement and close cannot pass that owner during a save.
    pub(in super::super) fn is_note_ready(
        &self,
        note: &NoteIdentity,
    ) -> Result<bool, HistoryError> {
        let recovered = match self.history_recovered.try_lock() {
            Ok(recovered) => recovered,
            Err(std::sync::TryLockError::WouldBlock) => return Ok(false),
            Err(_) => return Err("Note Timeline recovery lock poisoned".into()),
        };
        let pending = match self.released_capture_pending.try_lock() {
            Ok(pending) => pending,
            Err(std::sync::TryLockError::WouldBlock) => return Ok(false),
            Err(_) => return Err("Note Timeline capture recovery lock poisoned".into()),
        };
        let state = self.verification.lock()?;
        state.available()?;
        if state.replacing_store || state.stop.load(Ordering::Acquire) {
            return Err("History verification is stopping or being replaced".into());
        }
        Ok(*recovered
            && !*pending
            && state
                .notes
                .get(note)
                .is_some_and(|entry| entry.proof == NoteProof::Ready))
    }

    /// Join only this target. SQL runs outside the coordinator and file owner.
    pub(in super::super) fn ensure_note_ready(
        &self,
        note: &NoteIdentity,
    ) -> Result<(), HistoryError> {
        loop {
            let mut state = self.verification.lock()?;
            state.available()?;
            if state.replacing_store || state.stop.load(Ordering::Acquire) {
                return Err("History verification is stopping or being replaced".into());
            }
            match state.notes.get(note).map(|e| e.proof) {
                Some(NoteProof::Ready) => return Ok(()),
                Some(NoteProof::Running | NoteProof::Replacing) => {
                    drop(
                        self.verification
                            .changed
                            .wait(state)
                            .map_err(|_| "History verification lock poisoned")?,
                    );
                    continue;
                }
                _ => {}
            }
            let identity = state.set_note(note.clone(), NoteProof::Running);
            let scope = CheckScope::Note(note, state.generation, identity);
            let stop = state.stop.clone();
            if state.coverage == Coverage::Complete {
                state.coverage = Coverage::Idle;
            }
            drop(state);
            let result = history_store::verify_note(&self.store, note, stop.clone());
            #[cfg(test)]
            let result = {
                let hook = self.verification.hook.lock().unwrap().clone();
                result.and(hook.map_or(Ok(()), |hook| hook(note, &stop)))
            };
            let result = self.verification.lock()?.accept(scope, result);
            self.verification.changed.notify_all();
            result?;
            self.maybe_start_history_verification();
            return self.require_integrity_available();
        }
    }

    pub(in super::super) fn replace_note_history(
        &self,
        note: &NoteIdentity,
    ) -> Result<NoteVerificationReplacement, HistoryError> {
        let mut state = self.verification.lock()?;
        state.active_replacements += 1;
        let identity = state.set_note(note.clone(), NoteProof::Replacing);
        state.invalidate_coverage();
        self.verification.changed.notify_all();
        drop(state);
        let replacement = NoteVerificationReplacement {
            runtime: self.worker_clone(),
            note: note.clone(),
            identity,
        };
        #[cfg(test)]
        {
            let hook = self.verification.replacement_hook.lock().unwrap().clone();
            if let Some(hook) = hook {
                hook();
            }
        }
        Ok(replacement)
    }
    pub(super) fn store_replacement_pending(&self) -> Result<bool, HistoryError> {
        Ok(self.verification.lock()?.replacing_store)
    }
    pub(super) fn finish_store_replacement(&self) -> Result<(), HistoryError> {
        {
            let mut state = self.verification.lock()?;
            state.replacing_store = false;
            state.corrupt = false;
            state.invalidate_coverage();
        }
        self.verification.changed.notify_all();
        self.maybe_start_history_verification();
        Ok(())
    }
    #[cfg(test)]
    pub(in super::super) fn invalidate_note_verification(
        &self,
        note: &NoteIdentity,
    ) -> Result<(), HistoryError> {
        let mut state = self.verification.lock()?;
        let old = state.notes.remove(note);
        state.verified -= usize::from(old.is_some_and(|e| e.proof == NoteProof::Ready));
        state.invalidate_coverage();
        self.verification.changed.notify_all();
        Ok(())
    }
    pub(in super::super) fn stop_verification(&self) {
        if let Ok(mut state) = self.verification.lock() {
            state.stop.store(true, Ordering::Release);
            state.coverage = Coverage::Stopped;
        }
        self.verification.changed.notify_all();
    }
    pub(in super::super) fn replace_verification(
        &self,
        replacing_store: bool,
    ) -> Result<(), HistoryError> {
        {
            let mut state = self.verification.lock()?;
            state.stop.store(true, Ordering::Release);
            *state = VerificationState {
                generation: state.generation + 1,
                next_identity: state.next_identity,
                replacement: state.replacement + 1,
                // Failed close cannot erase a discovered corruption latch.
                corrupt: state.corrupt,
                replacing_store,
                ..VerificationState::default()
            };
        }
        self.verification.changed.notify_all();
        #[cfg(test)]
        if replacing_store {
            let hook = self.verification.replacement_hook.lock().unwrap().clone();
            if let Some(hook) = hook {
                hook();
            }
        }
        Ok(())
    }
    #[cfg(test)]
    pub(in super::super) fn start_history_verification(&self) {
        self.verification.enabled.store(true, Ordering::Release);
        self.maybe_start_history_verification();
    }
    pub(super) fn maybe_start_history_verification(&self) {
        #[cfg(test)]
        if !self.verification.enabled.load(Ordering::Acquire) {
            return;
        }
        if !self
            .history_recovered
            .try_lock()
            .map(|s| *s)
            .unwrap_or(false)
        {
            return;
        }
        let Ok(mut state) = self.verification.lock() else {
            return;
        };
        if !matches!(state.coverage, Coverage::Idle | Coverage::Unavailable)
            || state.corrupt
            || state.replacing_store
            || state.active_replacements != 0
        {
            return;
        }
        state.coverage = Coverage::Running;
        let generation = state.generation;
        let replacement = state.replacement;
        let stop = state.stop.clone();
        drop(state);
        let worker = self.worker_clone();
        std::thread::Builder::new()
            .name("note-history-verification".into())
            .spawn(move || {
                let result = worker.verify_coverage(generation, replacement, stop.clone());
                #[cfg(test)]
                {
                    let hook = worker.verification.completion_hook.lock().unwrap().clone();
                    if let Some(hook) = hook {
                        hook();
                    }
                }
                if let Ok(mut state) = worker.verification.lock() {
                    if state.generation != generation || stop.load(Ordering::Acquire) {
                        return;
                    }
                    let result = state.accept(CheckScope::Store(generation, replacement), result);
                    state.coverage = match result {
                        Ok(()) if state.verified == state.notes.len() => Coverage::Complete,
                        Ok(()) | Err(HistoryError::Stale(_)) => Coverage::Idle,
                        Err(_) => Coverage::Unavailable,
                    };
                    // Only replacement or newly discovered work restarts this pass.
                    // Retryable I/O waits for a later caller rather than spinning.
                    if state.coverage != Coverage::Idle {
                        return;
                    }
                }
                worker.verification.changed.notify_all();
                worker.maybe_start_history_verification();
            })
            .expect("start Note Timeline verification");
    }
    fn verify_coverage(
        &self,
        generation: u64,
        replacement: u64,
        stop: Arc<AtomicBool>,
    ) -> Result<(), HistoryError> {
        let mut notes = {
            let _operation = self.begin_operation()?;
            history_store::verification_notes(&self.store, stop.clone())?
        };
        let cached = {
            let mut state = self.verification.lock()?;
            state.accept(CheckScope::Store(generation, replacement), Ok(()))?;
            state.notes.keys().cloned().collect::<Vec<_>>()
        };
        // Building the vault worklist must not grow/rehash the target proof map
        // under the readiness lock. Each target claims its own entry later.
        let mut known: HashSet<_> = notes.iter().cloned().collect();
        notes.extend(cached.into_iter().filter(|note| known.insert(note.clone())));
        {
            let mut state = self.verification.lock()?;
            state.accept(CheckScope::Store(generation, replacement), Ok(()))?;
            state.total = Some(notes.len());
        }
        for note in notes {
            if stop.load(Ordering::Acquire) {
                return Ok(());
            }
            let _operation = self.begin_operation()?;
            self.ensure_note_ready(&note)?;
            std::thread::yield_now();
        }
        let _operation = self.begin_operation()?;
        self.diagnostic_scope()?;
        history_store::verify_structure(&self.store, stop)
    }
    pub(super) fn allow_close_settlement_verification(&self) -> Result<(), HistoryError> {
        let mut state = self.verification.lock()?;
        // Admitted work has drained. Only private settlement gets a fresh token;
        // the old worker stays cancelled and no coverage worker can start.
        state.stop = Arc::new(AtomicBool::new(false));
        state.coverage = Coverage::Settling;
        Ok(())
    }
    pub(super) fn diagnostic_scope(&self) -> Result<(u64, u64, Arc<AtomicBool>), HistoryError> {
        let state = self.verification.lock()?;
        if state.replacing_store || state.active_replacements != 0 {
            return Err(HistoryError::Unavailable(
                "History replacement is pending; retry diagnostics".into(),
            ));
        }
        Ok((state.generation, state.replacement, state.stop.clone()))
    }
    pub(super) fn apply_diagnostic(
        &self,
        generation: u64,
        replacement: u64,
        corrupt: bool,
    ) -> Result<(), HistoryError> {
        let result = if corrupt {
            Err(HistoryError::Corrupt(
                "History diagnostic found corruption".into(),
            ))
        } else {
            Ok(())
        };
        self.verification
            .lock()?
            .accept(CheckScope::Store(generation, replacement), result)
    }
    pub(super) fn require_integrity_available(&self) -> Result<(), HistoryError> {
        self.verification.lock()?.available()
    }
    pub(in super::super) fn fail_history_replacement(&self) -> Result<(), HistoryError> {
        self.verification.lock()?.corrupt = true;
        Ok(())
    }
    /// Correlate a delayed error with the store it came from. Successful values
    /// retain their existing delivery/committed-result contract; a clear or restore
    /// must not turn its own completed mutation into a retryable failure.
    pub(in super::super) fn with_history_result<T>(
        &self,
        operation: impl FnOnce() -> Result<T, HistoryError>,
    ) -> Result<T, HistoryError> {
        let scope = {
            let state = self.verification.lock()?;
            CheckScope::Store(state.generation, state.replacement)
        };
        let result = operation();
        if result.is_err() {
            self.verification.lock()?.accept(scope, result)
        } else {
            result
        }
    }
    // Only observation replay may use an unscoped result: its mutex excludes
    // reset through completion, including reset's own generation-changing errors.
    pub(super) fn track_owned_history_result<T>(
        &self,
        result: Result<T, HistoryError>,
    ) -> Result<T, HistoryError> {
        if matches!(&result, Err(HistoryError::Corrupt(_))) {
            self.verification.lock()?.corrupt = true;
        }
        result
    }
    pub(in super::super) fn readiness(
        &self,
        note: Option<&NoteIdentity>,
    ) -> Result<super::super::HistoryReadiness, HistoryError> {
        use super::super::{HistoryReadiness, HistoryReadinessState};
        let recovered = self
            .history_recovered
            .try_lock()
            .map(|s| *s)
            .unwrap_or(false);
        let state = self.verification.lock()?;
        let status = if state.corrupt {
            HistoryReadinessState::Corrupt
        } else if state.replacing_store
            || matches!(state.coverage, Coverage::Stopped | Coverage::Settling)
            || (!recovered && self.recovery_unavailable.load(Ordering::Acquire))
        {
            HistoryReadinessState::Unavailable
        } else if !recovered {
            HistoryReadinessState::RecoveryPending
        } else {
            match note.and_then(|n| state.notes.get(n)).map(|e| e.proof) {
                Some(NoteProof::Ready) => HistoryReadinessState::Ready,
                Some(NoteProof::Unavailable) => HistoryReadinessState::Unavailable,
                _ => HistoryReadinessState::TargetVerificationPending,
            }
        };
        Ok(HistoryReadiness {
            scope: state.scope.clone(),
            revision: state.replacement,
            note_id: note.map(|n| n.as_str().to_owned()),
            state: status,
            verified_notes: state.verified,
            total_notes: state.total.map(|total| total.max(state.notes.len())),
            background_complete: state.coverage == Coverage::Complete,
            background_unavailable: state.coverage == Coverage::Unavailable,
        })
    }
}
