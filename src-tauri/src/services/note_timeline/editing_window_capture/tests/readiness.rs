use super::*;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize},
    mpsc,
};
use std::time::Duration;

struct ReleaseOnDrop(Arc<AtomicBool>);
impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

fn within<T>(rx: &mpsc::Receiver<T>) -> T {
    rx.recv_timeout(Duration::from_secs(5))
        .expect("bounded readiness progress")
}
fn wait_until(done: impl Fn() -> bool) {
    let end = std::time::Instant::now() + Duration::from_secs(5);
    while !done() {
        assert!(
            std::time::Instant::now() < end,
            "bounded readiness progress"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn unrelated_background_verification_does_not_block_verified_save_or_unstarted_target() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let b = NoteIdentity::new("unrelated-b");
    let c = NoteIdentity::new("unstarted-c");
    let released = Arc::new(AtomicBool::new(false));
    let (started, rx) = mpsc::channel();
    let held = released.clone();
    let b_copy = b.clone();
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(move |note, stop| {
            if note == &b_copy {
                started.send(()).unwrap();
                while !held.load(Ordering::Acquire) && !stop.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
            Ok(())
        }));
    std::thread::scope(|scope| {
        let _release = ReleaseOnDrop(released.clone());
        scope.spawn(|| f.state.note_timeline().await_history_readiness(&b).unwrap());
        within(&rx);
        let (done, received) = mpsc::channel();
        let f = &f;
        scope.spawn(move || {
            f.save("save A while B remains blocked");
            f.state
                .note_timeline()
                .open_history_mode(f.note.clone())
                .revisions()
                .unwrap();
            f.state.note_timeline().await_history_readiness(&c).unwrap();
            done.send(()).unwrap();
        });
        within(&received);
        assert!(!released.load(Ordering::Acquire));
        released.store(true, Ordering::Release);
    });
}

#[test]
fn simultaneous_target_requests_share_one_verification_and_retry_unavailable() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let note = NoteIdentity::new("shared-target");
    let checks = Arc::new(AtomicUsize::new(0));
    let release = Arc::new(AtomicBool::new(false));
    let calls = checks.clone();
    let held = release.clone();
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(move |_, stop| {
            calls.fetch_add(1, Ordering::SeqCst);
            while !held.load(Ordering::Acquire) && !stop.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(2));
            }
            Ok(())
        }));
    std::thread::scope(|scope| {
        let _release = ReleaseOnDrop(release.clone());
        let one = scope.spawn(|| f.state.note_timeline().await_history_readiness(&note));
        wait_until(|| checks.load(Ordering::SeqCst) == 1);
        let two = scope.spawn(|| f.state.note_timeline().await_history_readiness(&note));
        release.store(true, Ordering::Release);
        one.join().unwrap().unwrap();
        two.join().unwrap().unwrap();
    });
    assert_eq!(checks.load(Ordering::SeqCst), 1);
    f.state
        .note_timeline()
        .runtime
        .invalidate_note_verification(&note)
        .unwrap();
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(|_, _| {
            Err(HistoryError::Unavailable("injected busy/I/O".into()))
        }));
    assert!(matches!(
        f.state.note_timeline().await_history_readiness(&note),
        Err(HistoryError::Unavailable(_))
    ));
    assert_eq!(
        f.state
            .note_timeline()
            .history_readiness(Some(&note))
            .unwrap()
            .state,
        HistoryReadinessState::Unavailable
    );
    f.save("unrelated ready save still admitted");
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(|_, _| Ok(())));
    assert_eq!(
        f.state
            .note_timeline()
            .await_history_readiness(&note)
            .unwrap()
            .state,
        HistoryReadinessState::Ready
    );
}

