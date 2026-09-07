#[test]
fn external_metadata_damage_preserves_known_identity_without_rewriting_until_commit() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-damaged-identity-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-damaged-identity-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let note_path = notes.path().join("Damaged.md");
    let original = "---\ngneauxghts:\n  id: stable-note-2\n  kind: note\n---\n\nOriginal";
    fs::write(&note_path, original).expect("write original note");
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .expect("construct app state");
    let timeline = state.note_timeline();
    let history_intent = prepare_test_history(MutationSource::Editor, &note_path, original);
    timeline.mutate(NoteMutation::editor(
        history_intent,
        note_path.clone(),
        None,
        original.to_string(),
    ));

    let damaged = "Externally changed without managed metadata";
    fs::write(&note_path, damaged).expect("damage managed metadata externally");
    timeline
        .observe(VaultObservation::external_edit(
            note_path.clone(),
            42,
            Some(41),
        ))
        .unwrap();
    state
        .upsert_note_indexes(
            note_path.clone(),
            crate::index::build_indexed_note(&note_path, damaged, 41),
        )
        .expect("apply observed catalog state");

    assert_eq!(fs::read_to_string(&note_path).unwrap(), damaged);
    assert_eq!(
        state.indexed_note_identity(&note_path).unwrap().as_deref(),
        Some("stable-note-2")
    );

    let saved = save_retained_state(
        &state,
        "Damaged".to_string(),
        damaged.to_string(),
        Some(note_path.to_string_lossy().into_owned()),
    )
    .expect("commit damaged note")
    .expect("saved session");
    assert_eq!(saved.note_id.as_deref(), Some("stable-note-2"));
    assert!(fs::read_to_string(&note_path)
        .unwrap()
        .contains("id: stable-note-2"));
}

