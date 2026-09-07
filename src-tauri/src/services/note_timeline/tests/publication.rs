#[test]
fn editor_mutation_assigns_its_closed_source() {
    let mutation = NoteMutation::editor(
        PreparedHistoryIntent::for_test("editor-intent"),
        PathBuf::from("/vault/Note.md"),
        None,
        "# Note\n\nBody".to_string(),
    );

    assert_eq!(mutation.source(), MutationSource::Editor);
    assert_eq!(mutation.path(), PathBuf::from("/vault/Note.md"));
}

#[test]
fn typed_entrypoints_cover_the_closed_mutation_source_vocabulary() {
    let path = PathBuf::from("/vault/Note.md");
    let markdown = "# Note\n\nBody".to_string();
    let mutations = [
        NoteMutation::task_action(
            PreparedHistoryIntent::for_test("task-intent"),
            path.clone(),
            None,
            markdown.clone(),
        ),
        NoteMutation::accepted_chat_proposal(
            PreparedHistoryIntent::for_test("proposal-intent"),
            path.clone(),
            None,
            markdown.clone(),
        ),
        NoteMutation::version_restore(
            PreparedHistoryIntent::for_test("restore-intent"),
            path.clone(),
            None,
            markdown.clone(),
        ),
        NoteMutation::note_creation(
            PreparedHistoryIntent::for_test("creation-intent"),
            path.clone(),
            None,
            markdown.clone(),
        ),
        NoteMutation::baseline_initialization(
            PreparedHistoryIntent::for_test("baseline-intent"),
            path.clone(),
            None,
            markdown.clone(),
        ),
        NoteMutation::recovery_reconciliation(
            PreparedHistoryIntent::for_test("recovery-intent"),
            path.clone(),
            None,
            markdown.clone(),
        ),
    ];

    assert_eq!(
        mutations.map(|mutation| mutation.source()),
        [
            MutationSource::TaskAction,
            MutationSource::AcceptedChatProposal,
            MutationSource::VersionRestore,
            MutationSource::NoteCreation,
            MutationSource::BaselineInitialization,
            MutationSource::RecoveryReconciliation,
        ]
    );
    let observation = VaultObservation::external_edit(path, 42, Some(41));
    assert_eq!(observation.source(), VaultObservationSource::Watcher);
    assert_eq!(observation.kind(), VaultObservationKind::CanonicalState);
    let reconciled =
        VaultObservation::reconciled_state(PathBuf::from("/vault/Reconciled.md"), 43, Some(40));
    assert_eq!(reconciled.source(), VaultObservationSource::Reconciliation);
    let scan = VaultObservation::reconciliation_scan(PathBuf::from("/vault"), 44);
    assert_eq!(scan.source(), VaultObservationSource::Reconciliation);
    assert_eq!(scan.kind(), VaultObservationKind::ReconciliationScan);

    let lifecycle = [
        VaultObservation::renamed("/vault/Old.md", "/vault/New.md", 43),
        VaultObservation::moved("/vault/New.md", "/vault/Folder/New.md", 44),
        VaultObservation::missing("/vault/Folder/New.md", 45),
    ];
    assert_eq!(
        lifecycle.map(|observation| observation.kind()),
        [
            VaultObservationKind::Lifecycle(LifecycleEventKind::Renamed),
            VaultObservationKind::Lifecycle(LifecycleEventKind::Moved),
            VaultObservationKind::Lifecycle(LifecycleEventKind::Missing),
        ]
    );
}

#[test]
fn publication_rejects_retained_identity_that_conflicts_with_catalog_owner() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("identity-context-data");
    let notes = crate::test_support::TestDir::new("identity-context-vault");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .expect("construct app state");
    let path = notes.path().join("Current.md");
    let canonical = "---\ngneauxghts:\n  id: current-owner\n  kind: note\n---\n\nCurrent";
    state.notes_index.lock().unwrap().upsert_note(
        path.clone(),
        crate::index::build_indexed_note(&path, canonical, 41),
    );

    let error = state
        .note_timeline()
        .prepare_publication(
            Some(&path),
            Some(&NoteIdentity::new("stale-proposal-owner")),
            "Proposed authored content",
        )
        .expect_err("conflicting continuity evidence must not publish");

    assert!(error.to_string().contains("identity continuity conflict"));
    assert_eq!(
        state.indexed_note_identity(&path).unwrap().as_deref(),
        Some("current-owner")
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn mutate_preserves_the_authoritative_publication_outcome() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-pass-through-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-pass-through-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let note_path = notes.path().join("Note.md");
    let markdown = "---\ngneauxghts:\n  id: note-1\n  kind: note\n---\n\n# Note\n\nBody";
    fs::write(&note_path, markdown).expect("write canonical note");
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .expect("construct app state");
    let history_intent = prepare_test_history(MutationSource::Editor, &note_path, markdown);

    let outcome = state.note_timeline().mutate(NoteMutation::editor(
        history_intent,
        note_path.clone(),
        None,
        markdown.to_string(),
    ));

    assert_eq!(outcome.payload_version(), PayloadVersion::V1);
    assert_eq!(outcome.source(), MutationSource::Editor);
    assert_eq!(outcome.note_id(), &NoteIdentity::new("note-1"));
    assert_eq!(outcome.path(), note_path);
    assert_eq!(outcome.canonical_markdown(), markdown);
    assert_eq!(outcome.warning(), None);
}

