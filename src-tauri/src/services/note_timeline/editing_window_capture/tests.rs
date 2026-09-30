use super::super::*;
use crate::{app::EventBus, commands::note_persistence, semantic::SemanticState};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

mod evidence_contracts;
mod prose_tasks;
mod query_inventory;
mod weekly_tasks;

struct Fixture {
    state: AppState,
    path: PathBuf,
    note: NoteIdentity,
    clock: Arc<AtomicU64>,
    _app_data: crate::test_support::TestDir,
    _notes: crate::test_support::TestDir,
}

impl Fixture {
    fn new() -> Self {
        let app_data = crate::test_support::TestDir::new("window-capture-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("window-capture-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = Self::state();
        let saved = note_persistence::persist_note_session_with_outcome(
            &state,
            "Window".into(),
            "A".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let clock = Arc::new(AtomicU64::new(1_000_000));
        let sampled = clock.clone();
        state
            .note_timeline()
            .runtime
            .set_window_admission_provider(Arc::new(move |pending| {
                let wall = sampled.load(Ordering::SeqCst);
                Ok(history_store::WindowAdmission {
                    window_id: pending.map(|w| w.window_id.clone()),
                    elapsed_millis: pending.map_or(0, |w| wall - w.evidence.first_wall_millis),
                    wall_millis: wall,
                    clock_discontinuity: false,
                })
            }));
        Self {
            state,
            path: PathBuf::from(saved.path.unwrap()),
            note: NoteIdentity::new(saved.note_id.unwrap()),
            clock,
            _app_data: app_data,
            _notes: notes,
        }
    }
    fn state() -> AppState {
        AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap()
    }
    fn save(&self, body: &str) -> crate::commands::NoteSession {
        note_persistence::persist_note_session_with_outcome(
            &self.state,
            "Window".into(),
            body.into(),
            Some(self.path.to_string_lossy().into()),
        )
        .unwrap()
        .unwrap()
    }
    fn retained(&self) -> Vec<(MutationSource, String)> {
        history_store::revisions(&self.state.note_timeline().runtime.store, &self.note)
            .unwrap()
            .into_iter()
            .map(|header| {
                let body = history_store::reconstruct(
                    &self.state.note_timeline().runtime.store,
                    &self.note,
                    &header.identity,
                )
                .unwrap()
                .body;
                (header.source, body)
            })
            .collect()
    }
    fn pending(&self) -> history_store::PendingWindow {
        history_store::pending_window(&self.state.note_timeline().runtime.store, &self.note)
            .unwrap()
            .unwrap()
    }
    fn seal(&self) {
        crate::state::with_note_file_mutation(|| {
            self.state
                .note_timeline()
                .finalize_editor_capture(&self.note)
        })
        .unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        crate::state::set_notes_root_override(None).unwrap();
    }
}

#[test]
fn editor_command_replaces_endpoint_keeps_anchor_and_bounds_terminal_receipts() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("A");
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
    for index in 0..80 {
        f.clock.fetch_add(1, Ordering::SeqCst);
        assert!(f.save(&format!("saved {index}")).commit_warning.is_none());
    }
    assert_eq!(
        f.retained(),
        vec![(MutationSource::NoteCreation, "A".into())]
    );
    let endpoint = f.pending();
    assert_eq!(
        endpoint.result_hash,
        history_store::authored_content_hash(&fs::read_to_string(&f.path).unwrap())
    );
    assert_eq!(
        history_store::current_content_hash(&history_store::Store::for_test(), &f.note).unwrap(),
        Some(endpoint.result_hash)
    );
    assert!(
        history_store::prepared_intent_count(&history_store::Store::for_test(), "finalized") <= 66
    );
    f.seal();
    assert_eq!(
        f.retained(),
        vec![
            (MutationSource::NoteCreation, "A".into()),
            (MutationSource::Editor, "saved 79".into())
        ]
    );
    // The combined delta reconstructs from A, never the overwritten saved 78.
}

#[test]
fn unchanged_metadata_and_self_observation_do_not_advance_window_evidence() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    let first = f.pending();
    f.clock.fetch_add(10, Ordering::SeqCst);
    f.save("B");
    f.state
        .note_timeline()
        .observe(VaultObservation::external_edit(f.path.clone(), 7, None))
        .unwrap();
    let same = f.pending();
    assert_eq!(first.window_id, same.window_id);
    assert_eq!(first.evidence, same.evidence);
    assert_eq!(first.endpoint_intent_id, same.endpoint_intent_id);
    f.save("A");
    f.seal();
    assert_eq!(
        f.retained(),
        vec![(MutationSource::NoteCreation, "A".into())]
    );
}

#[test]
fn publication_admission_after_preparation_crosses_deadline_before_markdown_write() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    let old = f.pending();
    // Preparation begins at 299999; the provider runs only once canonical and
    // baseline work has completed and samples the actual admission at 300000.
    f.clock.store(1_299_999, Ordering::SeqCst);
    let clock = f.clock.clone();
    f.state
        .note_timeline()
        .runtime
        .set_window_admission_provider(Arc::new(move |pending| {
            let (elapsed, wall) = if pending.is_some() {
                assert_eq!(clock.swap(1_300_000, Ordering::SeqCst), 1_299_999);
                (300_000, 1_300_000)
            } else {
                // Time spent finalizing the previous window cannot shorten this one.
                clock.store(1_300_100, Ordering::SeqCst);
                (0, 1_300_100)
            };
            Ok(history_store::WindowAdmission {
                window_id: pending.map(|w| w.window_id.clone()),
                elapsed_millis: elapsed,
                wall_millis: wall,
                clock_discontinuity: false,
            })
        }));
    crate::state::with_note_file_mutation(|| -> Result<(), String> {
        let prepared = f.state.note_timeline().prepare_revision_publication(
            MutationSource::Editor,
            &f.path,
            Some(&f.path),
            Some(&f.note),
            "C",
        )?;
        assert!(fs::read_to_string(&f.path).unwrap().ends_with("B"));
        assert_eq!(f.retained().last().unwrap().1, "B");
        let (canonical, intent) = prepared.into_parts();
        fs::write(&f.path, &canonical).unwrap();
        let outcome = f.state.note_timeline().mutate(NoteMutation::editor(
            intent,
            f.path.clone(),
            None,
            canonical,
        ));
        assert!(outcome.warning().is_none());
        Ok(())
    })
    .unwrap();
    let next = f.pending();
    assert_ne!(old.window_id, next.window_id);
    assert_eq!(next.evidence.first_wall_millis, 1_300_100);
    assert_eq!(next.evidence.elapsed_millis, 0);
}

#[test]
fn task_save_of_dirty_editor_content_retains_combined_action_source() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("Editor B");
    let result = note_persistence::persist_task_note_session_with_outcome(
        &f.state,
        "Window".into(),
        "Unsaved edit plus completed task".into(),
        Some(f.path.to_string_lossy().into()),
    )
    .unwrap()
    .unwrap();
    assert!(result.commit_warning.is_none());
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        f.retained(),
        vec![
            (MutationSource::NoteCreation, "A".into()),
            (MutationSource::Editor, "Editor B".into()),
            (
                MutationSource::TaskAction,
                "Unsaved edit plus completed task".into()
            )
        ]
    );
}

#[test]
fn prepublication_and_boundary_failures_preserve_successful_endpoint_and_bytes() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    let endpoint = f.pending();
    let before = fs::read_to_string(&f.path).unwrap();
    crate::state::inject_note_publication_failure_once();
    assert!(note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Window".into(),
        "C".into(),
        Some(f.path.to_string_lossy().into())
    )
    .is_err());
    assert_eq!(fs::read_to_string(&f.path).unwrap(), before);
    assert_eq!(f.pending().endpoint_intent_id, endpoint.endpoint_intent_id);
    history_store::inject_fault_once(history_store::FaultPoint::Finalize);
    assert!(note_persistence::persist_task_note_session_with_outcome(
        &f.state,
        "Window".into(),
        "action".into(),
        Some(f.path.to_string_lossy().into())
    )
    .is_err());
    assert_eq!(fs::read_to_string(&f.path).unwrap(), before);
    assert_eq!(f.pending().endpoint_intent_id, endpoint.endpoint_intent_id);
    assert_eq!(
        history_store::prepared_intent_count(&history_store::Store::for_test(), "prepared"),
        0
    );
}

#[test]
fn warned_publication_recovers_before_next_save_and_after_losing_runtime_state() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    inject_history_finalization_failure_once();
    assert!(f.save("B").commit_warning.is_some());
    assert_eq!(
        history_store::prepared_intent_count(&history_store::Store::for_test(), "prepared"),
        1
    );
    // Same-process admission retries only the released, completed operation.
    assert!(f.save("C").commit_warning.is_none());
    assert_eq!(
        history_store::prepared_intent_count(&history_store::Store::for_test(), "prepared"),
        0
    );
    inject_history_finalization_failure_once();
    assert!(f.save("D").commit_warning.is_some());
    let restarted = Fixture::state();
    restarted
        .note_timeline()
        .ensure_history_recovered()
        .unwrap();
    assert_eq!(
        history_store::prepared_intent_count(&history_store::Store::for_test(), "prepared"),
        0
    );
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
    restarted
        .note_timeline()
        .finalize_editor_capture(&f.note)
        .unwrap();
    assert_eq!(
        f.retained(),
        vec![
            (MutationSource::NoteCreation, "A".into()),
            (MutationSource::Editor, "D".into())
        ]
    );
}

#[test]
fn exact_external_observation_replay_seals_editor_before_each_observed_state() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    let b = fs::read_to_string(&f.path).unwrap();
    fs::write(&f.path, b.strip_suffix('B').unwrap().to_string() + "C").unwrap();
    history_store::inject_fault_once(history_store::FaultPoint::Finalize);
    assert!(f
        .state
        .note_timeline()
        .observe(VaultObservation::external_edit(
            f.path.clone(),
            1_000_100,
            None
        ))
        .is_err());
    assert_eq!(
        history_store::retained_observation_count(&history_store::Store::for_test()),
        1
    );
    fs::write(&f.path, b.strip_suffix('B').unwrap().to_string() + "D").unwrap();
    f.state
        .note_timeline()
        .observe(VaultObservation::external_edit(
            f.path.clone(),
            1_000_200,
            None,
        ))
        .unwrap();
    assert_eq!(
        history_store::retained_observation_count(&history_store::Store::for_test()),
        0
    );
    assert_eq!(
        f.retained(),
        vec![
            (MutationSource::NoteCreation, "A".into()),
            (MutationSource::Editor, "B".into()),
            (MutationSource::ExternalEdit, "C".into()),
            (MutationSource::ExternalEdit, "D".into())
        ]
    );
}

