#[test]
fn clearing_one_note_atomically_replaces_readable_history_with_a_truthful_baseline() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-clear-note-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-clear-note-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Clear me".to_string(),
        "First retained state".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    save_retained_state(
        &state,
        "Clear me".to_string(),
        "Current canonical state".to_string(),
        Some(path.to_string_lossy().into_owned()),
    )
    .unwrap();
    fs::write(
        &path,
        "Current canonical state without managed identity metadata",
    )
    .unwrap();
    let before_bytes = fs::read(&path).unwrap();
    let history = state
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(note_id.clone()));
    let removed_revision = history.revisions().unwrap()[0].identity().clone();
    let before_clear = crate::time::current_time_millis().unwrap();

    let receipt = state.note_timeline().clear_note_history(&note_id).unwrap();
    let after_clear = crate::time::current_time_millis().unwrap();

    assert_eq!(fs::read(&path).unwrap(), before_bytes);
    assert_eq!(&receipt.marker.scope, &DeletionScope::Note(note_id.clone()));
    assert_eq!(receipt.marker.kind, HistoryDeletionKind::Clear);
    assert_eq!(receipt.baseline_note_ids(), std::slice::from_ref(&note_id));
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = restarted.note_timeline();
    let history = timeline.history_mode(HistoryModeGrant::authorized(note_id.clone()));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 1);
    assert_eq!(
        revisions[0].source(),
        MutationSource::BaselineInitialization
    );
    assert_eq!(revisions[0].predecessor(), None);
    assert_eq!(revisions[0].committed_at_millis(), None);
    assert_eq!(revisions[0].observed_at_millis(), None);
    assert!(revisions[0]
        .known_since_millis()
        .is_some_and(|known| (before_clear..=after_clear).contains(&known)));
    assert_eq!(
        history.reconstruct(revisions[0].identity()).unwrap().body(),
        "Current canonical state without managed identity metadata"
    );
    assert!(matches!(
        history.reconstruct(&removed_revision),
        Err(HistoryError::Missing(_))
    ));
    let markers = timeline.deletion_markers().unwrap();
    assert_eq!(markers.len(), 1);
    assert_eq!(markers[0].scope(), &DeletionScope::Note(note_id));
    assert_eq!(markers[0].kind(), HistoryDeletionKind::Clear);
    assert_eq!(markers[0].payload_version(), PayloadVersion::V1);
    assert_eq!(markers[0].operation_id().as_str().len(), 26);
    assert!((before_clear..=after_clear).contains(&markers[0].occurred_at_millis()));
    assert_eq!(markers[0].history_generation(), 1);
    assert!(!format!("{markers:?}").contains("First retained state"));
    assert!(!format!("{markers:?}").contains("Current canonical state without"));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn clearing_vault_history_rebaselines_each_active_note_but_retains_missing_timelines() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-clear-vault-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-clear-vault-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let mut created = Vec::new();
    for title in ["Alpha", "Beta", "Missing"] {
        let session =
            save_retained_state(&state, title.to_string(), format!("{title} original"), None)
                .unwrap()
                .unwrap();
        created.push((
            NoteIdentity::new(session.note_id.unwrap()),
            PathBuf::from(session.path.unwrap()),
        ));
    }
    for (note_id, path) in &created[..2] {
        save_retained_state(
            &state,
            path.file_stem().unwrap().to_string_lossy().into_owned(),
            format!("{} current", note_id.as_str()),
            Some(path.to_string_lossy().into_owned()),
        )
        .unwrap();
    }
    fs::write(&created[1].1, "Beta current without managed metadata").unwrap();
    let active_bytes = created[..2]
        .iter()
        .map(|(_, path)| fs::read(path).unwrap())
        .collect::<Vec<_>>();
    fs::remove_file(&created[2].1).unwrap();

    let receipt = state
        .note_timeline()
        .clear_vault_history(notes.path())
        .unwrap();

    assert_eq!(
        &receipt.marker.scope,
        &DeletionScope::Vault(
            crate::state::read_vault_manifest_for(notes.path())
                .unwrap()
                .unwrap()
                .vault_id
        )
    );
    assert_eq!(receipt.marker.kind, HistoryDeletionKind::Clear);
    assert_eq!(receipt.baseline_note_ids().len(), 2);
    for (index, (note_id, path)) in created[..2].iter().enumerate() {
        assert_eq!(fs::read(path).unwrap(), active_bytes[index]);
        let revisions = state
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id.clone()))
            .revisions()
            .unwrap();
        assert_eq!(revisions.len(), 1);
        assert_eq!(
            revisions[0].source(),
            MutationSource::BaselineInitialization
        );
        if index == 1 {
            assert_eq!(
                state
                    .note_timeline()
                    .history_mode(HistoryModeGrant::authorized(note_id.clone()))
                    .reconstruct(revisions[0].identity())
                    .unwrap()
                    .body(),
                "Beta current without managed metadata"
            );
        }
    }
    let missing_revisions = state
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(created[2].0.clone()))
        .revisions()
        .unwrap();
    assert_eq!(missing_revisions.len(), 1);
    assert_eq!(missing_revisions[0].source(), MutationSource::NoteCreation);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn purging_a_note_removes_its_complete_timeline_and_all_revision_dependents() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-purge-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-purge-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Purge me".to_string(),
        "Secret first state".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    save_retained_state(
        &state,
        "Purge me".to_string(),
        "Secret current state".to_string(),
        Some(path.to_string_lossy().into_owned()),
    )
    .unwrap();
    let history = state
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(note_id.clone()));
    let removed_revision = history.revisions().unwrap()[0].identity().clone();
    history_store::seed_revision_dependents_for_test(
        &history_store::Store::for_test(),
        &removed_revision,
    );
    assert_eq!(
        history_store::revision_dependent_count_for_test(
            &history_store::Store::for_test(),
            &note_id
        ),
        2
    );
    let removed_canonical = fs::read_to_string(&path).unwrap();
    assert_eq!(
        state.indexed_note_identity(&path).unwrap().as_deref(),
        Some(note_id.as_str())
    );

    state
        .note_timeline()
        .lifecycle(NoteLifecycleOperation::purged(
            note_id.clone(),
            path.clone(),
            700,
        ))
        .unwrap();

    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = restarted.note_timeline();
    let history = timeline.history_mode(HistoryModeGrant::authorized(note_id.clone()));
    assert!(history.revisions().unwrap().is_empty());
    assert!(history.lifecycle_events().unwrap().is_empty());
    assert!(matches!(
        history.reconstruct(&removed_revision),
        Err(HistoryError::Missing(_))
    ));
    assert_eq!(
        history_store::revision_dependent_count_for_test(
            &history_store::Store::for_test(),
            &note_id
        ),
        0
    );
    assert_eq!(
        history_store::current_path(&history_store::Store::for_test(), &note_id).unwrap(),
        None
    );
    assert_eq!(state.indexed_note_identity(&path).unwrap(), None);
    let markers = timeline.deletion_markers().unwrap();
    assert_eq!(markers.len(), 1);
    assert_eq!(markers[0].scope(), &DeletionScope::Note(note_id.clone()));
    assert_eq!(markers[0].kind(), HistoryDeletionKind::Purge);
    assert_eq!(markers[0].occurred_at_millis(), 700);
    assert!(history_store::record_baseline_revision_if_absent(
        &history_store::Store::for_test(),
        &note_id,
        &path,
        &removed_canonical,
        701,
    )
    .unwrap_err()
    .to_string()
    .contains("Purged Note Identity"));
    assert!(history.revisions().unwrap().is_empty());

    restarted
        .note_timeline()
        .lifecycle(NoteLifecycleOperation::purged(note_id, path, 702))
        .unwrap();
    assert_eq!(timeline.deletion_markers().unwrap().len(), 2);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn purge_staging_failure_keeps_canonical_history_and_projections_intact() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-purge-stage-failure-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-purge-stage-failure-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Keep me".to_string(),
        "Still readable".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    inject_purge_staging_failure_once();

    let error = state
        .note_timeline()
        .lifecycle(NoteLifecycleOperation::purged(
            note_id.clone(),
            path.clone(),
            700,
        ))
        .unwrap_err();

    assert!(error.to_string().contains("injected purge staging failure"));
    assert!(path.is_file());
    assert_eq!(
        state.indexed_note_identity(&path).unwrap().as_deref(),
        Some(note_id.as_str())
    );
    let timeline = state.note_timeline();
    assert!(!timeline
        .history_mode(HistoryModeGrant::authorized(note_id))
        .revisions()
        .unwrap()
        .is_empty());
    assert!(timeline.deletion_markers().unwrap().is_empty());
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn interrupted_purge_recovers_before_history_can_be_read_again() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-purge-interrupt-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-purge-interrupt-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Interrupted purge".to_string(),
        "Private history".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    inject_history_deletion_failure_once();

    let error = state
        .note_timeline()
        .lifecycle(NoteLifecycleOperation::purged(
            note_id.clone(),
            path.clone(),
            701,
        ))
        .unwrap_err();

    assert!(error
        .to_string()
        .contains("injected history deletion interruption"));
    assert!(!path.exists());
    let replacement = "---\ngneauxghts:\n  id: replacement-note\n  kind: note\n---\n\nReplacement";
    fs::write(&path, replacement).unwrap();
    drop(state);
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = restarted.note_timeline();
    assert_eq!(fs::read_to_string(&path).unwrap(), replacement);
    let history = timeline.history_mode(HistoryModeGrant::authorized(note_id.clone()));
    assert!(history.revisions().unwrap().is_empty());
    assert!(history.lifecycle_events().unwrap().is_empty());
    let markers = timeline.deletion_markers().unwrap();
    assert_eq!(markers.len(), 1);
    assert_eq!(markers[0].scope(), &DeletionScope::Note(note_id));
    assert_eq!(markers[0].kind(), HistoryDeletionKind::Purge);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn interrupted_clear_rolls_back_completely_and_retry_after_restart_succeeds() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-clear-interrupt-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-clear-interrupt-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Interrupted".to_string(),
        "Before".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = created.path.unwrap();
    save_retained_state(
        &state,
        "Interrupted".to_string(),
        "After".to_string(),
        Some(path),
    )
    .unwrap();
    inject_history_deletion_failure_once();

    let error = state
        .note_timeline()
        .clear_note_history(&note_id)
        .unwrap_err();

    assert!(error
        .to_string()
        .contains("injected history deletion interruption"));
    let history = state
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(note_id.clone()));
    assert_eq!(history.revisions().unwrap().len(), 2);
    assert!(state.note_timeline().deletion_markers().unwrap().is_empty());
    drop(state);
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    restarted
        .note_timeline()
        .clear_note_history(&note_id)
        .unwrap();
    let history = restarted
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(note_id));
    assert_eq!(history.revisions().unwrap().len(), 1);
    assert_eq!(
        history.revisions().unwrap()[0].source(),
        MutationSource::BaselineInitialization
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn storage_usage_distinguishes_immediate_logical_deletion_from_bounded_reclamation() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-storage-usage-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-storage-usage-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(&state, "Storage".to_string(), "Initial".to_string(), None)
        .unwrap()
        .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = created.path.unwrap();
    for revision in 0..24 {
        let body = (0..512)
            .map(|line| format!("revision-{revision:02}-line-{line:04}-{}", "x".repeat(48)))
            .collect::<Vec<_>>()
            .join("\n");
        save_retained_state(&state, "Storage".to_string(), body, Some(path.clone())).unwrap();
    }
    let timeline = state.note_timeline();
    assert_eq!(
        history_store::auto_vacuum_mode_for_test(&history_store::Store::for_test()),
        2
    );
    let retained = timeline.history_storage_usage().unwrap();

    timeline.clear_note_history(&note_id).unwrap();
    let logically_deleted = timeline.history_storage_usage().unwrap();

    assert!(logically_deleted.allocated_bytes() >= retained.allocated_bytes());
    assert!(logically_deleted.reclaimable_bytes() > retained.reclaimable_bytes());
    let first_compaction = timeline.compact_history_storage(32 * 1024).unwrap();
    assert_eq!(first_compaction.before(), &logically_deleted);
    assert!(first_compaction.reclaimed_bytes() <= 32 * 1024);
    assert!(first_compaction.after().allocated_bytes() <= logically_deleted.allocated_bytes());
    let mut usage = first_compaction.after().clone();
    for _ in 0..128 {
        if usage.reclaimable_bytes() == 0 {
            break;
        }
        let compaction = timeline.compact_history_storage(32 * 1024).unwrap();
        assert!(compaction.reclaimed_bytes() <= 32 * 1024);
        usage = compaction.after().clone();
    }
    assert_eq!(usage.reclaimable_bytes(), 0);
    assert!(usage.allocated_bytes() < logically_deleted.allocated_bytes());
    let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
    assert_eq!(history.revisions().unwrap().len(), 1);
    assert_eq!(timeline.deletion_markers().unwrap().len(), 1);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn existing_managed_note_gets_one_truthful_baseline_without_a_markdown_write() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-baseline-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-baseline-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let path = notes.path().join("Existing.md");
    let markdown =
        "---\ngneauxghts:\n  id: existing-note\n  kind: note\n---\n\n# Existing\n\nKnown content";
    fs::write(&path, markdown).unwrap();
    let before_bytes = fs::read(&path).unwrap();
    let before_known = crate::time::current_time_millis().unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();

    let progress = state
        .note_timeline()
        .initialize_existing_notes(notes.path())
        .unwrap();
    let after_known = crate::time::current_time_millis().unwrap();

    assert_eq!(progress.phase(), BaselineInitializationPhase::Complete);
    assert_eq!(progress.discovered_notes(), 1);
    assert_eq!(progress.baseline_revisions(), 1);
    assert_eq!(fs::read(&path).unwrap(), before_bytes);
    let history = state
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "existing-note",
        )));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 1);
    assert_eq!(
        revisions[0].source(),
        MutationSource::BaselineInitialization
    );
    assert_eq!(revisions[0].committed_at_millis(), None);
    assert_eq!(revisions[0].observed_at_millis(), None);
    assert!(revisions[0]
        .known_since_millis()
        .is_some_and(|known| (before_known..=after_known).contains(&known)));
    assert_eq!(
        history.reconstruct(revisions[0].identity()).unwrap().body(),
        "# Existing\n\nKnown content"
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn first_mutation_synchronously_baselines_the_existing_canonical_state() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-baseline-race-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-baseline-race-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let path = notes.path().join("Existing.md");
    let original =
        "---\ngneauxghts:\n  id: raced-note\n  kind: note\n---\n\n# Existing\n\nBefore edit";
    fs::write(&path, original).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();

    save_retained_state(
        &state,
        "Existing".to_string(),
        "# Existing\n\nAfter edit".to_string(),
        Some(path.to_string_lossy().into_owned()),
    )
    .unwrap();

    let history = state
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "raced-note",
        )));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 2);
    assert_eq!(
        revisions[0].source(),
        MutationSource::BaselineInitialization
    );
    assert_eq!(revisions[1].source(), MutationSource::Editor);
    assert_eq!(
        history.reconstruct(revisions[0].identity()).unwrap().body(),
        "# Existing\n\nBefore edit"
    );
    assert_eq!(
        history.reconstruct(revisions[1].identity()).unwrap().body(),
        "# Existing\n\nAfter edit"
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn first_watcher_observation_races_to_the_same_single_baseline() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-baseline-watcher-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-baseline-watcher-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let path = notes.path().join("Observed.md");
    let markdown =
        "---\ngneauxghts:\n  id: observed-before-scan\n  kind: note\n---\n\nObserved content";
    fs::write(&path, markdown).unwrap();
    let initialization_started = crate::time::current_time_millis().unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();

    let start = Arc::new(Barrier::new(2));
    thread::scope(|scope| {
        let initialization_start = Arc::clone(&start);
        let state_ref = &state;
        let notes_path = notes.path();
        let initializer = scope.spawn(move || {
            initialization_start.wait();
            state_ref
                .note_timeline()
                .initialize_existing_notes(notes_path)
                .unwrap()
        });
        let observation_start = Arc::clone(&start);
        let observed_path = path.clone();
        let observed_markdown = markdown.to_string();
        let state_ref = &state;
        let observer = scope.spawn(move || {
            observation_start.wait();
            state_ref
                .note_timeline()
                .observe(
                    VaultObservation::external_edit(observed_path, 500, Some(450))
                        .with_canonical_markdown(observed_markdown),
                )
                .unwrap()
        });
        initializer.join().unwrap();
        observer.join().unwrap();
    });

    let history = timeline.history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
        "observed-before-scan",
    )));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 1);
    assert_eq!(
        revisions[0].source(),
        MutationSource::BaselineInitialization
    );
    let initialization_finished = crate::time::current_time_millis().unwrap();
    let known_since = revisions[0].known_since_millis().unwrap();
    // Either contender may establish the one baseline. The watcher uses
    // its observation time; initialization records when it reads the file.
    assert!(
        known_since == 500
            || (initialization_started..=initialization_finished).contains(&known_since)
    );
    assert_eq!(
        history.reconstruct(revisions[0].identity()).unwrap().body(),
        "Observed content"
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn first_external_observation_after_initialization_is_an_external_edit() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-post-baseline-watcher-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-post-baseline-watcher-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    timeline.initialize_existing_notes(notes.path()).unwrap();

    let path = notes.path().join("Added later.md");
    let markdown = "---\ngneauxghts:\n  id: added-after-baseline\n  kind: note\n---\n\nAdded later";
    fs::write(&path, markdown).unwrap();
    timeline
        .observe(
            VaultObservation::external_edit(path, 600, Some(550))
                .with_canonical_markdown(markdown.to_string()),
        )
        .unwrap();

    let history = timeline.history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
        "added-after-baseline",
    )));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 1);
    assert_eq!(revisions[0].source(), MutationSource::ExternalEdit);
    assert_eq!(
        revisions[0].time_evidence(),
        RevisionTimeEvidence::Observed {
            observed_at_millis: 600,
            modified_at_millis: Some(550),
        }
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn initialization_diagnostics_and_note_state_survive_restart_and_repeat() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-baseline-status-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-baseline-status-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let path = notes.path().join("Existing.md");
    let markdown = "---\ngneauxghts:\n  id: status-note\n  kind: note\n---\n\nStatus content";
    fs::write(&path, markdown).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    timeline.initialize_existing_notes(notes.path()).unwrap();
    let first_revision = timeline
        .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "status-note",
        )))
        .revisions()
        .unwrap()[0]
        .identity()
        .clone();
    drop(state);

    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = restarted.note_timeline();
    let progress = timeline.baseline_initialization_progress().unwrap();
    assert_eq!(progress.phase(), BaselineInitializationPhase::Complete);
    assert_eq!(progress.discovered_notes(), 1);
    assert_eq!(progress.baseline_revisions(), 1);
    assert_eq!(progress.ready_notes(), 1);
    assert_eq!(progress.failed_notes(), 0);
    assert!(matches!(
        timeline
            .note_baseline_initialization_state(&NoteIdentity::new("status-note"))
            .unwrap(),
        NoteBaselineInitializationState::Initialized {
            known_since_millis: Some(_)
        }
    ));

    let repeated = timeline.initialize_existing_notes(notes.path()).unwrap();
    assert_eq!(repeated.baseline_revisions(), 1);
    let revisions = timeline
        .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "status-note",
        )))
        .revisions()
        .unwrap();
    assert_eq!(revisions.len(), 1);
    assert_eq!(revisions[0].identity(), &first_revision);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn initialization_preserves_damaged_identity_continuity_without_rewriting_it() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-baseline-damaged-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-baseline-damaged-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let valid_path = notes.path().join("Valid.md");
    let valid = "---\ngneauxghts:\n  id: valid-baseline\n  kind: note\n---\n\nValid";
    fs::write(&valid_path, valid).unwrap();
    let damaged_path = notes.path().join("Damaged.md");
    let damaged = "---\ngneauxghts:\n  id: \n  kind: note\n---\n\nDamaged";
    fs::write(&damaged_path, damaged).unwrap();
    fs::write(
        notes.path().join("Legacy.md"),
        "Legacy without managed data",
    )
    .unwrap();
    fs::write(
        notes.path().join("Chat.md"),
        "---\ngneauxghts:\n  id: chat-projection\n  kind: chatTranscript\n---\n\nChat",
    )
    .unwrap();
    let damaged_before = fs::read(&damaged_path).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();

    let progress = state
        .note_timeline()
        .initialize_existing_notes(notes.path())
        .unwrap();

    assert_eq!(progress.phase(), BaselineInitializationPhase::Complete);
    assert_eq!(progress.discovered_notes(), 2);
    assert_eq!(progress.baseline_revisions(), 2);
    assert_eq!(progress.ready_notes(), 2);
    assert_eq!(progress.failed_notes(), 0);
    assert_eq!(progress.last_error(), None);
    assert_eq!(fs::read(&damaged_path).unwrap(), damaged_before);

    drop(state);
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let saved = save_retained_state(
        &restarted,
        "Damaged".to_string(),
        "Edited after restart".to_string(),
        Some(damaged_path.to_string_lossy().into_owned()),
    )
    .unwrap()
    .unwrap();
    let repaired_note_id = saved.note_id.unwrap();
    let revisions = restarted
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            repaired_note_id,
        )))
        .revisions()
        .unwrap();
    assert_eq!(revisions.len(), 2);
    assert_eq!(
        revisions[0].source(),
        MutationSource::BaselineInitialization
    );
    assert_eq!(revisions[1].source(), MutationSource::Editor);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn initialization_failure_is_attributed_to_the_resolved_damaged_identity() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-damaged-failure-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-damaged-failure-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let path = notes.path().join("Damaged.md");
    fs::write(
        &path,
        "---\ngneauxghts:\n  id: \n  kind: note\n---\n\nDamaged",
    )
    .unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    inject_history_baseline_failure_once();

    let progress = state
        .note_timeline()
        .initialize_existing_notes(notes.path())
        .unwrap();

    assert_eq!(progress.phase(), BaselineInitializationPhase::Degraded);
    let failed_note_ids =
        history_store::baseline_failure_note_ids(&history_store::Store::for_test());
    assert_eq!(failed_note_ids.len(), 1);
    let resolved_note_id = &failed_note_ids[0];
    assert!(!resolved_note_id.trim().is_empty());
    assert!(matches!(
        state.note_timeline()
            .note_baseline_initialization_state(&NoteIdentity::new(resolved_note_id.clone()))
            .unwrap(),
        NoteBaselineInitializationState::Failed { error }
            if error.contains("injected Baseline Revision failure")
    ));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn interrupted_large_initialization_resumes_idempotently_after_restart() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-baseline-resume-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-baseline-resume-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    for index in 0..64 {
        fs::write(
            notes.path().join(format!("Note {index:02}.md")),
            format!(
                "---\ngneauxghts:\n  id: baseline-{index:02}\n  kind: note\n---\n\nContent {index}"
            ),
        )
        .unwrap();
    }
    let first_state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    inject_history_baseline_failure_once();
    let degraded = first_state
        .note_timeline()
        .initialize_existing_notes(notes.path())
        .unwrap();
    assert_eq!(degraded.phase(), BaselineInitializationPhase::Degraded);
    assert_eq!(degraded.failed_notes(), 1);
    assert!(degraded
        .last_error()
        .is_some_and(|error| error.contains("injected Baseline Revision failure")));
    assert_eq!(
        first_state
            .note_timeline()
            .baseline_initialization_progress()
            .unwrap()
            .phase(),
        BaselineInitializationPhase::Degraded
    );
    assert!(matches!(
        first_state.note_timeline()
            .note_baseline_initialization_state(&NoteIdentity::new("baseline-00"))
            .unwrap(),
        NoteBaselineInitializationState::Failed { error }
            if error.contains("injected Baseline Revision failure")
    ));
    drop(first_state);

    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let progress = restarted
        .note_timeline()
        .initialize_existing_notes(notes.path())
        .unwrap();
    assert_eq!(progress.phase(), BaselineInitializationPhase::Complete);
    assert_eq!(progress.discovered_notes(), 64);
    assert_eq!(progress.baseline_revisions(), 64);
    assert_eq!(progress.ready_notes(), 64);
    assert_eq!(progress.failed_notes(), 0);
    for index in 0..64 {
        let revisions = restarted
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(format!(
                "baseline-{index:02}"
            ))))
            .revisions()
            .unwrap();
        assert_eq!(revisions.len(), 1);
        assert_eq!(
            revisions[0].source(),
            MutationSource::BaselineInitialization
        );
    }
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn reopening_detects_manifest_and_history_store_generation_mismatch() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-generation-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-generation-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let path = notes.path().join("Existing.md");
    fs::write(
        &path,
        "---\ngneauxghts:\n  id: generation-note\n  kind: note\n---\n\nContent",
    )
    .unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    state
        .note_timeline()
        .initialize_existing_notes(notes.path())
        .unwrap();
    drop(state);

    let manifest_path = crate::state::vault_manifest_path_for(notes.path());
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["historyGeneration"] = serde_json::json!(2);
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    let reopened = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();

    let error = reopened
        .note_timeline()
        .baseline_initialization_progress()
        .expect_err("mismatched selected generation must not open silently");
    assert!(error.to_string().contains("generation mismatch"));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn clean_close_reports_portability_and_stops_new_timeline_mutations() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-clean-close-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-clean-close-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let path = notes.path().join("Portable.md");
    fs::write(
        &path,
        "---\ngneauxghts:\n  id: portable-note\n  kind: note\n---\n\nPortable content",
    )
    .unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    timeline.initialize_existing_notes(notes.path()).unwrap();
    let prepared = timeline
        .prepare_revision_publication(
            MutationSource::Editor,
            &path,
            Some(&path),
            Some(&NoteIdentity::new("portable-note")),
            "Prepared but never published",
        )
        .unwrap();
    assert_eq!(prepared_history_intent_count_for_test("prepared"), 1);

    thread::scope(|scope| {
        let (closed_tx, closed_rx) = mpsc::channel();
        let close_state = &state;
        let vault_root = notes.path();
        let close = scope.spawn(move || {
            let result = close_state.note_timeline().clean_close(vault_root);
            closed_tx.send(()).unwrap();
            result
        });
        assert!(closed_rx.recv_timeout(Duration::from_millis(50)).is_err());
        let (_, history_intent) = prepared.into_parts();
        history_intent.abandon().unwrap();
        closed_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        close.join().unwrap().unwrap();
    });
    assert_eq!(
        history_store::prepared_intent_count_without_opening_store(
            &history_store::Store::for_test(),
            "prepared"
        ),
        0
    );
    let error = timeline
        .prepare_revision_publication(
            MutationSource::Editor,
            &path,
            Some(&path),
            Some(&NoteIdentity::new("portable-note")),
            "Portable content changed",
        )
        .expect_err("a cleanly closed application state must admit no new mutations");
    assert!(error.to_string().contains("cleanly closed"));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn failed_clean_close_reports_failure_and_allows_a_retry() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-failed-close-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-failed-close-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let path = notes.path().join("Retry.md");
    fs::write(
        &path,
        "---\ngneauxghts:\n  id: retry-close-note\n  kind: note\n---\n\nRetry content",
    )
    .unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    timeline.initialize_existing_notes(notes.path()).unwrap();
    inject_history_clean_close_failure_once();

    let error = timeline
        .clean_close(notes.path())
        .expect_err("a failed checkpoint must not report portability");
    assert!(error
        .to_string()
        .contains("injected history connection close failure"));
    timeline
        .prepare_revision_publication(
            MutationSource::Editor,
            &path,
            Some(&path),
            Some(&NoteIdentity::new("retry-close-note")),
            "Retry content changed",
        )
        .expect("failed close must leave mutation admission available for retry");
    timeline.clean_close(notes.path()).unwrap();
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn opening_a_live_main_file_only_copy_requires_explicit_recovery() {
    let _guard = crate::test_support::lock_test_env();
    let source_app_data = crate::test_support::TestDir::new("timeline-live-copy-source-app-data");
    crate::state::initialize_app_data_dir(source_app_data.path().to_path_buf()).unwrap();
    let source = crate::test_support::TestDir::new("timeline-live-copy-source");
    crate::state::set_notes_root_override(Some(source.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(source.path()).unwrap();
    let note_path = source.path().join("Live.md");
    fs::write(
        &note_path,
        "---\ngneauxghts:\n  id: live-copy-note\n  kind: note\n---\n\nLive content",
    )
    .unwrap();
    let source_state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    source_state
        .note_timeline()
        .initialize_existing_notes(source.path())
        .unwrap();

    let copied = crate::test_support::TestDir::new("timeline-live-copy-destination");
    copy_file(&note_path, &copied.path().join("Live.md"));
    copy_file(
        &source.path().join(".gneauxghts/vault.json"),
        &copied.path().join(".gneauxghts/vault.json"),
    );
    copy_file(
        &history_store::history_database_path_for_test(source.path()),
        &history_store::history_database_path_for_test(copied.path()),
    );
    drop(source_state);

    let destination_app_data =
        crate::test_support::TestDir::new("timeline-live-copy-destination-app-data");
    crate::state::initialize_app_data_dir(destination_app_data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(copied.path().to_path_buf())).unwrap();
    let copied_state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();

    let error = copied_state
        .note_timeline()
        .baseline_initialization_progress()
        .expect_err("a live main-file-only copy must not be accepted as portable");
    assert!(error.to_string().contains("unsupported live copy"));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn reopening_rejects_an_older_clean_close_watermark_from_the_same_generation() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-watermark-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-watermark-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    fs::write(
        notes.path().join("Watermark.md"),
        "---\ngneauxghts:\n  id: watermark-note\n  kind: note\n---\n\nWatermark content",
    )
    .unwrap();
    let first_state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let first_timeline = first_state.note_timeline();
    first_timeline
        .initialize_existing_notes(notes.path())
        .unwrap();
    first_timeline.clean_close(notes.path()).unwrap();
    let database = history_store::history_database_path_for_test(notes.path());
    let older_clean_copy = notes.path().join(".gneauxghts/history-older.sqlite3");
    fs::copy(&database, &older_clean_copy).unwrap();
    drop(first_state);

    let second_state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let second_timeline = second_state.note_timeline();
    second_timeline.baseline_initialization_progress().unwrap();
    second_timeline.clean_close(notes.path()).unwrap();
    drop(second_state);
    fs::copy(&older_clean_copy, &database).unwrap();

    let rolled_back_state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let error = rolled_back_state
        .note_timeline()
        .baseline_initialization_progress()
        .expect_err("an older clean store from the same generation must require recovery");
    assert!(error.to_string().contains("clean-close watermark rollback"));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn app_restart_recovers_a_same_installation_store_from_wal_without_shm() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-wal-recovery-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let source = crate::test_support::TestDir::new("timeline-wal-recovery-source");
    crate::state::set_notes_root_override(Some(source.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(source.path()).unwrap();
    let source_note = source.path().join("Wal.md");
    fs::write(
        &source_note,
        "---\ngneauxghts:\n  id: wal-recovery-note\n  kind: note\n---\n\nBefore recovery",
    )
    .unwrap();
    let source_state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    source_state
        .note_timeline()
        .initialize_existing_notes(source.path())
        .unwrap();
    let keepalive =
        history_store::hold_history_store_open_for_test(&history_store::Store::for_test());
    save_retained_state(
        &source_state,
        "Wal".to_string(),
        "After recovery".to_string(),
        Some(source_note.to_string_lossy().into_owned()),
    )
    .unwrap();
    let source_access = source_state
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "wal-recovery-note",
        )));
    let expected_header = source_access.revisions().unwrap().last().unwrap().clone();
    let expected_revision = source_access
        .reconstruct(expected_header.identity())
        .unwrap();
    let source_database = history_store::history_database_path_for_test(source.path());
    let source_wal = history_store::history_wal_path_for_test(source.path());
    assert!(fs::metadata(&source_wal).unwrap().len() > 0);

    let restarted = crate::test_support::TestDir::new("timeline-wal-recovery-restarted");
    copy_file(&source_note, &restarted.path().join("Wal.md"));
    copy_file(
        &source.path().join(".gneauxghts/vault.json"),
        &restarted.path().join(".gneauxghts/vault.json"),
    );
    copy_file(
        &source_database,
        &history_store::history_database_path_for_test(restarted.path()),
    );
    copy_file(
        &source_wal,
        &history_store::history_wal_path_for_test(restarted.path()),
    );
    assert!(!history_store::history_shm_path_for_test(restarted.path()).exists());
    drop(source_access);
    drop(keepalive);
    drop(source_state);

    crate::state::set_notes_root_override(Some(restarted.path().to_path_buf())).unwrap();
    let restarted_state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let restarted_access =
        restarted_state
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                "wal-recovery-note",
            )));
    let recovered_header = restarted_access
        .revisions()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    let recovered_revision = restarted_access
        .reconstruct(recovered_header.identity())
        .unwrap();
    assert_eq!(recovered_header.identity(), expected_header.identity());
    assert_eq!(
        recovered_header.content_hash(),
        expected_header.content_hash()
    );
    assert_eq!(recovered_revision, expected_revision);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn reopening_rejects_a_missing_store_for_an_observed_generation() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-missing-store-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-missing-store-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    fs::write(
        notes.path().join("Existing.md"),
        "---\ngneauxghts:\n  id: missing-store-note\n  kind: note\n---\n\nContent",
    )
    .unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    timeline.initialize_existing_notes(notes.path()).unwrap();
    history_store::remove_history_store(&history_store::Store::for_test());

    let error = timeline
        .baseline_initialization_progress()
        .expect_err("missing selected history must require explicit recovery");
    assert!(error.to_string().contains("missing or uninitialized"));
    assert!(!history_store::history_store_exists(
        &history_store::Store::for_test()
    ));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn initialization_and_reset_reject_a_non_active_vault_root() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-root-mismatch-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let active = crate::test_support::TestDir::new("timeline-root-mismatch-active");
    let other = crate::test_support::TestDir::new("timeline-root-mismatch-other");
    crate::state::set_notes_root_override(Some(active.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(active.path()).unwrap();
    ensure_vault_scaffold(other.path()).unwrap();
    fs::write(
        active.path().join("Active.md"),
        "---\ngneauxghts:\n  id: active-root-note\n  kind: note\n---\n\nActive",
    )
    .unwrap();
    fs::write(
        other.path().join("Other.md"),
        "---\ngneauxghts:\n  id: other-root-note\n  kind: note\n---\n\nOther",
    )
    .unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    timeline.initialize_existing_notes(active.path()).unwrap();

    assert!(timeline
        .initialize_existing_notes(other.path())
        .expect_err("initialization must use the active vault")
        .to_string()
        .contains("vault root mismatch"));
    assert!(timeline
        .reset_history(other.path())
        .expect_err("reset must use the active vault")
        .to_string()
        .contains("vault root mismatch"));
    assert_eq!(
        timeline
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                "active-root-note",
            )))
            .revisions()
            .unwrap()
            .len(),
        1
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn reopening_detects_rollback_of_both_manifest_and_history_store() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-rollback-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-rollback-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    fs::write(
        notes.path().join("Existing.md"),
        "---\ngneauxghts:\n  id: rollback-note\n  kind: note\n---\n\nContent",
    )
    .unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    timeline.initialize_existing_notes(notes.path()).unwrap();
    timeline.reset_history(notes.path()).unwrap();

    let manifest_path = crate::state::vault_manifest_path_for(notes.path());
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["historyGeneration"] = serde_json::json!(1);
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    history_store::replace_history_generation(&history_store::Store::for_test(), 1);

    let error = timeline
        .baseline_initialization_progress()
        .expect_err("a synchronized rollback must not be accepted silently");
    assert!(error.to_string().contains("generation rollback"));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn development_reset_advances_generation_and_rebuilds_truthful_baselines() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-reset-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-reset-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let path = notes.path().join("Existing.md");
    let markdown =
        "---\ngneauxghts:\n  id: reset-note\n  kind: note\n---\n\nRetained current content";
    fs::write(&path, markdown).unwrap();
    let original_bytes = fs::read(&path).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    timeline.initialize_existing_notes(notes.path()).unwrap();
    let original_revision = timeline
        .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "reset-note",
        )))
        .revisions()
        .unwrap()[0]
        .identity()
        .clone();

    let reset = timeline.reset_history(notes.path()).unwrap();

    assert_eq!(reset.previous_generation(), 1);
    assert_eq!(reset.generation(), 2);
    assert!(!reset.operation_id().is_empty());
    assert!(reset.reset_at_millis() > 0);
    assert_eq!(
        reset.initialization().phase(),
        BaselineInitializationPhase::Complete
    );
    assert_eq!(fs::read(&path).unwrap(), original_bytes);
    let history = timeline.history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
        "reset-note",
    )));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 1);
    assert_ne!(revisions[0].identity(), &original_revision);
    assert_eq!(
        revisions[0].source(),
        MutationSource::BaselineInitialization
    );
    assert!(history.reconstruct(&original_revision).is_err());
    let manifest = crate::state::read_vault_manifest_for(notes.path())
        .unwrap()
        .unwrap();
    assert_eq!(manifest.history_generation, 2);
    let operation_id = reset.operation_id().to_string();
    drop(history);
    drop(state);
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let durable_reset = restarted
        .note_timeline()
        .latest_history_reset()
        .unwrap()
        .expect("reset diagnostic survives replacement and restart");
    assert_eq!(durable_reset.operation_id(), operation_id);
    assert_eq!(durable_reset.previous_generation(), 1);
    assert_eq!(durable_reset.generation(), 2);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn failed_reset_rebuild_keeps_the_replacement_timeline_unavailable_until_retry() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-reset-rebuild-failure-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-reset-rebuild-failure-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    fs::write(
        notes.path().join("Existing.md"),
        "---\ngneauxghts:\n  id: reset-rebuild-note\n  kind: note\n---\n\nCanonical content",
    )
    .unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    timeline.initialize_existing_notes(notes.path()).unwrap();
    inject_history_baseline_failure_once();

    let error = timeline
        .reset_history(notes.path())
        .expect_err("an incomplete replacement must not become available");

    assert!(error.to_string().contains("did not rebuild completely"));
    history_store::clear_reset_rebuild_marker_for_test(&history_store::Store::for_test());
    drop(state);
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = restarted.note_timeline();
    assert_eq!(
        timeline.history_health().unwrap().state(),
        HistoryHealthState::Corrupt
    );
    assert!(timeline
        .open_history_mode(NoteIdentity::new("reset-rebuild-note"))
        .revisions()
        .expect_err("partial replacement remains inaccessible")
        .to_string()
        .contains("corrupt"));

    let retry = timeline
        .reset_corrupt_history(notes.path(), true)
        .expect("confirmed retry rebuilds the replacement");
    assert_eq!(
        retry.initialization().phase(),
        BaselineInitializationPhase::Complete
    );
    assert_eq!(
        timeline
            .open_history_mode(NoteIdentity::new("reset-rebuild-note"))
            .revisions()
            .unwrap()
            .len(),
        1
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn development_reset_refuses_to_discard_an_unreconstructable_missing_note() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-reset-bad-missing-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-reset-bad-missing-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Unreconstructable missing".to_string(),
        "Retained body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    fs::remove_file(&path).unwrap();
    let timeline = state.note_timeline();
    timeline
        .observe(VaultObservation::missing(
            path,
            crate::time::current_time_millis().unwrap() + 1,
        ))
        .unwrap();
    corrupt_note_revision_payload_for_test(&note_id);

    let error = timeline
        .reset_corrupt_history(notes.path(), true)
        .expect_err("reset must not erase an unreconstructable Missing Note");

    assert!(error.to_string().contains("Reconstruct"));
    assert_eq!(
        crate::state::read_vault_manifest_for(notes.path())
            .unwrap()
            .unwrap()
            .history_generation,
        1
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn development_reset_preserves_a_reconstructable_missing_note_for_recovery() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-reset-missing-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-reset-missing-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    crate::state::set_forgotten_note_retention_days(30).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Reset missing".to_string(),
        "Recoverable current body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    fs::remove_file(&path).unwrap();
    let missing_at = crate::time::current_time_millis().unwrap() + 1;
    let timeline = state.note_timeline();
    timeline
        .observe(VaultObservation::missing(path.clone(), missing_at))
        .unwrap();
    let before = timeline.missing_notes().unwrap().remove(0);

    let reset = timeline.reset_history(notes.path()).unwrap();

    assert_eq!(reset.initialization().discovered_notes(), 1);
    drop(state);
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = restarted.note_timeline();
    let after = timeline.missing_notes().unwrap().remove(0);
    assert_eq!(after.note_id(), &note_id);
    assert_eq!(after.path(), path);
    assert_eq!(after.missing_at_millis(), before.missing_at_millis());
    assert_eq!(after.retention_days(), before.retention_days());
    assert_eq!(after.purge_at_millis(), before.purge_at_millis());
    let recovery = timeline.recover_missing_note(note_id.clone()).unwrap();
    assert_eq!(
        crate::note::parse_note(&fs::read_to_string(recovery.receipt().path()).unwrap()).body,
        "Recoverable current body"
    );
    let access = timeline.open_history_mode(note_id);
    assert_eq!(access.revisions().unwrap().len(), 1);
    assert_eq!(
        access.revisions().unwrap()[0].source(),
        MutationSource::BaselineInitialization
    );
    assert_eq!(
        access
            .lifecycle_events()
            .unwrap()
            .into_iter()
            .map(|event| event.kind())
            .collect::<Vec<_>>(),
        vec![LifecycleEventKind::Missing, LifecycleEventKind::Recovered]
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn history_health_reports_initialization_storage_and_per_note_usage() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-health-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-health-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    fs::write(
        notes.path().join("Healthy.md"),
        "---\ngneauxghts:\n  id: healthy-note\n  kind: note\n---\n\nReadable Markdown",
    )
    .unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();

    let initializing = timeline.history_health().unwrap();
    assert_eq!(initializing.state(), HistoryHealthState::Initializing);
    assert_eq!(
        initializing.initialization().phase(),
        BaselineInitializationPhase::NotStarted
    );

    timeline.initialize_existing_notes(notes.path()).unwrap();
    let healthy = timeline.history_health().unwrap();
    assert_eq!(healthy.state(), HistoryHealthState::Healthy);
    assert_eq!(healthy.integrity(), HistoryIntegrityState::Verified);
    assert!(healthy.storage().unwrap().allocated_bytes() > 0);
    assert!(!healthy.can_retry());
    assert!(!healthy.can_reset());
    let serialized = serde_json::to_value(&healthy).unwrap();
    assert_eq!(serialized["state"], "healthy");
    assert_eq!(serialized["integrity"], "verified");
    assert_eq!(serialized["initialization"]["phase"], "complete");
    assert_eq!(
        serialized["storage"]["allocatedBytes"].as_u64().unwrap(),
        healthy.storage().unwrap().allocated_bytes()
    );

    let note = timeline
        .note_history_health(&NoteIdentity::new("healthy-note"))
        .unwrap();
    assert_eq!(note.state(), NoteHistoryHealthState::Healthy);
    assert_eq!(note.revision_count(), 1);
    assert_eq!(note.lifecycle_event_count(), 0);
    assert!(note.revision_payload_bytes() > 0);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn unavailable_history_is_actionable_without_hiding_markdown() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-unavailable-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-unavailable-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let path = notes.path().join("Readable.md");
    let markdown = "---\ngneauxghts:\n  id: readable-note\n  kind: note\n---\n\nReadable Markdown";
    fs::write(&path, markdown).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    timeline.initialize_existing_notes(notes.path()).unwrap();
    history_store::remove_history_store(&history_store::Store::for_test());

    let report = timeline.history_health().unwrap();
    assert_eq!(report.state(), HistoryHealthState::Unavailable);
    assert_eq!(report.integrity(), HistoryIntegrityState::Unavailable);
    assert!(report.storage().is_none());
    assert!(report.can_retry());
    assert!(report.can_reset());
    assert_eq!(fs::read_to_string(&path).unwrap(), markdown);

    let error = save_retained_state(
        &state,
        "Readable".to_string(),
        "Dirty editor work".to_string(),
        Some(path.to_string_lossy().into_owned()),
    )
    .expect_err("history preparation must still fail closed");
    assert!(error.to_string().contains("history store"));
    assert_eq!(fs::read_to_string(&path).unwrap(), markdown);

    let reset = timeline
        .reset_corrupt_history(notes.path(), true)
        .expect("unavailable history can be replaced from canonical Markdown");
    assert_eq!(reset.previous_generation(), 1);
    assert_eq!(reset.generation(), 2);
    assert_eq!(
        reset.initialization().phase(),
        BaselineInitializationPhase::Complete
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), markdown);
    assert_eq!(
        timeline
            .open_history_mode(NoteIdentity::new("readable-note"))
            .revisions()
            .unwrap()
            .len(),
        1
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn history_health_exposes_degraded_and_post_commit_warning_retry_paths() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-health-retry-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-health-retry-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    fs::write(
        notes.path().join("Existing.md"),
        "---\ngneauxghts:\n  id: retry-note\n  kind: note\n---\n\nExisting",
    )
    .unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    history_store::inject_fault_once(history_store::FaultPoint::Baseline);
    let progress = timeline.initialize_existing_notes(notes.path()).unwrap();
    assert_eq!(progress.phase(), BaselineInitializationPhase::Degraded);
    assert_eq!(
        timeline.history_health().unwrap().state(),
        HistoryHealthState::Degraded
    );
    assert_eq!(
        timeline
            .note_history_health(&NoteIdentity::new("retry-note"))
            .unwrap()
            .state(),
        NoteHistoryHealthState::Degraded
    );

    let retried = timeline.retry_history_recovery(notes.path()).unwrap();
    assert_eq!(retried.state(), HistoryHealthState::Healthy);
    assert_eq!(retried.initialization().failed_notes(), 0);

    inject_history_finalization_failure_once();
    let committed = save_retained_state(
        &state,
        "Existing".to_string(),
        "Published despite finalization warning".to_string(),
        Some(
            notes
                .path()
                .join("Existing.md")
                .to_string_lossy()
                .into_owned(),
        ),
    )
    .unwrap()
    .unwrap();
    assert!(committed.commit_warning.is_some());
    let warning = timeline.history_health().unwrap();
    assert_eq!(warning.state(), HistoryHealthState::Warning);
    assert!(warning.can_retry());

    let repaired = timeline.retry_history_recovery(notes.path()).unwrap();
    assert_eq!(repaired.state(), HistoryHealthState::Healthy);
    timeline
        .finalize_editing_window(&NoteIdentity::new("retry-note"))
        .unwrap();
    assert_eq!(
        timeline
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                "retry-note"
            )))
            .revisions()
            .unwrap()
            .len(),
        2
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn corrupt_note_history_can_be_confirmed_reset_and_diagnosed_after_restart() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-corrupt-reset-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-corrupt-reset-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let path = notes.path().join("Current.md");
    let markdown =
        "---\ngneauxghts:\n  id: corrupt-note\n  kind: note\n---\n\nCurrent readable state";
    fs::write(&path, markdown).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    timeline.initialize_existing_notes(notes.path()).unwrap();
    let original_revision = timeline
        .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "corrupt-note",
        )))
        .revisions()
        .unwrap()[0]
        .identity()
        .clone();
    history_store::seed_revision_dependents_for_test(
        &history_store::Store::for_test(),
        &original_revision,
    );
    assert_eq!(
        history_store::revision_dependent_count_for_test(
            &history_store::Store::for_test(),
            &NoteIdentity::new("corrupt-note")
        ),
        2
    );
    history_store::replace_revision_payload_version(
        &history_store::Store::for_test(),
        &NoteIdentity::new("corrupt-note"),
        99,
    );

    let report = timeline.history_health().unwrap();
    assert_eq!(report.state(), HistoryHealthState::Corrupt);
    assert_eq!(report.integrity(), HistoryIntegrityState::Corrupt);
    assert!(report.can_reset());
    assert_eq!(
        timeline
            .note_history_health(&NoteIdentity::new("corrupt-note"))
            .unwrap()
            .state(),
        NoteHistoryHealthState::Corrupt
    );
    let blocked = save_retained_state(
        &state,
        "Current".to_string(),
        "Dirty editor work must not publish".to_string(),
        Some(path.to_string_lossy().into_owned()),
    )
    .expect_err("corrupt history must block canonical publication");
    assert!(blocked.to_string().contains("history is corrupt"));
    assert_eq!(fs::read_to_string(&path).unwrap(), markdown);
    history_store::replace_revision_payload_version(
        &history_store::Store::for_test(),
        &NoteIdentity::new("corrupt-note"),
        1,
    );
    assert_eq!(
        timeline.history_health().unwrap().state(),
        HistoryHealthState::Corrupt,
        "only an explicit reset may clear a latched corrupt state"
    );
    assert_eq!(
        timeline
            .note_history_health(&NoteIdentity::new("corrupt-note"))
            .unwrap()
            .state(),
        NoteHistoryHealthState::Corrupt
    );
    assert!(timeline
        .reset_corrupt_history(notes.path(), false)
        .expect_err("reset requires explicit confirmation")
        .to_string()
        .contains("confirmation"));

    let reset = timeline.reset_corrupt_history(notes.path(), true).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), markdown);
    assert_eq!(reset.previous_generation(), 1);
    assert_eq!(reset.generation(), 2);
    let recovered = timeline.history_health().unwrap();
    assert_eq!(recovered.state(), HistoryHealthState::Healthy);
    assert_eq!(recovered.integrity(), HistoryIntegrityState::Verified);
    assert!(recovered.last_reset().is_some());
    assert!(timeline
        .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "corrupt-note"
        )))
        .reconstruct(&original_revision)
        .is_err());
    assert_eq!(
        history_store::revision_dependent_count_for_test(
            &history_store::Store::for_test(),
            &NoteIdentity::new("corrupt-note")
        ),
        0
    );

    let operation_id = reset.operation_id().to_string();
    drop(state);
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let after_restart = restarted.note_timeline().history_health().unwrap();
    assert_eq!(
        after_restart.last_reset().unwrap().operation_id(),
        operation_id
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn malformed_history_store_can_be_confirmed_reset_from_canonical_markdown() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-malformed-reset-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-malformed-reset-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let path = notes.path().join("Readable.md");
    let markdown =
        "---\ngneauxghts:\n  id: malformed-reset-note\n  kind: note\n---\n\nReadable truth";
    fs::write(&path, markdown).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    timeline.initialize_existing_notes(notes.path()).unwrap();
    history_store::replace_history_store_with_malformed_file_for_test(
        &history_store::Store::for_test(),
    );
    assert_eq!(
        timeline.history_health().unwrap().state(),
        HistoryHealthState::Corrupt
    );

    let reset = timeline
        .reset_corrupt_history(notes.path(), true)
        .expect("replace malformed history from canonical Markdown");

    assert_eq!(reset.previous_generation(), 1);
    assert_eq!(reset.generation(), 2);
    assert_eq!(fs::read_to_string(&path).unwrap(), markdown);
    assert_eq!(
        timeline
            .open_history_mode(NoteIdentity::new("malformed-reset-note"))
            .revisions()
            .unwrap()
            .len(),
        1
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn expired_missing_note_purges_its_timeline_without_deleting_path_reuse() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-missing-expiry-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-missing-expiry-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    crate::state::set_forgotten_note_retention_days(1).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Expire missing".to_string(),
        "Private retained body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    fs::remove_file(&path).unwrap();
    let missing_at = crate::time::current_time_millis().unwrap() + 1;
    let timeline = state.note_timeline();
    timeline
        .observe(VaultObservation::missing(path.clone(), missing_at))
        .unwrap();
    fs::write(&path, "Unrelated content at the old path").unwrap();

    timeline
        .purge_expired_missing_notes(missing_at + RECOVERY_DAY_MILLIS)
        .unwrap();

    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "Unrelated content at the old path"
    );
    assert!(timeline.missing_notes().unwrap().is_empty());
    assert!(
        history_store::revisions(&history_store::Store::for_test(), &note_id)
            .unwrap()
            .is_empty()
    );
    assert!(
        history_store::lifecycle_events(&history_store::Store::for_test(), &note_id)
            .unwrap()
            .is_empty()
    );
    assert!(
        history_store::missing_note(&history_store::Store::for_test(), &note_id)
            .unwrap()
            .is_none()
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn recovery_after_the_captured_deadline_purges_instead_of_recreating_the_note() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-expired-recovery-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-expired-recovery-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    crate::state::set_forgotten_note_retention_days(1).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Expired recovery".to_string(),
        "Must be purged".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    fs::remove_file(&path).unwrap();
    let timeline = state.note_timeline();
    timeline
        .observe(VaultObservation::missing(path.clone(), 1))
        .unwrap();

    let error = timeline.recover_missing_note(note_id.clone()).unwrap_err();

    assert!(error.to_string().contains("deadline expired"));
    assert!(!path.exists());
    assert!(
        history_store::missing_note(&history_store::Store::for_test(), &note_id)
            .unwrap()
            .is_none()
    );
    assert!(
        history_store::revisions(&history_store::Store::for_test(), &note_id)
            .unwrap()
            .is_empty()
    );
    assert!(
        history_store::lifecycle_events(&history_store::Store::for_test(), &note_id)
            .unwrap()
            .is_empty()
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn initialization_serialization_redacts_diagnostic_causes() {
    let progress = BaselineInitializationProgress {
        phase: BaselineInitializationPhase::Degraded,
        discovered_notes: 1,
        baseline_revisions: 0,
        ready_notes: 0,
        failed_notes: 1,
        last_error: Some("SELECT baseline FROM /private/timeline.db".to_string()),
    };

    let serialized = serde_json::to_string(&progress).unwrap();
    assert!(serialized.contains("Some notes could not be initialized"));
    assert!(!serialized.contains("SELECT"));
    assert!(!serialized.contains("/private"));
}