#[test]
fn meaningful_commits_reconstruct_exact_authored_states_after_restart() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-history-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-history-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();

    let first = "---\r\nproject: atlas\r\n---\r\n\r\nHello, 🌍\r\n";
    let before_publication = crate::time::current_time_millis().unwrap();
    let created = save_retained_state(&state, "Timeline".to_string(), first.to_string(), None)
        .unwrap()
        .unwrap();
    let note_id = NoteIdentity::new(created.note_id.clone().unwrap());
    let path = created.path.clone().unwrap();

    // A managed timestamp refresh with identical authored content is not
    // a second revision.
    save_retained_state(
        &state,
        "Timeline".to_string(),
        first.to_string(),
        Some(path.clone()),
    )
    .unwrap();
    let second = "---\nproject: atlas\nstatus: done\n---\n\nReplacement 🦀\nwith two lines";
    save_retained_state(
        &state,
        "Timeline".to_string(),
        second.to_string(),
        Some(path),
    )
    .unwrap();
    let after_publication = crate::time::current_time_millis().unwrap();

    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let history = restarted
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(note_id.clone()));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 2);
    assert_eq!(revisions[0].source(), MutationSource::NoteCreation);
    assert_eq!(revisions[1].source(), MutationSource::Editor);
    assert!(revisions
        .iter()
        .all(|revision| (before_publication..=after_publication)
            .contains(&revision.time_evidence().occurred_at_millis())));
    let creation = history.lifecycle_events().unwrap();
    assert_eq!(creation.len(), 1);
    assert_eq!(creation[0].kind(), LifecycleEventKind::Created);
    assert_eq!(
        revisions[0].predecessor(),
        Some(&TimelineRecordIdentity::LifecycleEvent(
            creation[0].identity().clone()
        ))
    );

    let reconstructed_first = history.reconstruct(revisions[0].identity()).unwrap();
    assert_eq!(
        reconstructed_first.unmanaged_frontmatter(),
        Some("project: atlas\n")
    );
    assert_eq!(reconstructed_first.body(), "Hello, 🌍\n");
    let reconstructed_second = history.reconstruct(revisions[1].identity()).unwrap();
    assert_eq!(
        reconstructed_second.unmanaged_frontmatter(),
        Some("project: atlas\nstatus: done\n")
    );
    assert_eq!(
        reconstructed_second.body(),
        "Replacement 🦀\nwith two lines"
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn interrupted_projection_cleanup_remains_pending_and_retries_before_finalization() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-purge-projection-retry-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-purge-projection-retry-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Retry purge".to_string(),
        "Private body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    let mut purge_error = None;
    let delivered = state
        .note_timeline()
        .current_content(AllowedScope::vault())
        .read(|| {
            inject_purge_projection_cleanup_failure_once();
            purge_error = Some(
                state
                    .note_timeline()
                    .lifecycle(NoteLifecycleOperation::purged(
                        note_id.clone(),
                        path.clone(),
                        700,
                    ))
                    .unwrap_err(),
            );
            Ok(vec![TestCurrentContentItem {
                note_id: note_id.as_str().to_string(),
                note_path: path.to_string_lossy().into_owned(),
            }])
        })
        .unwrap();
    let error = purge_error.expect("purge failure is captured during the read");

    assert!(error
        .to_string()
        .contains("injected purge projection cleanup interruption"));
    assert!(delivered.is_empty());
    assert!(!path.exists());
    assert_eq!(
        state.indexed_note_identity(&path).unwrap().as_deref(),
        Some(note_id.as_str())
    );
    let retrieved = crate::services::retrieval::retrieve_vault_notes(
        &state,
        "Private body",
        8,
        None,
        &HashSet::new(),
        crate::services::retrieval::VaultDateFilters::default(),
    )
    .unwrap();
    assert!(retrieved.is_empty());
    let timeline = state.note_timeline();
    let markers = timeline.deletion_markers().unwrap();
    assert_eq!(markers.len(), 1);
    assert_eq!(markers[0].scope(), &DeletionScope::Note(note_id.clone()));
    assert_eq!(state.indexed_note_identity(&path).unwrap(), None);
    assert!(timeline
        .history_mode(HistoryModeGrant::authorized(note_id))
        .revisions()
        .unwrap()
        .is_empty());
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn a_cleanly_copied_vault_reconstructs_identical_revision_identity_and_hash() {
    let _guard = crate::test_support::lock_test_env();
    let source_app_data =
        crate::test_support::TestDir::new("timeline-portable-copy-source-app-data");
    crate::state::initialize_app_data_dir(source_app_data.path().to_path_buf()).unwrap();
    let source = crate::test_support::TestDir::new("timeline-portable-copy-source");
    crate::state::set_notes_root_override(Some(source.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(source.path()).unwrap();
    let source_note = source.path().join("Portable.md");
    fs::write(
        &source_note,
        "---\ngneauxghts:\n  id: portable-copy-note\n  kind: note\n---\n\nPortable content",
    )
    .unwrap();
    let source_state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let source_timeline = source_state.note_timeline();
    source_timeline
        .initialize_existing_notes(source.path())
        .unwrap();
    let source_access = source_timeline.history_mode(HistoryModeGrant::authorized(
        NoteIdentity::new("portable-copy-note"),
    ));
    let source_header = source_access.revisions().unwrap()[0].clone();
    let source_revision = source_access.reconstruct(source_header.identity()).unwrap();
    source_timeline.clean_close(source.path()).unwrap();

    let copied = crate::test_support::TestDir::new("timeline-portable-copy-destination");
    copy_file(&source_note, &copied.path().join("Portable.md"));
    copy_file(
        &source.path().join(".gneauxghts/vault.json"),
        &copied.path().join(".gneauxghts/vault.json"),
    );
    copy_file(
        &history_store::history_database_path_for_test(source.path()),
        &history_store::history_database_path_for_test(copied.path()),
    );
    drop(source_access);
    drop(source_state);

    let destination_app_data =
        crate::test_support::TestDir::new("timeline-portable-copy-destination-app-data");
    crate::state::initialize_app_data_dir(destination_app_data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(copied.path().to_path_buf())).unwrap();
    let copied_state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let copied_access = copied_state
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "portable-copy-note",
        )));

    let copied_header = copied_access.revisions().unwrap()[0].clone();
    let copied_revision = copied_access.reconstruct(copied_header.identity()).unwrap();
    assert_eq!(copied_header.identity(), source_header.identity());
    assert_eq!(copied_header.content_hash(), source_header.content_hash());
    assert_eq!(copied_revision, source_revision);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn history_preparation_failure_publishes_nothing() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-prepare-fault-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-prepare-fault-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    history_store::inject_fault_once(history_store::FaultPoint::Prepare);

    let error = save_retained_state(
        &state,
        "Blocked".to_string(),
        "Dirty editor content".to_string(),
        None,
    )
    .expect_err("history preparation must fail closed");

    assert!(error
        .to_string()
        .contains("injected history preparation failure"));
    assert!(!notes.path().join("Blocked.md").exists());
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn publication_preparation_verifies_targets_without_whole_vault_attestation() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-integrity-cache-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-integrity-cache-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    history_store::reset_integrity_snapshot_count();

    timeline
        .prepare_revision_publication(
            MutationSource::NoteCreation,
            &notes.path().join("First.md"),
            None,
            None,
            "first",
        )
        .unwrap();
    timeline
        .prepare_revision_publication(
            MutationSource::NoteCreation,
            &notes.path().join("Second.md"),
            None,
            None,
            "second",
        )
        .unwrap();

    assert_eq!(history_store::integrity_snapshot_count(), 0);
    assert_eq!(timeline.history_readiness(None).unwrap().verified_notes, 2);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn a_second_preparation_cannot_abandon_an_in_flight_intent() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-live-intent-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-live-intent-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    let first_path = notes.path().join("First.md");
    let second_path = notes.path().join("Second.md");
    let first = timeline
        .prepare_revision_publication(
            MutationSource::NoteCreation,
            &first_path,
            None,
            None,
            "first",
        )
        .unwrap();

    let second = timeline
        .prepare_revision_publication(
            MutationSource::NoteCreation,
            &second_path,
            None,
            None,
            "second",
        )
        .unwrap();
    let (first, first_intent) = first.into_parts();
    let (second, second_intent) = second.into_parts();
    fs::write(&first_path, &first).unwrap();
    let first_result = timeline.mutate(NoteMutation::note_creation(
        first_intent,
        first_path.clone(),
        None,
        first,
    ));
    assert_eq!(first_result.warning(), None);

    fs::write(&second_path, &second).unwrap();
    let second_result = timeline.mutate(NoteMutation::note_creation(
        second_intent,
        second_path.clone(),
        None,
        second,
    ));
    assert_eq!(second_result.warning(), None);
    assert_eq!(
        timeline
            .history_mode(HistoryModeGrant::authorized(first_result.note_id().clone()))
            .revisions()
            .unwrap()
            .len(),
        1
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn finalization_uses_the_exact_prepared_intent_identity() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-intent-id-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-intent-id-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(&state, "Intent".to_string(), "initial".to_string(), None)
        .unwrap()
        .unwrap();
    let path = PathBuf::from(created.path.unwrap());
    let timeline = state.note_timeline();
    let first = timeline
        .prepare_revision_publication(
            MutationSource::TaskAction,
            &path,
            Some(&path),
            None,
            "first update",
        )
        .unwrap();
    let second = timeline
        .prepare_revision_publication(
            MutationSource::TaskAction,
            &path,
            Some(&path),
            None,
            "second update",
        )
        .unwrap();
    let (first_markdown, first_intent) = first.into_parts();
    let (second_markdown, second_intent) = second.into_parts();
    fs::write(&path, &second_markdown).unwrap();

    let stale = timeline.mutate(NoteMutation::task_action(
        first_intent,
        path.clone(),
        Some(path.clone()),
        first_markdown,
    ));
    assert!(stale.warning().is_some());
    let committed = timeline.mutate(NoteMutation::task_action(
        second_intent,
        path.clone(),
        Some(path),
        second_markdown,
    ));
    assert_eq!(committed.warning(), None);

    let history = timeline.history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
        created.note_id.unwrap(),
    )));
    assert_eq!(history.revisions().unwrap().len(), 2);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn finalization_rejects_matching_authored_content_under_another_note_identity() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-intent-note-id-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-intent-note-id-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    let path = notes.path().join("Identity Mismatch.md");
    let prepared = timeline
        .prepare_revision_publication(
            MutationSource::NoteCreation,
            &path,
            None,
            None,
            "same authored content",
        )
        .unwrap();
    let intended_note_id = NoteIdentity::new(
        crate::note::parse_note(prepared.canonical_markdown())
            .frontmatter
            .managed
            .unwrap()
            .id,
    );
    let (canonical, history_intent) = prepared.into_parts();
    let wrong_identity =
        crate::note::repair_managed_note_identity(&canonical, "wrong-note-id").unwrap();
    fs::write(&path, &wrong_identity).unwrap();

    let result = timeline.mutate(NoteMutation::note_creation(
        history_intent,
        path,
        None,
        wrong_identity,
    ));

    assert!(result.warning().is_some());
    let history = timeline.history_mode(HistoryModeGrant::authorized(intended_note_id));
    assert!(history.revisions().unwrap().is_empty());
    assert_eq!(
        history_store::prepared_intent_count(&history_store::Store::for_test(), "abandoned"),
        1
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn finalization_abandons_publication_without_a_managed_note_identity() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-missing-id-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-missing-id-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    let path = notes.path().join("Identity Missing.md");
    let prepared = timeline
        .prepare_revision_publication(
            MutationSource::NoteCreation,
            &path,
            None,
            None,
            "same authored content",
        )
        .unwrap();
    let (canonical, history_intent) = prepared.into_parts();
    let without_identity = "same authored content".to_string();
    fs::write(&path, &without_identity).unwrap();

    let result = timeline.mutate(NoteMutation::note_creation(
        history_intent,
        path,
        None,
        canonical,
    ));

    assert!(result.warning().is_some());
    assert_eq!(
        history_store::prepared_intent_count(&history_store::Store::for_test(), "prepared"),
        0
    );
    assert_eq!(
        history_store::prepared_intent_count(&history_store::Store::for_test(), "abandoned"),
        1
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn unreadable_authoritative_markdown_never_finalizes_from_fallback_memory() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-read-fault-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-read-fault-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    let path = notes.path().join("Vanished.md");
    let prepared = timeline
        .prepare_revision_publication(
            MutationSource::NoteCreation,
            &path,
            None,
            None,
            "published then removed",
        )
        .unwrap();
    let note_id = NoteIdentity::new(
        crate::note::parse_note(prepared.canonical_markdown())
            .frontmatter
            .managed
            .unwrap()
            .id,
    );
    let (canonical, history_intent) = prepared.into_parts();
    fs::write(&path, &canonical).unwrap();
    fs::remove_file(&path).unwrap();

    let result = timeline.mutate(NoteMutation::note_creation(
        history_intent,
        path,
        None,
        canonical,
    ));

    assert!(result.warning().is_some());
    assert!(timeline
        .history_mode(HistoryModeGrant::authorized(note_id))
        .revisions()
        .unwrap()
        .is_empty());
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn transient_startup_recovery_failure_can_be_retried() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-recovery-retry-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-recovery-retry-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let history = state
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "missing-note",
        )));
    inject_history_recovery_failure_once();

    assert!(history
        .revisions()
        .unwrap_err()
        .to_string()
        .contains("injected history recovery failure"));
    assert!(history.revisions().unwrap().is_empty());
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn canonical_read_failure_keeps_pending_recovery_retryable() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-read-retry-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-read-retry-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let path = notes.path().join("Unreadable.md");
    let prepared = state
        .note_timeline()
        .prepare_revision_publication(
            MutationSource::NoteCreation,
            &path,
            None,
            None,
            "published bytes",
        )
        .unwrap();
    let note_id = NoteIdentity::new(
        crate::note::parse_note(prepared.canonical_markdown())
            .frontmatter
            .managed
            .unwrap()
            .id,
    );
    let canonical = prepared.canonical_markdown().to_string();
    fs::create_dir(&path).unwrap();

    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let history = restarted
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(note_id));
    assert!(history
        .revisions()
        .unwrap_err()
        .to_string()
        .contains("Read pending canonical publication"));
    assert_eq!(
        history_store::prepared_intent_count(&history_store::Store::for_test(), "prepared"),
        1
    );

    fs::remove_dir(&path).unwrap();
    fs::write(&path, canonical).unwrap();
    assert_eq!(history.revisions().unwrap().len(), 1);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn rename_with_authored_change_does_not_emit_a_second_created_event() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-rename-event-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-rename-event-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(&state, "Before".to_string(), "first body".to_string(), None)
        .unwrap()
        .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());

    save_retained_state(
        &state,
        "After".to_string(),
        "changed body".to_string(),
        created.path,
    )
    .unwrap();

    let history = state
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(note_id));
    assert_eq!(history.revisions().unwrap().len(), 2);
    let events = history.lifecycle_events().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind() == LifecycleEventKind::Created)
            .count(),
        1
    );
    assert!(events
        .iter()
        .any(|event| event.kind() == LifecycleEventKind::Renamed));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn committed_markdown_survives_finalization_failure_and_recovers_once() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-finalize-fault-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-finalize-fault-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    history_store::inject_fault_once(history_store::FaultPoint::Finalize);
    let before_publication = crate::time::current_time_millis().unwrap();

    let session = save_retained_state(
        &state,
        "Recoverable".to_string(),
        "Published content".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let after_publication = crate::time::current_time_millis().unwrap();
    assert!(Path::new(session.path.as_deref().unwrap()).exists());
    assert!(session
        .commit_warning
        .as_ref()
        .unwrap()
        .issues()
        .iter()
        .any(|issue| issue.stage() == MutationWarningStage::HistoryFinalization));

    std::thread::sleep(std::time::Duration::from_millis(10));
    let canonical = fs::read_to_string(session.path.as_deref().unwrap()).unwrap();
    fs::write(session.path.as_deref().unwrap(), canonical).unwrap();

    let note_id = NoteIdentity::new(session.note_id.unwrap());
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let history = restarted
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(note_id));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 1);
    assert!(revisions[0].committed_at_millis().unwrap() >= before_publication);
    assert!(revisions[0].committed_at_millis().unwrap() <= after_publication);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn every_app_owned_mutation_source_is_retained_by_the_same_contract() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-source-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-source-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    let path = notes.path().join("Sources.md");
    let sources = [
        MutationSource::NoteCreation,
        MutationSource::Editor,
        MutationSource::TaskAction,
        MutationSource::AcceptedChatProposal,
        MutationSource::VersionRestore,
        MutationSource::RecoveryReconciliation,
    ];
    let mut note_id = None;
    for (index, source) in sources.into_iter().enumerate() {
        let prepared = timeline
            .prepare_revision_publication(
                source,
                &path,
                (index > 0).then_some(path.as_path()),
                None,
                &format!("authored state {index}"),
            )
            .unwrap();
        let (canonical, history_intent) = prepared.into_parts();
        fs::write(&path, &canonical).unwrap();
        let result = timeline.mutate(NoteMutation::with_source(
            source,
            history_intent,
            path.clone(),
            (index > 0).then(|| path.clone()),
            canonical,
        ));
        timeline.finalize_editing_window(result.note_id()).unwrap();
        note_id.get_or_insert_with(|| result.note_id().clone());
    }

    let history = timeline.history_mode(HistoryModeGrant::authorized(note_id.unwrap()));
    assert_eq!(
        history
            .revisions()
            .unwrap()
            .into_iter()
            .map(|revision| revision.source())
            .collect::<Vec<_>>(),
        sources
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn unknown_persisted_history_vocabulary_fails_closed() {
    assert_eq!(HistoryDeletionKind::from_storage_value("revision"), None);
    assert!(DeletionScope::from_storage_parts("revision", "id".to_string()).is_err());

    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-vocabulary-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-vocabulary-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(&state, "Vocabulary".to_string(), "body".to_string(), None)
        .unwrap()
        .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    history_store::replace_revision_source(
        &history_store::Store::for_test(),
        &note_id,
        "futureSource",
    );
    assert!(
        history_store::revisions(&history_store::Store::for_test(), &note_id)
            .unwrap_err()
            .to_string()
            .contains("Unknown stored Mutation Source `futureSource`")
    );

    history_store::replace_revision_source(
        &history_store::Store::for_test(),
        &note_id,
        "noteCreation",
    );
    history_store::replace_revision_payload_version(
        &history_store::Store::for_test(),
        &note_id,
        99,
    );
    assert!(
        history_store::revisions(&history_store::Store::for_test(), &note_id)
            .unwrap_err()
            .to_string()
            .contains("Unknown stored Payload Version `99`")
    );

    history_store::replace_revision_payload_version(&history_store::Store::for_test(), &note_id, 1);
    history_store::replace_revision_predecessor(
        &history_store::Store::for_test(),
        &note_id,
        Some("futureRecord"),
        Some("id"),
    );
    assert!(
        history_store::revisions(&history_store::Store::for_test(), &note_id)
            .unwrap_err()
            .to_string()
            .contains("Invalid stored Timeline predecessor")
    );

    history_store::replace_revision_predecessor(
        &history_store::Store::for_test(),
        &note_id,
        Some("lifecycleEvent"),
        history_store::lifecycle_events(&history_store::Store::for_test(), &note_id)
            .unwrap()
            .first()
            .map(|event| event.identity().0.as_str()),
    );
    history_store::replace_lifecycle_kind(
        &history_store::Store::for_test(),
        &note_id,
        "futureEvent",
    );
    assert!(
        history_store::lifecycle_events(&history_store::Store::for_test(), &note_id)
            .unwrap_err()
            .to_string()
            .contains("Unknown stored Lifecycle Event Kind `futureEvent`")
    );

    history_store::replace_lifecycle_kind(&history_store::Store::for_test(), &note_id, "created");
    history_store::replace_lifecycle_payload_version(
        &history_store::Store::for_test(),
        &note_id,
        99,
    );
    assert!(
        history_store::lifecycle_events(&history_store::Store::for_test(), &note_id)
            .unwrap_err()
            .to_string()
            .contains("Unknown stored Payload Version `99`")
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn prepared_but_unpublished_intent_does_not_create_phantom_history() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-unpublished-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-unpublished-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let path = notes.path().join("Never Published.md");
    let prepared = state
        .note_timeline()
        .prepare_revision_publication(
            MutationSource::NoteCreation,
            &path,
            None,
            None,
            "not published",
        )
        .unwrap();
    let note_id = NoteIdentity::new(
        crate::note::parse_note(prepared.canonical_markdown())
            .frontmatter
            .managed
            .unwrap()
            .id,
    );

    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let history = restarted
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(note_id));
    assert!(history.revisions().unwrap().is_empty());
    assert!(history.lifecycle_events().unwrap().is_empty());
    assert!(!path.exists());
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn concurrent_history_reads_after_restart_converge_one_prepared_publication() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-runtime-race-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-runtime-race-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let path = notes.path().join("Interrupted Publication.md");
    let prepared = state
        .note_timeline()
        .prepare_revision_publication(
            MutationSource::NoteCreation,
            &path,
            None,
            None,
            "Published before interruption",
        )
        .unwrap();
    let note_id = NoteIdentity::new(
        crate::note::parse_note(prepared.canonical_markdown())
            .frontmatter
            .managed
            .unwrap()
            .id,
    );
    fs::write(&path, prepared.canonical_markdown()).unwrap();
    drop(prepared);
    drop(state);
    assert_eq!(prepared_history_intent_count_for_test("prepared"), 1);

    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let start = Arc::new(Barrier::new(3));
    let revision_counts = thread::scope(|scope| {
        let first_start = Arc::clone(&start);
        let first_note_id = note_id.clone();
        let first_state = &restarted;
        let first = scope.spawn(move || {
            first_start.wait();
            first_state
                .note_timeline()
                .open_history_mode(first_note_id)
                .revisions()
                .map(|revisions| revisions.len())
        });
        let second_start = Arc::clone(&start);
        let second_note_id = note_id.clone();
        let second_state = &restarted;
        let second = scope.spawn(move || {
            second_start.wait();
            second_state
                .note_timeline()
                .open_history_mode(second_note_id)
                .revisions()
                .map(|revisions| revisions.len())
        });
        start.wait();
        vec![
            first.join().unwrap().unwrap(),
            second.join().unwrap().unwrap(),
        ]
    });

    assert_eq!(revision_counts, vec![1, 1]);
    assert_eq!(prepared_history_intent_count_for_test("prepared"), 0);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn publication_failure_creates_no_revision_and_restart_abandons_the_intent() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-publish-fault-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-publish-fault-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    crate::state::inject_note_publication_failure_once();

    let error = save_retained_state(
        &state,
        "Unpublished".to_string(),
        "dirty draft".to_string(),
        None,
    )
    .expect_err("publication must fail after durable preparation");
    assert!(error
        .to_string()
        .contains("injected note publication failure"));
    let path = notes.path().join("Unpublished.md");
    assert!(!path.exists());
    assert_eq!(
        history_store::prepared_intent_count(&history_store::Store::for_test(), "prepared"),
        0
    );

    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let prepared = restarted
        .note_timeline()
        .prepare_revision_publication(MutationSource::NoteCreation, &path, None, None, "retry")
        .unwrap();
    let note_id = NoteIdentity::new(
        crate::note::parse_note(prepared.canonical_markdown())
            .frontmatter
            .managed
            .unwrap()
            .id,
    );
    let history = restarted
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(note_id));
    assert!(history.revisions().unwrap().is_empty());
    assert!(history.lifecycle_events().unwrap().is_empty());
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn adaptive_checkpoints_are_transparent_across_a_long_revision_chain() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-long-chain-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-long-chain-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let timeline = state.note_timeline();
    let path = notes.path().join("Long Chain.md");
    let mut note_id = None;
    for revision in 0..140 {
        let source = if revision == 0 {
            MutationSource::NoteCreation
        } else {
            MutationSource::Editor
        };
        let body = format!(
            "# Long chain\n\nrevision {revision}: {}",
            "x".repeat(revision)
        );
        let prepared = timeline
            .prepare_revision_publication(
                source,
                &path,
                (revision > 0).then_some(path.as_path()),
                None,
                &body,
            )
            .unwrap();
        let (canonical, history_intent) = prepared.into_parts();
        fs::write(&path, &canonical).unwrap();
        let result = timeline.mutate(NoteMutation::with_source(
            source,
            history_intent,
            path.clone(),
            (revision > 0).then(|| path.clone()),
            canonical,
        ));
        timeline.finalize_editing_window(result.note_id()).unwrap();
        note_id.get_or_insert_with(|| result.note_id().clone());
    }

    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let history = restarted
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(note_id.unwrap()));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 140);
    for index in [0usize, 127, 139] {
        assert_eq!(
            history
                .reconstruct(revisions[index].identity())
                .unwrap()
                .body(),
            format!("# Long chain\n\nrevision {index}: {}", "x".repeat(index))
        );
    }
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn app_commit_preserves_identity_when_authored_content_becomes_empty() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-empty-identity-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-empty-identity-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let note_path = notes.path().join("Note.md");
    let original = "---\ngneauxghts:\n  id: stable-note-1\n  kind: note\n---\n\nBody";
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

    let saved = save_retained_state(
        &state,
        "Note".to_string(),
        String::new(),
        Some(note_path.to_string_lossy().into_owned()),
    )
    .expect("publish empty authored content")
    .expect("saved session");

    assert_eq!(saved.note_id.as_deref(), Some("stable-note-1"));
    let canonical = fs::read_to_string(&note_path).expect("read repaired canonical note");
    assert_eq!(
        crate::note::parse_note(&canonical)
            .frontmatter
            .managed
            .expect("managed identity remains")
            .id,
        "stable-note-1"
    );
    assert_eq!(crate::note::strip_frontmatter(&canonical), "");
}