#[test]
fn first_editor_save_of_existing_note_keeps_a_stable_baseline_anchor() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let path = f.path.with_file_name("Existing.md");
    let note = NoteIdentity::new("existing-window-baseline");
    fs::write(
        &path,
        "---\ngneauxghts:\n  id: existing-window-baseline\n  kind: note\n---\n\nOriginal",
    )
    .unwrap();
    let saved = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Existing".into(),
        "New".into(),
        Some(path.to_string_lossy().into()),
    )
    .unwrap()
    .unwrap();
    assert!(saved.commit_warning.is_none());
    let revisions = history_store::revisions(&history_store::Store::for_test(), &note).unwrap();
    assert_eq!(revisions.len(), 1);
    assert_eq!(revisions[0].source, MutationSource::BaselineInitialization);
    assert_eq!(
        history_store::reconstruct(
            &history_store::Store::for_test(),
            &note,
            &revisions[0].identity
        )
        .unwrap()
        .body,
        "Original"
    );
    let pending = history_store::pending_window(&history_store::Store::for_test(), &note)
        .unwrap()
        .unwrap();
    assert_eq!(pending.anchor_revision_id, revisions[0].identity.0);
    f.state
        .note_timeline()
        .finalize_editor_capture(&note)
        .unwrap();
    let revisions = history_store::revisions(&history_store::Store::for_test(), &note).unwrap();
    assert_eq!(revisions.len(), 2);
    assert_eq!(
        history_store::reconstruct(
            &history_store::Store::for_test(),
            &note,
            &revisions[1].identity
        )
        .unwrap()
        .body,
        "New"
    );
}

#[test]
fn concurrent_current_content_read_cannot_recover_live_writer_or_report_anchor_as_current() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let (prepared, proceed) = std::sync::mpsc::channel();
    let (read_done, resumed) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        let f = &f;
        let writer = scope.spawn(move || {
            crate::state::with_note_file_mutation(|| -> Result<(), String> {
                let publication = f.state.note_timeline().prepare_revision_publication(
                    MutationSource::Editor,
                    &f.path,
                    Some(&f.path),
                    Some(&f.note),
                    "B",
                )?;
                let (canonical, intent) = publication.into_parts();
                fs::write(&f.path, &canonical).unwrap();
                prepared.send(()).unwrap();
                resumed.recv().unwrap();
                assert_eq!(
                    history_store::prepared_intent_count(
                        &history_store::Store::for_test(),
                        "prepared"
                    ),
                    1
                );
                let outcome = f.state.note_timeline().mutate(NoteMutation::editor(
                    intent,
                    f.path.clone(),
                    None,
                    canonical,
                ));
                assert!(outcome.warning().is_none());
                Ok(())
            })
        });
        proceed.recv().unwrap();
        let (delivered, result) = std::sync::mpsc::channel();
        scope.spawn(move || {
            delivered
                .send(
                    f.state
                        .note_timeline()
                        .current_content(AllowedScope::vault())
                        .provenance(&f.note),
                )
                .unwrap();
        });
        assert!(result
            .recv_timeout(std::time::Duration::from_millis(20))
            .is_err());
        assert_eq!(
            history_store::prepared_intent_count(&history_store::Store::for_test(), "prepared"),
            1
        );
        read_done.send(()).unwrap();
        writer.join().unwrap().unwrap();
        let current = result.recv().unwrap().unwrap().unwrap();
        assert_eq!(current.body[0].text, "B");
    });
    assert_eq!(
        f.retained(),
        vec![
            (MutationSource::NoteCreation, "A".into()),
            (MutationSource::Editor, "B".into())
        ]
    );
}

#[test]
fn concurrent_reads_and_next_save_serialize_released_capture_recovery() {
    let _guard = crate::test_support::lock_test_env();
    for _ in 0..10 {
        let f = Fixture::new();
        inject_history_finalization_failure_once();
        assert!(f.save("B").commit_warning.is_some());
        let start = std::sync::Barrier::new(4);
        std::thread::scope(|scope| {
            let reader = || {
                start.wait();
                // Recovery is the same owner used by History Mode and current-content
                // reads; both callers may reach the released receipt simultaneously.
                f.state.note_timeline().ensure_history_recovered()
            };
            let first = scope.spawn(reader);
            let second = scope.spawn(reader);
            let writer = scope.spawn(|| {
                start.wait();
                f.save("C")
            });
            start.wait();
            first.join().unwrap().unwrap();
            second.join().unwrap().unwrap();
            assert!(writer.join().unwrap().commit_warning.is_none());
        });
        assert_eq!(
            history_store::prepared_intent_count(&history_store::Store::for_test(), "prepared"),
            0
        );
        assert_eq!(
            f.pending().result_hash,
            history_store::authored_content_hash(&fs::read_to_string(&f.path).unwrap())
        );
        f.seal();
        assert_eq!(
            f.retained(),
            vec![
                (MutationSource::NoteCreation, "A".into()),
                (MutationSource::Editor, "C".into())
            ]
        );
    }
}

#[test]
fn proposal_and_restore_keep_distinct_sources_and_restore_checks_the_pending_hash() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let original = history_store::revisions(&history_store::Store::for_test(), &f.note).unwrap()[0]
        .identity
        .clone();
    f.save("B");
    crate::state::with_note_file_mutation(|| -> Result<(), String> {
        let prepared = f.state.note_timeline().prepare_revision_publication(
            MutationSource::AcceptedChatProposal,
            &f.path,
            Some(&f.path),
            Some(&f.note),
            "Proposal",
        )?;
        let (canonical, intent) = prepared.into_parts();
        fs::write(&f.path, &canonical).unwrap();
        assert!(f
            .state
            .note_timeline()
            .mutate(NoteMutation::accepted_chat_proposal(
                intent,
                f.path.clone(),
                None,
                canonical
            ))
            .warning()
            .is_none());
        Ok(())
    })
    .unwrap();
    f.save("C");
    let access = f.state.note_timeline().open_history_mode(f.note.clone());
    let stale = access.restore_preview(original.as_str()).unwrap();
    f.save("D");
    assert!(access
        .confirm_restore(original.as_str(), stale.current_authored_content_hash())
        .is_err());
    let preview = access.restore_preview(original.as_str()).unwrap();
    let restored = access
        .confirm_restore(original.as_str(), preview.current_authored_content_hash())
        .unwrap();
    assert!(restored.mutation.warning().is_none());
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        f.retained(),
        vec![
            (MutationSource::NoteCreation, "A".into()),
            (MutationSource::Editor, "B".into()),
            (MutationSource::AcceptedChatProposal, "Proposal".into()),
            (MutationSource::Editor, "D".into()),
            (MutationSource::VersionRestore, "A".into())
        ]
    );
    assert_eq!(
        history_store::restore_origin(
            &history_store::Store::for_test(),
            &history_store::revisions(&history_store::Store::for_test(), &f.note)
                .unwrap()
                .last()
                .unwrap()
                .identity
        )
        .unwrap(),
        Some(original)
    );
}

#[test]
fn predeadline_admission_keeps_its_window_and_time_when_markdown_completion_is_late() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    let window = f.pending().window_id;
    f.clock.store(1_299_999, Ordering::SeqCst);
    crate::state::with_note_file_mutation(|| -> Result<(), String> {
        let prepared = f.state.note_timeline().prepare_revision_publication(
            MutationSource::Editor,
            &f.path,
            Some(&f.path),
            Some(&f.note),
            "C",
        )?;
        let (canonical, intent) = prepared.into_parts();
        assert!(history_store::publication_revision_identity(
            &history_store::Store::for_test(),
            &intent
        )
        .is_err());
        f.clock.store(1_500_000, Ordering::SeqCst);
        fs::write(&f.path, &canonical).unwrap();
        assert!(f
            .state
            .note_timeline()
            .mutate(NoteMutation::editor(
                intent,
                f.path.clone(),
                None,
                canonical
            ))
            .warning()
            .is_none());
        Ok(())
    })
    .unwrap();
    assert_eq!(f.pending().window_id, window);
    assert_eq!(f.pending().evidence.last_wall_millis, 1_299_999);
    assert_eq!(f.pending().evidence.elapsed_millis, 299_999);
    assert_eq!(f.retained().len(), 1);
}

#[test]
fn window_capture_checks_exact_managed_identity_and_authored_hash_before_replacement() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    let endpoint = f.pending();
    for wrong_identity in [false, true] {
        // Restore authoritative successful bytes before preparing the next
        // intentionally invalid publication; observation policy is not involved.
        let canonical_b = crate::note::repair_managed_note_identity("B", f.note.as_str()).unwrap();
        fs::write(&f.path, canonical_b).unwrap();
        crate::state::with_note_file_mutation(|| -> Result<(), String> {
            let prepared = f.state.note_timeline().prepare_revision_publication(
                MutationSource::Editor,
                &f.path,
                Some(&f.path),
                Some(&f.note),
                "C",
            )?;
            let (canonical, intent) = prepared.into_parts();
            let invalid = if wrong_identity {
                crate::note::repair_managed_note_identity(&canonical, "different-note").unwrap()
            } else {
                canonical.strip_suffix('C').unwrap().to_string() + "different authored state"
            };
            fs::write(&f.path, &invalid).unwrap();
            assert!(f
                .state
                .note_timeline()
                .mutate(NoteMutation::editor(
                    intent,
                    f.path.clone(),
                    None,
                    canonical
                ))
                .warning()
                .is_some());
            Ok(())
        })
        .unwrap();
        assert_eq!(f.pending().endpoint_intent_id, endpoint.endpoint_intent_id);
        assert_eq!(f.pending().result_hash, endpoint.result_hash);
    }
}

struct ContinuousTestClock {
    elapsed: AtomicU64,
    wall: AtomicU64,
}
impl runtime::WindowClock for ContinuousTestClock {
    fn sample(&self) -> Result<runtime::ClockSample, String> {
        Ok(runtime::ClockSample {
            continuous_millis: self.elapsed.load(Ordering::SeqCst),
            wall_millis: self.wall.load(Ordering::SeqCst),
        })
    }
}
impl Fixture {
    fn continuous(&self) -> Arc<ContinuousTestClock> {
        let clock = Arc::new(ContinuousTestClock {
            elapsed: AtomicU64::new(0),
            wall: AtomicU64::new(1_000_000),
        });
        self.state
            .note_timeline()
            .runtime
            .set_window_clock(clock.clone());
        clock
    }
    fn tick(&self) -> Result<(), HistoryError> {
        self.state.note_timeline().runtime.poll_window_deadlines()
    }
}
#[test]
fn continuous_deadline_ignores_wall_jumps_and_includes_suspension_without_another_save() {
    let _guard = crate::test_support::lock_test_env();
    for wall in [20, 9_000_000] {
        let f = Fixture::new();
        let clock = f.continuous();
        f.save("B");
        clock.elapsed.store(299_999, Ordering::SeqCst);
        clock.wall.store(wall, Ordering::SeqCst);
        f.tick().unwrap();
        assert_eq!(f.retained().len(), 1);
        // The continuous clock advances during suspension even without timer work.
        clock.elapsed.store(300_000, Ordering::SeqCst);
        f.tick().unwrap();
        assert_eq!(f.retained().last().unwrap().1, "B");
        assert!(
            history_store::pending_window(&history_store::Store::for_test(), &f.note)
                .unwrap()
                .is_none()
        );
        let revision = history_store::revisions(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .last()
            .unwrap()
            .identity
            .clone();
        assert!(
            history_store::editing_window_evidence(&history_store::Store::for_test(), &revision)
                .unwrap()
                .unwrap()
                .clock_discontinuity
        );
        f.tick().unwrap();
        assert_eq!(f.retained().len(), 2);
    }
}
#[test]
fn regressed_continuous_clock_blocks_publication_without_replacing_successful_endpoint() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let clock = f.continuous();
    clock.elapsed.store(1_000, Ordering::SeqCst);
    f.save("B");
    let endpoint = f.pending();
    let canonical = fs::read_to_string(&f.path).unwrap();

    clock.elapsed.store(999, Ordering::SeqCst);
    assert!(note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Window".into(),
        "C".into(),
        Some(f.path.to_string_lossy().into()),
    )
    .is_err());
    assert_eq!(fs::read_to_string(&f.path).unwrap(), canonical);
    assert_eq!(f.pending().endpoint_intent_id, endpoint.endpoint_intent_id);
    assert_eq!(f.pending().evidence, endpoint.evidence);
    assert_eq!(
        f.retained(),
        vec![(MutationSource::NoteCreation, "A".into())]
    );

    clock.elapsed.store(1_001, Ordering::SeqCst);
    clock.wall.store(1_000_001, Ordering::SeqCst);
    assert!(f.save("C").commit_warning.is_none());
    f.seal();
    assert_eq!(f.retained().last().unwrap().1, "C");
    assert_eq!(f.retained().len(), 2);
}

