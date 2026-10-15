use super::*;

async fn read(context: &AgentToolContext, args: Value) -> Value {
    ReadNotesTool(context.clone())
        .call(
            &mut ToolContext::new(),
            serde_json::from_value(args).unwrap(),
        )
        .await
        .unwrap()
}

async fn find(context: &AgentToolContext, id: &str, query: &str) -> Value {
    FindNotesTool(context.clone())
        .call(
            &mut ToolContext::new(),
            serde_json::from_value(json!({"mode":"literal","query":query,"note_ids":[id]}))
                .unwrap(),
        )
        .await
        .unwrap()
}

fn context_coverage(prompt: &str) -> Value {
    serde_json::from_str(
        prompt
            .lines()
            .find_map(|line| line.strip_prefix("coverage: "))
            .expect("Explicit context did not describe its read coverage"),
    )
    .unwrap()
}

#[test]
fn compact_discovery_references_resolve_without_granting_citation_authority() {
    let (_vault, context, id) = fixture();
    tauri::async_runtime::block_on(async {
        let found = find(&context, &id, "first line").await;
        let reference = found["items"][0]["evidenceId"].as_str().unwrap();
        assert!(
            reference.len() < 32,
            "Discovery should not require copying a full hash"
        );
        assert!(
            context.sources().is_empty(),
            "Discovery must remain uncitable"
        );
        let page = read(
            &context,
            json!({"purpose":"answer","evidence_ids":[reference]}),
        )
        .await;
        assert_eq!(page["items"][0]["evidenceId"], reference);
        let sources = context.sources();
        let passage = sources[0].passage.as_ref().unwrap();
        assert_eq!(
            passage.id.len(),
            64,
            "Durable identity must remain canonical"
        );
        assert_ne!(passage.id, reference);
        assert!(context
            .render_passage_references(page["items"][0]["citation"].as_str().unwrap())
            .unwrap()
            .contains(&passage.id));
        context.validate_context().unwrap();
    });
}

#[test]
fn duplicate_and_legacy_selectors_deliver_one_canonical_passage() {
    let (_vault, context, id) = fixture();
    tauri::async_runtime::block_on(async {
        let found = find(&context, &id, "first line").await;
        let reference = found["items"][0]["evidenceId"].as_str().unwrap();
        let canonical = context
            .resolve_evidence_ids(vec![reference.into()])
            .unwrap()
            .remove(0);
        let page = read(
            &context,
            json!({"purpose":"answer","evidence_ids":[reference,reference,canonical]}),
        )
        .await;
        assert_eq!(page["items"].as_array().unwrap().len(), 1);
        assert_eq!(context.sources().len(), 1);
        assert!(page["items"][0]["excerpt"]
            .as_str()
            .unwrap()
            .starts_with("first line"));
    });
}

#[test]
fn foreign_and_mistyped_references_do_not_read_or_consume_evidence() {
    let (_vault, context, id) = fixture();
    let service = ChatService::new(_vault.notes.path().into(), _vault.data.path().into()).unwrap();
    let (conversation, message, run) = service.test_tool_run();
    let other = AgentToolContext::with_host(
        ToolHost::Test(_vault.state.clone(), Arc::new(|_, _| {})),
        service,
        "later-run".into(),
        run,
        conversation,
        message,
        VaultAccess::Full,
        None,
        HashSet::new(),
        false,
        None,
    );
    tauri::async_runtime::block_on(async {
        let found = find(&context, &id, "first line").await;
        let other_found = find(&other, &id, "first line").await;
        let reference = found["items"][0]["evidenceId"].as_str().unwrap();
        for value in [reference.to_string(), format!("{reference}X")] {
            let error = ReadNotesTool(other.clone())
                .call(
                    &mut ToolContext::new(),
                    serde_json::from_value(json!({"purpose":"answer","evidence_ids":[value]}))
                        .unwrap(),
                )
                .await
                .unwrap_err();
            assert!(error.to_string().contains("Unknown evidence reference"));
        }
        assert!(other.sources().is_empty());
        let control = read(
            &context,
            json!({"purpose":"answer","evidence_ids":[reference]}),
        )
        .await;
        let recovered = read(
            &other,
            json!({"purpose":"answer","evidence_ids":[other_found["items"][0]["evidenceId"]]}),
        )
        .await;
        assert_eq!(
            recovered["remainingEvidenceBytes"],
            control["remainingEvidenceBytes"]
        );
    });
}

