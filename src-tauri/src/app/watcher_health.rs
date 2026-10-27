//! Retained diagnostics for the Running Vault's existing watcher lifetime.
//! This owner reports service state; it does not start, retry or recover workers.
use super::EventBus;
use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WatcherStatus {
    Starting,
    Watching,
    Degraded,
    Unavailable,
    Stopped,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WatcherFailure {
    // Increasing specificity: a later generic error cannot hide watch exhaustion.
    Other,
    PermissionDenied,
    WatchLimit,
}

impl WatcherFailure {
    pub(crate) fn from_notify(error: &notify::Error) -> Self {
        match &error.kind {
            notify::ErrorKind::MaxFilesWatch => Self::WatchLimit,
            notify::ErrorKind::Io(error) => Self::from_io(error),
            _ => Self::Other,
        }
    }

    pub(crate) fn from_io(error: &std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            Self::PermissionDenied
        } else {
            Self::Other
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WatcherHealthSnapshot {
    pub(crate) revision: u64,
    pub(crate) status: WatcherStatus,
    pub(crate) reason: Option<WatcherFailure>,
    pub(crate) reconciliation_running: bool,
}

pub(crate) struct WatcherHealth {
    state: Mutex<WatcherHealthSnapshot>,
    events: EventBus,
}

impl WatcherHealth {
    pub(crate) fn new(events: EventBus) -> Self {
        Self {
            state: Mutex::new(WatcherHealthSnapshot {
                revision: 0,
                status: WatcherStatus::Starting,
                reason: None,
                reconciliation_running: false,
            }),
            events,
        }
    }

    pub(crate) fn snapshot(&self) -> WatcherHealthSnapshot {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    fn update(&self, change: impl FnOnce(&mut WatcherHealthSnapshot)) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.status == WatcherStatus::Stopped {
            return;
        }
        let before = state.clone();
        change(&mut state);
        if *state != before {
            state.revision += 1;
            // Serialize updates and emission together so callbacks cannot publish
            // older state after shutdown. IPC delivery itself is best effort.
            self.events.watcher_health_changed(state.clone());
        }
    }

    pub(crate) fn started(&self) {
        self.update(|state| {
            if state.status == WatcherStatus::Unavailable {
                return;
            }
            state.status = if state.reason.is_some() {
                WatcherStatus::Degraded
            } else {
                WatcherStatus::Watching
            };
            state.reconciliation_running = true;
        });
    }

    pub(crate) fn startup_failed(&self, reason: WatcherFailure) {
        self.update(|state| {
            state.status = WatcherStatus::Unavailable;
            state.reason = Some(state.reason.map_or(reason, |previous| previous.max(reason)));
            state.reconciliation_running = false;
        });
    }

    pub(crate) fn callback_failed(&self, error: &notify::Error) {
        self.update(|state| {
            if state.status == WatcherStatus::Unavailable {
                return;
            }
            let reason = WatcherFailure::from_notify(error);
            state.reason = Some(state.reason.map_or(reason, |previous| previous.max(reason)));
            state.status = WatcherStatus::Degraded;
        });
    }

    pub(crate) fn stop(&self) {
        self.update(|state| {
            state.status = WatcherStatus::Stopped;
            state.reconciliation_running = false;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn health() -> WatcherHealth {
        WatcherHealth::new(EventBus::disabled())
    }

    #[test]
    fn startup_failures_are_safe_retained_and_never_claim_reconciliation() {
        for (error, reason) in [
            (
                notify::Error::new(notify::ErrorKind::MaxFilesWatch),
                WatcherFailure::WatchLimit,
            ),
            (
                notify::Error::generic("private /vault/path and OS details"),
                WatcherFailure::Other,
            ),
            (
                notify::Error::io(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
                WatcherFailure::PermissionDenied,
            ),
        ] {
            let health = health();
            health.startup_failed(WatcherFailure::from_notify(&error));
            let snapshot = health.snapshot();
            assert_eq!(snapshot.status, WatcherStatus::Unavailable);
            assert_eq!(snapshot.reason, Some(reason));
            assert!(!snapshot.reconciliation_running);
            assert!(!serde_json::to_string(&snapshot)
                .unwrap()
                .contains("private"));
            health.started();
            assert_eq!(health.snapshot(), snapshot);
        }
    }

    #[test]
    fn callback_failure_before_start_completion_stays_degraded_after_start() {
        let health = health();
        health.callback_failed(&notify::Error::new(notify::ErrorKind::MaxFilesWatch));
        assert_eq!(health.snapshot().status, WatcherStatus::Degraded);
        assert!(!health.snapshot().reconciliation_running);
        health.started();
        let snapshot = health.snapshot();
        assert_eq!(snapshot.status, WatcherStatus::Degraded);
        assert_eq!(snapshot.reason, Some(WatcherFailure::WatchLimit));
        assert!(snapshot.reconciliation_running);
    }

    #[test]
    fn repeated_errors_are_bounded_and_do_not_hide_watch_capacity_failure() {
        let health = health();
        health.started();
        let generic = notify::Error::generic("private details");
        health.callback_failed(&generic);
        let degraded = health.snapshot();
        for _ in 0..100 {
            health.callback_failed(&generic);
        }
        assert_eq!(health.snapshot(), degraded);
        health.callback_failed(&notify::Error::new(notify::ErrorKind::MaxFilesWatch));
        let limit = health.snapshot();
        assert_eq!(limit.revision, degraded.revision + 1);
        assert_eq!(limit.reason, Some(WatcherFailure::WatchLimit));
        health.callback_failed(&generic);
        health.started();
        assert_eq!(health.snapshot(), limit);
    }

    #[test]
    fn shutdown_retires_callbacks_and_late_startup_even_without_an_installed_handle() {
        for started in [false, true] {
            let health = health();
            if started {
                health.started();
            }
            health.stop();
            let stopped = health.snapshot();
            health.started();
            health.callback_failed(&notify::Error::generic("late"));
            health.startup_failed(WatcherFailure::Other);
            health.stop();
            assert_eq!(health.snapshot(), stopped);
            assert_eq!(stopped.status, WatcherStatus::Stopped);
            assert!(!stopped.reconciliation_running);
        }
    }
}