#[test]
fn continuous_typing_has_fixed_deadlines_and_new_admission_starts_at_boundary() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let clock = f.continuous();
    f.save("B");
    clock.elapsed.store(299_999, Ordering::SeqCst);
    clock.wall.store(1_299_999, Ordering::SeqCst);
    f.save("C");
    assert_eq!(f.pending().evidence.elapsed_millis, 299_999);
    clock.elapsed.store(300_000, Ordering::SeqCst);
    clock.wall.store(1_300_000, Ordering::SeqCst);
    f.save("D");
    assert_eq!(f.retained().last().unwrap().1, "C");
    assert_eq!(f.pending().evidence.elapsed_millis, 0);
    clock.elapsed.store(600_000, Ordering::SeqCst);
    clock.wall.store(1_600_000, Ordering::SeqCst);
    f.tick().unwrap();
    assert_eq!(f.retained().last().unwrap().1, "D");
    assert_eq!(f.retained().len(), 3);
}
#[test]
fn deadline_failure_is_retryable_and_blocks_overdue_admission() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let clock = f.continuous();
    f.save("B");
    clock.elapsed.store(300_000, Ordering::SeqCst);
    clock.wall.store(1_300_000, Ordering::SeqCst);
    history_store::inject_fault_once(history_store::FaultPoint::Finalize);
    assert!(f.tick().is_err());
    assert_eq!(f.retained().len(), 1);
    assert!(fs::read_to_string(&f.path).unwrap().ends_with('B'));
    history_store::inject_fault_once(history_store::FaultPoint::Finalize);
    assert!(note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Window".into(),
        "C".into(),
        Some(f.path.to_string_lossy().into())
    )
    .is_err());
    f.tick().unwrap();
    f.tick().unwrap();
    assert_eq!(f.retained().len(), 2);
}
#[test]
fn deadline_waits_for_predeadline_publication_and_seals_its_late_success() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let clock = f.continuous();
    f.save("B");
    clock.elapsed.store(299_999, Ordering::SeqCst);
    clock.wall.store(1_299_999, Ordering::SeqCst);
    let (ready, wait_ready) = std::sync::mpsc::channel();
    let (finish, wait_finish) = std::sync::mpsc::channel();
    let (done, wait_done) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        let f = &f;
        scope.spawn(move || {
            crate::state::with_note_file_mutation(|| -> Result<(), String> {
                let prepared = f.state.note_timeline().prepare_revision_publication(
                    MutationSource::Editor,
                    &f.path,
                    Some(&f.path),
                    Some(&f.note),
                    "C",
                )?;
                ready.send(()).unwrap();
                wait_finish.recv().unwrap();
                let (canonical, intent) = prepared.into_parts();
                fs::write(&f.path, &canonical).unwrap();
                assert!(f
                    .state
                    .note_timeline()
                    .mutate(NoteMutation::editor(
                        intent,
                        f.path.clone(),
                        None,
                        canonical
                    ))
                    .warning()
                    .is_none());
                Ok(())
            })
            .unwrap()
        });
        wait_ready.recv().unwrap();
        clock.elapsed.store(300_000, Ordering::SeqCst);
        scope.spawn(|| {
            done.send(f.tick()).unwrap();
        });
        assert!(wait_done
            .recv_timeout(std::time::Duration::from_millis(20))
            .is_err());
        finish.send(()).unwrap();
        wait_done.recv().unwrap().unwrap();
    });
    assert_eq!(f.retained().last().unwrap().1, "C");
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
}
#[test]
fn restart_finalizes_successful_endpoint_once_before_newer_external_observation() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    let b = fs::read_to_string(&f.path).unwrap();
    fs::write(&f.path, b.strip_suffix('B').unwrap().to_string() + "C").unwrap();
    let restarted = Fixture::state();
    restarted
        .note_timeline()
        .observe(VaultObservation::external_edit(
            f.path.clone(),
            1_000_100,
            None,
        ))
        .unwrap();
    restarted.note_timeline().history_health().unwrap();
    restarted.note_timeline().history_health().unwrap();
    assert_eq!(
        f.retained()
            .iter()
            .map(|x| x.1.as_str())
            .collect::<Vec<_>>(),
        vec!["A", "B", "C"]
    );
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
}
#[test]
fn missing_and_path_reuse_finalize_durable_endpoint_without_reading_replacement() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    fs::remove_file(&f.path).unwrap();
    // Delayed missing notification arrives after an unrelated file reused the path.
    fs::write(&f.path, "replacement prose").unwrap();
    f.state
        .note_timeline()
        .observe(VaultObservation::missing(f.path.clone(), 1_000_100))
        .unwrap();
    assert_eq!(f.retained().last().unwrap().1, "B");
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
    assert_eq!(fs::read_to_string(&f.path).unwrap(), "replacement prose");
}
#[test]
fn target_boundary_seals_only_inspected_note_and_failed_close_never_claims_portability() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.continuous();
    f.save("B");
    let other = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Other".into(),
        "X".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let other_id = NoteIdentity::new(other.note_id.unwrap());
    note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Other".into(),
        "Y".into(),
        other.path,
    )
    .unwrap();
    f.state
        .note_timeline()
        .finalize_editing_window(&f.note)
        .unwrap();
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &other_id)
            .unwrap()
            .is_some()
    );
    history_store::inject_fault_once(history_store::FaultPoint::Finalize);
    assert!(f
        .state
        .note_timeline()
        .clean_close(f._notes.path())
        .is_err());
    assert!(!f.state.note_timeline().is_cleanly_closed().unwrap());
    f.state
        .note_timeline()
        .clean_close(f._notes.path())
        .unwrap();
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &other_id)
            .unwrap()
            .is_none()
    );
    assert!(f.state.note_timeline().is_cleanly_closed().unwrap());
}
#[test]
fn note_clear_vault_clear_purge_and_reset_leave_no_deadline_work_to_resurrect() {
    let _guard = crate::test_support::lock_test_env();
    for deletion in ["note", "vault", "purge", "reset"] {
        let f = Fixture::new();
        let clock = f.continuous();
        f.save("B");
        match deletion {
            "note" => {
                f.state.note_timeline().clear_note_history(&f.note).unwrap();
            }
            "vault" => {
                f.state
                    .note_timeline()
                    .clear_vault_history(f._notes.path())
                    .unwrap();
            }
            "purge" => {
                f.state
                    .note_timeline()
                    .lifecycle(NoteLifecycleOperation::purged(
                        f.note.clone(),
                        f.path.clone(),
                        1_000_100,
                    ))
                    .unwrap();
            }
            _ => {
                f.state
                    .note_timeline()
                    .reset_history(f._notes.path())
                    .unwrap();
            }
        }
        assert!(
            history_store::pending_window(&history_store::Store::for_test(), &f.note)
                .unwrap()
                .is_none()
        );
        let before = f.retained();
        clock.elapsed.store(600_000, Ordering::SeqCst);
        f.tick().unwrap();
        assert_eq!(f.retained(), before);
        if deletion != "purge" {
            f.save("C");
            clock.elapsed.store(900_000, Ordering::SeqCst);
            f.tick().unwrap();
            assert_eq!(f.retained().last().unwrap().1, "C");
        }
    }
}

#[test]
fn idle_deadline_poll_preserves_read_generation_and_failed_note_does_not_starve_another() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let clock = f.continuous();
    let version = f
        .state
        .note_timeline()
        .runtime
        .current_content_version()
        .unwrap();
    for _ in 0..5 {
        f.tick().unwrap();
    }
    assert!(f
        .state
        .note_timeline()
        .runtime
        .current_content_is_current(version)
        .unwrap());
    f.save("B");
    let version = f
        .state
        .note_timeline()
        .runtime
        .current_content_version()
        .unwrap();
    f.tick().unwrap();
    assert!(f
        .state
        .note_timeline()
        .runtime
        .current_content_is_current(version)
        .unwrap());
    let other = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Other".into(),
        "X".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let other_id = NoteIdentity::new(other.note_id.unwrap());
    note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Other".into(),
        "Y".into(),
        other.path,
    )
    .unwrap();
    clock.elapsed.store(300_000, Ordering::SeqCst);
    history_store::inject_fault_once(history_store::FaultPoint::Finalize);
    assert!(f.tick().is_err());
    assert_eq!(
        usize::from(
            history_store::pending_window(&history_store::Store::for_test(), &f.note)
                .unwrap()
                .is_some()
        ) + usize::from(
            history_store::pending_window(&history_store::Store::for_test(), &other_id)
                .unwrap()
                .is_some()
        ),
        1
    );
    f.tick().unwrap();
    assert!(
        history_store::pending_windows(&history_store::Store::for_test())
            .unwrap()
            .is_empty()
    );
}
#[test]
fn scheduler_runs_without_saves_and_releases_its_runtime_after_owner_drop() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let clock = f.continuous();
    f.save("B");
    let probe = f.state.note_timeline().runtime.scheduler_lifetime_probe();
    f.state.note_timeline().runtime.start_window_scheduler();
    clock.elapsed.store(300_000, Ordering::SeqCst);
    let limit = std::time::Instant::now() + std::time::Duration::from_secs(2);
    while history_store::pending_window(&history_store::Store::for_test(), &f.note)
        .unwrap()
        .is_some()
    {
        assert!(
            std::time::Instant::now() < limit,
            "scheduler did not seal due window"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(f.retained().last().unwrap().1, "B");
    drop(f);
    while probe() {
        assert!(
            std::time::Instant::now() < limit,
            "scheduler retained dropped runtime"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}
#[test]
fn clean_close_waits_for_active_save_then_finalizes_and_old_runtime_is_inert_after_vault_switch() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let clock = f.continuous();
    f.save("B");
    let (ready, wait_ready) = std::sync::mpsc::channel();
    let (finish, wait_finish) = std::sync::mpsc::channel();
    let (closed, wait_closed) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        let f = &f;
        scope.spawn(move || {
            crate::state::with_note_file_mutation(|| -> Result<(), String> {
                let publication = f.state.note_timeline().prepare_revision_publication(
                    MutationSource::Editor,
                    &f.path,
                    Some(&f.path),
                    Some(&f.note),
                    "C",
                )?;
                ready.send(()).unwrap();
                wait_finish.recv().unwrap();
                let (canonical, intent) = publication.into_parts();
                fs::write(&f.path, &canonical).unwrap();
                assert!(f
                    .state
                    .note_timeline()
                    .mutate(NoteMutation::editor(
                        intent,
                        f.path.clone(),
                        None,
                        canonical
                    ))
                    .warning()
                    .is_none());
                Ok(())
            })
            .unwrap()
        });
        wait_ready.recv().unwrap();
        scope.spawn(|| {
            closed
                .send(f.state.note_timeline().clean_close(f._notes.path()))
                .unwrap()
        });
        assert!(wait_closed
            .recv_timeout(std::time::Duration::from_millis(20))
            .is_err());
        finish.send(()).unwrap();
        wait_closed.recv().unwrap().unwrap();
    });
    assert_eq!(f.retained().last().unwrap().1, "C");
    let next = crate::test_support::TestDir::new("window-next-vault");
    crate::state::set_notes_root_override(Some(next.path().to_path_buf())).unwrap();
    let state = Fixture::state();
    let saved = note_persistence::persist_note_session_with_outcome(
        &state,
        "Next".into(),
        "new vault".into(),
        None,
    )
    .unwrap()
    .unwrap();
    clock.elapsed.store(600_000, Ordering::SeqCst);
    f.tick().unwrap();
    assert_eq!(
        history_store::revisions(
            &history_store::Store::for_test(),
            &NoteIdentity::new(saved.note_id.unwrap())
        )
        .unwrap()
        .len(),
        1
    );
    crate::state::set_notes_root_override(Some(f._notes.path().to_path_buf())).unwrap();
}

