use super::*;
use std::sync::{atomic::AtomicUsize, mpsc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug)]
struct Item {
    note_id: String,
    path: String,
    body: String,
}
impl CurrentContentItem for Item {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_> {
        CurrentContentIdentity::Note {
            note_id: Some(&self.note_id),
            note_path: Some(&self.path),
        }
    }
}
fn projection(f: &Fixture) -> Vec<Item> {
    vec![Item {
        note_id: f.note.as_str().into(),
        path: f.path.to_string_lossy().into(),
        body: crate::note::parse_note(&fs::read_to_string(&f.path).unwrap())
            .body
            .to_string(),
    }]
}

fn queued_observations(expire_budget: bool) -> (Result<Vec<Item>, String>, usize, usize) {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.seal();
    let original = fs::read(&f.path).unwrap();
    let timeline = f.state.note_timeline();
    let reader = std::thread::current().id();
    let (request, requests) = mpsc::channel();
    let (blocked, blocking) = mpsc::channel();
    let blocking = Mutex::new(blocking);
    let remaining = AtomicUsize::new(3);
    let elapsed = Arc::new(AtomicU64::new(0));
    let clock = elapsed.clone();
    let start = Instant::now();
    timeline.runtime.set_settlement_clock(Arc::new(move || {
        start + Duration::from_secs(clock.load(Ordering::SeqCst))
    }));
    timeline
        .runtime
        .set_replay_lock_observer(Some(Arc::new(move |event| match event {
            runtime::ReplayLockEvent::Acquired
                if std::thread::current().id() == reader
                    && remaining
                        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                            left.checked_sub(1)
                        })
                        .is_ok() =>
            {
                request.send(()).unwrap();
                blocking
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap();
                // Advance only the private settlement clock. No sleep or mock
                // writer replaces the actual queued watcher observation.
                if expire_budget {
                    elapsed.fetch_add(1, Ordering::SeqCst);
                }
            }
            runtime::ReplayLockEvent::Contended if std::thread::current().id() != reader => {
                blocked.send(()).unwrap();
            }
            _ => {}
        })));
    struct Clear<'a>(&'a runtime::NoteTimelineRuntime);
    impl Drop for Clear<'_> {
        fn drop(&mut self) {
            self.0.set_replay_lock_observer(None);
        }
    }
    let mut queries = 0;
    let (result, observations) = std::thread::scope(|scope| {
        let clear = Clear(timeline.runtime);
        let writer = scope.spawn(|| {
            let mut observations = 0;
            for () in requests {
                timeline
                    .observe(VaultObservation::external_edit(f.path.clone(), 2, None))
                    .unwrap();
                observations += 1;
            }
            observations
        });
        let result = timeline
            .current_content(AllowedScope::vault())
            .read_refreshable(|| {
                queries += 1;
                Ok(projection(&f))
            });
        drop(clear);
        (result, writer.join().unwrap())
    });
    assert_eq!(fs::read(&f.path).unwrap(), original);
    (result, queries, observations)
}

#[test]
fn refreshable_preparation_waits_for_queued_watchers_without_spending_query_attempts() {
    let (result, queries, observations) = queued_observations(false);
    let items = result.expect("Preparation contention must not exhaust projection attempts");
    assert_eq!(observations, 3);
    assert_eq!(
        queries, 1,
        "No query may start from an already active version"
    );
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].body, "A");
}

#[test]
fn refreshable_preparation_does_not_reset_the_settlement_deadline() {
    let (result, queries, observations) = queued_observations(true);
    assert_eq!(
        result.unwrap_err(),
        "Current notes are still updating; retry the read"
    );
    assert_eq!(observations, 2);
    assert_eq!(
        queries, 0,
        "An expired preparation cannot deliver a projection"
    );
}

#[test]
fn refreshable_preparation_still_limits_actual_invalidated_queries_to_three() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.seal();
    let timeline = f.state.note_timeline();
    let access = timeline.current_content(AllowedScope::vault());
    let mut queries = 0;
    let result = access.read_refreshable(|| {
        queries += 1;
        let captured = projection(&f);
        f.save(&format!("Changed during query {queries}"));
        Ok(captured)
    });
    assert_eq!(
        result.unwrap_err(),
        "Current notes changed during the read; retry the read"
    );
    assert_eq!(queries, 3);
    let stable = access.read_refreshable(|| Ok(projection(&f))).unwrap();
    assert_eq!(stable[0].body, "Changed during query 3");
}
