use super::*;

#[test]
fn chat_search_and_reads_survive_unrelated_legacy_identity_bookkeeping() {
    let (vault, context, _) = fixture();
    let legacy = vault.notes.path().join("Legacy.md");
    std::fs::write(&legacy, "Unrelated legacy content").unwrap();
    vault
        .state
        .upsert_note_indexes(
            legacy.clone(),
            crate::index::build_indexed_note(&legacy, "Unrelated legacy content", 1),
        )
        .unwrap();
    tauri::async_runtime::block_on(async {
        let found = FindNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(json!({"query":"first line","mode":"literal"})).unwrap(),
            )
            .await
            .unwrap();
        let selector = found["items"][0]["evidenceId"].as_str().unwrap();
        let args = json!({"purpose":"answer","evidence_ids":[selector]});
        let before = ReadNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(args.clone()).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(before["status"], "ready");
        context.validate_context().unwrap();
        vault
            .state
            .note_timeline()
            .observe(
                crate::services::note_timeline::VaultObservation::external_edit(
                    legacy.clone(),
                    2,
                    Some(1),
                ),
            )
            .unwrap();
        vault
            .state
            .upsert_note_indexes(
                legacy.clone(),
                crate::index::build_indexed_note(&legacy, "Unrelated legacy content", 1),
            )
            .unwrap();
        let after = ReadNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(args).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(after["status"], "ready");
        assert_eq!(before["items"][0]["excerpt"], after["items"][0]["excerpt"]);
        context
            .validate_context()
            .expect("The next model call must admit unchanged evidence");
    });
}

#[test]
fn structured_edit_followup_keeps_note_identity_after_editor_switch_and_branch() {
    let (vault, context, id) = fixture();
    tauri::async_runtime::block_on(async {
        let read = ReadNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(json!({"purpose":"edit","note_id":id})).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(read["status"], "ready");
    });
    context.service.test_store_structured_edit_answer(
        &context,
        &context.assistant_message_id,
        &context.run_id,
    );
    let reopened = ChatService::new(vault.notes.path().into(), vault.data.path().into()).unwrap();
    let beta = crate::commands::note_persistence::persist_note_session_with_outcome(
        &vault.state,
        "Beta".into(),
        "Unrelated editor body".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let next = AgentToolContext::with_host(
        context.host.clone(),
        reopened,
        "follow-up".into(),
        context.run_id.clone(),
        context.conversation_id.clone(),
        context.assistant_message_id.clone(),
        VaultAccess::Full,
        Some(ActiveNoteSnapshot {
            note_id: beta.note_id,
            title: "Beta".into(),
            path: None,
            body: String::new(),
            body_hash: String::new(),
            selection: None,
        }),
        HashSet::new(),
        false,
        None,
    );
    let history = next
        .service
        .test_model_history_with_note_hints(&context.conversation_id, &next);
    assert!(
        history.contains(&id),
        "Editing follow-up lost its note identity: {history}"
    );
    assert!(history.contains("Beta"));
    assert!(!history.contains("first line") && !history.contains("Prepared changes for review."));
    assert!(next.sources().is_empty() && next.read_coverage.lock().unwrap().is_empty());
    let branch = next
        .service
        .branch_from_message(&context.assistant_message_id)
        .unwrap();
    let branched = next
        .service
        .test_model_history_with_note_hints(&branch.summary.id, &next);
    assert!(
        branched.contains(&id),
        "Branch dropped the editing referent"
    );
    let summary = next
        .service
        .test_compact_saved_conversation(&context.conversation_id);
    assert!(!summary.contains("first line") && !summary.contains("Prepared changes for review."));
    let compacted = next
        .service
        .test_model_history_with_note_hints(&context.conversation_id, &next);
    assert!(
        compacted.contains(&id),
        "Compaction dropped the editing referent"
    );
    assert!(
        !compacted.contains("first line") && !compacted.contains("Prepared changes for review.")
    );
    next.service
        .set_note_excluded(&id, "Tool note", true)
        .unwrap();
    let excluded = next
        .service
        .test_model_history_with_note_hints(&branch.summary.id, &next);
    assert!(
        !excluded.contains(&id),
        "Excluded working note survived as a navigation hint"
    );
}

#[test]
fn explicit_body_context_is_withheld_when_its_history_marker_cannot_be_saved() {
    let (_vault, mut context, id) = fixture();
    context.run_id = "missing-run".into();
    assert!(context
        .explicit_wikilink_context("Explain [[Tool note]]")
        .is_err());
    Arc::make_mut(&mut context.run_grants).insert(id.clone());
    assert!(context
        .selected_context_prompt(&[crate::chat::ChatRunContextItem {
            note_id: id.clone(),
            note_path: "Tool note.md".into(),
            title: "Tool note".into(),
            section_label: None,
            excerpt: "first line".into(),
            content_hash: String::new(),
            reason: "explicit attachment".into(),
            start_line: None,
            end_line: None,
            block_anchor: None,
        }])
        .is_err());
    tauri::async_runtime::block_on(async {
        assert!(ReadNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(json!({"purpose":"edit","note_id":id})).unwrap(),
            )
            .await
            .is_err());
    });
    assert!(context.sources().is_empty());
    let (path, _, _) = context.resolve_note(&id).unwrap();
    let working = canonical_working_note(&fs::read_to_string(path).unwrap());
    assert!(!context.was_fully_read(&id, &working.content_hash));
}