#[test]
fn replaced_verification_discards_old_success_and_corruption_and_diagnostic_results() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    for fail in [false, true] {
        let note = NoteIdentity::new(format!("replaced-{fail}"));
        let (tx, rx) = mpsc::channel();
        let release = Arc::new(AtomicBool::new(false));
        let held = release.clone();
        f.state
            .note_timeline()
            .runtime
            .set_verification_hook(Arc::new(move |_, _| {
                tx.send(()).unwrap();
                while !held.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(2));
                }
                if fail {
                    Err(HistoryError::Corrupt("obsolete failure".into()))
                } else {
                    Ok(())
                }
            }));
        std::thread::scope(|scope| {
            let _release = ReleaseOnDrop(release.clone());
            let old = scope.spawn(|| f.state.note_timeline().await_history_readiness(&note));
            within(&rx);
            f.state
                .note_timeline()
                .runtime
                .invalidate_note_verification(&note)
                .unwrap();
            release.store(true, Ordering::Release);
            assert!(matches!(old.join().unwrap(), Err(HistoryError::Stale(_))));
        });
        assert_eq!(
            f.state
                .note_timeline()
                .history_readiness(Some(&note))
                .unwrap()
                .state,
            HistoryReadinessState::TargetVerificationPending
        );
        f.state
            .note_timeline()
            .runtime
            .set_verification_hook(Arc::new(|_, _| Ok(())));
        f.state
            .note_timeline()
            .await_history_readiness(&note)
            .unwrap();
        f.save("replacement remains available");
    }
}

#[test]
fn later_corruption_blocks_global_new_admissions() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let note = NoteIdentity::new("late-corrupt");
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(|_, _| {
            Err(HistoryError::Corrupt("proven late corruption".into()))
        }));
    assert!(matches!(
        f.state.note_timeline().await_history_readiness(&note),
        Err(HistoryError::Corrupt(_))
    ));
    let before = fs::read_to_string(&f.path).unwrap();
    assert!(note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Window".into(),
        "blocked".into(),
        Some(f.path.to_string_lossy().into())
    )
    .is_err());
    assert_eq!(fs::read_to_string(&f.path).unwrap(), before);
}

#[test]
fn clean_close_cancels_verifier_without_needing_note_file_owner() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("pending endpoint must settle");
    let (tx, rx) = mpsc::channel();
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(move |_, stop| {
            tx.send(()).unwrap();
            while !stop.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(2));
            }
            Err(HistoryError::Unavailable("cancelled".into()))
        }));
    std::thread::scope(|scope| {
        let verification = scope.spawn(|| {
            f.state
                .note_timeline()
                .await_history_readiness(&NoteIdentity::new("blocked-close"))
        });
        within(&rx);
        f.state
            .note_timeline()
            .clean_close(f._notes.path())
            .unwrap();
        assert!(matches!(
            verification.join().unwrap(),
            Err(HistoryError::Unavailable(_))
        ));
    });
    assert!(f.state.note_timeline().is_cleanly_closed().unwrap());
}

#[test]
fn background_worker_checks_retained_notes_and_rechecks_after_clear() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let saved = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Background".into(),
        "retained B".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let b = NoteIdentity::new(saved.note_id.unwrap());
    f.state
        .note_timeline()
        .runtime
        .invalidate_note_verification(&b)
        .unwrap();
    let release = Arc::new(AtomicBool::new(false));
    let held = release.clone();
    let (tx, rx) = mpsc::channel();
    let target = b.clone();
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(move |note, stop| {
            if note == &target {
                tx.send(()).unwrap();
                while !held.load(Ordering::Acquire) && !stop.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
            Ok(())
        }));
    let _release = ReleaseOnDrop(release.clone());
    f.state.note_timeline().runtime.start_history_verification();
    within(&rx);
    f.save("ready A while real B worker is held");
    assert!(
        !f.state
            .note_timeline()
            .history_readiness(Some(&f.note))
            .unwrap()
            .background_complete
    );
    release.store(true, Ordering::Release);
    wait_until(|| {
        f.state
            .note_timeline()
            .history_readiness(Some(&f.note))
            .unwrap()
            .background_complete
    });
    release.store(false, Ordering::Release);
    f.state.note_timeline().clear_note_history(&b).unwrap();
    assert!(
        !f.state
            .note_timeline()
            .history_readiness(Some(&b))
            .unwrap()
            .background_complete
    );
    within(&rx);
    release.store(true, Ordering::Release);
    wait_until(|| {
        f.state
            .note_timeline()
            .history_readiness(Some(&b))
            .unwrap()
            .background_complete
    });
    assert_eq!(
        f.state
            .note_timeline()
            .history_readiness(Some(&b))
            .unwrap()
            .state,
        HistoryReadinessState::Ready
    );
}