#[test]
fn compact_references_preserve_canonical_freshness_and_exclusions() {
    for exclude in [false, true] {
        let (vault, context, id) = fixture();
        tauri::async_runtime::block_on(async {
            let found = find(&context, &id, "first line").await;
            if exclude {
                context
                    .service
                    .set_note_excluded(&id, "Tool note", true)
                    .unwrap();
            } else {
                let path = vault
                    .state
                    .notes_index
                    .lock()
                    .unwrap()
                    .get_note_by_note_id(&id)
                    .unwrap()
                    .0
                    .to_string_lossy()
                    .into_owned();
                crate::test_support::save_and_finalize(
                    &vault.state,
                    "Tool note".into(),
                    "Changed canonical body".into(),
                    Some(path),
                )
                .unwrap();
            }
            let result = ReadNotesTool(context.clone()).call(&mut ToolContext::new(),serde_json::from_value(json!({"purpose":"answer","evidence_ids":[found["items"][0]["evidenceId"]]})).unwrap()).await;
            assert!(result.is_err());
            assert!(context.sources().is_empty());
        });
    }
}

#[test]
fn explicit_context_reports_its_scope_and_only_counts_delivered_body_text() {
    let (_vault, context, id) = fixture();
    let linked = context
        .explicit_wikilink_context("Explain [[Tool note]]")
        .unwrap();
    let coverage = context_coverage(&linked);
    assert_eq!(coverage["scope"], "body");
    assert_eq!(coverage["complete"], true);
    assert!(coverage["nextRead"].is_null());
    tauri::async_runtime::block_on(async {
        assert_eq!(
            find(&context, &id, "first line").await["items"][0]["alreadyRead"],
            "full"
        );
    });
    // A separate turn with an explicit small selection must not claim the whole body.
    drop(context);
    drop(_vault);
    let (_selected_vault, mut context, id) = fixture();
    Arc::make_mut(&mut context.run_grants).insert(id.clone());
    let selected = context
        .selected_context_prompt(&[crate::chat::ChatRunContextItem {
            note_id: id.clone(),
            note_path: "Tool note.md".into(),
            title: "Tool note".into(),
            section_label: None,
            excerpt: "first line".into(),
            content_hash: String::new(),
            reason: "selected text".into(),
            start_line: None,
            end_line: None,
            block_anchor: None,
        }])
        .unwrap();
    assert_eq!(context_coverage(&selected)["scope"], "selected_excerpt");
    assert_eq!(context_coverage(&selected)["complete"], true);
    tauri::async_runtime::block_on(async {
        assert_eq!(
            find(&context, &id, "first line").await["items"][0]["alreadyRead"],
            "partial"
        );
    });
}

