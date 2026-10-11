use super::*;
mod context_regressions;
mod context_selection_audit;
mod coverage_regressions;
mod interface_contracts;
mod reliability_eval;

#[cfg(target_os = "macos")]
mod context_selection_live;
#[cfg(target_os = "macos")]
mod live_behavior;

#[test]
fn read_coverage_requires_contiguous_pages_from_the_current_content() {
    let mut coverage = ReadCoverage::default();
    coverage.record("hash-1", 1, 3, 8);
    coverage.record("hash-1", 6, 8, 8);
    assert!(!coverage.complete_for("hash-1"));

    coverage.record("hash-1", 4, 5, 8);
    assert!(coverage.complete_for("hash-1"));

    coverage.record("hash-2", 7, 8, 8);
    assert!(!coverage.complete_for("hash-1"));
    assert!(!coverage.complete_for("hash-2"));
}

pub(super) fn fixture() -> (crate::test_support::TestVault, AgentToolContext, String) {
    let vault = crate::test_support::TestVault::new("real-agent-tools");
    let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
        &vault.state,
        "Tool note".into(),
        "first line\nsecond line\nthird line\nfourth line".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let service = ChatService::new(vault.notes.path().into(), vault.data.path().into()).unwrap();
    let (conversation, message, run) = service.test_tool_run();
    let context = AgentToolContext::with_host(
        ToolHost::Test(vault.state.clone(), Arc::new(|_, _| {})),
        service,
        "tools-test".into(),
        run,
        conversation,
        message,
        VaultAccess::Full,
        None,
        HashSet::new(),
        false,
        None,
    );
    (vault, context, saved.note_id.unwrap())
}

pub(super) fn request() -> crate::agent_runtime::AgentRuntimeRequest {
    crate::agent_runtime::AgentRuntimeRequest {
        provider: crate::agent_runtime::AgentProvider::Openai,
        model: "mock".into(),
        api_key: None,
        local_base_url: "http://localhost:1234/v1".into(),
        output_schema: None,
        preamble: "Use the real tools.".into(),
        prompt: rig_core::completion::Message::user("Review my note"),
        history: vec![],
        enable_web: false,
        require_web: false,
        flex: false,
        reasoning_effort: None,
    }
}

#[test]
fn actual_rewrite_tool_requires_complete_current_read_and_rechecks_permissions() {
    let (_vault, context, id) = fixture();
    tauri::async_runtime::block_on(async {
        let mut call = ToolContext::new();
        let partial = ReadNoteTool(context.clone())
            .call(
                &mut call,
                ReadArgs {
                    note_id: id.clone(),
                    start_line: Some(1),
                    max_chars: Some(20),
                },
            )
            .await
            .unwrap();
        assert_eq!(partial["hasMore"], true);
        let rewrite = |hash: &str| RewriteArgs {
            note_id: id.clone(),
            expected_content_hash: hash.into(),
            markdown: "Replacement note".into(),
        };
        let rejected = ProposeNoteRewriteTool(context.clone())
            .call(&mut call, rewrite(partial["contentHash"].as_str().unwrap()))
            .await
            .unwrap();
        assert_eq!(rejected["code"], "note_not_fully_read");
        let full = ReadNoteTool(context.clone())
            .call(
                &mut call,
                ReadArgs {
                    note_id: id.clone(),
                    start_line: None,
                    max_chars: Some(6000),
                },
            )
            .await
            .unwrap();
        assert_eq!(full["hasMore"], false);
        context
            .service
            .set_note_excluded(&id, "Tool note", true)
            .unwrap();
        assert_ne!(
            ProposeNoteRewriteTool(context.clone())
                .call(&mut call, rewrite(full["contentHash"].as_str().unwrap()))
                .await
                .unwrap()["status"],
            "pending_review"
        );
        context
            .service
            .set_note_excluded(&id, "Tool note", false)
            .unwrap();
        let accepted = ProposeNoteRewriteTool(context.clone())
            .call(&mut call, rewrite(full["contentHash"].as_str().unwrap()))
            .await
            .unwrap();
        assert_eq!(accepted["status"], "pending_review");
        let working = ReadNoteTool(context.clone())
            .call(
                &mut call,
                ReadArgs {
                    note_id: id.clone(),
                    start_line: None,
                    max_chars: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(working["pendingChanges"], true);
        assert_ne!(working["contentHash"], full["contentHash"]);
    });
}

#[test]
fn production_streaming_runner_dispatches_actual_working_read_and_proposal_tools() {
    use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
    let (vault, context, id) = fixture();
    let path = vault
        .state
        .notes_index
        .lock()
        .unwrap()
        .get_note_by_note_id(&id)
        .unwrap()
        .0
        .clone();
    let hash = content_hash(&fs::read_to_string(path).unwrap());
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call(
                "read",
                "read_notes",
                json!({"purpose":"edit","note_id":id}),
            ),
            MockStreamEvent::final_response(rig_core::completion::Usage::new()),
        ],
        vec![
            MockStreamEvent::tool_call(
                "rewrite",
                "propose_note_change",
                json!({"operation":"replace","note_id":id,"expected_content_hash":hash,"markdown":"Reviewed replacement"}),
            ),
            MockStreamEvent::final_response(rig_core::completion::Usage::new()),
        ],
        vec![
            MockStreamEvent::text("Review is ready."),
            MockStreamEvent::final_response(rig_core::completion::Usage::new()),
        ],
    ]);
    let response = tauri::async_runtime::block_on(crate::agent_runtime::run_test_model(
        model.clone(),
        request(),
        Some(context.clone()),
        crate::agent_runtime::AgentRuntimeObserver {
            evidence_context: None,
            cancelled: tokio_util::sync::CancellationToken::new(),
            on_event: Arc::new(|_| {}),
            permissions: None,
        },
        crate::agent_guardrails::AgentRunGuard::new(Default::default()),
    ))
    .unwrap();
    assert_eq!(response.output, "Review is ready.");
    assert_eq!(model.request_count(), 3);
    let proposal = context
        .service
        .pending_agent_proposal_for_note(&id)
        .unwrap()
        .expect("actual rewrite tool persisted a pending proposal");
    let requests = model.requests();
    let history = serde_json::to_value(&requests.last().unwrap().chat_history)
        .unwrap()
        .to_string();
    assert!(
        history.contains(&id),
        "read result reaches subsequent model turns"
    );
    assert!(
        history.contains(&proposal.id),
        "proposal result reaches final model turn"
    );
}