#[test]
fn baseline_verification_waits_without_holding_the_canonical_file_owner() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    fs::write(
        f._notes.path().join("Background.md"),
        "---\ngneauxghts:\n  id: background-baseline\n  kind: note\n---\n\nB",
    )
    .unwrap();
    let release = Arc::new(AtomicBool::new(false));
    let held = release.clone();
    let (tx, rx) = mpsc::channel();
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(move |note, stop| {
            if note.as_str() == "background-baseline" {
                tx.send(()).unwrap();
                while !held.load(Ordering::Acquire) && !stop.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
            Ok(())
        }));
    std::thread::scope(|scope| {
        let _release = ReleaseOnDrop(release.clone());
        let initializer = scope.spawn(|| {
            f.state
                .note_timeline()
                .initialize_existing_notes(f._notes.path())
        });
        within(&rx);
        f.save("A remains writable during B baseline verification");
        release.store(true, Ordering::Release);
        assert_eq!(
            initializer.join().unwrap().unwrap().phase(),
            BaselineInitializationPhase::Complete
        );
    });
}

#[test]
fn clear_and_reset_discard_an_old_failed_verifier_and_old_health_result() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    for reset in [false, true] {
        f.state
            .note_timeline()
            .runtime
            .invalidate_note_verification(&f.note)
            .unwrap();
        let old_scope = f.state.note_timeline().runtime.diagnostic_scope_for_test();
        let release = Arc::new(AtomicBool::new(false));
        let held = release.clone();
        let first = Arc::new(AtomicBool::new(true));
        let target = f.note.clone();
        let (tx, rx) = mpsc::channel();
        f.state
            .note_timeline()
            .runtime
            .set_verification_hook(Arc::new(move |note, _| {
                if note == &target && first.swap(false, Ordering::SeqCst) {
                    tx.send(()).unwrap();
                    while !held.load(Ordering::Acquire) {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    return Err(HistoryError::Corrupt("old generation failure".into()));
                }
                Ok(())
            }));
        std::thread::scope(|scope| {
            let _release = ReleaseOnDrop(release.clone());
            let old = scope.spawn(|| f.state.note_timeline().await_history_readiness(&f.note));
            within(&rx);
            if reset {
                f.state
                    .note_timeline()
                    .reset_history(f._notes.path())
                    .unwrap();
            } else {
                f.state.note_timeline().clear_note_history(&f.note).unwrap();
            }
            release.store(true, Ordering::Release);
            assert!(matches!(old.join().unwrap(), Err(HistoryError::Stale(_))));
        });
        assert!(matches!(
            f.state
                .note_timeline()
                .runtime
                .apply_diagnostic_for_test(old_scope, true),
            Err(HistoryError::Stale(_))
        ));
        f.state
            .note_timeline()
            .await_history_readiness(&f.note)
            .unwrap();
        f.save("new history stays writable");
    }
    let old_success = f.state.note_timeline().runtime.diagnostic_scope_for_test();
    f.state
        .note_timeline()
        .runtime
        .with_history_result::<()>(|| Err(HistoryError::Corrupt("new corruption".into())))
        .unwrap_err();
    assert!(matches!(
        f.state
            .note_timeline()
            .runtime
            .apply_diagnostic_for_test(old_success, false),
        Err(HistoryError::Corrupt(_))
    ));
}

#[test]
fn corrupt_target_has_no_preparation_or_markdown_publication() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    history_store::replace_revision_source(
        &f.state.note_timeline().runtime.store,
        &f.note,
        "invalid-source",
    );
    let restarted = Fixture::state();
    let before = fs::read(&f.path).unwrap();
    let preparations =
        history_store::prepared_intent_count(&restarted.note_timeline().runtime.store, "prepared");
    assert!(note_persistence::persist_note_session_with_outcome(
        &restarted,
        "Window".into(),
        "must not publish".into(),
        Some(f.path.to_string_lossy().into())
    )
    .is_err());
    assert_eq!(fs::read(&f.path).unwrap(), before);
    assert_eq!(
        history_store::prepared_intent_count(&restarted.note_timeline().runtime.store, "prepared"),
        preparations
    );
    assert_eq!(
        restarted
            .note_timeline()
            .history_readiness(Some(&f.note))
            .unwrap()
            .state,
        HistoryReadinessState::Corrupt
    );
}