#[test]
fn identity_follows_moves_disappearance_and_safe_reattachment_in_any_refresh_order() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-path-identity-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-path-identity-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let original_path = notes.path().join("Original.md");
    let moved_path = notes.path().join("Folder").join("Moved.md");
    let renamed_path = notes.path().join("Folder").join("Renamed.md");
    let reattached_path = notes.path().join("Reattached.md");
    let markdown = "---\ngneauxghts:\n  id: stable-path-note\n  kind: note\n---\n\nPath body";
    fs::write(&original_path, markdown).expect("write original note");
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .expect("construct app state");
    let timeline = state.note_timeline();
    let history_intent = prepare_test_history(MutationSource::Editor, &original_path, markdown);
    timeline.mutate(NoteMutation::editor(
        history_intent,
        original_path.clone(),
        None,
        markdown.to_string(),
    ));

    fs::create_dir_all(moved_path.parent().unwrap()).unwrap();
    fs::rename(&original_path, &moved_path).expect("move note");
    timeline
        .observe(VaultObservation::moved(
            original_path.clone(),
            moved_path.clone(),
            42,
        ))
        .unwrap();
    // Removal-first refresh preserves the reservation for the new path.
    state.remove_note_indexes(&original_path).unwrap();
    state
        .upsert_note_indexes(
            moved_path.clone(),
            crate::index::build_indexed_note(&moved_path, markdown, 42),
        )
        .unwrap();
    assert_eq!(
        state.indexed_note_identity(&moved_path).unwrap().as_deref(),
        Some("stable-path-note")
    );

    fs::rename(&moved_path, &renamed_path).expect("rename note");
    timeline
        .observe(VaultObservation::renamed(
            moved_path.clone(),
            renamed_path.clone(),
            43,
        ))
        .unwrap();
    // Upsert-first refresh also transfers the association safely.
    state
        .upsert_note_indexes(
            renamed_path.clone(),
            crate::index::build_indexed_note(&renamed_path, markdown, 43),
        )
        .unwrap();
    state.remove_note_indexes(&moved_path).unwrap();
    assert_eq!(
        state
            .indexed_note_identity(&renamed_path)
            .unwrap()
            .as_deref(),
        Some("stable-path-note")
    );

    fs::remove_file(&renamed_path).expect("temporarily remove note");
    timeline
        .observe(VaultObservation::missing(renamed_path.clone(), 44))
        .unwrap();

    let unrelated = "---\ngneauxghts:\n  id: unrelated-note\n  kind: note\n---\n\nUnrelated body";
    fs::write(&renamed_path, unrelated).expect("reuse disappeared path");
    timeline
        .observe(VaultObservation::external_edit(
            renamed_path.clone(),
            45,
            Some(45),
        ))
        .unwrap();
    state
        .upsert_note_indexes(
            renamed_path.clone(),
            crate::index::build_indexed_note(&renamed_path, unrelated, 45),
        )
        .unwrap();
    assert_eq!(
        state
            .indexed_note_identity(&renamed_path)
            .unwrap()
            .as_deref(),
        Some("unrelated-note")
    );

    fs::write(&reattached_path, markdown).expect("write stale copy elsewhere");
    let copy_receipt = timeline
        .observe(VaultObservation::external_edit(
            reattached_path.clone(),
            46,
            Some(46),
        ))
        .unwrap();
    assert_eq!(copy_receipt.kind(), VaultObservationKind::CanonicalState);
    state
        .upsert_note_indexes(
            reattached_path.clone(),
            crate::index::build_indexed_note(&reattached_path, markdown, 46),
        )
        .unwrap();
    let stale_copy_id = state
        .indexed_note_identity(&reattached_path)
        .unwrap()
        .expect("stale copy receives an identity");
    assert_ne!(stale_copy_id, "stable-path-note");

    fs::remove_file(&renamed_path).expect("remove unrelated path occupant");
    state.remove_note_indexes(&renamed_path).unwrap();
    fs::write(&renamed_path, markdown).expect("reattach at the missing path");
    let reattached = timeline
        .observe(VaultObservation::external_edit(
            renamed_path.clone(),
            47,
            Some(47),
        ))
        .unwrap();
    assert_eq!(
        reattached.kind(),
        VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached)
    );
    state
        .upsert_note_indexes(
            renamed_path.clone(),
            crate::index::build_indexed_note(&renamed_path, markdown, 47),
        )
        .unwrap();
    assert_eq!(
        state
            .indexed_note_identity(&renamed_path)
            .unwrap()
            .as_deref(),
        Some("stable-path-note")
    );

    let saved_copy = save_retained_state(
        &state,
        "Reattached".to_string(),
        "Path body".to_string(),
        Some(reattached_path.to_string_lossy().into_owned()),
    )
    .expect("commit stale copy identity")
    .expect("saved copy session");
    assert_eq!(saved_copy.note_id.as_deref(), Some(stale_copy_id.as_str()));

    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .expect("restart app state");
    restarted
        .prewarm_notes_index(notes.path())
        .expect("rebuild index after restart");
    assert_eq!(
        restarted
            .indexed_note_identity(&renamed_path)
            .unwrap()
            .as_deref(),
        Some("stable-path-note")
    );
    assert_eq!(
        restarted
            .indexed_note_identity(&reattached_path)
            .unwrap()
            .as_deref(),
        Some(stale_copy_id.as_str())
    );
}

#[test]
fn abandoned_move_reservation_cannot_assign_identity_to_a_later_unrelated_file() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-stale-transfer-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-stale-transfer-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let original_path = notes.path().join("Original.md");
    let target_path = notes.path().join("Target.md");
    let original = "---\ngneauxghts:\n  id: reserved-note\n  kind: note\n---\n\nReserved body";
    let unrelated = "---\ngneauxghts:\n  id: unrelated-target\n  kind: note\n---\n\nDifferent body";
    fs::write(&original_path, original).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    state
        .upsert_note_indexes(
            original_path.clone(),
            crate::index::build_indexed_note(&original_path, original, 41),
        )
        .unwrap();

    let _observation = state.note_timeline().observe(VaultObservation::moved(
        original_path.clone(),
        target_path.clone(),
        42,
    ));
    fs::write(&target_path, unrelated).unwrap();
    state
        .upsert_note_indexes(
            target_path.clone(),
            crate::index::build_indexed_note(&target_path, unrelated, 43),
        )
        .unwrap();

    assert_eq!(
        state
            .indexed_note_identity(&target_path)
            .unwrap()
            .as_deref(),
        Some("unrelated-target")
    );
    assert_eq!(
        state
            .indexed_note_identity(&original_path)
            .unwrap()
            .as_deref(),
        Some("reserved-note")
    );
}

