use super::*;
use std::cell::RefCell;

fn saved(fixture: &crate::test_support::TestVault) -> (PathBuf, NoteIdentity, String) {
    let result = fixture
        .state
        .note_timeline()
        .save_note(
            MutationSource::Editor,
            "Original",
            "---\nproject: launch\n---\n\nExact bytes 🦀\n- [ ] Ship it",
            None,
        )
        .unwrap()
        .unwrap();
    (
        result.path().to_path_buf(),
        result.note_id().clone(),
        result.canonical_markdown().into(),
    )
}

fn prepare(
    fixture: &crate::test_support::TestVault,
    source: &Path,
    destination: &Path,
    identity: &NoteIdentity,
    raw: &str,
) -> (PreparedHistoryIntent, PublicationProof) {
    let timeline = fixture.state.note_timeline();
    timeline.finalize_editor_capture(identity).unwrap();
    let intent = history_store::prepare_rename_publication(
        &timeline.runtime.store,
        source,
        destination,
        raw,
        crate::time::current_time_millis().unwrap(),
    )
    .unwrap();
    let proof = PublicationProof {
        token: intent.as_str().into(),
        note_id: identity.as_str().into(),
        path: destination.into(),
        canonical_markdown: raw.into(),
        effect: PublicationEffect::Rename {
            source_path: source.into(),
        },
    };
    (intent, proof)
}

#[test]
fn rename_preserves_every_raw_byte_identity_history_and_task_location() {
    let fixture = crate::test_support::TestVault::new("timeline-rename-exact");
    let (source, identity, raw) = saved(&fixture);
    let destination = fixture.notes.path().join("Renamed 🦀.md");
    let proof = RefCell::new(None);
    let result = fixture
        .state
        .note_timeline()
        .rename_note_with_proof(
            &source,
            &destination,
            &identity,
            &crate::semantic::db::content_hash(&raw),
            &|value| {
                *proof.borrow_mut() = Some(value.clone());
                Ok(())
            },
        )
        .unwrap();
    assert_eq!(result.note_id(), &identity);
    assert_eq!(result.canonical_markdown(), raw);
    assert!(!source.exists());
    assert_eq!(fs::read(&destination).unwrap(), raw.as_bytes());
    assert_eq!(
        fixture
            .state
            .indexed_note_identity(&destination)
            .unwrap()
            .as_deref(),
        Some(identity.as_str())
    );
    assert_eq!(fixture.state.indexed_note_identity(&source).unwrap(), None);
    let tasks = crate::state::task_projection::load_tasks_for_note_id(identity.as_str()).unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(PathBuf::from(&tasks[0].note_path), destination);
    let history = fixture
        .state
        .note_timeline()
        .open_history_mode(identity.clone());
    assert_eq!(
        history.revisions().unwrap().len(),
        1,
        "a filename change is not a content revision"
    );
    let renames: Vec<_> = history
        .lifecycle_events()
        .unwrap()
        .into_iter()
        .filter(|event| event.kind() == LifecycleEventKind::Renamed)
        .collect();
    assert_eq!(renames.len(), 1);
    assert_eq!(renames[0].previous_path(), Some(source.as_path()));
    assert_eq!(renames[0].path(), Some(destination.as_path()));
    let proof = proof.into_inner().unwrap();
    for _ in 0..2 {
        let replay = fixture
            .state
            .note_timeline()
            .reconcile_publication(&proof)
            .unwrap()
            .unwrap();
        assert_eq!(replay.path(), destination);
        assert_eq!(replay.canonical_markdown(), raw);
    }
    assert_eq!(
        history
            .lifecycle_events()
            .unwrap()
            .into_iter()
            .filter(|event| event.kind() == LifecycleEventKind::Renamed)
            .count(),
        1
    );
}

#[test]
fn rename_retains_a_watcher_missed_source_edit_as_external_content_not_rename_authorship() {
    let fixture = crate::test_support::TestVault::new("timeline-rename-unwatched-source");
    let (source, identity, raw) = saved(&fixture);
    let current = format!("{raw}\nA watcher-missed external edit");
    fs::write(&source, &current).unwrap();
    let destination = fixture.notes.path().join("Fresh read rename.md");
    fixture
        .state
        .note_timeline()
        .rename_note_with_proof(
            &source,
            &destination,
            &identity,
            &crate::semantic::db::content_hash(&current),
            &|_| Ok(()),
        )
        .unwrap();
    assert_eq!(fs::read_to_string(&destination).unwrap(), current);
    let history = fixture.state.note_timeline().open_history_mode(identity);
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 2);
    assert_eq!(revisions[1].source(), MutationSource::ExternalEdit);
    assert_eq!(
        history
            .lifecycle_events()
            .unwrap()
            .iter()
            .filter(|event| event.kind() == LifecycleEventKind::Renamed)
            .count(),
        1
    );
}