#[test]
fn verification_started_during_clear_waits_for_the_replacement_transaction() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    f.seal();
    history_store::replace_revision_source(
        &f.state.note_timeline().runtime.store,
        &f.note,
        "old-corrupt-source",
    );
    let release = Arc::new(AtomicBool::new(false));
    let held = release.clone();
    let (tx, rx) = mpsc::channel();
    f.state
        .note_timeline()
        .runtime
        .set_replacement_hook(Arc::new(move || {
            tx.send(()).unwrap();
            while !held.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(2));
            }
        }));
    let calls = Arc::new(AtomicUsize::new(0));
    let checked = calls.clone();
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(move |_, _| {
            checked.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }));
    std::thread::scope(|scope| {
        let _release = ReleaseOnDrop(release.clone());
        let clear = scope.spawn(|| f.state.note_timeline().clear_note_history(&f.note));
        within(&rx);
        let check = scope.spawn(|| {
            let _lease = f.state.note_timeline().runtime.begin_operation().unwrap();
            f.state.note_timeline().runtime.ensure_note_ready(&f.note)
        });
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        release.store(true, Ordering::Release);
        clear.join().unwrap().unwrap();
        check.join().unwrap().unwrap();
    });
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        f.state
            .note_timeline()
            .history_readiness(Some(&f.note))
            .unwrap()
            .state,
        HistoryReadinessState::Ready
    );
}

#[test]
fn purge_discards_old_failed_verification_without_poisoning_other_notes() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.state
        .note_timeline()
        .runtime
        .invalidate_note_verification(&f.note)
        .unwrap();
    let release = Arc::new(AtomicBool::new(false));
    let held = release.clone();
    let (tx, rx) = mpsc::channel();
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(move |_, _| {
            tx.send(()).unwrap();
            while !held.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(2));
            }
            Err(HistoryError::Corrupt("obsolete purged payload".into()))
        }));
    std::thread::scope(|scope| {
        let _release = ReleaseOnDrop(release.clone());
        let old = scope.spawn(|| f.state.note_timeline().await_history_readiness(&f.note));
        within(&rx);
        f.state
            .note_timeline()
            .lifecycle(NoteLifecycleOperation::purged(
                f.note.clone(),
                f.path.clone(),
                crate::time::current_time_millis().unwrap(),
            ))
            .unwrap();
        release.store(true, Ordering::Release);
        assert!(matches!(old.join().unwrap(), Err(HistoryError::Stale(_))));
    });
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(|_, _| Ok(())));
    note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Other".into(),
        "still admitted".into(),
        None,
    )
    .unwrap();
    assert!(!f.path.exists());
}

#[test]
fn background_enumeration_corruption_latches_global_admission() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    history_store::replace_history_store_with_malformed_file_for_test(
        &f.state.note_timeline().runtime.store,
    );
    f.state.note_timeline().runtime.start_history_verification();
    wait_until(|| {
        f.state
            .note_timeline()
            .history_readiness(Some(&f.note))
            .unwrap()
            .state
            == HistoryReadinessState::Corrupt
    });
    let before = fs::read(&f.path).unwrap();
    assert!(note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Window".into(),
        "blocked".into(),
        Some(f.path.to_string_lossy().into())
    )
    .is_err());
    assert_eq!(fs::read(&f.path).unwrap(), before);
}

#[test]
fn diagnostics_started_during_clear_or_reset_cannot_poison_replacement() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    for reset in [false, true] {
        let release = Arc::new(AtomicBool::new(false));
        let held = release.clone();
        let (tx, rx) = mpsc::channel();
        f.state
            .note_timeline()
            .runtime
            .set_replacement_hook(Arc::new(move || {
                tx.send(()).unwrap();
                while !held.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }));
        std::thread::scope(|scope| {
            let _release = ReleaseOnDrop(release.clone());
            let replacing = scope.spawn(|| {
                if reset {
                    f.state
                        .note_timeline()
                        .reset_history(f._notes.path())
                        .map(|_| ())
                } else {
                    f.state
                        .note_timeline()
                        .clear_note_history(&f.note)
                        .map(|_| ())
                }
            });
            within(&rx);
            assert!(matches!(
                f.state.note_timeline().history_health(),
                Err(HistoryError::Unavailable(_))
            ));
            assert!(matches!(
                f.state.note_timeline().note_history_health(&f.note),
                Err(HistoryError::Unavailable(_))
            ));
            release.store(true, Ordering::Release);
            replacing.join().unwrap().unwrap();
        });
        f.state
            .note_timeline()
            .runtime
            .set_replacement_hook(Arc::new(|| {}));
        assert_ne!(
            f.state.note_timeline().history_health().unwrap().state(),
            HistoryHealthState::Corrupt
        );
        f.save("replacement stays usable");
    }
}