#[test]
fn copied_identity_cannot_replace_the_original_and_is_repaired_on_commit() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-copy-identity-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-copy-identity-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let original_path = notes.path().join("Original.md");
    let copy_path = notes.path().join("Copy.md");
    let markdown = "---\ngneauxghts:\n  id: stable-original-note\n  kind: note\n---\n\nCopied body";
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

    fs::write(&copy_path, markdown).expect("copy note byte for byte");
    timeline
        .observe(VaultObservation::external_edit(
            copy_path.clone(),
            42,
            Some(41),
        ))
        .unwrap();
    state
        .upsert_note_indexes(
            copy_path.clone(),
            crate::index::build_indexed_note(&copy_path, markdown, 41),
        )
        .expect("ingest copied note");

    let original_id = state
        .indexed_note_identity(&original_path)
        .unwrap()
        .expect("original identity");
    let copy_id = state
        .indexed_note_identity(&copy_path)
        .unwrap()
        .expect("copy identity");
    assert_eq!(original_id, "stable-original-note");
    assert_ne!(copy_id, original_id);
    assert_eq!(fs::read_to_string(&copy_path).unwrap(), markdown);

    // Re-observing in either order cannot transfer either association.
    state
        .upsert_note_indexes(
            original_path.clone(),
            crate::index::build_indexed_note(&original_path, markdown, 43),
        )
        .unwrap();
    state
        .upsert_note_indexes(
            copy_path.clone(),
            crate::index::build_indexed_note(&copy_path, markdown, 44),
        )
        .unwrap();
    assert_eq!(
        state
            .indexed_note_identity(&original_path)
            .unwrap()
            .as_deref(),
        Some(original_id.as_str())
    );
    assert_eq!(
        state.indexed_note_identity(&copy_path).unwrap().as_deref(),
        Some(copy_id.as_str())
    );

    let saved = save_retained_state(
        &state,
        "Copy".to_string(),
        "Copied body".to_string(),
        Some(copy_path.to_string_lossy().into_owned()),
    )
    .expect("commit copied note")
    .expect("saved session");
    assert_eq!(saved.note_id.as_deref(), Some(copy_id.as_str()));
    assert_eq!(
        crate::note::parse_note(&fs::read_to_string(&copy_path).unwrap())
            .frontmatter
            .managed
            .expect("copy identity repaired")
            .id,
        copy_id
    );

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
            .indexed_note_identity(&original_path)
            .unwrap()
            .as_deref(),
        Some(original_id.as_str())
    );
    assert_eq!(
        restarted
            .indexed_note_identity(&copy_path)
            .unwrap()
            .as_deref(),
        Some(copy_id.as_str())
    );
}