#[test]
fn selected_excerpt_reads_only_its_exact_range_without_locking_the_note() {
    let (vault, mut context, _) = fixture();
    let excerpt = "Deployment approval was discussed.";
    let id = crate::test_support::save_and_finalize(
        &vault.state,
        "Meridian retrospective".into(),
        format!("{excerpt}\n\nJordan approved deployment."),
        None,
    )
    .unwrap()
    .unwrap()
    .note_id
    .unwrap();
    Arc::make_mut(&mut context.run_grants).insert(id.clone());
    let selected = context
        .selected_context_prompt(&[crate::chat::ChatRunContextItem {
            note_id: id.clone(),
            note_path: "Meridian retrospective.md".into(),
            title: "Meridian retrospective".into(),
            section_label: None,
            excerpt: excerpt.into(),
            content_hash: String::new(),
            reason: "selected excerpt".into(),
            start_line: Some(1),
            end_line: Some(1),
            block_anchor: None,
        }])
        .unwrap();
    let selector = context_coverage(&selected)["read"].clone();
    assert!(
        selector.is_object(),
        "The selected excerpt needs an exact answer-read selector"
    );
    assert!(context.answer_source_ids().unwrap().is_empty());
    tauri::async_runtime::block_on(async {
        let page = read(&context, selector).await;
        assert_eq!(page["items"].as_array().unwrap().len(), 1);
        assert_eq!(page["items"][0]["excerpt"], excerpt);
        assert_eq!(page["coverage"]["scope"], "selected_excerpt");
        assert_eq!(page["coverage"]["complete"], true);
        assert_eq!(page["coverage"]["wholeNoteComplete"], false);
        assert_eq!(page["coverage"]["nextReads"], json!([]));
        assert!(!page.to_string().contains("Jordan"));
        let source = context
            .sources()
            .into_iter()
            .find_map(|s| s.passage)
            .unwrap();
        assert_eq!((source.start, source.end), (0, excerpt.len()));
        assert_eq!(source.excerpt, excerpt);
        assert!(context
            .render_passage_references(page["items"][0]["citation"].as_str().unwrap())
            .unwrap()
            .contains(&source.id));
        context.validate_context().unwrap();
        let whole = read(&context, json!({"purpose":"answer","note_id":id})).await;
        assert!(whole["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["excerpt"].as_str().unwrap().contains("Jordan")));
        assert_eq!(whole["coverage"]["wholeNoteComplete"], true);
    });
}

fn selected_context_item(
    id: &str,
    excerpt: &str,
    start_line: Option<usize>,
) -> crate::chat::ChatRunContextItem {
    crate::chat::ChatRunContextItem {
        note_id: id.into(),
        note_path: "Tool note.md".into(),
        title: "Tool note".into(),
        section_label: None,
        excerpt: excerpt.into(),
        content_hash: String::new(),
        reason: "selected excerpt".into(),
        start_line,
        end_line: None,
        block_anchor: None,
    }
}

#[test]
fn selected_excerpt_retries_restore_legacy_blank_line_offsets_without_guessing() {
    let (vault, mut context, id) = fixture();
    crate::test_support::save_and_finalize(
        &vault.state,
        "Tool note".into(),
        "Prefix.\n\n\nSelected text\n\nSelected text".into(),
        Some(
            vault
                .notes
                .path()
                .join("Tool note.md")
                .to_string_lossy()
                .into_owned(),
        ),
    )
    .unwrap();
    Arc::make_mut(&mut context.run_grants).insert(id.clone());
    let mut selected = selected_context_item(&id, "Selected text", Some(2));
    selected.end_line = Some(4);
    let prompt = context
        .selected_context_prompt(&[selected.clone()])
        .unwrap();
    tauri::async_runtime::block_on(async {
        let page = read(&context, context_coverage(&prompt)["read"].clone()).await;
        assert_eq!(page["items"][0]["excerpt"], "Selected text");
        let passage = context
            .sources()
            .into_iter()
            .find_map(|s| s.passage)
            .unwrap();
        assert_eq!((passage.start, passage.end), (10, 23));
        context.validate_context().unwrap();
    });
    selected.end_line = Some(3);
    assert!(
        context.selected_context_prompt(&[selected]).is_err(),
        "Recovery must not cross the stored selected line range"
    );
}

#[test]
fn selected_excerpt_preserves_whitespace_only_pages_for_explicit_and_editor_selections() {
    for editor_hint in [false, true] {
        let (vault, mut context, id) = fixture();
        let excerpt = format!("A{}B", " ".repeat(4799));
        crate::test_support::save_and_finalize(
            &vault.state,
            "Tool note".into(),
            format!("Prefix.\n{excerpt}\nOUTSIDE"),
            Some(
                vault
                    .notes
                    .path()
                    .join("Tool note.md")
                    .to_string_lossy()
                    .into_owned(),
            ),
        )
        .unwrap();
        context.evidence.lock().unwrap().configure_allowance(None);
        let selector = if editor_hint {
            context.active_note = Some(ActiveNoteSnapshot {
                note_id: Some(id.clone()),
                title: "Tool note".into(),
                path: None,
                body: String::new(),
                body_hash: String::new(),
                selection: Some(excerpt.clone()),
            });
            let hint = context.active_note_context().unwrap();
            let hint: Value = serde_json::from_str(hint.split_once('\n').unwrap().1).unwrap();
            assert_eq!(hint["selectionComplete"], false);
            assert!(hint["selectionRead"].is_object());
            hint["selectionRead"].clone()
        } else {
            Arc::make_mut(&mut context.run_grants).insert(id.clone());
            let prompt = context
                .selected_context_prompt(&[selected_context_item(&id, &excerpt, Some(2))])
                .unwrap();
            context_coverage(&prompt)["read"].clone()
        };
        assert!(context.answer_source_ids().unwrap().is_empty());
        tauri::async_runtime::block_on(async {
            let mut selector = selector;
            let mut delivered = String::new();
            for _ in 0..8 {
                let page = read(&context, selector).await;
                assert_eq!(page["coverage"]["scope"], "selected_excerpt");
                assert_eq!(page["coverage"]["wholeNoteComplete"], false);
                for item in page["items"].as_array().unwrap() {
                    delivered.push_str(item["excerpt"].as_str().unwrap());
                }
                if let Some(cursor) = page["nextCursor"].as_str() {
                    selector = json!({"purpose":"answer","cursor":cursor});
                } else {
                    assert_eq!(page["coverage"]["complete"], true);
                    assert_eq!(delivered, excerpt);
                    for passage in context.sources().into_iter().filter_map(|s| s.passage) {
                        assert!(passage.start >= 8 && passage.end <= 4809);
                    }
                    context.validate_context().unwrap();
                    return;
                }
            }
            panic!("Selection did not finish within its expected pages");
        });
        assert!(
            context
                .selection_read(&id, &" ".repeat(2400), Some(9))
                .is_err(),
            "A wholly whitespace selection is still invalid"
        );
    }
}

#[test]
fn clipped_selected_excerpt_continues_inside_the_selection_in_utf8_coordinates() {
    let (vault, mut context, id) = fixture();
    let excerpt = format!("{}SELECTED END", "Café 茶. ".repeat(550));
    let saved = crate::test_support::save_and_finalize(
        &vault.state,
        "Tool note".into(),
        format!("Unselected prefix.\n\n{excerpt}\n\nOUTSIDE SECRET"),
        Some(
            vault
                .notes
                .path()
                .join("Tool note.md")
                .to_string_lossy()
                .into_owned(),
        ),
    )
    .unwrap()
    .unwrap();
    assert_eq!(saved.note_id.as_deref(), Some(id.as_str()));
    Arc::make_mut(&mut context.run_grants).insert(id.clone());
    context.evidence.lock().unwrap().configure_allowance(None);
    let prompt = context
        .selected_context_prompt(&[selected_context_item(&id, &excerpt, Some(3))])
        .unwrap();
    assert!(!prompt.contains("SELECTED END"));
    let coverage = context_coverage(&prompt);
    assert_eq!(coverage["complete"], false);
    assert_eq!(coverage["nextRead"], coverage["read"]);
    tauri::async_runtime::block_on(async {
        let mut selector = coverage["nextRead"].clone();
        let mut delivered = String::new();
        for _ in 0..12 {
            let page = read(&context, selector).await;
            assert_eq!(page["coverage"]["scope"], "selected_excerpt");
            assert_eq!(page["coverage"]["wholeNoteComplete"], false);
            for item in page["items"].as_array().unwrap() {
                delivered.push_str(item["excerpt"].as_str().unwrap());
            }
            if let Some(cursor) = page["nextCursor"].as_str() {
                selector = json!({"purpose":"answer","cursor":cursor});
                assert_eq!(page["coverage"]["nextReads"], json!([selector]));
            } else {
                assert_eq!(page["coverage"]["complete"], true);
                assert_eq!(page["coverage"]["nextReads"], json!([]));
                assert_eq!(delivered, excerpt);
                for source in context.sources().into_iter().filter_map(|s| s.passage) {
                    assert!(source.start >= "Unselected prefix.\n\n".len());
                    assert!(source.end <= "Unselected prefix.\n\n".len() + excerpt.len());
                }
                context.validate_context().unwrap();
                return;
            }
        }
        panic!("Selection did not finish within its expected pages");
    });
}

#[test]
fn selected_excerpt_line_range_disambiguates_repeated_text() {
    let (_vault, mut context, id) = fixture();
    Arc::make_mut(&mut context.run_grants).insert(id.clone());
    // Both occurrences have the same text, but only the second is selected.
    let (path, _, _) = context.resolve_note(&id).unwrap();
    let raw = fs::read_to_string(&path).unwrap();
    fs::write(
        &path,
        raw.replace(
            "first line\nsecond line",
            "same text\nother text\nsame text",
        ),
    )
    .unwrap();
    let prompt = context
        .selected_context_prompt(&[selected_context_item(&id, "same text", Some(3))])
        .unwrap();
    tauri::async_runtime::block_on(async {
        let page = read(&context, context_coverage(&prompt)["read"].clone()).await;
        assert_eq!(page["items"][0]["excerpt"], "same text");
        let source = context
            .sources()
            .into_iter()
            .find_map(|s| s.passage)
            .unwrap();
        assert_eq!(source.start, "same text\nother text\n".len());
    });
    assert!(context
        .selected_context_prompt(&[selected_context_item(&id, "same text", None)])
        .is_err());
    assert!(context
        .selected_context_prompt(&[selected_context_item(&id, "same text", Some(2))])
        .is_err());
    context.active_note = Some(ActiveNoteSnapshot {
        note_id: Some(id.clone()),
        title: "Tool note".into(),
        path: None,
        body: String::new(),
        body_hash: String::new(),
        selection: Some("same text".into()),
    });
    let hint = context.active_note_context().unwrap();
    let hint: Value = serde_json::from_str(hint.split_once('\n').unwrap().1).unwrap();
    assert_eq!(hint["selection"], "same text");
    assert!(
        hint["selectionRead"].is_null(),
        "Ambiguous text cannot select an arbitrary occurrence or prevent ordinary chat"
    );
    let raw = fs::read_to_string(&path).unwrap();
    fs::write(
        &path,
        raw.replace("same text\nother text\nsame text", "banana"),
    )
    .unwrap();
    context.active_note.as_mut().unwrap().selection = Some("ana".into());
    let hint = context.active_note_context().unwrap();
    let hint: Value = serde_json::from_str(hint.split_once('\n').unwrap().1).unwrap();
    assert!(
        hint["selectionRead"].is_null(),
        "Overlapping occurrences are ambiguous too"
    );
}

#[test]
fn clipped_adjacent_selection_retains_a_read_of_the_full_selection() {
    let (vault, mut context, _) = fixture();
    let excerpt = format!("{}SELECTED END", "Café 茶. ".repeat(80));
    let id = crate::test_support::save_and_finalize(
        &vault.state,
        "Long selection".into(),
        format!("{excerpt}\n\nOUTSIDE SECRET"),
        None,
    )
    .unwrap()
    .unwrap()
    .note_id
    .unwrap();
    context.active_note = Some(ActiveNoteSnapshot {
        note_id: Some(id),
        title: "Long selection".into(),
        path: None,
        body: String::new(),
        body_hash: String::new(),
        selection: Some(excerpt.clone()),
    });
    let hint = context.active_note_context().unwrap();
    let hint: Value = serde_json::from_str(hint.split_once('\n').unwrap().1).unwrap();
    assert_eq!(hint["selectionComplete"], false);
    assert!(!hint["selection"].as_str().unwrap().contains("SELECTED END"));
    assert!(context.sources().is_empty());
    tauri::async_runtime::block_on(async {
        let page = read(&context, hint["selectionRead"].clone()).await;
        assert_eq!(page["items"][0]["excerpt"], excerpt);
        assert!(!page.to_string().contains("OUTSIDE SECRET"));
    });
}

#[test]
fn adjacent_selection_read_is_exact_and_hint_registration_is_not_evidence() {
    let (_vault, mut context, id) = fixture();
    context.active_note = Some(ActiveNoteSnapshot {
        note_id: Some(id.clone()),
        title: "Tool note".into(),
        path: None,
        body: "untrusted editor copy".into(),
        body_hash: String::new(),
        selection: Some("second line".into()),
    });
    let hint = context.active_note_context().unwrap();
    let hint: Value = serde_json::from_str(hint.split_once('\n').unwrap().1).unwrap();
    assert!(context.sources().is_empty());
    assert!(context.answer_source_ids().unwrap().is_empty());
    tauri::async_runtime::block_on(async {
        let page = read(&context, hint["selectionRead"].clone()).await;
        assert_eq!(page["items"][0]["excerpt"], "second line");
        assert!(!page.to_string().contains("first line"));
        assert_eq!(page["coverage"]["wholeNoteComplete"], false);
    });
}

#[test]
fn selected_excerpt_reads_recheck_canonical_bytes_and_exclusions() {
    for excluded in [false, true] {
        let (_vault, mut context, id) = fixture();
        Arc::make_mut(&mut context.run_grants).insert(id.clone());
        let prompt = context
            .selected_context_prompt(&[selected_context_item(&id, "first line", Some(1))])
            .unwrap();
        if excluded {
            context
                .service
                .set_note_excluded(&id, "Tool note", true)
                .unwrap();
        } else {
            let (path, _, _) = context.resolve_note(&id).unwrap();
            let raw = fs::read_to_string(&path).unwrap();
            fs::write(path, raw.replace("first line", "changed line")).unwrap();
        }
        let result = tauri::async_runtime::block_on(ReadNotesTool(context.clone()).call(
            &mut ToolContext::new(),
            serde_json::from_value(context_coverage(&prompt)["read"].clone()).unwrap(),
        ));
        assert!(result.is_err());
        assert!(context.answer_source_ids().unwrap().is_empty());
        assert!(context.sources().iter().all(|s| s.passage.is_none()));
    }
}

#[test]
fn clipped_link_discloses_its_limit_and_continues_with_canonical_reads() {
    let (vault, context, _) = fixture();
    let body = format!(
        "prefix anchor{}boundary anchor{}TAIL ANSWER",
        "a".repeat(2300),
        "b".repeat(700)
    );
    let id =
        crate::test_support::save_and_finalize(&vault.state, "Clipped link".into(), body, None)
            .unwrap()
            .unwrap()
            .note_id
            .unwrap();
    let linked = context
        .explicit_wikilink_context("Explain [[Clipped link]]")
        .unwrap();
    assert!(!linked.contains("TAIL ANSWER"));
    let coverage = context_coverage(&linked);
    assert_eq!(coverage["scope"], "body");
    assert_eq!(coverage["complete"], false);
    assert_eq!(
        coverage["nextRead"],
        json!({"purpose":"answer","note_id":id})
    );
    tauri::async_runtime::block_on(async {
        assert_eq!(
            find(&context, &id, "prefix anchor").await["items"][0]["alreadyRead"],
            "full"
        );
        assert_eq!(
            find(&context, &id, "boundary anchor").await["items"][0]["alreadyRead"],
            "partial"
        );
        let tail = find(&context, &id, "TAIL ANSWER").await;
        assert_eq!(tail["items"][0]["alreadyRead"], "none");
        let mut args = coverage["nextRead"].clone();
        let mut saw_tail = false;
        for _ in 0..6 {
            let page = read(&context, args).await;
            saw_tail |= page["items"].as_array().unwrap().iter().any(|i| {
                i["excerpt"]
                    .as_str()
                    .is_some_and(|text| text.contains("TAIL ANSWER"))
            });
            if let Some(cursor) = page["nextCursor"].as_str() {
                args = json!({"purpose":"answer","cursor":cursor});
            } else {
                assert_eq!(page["coverage"]["complete"], true);
                assert!(saw_tail);
                context.validate_context().unwrap();
                return;
            }
        }
        panic!("Canonical continuation did not finish");
    });
}

#[test]
fn previews_do_not_count_as_reads_and_repeated_reads_keep_their_citations() {
    let (_vault, context, id) = fixture();
    tauri::async_runtime::block_on(async {
        for _ in 0..2 {
            let found = find(&context, &id, "first line").await;
            assert_eq!(found["items"][0]["alreadyRead"], "none");
        }
        // Working-copy reads are for proposals, not canonical answer evidence.
        read(&context, json!({"purpose":"edit","note_id":id})).await;
        let found = find(&context, &id, "first line").await;
        assert_eq!(found["items"][0]["alreadyRead"], "none");
        let args = json!({"purpose":"answer","evidence_ids":[found["items"][0]["evidenceId"]]});
        let first = read(&context, args.clone()).await;
        assert_eq!(first["items"][0]["alreadyRead"], "none");
        let discovered_again = find(&context, &id, "first line").await;
        assert_eq!(discovered_again["items"][0]["alreadyRead"], "full");
        let second = read(&context, args).await;
        assert_eq!(second["items"][0]["alreadyRead"], "full");
        assert_eq!(second["items"][0]["excerpt"], first["items"][0]["excerpt"]);
        assert_eq!(
            second["items"][0]["citation"],
            first["items"][0]["citation"]
        );
        assert!(context
            .render_passage_references(second["items"][0]["citation"].as_str().unwrap())
            .unwrap()
            .contains("](passage:"));
        let mut independent = context.evidence.lock().unwrap().fork();
        let child = independent
            .search(
                &context.host.state().unwrap(),
                None,
                &HashSet::new(),
                crate::services::evidence::SearchRequest {
                    query: "first line".into(),
                    mode: crate::services::evidence::SearchMode::Literal,
                    note_ids: Some(vec![id.clone()]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(child["items"][0]["alreadyRead"], "none");
    });
}

#[test]
fn overlap_reuse_is_range_based_and_does_not_survive_canonical_changes_or_exclusions() {
    let (vault, context, _) = fixture();
    let body = format!(
        "{}first anchor{}second anchor{}",
        "a".repeat(500),
        "b".repeat(400),
        "c".repeat(500)
    );
    let id = crate::test_support::save_and_finalize(&vault.state, "Overlap".into(), body, None)
        .unwrap()
        .unwrap()
        .note_id
        .unwrap();
    tauri::async_runtime::block_on(async {
        let first = find(&context, &id, "first anchor").await;
        read(
            &context,
            json!({"purpose":"answer","evidence_ids":[first["items"][0]["evidenceId"]]}),
        )
        .await;
        let second = find(&context, &id, "second anchor").await;
        assert_ne!(
            first["items"][0]["evidenceId"],
            second["items"][0]["evidenceId"]
        );
        assert_eq!(second["items"][0]["alreadyRead"], "partial");
        let args = json!({"purpose":"answer","evidence_ids":[second["items"][0]["evidenceId"]]});
        let delivered = read(&context, args.clone()).await;
        assert_eq!(delivered["items"][0]["alreadyRead"], "partial");
        assert_eq!(
            find(&context, &id, "second anchor").await["items"][0]["alreadyRead"],
            "full"
        );
        let union = FindNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(
                    json!({"mode":"regex","query":"first anchorb+second anchor","note_ids":[id]}),
                )
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            union["items"][0]["alreadyRead"], "full",
            "Coverage must union both previously delivered ranges"
        );
        let (path, _, _) = context.resolve_note(&id).unwrap();
        let raw = fs::read_to_string(&path)
            .unwrap()
            .replace("second anchor", "second anchor changed");
        fs::write(path, raw).unwrap();
        let changed = find(&context, &id, "second anchor").await;
        assert_eq!(changed["items"][0]["alreadyRead"], "none");
        assert!(ReadNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(args).unwrap()
            )
            .await
            .is_err());
        context
            .service
            .set_note_excluded(&id, "Overlap", true)
            .unwrap();
        assert!(find(&context, &id, "second anchor").await["items"]
            .as_array()
            .unwrap()
            .is_empty());
    });
}

#[test]
fn failed_admission_cannot_make_note_content_reusable() {
    let (_vault, mut context, id) = fixture();
    let run = context.run_id.clone();
    context.run_id = "missing-run".into();
    tauri::async_runtime::block_on(async {
        assert!(ReadNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(json!({"purpose":"answer","note_id":id})).unwrap()
            )
            .await
            .is_err());
    });
    assert!(context
        .explicit_wikilink_context("Explain [[Tool note]]")
        .is_err());
    context.run_id = run;
    tauri::async_runtime::block_on(async {
        assert_eq!(
            find(&context, &id, "first line").await["items"][0]["alreadyRead"],
            "none"
        );
    });
}

#[test]
fn answer_coverage_distinguishes_complete_note_from_selected_passages() {
    let (_vault, context, id) = fixture();
    tauri::async_runtime::block_on(async {
        let found = find(&context, &id, "first line").await;
        assert_eq!(found["coverage"]["kind"], "retrieval");
        assert_eq!(found["delivery"]["kind"], "previews");
        let selected = read(
            &context,
            json!({"purpose":"answer","evidence_ids":[found["items"][0]["evidenceId"]]}),
        )
        .await;
        assert_eq!(selected["coverage"]["scope"], "selected_passages");
        assert_eq!(selected["coverage"]["complete"], true);
        assert_eq!(selected["coverage"]["wholeNoteComplete"], false);
        assert_eq!(
            selected["coverage"]["nextReads"],
            json!([{"purpose":"answer","note_id":id}])
        );
        assert!(selected["coverage"]["noteId"].is_null());
        let whole = read(&context, json!({"purpose":"answer","note_id":id})).await;
        assert_eq!(whole["coverage"]["scope"], "canonical_note");
        assert_eq!(whole["coverage"]["noteId"], id);
        assert_eq!(whole["coverage"]["complete"], true);
        assert_eq!(whole["coverage"]["wholeNoteComplete"], true);
        assert!(whole["coverage"]["nextReads"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(whole["nextCursor"].is_null());
    });
}

#[test]
fn canonical_note_coverage_and_safe_continuation_survive_multiple_pages() {
    let (vault, context, _) = fixture();
    let body = format!(
        "{}\n\n{}\n\n{}",
        "a".repeat(2100),
        "b".repeat(2100),
        "c".repeat(2100)
    );
    let id =
        crate::test_support::save_and_finalize(&vault.state, "Long coverage".into(), body, None)
            .unwrap()
            .unwrap()
            .note_id
            .unwrap();
    let (path, _, _) = context.resolve_note(&id).unwrap();
    let expected = note::parse_note(&fs::read_to_string(path).unwrap())
        .body
        .to_string();
    tauri::async_runtime::block_on(async {
        let mut args = json!({"purpose":"answer","note_id":id});
        let mut delivered = String::new();
        let mut pages = 0;
        loop {
            let page = read(&context, args).await;
            pages += 1;
            assert!(pages < 8, "Read continuation did not finish");
            assert!(page.to_string().len() <= crate::services::evidence::READ_BYTES);
            assert_eq!(page["coverage"]["scope"], "canonical_note");
            assert_eq!(page["coverage"]["noteId"], id);
            for item in page["items"].as_array().unwrap() {
                if item["location"] == "body" {
                    delivered.push_str(item["excerpt"].as_str().unwrap());
                }
            }
            if let Some(cursor) = page["nextCursor"].as_str() {
                assert_eq!(page["coverage"]["complete"], false);
                assert_eq!(page["coverage"]["wholeNoteComplete"], false);
                assert_eq!(
                    page["coverage"]["nextReads"],
                    json!([{"purpose":"answer","cursor":cursor}])
                );
                args = json!({"purpose":"answer","cursor":cursor});
            } else {
                assert_eq!(page["coverage"]["complete"], true);
                assert_eq!(page["coverage"]["wholeNoteComplete"], true);
                break;
            }
        }
        assert!(pages > 1);
        assert_eq!(delivered, expected);
    });
}

#[test]
fn complete_named_note_coverage_keeps_cross_note_investigation_available() {
    let (vault, context, id) = fixture();
    let approval = crate::test_support::save_and_finalize(
        &vault.state,
        "Other approvals".into(),
        "Mateo approved deployment.".into(),
        None,
    )
    .unwrap()
    .unwrap()
    .note_id
    .unwrap();
    tauri::async_runtime::block_on(async {
        let named = read(&context, json!({"purpose":"answer","note_id":id})).await;
        assert_eq!(named["coverage"]["scope"], "canonical_note");
        assert_eq!(named["coverage"]["complete"], true);
        // Source-scope guidance must not become an application-enforced note lock.
        let found = FindNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(json!({"mode":"literal","query":"approved"})).unwrap(),
            )
            .await
            .unwrap();
        let item = found["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["noteId"] == approval)
            .expect("Broader discovery must still find another allowed note");
        let evidence = read(
            &context,
            json!({"purpose":"answer","evidence_ids":[item["evidenceId"]]}),
        )
        .await;
        assert!(evidence["items"].as_array().unwrap().iter().any(|item| {
            item["excerpt"]
                .as_str()
                .is_some_and(|s| s.contains("Mateo approved"))
                && item["citation"].as_str().is_some_and(|s| !s.is_empty())
        }));
        context.validate_context().unwrap();
    });
}