#[test]
fn external_observation_records_each_distinct_canonical_state_once() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-external-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-external-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(&state, "External".to_string(), "Before".to_string(), None)
        .unwrap()
        .unwrap();
    let path = PathBuf::from(created.path.unwrap());
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let canonical = fs::read_to_string(&path).unwrap();
    let externally_edited = canonical.replacen("Before", "After external", 1);
    fs::write(&path, &externally_edited).unwrap();

    let timeline = state.note_timeline();
    timeline
        .observe(VaultObservation::external_edit(
            path.clone(),
            200,
            Some(150),
        ))
        .unwrap();
    timeline
        .observe(VaultObservation::external_edit(path, 201, Some(150)))
        .unwrap();

    let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 2);
    assert_eq!(revisions[1].source(), MutationSource::ExternalEdit);
    assert_eq!(
        revisions[1].time_evidence(),
        RevisionTimeEvidence::Observed {
            observed_at_millis: 200,
            modified_at_millis: Some(150),
        }
    );
    assert_eq!(
        history.reconstruct(revisions[1].identity()).unwrap().body(),
        "After external"
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn path_only_rename_records_one_lifecycle_event_and_no_revision() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-rename-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-rename-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(&state, "Before".to_string(), "Body".to_string(), None)
        .unwrap()
        .unwrap();
    let previous_path = PathBuf::from(created.path.unwrap());
    let path = notes.path().join("After.md");
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    fs::rename(&previous_path, &path).unwrap();
    let timeline = state.note_timeline();
    let observed_at = crate::time::current_time_millis().unwrap() + 1;

    timeline
        .observe(VaultObservation::renamed(
            &previous_path,
            &path,
            observed_at,
        ))
        .unwrap();
    timeline
        .observe(VaultObservation::renamed(
            &previous_path,
            &path,
            observed_at + 1,
        ))
        .unwrap();

    let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 1);
    let lifecycle_only_diff = history
        .diff(&revisions[0].identity().0, HistoryDiffComparison::Current)
        .unwrap();
    assert!(lifecycle_only_diff
        .body_lines()
        .iter()
        .all(|line| line.kind() == HistoryDiffLineKind::Context));
    assert!(lifecycle_only_diff
        .properties_lines()
        .iter()
        .all(|line| line.kind() == HistoryDiffLineKind::Context));
    assert!(lifecycle_only_diff
        .body_lines()
        .iter()
        .all(|line| { !line.text().contains("Before") && !line.text().contains("After.md") }));
    let events = history.lifecycle_events().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[1].kind(), LifecycleEventKind::Renamed);
    assert_eq!(events[1].occurred_at_millis(), observed_at);
    assert_eq!(events[1].previous_path(), Some(previous_path.as_path()));
    assert_eq!(events[1].path(), Some(path.as_path()));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn app_title_only_rename_records_lifecycle_without_duplicate_revision() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-app-rename-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-app-rename-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Before".to_string(),
        "Unchanged body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let previous_path = PathBuf::from(created.path.unwrap());
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let renamed = save_retained_state(
        &state,
        "After".to_string(),
        "Unchanged body".to_string(),
        Some(previous_path.to_string_lossy().into_owned()),
    )
    .unwrap()
    .unwrap();
    let path = PathBuf::from(renamed.path.unwrap());

    let timeline = state.note_timeline();
    let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 1);
    let lifecycle_only_diff = history
        .diff(&revisions[0].identity().0, HistoryDiffComparison::Current)
        .unwrap();
    assert!(lifecycle_only_diff
        .body_lines()
        .iter()
        .all(|line| line.kind() == HistoryDiffLineKind::Context));
    assert!(lifecycle_only_diff
        .body_lines()
        .iter()
        .all(|line| { !line.text().contains("Before") && !line.text().contains("After") }));
    let events = history.lifecycle_events().unwrap();
    assert_eq!(events.len(), 2);
    let rename = events
        .iter()
        .find(|event| event.kind() == LifecycleEventKind::Renamed)
        .unwrap();
    assert_eq!(rename.previous_path(), Some(previous_path.as_path()));
    assert_eq!(rename.path(), Some(path.as_path()));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn reconciliation_infers_a_missed_move_from_the_durable_current_path() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-missed-move-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-missed-move-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Before".to_string(),
        "Unchanged body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let previous_path = PathBuf::from(created.path.unwrap());
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = notes.path().join("Nested").join("After.md");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::rename(&previous_path, &path).unwrap();
    let markdown = fs::read_to_string(&path).unwrap();
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = restarted.note_timeline();
    let observed_at = crate::time::current_time_millis().unwrap() + 1;

    timeline
        .observe(
            VaultObservation::reconciled_state(path.clone(), observed_at, None)
                .with_canonical_markdown(markdown),
        )
        .unwrap();

    let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
    assert_eq!(history.revisions().unwrap().len(), 1);
    let events = history.lifecycle_events().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[1].kind(), LifecycleEventKind::Moved);
    assert_eq!(events[1].previous_path(), Some(previous_path.as_path()));
    assert_eq!(events[1].path(), Some(path.as_path()));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn keeping_dirty_local_content_after_an_external_edit_retains_both_states() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-conflict-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-conflict-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(&state, "Conflict".to_string(), "Original".to_string(), None)
        .unwrap()
        .unwrap();
    let path = PathBuf::from(created.path.unwrap());
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let external = fs::read_to_string(&path)
        .unwrap()
        .replacen("Original", "External", 1);
    fs::write(&path, &external).unwrap();
    let timeline = state.note_timeline();
    timeline
        .observe(
            VaultObservation::external_edit(path.clone(), 400, None)
                .with_canonical_markdown(external),
        )
        .unwrap();

    save_retained_state(
        &state,
        "Conflict".to_string(),
        "Dirty local kept".to_string(),
        Some(path.to_string_lossy().into_owned()),
    )
    .unwrap();

    let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
    let revisions = history.revisions().unwrap();
    assert_eq!(
        revisions
            .iter()
            .map(NoteRevisionHeader::source)
            .collect::<Vec<_>>(),
        vec![
            MutationSource::NoteCreation,
            MutationSource::ExternalEdit,
            MutationSource::Editor,
        ]
    );
    assert_eq!(
        history.reconstruct(revisions[1].identity()).unwrap().body(),
        "External"
    );
    assert_eq!(
        history.reconstruct(revisions[2].identity()).unwrap().body(),
        "Dirty local kept"
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn restart_reconciliation_catches_a_missed_external_state_once() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-reconcile-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-reconcile-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Reconcile".to_string(),
        "Before restart".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let path = PathBuf::from(created.path.unwrap());
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let external =
        fs::read_to_string(&path)
            .unwrap()
            .replacen("Before restart", "Missed while stopped", 1);
    fs::write(&path, &external).unwrap();
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = restarted.note_timeline();
    for observed_at in [500, 501] {
        timeline
            .observe(
                VaultObservation::reconciled_state(path.clone(), observed_at, None)
                    .with_canonical_markdown(external.clone()),
            )
            .unwrap();
    }

    let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 2);
    assert_eq!(revisions[1].source(), MutationSource::ExternalEdit);
    assert_eq!(
        history.reconstruct(revisions[1].identity()).unwrap().body(),
        "Missed while stopped"
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn observe_returns_a_typed_receipt_for_recorded_evidence() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-observe-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-observe-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .expect("construct app state");
    let path = notes.path().join("Observed.md");
    fs::write(&path, "Observed").unwrap();

    let receipt = state
        .note_timeline()
        .observe(VaultObservation::external_edit(path.clone(), 42, Some(41)))
        .unwrap();

    assert_eq!(receipt.path(), path);
    assert_eq!(receipt.source(), VaultObservationSource::Watcher);
    assert_eq!(receipt.kind(), VaultObservationKind::CanonicalState);
    assert_eq!(receipt.observed_at_millis(), 42);
    assert_eq!(receipt.modified_at_millis(), Some(41));

    let renamed_path = notes.path().join("Renamed.md");
    fs::rename(&path, &renamed_path).unwrap();
    let renamed = state
        .note_timeline()
        .observe(VaultObservation::renamed(&path, &renamed_path, 43))
        .unwrap();
    assert_eq!(
        renamed.kind(),
        VaultObservationKind::Lifecycle(LifecycleEventKind::Renamed)
    );
    assert_eq!(renamed.previous_path(), Some(path.as_path()));
    assert_eq!(renamed.path(), renamed_path);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn reattachment_requires_identity_and_same_path_continuity() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-reattach-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-reattach-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let original_path = notes.path().join("Original.md");
    let stale_copy_path = notes.path().join("Stale Copy.md");
    let original_markdown =
        "---\ngneauxghts:\n  id: timeline-reattach-note-1\n  kind: note\n---\n\n# Original";
    fs::write(&original_path, original_markdown).expect("write original note");
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .expect("construct app state");
    let timeline = state.note_timeline();
    let history_intent =
        prepare_test_history(MutationSource::Editor, &original_path, original_markdown);
    timeline.mutate(NoteMutation::editor(
        history_intent,
        original_path.clone(),
        None,
        original_markdown.to_string(),
    ));

    fs::remove_file(&original_path).expect("remove original note");
    let missing = timeline
        .observe(VaultObservation::missing(original_path.clone(), 40))
        .unwrap();
    assert_eq!(
        missing.kind(),
        VaultObservationKind::Lifecycle(LifecycleEventKind::Missing)
    );

    fs::write(&stale_copy_path, original_markdown).expect("write same identity elsewhere");
    let stale_copy = timeline
        .observe(VaultObservation::external_edit(
            stale_copy_path,
            41,
            Some(40),
        ))
        .unwrap();
    assert_eq!(stale_copy.kind(), VaultObservationKind::CanonicalState);

    fs::write(&original_path, original_markdown).expect("reattach original identity");
    let reattached = timeline
        .observe(VaultObservation::external_edit(
            original_path.clone(),
            42,
            Some(41),
        ))
        .unwrap();
    assert_eq!(
        reattached.kind(),
        VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached)
    );
    assert_eq!(reattached.previous_path(), Some(original_path.as_path()));
    assert_eq!(reattached.path(), original_path);
}