#[test]
fn warning_serialization_redacts_diagnostic_causes() {
    let warning = NoteMutationWarning::single(
        MutationWarningStage::CatalogUpsert,
        "Saved at /private/vault/Note.md after SELECT failed".to_string(),
        "SELECT catalog FROM /private/vault/catalog.sqlite3 failed".to_string(),
    );

    let serialized = serde_json::to_value(warning).unwrap();
    assert_eq!(
        serialized,
        serde_json::json!({
            "message": "The change was saved, but a follow-up update is awaiting automatic recovery.",
            "issues": [{
                "stage": "catalogUpsert",
                "message": "A post-commit update is awaiting automatic recovery."
            }]
        })
    );
    assert!(!serialized.to_string().contains("/private"));
    assert!(!serialized.to_string().contains("SELECT"));
}

#[test]
fn domain_records_carry_versioned_payloads_and_explicit_predecessors() {
    let note_id = NoteIdentity::new("note-1");
    let first = NoteRevisionHeader::issue(
        note_id.clone(),
        None,
        PayloadVersion::V1,
        MutationSource::Editor,
    );
    let first_id = first.identity.clone();
    let renamed = LifecycleEventHeader::issue(
        note_id.clone(),
        Some(TimelineRecordIdentity::Revision(first_id.clone())),
        PayloadVersion::V1,
        LifecycleEventKind::Renamed,
    );
    let event_id = renamed.identity.clone();
    let second = NoteRevisionHeader::issue(
        note_id,
        Some(TimelineRecordIdentity::LifecycleEvent(event_id)),
        PayloadVersion::V1,
        MutationSource::Editor,
    );

    assert_eq!(first.identity.0.len(), 26);
    assert_eq!(renamed.identity.0.len(), 26);
    assert_eq!(second.identity.0.len(), 26);
    assert_ne!(first.identity.0, renamed.identity.0);
    assert_ne!(renamed.identity.0, second.identity.0);
    assert_eq!(first.predecessor(), None);
    assert_eq!(renamed.kind(), LifecycleEventKind::Renamed);
    assert_eq!(renamed.payload_version(), PayloadVersion::V1);
    assert_eq!(
        second.predecessor(),
        Some(&TimelineRecordIdentity::LifecycleEvent(
            renamed.identity.clone()
        ))
    );
}