#[test]
fn rename_and_forget_seal_editor_endpoint_before_the_lifecycle_event() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    let renamed = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Renamed".into(),
        "B".into(),
        Some(f.path.to_string_lossy().into()),
    )
    .unwrap()
    .unwrap();
    assert!(renamed.commit_warning.is_none());
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
    assert_eq!(f.retained().last().unwrap().1, "B");
    let path = PathBuf::from(renamed.path.unwrap());
    note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Renamed".into(),
        "C".into(),
        Some(path.to_string_lossy().into()),
    )
    .unwrap();
    history_store::inject_fault_once(history_store::FaultPoint::Finalize);
    assert!(f.state.note_timeline().forget_note(&path, 7).is_err());
    assert!(path.exists());
    assert!(crate::state::read_unpruned_state(f._notes.path())
        .unwrap()
        .forgotten_notes
        .is_empty());
    f.state.note_timeline().forget_note(&path, 7).unwrap();
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
    assert_eq!(f.retained().last().unwrap().1, "C");
    assert!(
        history_store::lifecycle_events(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .iter()
            .any(|event| event.kind() == LifecycleEventKind::Forgotten)
    );
}

#[test]
fn startup_clear_disposes_only_its_scope_without_finalizing_pending_prose() {
    let _guard = crate::test_support::lock_test_env();
    for vault_clear in [false, true] {
        let f = Fixture::new();
        f.save("B");
        let restarted = Fixture::state();
        // A finalization attempt would fail before deletion. Disposal must not
        // call seal at all, including through the mandatory startup recovery.
        history_store::inject_fault_once(history_store::FaultPoint::Finalize);
        if vault_clear {
            restarted
                .note_timeline()
                .clear_vault_history(f._notes.path())
                .unwrap();
        } else {
            restarted
                .note_timeline()
                .clear_note_history(&f.note)
                .unwrap();
        }
        assert!(
            history_store::pending_windows(&history_store::Store::for_test())
                .unwrap()
                .is_empty()
        );
        assert_eq!(f.retained().len(), 1);
        assert_eq!(f.retained()[0].1, "B");
        // The next publication still consumes the armed finalization fault:
        // startup clear did not append a window and then hide its revision.
        assert!(f.save("C").commit_warning.is_some());
        f.state
            .note_timeline()
            .finalize_editing_window(&f.note)
            .unwrap();
    }
}
#[test]
fn startup_note_clear_finalizes_unrelated_surviving_windows() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    let other = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Other".into(),
        "X".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let other_id = NoteIdentity::new(other.note_id.unwrap());
    note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Other".into(),
        "Y".into(),
        other.path,
    )
    .unwrap();
    let restarted = Fixture::state();
    restarted
        .note_timeline()
        .clear_note_history(&f.note)
        .unwrap();
    assert!(
        history_store::pending_windows(&history_store::Store::for_test())
            .unwrap()
            .is_empty()
    );
    assert_eq!(f.retained().len(), 1);
    assert_eq!(
        history_store::revisions(&history_store::Store::for_test(), &other_id)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn editing_window_time_contract_preserves_action_points_and_half_open_overlap() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../test-fixtures/contracts/timeline-time-evidence.json"
    ))
    .unwrap();
    let evidence: Vec<RevisionTimeEvidence> =
        serde_json::from_value(fixture["evidence"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(&evidence).unwrap(),
        fixture["evidence"]
    );
    for query in fixture["queries"].as_array().unwrap() {
        let start = query["start"].as_u64().unwrap();
        let end = query["end"].as_u64().unwrap();
        let matches: Vec<_> = evidence.iter().map(|e| e.overlaps(start, end)).collect();
        assert_eq!(serde_json::to_value(matches).unwrap(), query["matches"]);
    }
}

#[test]
fn editing_window_explicit_provenance_seals_only_target_and_keeps_net_lineage() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let timeline = f.state.note_timeline();
    let access = timeline.current_content(AllowedScope::vault());
    let baseline = access.provenance(&f.note).unwrap().unwrap();
    let original = baseline.body[0].ranges[0].provenance.clone();
    f.save("A discarded secret");
    f.clock.fetch_add(100, Ordering::SeqCst);
    f.save("A endpoint");
    let pending_id = f.pending().window_id;
    let current = access.provenance(&f.note).unwrap().unwrap();
    let citations: Vec<_> = access
        .activity(0, u64::MAX, 0, 20)
        .unwrap()
        .items
        .into_iter()
        .flat_map(|item| item.citations)
        .collect();
    assert_eq!(current.body[0].text, "A endpoint");
    assert_eq!(current.body[0].ranges[0].provenance, original);
    let interval = RevisionTimeEvidence::EditingWindow {
        version: 1,
        first_wall_millis: 1_000_000,
        last_wall_millis: 1_000_100,
        min_wall_millis: 1_000_000,
        max_wall_millis: 1_000_100,
        clock_discontinuity: false,
    };
    assert!(current.body[0].ranges.iter().any(|r| r
        .provenance
        .introduced_at
        .as_ref()
        .is_some_and(|e| e.time_evidence == Some(interval))));
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
    assert_eq!(f.retained().len(), 2);
    let json = serde_json::to_string(&(current, &citations)).unwrap();
    assert!(!json.contains("discarded secret"));
    assert!(!json.contains(&pending_id));
    assert!(citations.iter().any(|c| c.time_evidence == Some(interval)));
    // Existing citation identity, text, and interval remain immutable while a
    // later window is pending; delivery must not seal that newer work.
    let durable = serde_json::to_string(&citations).unwrap();
    f.clock.fetch_add(100, Ordering::SeqCst);
    f.save("A endpoint later");
    let later = f.pending().window_id;
    let delivered = access.current_citations(&citations).unwrap();
    assert_eq!(serde_json::to_string(&delivered).unwrap(), durable);
    assert_eq!(f.pending().window_id, later);
    let mut tampered = citations.clone();
    for c in &mut tampered {
        c.time_evidence = Some(RevisionTimeEvidence::Committed {
            committed_at_millis: c.at_millis,
        });
    }
    let delivered = access.current_citations(&tampered).unwrap();
    assert!(delivered
        .iter()
        .all(|c| c.time_evidence.unwrap().window().is_none()));
    assert!(delivered.len() < citations.len());
    // Restart seals only the later window; the earlier citation still resolves.
    drop(access);
    drop(timeline);
    let restarted = Fixture::state();
    restarted
        .reconcile_full_vault_scan_observing(f._notes.path(), |_, _| Ok(()))
        .unwrap();
    let restart_timeline = restarted.note_timeline();
    let delivered = restart_timeline
        .current_content(AllowedScope::vault())
        .current_citations(&citations)
        .unwrap();
    assert_eq!(serde_json::to_string(&delivered).unwrap(), durable);
    assert_eq!(f.retained().len(), 3);
}

#[test]
fn editing_window_noop_does_not_invent_retyping_or_replace_citations() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let timeline = f.state.note_timeline();
    let access = timeline.current_content(AllowedScope::vault());
    let before = access.provenance(&f.note).unwrap().unwrap();
    let citations: Vec<_> = access
        .activity(0, u64::MAX, 0, 20)
        .unwrap()
        .items
        .into_iter()
        .flat_map(|item| item.citations)
        .collect();
    f.save("deleted and retyped");
    f.clock.fetch_add(10, Ordering::SeqCst);
    f.save("A");
    let after = access.provenance(&f.note).unwrap().unwrap();
    let after_citations: Vec<_> = access
        .activity(0, u64::MAX, 0, 20)
        .unwrap()
        .items
        .into_iter()
        .flat_map(|item| item.citations)
        .collect();
    assert_eq!(before, after);
    assert_eq!(
        serde_json::to_value(citations).unwrap(),
        serde_json::to_value(after_citations).unwrap()
    );
    assert_eq!(f.retained().len(), 1);
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
}

#[test]
fn editing_window_excluded_and_uncaptured_targets_never_seal_on_evidence_reads() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("pending private");
    let window = f.pending().window_id;
    let timeline = f.state.note_timeline();
    let excluded = HashSet::from([f.note.0.clone()]);
    let access = timeline.current_content(AllowedScope::policy(Some(&excluded), &excluded));
    assert!(access.provenance(&f.note).unwrap().is_none());
    assert!(access
        .activity(0, u64::MAX, 0, 20)
        .unwrap()
        .items
        .is_empty());
    assert_eq!(f.pending().window_id, window);
    let canonical = fs::read_to_string(&f.path).unwrap();
    fs::write(
        &f.path,
        crate::note::replace_authored_content(&canonical, None, "uncaptured").unwrap(),
    )
    .unwrap();
    assert!(matches!(
        timeline
            .current_content(AllowedScope::vault())
            .provenance(&f.note),
        Err(HistoryError::Stale(_))
    ));
    assert_eq!(f.pending().window_id, window);
    fs::remove_file(&f.path).unwrap();
    assert!(timeline
        .current_content(AllowedScope::vault())
        .provenance(&f.note)
        .unwrap()
        .is_none());
    assert_eq!(f.pending().window_id, window);
}

