#[test]
fn named_revisions_survive_restart_allow_duplicates_and_never_change_content() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-named-revisions-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-named-revisions-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Named history".to_string(),
        "First state".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    save_retained_state(
        &state,
        "Named history".to_string(),
        "Second state".to_string(),
        Some(path.to_string_lossy().into_owned()),
    )
    .unwrap();

    let history = state.note_timeline().open_history_mode(note_id.clone());
    let revisions = history.revisions().unwrap();
    let first_id = revisions[0].identity().0.clone();
    let second_id = revisions[1].identity().0.clone();
    let bodies_before = revisions
        .iter()
        .map(|revision| history.reconstruct(revision.identity()).unwrap().body)
        .collect::<Vec<_>>();
    history
        .name_revision(&RevisionIdentity::from_persisted(&first_id), "Milestone")
        .unwrap();
    history
        .name_revision(&RevisionIdentity::from_persisted(&second_id), "Milestone")
        .unwrap();

    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let restarted_history = restarted.note_timeline().open_history_mode(note_id);
    let page = restarted_history.page(None, 100).unwrap();
    assert_eq!(
        page.records()
            .iter()
            .filter_map(HistoryModeRecord::revision_label)
            .collect::<Vec<_>>(),
        vec!["Milestone", "Milestone"]
    );

    restarted_history
        .name_revision(&RevisionIdentity::from_persisted(&first_id), "Foundation")
        .unwrap();
    restarted_history
        .remove_revision_name(&RevisionIdentity::from_persisted(&second_id))
        .unwrap();
    let page = restarted_history.page(None, 100).unwrap();
    assert_eq!(
        page.records()
            .iter()
            .filter_map(HistoryModeRecord::revision_label)
            .collect::<Vec<_>>(),
        vec!["Foundation"]
    );
    let revisions_after = restarted_history.revisions().unwrap();
    assert_eq!(
        revisions_after
            .iter()
            .map(|revision| restarted_history
                .reconstruct(revision.identity())
                .unwrap()
                .body)
            .collect::<Vec<_>>(),
        bodies_before
    );
    assert_eq!(
        revisions_after
            .iter()
            .map(|revision| revision.identity().0.clone())
            .collect::<Vec<_>>(),
        vec![first_id, second_id]
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn revision_summaries_count_unicode_authored_content_deterministically() {
    let revision = ReconstructedNoteRevision {
        unmanaged_frontmatter: Some("project: atlas\n".to_string()),
        body: "Hello 🌍\nagain".to_string(),
    };

    assert_eq!(authored_content_counts(&revision), (3, 28));
    assert_eq!(
        authored_content_counts(&ReconstructedNoteRevision {
            unmanaged_frontmatter: None,
            body: String::new(),
        }),
        (0, 0)
    );
}

#[test]
fn historical_diffs_compare_parent_and_current_authored_state_and_report_missing_assets() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-diff-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-diff-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    fs::create_dir_all(notes.path().join("assets")).unwrap();
    fs::write(notes.path().join("assets/present.png"), b"image").unwrap();
    fs::write(notes.path().join("assets/present.pdf"), b"pdf").unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();

    let first = "---\nproject: atlas\n---\n\nKept\nRemoved\n*old*\n";
    let created = save_retained_state(&state, "Diff note".to_string(), first.to_string(), None)
        .unwrap()
        .unwrap();
    let path = created.path.clone().unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let second = "---\nproject: zeus\n---\n\nKept\nInserted\n**new**\n![[present.png]]\n![[present.pdf]]\n![[missing.png|320]]\n![[missing.pdf]]\n[recording](assets/missing.mp3)\n[workbook](assets/report(2026).xlsx)\n`![[inline-code.zip]]`\n```md\n![[fenced-code.wav]]\n```\n";
    save_retained_state(
        &state,
        "Diff note".to_string(),
        second.to_string(),
        Some(path.clone()),
    )
    .unwrap();
    let current = "---\nproject: zeus\nstatus: current\n---\n\nKept\nCurrent ending\n";
    save_retained_state(
        &state,
        "Diff note".to_string(),
        current.to_string(),
        Some(path),
    )
    .unwrap();

    let history = state
        .note_timeline()
        .history_mode(HistoryModeGrant::authorized(note_id));
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 3);
    let selected_id = revisions[1].identity();

    let parent = history
        .diff(&selected_id.0, HistoryDiffComparison::Parent)
        .unwrap();
    assert_eq!(parent.comparison(), HistoryDiffComparison::Parent);
    assert_eq!(
        parent.compared_from_revision_id(),
        Some(revisions[0].identity().0.as_str())
    );
    assert_eq!(
        parent.to_revision_id(),
        Some(revisions[1].identity().0.as_str())
    );
    assert!(parent
        .body_lines()
        .iter()
        .any(|line| { line.kind() == HistoryDiffLineKind::Removed && line.text() == "Removed\n" }));
    assert!(parent
        .body_lines()
        .iter()
        .any(|line| { line.kind() == HistoryDiffLineKind::Added && line.text() == "Inserted\n" }));
    assert!(parent.properties_lines().iter().any(|line| {
        line.kind() == HistoryDiffLineKind::Removed && line.text() == "project: atlas\n"
    }));
    assert!(parent.properties_lines().iter().any(|line| {
        line.kind() == HistoryDiffLineKind::Added && line.text() == "project: zeus\n"
    }));
    assert_eq!(
        parent.missing_assets(),
        &[
            "missing.mp3".to_string(),
            "missing.pdf".to_string(),
            "missing.png".to_string(),
            "report(2026).xlsx".to_string()
        ]
    );
    assert!(parent
        .body_lines()
        .iter()
        .all(|line| !line.text().contains("gneauxghts")));
    assert!(parent
        .properties_lines()
        .iter()
        .all(|line| !line.text().contains("gneauxghts")
            && !line.text().contains("created_at")
            && !line.text().contains("updated_at")));

    let current_diff = history
        .diff(&selected_id.0, HistoryDiffComparison::Current)
        .unwrap();
    assert_eq!(
        current_diff.compared_from_revision_id(),
        Some(revisions[1].identity().0.as_str())
    );
    assert_eq!(
        current_diff.to_revision_id(),
        Some(revisions[2].identity().0.as_str())
    );
    assert!(current_diff.body_lines().iter().any(|line| {
        line.kind() == HistoryDiffLineKind::Added && line.text() == "Current ending\n"
    }));
    assert!(current_diff.properties_lines().iter().any(|line| {
        line.kind() == HistoryDiffLineKind::Added && line.text() == "status: current\n"
    }));
    assert_eq!(
        current_diff.missing_assets(),
        &[
            "missing.mp3".to_string(),
            "missing.pdf".to_string(),
            "missing.png".to_string(),
            "report(2026).xlsx".to_string()
        ]
    );

    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn historical_line_diffs_cover_empty_content_without_inventing_lines() {
    assert!(diff_lines("", "").is_empty());
    assert_eq!(
        diff_lines("", "First line without a newline"),
        vec![HistoryDiffLine {
            kind: HistoryDiffLineKind::Added,
            text: "First line without a newline".to_string(),
            old_line_number: None,
            new_line_number: Some(1),
        }]
    );
    assert_eq!(
        diff_lines("Last content\n", ""),
        vec![HistoryDiffLine {
            kind: HistoryDiffLineKind::Removed,
            text: "Last content\n".to_string(),
            old_line_number: Some(1),
            new_line_number: None,
        }]
    );
}