#[test]
fn reset_and_purge_wake_completed_background_coverage_without_a_private_restart() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.state.note_timeline().runtime.start_history_verification();
    wait_until(|| {
        f.state
            .note_timeline()
            .history_readiness(None)
            .unwrap()
            .background_complete
    });
    f.state
        .note_timeline()
        .reset_history(f._notes.path())
        .unwrap();
    wait_until(|| {
        f.state
            .note_timeline()
            .history_readiness(Some(&f.note))
            .unwrap()
            .background_complete
    });
    assert_eq!(
        f.state
            .note_timeline()
            .history_readiness(Some(&f.note))
            .unwrap()
            .state,
        HistoryReadinessState::Ready
    );
    f.state
        .note_timeline()
        .lifecycle(NoteLifecycleOperation::purged(
            f.note.clone(),
            f.path.clone(),
            crate::time::current_time_millis().unwrap(),
        ))
        .unwrap();
    wait_until(|| {
        f.state
            .note_timeline()
            .history_readiness(None)
            .unwrap()
            .background_complete
    });
    assert!(!f.path.exists());
}

#[test]
fn excluded_corrupt_provenance_target_is_never_verified() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    history_store::replace_revision_source(
        &f.state.note_timeline().runtime.store,
        &f.note,
        "corrupt-excluded-source",
    );
    f.state
        .note_timeline()
        .runtime
        .invalidate_note_verification(&f.note)
        .unwrap();
    let excluded = HashSet::from([f.note.0.clone()]);
    let access = f
        .state
        .note_timeline()
        .current_content(AllowedScope::policy(Some(&excluded), &excluded));
    let checks = history_store::note_verification_count();
    assert!(access.provenance(&f.note).unwrap().is_none());
    assert_eq!(history_store::note_verification_count(), checks);
    assert_eq!(
        f.state
            .note_timeline()
            .history_readiness(Some(&f.note))
            .unwrap()
            .state,
        HistoryReadinessState::TargetVerificationPending
    );
}

#[test]
fn activity_verifies_only_candidates_consumed_by_its_page() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let mut notes = vec![f.note.clone()];
    for title in ["Second", "Third"] {
        let saved = note_persistence::persist_note_session_with_outcome(
            &f.state,
            title.into(),
            "current body".into(),
            None,
        )
        .unwrap()
        .unwrap();
        notes.push(NoteIdentity::new(saved.note_id.unwrap()));
    }
    notes.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    for note in &notes {
        f.state
            .note_timeline()
            .runtime
            .invalidate_note_verification(note)
            .unwrap();
    }
    let selected = notes[0].clone();
    let target = selected.clone();
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(move |note, _| {
            if note != &target {
                Err(HistoryError::Corrupt(
                    "unconsumed target must not be checked".into(),
                ))
            } else {
                Ok(())
            }
        }));
    let page = f
        .state
        .note_timeline()
        .current_content(AllowedScope::vault())
        .activity(0, u64::MAX, 0, 1)
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].note_id, selected.as_str());
    for note in &notes[1..] {
        assert_eq!(
            f.state
                .note_timeline()
                .history_readiness(Some(note))
                .unwrap()
                .state,
            HistoryReadinessState::TargetVerificationPending
        );
    }
}

