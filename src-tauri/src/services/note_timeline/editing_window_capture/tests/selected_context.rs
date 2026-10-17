//! Bound-vault operations retain their original context when global selection changes.
use super::*;

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
    // Agent publication supplies canonicalized paths even when selection is a symlink.
    let prepared = alias_state
        .note_timeline()
        .prepare_revision_publication(
            MutationSource::AgentPublication,
            &canonical_path,
            Some(&canonical_path),
            Some(&a.note),
            "Canonical agent publication path",
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