#[test]
fn working_read_yields_the_current_thread_executor_while_its_index_is_locked() {
    let (vault, mut context, id) = fixture();
    let (arrived, arrival) = tokio::sync::oneshot::channel();
    let arrived = Mutex::new(Some(arrived));
    context.host = ToolHost::Test(
        vault.state.clone(),
        Arc::new(move |name, _| {
            if name == "chat://activity" {
                if let Some(signal) = arrived.lock().unwrap().take() {
                    let _ = signal.send(());
                }
            }
        }),
    );
    std::thread::scope(|scope| {
        let (held, has_lock) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel();
        let state = vault.state.clone();
        let holder = scope.spawn(move || {
            let _lock = state.notes_index.lock().unwrap();
            held.send(()).unwrap();
            // Watchdog only: a regression that blocks the executor must fail
            // without leaving an unjoinable thread during panic unwinding.
            released
                .recv_timeout(std::time::Duration::from_secs(5))
                .is_ok()
        });
        has_lock
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let read = async {
                    ReadNoteTool(context)
                        .call(
                            &mut ToolContext::new(),
                            ReadArgs {
                                note_id: id,
                                start_line: None,
                                max_chars: None,
                            },
                        )
                        .await
                        .unwrap()
                };
                let unrelated_task = async {
                    arrival.await.unwrap();
                    release.send(()).unwrap();
                };
                let (result, ()) = tokio::join!(read, unrelated_task);
                assert_eq!(result["status"], "ready");
            });
        assert!(
            holder.join().unwrap(),
            "blocking tool prevented unrelated executor work"
        );
    });
}