#[test]
fn completed_replacement_wakes_a_worker_after_its_diagnostic_was_rejected() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.state
        .note_timeline()
        .runtime
        .invalidate_note_verification(&f.note)
        .unwrap();
    let release_check = Arc::new(AtomicBool::new(false));
    let held = release_check.clone();
    let target = f.note.clone();
    let (checking, check_rx) = mpsc::channel();
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(move |note, stop| {
            if note == &target {
                checking.send(()).unwrap();
                while !held.load(Ordering::Acquire) && !stop.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
            Ok(())
        }));
    let release_completion = Arc::new(AtomicBool::new(false));
    let held = release_completion.clone();
    let first = AtomicBool::new(true);
    let (completing, completion_rx) = mpsc::channel();
    f.state
        .note_timeline()
        .runtime
        .set_verification_completion_hook(Arc::new(move || {
            if first.swap(false, Ordering::SeqCst) {
                completing.send(()).unwrap();
                while !held.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
        }));
    let _release_check = ReleaseOnDrop(release_check.clone());
    let _release_completion = ReleaseOnDrop(release_completion.clone());
    f.state.note_timeline().runtime.start_history_verification();
    within(&check_rx);
    // This note was not part of the worker's initial enumeration. Its clear
    // overlaps the worker's structural phase without making it join that note.
    let saved = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Added".into(),
        "B".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let b = NoteIdentity::new(saved.note_id.unwrap());
    let release_clear = Arc::new(AtomicBool::new(false));
    let held = release_clear.clone();
    let (clearing, clear_rx) = mpsc::channel();
    f.state
        .note_timeline()
        .runtime
        .set_replacement_hook(Arc::new(move || {
            clearing.send(()).unwrap();
            while !held.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(2));
            }
        }));
    std::thread::scope(|scope| {
        let _release_clear = ReleaseOnDrop(release_clear.clone());
        let clear = scope.spawn(|| f.state.note_timeline().clear_note_history(&b));
        within(&clear_rx);
        release_check.store(true, Ordering::Release);
        within(&completion_rx); // diagnostic_scope rejected the active clear
        release_clear.store(true, Ordering::Release);
        clear.join().unwrap().unwrap(); // Drop saw the old worker still started
        assert!(
            !f.state
                .note_timeline()
                .history_readiness(None)
                .unwrap()
                .background_complete
        );
        release_completion.store(true, Ordering::Release);
    });
    wait_until(|| {
        f.state
            .note_timeline()
            .history_readiness(None)
            .unwrap()
            .background_complete
    });
    assert!(
        !f.state
            .note_timeline()
            .history_readiness(None)
            .unwrap()
            .background_unavailable
    );
}

#[test]
fn readiness_counts_follow_failed_checks_retries_and_replacements_without_spinning() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let runtime = &f.state.note_timeline().runtime;
    let initial = runtime.readiness(Some(&f.note)).unwrap();
    assert_eq!(initial.verified_notes, 1);
    assert_eq!(initial.total_notes, None);
    runtime.invalidate_note_verification(&f.note).unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let checked = calls.clone();
    runtime.set_verification_hook(Arc::new(move |_, _| {
        checked.fetch_add(1, Ordering::SeqCst);
        Err(HistoryError::Unavailable("retryable read failure".into()))
    }));
    runtime.start_history_verification();
    wait_until(|| runtime.readiness(None).unwrap().background_unavailable);
    for _ in 0..100 {
        let snapshot = runtime.readiness(Some(&f.note)).unwrap();
        assert_eq!(snapshot.verified_notes, 0);
        assert_eq!(snapshot.total_notes, Some(1));
        assert!(!snapshot.background_complete);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    runtime.set_verification_hook(Arc::new(|_, _| Ok(())));
    f.state
        .note_timeline()
        .await_history_readiness(&f.note)
        .unwrap();
    wait_until(|| runtime.readiness(None).unwrap().background_complete);
    assert_eq!(runtime.readiness(None).unwrap().verified_notes, 1);
    f.state
        .note_timeline()
        .reset_history(f._notes.path())
        .unwrap();
    wait_until(|| runtime.readiness(None).unwrap().background_complete);
    assert_eq!(runtime.readiness(None).unwrap().verified_notes, 1);
    assert_eq!(runtime.readiness(None).unwrap().total_notes, Some(1));
    f.state
        .note_timeline()
        .clean_close(f._notes.path())
        .unwrap();
    runtime.start_history_verification();
    let closed = runtime.readiness(Some(&f.note)).unwrap();
    assert_eq!(closed.state, HistoryReadinessState::Unavailable);
    assert!(!closed.background_complete);
}