#[test]
fn editing_window_activity_only_seals_bounded_overlapping_candidates_and_retries_noops() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    // Establish three notes before opening windows, so creation does not affect
    // the queried publication period. The raw note cursor survives a net no-op.
    let mut notes = vec![(f.note.clone(), f.path.clone())];
    for title in ["Second", "Third"] {
        let saved = note_persistence::persist_note_session_with_outcome(
            &f.state,
            title.into(),
            "A".into(),
            None,
        )
        .unwrap()
        .unwrap();
        notes.push((
            NoteIdentity::new(saved.note_id.unwrap()),
            PathBuf::from(saved.path.unwrap()),
        ));
    }
    notes.sort_by(|a, b| a.0.as_str().cmp(b.0.as_str()));
    for (id, path) in &notes {
        let title = path.file_stem().unwrap().to_str().unwrap();
        note_persistence::persist_note_session_with_outcome(
            &f.state,
            title.into(),
            "pending".into(),
            Some(path.to_string_lossy().into()),
        )
        .unwrap();
        assert!(
            history_store::pending_window(&history_store::Store::for_test(), id)
                .unwrap()
                .is_some()
        );
    }
    let (id, path) = &notes[0];
    note_persistence::persist_note_session_with_outcome(
        &f.state,
        path.file_stem().unwrap().to_str().unwrap().into(),
        "A".into(),
        Some(path.to_string_lossy().into()),
    )
    .unwrap();
    let timeline = f.state.note_timeline();
    let access = timeline.current_content(AllowedScope::vault());
    // End is exclusive: a window beginning exactly at end is not selected.
    assert!(access
        .activity(999_999, 1_000_000, 0, 1)
        .unwrap()
        .items
        .is_empty());
    assert_eq!(
        history_store::pending_windows(&history_store::Store::for_test())
            .unwrap()
            .len(),
        3
    );
    let first = access.activity(1_000_000, 1_000_001, 0, 1).unwrap();
    assert!(first.items.is_empty());
    assert_eq!(first.next_offset, Some(1));
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), id)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        history_store::pending_windows(&history_store::Store::for_test())
            .unwrap()
            .len(),
        2
    );
    // Repeating the same page after the no-op does not skip the next note.
    let retry = access.activity(1_000_000, 1_000_001, 0, 1).unwrap();
    assert_eq!(retry.items[0].note_id, notes[1].0.as_str());
    assert_eq!(retry.next_offset, Some(2));
    assert_eq!(
        history_store::pending_windows(&history_store::Store::for_test())
            .unwrap()
            .len(),
        1
    );
    let second = access
        .activity(1_000_000, 1_000_001, first.next_offset.unwrap(), 1)
        .unwrap();
    assert_eq!(second.items[0].note_id, notes[1].0.as_str());
    assert_eq!(
        history_store::pending_windows(&history_store::Store::for_test())
            .unwrap()
            .len(),
        1
    );
    let third = access
        .activity(1_000_000, 1_000_001, second.next_offset.unwrap(), 1)
        .unwrap();
    assert_eq!(third.items[0].note_id, notes[2].0.as_str());
    assert_eq!(third.next_offset, None);
    assert!(
        history_store::pending_windows(&history_store::Store::for_test())
            .unwrap()
            .is_empty()
    );
    assert!(access
        .activity(1_000_001, 1_000_002, 0, 20)
        .unwrap()
        .items
        .is_empty());
    assert!(access.activity(1_000_000, 1_000_000, 0, 20).is_err());
}

#[test]
fn editing_window_uncertain_clock_activity_is_conservative_and_explicit() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let clock = f.continuous();
    f.save("first");
    clock.elapsed.store(100, Ordering::SeqCst);
    clock.wall.store(900_000, Ordering::SeqCst);
    f.save("endpoint");
    let timeline = f.state.note_timeline();
    let access = timeline.current_content(AllowedScope::vault());
    let page = access.activity(10, 11, 0, 20).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].revision_count, 1);
    assert!(page.items[0].uncertain_time);
    assert_eq!(page.items[0].first_at_millis, 900_000);
    assert_eq!(page.items[0].last_at_millis, 1_000_000);
    assert!(matches!(
        page.items[0].citations[0].time_evidence,
        Some(RevisionTimeEvidence::EditingWindow {
            first_wall_millis: 1_000_000,
            last_wall_millis: 900_000,
            clock_discontinuity: true,
            ..
        })
    ));
}

#[test]
fn editing_window_activity_stale_selected_bytes_fail_without_advancing_cursor() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("endpoint");
    let original = fs::read_to_string(&f.path).unwrap();
    let path = f.path.clone();
    let external =
        crate::note::replace_authored_content(&original, None, "uncaptured race").unwrap();
    activity::after_selection_once(move || fs::write(path, external).unwrap());
    let timeline = f.state.note_timeline();
    let access = timeline.current_content(AllowedScope::vault());
    assert!(matches!(
        access.activity(1_000_000, 1_000_001, 0, 1),
        Err(HistoryError::Stale(_))
    ));
    assert_eq!(f.retained().len(), 2);
    fs::write(&f.path, original).unwrap();
    let retried = access.activity(1_000_000, 1_000_001, 0, 1).unwrap();
    assert_eq!(retried.items[0].current_excerpt, "endpoint");
    assert_eq!(retried.items[0].revision_count, 1);
    assert_eq!(f.retained().len(), 2);
}

#[test]
fn editing_window_explicit_retry_finishes_failed_startup_seal_before_new_save() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("interrupted endpoint");
    let restarted = Fixture::state();
    history_store::inject_fault_once(history_store::FaultPoint::Finalize);
    assert!(restarted
        .note_timeline()
        .finalize_editing_window(&f.note)
        .is_err());
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_some()
    );
    restarted
        .note_timeline()
        .retry_history_recovery(f._notes.path())
        .unwrap();
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
    assert_eq!(f.retained().len(), 2);
    let clock = Arc::new(ContinuousTestClock {
        elapsed: AtomicU64::new(0),
        wall: AtomicU64::new(2_000_000),
    });
    restarted.note_timeline().runtime.set_window_clock(clock);
    let result = note_persistence::persist_note_session_with_outcome(
        &restarted,
        "Window".into(),
        "new session".into(),
        Some(f.path.to_string_lossy().into()),
    )
    .unwrap();
    assert!(result.unwrap().commit_warning.is_none());
    let live = history_store::pending_window(&history_store::Store::for_test(), &f.note)
        .unwrap()
        .unwrap()
        .window_id;
    restarted
        .note_timeline()
        .retry_history_recovery(f._notes.path())
        .unwrap();
    assert_eq!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .unwrap()
            .window_id,
        live
    );
}

#[test]
fn editing_window_startup_clear_discards_queued_target_observation_atomically_without_seal() {
    let _guard = crate::test_support::lock_test_env();
    for failed_delete in [false, true] {
        let f = Fixture::new();
        f.save("B pending");
        let canonical = fs::read_to_string(&f.path).unwrap();
        let external =
            crate::note::replace_authored_content(&canonical, None, "C observed").unwrap();
        fs::write(&f.path, &external).unwrap();
        let observation = f
            .state
            .note_timeline()
            .capture_observed_markdown(VaultObservation::external_edit(
                f.path.clone(),
                1_000_100,
                None,
            ))
            .unwrap();
        history_store::retain_observation(&history_store::Store::for_test(), &observation).unwrap();
        let restarted = Fixture::state();
        history_store::inject_fault_once(history_store::FaultPoint::Finalize);
        if failed_delete {
            history_store::inject_fault_once(history_store::FaultPoint::Deletion);
            assert!(restarted
                .note_timeline()
                .clear_note_history(&f.note)
                .is_err());
            assert_eq!(
                history_store::retained_observation_count(&history_store::Store::for_test()),
                1
            );
            assert!(
                history_store::pending_window(&history_store::Store::for_test(), &f.note)
                    .unwrap()
                    .is_some()
            );
            history_store::inject_fault_once(history_store::FaultPoint::Finalize);
        }
        restarted
            .note_timeline()
            .clear_note_history(&f.note)
            .unwrap();
        assert_eq!(
            history_store::retained_observation_count(&history_store::Store::for_test()),
            0
        );
        assert!(
            history_store::pending_window(&history_store::Store::for_test(), &f.note)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            f.retained(),
            vec![(MutationSource::BaselineInitialization, "C observed".into())]
        );
        assert!(f.save("D").commit_warning.is_some());
        f.state
            .note_timeline()
            .finalize_editing_window(&f.note)
            .unwrap();
    }
}

#[test]
fn editing_window_restore_preserves_selected_interval_origin_and_exact_return_point() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("A returned");
    let timeline = f.state.note_timeline();
    let access = timeline.current_content(AllowedScope::vault());
    let selected = access.provenance(&f.note).unwrap().unwrap();
    let origin = history_store::revisions(&history_store::Store::for_test(), &f.note)
        .unwrap()
        .last()
        .unwrap()
        .identity
        .clone();
    f.save("A");
    let history = timeline.open_history_mode(f.note.clone());
    let preview = history.restore_preview(origin.as_str()).unwrap();
    let restored = history
        .confirm_restore(origin.as_str(), &preview.current_authored_content_hash)
        .unwrap();
    assert!(restored.mutation.warning().is_none());
    let current = access.provenance(&f.note).unwrap().unwrap();
    let returned = current.body[0]
        .ranges
        .iter()
        .find(|r| r.provenance.restored_at.is_some())
        .unwrap();
    assert!(matches!(
        returned
            .provenance
            .restored_at
            .as_ref()
            .unwrap()
            .time_evidence,
        Some(RevisionTimeEvidence::Committed { .. })
    ));
    assert_eq!(
        returned.provenance.introduced_at,
        selected.body[0]
            .ranges
            .iter()
            .find(|r| r.provenance.known_since.record_id == origin.as_str())
            .unwrap()
            .provenance
            .introduced_at
    );
    assert_eq!(
        history_store::revisions(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .last()
            .unwrap()
            .restored_from
            .as_ref(),
        Some(&origin)
    );
}

#[test]
fn citations_without_required_time_evidence_are_no_longer_current() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let timeline = f.state.note_timeline();
    let access = timeline.current_content(AllowedScope::vault());
    let citations: Vec<_> = access
        .activity(0, u64::MAX, 0, 20)
        .unwrap()
        .items
        .into_iter()
        .flat_map(|item| item.citations)
        .collect();
    let mut json = serde_json::to_value(&citations).unwrap();
    for citation in json.as_array_mut().unwrap() {
        citation.as_object_mut().unwrap().remove("timeEvidence");
    }
    let missing_evidence: Vec<RevisionCitation> = serde_json::from_value(json).unwrap();
    f.save("A updated");
    assert_eq!(
        access.current_citations(&missing_evidence).unwrap().len(),
        0
    );
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_some()
    );
    let current: Vec<_> = access
        .activity(0, u64::MAX, 0, 20)
        .unwrap()
        .items
        .into_iter()
        .flat_map(|item| item.citations)
        .collect();
    let mut intervals: Vec<_> = current
        .into_iter()
        .filter(|c| c.time_evidence.is_some_and(|e| e.window().is_some()))
        .collect();
    assert!(!intervals.is_empty());
    for citation in &mut intervals {
        citation.time_evidence = None;
    }
    assert!(access.current_citations(&intervals).unwrap().is_empty());
}