#[test]
fn collision_and_source_change_after_durable_preparation_preserve_both_files() {
    for change_source in [false, true] {
        let fixture = crate::test_support::TestVault::new("timeline-rename-recheck");
        let (source, identity, raw) = saved(&fixture);
        let destination = fixture.notes.path().join("Occupied.md");
        let error = fixture
            .state
            .note_timeline()
            .rename_note_with_proof(
                &source,
                &destination,
                &identity,
                &crate::semantic::db::content_hash(&raw),
                &|_| {
                    if change_source {
                        fs::write(&source, format!("{raw}\nExternal change")).unwrap();
                    }
                    fs::write(&destination, "Independent destination").unwrap();
                    Ok(())
                },
            )
            .unwrap_err();
        assert!(error
            .to_string()
            .contains(if change_source { "changed" } else { "occupied" }));
        assert_eq!(
            fs::read_to_string(&destination).unwrap(),
            "Independent destination"
        );
        assert_eq!(
            fs::read_to_string(&source).unwrap(),
            if change_source {
                format!("{raw}\nExternal change")
            } else {
                raw
            }
        );
        assert_eq!(
            history_store::prepared_intent_count(
                &fixture.state.note_timeline().runtime.store,
                "prepared"
            ),
            0
        );
    }
}

#[test]
fn kernel_no_replace_move_never_overwrites_an_existing_file_or_follows_a_symlink() {
    let fixture = crate::test_support::TestVault::new("timeline-rename-primitive");
    let (source, _, raw) = saved(&fixture);
    let destination = fixture.notes.path().join("Occupied.md");
    fs::write(&destination, "Independent").unwrap();
    assert_eq!(
        crate::state::atomic_move_note_no_replace(&source, &destination)
            .unwrap_err()
            .kind(),
        std::io::ErrorKind::AlreadyExists
    );
    assert_eq!(fs::read_to_string(&source).unwrap(), raw);
    assert_eq!(fs::read_to_string(&destination).unwrap(), "Independent");
    #[cfg(unix)]
    {
        fs::remove_file(&destination).unwrap();
        std::os::unix::fs::symlink(&source, &destination).unwrap();
        assert_eq!(
            crate::state::atomic_move_note_no_replace(&source, &destination)
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::AlreadyExists
        );
        assert!(fs::symlink_metadata(&destination)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(crate::state::atomic_move_note_no_replace(
            &destination,
            &fixture.notes.path().join("Other.md")
        )
        .is_err());
        assert_eq!(fs::read_to_string(&source).unwrap(), raw);
        let linked_directory = fixture.notes.path().join("Linked folder");
        std::os::unix::fs::symlink(fixture.notes.path(), &linked_directory).unwrap();
        assert!(crate::state::atomic_move_note_no_replace(
            &linked_directory.join(source.file_name().unwrap()),
            &linked_directory.join("Alias move.md")
        )
        .is_err());
        assert_eq!(fs::read_to_string(&source).unwrap(), raw);
        assert!(!fixture.notes.path().join("Alias move.md").exists());
    }
}

#[test]
fn interrupted_rename_reopens_exact_prepared_moved_and_captured_outcomes_without_replay() {
    for stage in ["prepared", "moved", "observed", "captured"] {
        let fixture = crate::test_support::TestVault::new("timeline-rename-reopen");
        let (source, identity, raw) = saved(&fixture);
        let destination = fixture.notes.path().join("Recovered.md");
        let (intent, proof) = prepare(&fixture, &source, &destination, &identity, &raw);
        if stage != "prepared" {
            crate::state::atomic_move_note_no_replace(&source, &destination).unwrap();
        }
        let changed = format!("{raw}\nExternal edit after observed effect");
        if stage == "observed" {
            history_store::record_rename_effect(
                &fixture.state.note_timeline().runtime.store,
                &intent,
            )
            .unwrap();
            fs::write(&destination, &changed).unwrap();
        }
        if stage == "captured" {
            history_store::finalize_publication(
                &fixture.state.note_timeline().runtime.store,
                &intent,
                MutationSource::AgentPublication,
                &destination,
                &raw,
            )
            .unwrap();
        }
        drop(intent); // no in-memory intent is needed by the restarted owner
        fixture.state.stop_rebuildable_projection_work().unwrap();
        let restarted = AppState::new(
            crate::semantic::SemanticState::new_disabled("rename restart"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        for _ in 0..2 {
            let result = restarted
                .note_timeline()
                .reconcile_publication(&proof)
                .unwrap();
            if stage == "prepared" {
                assert!(result.is_none());
                assert_eq!(fs::read_to_string(&source).unwrap(), raw);
                assert!(!destination.exists());
            } else {
                assert_eq!(result.unwrap().note_id(), &identity);
                assert!(!source.exists());
                assert_eq!(
                    fs::read_to_string(&destination).unwrap(),
                    if stage == "observed" { &changed } else { &raw }.as_str()
                );
            }
        }
        let history = restarted.note_timeline().open_history_mode(identity);
        assert_eq!(history.revisions().unwrap().len(), 1);
        assert_eq!(
            history
                .lifecycle_events()
                .unwrap()
                .iter()
                .filter(|event| event.kind() == LifecycleEventKind::Renamed)
                .count(),
            usize::from(stage != "prepared")
        );
        restarted.stop_rebuildable_projection_work().unwrap();
    }
}

#[test]
fn committed_rename_replay_preserves_a_reoccupied_old_location_and_current_destination_bytes() {
    let fixture = crate::test_support::TestVault::new("timeline-rename-reoccupied");
    let (source, identity, raw) = saved(&fixture);
    let destination = fixture.notes.path().join("Renamed.md");
    let proof = RefCell::new(None);
    fixture
        .state
        .note_timeline()
        .rename_note_with_proof(
            &source,
            &destination,
            &identity,
            &crate::semantic::db::content_hash(&raw),
            &|value| {
                *proof.borrow_mut() = Some(value.clone());
                Ok(())
            },
        )
        .unwrap();
    let foreign = crate::note::prepare_note_markdown("Independent old-path note", None, Some(None))
        .unwrap()
        .0;
    fs::write(&source, &foreign).unwrap();
    let changed = format!("{raw}\nEdited after rename");
    fs::write(&destination, &changed).unwrap();
    let proof = proof.into_inner().unwrap();
    let replay = fixture
        .state
        .note_timeline()
        .reconcile_publication(&proof)
        .unwrap()
        .unwrap();
    assert_eq!(
        replay.canonical_markdown(),
        raw,
        "return the original committed receipt"
    );
    assert_eq!(fs::read_to_string(&source).unwrap(), foreign);
    assert_eq!(
        fs::read_to_string(&destination).unwrap(),
        changed,
        "never replay old bytes"
    );
    assert_eq!(
        fixture.state.indexed_note_identity(&source).unwrap(),
        crate::note::parse_note(&foreign)
            .frontmatter
            .managed
            .map(|managed| managed.id)
    );
}

#[test]
fn mixed_prepared_state_and_forged_raw_proof_never_authorize_a_second_effect() {
    let fixture = crate::test_support::TestVault::new("timeline-rename-mixed");
    let (source, identity, raw) = saved(&fixture);
    let destination = fixture.notes.path().join("Duplicate.md");
    let (_, proof) = prepare(&fixture, &source, &destination, &identity, &raw);
    fs::write(&destination, &raw).unwrap();
    let error = fixture
        .state
        .note_timeline()
        .reconcile_publication(&proof)
        .unwrap_err();
    assert!(error.to_string().contains("uncertain two-path"));
    assert_eq!(fs::read_to_string(&source).unwrap(), raw);
    assert_eq!(fs::read_to_string(&destination).unwrap(), raw);
    // Even authored-equal managed-only changes cannot forge exact rename proof.
    let mut forged = proof;
    forged.canonical_markdown = raw.replacen("gneauxghts:", "gneauxghts: ", 1);
    assert_ne!(forged.canonical_markdown, raw);
    assert_eq!(
        history_store::authored_content_hash(&forged.canonical_markdown),
        history_store::authored_content_hash(&raw)
    );
    assert!(history_store::verify_rename_publication(
        &fixture.state.note_timeline().runtime.store,
        &forged.token,
        &identity,
        &source,
        &destination,
        &forged.canonical_markdown
    )
    .is_err());
}

#[test]
fn queued_saved_buffers_cannot_recreate_a_renamed_path_or_overwrite_its_replacement() {
    for source_kind in [MutationSource::Editor, MutationSource::TaskAction] {
        for pending_capture in [false, true] {
            for foreign_replacement in [false, true] {
                let fixture = crate::test_support::TestVault::new("timeline-rename-queued-save");
                let (source, identity, raw) = saved(&fixture);
                fixture
                    .state
                    .note_timeline()
                    .finalize_editor_capture(&identity)
                    .unwrap();
                let destination = fixture.notes.path().join("Renamed.md");
                let foreign =
                    crate::note::prepare_note_markdown("Independent replacement", None, Some(None))
                        .unwrap()
                        .0;
                let state = fixture.state.clone();
                let queued_source = source.clone();
                let moved_destination = destination.clone();
                let retained_identity = identity.clone();
                let moved_raw = raw.clone();
                let replacement = foreign.clone();
                // Pause the real save operation after its successful preflight,
                // then commit a competing rename before it acquires the owner.
                *AFTER_SAVE_PREFLIGHT.lock().unwrap() = Some(Box::new(move || {
                    let timeline = state.note_timeline();
                    if pending_capture {
                        let intent = history_store::prepare_rename_publication(
                            &timeline.runtime.store,
                            &queued_source,
                            &moved_destination,
                            &moved_raw,
                            crate::time::current_time_millis().unwrap(),
                        )
                        .unwrap();
                        crate::state::atomic_move_note_no_replace(
                            &queued_source,
                            &moved_destination,
                        )
                        .unwrap();
                        history_store::record_rename_effect(&timeline.runtime.store, &intent)
                            .unwrap();
                        history_store::release_publication_receipt(
                            &timeline.runtime.store,
                            &intent,
                        )
                        .unwrap();
                        timeline
                            .runtime
                            .require_released_capture_recovery()
                            .unwrap();
                    } else {
                        timeline
                            .rename_note_with_proof(
                                &queued_source,
                                &moved_destination,
                                &retained_identity,
                                &crate::semantic::db::content_hash(&moved_raw),
                                &|_| Ok(()),
                            )
                            .unwrap();
                    }
                    if foreign_replacement {
                        fs::write(&queued_source, &replacement).unwrap();
                    }
                }));
                let result =
                    crate::commands::note_persistence::persist_note_session_with_expected_identity(
                        &fixture.state,
                        "Original".into(),
                        "Delayed saved buffer".into(),
                        Some(source.to_string_lossy().into()),
                        Some(identity.as_str().into()),
                        source_kind,
                        None,
                    );
                assert!(
                    result.is_err(),
                    "a buffer captured before rename must become stale"
                );
                assert_eq!(fs::read_to_string(&destination).unwrap(), raw);
                if foreign_replacement {
                    assert_eq!(fs::read_to_string(&source).unwrap(), foreign);
                } else {
                    assert!(
                        !source.exists(),
                        "a stale save cannot recreate the old filename"
                    );
                }
                let occurrences = fs::read_dir(fixture.notes.path())
                    .unwrap()
                    .filter_map(Result::ok)
                    .filter_map(|entry| fs::read_to_string(entry.path()).ok())
                    .filter(|raw| {
                        crate::note::parse_note(raw)
                            .frontmatter
                            .managed
                            .is_some_and(|metadata| metadata.id == identity.as_str())
                    })
                    .count();
                assert_eq!(
                    occurrences, 1,
                    "the renamed Note Identity must not be duplicated"
                );
                let history = fixture.state.note_timeline().open_history_mode(identity);
                assert_eq!(history.revisions().unwrap().len(), 1);
                assert_eq!(
                    history
                        .lifecycle_events()
                        .unwrap()
                        .iter()
                        .filter(|event| event.kind() == LifecycleEventKind::Renamed)
                        .count(),
                    1
                );
            }
        }
    }
}

#[test]
fn captured_identity_allows_a_new_note_at_a_reused_filename_and_explicit_deleted_note_recreation() {
    let fixture = crate::test_support::TestVault::new("timeline-rename-reused-source-save");
    let (source, identity, raw) = saved(&fixture);
    let destination = fixture.notes.path().join("Renamed.md");
    fixture
        .state
        .note_timeline()
        .rename_note_with_proof(
            &source,
            &destination,
            &identity,
            &crate::semantic::db::content_hash(&raw),
            &|_| Ok(()),
        )
        .unwrap();
    let replacement =
        crate::commands::note_persistence::persist_note_session_with_expected_identity(
            &fixture.state,
            "Original".into(),
            "New note at an available filename".into(),
            None,
            None,
            MutationSource::Editor,
            None,
        )
        .unwrap()
        .unwrap();
    assert_eq!(
        replacement.path.as_deref(),
        Some(source.to_string_lossy().as_ref())
    );
    assert_ne!(replacement.note_id.as_deref(), Some(identity.as_str()));
    let replacement_id = replacement.note_id.clone();
    let edited = crate::commands::note_persistence::persist_note_session_with_expected_identity(
        &fixture.state,
        "Original".into(),
        "Replacement edits".into(),
        replacement.path.clone(),
        replacement_id.clone(),
        MutationSource::Editor,
        None,
    )
    .unwrap()
    .unwrap();
    assert_eq!(edited.note_id, replacement_id);
    assert_eq!(edited.markdown, "Replacement edits");
    fs::remove_file(&source).unwrap();
    let recreated = crate::commands::note_persistence::persist_note_session_with_expected_identity(
        &fixture.state,
        "Original".into(),
        "Keep my edits after external deletion".into(),
        edited.path,
        replacement_id.clone(),
        MutationSource::Editor,
        None,
    )
    .unwrap()
    .unwrap();
    assert_eq!(recreated.note_id, replacement_id);
    assert!(source.exists());
    assert_eq!(fs::read_to_string(destination).unwrap(), raw);
}

#[test]
fn retained_location_read_settles_observed_rename_before_admitting_a_stale_catalog_path() {
    let fixture = crate::test_support::TestVault::new("timeline-rename-location-read");
    let (source, identity, raw) = saved(&fixture);
    assert!(fixture
        .state
        .note_timeline()
        .admits_retained_note_location(&identity, &source)
        .unwrap());
    let destination = fixture.notes.path().join("Renamed.md");
    let (intent, _) = prepare(&fixture, &source, &destination, &identity, &raw);
    crate::state::atomic_move_note_no_replace(&source, &destination).unwrap();
    let timeline = fixture.state.note_timeline();
    history_store::record_rename_effect(&timeline.runtime.store, &intent).unwrap();
    fs::write(&source, "Unmanaged foreign replacement").unwrap();
    history_store::release_publication_receipt(&timeline.runtime.store, &intent).unwrap();
    timeline
        .runtime
        .require_released_capture_recovery()
        .unwrap();
    assert!(!timeline
        .admits_retained_note_location(&identity, &source)
        .unwrap());
    assert!(timeline
        .admits_retained_note_location(&identity, &destination)
        .unwrap());
    assert_eq!(
        fs::read_to_string(&source).unwrap(),
        "Unmanaged foreign replacement"
    );
    assert_eq!(fs::read_to_string(&destination).unwrap(), raw);
}

#[test]
fn retained_location_read_never_resets_or_migrates_an_unsupported_history_store() {
    let fixture = crate::test_support::TestVault::new("timeline-rename-location-unsupported");
    let (source, identity, raw) = saved(&fixture);
    fixture.state.note_timeline().runtime.stop_verification();
    let database = history_store::history_database_path_for_test(fixture.notes.path());
    {
        let connection = rusqlite::Connection::open(&database).unwrap();
        connection
            .execute("UPDATE history_metadata SET schema_version=14", [])
            .unwrap();
    }
    let database_before = fs::read(&database).unwrap();
    let error = fixture
        .state
        .note_timeline()
        .admits_retained_note_location(&identity, &source)
        .unwrap_err();
    assert!(error.to_string().contains("schema"));
    assert_eq!(fs::read(&database).unwrap(), database_before);
    assert_eq!(fs::read_to_string(&source).unwrap(), raw);
    assert_eq!(
        crate::commands::read_note_session_from_path(&source)
            .unwrap()
            .note_id
            .as_deref(),
        Some(identity.as_str())
    );
}