#[test]
fn delayed_read_error_cannot_relatch_corruption_after_reset() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    for current_content in [false, true] {
        history_store::replace_revision_source(
            &f.state.note_timeline().runtime.store,
            &f.note,
            "old-corrupt-source",
        );
        let release = Arc::new(AtomicBool::new(false));
        let (failed, failed_rx) = mpsc::channel();
        std::thread::scope(|scope| {
            let _release = ReleaseOnDrop(release.clone());
            let held = release.clone();
            let f = &f;
            let old = scope.spawn(move || {
                let history = f.state.note_timeline().open_history_mode(f.note.clone());
                let operation = || {
                    // The target proof is already ready; this corruption comes
                    // from a later read. Pause after its inner tracking returns.
                    let result = history.page(None, 30);
                    assert!(matches!(result, Err(HistoryError::Corrupt(_))));
                    failed.send(()).unwrap();
                    while !held.load(Ordering::Acquire) {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    result
                };
                if current_content {
                    f.state
                        .note_timeline()
                        .current_content(AllowedScope::vault())
                        .with_integrity_tracking(operation)
                } else {
                    history.with_integrity_tracking(operation)
                }
            });
            within(&failed_rx);
            f.state
                .note_timeline()
                .reset_history(f._notes.path())
                .unwrap();
            f.state
                .note_timeline()
                .await_history_readiness(&f.note)
                .unwrap();
            release.store(true, Ordering::Release);
            assert!(matches!(old.join().unwrap(), Err(HistoryError::Stale(_))));
        });
        f.save("replacement remains writable after delayed read completion");
    }
}

#[test]
fn save_waiting_for_target_verification_leaves_ready_notes_writable() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let ready = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Ready".into(),
        "B".into(),
        None,
    )
    .unwrap()
    .unwrap();
    f.state
        .note_timeline()
        .runtime
        .invalidate_note_verification(&f.note)
        .unwrap();
    let released = Arc::new(AtomicBool::new(false));
    let held = released.clone();
    let target = f.note.clone();
    let (checking, rx) = mpsc::channel();
    f.state
        .note_timeline()
        .runtime
        .set_verification_hook(Arc::new(move |note, stop| {
            if note == &target {
                checking.send(()).unwrap();
                while !held.load(Ordering::Acquire) && !stop.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
            Ok(())
        }));
    std::thread::scope(|scope| {
        let _release = ReleaseOnDrop(released.clone());
        let saving = scope.spawn(|| f.save("A after verification"));
        within(&rx);
        let (done, received) = mpsc::channel();
        let ready_path = ready.path.clone();
        let state = &f.state;
        scope.spawn(move || {
            done.send(note_persistence::persist_note_session_with_outcome(
                state,
                "Ready".into(),
                "B while A waits".into(),
                ready_path,
            ))
            .unwrap();
        });
        let saved = within(&received).unwrap().unwrap();
        assert_eq!(saved.markdown, "B while A waits");
        assert!(!released.load(Ordering::Acquire));
        released.store(true, Ordering::Release);
        assert_eq!(saving.join().unwrap().markdown, "A after verification");
    });
}

#[test]
fn failed_rename_save_restores_the_old_path_and_leaves_the_requested_edit_unsaved() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let original = fs::read(&f.path).unwrap();
    crate::state::inject_note_publication_failure_once();
    let result = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "New title".into(),
        "New dirty text".into(),
        Some(f.path.to_string_lossy().into()),
    );
    assert!(
        result.is_err(),
        "a failed write must not yield a saved session"
    );
    assert_eq!(fs::read(&f.path).unwrap(), original);
    assert!(!f._notes.path().join("New title.md").exists());
    assert_eq!(
        history_store::prepared_intent_count(&f.state.note_timeline().runtime.store, "prepared"),
        0
    );
    let saved = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "New title".into(),
        "New dirty text".into(),
        Some(f.path.to_string_lossy().into()),
    )
    .unwrap()
    .unwrap();
    assert_eq!(saved.markdown, "New dirty text");
    assert_eq!(saved.note_id.as_deref(), Some(f.note.as_str()));
    assert!(!f.path.exists());
}

