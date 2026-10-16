//! TEMPORARY PI REFRESH DIAGNOSTIC: remove after identifying the native writer.
//! Closed labels and counters only; never retain paths, note IDs or content.
use serde::Serialize;
use std::{collections::VecDeque, time::Instant};

const EVENT_LIMIT: usize = 128;
const FAILURE_LIMIT: usize = 12;
pub(super) const ORIGIN_COUNT: usize = 13;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in super::super) enum MutationOrigin {
    Publication,
    Lifecycle,
    Administration,
    Forgotten,
    EvidenceFinalization,
    WindowScheduler,
    Other,
    WatcherCanonical,
    WatcherLifecycle,
    ReconcileCanonical,
    ReconcileScan,
    ReconcileLifecycle,
    WatcherScan,
}

const ORIGINS: [MutationOrigin; ORIGIN_COUNT] = [
    MutationOrigin::Publication,
    MutationOrigin::Lifecycle,
    MutationOrigin::Administration,
    MutationOrigin::Forgotten,
    MutationOrigin::EvidenceFinalization,
    MutationOrigin::WindowScheduler,
    MutationOrigin::Other,
    MutationOrigin::WatcherCanonical,
    MutationOrigin::WatcherLifecycle,
    MutationOrigin::ReconcileCanonical,
    MutationOrigin::ReconcileScan,
    MutationOrigin::ReconcileLifecycle,
    MutationOrigin::WatcherScan,
];

