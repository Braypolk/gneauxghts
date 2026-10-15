//! Real Rig stream → app delivery → source registry → SQLite terminal/reload.
use super::*;
use crate::agent_runtime::{AgentEvent, AgentProvider, AgentRuntimeObserver, AgentRuntimeRequest};
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
use serde_json::json;

fn request() -> AgentRuntimeRequest {
    AgentRuntimeRequest {
        provider: AgentProvider::Openai,
        model: "mock".into(),
        api_key: None,
        local_base_url: "http://localhost:1234/v1".into(),
        output_schema: Some(structured_answer::schema()),
        preamble: structured_answer::INSTRUCTIONS.into(),
        prompt: rig_core::completion::Message::user("Who approved?"),
        history: vec![],
        enable_web: false,
        require_web: false,
        flex: false,
        reasoning_effort: None,
    }
}
fn formatter(raw: &str) -> Vec<MockStreamEvent> {
    vec![
        MockStreamEvent::tool_call_name_delta("answer", "final_result"),
        MockStreamEvent::tool_call_arguments_delta("answer", raw),
        MockStreamEvent::tool_call_end("answer"),
        MockStreamEvent::final_response_with_default_usage(),
    ]
}
#[test]
fn structured_streaming_retries_replace_drafts_and_save_only_validated_markdown() {
    let (_vault, service) = tests::service("structured-stream-retry");
    let (conversation, message, run) = service.test_tool_run();
    let cancelled = CancellationToken::new();
    let delivery =
        answer_stream::AnswerStream::new(&service, &message, true, cancelled.clone()).unwrap();
    let capture = delivery.clone();
    let previews = Arc::new(Mutex::new(Vec::new()));
    let saved = previews.clone();
    let model = MockCompletionModel::from_stream_turns([
        formatter(r#"{"segments":[{"text":"Abandoned draft","sources":[]}],"incomplete":"#),
        formatter(r#"{"segments":[{"text":"**Final** answer","sources":[] }]}"#),
    ]);
    let result = tauri::async_runtime::block_on(crate::agent_runtime::run_test_model(
        model.clone(),
        request(),
        None,
        AgentRuntimeObserver {
            evidence_context: None,
            permissions: None,
            cancelled,
            on_event: Arc::new(move |event| {
                if let Some(answer_stream::AnswerUpdate::Draft { attempt, text }) =
                    capture.observe(&event)
                {
                    saved.lock().unwrap().push((attempt, text));
                }
            }),
        },
        crate::agent_guardrails::AgentRunGuard::new(Default::default()),
    ))
    .unwrap();
    assert_eq!(model.request_count(), 2);
    let previews = previews.lock().unwrap();
    assert!(previews.contains(&(1, "Abandoned draft".into())));
    assert!(previews.contains(&(2, String::new())));
    assert_eq!(previews.last().unwrap(), &(2, "**Final** answer".into()));
    assert!(delivery.partial().is_empty());
    assert!(service.get_conversation(&conversation).unwrap().messages[1]
        .content
        .is_empty());
    let (content, sources) =
        structured_answer::render(&result.output, &Default::default(), &[]).unwrap();
    service
        .persist_terminal_outcome(
            &message,
            &run,
            "complete",
            &content,
            None,
            &sources,
            &[],
            &(0, 0),
            &Default::default(),
            None,
        )
        .unwrap();
    let reloaded = service.get_conversation(&conversation).unwrap();
    assert_eq!(reloaded.messages[1].content, "**Final** answer");
    assert_eq!(reloaded.messages[1].status, "complete");
    assert!(!reloaded.messages[1].content.contains("segments"));
}

#[test]
fn structured_streaming_cancel_clears_draft_and_reload_has_no_provisional_content() {
    let (_vault, service) = tests::service("structured-stream-cancel");
    let (conversation, message, run) = service.test_tool_run();
    let cancelled = CancellationToken::new();
    let delivery =
        answer_stream::AnswerStream::new(&service, &message, true, cancelled.clone()).unwrap();
    let capture = delivery.clone();
    let cancel = cancelled.clone();
    let seen = Arc::new(Mutex::new(false));
    let saved = seen.clone();
    let result = tauri::async_runtime::block_on(crate::agent_runtime::run_test_model(
        MockCompletionModel::from_stream_turns([formatter(
            r#"{"segments":[{"text":"Unvalidated draft","sources":[] }]}"#,
        )]),
        request(),
        None,
        AgentRuntimeObserver {
            evidence_context: None,
            permissions: None,
            cancelled: cancelled.clone(),
            on_event: Arc::new(move |event| {
                if let Some(answer_stream::AnswerUpdate::Draft { text, .. }) =
                    capture.observe(&event)
                {
                    if !text.is_empty() {
                        *saved.lock().unwrap() = true;
                        cancel.cancel();
                    }
                }
            }),
        },
        crate::agent_guardrails::AgentRunGuard::new(Default::default()),
    ));
    assert!(*seen.lock().unwrap());
    assert!(
        result.is_err(),
        "Cancellation during formatter streaming must stop the run"
    );
    assert!(delivery
        .observe(&AgentEvent::ResultStream {
            attempt: 1,
            delta: Some("late".into())
        })
        .is_none());
    service
        .persist_terminal_outcome(
            &message,
            &run,
            "cancelled",
            &delivery.partial(),
            None,
            &[],
            &[],
            &(0, 0),
            &Default::default(),
            Some("userCancelled"),
        )
        .unwrap();
    let reopened = ChatService::new(
        service.notes_root().into(),
        service.inner.db_path.parent().unwrap().to_path_buf(),
    )
    .unwrap();
    let reloaded = reopened.get_conversation(&conversation).unwrap();
    assert!(reloaded.messages[1].content.is_empty());
    assert!(reloaded.messages[1].sources.is_empty());
    assert_eq!(reloaded.messages[1].status, "cancelled");
}

#[test]
fn structured_streaming_plain_local_fallback_still_checkpoints_text() {
    let (_vault, service) = tests::service("structured-stream-plain");
    let (conversation, message, _) = service.test_tool_run();
    let stream =
        answer_stream::AnswerStream::new(&service, &message, false, CancellationToken::new())
            .unwrap();
    stream.observe(&AgentEvent::TextDelta {
        delta: "Partial plain text".into(),
    });
    assert_eq!(
        service.get_conversation(&conversation).unwrap().messages[1].content,
        "Partial plain text"
    );
    assert!(stream
        .observe(&AgentEvent::ResultStream {
            attempt: 1,
            delta: Some("PRIVATE".into())
        })
        .is_none());
}

#[test]
fn structured_streaming_rejects_stale_and_excluded_sources_after_real_reads() {
    for exclusion in [false, true] {
        let (vault, tools, id, tool_service) = crate::agent_tools::AgentToolContext::test_fixture();
        // Exercise the registered read tool and the same formatter in one real agent run.
        let model = MockCompletionModel::from_stream_turns([
            vec![
                MockStreamEvent::tool_call(
                    "read",
                    "read_notes",
                    json!({"purpose":"answer","note_id":id}),
                ),
                MockStreamEvent::final_response_with_default_usage(),
            ],
            formatter(r#"{"segments":[{"text":"The note says first line.","sources":["S1"]}]}"#),
        ]);
        let arguments = Arc::new(Mutex::new(String::new()));
        let captured = arguments.clone();
        let result = tauri::async_runtime::block_on(crate::agent_runtime::run_test_model(
            model,
            request(),
            Some(tools.clone()),
            AgentRuntimeObserver {
                evidence_context: Some(tools.clone()),
                permissions: None,
                cancelled: CancellationToken::new(),
                on_event: Arc::new(move |event| {
                    if let AgentEvent::ResultStream {
                        delta: Some(json), ..
                    } = event
                    {
                        captured.lock().unwrap().push_str(&json);
                    }
                }),
            },
            crate::agent_guardrails::AgentRunGuard::new(Default::default()),
        ))
        .unwrap();
        let arguments = arguments.lock().unwrap();
        assert!(arguments.contains("segments"));
        assert!(
            !arguments.contains("note_id"),
            "Executable read arguments must not become draft data"
        );
        let (valid, sources, _) = tools.render_structured_answer(&result.output).unwrap();
        assert!(valid.contains("[Source 1](passage:"));
        assert_eq!(sources.len(), 1);
        if exclusion {
            tool_service
                .set_note_excluded(&id, "Tool note", true)
                .unwrap();
        } else {
            crate::commands::note_persistence::persist_note_session_with_outcome(
                &vault.state,
                "Tool note".into(),
                "Replacement text".into(),
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
        }
        assert!(tools.render_structured_answer(&result.output).is_err());
        let failure =
            ChatService::finalize_agent_response(&tools, result, true, &CancellationToken::new())
                .err()
                .unwrap();
        assert_eq!(failure.partial, Some(String::new()));
        assert!(failure.sources.is_empty());
    }
}

#[test]
fn structured_streaming_schema_violation_is_rejected_before_terminal_persistence() {
    let (_vault, tools, _id, service) = crate::agent_tools::AgentToolContext::test_fixture();
    let model = MockCompletionModel::from_stream_turns([formatter(
        r#"{"segments":[{"text":"Unvalidated","sources":[]}],"unexpected":true}"#,
    )]);
    let response = tauri::async_runtime::block_on(crate::agent_runtime::run_test_model(
        model.clone(),
        request(),
        None,
        AgentRuntimeObserver {
            evidence_context: None,
            permissions: None,
            cancelled: CancellationToken::new(),
            on_event: Arc::new(|_| {}),
        },
        crate::agent_guardrails::AgentRunGuard::new(Default::default()),
    ))
    .unwrap();
    assert_eq!(
        model.request_count(),
        1,
        "Rig accepts JSON independently of app validation"
    );
    let failure =
        ChatService::finalize_agent_response(&tools, response, true, &CancellationToken::new())
            .err()
            .unwrap();
    assert_eq!(failure.partial, Some(String::new()));
    assert!(failure.sources.is_empty());
    assert!(failure.error.contains("invalid structured answer"));
    let conversation = service.list_conversations().unwrap().remove(0);
    assert!(
        service.get_conversation(&conversation.id).unwrap().messages[1]
            .content
            .is_empty()
    );
}

#[test]
fn structured_streaming_failed_terminal_save_leaves_an_empty_retryable_message() {
    let (_root, service) = tests::service("structured-stream-storage-failure");
    let (conversation, message, run) = service.test_tool_run();
    let stream =
        answer_stream::AnswerStream::new(&service, &message, true, CancellationToken::new())
            .unwrap();
    stream.observe(&AgentEvent::ResultStream {
        attempt: 1,
        delta: None,
    });
    stream.observe(&AgentEvent::ResultStream {
        attempt: 1,
        delta: Some(r#"{"segments":[{"text":"Draft","sources":[]}]}"#.into()),
    });
    let sources = web_sources_from_text("https://example.com/evidence");
    service.connection().unwrap().execute_batch("CREATE TRIGGER reject_source BEFORE INSERT ON chat_sources BEGIN SELECT RAISE(FAIL, 'injected source failure'); END;").unwrap();
    assert!(service
        .persist_terminal_outcome(
            &message,
            &run,
            "complete",
            "Final",
            None,
            &sources,
            &[],
            &(0, 0),
            &Default::default(),
            None
        )
        .is_err());
    service
        .fail_terminal_outcome(&message, &run, "Could not save final answer")
        .unwrap();
    let stored = service.get_conversation(&conversation).unwrap();
    assert_eq!(stored.messages[1].status, "error");
    assert!(stored.messages[1].content.is_empty());
    assert!(stored.messages[1].sources.is_empty());
    assert!(!AgentEvent::ResultStream {
        attempt: 1,
        delta: Some("private formatter JSON".into())
    }
    .is_durable());
}