async fn answer_read(context: &AgentToolContext, id: &str) -> Value {
    ReadNotesTool(context.clone())
        .call(
            &mut ToolContext::new(),
            serde_json::from_value(json!({"purpose":"answer","note_id":id})).unwrap(),
        )
        .await
        .unwrap()
}

async fn find_in_note(context: &AgentToolContext, id: &str, query: &str) -> Value {
    FindNotesTool(context.clone())
        .call(
            &mut ToolContext::new(),
            serde_json::from_value(json!({"query":query,"mode":"lexical","note_ids":[id]}))
                .unwrap(),
        )
        .await
        .unwrap()
}

#[test]
fn lexical_title_matches_read_and_cite_the_title_without_false_staleness() {
    let (vault, context, id) = fixture();
    vault
        .state
        .lexical
        .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
        .unwrap();
    tauri::async_runtime::block_on(async {
        let found = find_in_note(&context, &id, "Tool note").await;
        assert_eq!(
            found["coverage"]["complete"], true,
            "Fresh title matches reported an incomplete search: {found}"
        );
        let title = found["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["location"] == "title")
            .expect("Title match lost its canonical location");
        assert_eq!(title["preview"], "Tool note");
        let read = ReadNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(
                    json!({"purpose":"answer","evidence_ids":[title["evidenceId"]]}),
                )
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(read["items"][0]["location"], "title");
        assert_eq!(read["items"][0]["excerpt"], "Tool note");
        assert_eq!(read["items"][0]["start"], 0);
        assert_eq!(read["items"][0]["end"], 9);
        let citation = read["items"][0]["citation"].as_str().unwrap();
        let rendered = context
            .render_passage_references(&format!("Title: Tool note {citation}"))
            .unwrap();
        assert!(rendered.contains("](passage:"));
        let source = context.sources().into_iter().next().unwrap();
        assert_eq!(source.passage.unwrap().location, "title");
        context
            .service
            .set_note_excluded(&id, "Tool note", true)
            .unwrap();
        assert!(context.sources().is_empty());
        assert!(find_in_note(&context, &id, "Tool note").await["items"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(ReadNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(
                    json!({"purpose":"answer","evidence_ids":[title["evidenceId"]]})
                )
                .unwrap()
            )
            .await
            .is_err());
    });
}

#[test]
fn lexical_title_matches_do_not_bind_to_ambiguous_repeated_body_text() {
    let (vault, context, _) = fixture();
    let id = crate::test_support::save_and_finalize(
        &vault.state,
        "Repeated title".into(),
        "Repeated title\n\nRepeated title\n".into(),
        None,
    )
    .unwrap()
    .unwrap()
    .note_id
    .unwrap();
    vault
        .state
        .lexical
        .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
        .unwrap();
    tauri::async_runtime::block_on(async {
        let found = find_in_note(&context, &id, "Repeated title").await;
        let items = found["items"].as_array().unwrap();
        assert_eq!(
            items.len(),
            1,
            "Only the unambiguous canonical title should be delivered: {found}"
        );
        assert_eq!(items[0]["location"], "title");
        assert_eq!(
            found["coverage"]["complete"], false,
            "Ambiguous body evidence must stay incomplete"
        );
        assert!(found["coverage"]["gaps"]
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g == "An indexed passage changed or was ambiguous"));
    });
}

#[test]
fn stale_body_matches_remain_withheld_after_canonical_text_changes() {
    let (vault, context, id) = fixture();
    vault
        .state
        .lexical
        .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
        .unwrap();
    tauri::async_runtime::block_on(async {
        let fresh = find_in_note(&context, &id, "first line").await;
        assert!(!fresh["items"].as_array().unwrap().is_empty());
        let (path, _, _) = context.resolve_note(&id).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        fs::write(path, raw.replace("first line", "new canonical wording")).unwrap();
        let stale = find_in_note(&context, &id, "first line").await;
        assert!(stale["items"].as_array().unwrap().is_empty());
        assert_eq!(stale["coverage"]["complete"], false);
        assert!(stale["coverage"]["gaps"]
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g == "An indexed passage changed or was ambiguous"));
    });
}