#[test]
fn editing_window_history_pages_one_endpoint_and_net_diff_without_resealing_labels() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("discarded intermediate");
    f.clock.fetch_add(100, Ordering::SeqCst);
    f.save("retained endpoint");
    let private_id = f.pending().window_id;
    f.state
        .note_timeline()
        .finalize_editing_window(&f.note)
        .unwrap();
    let timeline = f.state.note_timeline();
    let history = timeline.open_history_mode(f.note.clone());
    let first_page = history.page(None, 1).unwrap();
    let first = &first_page.records()[0];
    let first_id = first.revision_id().unwrap().to_string();
    assert!(matches!(
        first,
        HistoryModeRecord::Revision {
            time_kind: HistoryModeRevisionTimeKind::EditingWindow,
            time_evidence: Some(RevisionTimeEvidence::EditingWindow {
                first_wall_millis: 1_000_000,
                last_wall_millis: 1_000_100,
                ..
            }),
            ..
        }
    ));
    let diff = history
        .diff(&first_id, HistoryDiffComparison::Parent)
        .unwrap();
    let serialized = serde_json::to_string(&diff).unwrap();
    assert!(serialized.contains("retained endpoint"));
    assert!(!serialized.contains("discarded intermediate"));
    assert!(!serde_json::to_string(&first_page)
        .unwrap()
        .contains(&private_id));
    let cursor = first_page.next_cursor().unwrap().to_string();

    f.save("newer live endpoint");
    let pending = f.pending().window_id;
    history
        .name_revision(&RevisionIdentity::from_persisted(&first_id), "Milestone")
        .unwrap();
    assert_eq!(f.pending().window_id, pending);
    assert_eq!(
        history
            .reconstruct(&RevisionIdentity::from_persisted(&first_id))
            .unwrap()
            .body,
        "retained endpoint"
    );
    let current_diff = history
        .diff(&first_id, HistoryDiffComparison::Current)
        .unwrap();
    assert!(serde_json::to_string(&current_diff)
        .unwrap()
        .contains("newer live endpoint"));
    assert!(current_diff.to_revision_id().is_none());
    assert_eq!(f.pending().window_id, pending);
    f.seal();
    let next_page = history.page(Some(&cursor), 1).unwrap();
    assert!(matches!(
        next_page.records()[0],
        HistoryModeRecord::Revision {
            source: MutationSource::NoteCreation,
            ..
        }
    ));
    let fresh = history.page(None, 2).unwrap();
    assert_eq!(
        fresh
            .records()
            .iter()
            .filter_map(HistoryModeRecord::revision_id)
            .count(),
        2
    );
    assert!(fresh.records().iter().all(|row| matches!(
        row,
        HistoryModeRecord::Revision {
            time_kind: HistoryModeRevisionTimeKind::EditingWindow,
            ..
        }
    )));
    assert_eq!(
        serde_json::to_string(
            &history
                .diff(&first_id, HistoryDiffComparison::Parent)
                .unwrap()
        )
        .unwrap(),
        serialized
    );
}

#[test]
fn editing_window_missing_interval_is_corrupt_after_attestation_and_restart() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    f.seal();
    let timeline = f.state.note_timeline();
    let history = timeline.open_history_mode(f.note.clone());
    history.page(None, 30).unwrap(); // Prime exhaustive attestation first.
    let db = rusqlite::Connection::open(history_store::history_database_path_for_test(
        f._notes.path(),
    ))
    .unwrap();
    db.execute("DELETE FROM revision_window_evidence", [])
        .unwrap();
    assert!(matches!(
        history.page(None, 30),
        Err(HistoryError::Corrupt(_))
    ));
    assert!(
        history_store::revisions(&history_store::Store::for_test(), &f.note)
            .unwrap_err()
            .to_string()
            .contains("granular Editor revision")
    );
    assert!(timeline
        .current_content(AllowedScope::vault())
        .provenance(&f.note)
        .is_err());
    let restarted = Fixture::state();
    assert!(matches!(
        restarted
            .note_timeline()
            .open_history_mode(f.note.clone())
            .page(None, 30),
        Err(HistoryError::Corrupt(_))
    ));
    assert_eq!(
        crate::note::parse_note(&fs::read_to_string(&f.path).unwrap()).body,
        "B"
    );
}

#[test]
fn editing_window_missing_purge_preserves_other_identity_observed_at_reused_path() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("A endpoint");
    fs::remove_file(&f.path).unwrap();
    let timeline = f.state.note_timeline();
    timeline
        .observe(VaultObservation::missing(f.path.clone(), 1_000_100))
        .unwrap();
    let other =
        "---\ngneauxghts:\n  id: path-reuse-other\n  kind: note\n---\n\nB observed before purge";
    fs::write(&f.path, other).unwrap();
    let observed = timeline
        .capture_observed_markdown(VaultObservation::external_edit(
            f.path.clone(),
            1_000_200,
            None,
        ))
        .unwrap();
    history_store::retain_observation(&history_store::Store::for_test(), &observed).unwrap();
    // Current disk can change again before replay. The exact captured B must survive.
    fs::write(
        &f.path,
        other.replace("B observed before purge", "B newer disk"),
    )
    .unwrap();
    timeline
        .purge_missing_notes(&[f.note.clone()], 1_000_300)
        .unwrap();
    assert!(
        history_store::revisions(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_empty()
    );
    let other_id = NoteIdentity::new("path-reuse-other");
    let retained = history_store::revisions(&history_store::Store::for_test(), &other_id).unwrap();
    assert!(!retained.is_empty());
    assert!(retained.iter().any(|r| history_store::reconstruct(
        &history_store::Store::for_test(),
        &other_id,
        &r.identity
    )
    .unwrap()
    .body
        == "B observed before purge"));
    assert!(fs::read_to_string(&f.path)
        .unwrap()
        .contains("B newer disk"));
}

#[test]
fn editing_window_activity_queued_behind_close_does_not_hold_operation_lease() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("B");
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        // Activity waits for the canonical owner before operation admission.
        // Close on that owner must finish without waiting for the queued read.
        crate::state::with_note_file_mutation(|| {
            scope.spawn(|| {
                started_tx.send(()).unwrap();
                let result = f
                    .state
                    .note_timeline()
                    .current_content(AllowedScope::vault())
                    .activity(0, u64::MAX, 0, 20);
                done_tx.send(result.is_err()).unwrap();
            });
            started_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap();
            f.state
                .note_timeline()
                .runtime
                .close_operations(|| Ok(()))?;
            Ok::<_, String>(())
        })
        .unwrap();
        assert!(done_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap());
    });
}

#[test]
fn unsupported_history_schema_requires_confirmed_reset_and_rebuilds_exact_current_markdown() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("current authored 🌍\n");
    f.seal();
    let canonical = fs::read(&f.path).unwrap();
    let before = crate::state::read_vault_manifest_for(f._notes.path())
        .unwrap()
        .unwrap();
    let database = history_store::history_database_path_for_test(f._notes.path());
    {
        let db = rusqlite::Connection::open(&database).unwrap();
        db.execute("UPDATE history_metadata SET schema_version=13", [])
            .unwrap();
    }
    let timeline = f.state.note_timeline();
    assert_eq!(
        timeline.history_health().unwrap().state(),
        HistoryHealthState::Unavailable
    );
    assert!(timeline
        .reset_corrupt_history(f._notes.path(), false)
        .is_err());
    assert!(note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Window".into(),
        "blocked".into(),
        Some(f.path.to_string_lossy().into())
    )
    .is_err());
    assert_eq!(fs::read(&f.path).unwrap(), canonical);
    timeline
        .reset_corrupt_history(f._notes.path(), true)
        .unwrap();
    let after = crate::state::read_vault_manifest_for(f._notes.path())
        .unwrap()
        .unwrap();
    assert_eq!(after.history_generation, before.history_generation + 1);
    assert_eq!(fs::read(&f.path).unwrap(), canonical);
    let retained = history_store::revisions(&history_store::Store::for_test(), &f.note).unwrap();
    assert_eq!(retained.len(), 1);
    assert_eq!(retained[0].source(), MutationSource::BaselineInitialization);
    assert_eq!(
        history_store::reconstruct(
            &history_store::Store::for_test(),
            &f.note,
            retained[0].identity()
        )
        .unwrap()
        .body(),
        "current authored 🌍\n"
    );
    assert_eq!(
        rusqlite::Connection::open(database)
            .unwrap()
            .query_row("SELECT schema_version FROM history_metadata", [], |r| r
                .get::<_, u64>(0))
            .unwrap(),
        14
    );
    let restarted = Fixture::state();
    assert_eq!(
        restarted.note_timeline().history_health().unwrap().state(),
        HistoryHealthState::Healthy
    );
}

#[test]
fn current_schema_cannot_accept_granular_editor_rows_after_both_window_records_are_removed() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("retained");
    f.seal();
    let db = rusqlite::Connection::open(history_store::history_database_path_for_test(
        f._notes.path(),
    ))
    .unwrap();
    db.execute_batch(
        "DELETE FROM revision_window_evidence; DELETE FROM pending_window_preparations;",
    )
    .unwrap();
    assert!(
        history_store::revisions(&history_store::Store::for_test(), &f.note)
            .unwrap_err()
            .to_string()
            .contains("granular Editor revision")
    );
    assert_eq!(
        f.state.note_timeline().history_health().unwrap().state(),
        HistoryHealthState::Corrupt
    );
    assert!(history_store::prepare_publication(
        &history_store::Store::for_test(),
        MutationSource::Editor,
        &f.path,
        &fs::read_to_string(&f.path).unwrap(),
        history_store::PublicationIntentKind::Update,
        None
    )
    .unwrap_err()
    .to_string()
    .contains("requires Editing Window admission"));
}

#[test]
fn changed_content_with_rename_retains_explicit_lifecycle_boundary_under_current_format() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("before rename");
    let renamed = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Renamed".into(),
        "changed while renaming".into(),
        Some(f.path.to_string_lossy().into()),
    )
    .unwrap()
    .unwrap();
    assert!(renamed.commit_warning.is_none());
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_none()
    );
    let retained = history_store::revisions(&history_store::Store::for_test(), &f.note).unwrap();
    assert_eq!(retained.len(), 3);
    assert!(retained[1].time_evidence().window().is_some());
    assert!(matches!(
        retained[2].time_evidence(),
        RevisionTimeEvidence::Committed { .. }
    ));
    assert_eq!(retained[2].source(), MutationSource::Editor);
    assert_eq!(
        history_store::reconstruct(
            &history_store::Store::for_test(),
            &f.note,
            retained[2].identity()
        )
        .unwrap()
        .body(),
        "changed while renaming"
    );
    assert_eq!(
        f.state
            .note_timeline()
            .history_health()
            .unwrap()
            .integrity(),
        HistoryIntegrityState::Verified
    );
}