#[test]
fn history_mode_pages_records_with_a_stable_cursor_and_reconstructs_the_selected_revision() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-history-mode-page-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-history-mode-page-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(&state, "Paged".to_string(), "first".to_string(), None)
        .unwrap()
        .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = created.path.unwrap();
    for body in ["second", "third", "fourth", "fifth"] {
        save_retained_state(
            &state,
            "Paged".to_string(),
            body.to_string(),
            Some(path.clone()),
        )
        .unwrap();
    }

    let access = state.note_timeline().open_history_mode(note_id.clone());
    let revisions = access.revisions().unwrap();
    let oldest_revision = revisions[0].identity().clone();
    replace_one_revision_source_for_test(&note_id, &oldest_revision, "invalid-old-source");
    let first_page = access.page(None, 2).unwrap();
    replace_one_revision_source_for_test(&note_id, &oldest_revision, "noteCreation");
    assert_eq!(first_page.records().len(), 2);
    let serialized = serde_json::to_value(&first_page).unwrap();
    assert_eq!(serialized["records"][0]["kind"], "revision");
    assert!(serialized["records"][0]["recordId"].is_string());
    assert!(serialized["records"][0]["revisionId"].is_string());
    assert_eq!(serialized["records"][0]["timeKind"], "editingWindow");
    assert_eq!(serialized["records"][0]["lineCount"], 1);
    assert_eq!(serialized["records"][0]["characterCount"], 5);
    assert!(serialized.get("nextCursor").is_some());
    let cursor = first_page
        .next_cursor()
        .expect("older page cursor")
        .to_string();
    let selected_id = first_page.records()[0]
        .revision_id()
        .expect("newest record is a revision")
        .to_string();
    assert_eq!(access.revision(&selected_id).unwrap().body(), "fifth");
    save_retained_state(&state, "Paged".to_string(), "sixth".to_string(), Some(path)).unwrap();
    let second_page = access.page(Some(&cursor), 2).unwrap();
    let first_ids = first_page
        .records()
        .iter()
        .map(HistoryModeRecord::record_id)
        .collect::<HashSet<_>>();
    assert!(second_page
        .records()
        .iter()
        .all(|record| !first_ids.contains(record.record_id())));
    assert!(second_page
        .records()
        .iter()
        .all(|record| record.revision_id() != Some(selected_id.as_str())));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn revision_context_corruption_after_attestation_latches_publication_gate() {
    let _guard = crate::test_support::lock_test_env();
    let data = crate::test_support::TestDir::new("citation-corrupt-data");
    let notes = crate::test_support::TestDir::new("citation-corrupt-vault");
    crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(&state, "Context".into(), "first".into(), None)
        .unwrap()
        .unwrap();
    let id = NoteIdentity::new(created.note_id.unwrap());
    let path = created.path.unwrap();
    let access = state.note_timeline().open_history_mode(id.clone());
    let anchor = access.revisions().unwrap()[0].identity.as_str().to_string();
    access.revision_context(&anchor, None).unwrap();
    history_store::sql_work::break_lifecycle_predecessor(&state.note_timeline().runtime.store, &id);
    assert!(matches!(
        access.revision_context(&anchor, None),
        Err(HistoryError::Corrupt(_))
    ));
    let before = fs::read(&path).unwrap();
    assert!(save_retained_state(
        &state,
        "Context".into(),
        "blocked".into(),
        Some(path.clone())
    )
    .is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn revision_context_seeks_and_pages_explicit_lineage_with_scoped_stale_cursors() {
    let _guard = crate::test_support::lock_test_env();
    let data = crate::test_support::TestDir::new("citation-context-data");
    let notes = crate::test_support::TestDir::new("citation-context-vault");
    crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let first = save_retained_state(&state, "Context 0".into(), "first".into(), None)
        .unwrap()
        .unwrap();
    let note_id = NoteIdentity::new(first.note_id.unwrap());
    let mut path = first.path.unwrap();
    for index in 1..80 {
        // Rename boundaries interleave Lifecycle Events with Note Revisions.
        path = save_retained_state(
            &state,
            format!("Context {}", index / 10),
            format!("body {index}"),
            Some(path),
        )
        .unwrap()
        .unwrap()
        .path
        .unwrap();
    }
    let access = state.note_timeline().open_history_mode(note_id.clone());
    let full = access.page(None, 100).unwrap();
    assert!(full.records.len() > 80);
    let anchor = full.records[45..]
        .iter()
        .find_map(HistoryModeRecord::revision_id)
        .unwrap();
    let anchor_index = full
        .records
        .iter()
        .position(|r| r.revision_id() == Some(anchor))
        .unwrap();
    let context = access.revision_context(anchor, None).unwrap();
    assert_eq!(context.records.len(), 31);
    assert_eq!(context.records[15].revision_id(), Some(anchor));
    for (index, record) in context.records.iter().enumerate() {
        assert_eq!(
            record.record_id(),
            full.records[anchor_index - 15 + index].record_id()
        );
        let ordinal = serde_json::to_value(record).unwrap()["timelineOrdinal"]
            .as_i64()
            .unwrap();
        assert_eq!(ordinal, 15 - index as i64);
    }
    let older = access
        .revision_context(anchor, context.next_cursor.as_deref())
        .unwrap();
    assert_eq!(
        older.records[0].record_id(),
        full.records[anchor_index + 16].record_id()
    );
    let back = access
        .revision_context(anchor, older.previous_cursor.as_deref())
        .unwrap();
    assert_eq!(back.records, context.records);
    let newer = access
        .revision_context(anchor, context.previous_cursor.as_deref())
        .unwrap();
    assert_eq!(
        newer.records.last().unwrap().record_id(),
        full.records[anchor_index - 16].record_id()
    );
    assert!(matches!(
        access.page(context.next_cursor.as_deref(), 30),
        Err(HistoryError::Stale(_))
    ));
    assert!(matches!(
        access.revision_context("absent", None),
        Err(HistoryError::Missing(_))
    ));
    let other_anchor = full
        .records
        .iter()
        .find_map(HistoryModeRecord::revision_id)
        .unwrap();
    assert!(matches!(
        access.revision_context(other_anchor, context.next_cursor.as_deref()),
        Err(HistoryError::Stale(_))
    ));
    let mut cursor: HistoryContextCursor = serde_json::from_slice(
        &BASE64_URL_SAFE
            .decode(context.next_cursor.as_ref().unwrap())
            .unwrap(),
    )
    .unwrap();
    cursor.scope.history_generation += 1;
    let stale = BASE64_URL_SAFE.encode(serde_json::to_vec(&cursor).unwrap());
    assert!(matches!(
        access.revision_context(anchor, Some(&stale)),
        Err(HistoryError::Stale(_))
    ));
    let unrelated = state
        .note_timeline()
        .open_history_mode(NoteIdentity::new("other-note"));
    assert!(unrelated.revision_context(anchor, None).is_err());
    let plan = history_store::sql_work::successor_plan(&state.note_timeline().runtime.store);
    assert!(plan
        .iter()
        .any(|step| step.contains("revisions_by_predecessor")));
    assert!(plan
        .iter()
        .any(|step| step.contains("lifecycle_events_by_predecessor")));
    state.note_timeline().clear_note_history(&note_id).unwrap();
    assert!(matches!(
        access.revision_context(anchor, context.next_cursor.as_deref()),
        Err(HistoryError::Missing(_))
    ));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn version_restore_is_complete_hash_bound_append_only_and_reversible_after_restart() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-version-restore-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-version-restore-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Current title".to_string(),
        "---\nproject: original\n---\n\nEarlier body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let mut path = PathBuf::from(created.path.unwrap());
    let access = state.note_timeline().open_history_mode(note_id.clone());
    let earlier_revision_id = access.revisions().unwrap()[0].identity().clone();

    let renamed = save_retained_state(
        &state,
        "Renamed current title".to_string(),
        "---\nproject: current\n---\n\nCurrent body".to_string(),
        Some(path.to_string_lossy().into_owned()),
    )
    .unwrap();
    path = PathBuf::from(renamed.unwrap().path.unwrap());
    let before_restore = fs::read_to_string(&path).unwrap();
    let before_metadata = crate::note::parse_note(&before_restore)
        .frontmatter
        .managed
        .unwrap();
    let preview = access
        .restore_preview(earlier_revision_id.as_str())
        .unwrap();
    assert_eq!(preview.revision_id(), earlier_revision_id.as_str());
    assert_eq!(preview.unmanaged_frontmatter(), Some("project: original\n"));
    assert_eq!(preview.body(), "Earlier body");

    save_retained_state(
        &state,
        "Renamed current title".to_string(),
        "---\nproject: concurrent\n---\n\nConcurrent edit".to_string(),
        Some(path.to_string_lossy().into_owned()),
    )
    .unwrap();
    let stale_error = access
        .confirm_restore(
            earlier_revision_id.as_str(),
            preview.current_authored_content_hash(),
        )
        .expect_err("concurrent authored edit invalidates preview");
    assert!(stale_error
        .to_string()
        .contains("Current authored content changed"));
    assert_eq!(
        crate::note::parse_note(&fs::read_to_string(&path).unwrap()).body,
        "Concurrent edit"
    );

    let pre_restore_revision_id = access
        .revisions()
        .unwrap()
        .last()
        .unwrap()
        .identity()
        .clone();
    let lifecycle_before_restore = access.lifecycle_events().unwrap();
    assert!(lifecycle_before_restore
        .iter()
        .any(|event| event.kind() == LifecycleEventKind::Renamed));
    let preview = access
        .restore_preview(earlier_revision_id.as_str())
        .unwrap();
    let restored = access
        .confirm_restore(
            earlier_revision_id.as_str(),
            preview.current_authored_content_hash(),
        )
        .unwrap();
    assert_eq!(restored.mutation().note_id(), &note_id);
    assert_eq!(restored.mutation().path(), path.as_path());
    let restored_markdown = fs::read_to_string(&path).unwrap();
    let restored_note = crate::note::parse_note(&restored_markdown);
    assert_eq!(
        restored_note.frontmatter.raw_other.as_deref(),
        Some("project: original")
    );
    assert_eq!(restored_note.body, "Earlier body");
    let restored_metadata = restored_note.frontmatter.managed.unwrap();
    assert_eq!(restored_metadata.id, before_metadata.id);
    assert_eq!(restored_metadata.created_at, before_metadata.created_at);
    assert_eq!(restored_metadata.trashed_at, before_metadata.trashed_at);
    assert_eq!(restored_metadata.kind, before_metadata.kind);
    assert_eq!(path.file_stem().unwrap(), "Renamed current title");

    let restarted = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let restarted_access = restarted.note_timeline().open_history_mode(note_id.clone());
    let revisions = restarted_access.revisions().unwrap();
    assert_eq!(
        restarted_access.lifecycle_events().unwrap(),
        lifecycle_before_restore
    );
    assert_eq!(revisions.len(), 4);
    assert_eq!(
        revisions.last().unwrap().source(),
        MutationSource::VersionRestore
    );
    assert_eq!(restored.revision_id(), revisions.last().unwrap().identity());
    assert_eq!(
        reconstructed_revision_bodies_for_test(&restarted, note_id.as_str()).unwrap(),
        vec![
            "Earlier body",
            "Current body",
            "Concurrent edit",
            "Earlier body"
        ]
    );

    let reverse_preview = restarted_access
        .restore_preview(pre_restore_revision_id.as_str())
        .unwrap();
    restarted_access
        .confirm_restore(
            pre_restore_revision_id.as_str(),
            reverse_preview.current_authored_content_hash(),
        )
        .unwrap();
    let reversed = restarted_access.revisions().unwrap();
    assert_eq!(reversed.len(), 5);
    assert_eq!(
        reversed.last().unwrap().source(),
        MutationSource::VersionRestore
    );
    assert_eq!(
        crate::note::parse_note(&fs::read_to_string(&path).unwrap()).body,
        "Concurrent edit"
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn version_restore_can_replace_current_authored_content_with_empty_content() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-empty-version-restore-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-empty-version-restore-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(&state, "Empty history".to_string(), String::new(), None)
        .unwrap()
        .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    let access = state.note_timeline().open_history_mode(note_id.clone());
    let empty_revision = access.revisions().unwrap()[0].identity().clone();
    save_retained_state(
        &state,
        "Empty history".to_string(),
        "Not empty now".to_string(),
        Some(path.to_string_lossy().into_owned()),
    )
    .unwrap();

    let preview = access.restore_preview(empty_revision.as_str()).unwrap();
    access
        .confirm_restore(
            empty_revision.as_str(),
            preview.current_authored_content_hash(),
        )
        .unwrap();

    let canonical = fs::read_to_string(&path).unwrap();
    let parsed = crate::note::parse_note(&canonical);
    assert_eq!(parsed.body, "");
    assert_eq!(parsed.frontmatter.raw_other, None);
    assert_eq!(parsed.frontmatter.managed.unwrap().id, note_id.as_str());
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn version_restore_preserves_exact_historical_frontmatter_and_line_endings() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-exact-version-restore-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-exact-version-restore-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Exact history".to_string(),
        "Initial body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let path = PathBuf::from(created.path.unwrap());
    let exact_unmanaged = "project: atlas\r\n\r\nflag: true\r\n";
    let exact_body = "Historical first\r\nHistorical second\r\n";
    let exact = crate::note::replace_authored_content(
        &fs::read_to_string(&path).unwrap(),
        Some(exact_unmanaged),
        exact_body,
    )
    .unwrap();
    fs::write(&path, &exact).unwrap();
    state
        .note_timeline()
        .observe(VaultObservation::external_edit(path.clone(), 10, Some(9)))
        .unwrap();
    let access = state.note_timeline().open_history_mode(note_id.clone());
    let exact_revision = access
        .revisions()
        .unwrap()
        .last()
        .unwrap()
        .identity()
        .clone();

    save_retained_state(
        &state,
        "Exact history".to_string(),
        "Current body".to_string(),
        Some(path.to_string_lossy().into_owned()),
    )
    .unwrap();
    let preview = access.restore_preview(exact_revision.as_str()).unwrap();
    assert_eq!(preview.unmanaged_frontmatter(), Some(exact_unmanaged));
    assert_eq!(preview.body(), exact_body);
    let restored = access
        .confirm_restore(
            exact_revision.as_str(),
            preview.current_authored_content_hash(),
        )
        .unwrap();

    let restored_markdown = fs::read_to_string(&path).unwrap();
    assert_eq!(
        history_store::authored_content_hash(&restored_markdown),
        history_store::authored_parts_hash(Some(exact_unmanaged), exact_body)
    );
    let restored_revision = access.revision(restored.revision_id().as_str()).unwrap();
    assert_eq!(
        restored_revision.unmanaged_frontmatter(),
        Some(exact_unmanaged)
    );
    assert_eq!(restored_revision.body(), exact_body);
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn forgotten_note_history_requires_recovery_before_inspection_or_version_restore() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = crate::test_support::TestDir::new("timeline-forgotten-version-restore-app-data");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("timeline-forgotten-version-restore-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created = save_retained_state(
        &state,
        "Forgotten history".to_string(),
        "Earlier body".to_string(),
        None,
    )
    .unwrap()
    .unwrap();
    let note_id = NoteIdentity::new(created.note_id.unwrap());
    let active_path = PathBuf::from(created.path.unwrap());
    let access = state.note_timeline().open_history_mode(note_id.clone());
    let earlier_revision = access.revisions().unwrap()[0].identity().clone();
    save_retained_state(
        &state,
        "Forgotten history".to_string(),
        "Current body".to_string(),
        Some(active_path.to_string_lossy().into_owned()),
    )
    .unwrap();

    let forgotten_path =
        crate::state::forgotten_notes_root(notes.path()).join("Forgotten history.md");
    let mut forgotten_publication = None;
    let delivered = state
        .note_timeline()
        .current_content(AllowedScope::vault())
        .read(|| {
            forgotten_publication =
                Some(state.note_timeline().forget_note(&active_path, 7).unwrap());
            Ok(vec![TestCurrentContentItem {
                note_id: note_id.as_str().to_string(),
                note_path: active_path.to_string_lossy().into_owned(),
            }])
        })
        .unwrap();
    let forgotten_publication = forgotten_publication
        .expect("forgotten publication is captured during the current-content read");
    let (selected, warning) = forgotten_publication;
    assert!(warning.is_none());
    assert_eq!(retained_observation_count_for_test(), 0);
    assert!(delivered.is_empty());
    assert!(!active_path.exists());
    assert!(forgotten_path.exists());
    let still_forgotten = crate::note::parse_note(&fs::read_to_string(&forgotten_path).unwrap());
    assert_eq!(still_forgotten.body, "Current body");
    assert!(still_forgotten
        .frontmatter
        .managed
        .unwrap()
        .trashed_at
        .is_some());
    drop(access);
    drop(state);
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let access = state.note_timeline().open_history_mode(note_id.clone());
    assert!(matches!(
        access.revision_context(earlier_revision.as_str(), None),
        Err(HistoryError::Ineligible(_))
    ));
    assert!(access
        .page(None, 50)
        .unwrap_err()
        .to_string()
        .contains("Recover"));
    assert_eq!(retained_observation_count_for_test(), 0);
    assert!(state
        .note_timeline()
        .clear_note_history(&note_id)
        .unwrap_err()
        .to_string()
        .contains("Recover the forgotten note"));
    for error in [
        access.revision(earlier_revision.as_str()).unwrap_err(),
        access
            .restore_preview(earlier_revision.as_str())
            .unwrap_err(),
    ] {
        assert!(error.to_string().contains("Recover the forgotten note"));
    }
    let (recovered_path, warning) = state
        .note_timeline()
        .recover_forgotten_note(&selected)
        .unwrap()
        .unwrap();
    assert_eq!(recovered_path, active_path);
    assert!(warning.is_none());

    assert_eq!(access.revisions().unwrap().len(), 2);
    assert_eq!(
        access
            .lifecycle_events()
            .unwrap()
            .into_iter()
            .map(|event| event.kind())
            .collect::<Vec<_>>(),
        vec![
            LifecycleEventKind::Created,
            LifecycleEventKind::Forgotten,
            LifecycleEventKind::Recovered,
        ]
    );
    let preview = access.restore_preview(earlier_revision.as_str()).unwrap();
    access
        .confirm_restore(
            earlier_revision.as_str(),
            preview.current_authored_content_hash(),
        )
        .unwrap();
    assert_eq!(
        crate::note::parse_note(&fs::read_to_string(active_path).unwrap()).body,
        "Earlier body"
    );
    assert_eq!(access.revisions().unwrap().len(), 3);
    crate::state::set_notes_root_override(None).unwrap();
}