/// Offline audit of the real assembled request, including registered tool schemas.
#[test]
fn assistant_request_instruction_audit() {
    let (_vault, mut context, id) = fixture();
    context.active_note = Some(ActiveNoteSnapshot {
        note_id: Some(id),
        title: "Tool note".into(),
        path: None,
        body: String::new(),
        body_hash: String::new(),
        selection: None,
    });
    let mut request = request();
    request.preamble = crate::chat::agent_preamble(&request.provider, true);
    request.prompt = rig_core::completion::Message::user(format!(
        "Hello\nQuery reference instant and timezone: {}\n{}",
        context.query_anchor_label(),
        context.active_note_context().unwrap()
    ));
    let events = Arc::new(Mutex::new(Vec::new()));
    let capture = events.clone();
    let model = rig_core::test_utils::MockCompletionModel::from_stream_turns([vec![
        rig_core::test_utils::MockStreamEvent::text("Hello"),
        rig_core::test_utils::MockStreamEvent::final_response(rig_core::completion::Usage::new()),
    ]]);
    tauri::async_runtime::block_on(crate::agent_runtime::measure_test_model(
        model.clone(),
        request,
        Some(context),
        crate::agent_runtime::AgentRuntimeObserver {
            evidence_context: None,
            cancelled: tokio_util::sync::CancellationToken::new(),
            on_event: Arc::new(move |event| {
                if let AgentEvent::ContextMeasured { details } = event {
                    capture.lock().unwrap().push(details);
                }
            }),
            permissions: None,
        },
    ))
    .unwrap();
    let events = events.lock().unwrap();
    let measurement = &events[0];
    assert_eq!(measurement["executableToolCount"], 5);
    assert!(measurement["componentBytes"]["tools"].as_u64().unwrap() > 4000);
    println!("INSTRUCTION_AUDIT {}", measurement);
    if let Ok(path) = std::env::var("GNEAUX_INSTRUCTION_AUDIT_OUTPUT") {
        std::fs::write(path, serde_json::to_string_pretty(measurement).unwrap()).unwrap();
    }
    if let Ok(path) = std::env::var("GNEAUX_TOOL_AUDIT_OUTPUT") {
        let requests = model.requests();
        std::fs::write(
            path,
            serde_json::to_string_pretty(&requests[0].tools).unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn adjacent_editor_hint_uses_allowed_canonical_context_without_read_or_source_authority() {
    let (_vault, mut context, id) = fixture();
    context.active_note = Some(ActiveNoteSnapshot {
        note_id: Some(id.clone()),
        title: "STALE_TITLE".into(),
        path: None,
        body: "PRIVATE_STALE_BODY".into(),
        body_hash: "stale".into(),
        selection: Some("second line".into()),
    });
    let hint = context.active_note_context().unwrap();
    assert!(hint.contains("Tool note"));
    assert!(hint.contains("second line"));
    assert!(!hint.contains("first line"));
    assert!(!hint.contains("PRIVATE_STALE_BODY"));
    assert!(!hint.contains("STALE_TITLE"));
    assert!(
        context.sources().is_empty(),
        "A relevance hint is not read evidence"
    );
    assert!(
        context.read_coverage.lock().unwrap().is_empty(),
        "A hint cannot authorize a rewrite"
    );
    assert!(context.context_versions.lock().unwrap().contains_key(&id));
    context.validate_context().unwrap();
    context.active_note.as_mut().unwrap().selection = Some("stale selection".into());
    assert!(!context
        .active_note_context()
        .unwrap()
        .contains("stale selection"));
    context
        .service
        .set_note_excluded(&id, "Tool note", true)
        .unwrap();
    assert!(context.active_note_context().unwrap().is_empty());
    assert!(
        context.validate_context().is_err(),
        "Later exclusions revoke admitted context"
    );
}

#[test]
fn adjacent_editor_hint_stops_when_canonical_content_changes() {
    let (_vault, mut context, id) = fixture();
    context.active_note = Some(ActiveNoteSnapshot {
        note_id: Some(id.clone()),
        title: String::new(),
        path: None,
        body: String::new(),
        body_hash: String::new(),
        selection: None,
    });
    context.active_note_context().unwrap();
    let (path, _, _) = context.resolve_note(&id).unwrap();
    std::fs::write(path, "changed canonical content").unwrap();
    assert!(context.validate_context().is_err());
}

#[test]
fn streaming_evidence_reads_retain_interpretation_without_repeating_guidance() {
    use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
    let (_vault, context, id) = fixture();
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call(
                "read-1",
                "read_notes",
                json!({"purpose":"answer","note_id":id}),
            ),
            MockStreamEvent::final_response(rig_core::completion::Usage::new()),
        ],
        vec![
            MockStreamEvent::tool_call(
                "read-2",
                "read_notes",
                json!({"purpose":"answer","note_id":id}),
            ),
            MockStreamEvent::final_response(rig_core::completion::Usage::new()),
        ],
        vec![
            MockStreamEvent::text("Read complete"),
            MockStreamEvent::final_response(rig_core::completion::Usage::new()),
        ],
    ]);
    let mut input = request();
    input.preamble = crate::chat::agent_preamble(&input.provider, true);
    input.prompt = rig_core::completion::Message::user(format!(
        "Read this known note: {id}\n{}",
        context.query_anchor_label()
    ));
    let events = Arc::new(Mutex::new(Vec::new()));
    let capture = events.clone();
    tauri::async_runtime::block_on(crate::agent_runtime::measure_test_model(
        model.clone(),
        input,
        Some(context),
        crate::agent_runtime::AgentRuntimeObserver {
            evidence_context: None,
            cancelled: tokio_util::sync::CancellationToken::new(),
            permissions: None,
            on_event: Arc::new(move |event| {
                if let AgentEvent::ContextMeasured { details } = event {
                    capture.lock().unwrap().push(details);
                }
            }),
        },
    ))
    .unwrap();
    let requests = model.requests();
    assert_eq!(requests.len(), 3);
    let final_request = serde_json::to_string(requests.last().unwrap()).unwrap();
    assert_eq!(
        final_request.matches("interpretationGuidance").count(),
        1,
        "The first contract remains in history; a repeated read must not duplicate it"
    );
    assert!(final_request.contains("Evaluate each action"));
    assert!(
        final_request.contains("[S1]"),
        "Read citations reach the model alongside their interpretation contract"
    );
    if let Ok(path) = std::env::var("GNEAUX_EVIDENCE_AUDIT_OUTPUT") {
        let events = events.lock().unwrap();
        let requests: Vec<_> = events
            .iter()
            .filter(|event| event["phase"] == "request")
            .collect();
        std::fs::write(path, serde_json::to_string_pretty(&requests).unwrap()).unwrap();
    }
}