#[test]
fn hint_only_dialogue_survives_terminal_storage_recent_history_and_compaction() {
    let (_vault, mut context, id) = fixture();
    context.active_note = Some(ActiveNoteSnapshot {
        note_id: Some(id),
        title: "Tool note".into(),
        path: None,
        body: "stale body".into(),
        body_hash: "stale hash".into(),
        selection: Some("second line".into()),
    });
    let hint = context.active_note_context().unwrap();
    assert!(hint.contains("second line"));
    assert!(context.sources().is_empty());
    context.validate_context().unwrap();
    let reply = "We agreed to keep the table columns in French.";
    let (recent, compacted) =
        context
            .service
            .test_complete_and_model_context(&context.assistant_message_id, reply, &[]);
    assert!(
        recent.contains(reply),
        "Hint-only dialogue was omitted from recent history"
    );
    assert!(
        compacted.contains(reply),
        "Hint-only dialogue was omitted from compaction"
    );
}

#[test]
fn direct_note_evidence_stays_omitted_after_sources_are_excluded_before_completion() {
    let (_vault, context, id) = fixture();
    tauri::async_runtime::block_on(answer_read(&context, &id));
    assert!(!context.sources().is_empty());
    context
        .service
        .set_note_excluded(&id, "Tool note", true)
        .unwrap();
    assert!(context.sources().is_empty());
    let reply = "The canonical note said first line and second line.";
    let (recent, compacted) = context.service.test_complete_and_model_context(
        &context.assistant_message_id,
        reply,
        &context.sources(),
    );
    assert!(
        !recent.contains(reply),
        "Excluded read evidence returned through recent dialogue"
    );
    assert!(
        !compacted.contains(reply),
        "Excluded read evidence returned through compaction"
    );
}

#[test]
fn explicit_link_body_stays_omitted_after_its_source_is_removed_before_completion() {
    let (_vault, context, _) = fixture();
    assert!(context
        .explicit_wikilink_context("Explain [[Tool note]]")
        .unwrap()
        .contains("first line"));
    // Simulate terminal delivery without source cards; the durable evidence marker must remain.
    let reply = "The linked note includes first line.";
    let (recent, compacted) =
        context
            .service
            .test_complete_and_model_context(&context.assistant_message_id, reply, &[]);
    assert!(!recent.contains(reply));
    assert!(!compacted.contains(reply));
}

#[test]
fn conversational_note_identity_survives_body_changes_without_read_authority() {
    let (vault, context, id) = fixture();
    tauri::async_runtime::block_on(answer_read(&context, &id));
    let old_sources = context.sources();
    context
        .service
        .finish_message_for_history_test(&context.assistant_message_id, &old_sources);
    let (path, _, _) = context.resolve_note(&id).unwrap();
    crate::test_support::save_and_finalize(
        &vault.state,
        "Renamed operations".into(),
        "Recovery token: TOPAZ-642".into(),
        Some(path.to_string_lossy().into_owned()),
    )
    .unwrap()
    .unwrap();
    let next = AgentToolContext::with_host(
        context.host.clone(),
        context.service.clone(),
        "follow-up".into(),
        context.run_id.clone(),
        context.conversation_id.clone(),
        context.assistant_message_id.clone(),
        VaultAccess::Full,
        None,
        HashSet::new(),
        false,
        None,
    );
    let text = next
        .service
        .test_model_history_with_note_hints(&next.conversation_id, &next);
    assert!(
        text.contains("Renamed operations"),
        "Conversation lost its current note identity: {text}"
    );
    assert!(text.contains(&id));
    assert!(
        !text.contains("OBSOLETE_ANSWER_FACT")
            && !text.contains("first line")
            && !text.contains("TOPAZ-642")
    );
    assert!(next.sources().is_empty() && next.read_coverage.lock().unwrap().is_empty());
    next.validate_context().unwrap();
    next.service
        .set_note_excluded(&id, "Renamed operations", true)
        .unwrap();
    assert!(next.note_reference_hint(&id).is_none());
    assert!(
        next.validate_context().is_err(),
        "Later policy changes must revoke history hints"
    );
}