impl MutationOrigin {
    pub(super) fn caller(file: &str) -> Self {
        match file.rsplit('/').next().unwrap_or_default() {
            "publication.rs" => Self::Publication,
            "lifecycle.rs" => Self::Lifecycle,
            "administration.rs" => Self::Administration,
            "forgotten.rs" => Self::Forgotten,
            "current_content.rs" => Self::EvidenceFinalization,
            "windows.rs" => Self::WindowScheduler,
            _ => Self::Other,
        }
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum ReadOrigin {
    PiNotes,
    Evidence,
    Tasks,
    Other,
}

impl ReadOrigin {
    pub(super) fn caller(file: &str) -> Self {
        match file.rsplit('/').next().unwrap_or_default() {
            "pi_prototype_notes.rs" => Self::PiNotes,
            "evidence.rs" => Self::Evidence,
            "task_commands.rs" => Self::Tasks,
            _ => Self::Other,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MutationEvent {
    generation: u64,
    active: usize,
    origin: MutationOrigin,
    phase: &'static str,
    elapsed_micros: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InvalidatedRead {
    attempt: usize,
    origin: ReadOrigin,
    caller_line: u32,
    captured_generation: u64,
    current_generation: u64,
    active: usize,
    captured_active_origins: [usize; ORIGIN_COUNT],
    current_active_origins: [usize; ORIGIN_COUNT],
    begun_since_capture: [u64; ORIGIN_COUNT],
    elapsed_micros: u64,
}

pub(super) struct Diagnostics {
    pub(super) enabled: bool,
    started: Instant,
    active_origins: [usize; ORIGIN_COUNT],
    begun_origins: [u64; ORIGIN_COUNT],
    events: VecDeque<MutationEvent>,
    failures: VecDeque<InvalidatedRead>,
}

impl Default for Diagnostics {
    fn default() -> Self {
        Self {
            enabled: enabled(
                std::env::var("PI_PROTOTYPE_HTTP_FIXTURE").ok().as_deref(),
                std::env::var("PI_PROTOTYPE_INTERACTIVE_GATE")
                    .ok()
                    .as_deref(),
                std::env::var("PI_PROTOTYPE_EXPANDED_GATE").ok().as_deref(),
                std::env::var("PI_PROTOTYPE_DIAGNOSTICS").ok().as_deref(),
            ),
            started: Instant::now(),
            active_origins: [0; ORIGIN_COUNT],
            begun_origins: [0; ORIGIN_COUNT],
            events: VecDeque::new(),
            failures: VecDeque::new(),
        }
    }
}

fn enabled(
    fixture: Option<&str>,
    interactive: Option<&str>,
    expanded: Option<&str>,
    diagnostic: Option<&str>,
) -> bool {
    if interactive != Some("true") || expanded != Some("true") || diagnostic != Some("true") {
        return false;
    }
    let literal_loopback = fixture.is_some_and(|value| {
        value
            .strip_prefix("http://127.0.0.1")
            .is_some_and(|suffix| {
                suffix.is_empty() || suffix.starts_with(':') || suffix.starts_with('/')
            })
    });
    let Some(endpoint) = fixture.and_then(|value| url::Url::parse(value).ok()) else {
        return false;
    };
    literal_loopback
        && endpoint.scheme() == "http"
        && endpoint.host_str() == Some("127.0.0.1")
        && endpoint.username().is_empty()
        && endpoint.password().is_none()
        && endpoint.query().is_none()
        && endpoint.fragment().is_none()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Snapshot {
    marker: &'static str,
    origin_order: [MutationOrigin; ORIGIN_COUNT],
    active_origins: [usize; ORIGIN_COUNT],
    events: VecDeque<MutationEvent>,
    invalidations: VecDeque<InvalidatedRead>,
}

impl Diagnostics {
    pub(super) fn active(&self) -> [usize; ORIGIN_COUNT] {
        self.active_origins
    }

    pub(super) fn begun(&self) -> [u64; ORIGIN_COUNT] {
        self.begun_origins
    }

    pub(super) fn mutation(
        &mut self,
        origin: MutationOrigin,
        begin: bool,
        generation: u64,
        active: usize,
    ) {
        let count = &mut self.active_origins[origin as usize];
        *count = if begin {
            count.saturating_add(1)
        } else {
            count.saturating_sub(1)
        };
        if begin {
            let count = &mut self.begun_origins[origin as usize];
            *count = count.wrapping_add(1);
        }
        if self.events.len() == EVENT_LIMIT {
            self.events.pop_front();
        }
        self.events.push_back(MutationEvent {
            generation,
            active,
            origin,
            phase: if begin { "begin" } else { "drop" },
            elapsed_micros: self.started.elapsed().as_micros().min(u64::MAX as u128) as u64,
        });
    }

    pub(super) fn invalidated(
        &mut self,
        attempt: usize,
        caller: &std::panic::Location<'_>,
        captured_generation: u64,
        captured_active_origins: [usize; ORIGIN_COUNT],
        captured_begun_origins: [u64; ORIGIN_COUNT],
        current_generation: u64,
        active: usize,
    ) {
        if self.failures.len() == FAILURE_LIMIT {
            self.failures.pop_front();
        }
        self.failures.push_back(InvalidatedRead {
            attempt,
            origin: ReadOrigin::caller(caller.file()),
            caller_line: caller.line(),
            captured_generation,
            current_generation,
            active,
            captured_active_origins,
            current_active_origins: self.active_origins,
            begun_since_capture: std::array::from_fn(|index| {
                self.begun_origins[index].wrapping_sub(captured_begun_origins[index])
            }),
            elapsed_micros: self.started.elapsed().as_micros().min(u64::MAX as u128) as u64,
        });
    }

    pub(super) fn snapshot(&self) -> Option<Snapshot> {
        self.enabled.then(|| Snapshot {
            marker: "TEMPORARY_PI_REFRESH_DIAGNOSTIC_V1",
            origin_order: ORIGINS,
            active_origins: self.active_origins,
            events: self.events.clone(),
            invalidations: self.failures.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temporary_refresh_diagnostic_requires_every_exact_synthetic_gate() {
        let fixture = Some("http://127.0.0.1:8080/native");
        assert!(enabled(fixture, Some("true"), Some("true"), Some("true")));
        for denied in [None, Some(""), Some("false"), Some("1"), Some("TRUE")] {
            assert!(!enabled(fixture, denied, Some("true"), Some("true")));
            assert!(!enabled(fixture, Some("true"), denied, Some("true")));
            assert!(!enabled(fixture, Some("true"), Some("true"), denied));
        }
        for denied in [
            None,
            Some("http://localhost:8080"),
            Some("http://127.1:8080"),
            Some("https://127.0.0.1"),
            Some("http://127.0.0.1.example.org"),
            Some("http://secret@127.0.0.1"),
            Some("http://127.0.0.1?secret"),
            Some("http://127.0.0.1#secret"),
        ] {
            assert!(!enabled(denied, Some("true"), Some("true"), Some("true")));
        }
    }

    #[test]
    fn temporary_refresh_diagnostic_is_bounded_and_keeps_only_closed_labels() {
        let mut diagnostics = Diagnostics {
            enabled: true,
            ..Default::default()
        };
        for generation in 0..1000 {
            diagnostics.mutation(
                MutationOrigin::caller("/private/secret-vault/customer-note.md"),
                true,
                generation,
                1,
            );
            diagnostics.mutation(MutationOrigin::Other, false, generation + 1, 0);
            diagnostics.invalidated(
                1,
                std::panic::Location::caller(),
                0,
                [0; ORIGIN_COUNT],
                [0; ORIGIN_COUNT],
                generation,
                0,
            );
        }
        let snapshot = diagnostics.snapshot().unwrap();
        assert_eq!(snapshot.events.len(), EVENT_LIMIT);
        assert_eq!(snapshot.invalidations.len(), FAILURE_LIMIT);
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(json.len() < 40000);
        assert!(!json.contains("private") && !json.contains("customer") && !json.contains(".rs"));
        assert!(json.contains("\"origin\":\"other\""));
        diagnostics.enabled = false;
        assert!(diagnostics.snapshot().is_none());
    }

    #[test]
    fn temporary_refresh_diagnostic_records_real_reconciliation_and_queued_writers() {
        use crate::services::note_timeline::{AllowedScope, VaultObservation};
        let vault = crate::test_support::TestVault::new("pi-refresh-writer-diagnostic");
        let saved = crate::test_support::save_and_finalize(
            &vault.state,
            "Unchanged source".into(),
            "Canonical unchanged evidence".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let path = std::path::PathBuf::from(saved.path.unwrap());
        let original = std::fs::read(&path).unwrap();
        let timeline = vault.state.note_timeline();
        timeline
            .runtime
            .current_content
            .state
            .lock()
            .unwrap()
            .diagnostics = Diagnostics {
            enabled: true,
            ..Default::default()
        };
        let access = timeline.current_content(AllowedScope::vault());
        let result = access.read_refreshable(|| {
            timeline.observe(VaultObservation::reconciled_state(path.clone(), 2, None))?;
            Ok(Vec::<crate::commands::TaskListGroup>::new())
        });
        assert_eq!(
            result.unwrap_err(),
            "Current notes changed during the read; retry the read"
        );
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let snapshot = timeline.temporary_refresh_diagnostic_snapshot().unwrap();
        assert_eq!(snapshot["invalidations"].as_array().unwrap().len(), 3);
        assert_eq!(snapshot["events"].as_array().unwrap().len(), 6);
        assert!(snapshot["events"]
            .as_array()
            .unwrap()
            .iter()
            .all(|event| event["origin"] == "reconcileCanonical"));
        for (index, failure) in snapshot["invalidations"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            assert_eq!(failure["attempt"], index + 1);
            assert_eq!(failure["active"], 0);
            assert_ne!(failure["capturedGeneration"], failure["currentGeneration"]);
            assert_eq!(
                failure["begunSinceCapture"][MutationOrigin::ReconcileCanonical as usize],
                1
            );
        }
        // A writer may already be active while waiting for the replay lock when
        // prepare_read captures its version; retain its closed origin as well.
        let mutation = timeline
            .runtime
            .begin_current_content_mutation_with_origin(MutationOrigin::WatcherCanonical)
            .unwrap();
        let version = timeline.runtime.current_content_version().unwrap();
        assert!(!timeline
            .runtime
            .current_content_is_current_for_attempt(version, 1, std::panic::Location::caller())
            .unwrap());
        let snapshot = timeline.temporary_refresh_diagnostic_snapshot().unwrap();
        let failure = snapshot["invalidations"]
            .as_array()
            .unwrap()
            .last()
            .unwrap();
        assert_eq!(
            failure["capturedActiveOrigins"][MutationOrigin::WatcherCanonical as usize],
            1
        );
        assert_eq!(
            failure["currentActiveOrigins"][MutationOrigin::WatcherCanonical as usize],
            1
        );
        drop(mutation);
        assert!(timeline
            .runtime
            .current_content_is_current(timeline.runtime.current_content_version().unwrap())
            .unwrap());
    }
}