#[test]
fn save_replays_an_observation_retained_after_preflight_before_its_own_publication() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let (preflight, reached) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    *AFTER_SAVE_PREFLIGHT.lock().unwrap() = Some(Box::new(move || {
        preflight.send(()).unwrap();
        resume.recv_timeout(Duration::from_secs(5)).unwrap();
    }));
    std::thread::scope(|scope| {
        let saving = scope.spawn(|| f.save("C authored"));
        within(&reached);
        let observed = crate::note::replace_authored_content(
            &fs::read_to_string(&f.path).unwrap(),
            None,
            "B observed",
        )
        .unwrap();
        fs::write(&f.path, &observed).unwrap();
        let observation = VaultObservation::external_edit(f.path.clone(), 1_000_050, None)
            .with_canonical_markdown(observed);
        f.state
            .note_timeline()
            .runtime
            .with_observation_replay(|| {
                history_store::retain_observation(
                    &f.state.note_timeline().runtime.store,
                    &observation,
                )
            })
            .unwrap();
        release.send(()).unwrap();
        assert_eq!(saving.join().unwrap().markdown, "C authored");
    });
    f.seal();
    assert_eq!(
        f.retained()
            .into_iter()
            .map(|(_, body)| body)
            .collect::<Vec<_>>(),
        ["A", "B observed", "C authored"]
    );
}

#[test]
fn close_between_save_preflight_and_file_ownership_finishes_and_rejects_publication() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let before = fs::read(&f.path).unwrap();
    let (preflight, reached) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    *AFTER_SAVE_PREFLIGHT.lock().unwrap() = Some(Box::new(move || {
        preflight.send(()).unwrap();
        resume.recv_timeout(Duration::from_secs(5)).unwrap();
    }));
    std::thread::scope(|scope| {
        let saving = scope.spawn(|| {
            f.state.note_timeline().save_note(
                MutationSource::Editor,
                "Window",
                "Must stay dirty",
                Some(f.path.to_string_lossy().into()),
            )
        });
        within(&reached);
        f.state
            .note_timeline()
            .clean_close(f._notes.path())
            .unwrap();
        release.send(()).unwrap();
        assert!(saving.join().unwrap().is_err());
    });
    assert_eq!(fs::read(&f.path).unwrap(), before);
}

#[test]
fn body_only_save_enriches_from_properties_current_when_the_file_owner_is_acquired() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let (preflight, reached) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    *AFTER_SAVE_PREFLIGHT.lock().unwrap() = Some(Box::new(move || {
        preflight.send(()).unwrap();
        resume.recv_timeout(Duration::from_secs(5)).unwrap();
    }));
    std::thread::scope(|scope| {
        let saving = scope.spawn(|| f.save("Requested body"));
        within(&reached);
        crate::state::with_note_file_mutation(|| {
            let fresh = crate::note::replace_authored_content(
                &fs::read_to_string(&f.path).unwrap(),
                Some("project: newer\n"),
                "A",
            )
            .unwrap();
            fs::write(&f.path, fresh).map_err(|error| error.to_string())
        })
        .unwrap();
        release.send(()).unwrap();
        assert_eq!(saving.join().unwrap().markdown, "Requested body");
    });
    let canonical = fs::read_to_string(&f.path).unwrap();
    assert_eq!(
        crate::note::parse_note(&canonical)
            .frontmatter
            .raw_other
            .as_deref(),
        Some("project: newer")
    );
}

#[test]
fn indeterminate_rename_save_keeps_dirty_error_and_releases_its_intent_for_retry() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let source = f.path.clone();
    *AFTER_SAVE_RENAME.lock().unwrap() = Some(Box::new(move || {
        fs::create_dir(&source).unwrap(); // Prevent the old path from accepting rollback.
    }));
    crate::state::inject_note_publication_failure_once();
    let result = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Moved".into(),
        "Still dirty".into(),
        Some(f.path.to_string_lossy().into()),
    );
    assert!(result.is_err());
    assert_eq!(
        history_store::prepared_intent_count(&f.state.note_timeline().runtime.store, "prepared"),
        1
    );
    let moved = f._notes.path().join("Moved.md");
    assert_eq!(
        crate::note::parse_note(&fs::read_to_string(&moved).unwrap()).body,
        "A"
    );
    // Once the filesystem obstruction is repaired, retry in the same runtime.
    fs::remove_dir(&f.path).unwrap();
    fs::rename(&moved, &f.path).unwrap();
    let saved = f.save("Still dirty");
    assert_eq!(saved.markdown, "Still dirty");
    assert_eq!(
        history_store::prepared_intent_count(&f.state.note_timeline().runtime.store, "prepared"),
        0
    );
}