#[test]
fn deadline_history_corruption_keeps_its_type_and_latches_after_other_due_notes_finish() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let clock = f.continuous();
    f.save("B");
    let other = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Other due".into(),
        "X".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let other_id = NoteIdentity::new(other.note_id.unwrap());
    let other_path = other.path.unwrap();
    note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Other due".into(),
        "Y".into(),
        Some(other_path.clone()),
    )
    .unwrap();
    let before = history_store::diagnostic_scan_counts();
    let db = rusqlite::Connection::open(
        crate::state::vault_data_dir()
            .unwrap()
            .join("history.sqlite3"),
    )
    .unwrap();
    db.execute(
        "UPDATE pending_editing_windows SET payload=X'00' WHERE note_id=?1",
        [f.note.as_str()],
    )
    .unwrap();
    drop(db);
    clock.elapsed.store(300_000, Ordering::SeqCst);
    let error = f.tick().unwrap_err();
    assert!(matches!(error, HistoryError::Corrupt(_)), "{error}");
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &other_id)
            .unwrap()
            .is_none()
    );
    assert!(
        history_store::pending_window(&history_store::Store::for_test(), &f.note)
            .unwrap()
            .is_some()
    );
    let original = fs::read(&other_path).unwrap();
    assert!(note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Other due".into(),
        "Must not publish".into(),
        Some(other_path.clone()),
    )
    .is_err());
    assert_eq!(fs::read(other_path).unwrap(), original);
    assert_eq!(history_store::diagnostic_scan_counts(), before);
}

// A second selected vault deliberately reuses the Note Identity and relative
// path, so scope correctness cannot depend on globally unique fixture identities.
fn select_other_vault(original: &Fixture) -> Fixture {
    let app_data = crate::test_support::TestDir::new("bound-context-other-data");
    let notes = crate::test_support::TestDir::new("bound-context-other-vault");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let canonical_notes = fs::canonicalize(notes.path()).unwrap();
    let path = canonical_notes.join(original.path.file_name().unwrap());
    let markdown = crate::note::repair_managed_note_identity(
        &crate::note::prepare_note_markdown("Other vault baseline", None, Some(None))
            .unwrap()
            .0,
        original.note.as_str(),
    )
    .unwrap();
    fs::write(&path, markdown).unwrap();
    let state = Fixture::state();
    state
        .note_timeline()
        .initialize_existing_notes(&canonical_notes)
        .unwrap();
    let other = Fixture {
        state,
        path,
        note: original.note.clone(),
        clock: Arc::new(AtomicU64::new(0)),
        _app_data: app_data,
        _notes: notes,
    };
    other.continuous();
    other.save("Other vault pending");
    other
}

#[test]
fn selected_context_keeps_admitted_publication_and_abandonment_in_original_vault() {
    let _guard = crate::test_support::lock_test_env();
    let a = Fixture::new();
    let prepared = a
        .state
        .note_timeline()
        .prepare_revision_publication(
            MutationSource::Editor,
            &a.path,
            Some(&a.path),
            Some(&a.note),
            "Admitted in A",
        )
        .unwrap();
    let abandoned = a
        .state
        .note_timeline()
        .prepare_revision_publication(
            MutationSource::NoteCreation,
            &a._notes.path().join("Never.md"),
            None,
            None,
            "Never published",
        )
        .unwrap()
        .into_parts()
        .1;
    let b = select_other_vault(&a);
    let b_window = b.pending();
    let b_bytes = fs::read(&b.path).unwrap();
    let b_observations = fs::read(
        b._app_data
            .path()
            .join("note-timeline-history-observations.json"),
    )
    .unwrap();
    let (canonical, intent) = prepared.into_parts();
    crate::state::with_note_file_mutation(|| {
        fs::write(&a.path, &canonical).unwrap();
        let result = a.state.note_timeline().mutate(NoteMutation::editor(
            intent,
            a.path.clone(),
            None,
            canonical,
        ));
        assert!(result.warning().is_none(), "{:?}", result.warning());
        abandoned.abandon().unwrap();
        Ok::<(), HistoryError>(())
    })
    .unwrap();
    assert_eq!(
        a.pending().result_hash,
        history_store::authored_content_hash(&fs::read_to_string(&a.path).unwrap())
    );
    assert_eq!(
        history_store::prepared_intent_count(&a.state.note_timeline().runtime.store, "abandoned"),
        1
    );
    assert_eq!(b.pending().endpoint_intent_id, b_window.endpoint_intent_id);
    assert_eq!(fs::read(&b.path).unwrap(), b_bytes);
    assert_eq!(
        fs::read(
            b._app_data
                .path()
                .join("note-timeline-history-observations.json")
        )
        .unwrap(),
        b_observations
    );
    // A command that resolves the newly selected B path cannot publish through A.
    assert!(note_persistence::persist_note_session_with_outcome(
        &a.state,
        "Window".into(),
        "Wrong vault".into(),
        Some(b.path.to_string_lossy().into()),
    )
    .is_err());
    assert_eq!(fs::read(&b.path).unwrap(), b_bytes);
    assert_eq!(b.pending().endpoint_intent_id, b_window.endpoint_intent_id);
}

#[test]
fn selected_context_deadlines_clean_close_and_reads_ignore_later_global_selection() {
    let _guard = crate::test_support::lock_test_env();
    let a = Fixture::new();
    let clock = a.continuous();
    a.save("A endpoint");
    let b = select_other_vault(&a);
    let b_window = b.pending();
    let b_observations_path = b
        ._app_data
        .path()
        .join("note-timeline-history-observations.json");
    let b_observations = fs::read(&b_observations_path).unwrap();
    clock.elapsed.store(300_000, Ordering::SeqCst);
    a.tick().unwrap();
    assert_eq!(a.retained().last().unwrap().1, "A endpoint");
    assert_eq!(b.pending().endpoint_intent_id, b_window.endpoint_intent_id);
    let access = a
        .state
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(a.note.clone()));
    assert_eq!(access.revisions().unwrap().len(), 2);
    assert!(a
        .state
        .note_timeline()
        .initialize_existing_notes(b._notes.path())
        .is_err());
    assert!(a
        .state
        .note_timeline()
        .clean_close(b._notes.path())
        .is_err());
    history_store::inject_fault_once(history_store::FaultPoint::Close);
    assert!(a
        .state
        .note_timeline()
        .clean_close(a._notes.path())
        .is_err());
    a.state
        .note_timeline()
        .clean_close(a._notes.path())
        .unwrap();
    // Do not reopen A merely to inspect its portable metadata.
    let a_observations: serde_json::Value = serde_json::from_slice(
        &fs::read(
            a._app_data
                .path()
                .join("note-timeline-history-observations.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(a_observations["vaults"]
        .as_object()
        .unwrap()
        .values()
        .all(|v| v["cleanCloseSequence"].as_u64().unwrap() > 0));
    assert_eq!(fs::read(&b_observations_path).unwrap(), b_observations);
    assert_eq!(b.pending().endpoint_intent_id, b_window.endpoint_intent_id);
    a.tick().unwrap(); // Closed scheduler is inert.
    assert_eq!(b.pending().endpoint_intent_id, b_window.endpoint_intent_id);
}

#[test]
fn selected_context_restart_recovery_uses_original_connection_and_markdown() {
    let _guard = crate::test_support::lock_test_env();
    let a = Fixture::new();
    let (canonical, intent) = a
        .state
        .note_timeline()
        .prepare_revision_publication(
            MutationSource::Editor,
            &a.path,
            Some(&a.path),
            Some(&a.note),
            "Recover A publication",
        )
        .unwrap()
        .into_parts();
    fs::write(&a.path, canonical).unwrap();
    drop(intent); // Simulated interrupted publication: durable intent is unresolved.
    let restarted_a = Fixture::state();
    let b = select_other_vault(&a);
    let b_window = b.pending();
    let b_bytes = fs::read(&b.path).unwrap();
    let access = restarted_a
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(a.note.clone()));
    let revisions = access.revisions().unwrap();
    assert_eq!(revisions.len(), 2);
    assert_eq!(
        access
            .reconstruct(revisions.last().unwrap().identity())
            .unwrap()
            .body(),
        "Recover A publication"
    );
    assert_eq!(b.pending().endpoint_intent_id, b_window.endpoint_intent_id);
    assert_eq!(fs::read(&b.path).unwrap(), b_bytes);
    restarted_a
        .note_timeline()
        .clean_close(a._notes.path())
        .unwrap();
}

#[test]
fn selected_context_reset_rejects_old_intent_scope_and_keeps_new_deadlines_live() {
    let _guard = crate::test_support::lock_test_env();
    let a = Fixture::new();
    let clock = a.continuous();
    a.save("Before reset");
    // A released private receipt retains its original context even without a live lease.
    let old = history_store::prepare_publication(
        &a.state.note_timeline().runtime.store,
        MutationSource::TaskAction,
        &a.path,
        &fs::read_to_string(&a.path).unwrap(),
        history_store::PublicationIntentKind::Update,
        None,
    );
    assert!(old.is_err()); // Task actions must first finalize the Editing Window.
    a.seal();
    let old = history_store::prepare_publication(
        &a.state.note_timeline().runtime.store,
        MutationSource::TaskAction,
        &a.path,
        &fs::read_to_string(&a.path).unwrap(),
        history_store::PublicationIntentKind::Update,
        None,
    )
    .unwrap();
    a.state
        .note_timeline()
        .reset_history(a._notes.path())
        .unwrap();
    assert!(matches!(old.abandon(), Err(HistoryError::Stale(_))));
    a.save("After reset");
    clock.elapsed.store(300_000, Ordering::SeqCst);
    a.tick().unwrap();
    assert_eq!(a.retained().last().unwrap().1, "After reset");
    assert!(
        history_store::pending_window(&a.state.note_timeline().runtime.store, &a.note)
            .unwrap()
            .is_none()
    );
}

#[test]
fn selected_context_rejects_other_vault_lifecycle_before_callback_or_purge() {
    let _guard = crate::test_support::lock_test_env();
    let a = Fixture::new();
    a.save("A pending");
    let a_window = a.pending();
    let b = select_other_vault(&a);
    let b_window = b.pending();
    let b_bytes = fs::read(&b.path).unwrap();
    let result = a.state.note_timeline().forget_note(&b.path, 7);
    assert!(matches!(result, Err(HistoryError::Stale(_))));
    assert!(a
        .state
        .note_timeline()
        .lifecycle(NoteLifecycleOperation::purged(
            b.note.clone(),
            b.path.clone(),
            10
        ))
        .is_err());
    assert_eq!(fs::read(&b.path).unwrap(), b_bytes);
    assert_eq!(a.pending().endpoint_intent_id, a_window.endpoint_intent_id);
    assert_eq!(b.pending().endpoint_intent_id, b_window.endpoint_intent_id);
    assert_eq!(
        history_store::retained_observation_count(&a.state.note_timeline().runtime.store),
        0
    );
}