#[test]
fn conversational_note_hints_recheck_scope_identity_and_lifecycle() {
    let (vault, mut context, id) = fixture();
    context.access = VaultAccess::None;
    assert!(context.note_reference_hint(&id).is_none());
    Arc::make_mut(&mut context.run_grants).insert(id.clone());
    assert!(context.note_reference_hint(&id).is_some());
    let (path, _, _) = context.resolve_note(&id).unwrap();
    let raw = fs::read_to_string(&path).unwrap();
    fs::write(&path, raw.replace("first line", "a later body edit")).unwrap();
    context.validate_context().unwrap(); // Identity hints are not stale body evidence.
    fs::write(&path, raw.replace(&id, "foreign-note-identity")).unwrap();
    assert!(context.note_reference_hint(&id).is_none());
    assert!(context.validate_context().is_err());
    fs::write(&path, raw).unwrap();
    crate::commands::forgotten_note_commands::forget_note_with_state(
        &vault.state,
        Some(path.to_string_lossy().into_owned()),
        7,
    )
    .unwrap()
    .unwrap();
    assert!(context.note_reference_hint(&id).is_none());
    assert!(context.validate_context().is_err());
}

#[test]
fn compacted_note_references_are_current_metadata_and_revoke_after_exclusion() {
    let (vault, context, id) = fixture();
    tauri::async_runtime::block_on(answer_read(&context, &id));
    context
        .service
        .finish_message_for_history_test(&context.assistant_message_id, &context.sources());
    let (_, summary) = context.service.test_complete_and_model_context(
        &context.assistant_message_id,
        "OBSOLETE_ANSWER_FACT",
        &context.sources(),
    );
    let (path, _, _) = context.resolve_note(&id).unwrap();
    crate::test_support::save_and_finalize(
        &vault.state,
        "Moved production".into(),
        "new private body".into(),
        Some(path.to_string_lossy().into_owned()),
    )
    .unwrap()
    .unwrap();
    let text = context
        .service
        .test_model_history_with_note_hints(&context.conversation_id, &context);
    assert!(
        text.contains("Moved production")
            && text.contains(&id)
            && text.contains("answerOrdinal")
            && text.contains("Test tools")
    );
    assert!(
        !text.contains("OBSOLETE_ANSWER_FACT")
            && !text.contains("new private body")
            && !text.contains("first line")
    );
    assert!(
        !summary.contains("Moved production") && !summary.contains(&id),
        "Dynamic hints must not be frozen in persisted summaries"
    );
    context
        .service
        .set_note_excluded(&id, "Moved production", true)
        .unwrap();
    let text = context
        .service
        .test_model_history_with_note_hints(&context.conversation_id, &context);
    assert!(!text.contains("Moved production") && !text.contains(&id));
}

#[test]
fn conversational_note_hints_follow_moves_and_revoke_on_later_rename() {
    let (vault, context, id) = fixture();
    let (path, _, _) = context.resolve_note(&id).unwrap();
    let raw = fs::read_to_string(&path).unwrap();
    let moved = vault.notes.path().join("nested/Tool note.md");
    fs::create_dir_all(moved.parent().unwrap()).unwrap();
    fs::rename(&path, &moved).unwrap();
    vault
        .state
        .note_timeline()
        .observe(crate::services::note_timeline::VaultObservation::moved(
            &path, &moved, 42,
        ))
        .unwrap();
    // Mirror the catalog refresh after the real watcher lifecycle observation.
    vault.state.remove_note_indexes(&path).unwrap();
    vault
        .state
        .upsert_note_indexes(
            moved.clone(),
            crate::index::build_indexed_note(&moved, &raw, 42),
        )
        .unwrap();
    let hint = context.note_reference_hint(&id).unwrap();
    assert_eq!(hint["title"], "Tool note");
    assert_eq!(hint["noteId"], id);
    assert!(!hint.to_string().contains("nested"));
    context.validate_context().unwrap();
    crate::test_support::save_and_finalize(
        &vault.state,
        "Renamed after admission".into(),
        "first line".into(),
        Some(moved.to_string_lossy().into_owned()),
    )
    .unwrap()
    .unwrap();
    assert!(context.validate_context().is_err());
    assert_eq!(
        context.note_reference_hint(&id).unwrap()["title"],
        "Renamed after admission"
    );
}