#[test]
fn mutation_result_preserves_required_warning_semantics_and_all_diagnostics() {
    let result = NoteMutationResult::from_publication(
        MutationSource::Editor,
        PublicationOutcome {
            note_id: "note-1".to_string(),
            path: PathBuf::from("/vault/Note.md"),
            canonical_markdown: "# Note".to_string(),
            issues: vec![
                NoteTimelineIssue {
                    stage: MutationWarningStage::CanonicalRead,
                    message: "read failed".to_string(),
                },
                NoteTimelineIssue {
                    stage: MutationWarningStage::SemanticUpdate,
                    message: "semantic queue failed".to_string(),
                },
            ],
        },
    );

    let warning = result.warning().expect("required warning");
    assert_eq!(warning.payload_version(), PayloadVersion::V1);
    assert_eq!(warning.issues().len(), 1);
    assert!(warning.message().contains("Canonical note file was saved"));
    assert_eq!(result.diagnostics().len(), 2);
}

#[test]
fn recovery_retry_waits_for_live_publication_before_and_after_markdown_write() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("retry-live-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("retry-live-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(&state, "Retry race".into(), "original".into(), None)
        .unwrap()
        .unwrap();
    state
        .note_timeline()
        .initialize_existing_notes(notes.path())
        .unwrap();
    let path = PathBuf::from(created.path.unwrap());
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    for published_before_retry in [false, true] {
        std::thread::scope(|scope| {
            let (started_tx, started_rx) = std::sync::mpsc::channel();
            let (finished_tx, finished_rx) = std::sync::mpsc::channel();
            let (outcome, completed_early) =
                crate::state::with_note_file_mutation(|| -> Result<_, HistoryError> {
                    let prepared = state.note_timeline().prepare_revision_publication(
                        MutationSource::Editor,
                        &path,
                        Some(&path),
                        Some(&note_id),
                        if published_before_retry {
                            "third state"
                        } else {
                            "second state"
                        },
                    )?;
                    let (canonical, intent) = prepared.into_parts();
                    if published_before_retry {
                        fs::write(&path, &canonical).unwrap();
                    }
                    let state = &state;
                    let notes = &notes;
                    scope.spawn(move || {
                        started_tx.send(()).unwrap();
                        let report = state.note_timeline().retry_history_recovery(notes.path());
                        finished_tx.send(report).unwrap();
                    });
                    started_rx.recv().unwrap();
                    let completed_early = finished_rx
                        .recv_timeout(std::time::Duration::from_millis(100))
                        .ok();
                    if !published_before_retry {
                        fs::write(&path, &canonical).unwrap();
                    }
                    let outcome = state.note_timeline().mutate(NoteMutation::editor(
                        intent,
                        path.clone(),
                        None,
                        canonical,
                    ));
                    Ok((outcome, completed_early))
                })
                .unwrap();
            let was_early = completed_early.is_some();
            let recovered = completed_early.unwrap_or_else(|| {
                finished_rx
                    .recv_timeout(std::time::Duration::from_secs(5))
                    .unwrap()
            });
            assert!(recovered.is_ok());
            assert!(
                !was_early,
                "Recovery must wait for the canonical writer to settle"
            );
            assert!(outcome.warning().is_none());
        });
        state
            .note_timeline()
            .finalize_editing_window(&note_id)
            .unwrap();
    }
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    assert_eq!(
        restarted
            .note_timeline()
            .open_history_mode(note_id)
            .revisions()
            .unwrap()
            .len(),
        3
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn settled_publications_do_not_retain_full_authored_copies() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("settled-intents-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("settled-intents-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let body = "retained body".repeat(10_000);
    let mut path = None;
    let mut note_id = None;
    for _ in 0..16 {
        let saved =
            save_retained_state(&state, "Intent storage".into(), body.clone(), path.clone())
                .unwrap()
                .unwrap();
        path = saved.path;
        note_id = saved.note_id;
    }
    let path = PathBuf::from(path.unwrap());
    let note_id = NoteIdentity::new(note_id.unwrap());
    for _ in 0..8 {
        crate::state::with_note_file_mutation(|| -> Result<(), HistoryError> {
            let prepared = state.note_timeline().prepare_revision_publication(
                MutationSource::Editor,
                &path,
                Some(&path),
                Some(&note_id),
                &"unpublished".repeat(12_000),
            )?;
            prepared.into_parts().1.abandon()
        })
        .unwrap();
    }
    assert_eq!(
        state
            .note_timeline()
            .open_history_mode(note_id.clone())
            .revisions()
            .unwrap()
            .len(),
        1
    );
    state
        .note_timeline()
        .compact_history_storage(16 * 1024 * 1024)
        .unwrap();
    let usage = state.note_timeline().history_storage_usage().unwrap();
    assert!(
        usage.allocated_bytes() - usage.reclaimable_bytes() < 512 * 1024,
        "Identical and abandoned saves retained {} live bytes",
        usage.allocated_bytes() - usage.reclaimable_bytes()
    );
    state.note_timeline().clean_close(notes.path()).unwrap();
    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let history = restarted.note_timeline().open_history_mode(note_id);
    let revision = history.revisions().unwrap().remove(0);
    assert_eq!(
        history
            .reconstruct(revision.identity())
            .unwrap()
            .body()
            .trim(),
        body
    );
    crate::state::set_notes_root_override(None).unwrap();
}