#[test]
fn missing_transition_captures_retention_and_survives_restart_without_a_revision() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-missing-retention-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-missing-retention-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();

    for (index, retention_days) in [1_u32, 7, 30].into_iter().enumerate() {
        crate::state::set_forgotten_note_retention_days(retention_days).unwrap();
        let title = format!("Missing retention {retention_days}");
        let created = save_retained_state(
            &state,
            title.clone(),
            format!("Retained body {retention_days}"),
            None,
        )
        .unwrap()
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        let missing_at = crate::time::current_time_millis().unwrap() + index as u64 + 1;
        fs::remove_file(&path).unwrap();

        state
            .note_timeline()
            .observe(VaultObservation::missing(path.clone(), missing_at))
            .unwrap();

        let missing = state.note_timeline().missing_notes().unwrap();
        let record = missing
            .iter()
            .find(|record| record.note_id() == &note_id)
            .unwrap();
        assert_eq!(record.path(), path);
        assert_eq!(record.title(), title);
        assert_eq!(record.missing_at_millis(), missing_at);
        assert_eq!(record.retention_days(), retention_days);
        assert_eq!(
            record.purge_at_millis(),
            missing_at + u64::from(retention_days) * 24 * 60 * 60 * 1_000
        );
        let access = state.note_timeline().open_history_mode(note_id.clone());
        assert_eq!(
            access.revisions().unwrap_err().to_string(),
            "Recover the missing note before accessing its Note Timeline"
        );
    }

    crate::state::set_forgotten_note_retention_days(30).unwrap();
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let missing = restarted.note_timeline().missing_notes().unwrap();
    assert_eq!(
        missing
            .iter()
            .map(|record| (
                record.retention_days(),
                record.purge_at_millis() - record.missing_at_millis()
            ))
            .collect::<Vec<_>>(),
        vec![
            (30, 30 * 24 * 60 * 60 * 1_000),
            (7, 7 * 24 * 60 * 60 * 1_000),
            (1, 24 * 60 * 60 * 1_000),
        ]
    );
    for record in missing {
        let access = restarted
            .note_timeline()
            .open_history_mode(record.note_id().clone());
        assert_eq!(
            access.revisions().unwrap_err().to_string(),
            "Recover the missing note before accessing its Note Timeline"
        );
        assert_eq!(
            history_store::revisions(&history_store::Store::for_test(), record.note_id())
                .unwrap()
                .len(),
            1,
            "Missing is lifecycle evidence, not authored content"
        );
        assert_eq!(
            history_store::lifecycle_events(&history_store::Store::for_test(), record.note_id())
                .unwrap()
                .last()
                .unwrap()
                .kind(),
            LifecycleEventKind::Missing
        );
    }
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn missing_note_recovery_rebuilds_retained_content_without_overwriting_path_reuse() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-missing-recovery-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-missing-recovery-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    crate::state::set_forgotten_note_retention_days(7).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Recoverable".to_string(),
        "Last retained body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let original_path = PathBuf::from(created.path.unwrap());
    fs::remove_file(&original_path).unwrap();
    let timeline = state.note_timeline();
    timeline
        .observe(VaultObservation::missing(
            original_path.clone(),
            crate::time::current_time_millis().unwrap() + 1,
        ))
        .unwrap();
    fs::write(&original_path, "Unrelated path reuse").unwrap();

    let recovery = timeline.recover_missing_note(note_id.clone()).unwrap();

    assert_eq!(
        fs::read_to_string(&original_path).unwrap(),
        "Unrelated path reuse"
    );
    assert_ne!(recovery.receipt().path(), original_path);
    assert_eq!(
        recovery.receipt().previous_path(),
        Some(original_path.as_path())
    );
    assert_eq!(recovery.receipt().kind(), LifecycleEventKind::Recovered);
    let recovered_markdown = fs::read_to_string(recovery.receipt().path()).unwrap();
    assert_eq!(
        crate::note::parse_note(&recovered_markdown)
            .frontmatter
            .managed
            .unwrap()
            .id,
        note_id.as_str()
    );
    assert_eq!(
        crate::note::parse_note(&recovered_markdown).body,
        "Last retained body"
    );
    assert_eq!(
        state
            .indexed_note_identity(recovery.receipt().path())
            .unwrap()
            .as_deref(),
        Some(note_id.as_str()),
        "collision-safe recovery must move the original catalog identity to the recovered path"
    );
    assert!(timeline.missing_notes().unwrap().is_empty());
    let access = timeline.open_history_mode(note_id);
    assert_eq!(access.revisions().unwrap().len(), 1);
    assert_eq!(
        access.lifecycle_events().unwrap().last().unwrap().kind(),
        LifecycleEventKind::Recovered
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn missing_note_recovery_prefers_the_free_last_known_path() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-missing-free-path-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-missing-free-path-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    crate::state::set_forgotten_note_retention_days(7).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Free recovery path".to_string(),
        "Recovered in place".to_string(),
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
            path.clone(),
            crate::time::current_time_millis().unwrap() + 1,
        ))
        .unwrap();

    let recovered = timeline.recover_missing_note(note_id).unwrap();

    assert_eq!(recovered.receipt().path(), path);
    assert_eq!(
        crate::note::parse_note(&fs::read_to_string(path).unwrap()).body,
        "Recovered in place"
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn failed_missing_note_publication_remains_recoverable() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-missing-retry-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-missing-retry-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    crate::state::set_forgotten_note_retention_days(7).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Retry recovery".to_string(),
        "Still retained".to_string(),
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
            path.clone(),
            crate::time::current_time_millis().unwrap() + 1,
        ))
        .unwrap();
    crate::state::inject_note_publication_failure_once();

    assert!(timeline.recover_missing_note(note_id.clone()).is_err());
    assert!(!path.exists());
    assert!(
        history_store::missing_note(&history_store::Store::for_test(), &note_id)
            .unwrap()
            .is_some()
    );
    assert_eq!(
        history_store::lifecycle_events(&history_store::Store::for_test(), &note_id)
            .unwrap()
            .last()
            .unwrap()
            .kind(),
        LifecycleEventKind::Missing
    );

    timeline.recover_missing_note(note_id.clone()).unwrap();
    assert!(path.exists());
    assert!(
        history_store::missing_note(&history_store::Store::for_test(), &note_id)
            .unwrap()
            .is_none()
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn restart_reattaches_only_the_same_identity_at_the_missing_path() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-missing-reattach-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-missing-reattach-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    crate::state::set_forgotten_note_retention_days(7).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Reappearing".to_string(),
        "Original retained body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    let original_markdown = fs::read_to_string(&path).unwrap();
    fs::remove_file(&path).unwrap();
    state
        .note_timeline()
        .observe(VaultObservation::missing(
            path.clone(),
            crate::time::current_time_millis().unwrap() + 1,
        ))
        .unwrap();

    let unrelated = "---\ngneauxghts:\n  id: unrelated-path-reuse\n  kind: note\n---\n\nUnrelated";
    fs::write(&path, unrelated).unwrap();
    let unrelated_receipt = state
        .note_timeline()
        .observe(
            VaultObservation::external_edit(path.clone(), 200, None)
                .with_canonical_markdown(unrelated.to_string()),
        )
        .unwrap();
    assert_eq!(
        unrelated_receipt.kind(),
        VaultObservationKind::CanonicalState
    );
    assert_eq!(state.note_timeline().missing_notes().unwrap().len(), 1);
    assert_eq!(
        history_store::revisions(
            &history_store::Store::for_test(),
            &NoteIdentity::new("unrelated-path-reuse")
        )
        .unwrap()
        .len(),
        1
    );

    fs::remove_file(&path).unwrap();
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    fs::write(&path, original_markdown).unwrap();
    let reattached = restarted
        .note_timeline()
        .observe(VaultObservation::reconciled_state(
            path.clone(),
            crate::time::current_time_millis().unwrap() + 2,
            None,
        ))
        .unwrap();

    assert_eq!(
        reattached.kind(),
        VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached)
    );
    assert!(restarted
        .note_timeline()
        .missing_notes()
        .unwrap()
        .is_empty());
    let access = restarted.note_timeline().open_history_mode(note_id);
    assert_eq!(access.revisions().unwrap().len(), 1);
    assert_eq!(
        access.lifecycle_events().unwrap().last().unwrap().kind(),
        LifecycleEventKind::Reattached
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn lifecycle_publication_returns_the_typed_identity_and_paths() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-lifecycle-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-lifecycle-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .expect("construct app state");
    let created = save_retained_state(
        &state,
        "Lifecycle receipt".to_string(),
        "Retained body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let active_path = PathBuf::from(created.path.unwrap());
    let forgotten_path =
        crate::state::forgotten_notes_root(notes.path()).join("Lifecycle receipt.md");
    fs::create_dir_all(forgotten_path.parent().unwrap()).unwrap();
    let (selected, warning) = state.note_timeline().forget_note(&active_path, 7).unwrap();
    assert!(warning.is_none());
    assert_eq!(selected.note_id.as_deref(), Some(note_id.as_str()));
    assert_eq!(Path::new(&selected.forgotten_path), forgotten_path);
    assert_eq!(Path::new(&selected.original_path), active_path);
    let events =
        history_store::lifecycle_events(&state.note_timeline().runtime.store, &note_id).unwrap();
    let receipt = events.last().unwrap();
    assert_eq!(receipt.kind(), LifecycleEventKind::Forgotten);
    assert_eq!(receipt.occurred_at_millis(), selected.forgotten_at_millis);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn lifecycle_recovery_preserves_a_newer_same_identity_external_edit() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-lifecycle-external-edit-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-lifecycle-external-edit-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Externally edited lifecycle".to_string(),
        "Published body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let active_path = PathBuf::from(created.path.unwrap());
    let forgotten_path =
        crate::state::forgotten_notes_root(notes.path()).join("Externally edited lifecycle.md");
    fs::create_dir_all(forgotten_path.parent().unwrap()).unwrap();
    inject_lifecycle_finalization_failure_once();
    let (_, warning) = state.note_timeline().forget_note(&active_path, 7).unwrap();
    assert!(warning.is_some());
    assert_eq!(retained_observation_count_for_test(), 1);

    let externally_edited = crate::note::replace_authored_content(
        &fs::read_to_string(&forgotten_path).unwrap(),
        None,
        "Edited after lifecycle publication",
    )
    .unwrap();
    fs::write(&forgotten_path, &externally_edited).unwrap();
    let before_recovery = crate::time::current_time_millis().unwrap();

    state
        .note_timeline()
        .recover_lifecycle_publications()
        .unwrap();

    assert_eq!(retained_observation_count_for_test(), 0);
    assert_eq!(
        crate::note::parse_note(&fs::read_to_string(&forgotten_path).unwrap()).body,
        "Edited after lifecycle publication"
    );
    let external_revision = history_store::revisions(&history_store::Store::for_test(), &note_id)
        .unwrap()
        .into_iter()
        .find(|revision| revision.source() == MutationSource::ExternalEdit)
        .expect("preserved authored state is observed as an external revision");
    assert!(external_revision
        .observed_at_millis()
        .is_some_and(|observed_at| observed_at >= before_recovery));
    crate::state::set_notes_root_override(None).unwrap();
}