#[test]
fn conversational_note_hints_obey_current_approved_grants() {
    let (_vault, mut context, id) = fixture();
    context.access = VaultAccess::Approved;
    assert!(context.note_reference_hint(&id).is_none());
    context.service.grant_note(&id, "Tool note").unwrap();
    assert!(context.note_reference_hint(&id).is_some());
    context.service.revoke_note(&id).unwrap();
    assert!(context.note_reference_hint(&id).is_none());
    assert!(context.validate_context().is_err());
}

#[test]
fn automatic_editor_identity_stays_outside_authored_dialogue() {
    let (vault, mut context, id) = fixture();
    tauri::async_runtime::block_on(answer_read(&context, &id));
    context
        .service
        .finish_message_for_history_test(&context.assistant_message_id, &context.sources());
    let draft = crate::test_support::save_and_finalize(
        &vault.state,
        "Editor draft".into(),
        "EDITOR_ONLY_BODY".into(),
        None,
    )
    .unwrap()
    .unwrap();
    context.active_note = Some(ActiveNoteSnapshot {
        note_id: draft.note_id.clone(),
        title: "Editor draft".into(),
        path: draft.path,
        body: "UNREAD_SNAPSHOT_BODY".into(),
        body_hash: String::new(),
        selection: None,
    });
    let text = context
        .service
        .test_model_history_with_note_hints(&context.conversation_id, &context);
    let history: Vec<Value> = serde_json::from_str(&text).unwrap();
    assert_eq!(history.first().unwrap()["role"], "system");
    assert!(history
        .first()
        .unwrap()
        .to_string()
        .contains(draft.note_id.as_ref().unwrap()));
    assert!(
        history.last().unwrap().to_string().contains("Test tools")
            && history
                .last()
                .unwrap()
                .to_string()
                .contains("mostRecentAnswer")
    );
    assert!(
        history.last().unwrap().to_string().contains(&id),
        "Conversation references must remain distinct from the editor hint"
    );
    for message in history
        .iter()
        .filter(|m| m["role"] == "user" || m["role"] == "assistant")
    {
        assert!(
            !message.to_string().contains("Editor draft") && !message.to_string().contains(&id)
        );
    }
    assert!(
        !text.contains("EDITOR_ONLY_BODY")
            && !text.contains("UNREAD_SNAPSHOT_BODY")
            && !text.contains("OBSOLETE_ANSWER_FACT")
    );
}

#[test]
fn rejected_note_references_do_not_bind_context_validation() {
    let (vault, context, rejected) = fixture();
    let saved = crate::test_support::save_and_finalize(
        &vault.state,
        "Admitted note".into(),
        "unread body".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let admitted = saved.note_id.unwrap();
    assert!(context.note_reference_hint(&rejected).is_some());
    assert!(context.note_reference_hint(&admitted).is_some());
    context
        .retain_note_references(&HashSet::from([admitted.clone()]))
        .unwrap();
    context
        .service
        .set_note_excluded(&rejected, "Tool note", true)
        .unwrap();
    context.validate_context().unwrap();
    context
        .service
        .set_note_excluded(&admitted, "Admitted note", true)
        .unwrap();
    assert!(context.validate_context().is_err());
}

#[test]
fn tool_free_requests_revalidate_note_hints_before_inference() {
    use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
    let (_vault, context, id) = fixture();
    let hint = context.note_reference_hint(&id).unwrap();
    let mut input = request();
    input.history = vec![rig_core::completion::Message::system(hint.to_string())];
    let make_model = || {
        MockCompletionModel::from_stream_turns([vec![
            MockStreamEvent::text("Hello"),
            MockStreamEvent::final_response(rig_core::completion::Usage::new()),
        ]])
    };
    let run = |model, input| {
        tauri::async_runtime::block_on(crate::agent_runtime::run_test_model(
            model,
            input,
            None,
            crate::agent_runtime::AgentRuntimeObserver {
                evidence_context: Some(context.clone()),
                cancelled: tokio_util::sync::CancellationToken::new(),
                permissions: None,
                on_event: Arc::new(|_| {}),
            },
            crate::agent_guardrails::AgentRunGuard::new(Default::default()),
        ))
    };
    let valid = make_model();
    run(valid.clone(), input.clone()).unwrap();
    assert_eq!(valid.request_count(), 1);
    assert!(valid.requests()[0].tools.is_empty());
    context
        .service
        .set_note_excluded(&id, "Tool note", true)
        .unwrap();
    let denied = make_model();
    assert!(run(denied.clone(), input).is_err());
    assert_eq!(
        denied.request_count(),
        0,
        "Forbidden hint reached inference"
    );
}