#[cfg(unix)]
#[test]
fn selected_context_accepts_canonical_aliases_but_rejects_symlink_escape() {
    let _guard = crate::test_support::lock_test_env();
    let a = Fixture::new();
    let alias_parent = crate::test_support::TestDir::new("bound-vault-alias");
    let alias = alias_parent.path().join("selected");
    std::os::unix::fs::symlink(a._notes.path(), &alias).unwrap();
    crate::state::set_notes_root_override(Some(alias.clone())).unwrap();
    let alias_state = Fixture::state();
    let canonical_path = fs::canonicalize(&a.path).unwrap();
    // Proposal publication supplies canonicalized paths even when selection is a symlink.
    let prepared = alias_state
        .note_timeline()
        .prepare_revision_publication(
            MutationSource::AcceptedChatProposal,
            &canonical_path,
            Some(&canonical_path),
            Some(&a.note),
            "Canonical proposal path",
        )
        .unwrap();
    prepared.into_parts().1.abandon().unwrap();
    let outside = crate::test_support::TestDir::new("bound-vault-outside");
    std::os::unix::fs::symlink(outside.path(), a._notes.path().join("escape")).unwrap();
    assert!(alias_state
        .note_timeline()
        .prepare_revision_publication(
            MutationSource::Editor,
            &alias.join("escape/New.md"),
            None,
            None,
            "Outside",
        )
        .is_err());
    assert!(!outside.path().join("New.md").exists());
}

#[test]
fn selected_context_replays_retained_observation_after_global_selection_changes() {
    let _guard = crate::test_support::lock_test_env();
    let a = Fixture::new();
    a.save("A endpoint");
    let original = fs::read_to_string(&a.path).unwrap();
    fs::write(
        &a.path,
        original.strip_suffix("A endpoint").unwrap().to_owned() + "A observed",
    )
    .unwrap();
    history_store::inject_fault_once(history_store::FaultPoint::Finalize);
    assert!(a
        .state
        .note_timeline()
        .observe(VaultObservation::external_edit(
            a.path.clone(),
            1_000_100,
            None
        ))
        .is_err());
    let b = select_other_vault(&a);
    let b_window = b.pending();
    // Later disk bytes must not replace the already captured observation.
    fs::write(
        &a.path,
        original.strip_suffix("A endpoint").unwrap().to_owned() + "A later",
    )
    .unwrap();
    a.state
        .note_timeline()
        .recover_lifecycle_publications()
        .unwrap();
    assert_eq!(a.retained().last().unwrap().1, "A observed");
    assert_eq!(
        history_store::retained_observation_count(&a.state.note_timeline().runtime.store),
        0
    );
    assert_eq!(b.pending().endpoint_intent_id, b_window.endpoint_intent_id);
}

#[test]
fn selected_context_recovers_staged_deletion_without_touching_other_vault() {
    let _guard = crate::test_support::lock_test_env();
    let a = Fixture::new();
    history_store::inject_fault_once(history_store::FaultPoint::Deletion);
    assert!(a
        .state
        .note_timeline()
        .lifecycle(NoteLifecycleOperation::purged(
            a.note.clone(),
            a.path.clone(),
            100
        ))
        .is_err());
    assert!(!a.path.exists());
    let b = select_other_vault(&a);
    let b_bytes = fs::read(&b.path).unwrap();
    let b_window = b.pending();
    a.state
        .note_timeline()
        .recover_lifecycle_publications()
        .unwrap();
    assert!(
        history_store::pending_deletions_for_recovery(&a.state.note_timeline().runtime.store)
            .unwrap()
            .is_empty()
    );
    assert!(a.retained().is_empty());
    assert_eq!(fs::read(&b.path).unwrap(), b_bytes);
    assert_eq!(b.pending().endpoint_intent_id, b_window.endpoint_intent_id);
}

mod readiness;

#[test]
fn focused_evidence_returns_surviving_period_ranges_after_later_edits_and_clear_invalidates() {
    use crate::services::evidence::{EvidenceSession, SearchRequest};
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("A kept launch decision.\nRemovedSecret");
    f.seal();
    f.clock.store(2_000_000, Ordering::SeqCst);
    f.save("A kept launch decision.\nLater unrelated followup");
    f.seal();
    let mut evidence = EvidenceSession::default();
    let excluded = HashSet::new();
    let request = SearchRequest {
        after: Some(1_000_000),
        before: Some(1_500_000),
        ..Default::default()
    };
    let page = evidence
        .search(&f.state, None, &excluded, request.clone())
        .unwrap();
    assert!(!page.to_string().contains("RemovedSecret"));
    let items = page["items"].as_array().unwrap();
    assert!(!items.is_empty(), "{page}");
    let ids: Vec<_> = items
        .iter()
        .map(|i| i["evidenceId"].as_str().unwrap().into())
        .collect();
    let (read, sources) = evidence
        .read(&f.state, None, &excluded, &ids, false)
        .unwrap();
    assert!(read.to_string().contains("launch decision"), "{read}");
    assert!(read["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| !item["excerpt"]
            .as_str()
            .unwrap()
            .contains("Later unrelated")));
    assert!(!sources.is_empty());
    assert!(read["items"][0]["provenance"].is_object());
    assert!(evidence.is_current(&f.state, None, &excluded));
    f.state
        .lexical
        .sync_with_notes_index(&f.state.notes_index.lock().unwrap().entries)
        .unwrap();
    for (query, mode) in [
        (
            "launch decision",
            crate::services::evidence::SearchMode::Lexical,
        ),
        (
            "launch|unmatched",
            crate::services::evidence::SearchMode::Regex,
        ),
    ] {
        let mut scoped = EvidenceSession::default();
        let page = scoped
            .search(
                &f.state,
                None,
                &excluded,
                SearchRequest {
                    query: query.into(),
                    mode,
                    ..request.clone()
                },
            )
            .unwrap();
        assert!(!page["items"].as_array().unwrap().is_empty(), "{page}");
    }
    f.state.note_timeline().clear_note_history(&f.note).unwrap();
    assert!(!evidence.is_current(&f.state, None, &excluded));
    let mut cleared = EvidenceSession::default();
    assert!(
        cleared.search(&f.state, None, &excluded, request).unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn activity_passage_coordinates_keep_duplicate_words_and_long_range_tails() {
    use crate::services::evidence::{EvidenceSession, SearchRequest};
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let body = format!(
        "A repeated word\n{} final-tail-marker\nrepeated word",
        "longsegment ".repeat(260)
    );
    f.save(&body);
    f.seal();
    let mut evidence = EvidenceSession::default();
    let mut request = SearchRequest {
        after: Some(1_000_000),
        before: Some(1_500_000),
        limit: Some(1),
        ..Default::default()
    };
    let mut previews = String::new();
    let mut excerpts = String::new();
    loop {
        let page = evidence
            .search(&f.state, None, &HashSet::new(), request.clone())
            .unwrap();
        for item in page["items"].as_array().unwrap() {
            previews.push_str(item["preview"].as_str().unwrap());
            let id = item["evidenceId"].as_str().unwrap().to_string();
            let (read, _) = evidence
                .read(&f.state, None, &HashSet::new(), &[id], false)
                .unwrap();
            for passage in read["items"].as_array().unwrap() {
                excerpts.push_str(passage["excerpt"].as_str().unwrap());
            }
        }
        match page["nextCursor"].as_str() {
            Some(cursor) => request.cursor = Some(cursor.into()),
            None => break,
        }
    }
    assert!(excerpts.contains("final-tail-marker"), "{previews}");
    assert_eq!(excerpts.matches("repeated").count(), 2);
    assert_eq!(excerpts.matches("word").count(), 2);
}

#[test]
fn current_passage_provenance_continues_without_caching_partial_pages() {
    use crate::services::evidence::{EvidenceSession, SearchMode, SearchRequest};
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("A alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima");
    f.seal();
    f.clock.store(2_000_000, Ordering::SeqCst);
    f.save("A alpha BRAVO charlie DELTA echo FOXTROT golf HOTEL india JULIET kilo LIMA");
    f.seal();
    let mut evidence = EvidenceSession::default();
    let page = evidence
        .search(
            &f.state,
            None,
            &HashSet::new(),
            SearchRequest {
                query: "alpha".into(),
                mode: SearchMode::Literal,
                ..Default::default()
            },
        )
        .unwrap();
    let id = page["items"][0]["evidenceId"].as_str().unwrap().to_string();
    let mut offset = 0;
    let mut seen = HashSet::new();
    let mut pages = 0;
    loop {
        let (read, _) = evidence
            .read_page(&f.state, None, &HashSet::new(), &[id.clone()], true, offset)
            .unwrap();
        let item = &read["items"][0];
        assert!(item.is_object(), "{read}");
        let ranges = item["provenance"].as_array().unwrap();
        for range in ranges {
            assert!(
                seen.insert(range["ranges"][0]["start"].as_u64().unwrap()),
                "repeated page: {read}"
            );
        }
        pages += 1;
        match item["nextProvenanceOffset"].as_u64() {
            Some(next) => {
                assert!(next as usize > offset);
                offset = next as usize;
            }
            None => break,
        }
    }
    assert!(pages > 1);
    let (plain, _) = evidence
        .read(&f.state, None, &HashSet::new(), &[id], false)
        .unwrap();
    assert!(plain["items"][0]["provenance"].is_null());
}

#[test]
fn frontmatter_tags_share_editor_save_capture_and_preserve_other_properties() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save(
        "---\ntags: [old]\n# Keep this owner documentation\nowner: 'Alice' # preserve\n---\n\nA",
    );
    f.seal();
    let outcome = f
        .state
        .note_timeline()
        .save_note_with_tags(
            MutationSource::Editor,
            "Window",
            "Edited body",
            Some(f.path.to_string_lossy().into()),
            Some(&crate::tags::TagEdit {
                previous: vec!["old".into()],
                tags: vec!["renovation".into()],
            }),
        )
        .unwrap()
        .unwrap();
    let session = note_persistence::build_note_session_from_mutation(&outcome);
    assert_eq!(session.tags, vec!["renovation"]);
    assert_eq!(session.markdown, "Edited body");
    let canonical = std::fs::read_to_string(&f.path).unwrap();
    assert!(canonical.contains("# Keep this owner documentation\nowner: 'Alice' # preserve"));
    f.seal();
    let headers =
        history_store::revisions(&f.state.note_timeline().runtime.store, &f.note).unwrap();
    let authored = history_store::reconstruct(
        &f.state.note_timeline().runtime.store,
        &f.note,
        &headers.last().unwrap().identity,
    )
    .unwrap();
    assert!(authored
        .unmanaged_frontmatter
        .as_deref()
        .unwrap()
        .contains("renovation"));
    assert_eq!(authored.body, "Edited body");
    assert_eq!(f.save("Next body edit").tags, vec!["renovation"]);
    let unchanged = std::fs::read_to_string(&f.path).unwrap();
    assert!(f
        .state
        .note_timeline()
        .save_note_with_tags(
            MutationSource::Editor,
            "Window",
            "Must not publish",
            Some(f.path.to_string_lossy().into()),
            Some(&crate::tags::TagEdit {
                previous: vec!["old".into()],
                tags: vec![]
            }),
        )
        .is_err());
    assert_eq!(std::fs::read_to_string(&f.path).unwrap(), unchanged);
    f.state
        .note_timeline()
        .save_note_with_tags(
            MutationSource::Editor,
            "Window",
            "Next body edit",
            Some(f.path.to_string_lossy().into()),
            Some(&crate::tags::TagEdit {
                previous: vec!["renovation".into()],
                tags: vec![],
            }),
        )
        .unwrap();
    assert!(crate::commands::read_note_session_from_path(&f.path)
        .unwrap()
        .tags
        .is_empty());
}
