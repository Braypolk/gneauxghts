use super::*;
use crate::agent_tools::interface::{NoteChangeArgs, ReadNotesArgs};

async fn read(context: &AgentToolContext, args: Value) -> Value {
    ReadNotesTool(context.clone())
        .call(
            &mut ToolContext::new(),
            serde_json::from_value::<ReadNotesArgs>(args).unwrap(),
        )
        .await
        .unwrap()
}
async fn change(context: &AgentToolContext, args: Value) -> Value {
    ProposeNoteChangeTool(context.clone())
        .call(
            &mut ToolContext::new(),
            serde_json::from_value::<NoteChangeArgs>(args).unwrap(),
        )
        .await
        .unwrap()
}

#[test]
fn proposal_commit_repairs_retained_identity_but_preserves_later_external_changes() {
    for change_after_review in [false, true] {
        let (vault, context, id) = fixture();
        let (path, _, _) = context.resolve_note(&id).unwrap();
        let damaged = "Current content without managed metadata";
        fs::write(&path, damaged).unwrap();
        let now = crate::time::current_time_millis().unwrap();
        vault
            .state
            .note_timeline()
            .observe(
                crate::services::note_timeline::VaultObservation::external_edit(
                    path.clone(),
                    now,
                    Some(now),
                ),
            )
            .unwrap();
        vault
            .state
            .upsert_note_indexes(
                path.clone(),
                crate::index::build_indexed_note(&path, damaged, now),
            )
            .unwrap();
        assert_eq!(
            vault.state.indexed_note_identity(&path).unwrap().as_deref(),
            Some(id.as_str())
        );

        let current = tauri::async_runtime::block_on(read(
            &context,
            json!({
                "purpose":"edit", "note_id":id,
            }),
        ));
        let proposal = tauri::async_runtime::block_on(change(
            &context,
            json!({
                "operation":"replace", "note_id":id,
                "expected_content_hash":current["contentHash"], "markdown":"Reviewed replacement",
            }),
        ));
        assert_eq!(proposal["status"], "pending_review");
        if change_after_review {
            fs::write(&path, "Later external change").unwrap();
        }
        let result = crate::commands::proposal_commands::commit_agent_proposal_with_state(
            &vault.state,
            &context.service,
            proposal["proposalId"].as_str().unwrap().into(),
            None,
        )
        .unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        if change_after_review {
            assert_eq!(result.status, "conflict");
            assert_eq!(raw, "Later external change");
        } else {
            assert_eq!(result.status, "committed");
            assert_eq!(result.note_id.as_deref(), Some(id.as_str()));
            assert_eq!(
                result.committed_markdown.as_deref(),
                Some("Reviewed replacement")
            );
            assert_eq!(
                crate::note::parse_note(&raw)
                    .frontmatter
                    .managed
                    .unwrap()
                    .id,
                id
            );
        }
    }
}

fn registry(context: AgentToolContext) -> Vec<rig_core::completion::ToolDefinition> {
    use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
    let model = MockCompletionModel::from_stream_turns([vec![
        MockStreamEvent::text("done"),
        MockStreamEvent::final_response(rig_core::completion::Usage::new()),
    ]]);
    tauri::async_runtime::block_on(crate::agent_runtime::measure_test_model(
        model.clone(),
        request(),
        Some(context),
        crate::agent_runtime::AgentRuntimeObserver {
            evidence_context: None,
            cancelled: tokio_util::sync::CancellationToken::new(),
            permissions: None,
            on_event: Arc::new(|_| {}),
        },
    ))
    .unwrap();
    model.requests()[0].tools.clone()
}

#[test]
fn structured_answer_keeps_valid_output_when_the_model_selects_an_unissued_source() {
    use rig_core::{
        completion::Usage,
        test_utils::{MockCompletionModel, MockStreamEvent},
    };
    for revoke in [false, true] {
        let (_vault, context, id) = fixture();
        let output = json!({"segments":[
            {"text":"Confirmed first line","sources":["S1"]},
            {"text":"Unverified selection","sources":["S999"]},
            {"text":"Conversation-only closing text","sources":[]}
        ]});
        let model = MockCompletionModel::from_stream_turns([
            vec![
                MockStreamEvent::tool_call(
                    "read",
                    "read_notes",
                    json!({"purpose":"answer","note_id":id}),
                ),
                MockStreamEvent::final_response(Usage::new()),
            ],
            vec![
                MockStreamEvent::tool_call("answer", "final_result", output),
                MockStreamEvent::final_response(Usage::new()),
            ],
        ]);
        let mut input = request();
        input.output_schema = Some(crate::chat::ChatService::test_structured_answer_contract().0);
        let events = Arc::new(Mutex::new(Vec::new()));
        let capture = events.clone();
        let response = tauri::async_runtime::block_on(crate::agent_runtime::measure_test_model(
            model.clone(),
            input,
            Some(context.clone()),
            crate::agent_runtime::AgentRuntimeObserver {
                evidence_context: Some(context.clone()),
                cancelled: tokio_util::sync::CancellationToken::new(),
                permissions: None,
                on_event: Arc::new(move |event| capture.lock().unwrap().push(event)),
            },
        ))
        .unwrap();
        assert_eq!(model.request_count(), 2);
        let requests = model.requests();
        let selections = |index: usize| {
            requests[index].tools.last().unwrap().parameters["properties"]["segments"]["items"]
                ["properties"]["sources"]
                .clone()
        };
        assert_eq!(
            selections(0)["maxItems"],
            0,
            "No citations before actual reads"
        );
        assert_eq!(
            selections(1)["items"]["enum"],
            json!(context.answer_source_ids().unwrap())
        );
        assert!(!selections(1)["items"]["enum"]
            .as_array()
            .unwrap()
            .contains(&json!("S999")));
        assert!(
            events
                .lock()
                .unwrap()
                .iter()
                .any(|event| matches!(event, AgentEvent::ResultStream { delta: Some(_), .. })),
            "Dynamic source constraints must not suppress formatter drafts"
        );
        if revoke {
            context
                .service
                .set_note_excluded(&id, "Tool note", true)
                .unwrap();
        }
        let result = context.service.test_store_structured_answer(
            &context,
            &context.assistant_message_id,
            &context.run_id,
            response.output,
        );
        let saved = context
            .service
            .get_conversation(&context.conversation_id)
            .unwrap();
        let answer = saved
            .messages
            .iter()
            .find(|m| m.id == context.assistant_message_id)
            .unwrap();
        if revoke {
            assert!(
                result.is_err(),
                "Revoked real sources must still block delivery"
            );
            assert!(answer.content.is_empty());
            assert!(answer.sources.is_empty());
        } else {
            result.unwrap();
            assert!(answer
                .content
                .contains("Confirmed first line [Source 1](passage:"));
            assert!(answer
                .content
                .contains("Unverified selection [citation unavailable]"));
            assert!(answer.content.ends_with("Conversation-only closing text"));
            assert_eq!(answer.sources.len(), 1);
            assert_eq!(answer.sources[0].note_id.as_deref(), Some(id.as_str()));
        }
    }
}

#[test]
fn source_changed_during_compaction_stops_before_the_next_model_dispatch() {
    use rig_core::{completion::Message, test_utils::MockCompletionModel};
    let (_vault, context, id) = fixture();
    let (path, _, _) = context.resolve_note(&id).unwrap();
    tauri::async_runtime::block_on(read(&context, json!({"purpose":"answer","note_id":id})));
    let mut input = request();
    input.provider = crate::agent_runtime::AgentProvider::Openai;
    input.history = vec![
        Message::assistant("Earlier run history ".repeat(6000)),
        Message::user("Continue"),
        Message::assistant("Latest work"),
        Message::user("Latest result"),
    ];
    let model = MockCompletionModel::text(r#"{"summary":"Earlier progress. Keep researching."}"#);
    let changed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let capture = changed.clone();
    let result = tauri::async_runtime::block_on(crate::agent_runtime::measure_test_model(
        model.clone(),
        input,
        Some(context),
        crate::agent_runtime::AgentRuntimeObserver {
            evidence_context: None,
            cancelled: tokio_util::sync::CancellationToken::new(),
            permissions: None,
            on_event: Arc::new(move |event| {
                if matches!(event, crate::agent_runtime::AgentEvent::ContextMeasured { details } if details["mode"] == "compaction" && details["phase"] == "completed")
                {
                    fs::write(&path, "Source changed during summary inference").unwrap();
                    capture.store(true, std::sync::atomic::Ordering::Relaxed);
                }
            }),
        },
    ));
    assert!(changed.load(std::sync::atomic::Ordering::Relaxed));
    let error = result.unwrap_err();
    assert!(error.contains("changed"), "{error}");
    assert_eq!(model.request_count(), 1, "Only summary inference may run");
}

#[test]
fn loaded_model_capacity_does_not_limit_cumulative_evidence_with_compaction() {
    use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    // The real runtime probes loaded capacity, then configures the same evidence
    // session used by tools. No separate guessed model-name capacity table.
    for (capacity, expected) in [
        (Some(129_280u64), 200_000),
        (Some(32_768), 200_000),
        (None, 200_000),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
                assert!(request.len() < 8192);
            }
            assert!(String::from_utf8(request)
                .unwrap()
                .starts_with("GET /api/v1/models "));
            let instances: Vec<_> = capacity
                .into_iter()
                .map(|n| json!({"id":"mock","config":{"context_length":n}}))
                .collect();
            let body = json!({"models":[{"key":"mock","loaded_instances":instances}]}).to_string();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let (_vault, context, _) = fixture();
        let mut input = request();
        input.provider = crate::agent_runtime::AgentProvider::Local;
        input.local_base_url = base;
        let model = MockCompletionModel::from_stream_turns([vec![
            MockStreamEvent::text("done"),
            MockStreamEvent::final_response(rig_core::completion::Usage::new()),
        ]]);
        tauri::async_runtime::block_on(crate::agent_runtime::measure_test_model(
            model,
            input,
            Some(context.clone()),
            crate::agent_runtime::AgentRuntimeObserver {
                evidence_context: None,
                cancelled: tokio_util::sync::CancellationToken::new(),
                permissions: None,
                on_event: Arc::new(|_| {}),
            },
        ))
        .unwrap();
        server.join().unwrap();
        let mut evidence = context.evidence.lock().unwrap();
        assert_eq!(
            evidence
                .admit_context(&"x".repeat(200_000), 200_000)
                .unwrap()
                .len(),
            expected
        );
        assert_eq!(evidence.admit_context("more", 4).unwrap(), "more");
    }
}

fn compatible_followup_fixture() -> (
    crate::test_support::TestVault,
    AgentToolContext,
    crate::agent_runtime::AgentRuntimeRequest,
) {
    let (vault, mut context, id) = fixture();
    tauri::async_runtime::block_on(read(&context, json!({"purpose":"edit","note_id":id})));
    context.service.test_store_structured_edit_answer(
        &context,
        &context.assistant_message_id,
        &context.run_id,
    );
    context
        .service
        .test_compact_saved_conversation(&context.conversation_id);
    context.active_note = Some(ActiveNoteSnapshot {
        note_id: Some(id.clone()),
        title: "Synthetic active note".into(),
        path: None,
        body: String::new(),
        body_hash: String::new(),
        selection: None,
    });
    let history = context
        .service
        .test_model_history_with_note_hints(&context.conversation_id, &context);
    let mut input = request();
    input.provider = crate::agent_runtime::AgentProvider::Local;
    input.history = serde_json::from_str(&history).unwrap();
    input.output_schema = Some(
        json!({"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false}),
    );
    input.preamble =
        "Follow the current user request. Earlier conversation context is background only.".into();
    input.prompt = rig_core::completion::Message::user(format!(
        "Call read_notes with purpose=edit and note_id={id}, then call final_result with {{\"value\":\"Tuesday\"}}. Do not use other tools."
    ));
    (vault, context, input)
}

#[test]
fn compatible_chat_followup_keeps_all_context_in_one_opening_system_message() {
    use rig_core::{
        completion::Message,
        providers::openai,
        test_utils::{MockCompletionModel, MockStreamEvent, RecordingHttpClient},
    };
    let (_vault, context, input) = compatible_followup_fixture();
    let original_system: Vec<_> = input
        .history
        .iter()
        .filter_map(|m| match m {
            Message::System { content } => Some(content.clone()),
            _ => None,
        })
        .collect();
    assert!(
        original_system.len() >= 3,
        "Exercise active note, compaction and fresh references"
    );
    // Rig coalesces consecutive user messages into one multi-part turn. Compare
    // ordered content parts so that canonical grouping does not hide content loss.
    let dialogue_parts = |history: &[Message]| {
        history
            .iter()
            .flat_map(|message| match message {
                Message::System { .. } => Vec::new(),
                Message::User { content } => {
                    content.iter().map(|part| json!({"user":part})).collect()
                }
                Message::Assistant(_) => vec![json!({"assistant":message})],
            })
            .collect::<Vec<Value>>()
    };
    let dialogue = dialogue_parts(&input.history);
    let id = context
        .active_note
        .as_ref()
        .unwrap()
        .note_id
        .clone()
        .unwrap();
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call(
                "read",
                "read_notes",
                json!({"purpose":"edit","note_id":id}),
            ),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::text("Retry this unstructured answer"),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("answer", "final_result", json!({"value":"Tuesday"})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ]);
    let result = tauri::async_runtime::block_on(crate::agent_runtime::measure_test_model(
        model.clone(),
        input,
        Some(context),
        crate::agent_runtime::AgentRuntimeObserver {
            evidence_context: None,
            cancelled: tokio_util::sync::CancellationToken::new(),
            permissions: None,
            on_event: Arc::new(|_| {}),
        },
    ))
    .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&result.output).unwrap(),
        json!({"value":"Tuesday"})
    );
    let requests = model.requests();
    assert_eq!(
        requests.len(),
        3,
        "Exercise initial request, tool continuation and formatter retry"
    );
    let transport = RecordingHttpClient::default();
    let client = openai::OpenAI::new("test-key").with_http(transport.clone());
    for request in requests {
        let Message::System { content } = &request.chat_history[0] else {
            panic!("Opening system instructions missing")
        };
        for text in &original_system {
            assert!(
                content.contains(text),
                "App context must be retained verbatim"
            );
        }
        assert!(
            content.contains("final_result"),
            "Formatter instructions must survive"
        );
        assert!(
            dialogue_parts(&request.chat_history).starts_with(&dialogue),
            "Dialogue content and order must survive"
        );
        tauri::async_runtime::block_on(async {
            let _ = client.chat("compatible-model").call(request).await;
        });
    }
    for (turn, request) in transport.requests().into_iter().enumerate() {
        let body: Value = serde_json::from_slice(&request.body).unwrap();
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages[0]["role"], "system");
        assert!(
            messages[1..].iter().all(|m| m["role"] != "system"),
            "Qwen requires only the first message to be system: {messages:?}"
        );
        if turn > 0 {
            let call = messages
                .iter()
                .find(|m| {
                    m["role"] == "assistant"
                        && m["tool_calls"][0]["function"]["name"] == "read_notes"
                })
                .unwrap();
            let result = messages.iter().find(|m| m["role"] == "tool").unwrap();
            assert_eq!(
                call["tool_calls"][0]["id"], result["tool_call_id"],
                "Tool-call/result pairing must survive"
            );
        }
    }
}

#[test]
#[ignore = "requires an explicitly configured OpenAI-compatible server"]
fn live_compatible_chat_runs_structured_followup_with_app_context() {
    let (_vault, context, mut input) = compatible_followup_fixture();
    input.local_base_url = std::env::var("GNEAUX_LIVE_ENDPOINT").expect("local endpoint");
    input.model = std::env::var("GNEAUX_LIVE_MODEL").expect("local model");
    input.reasoning_effort = Some("medium".into());
    let response = tauri::async_runtime::block_on(crate::agent_runtime::AgentRuntime::run(
        input,
        Some(context),
        crate::agent_runtime::AgentRuntimeObserver {
            evidence_context: None,
            cancelled: tokio_util::sync::CancellationToken::new(),
            permissions: None,
            on_event: Arc::new(|_| {}),
        },
        crate::agent_guardrails::AgentRunGuard::new(Default::default()),
    ))
    .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&response.output).unwrap(),
        json!({"value":"Tuesday"})
    );
    assert_eq!(
        response.stats.tool_calls, 1,
        "The live run must execute the synthetic read"
    );
    assert!(
        response.stats.model_calls >= 2,
        "The live run must continue after its tool result"
    );
}

#[test]
fn compatible_chat_wire_exposes_granted_tool_arguments_at_the_schema_root() {
    use rig_core::{
        completion::CompletionRequest, providers::openai, test_utils::RecordingHttpClient,
    };

    let (_vault, context, _) = fixture();
    for (capabilities, purposes) in [
        (context.capabilities.clone(), json!(["answer", "edit"])),
        (
            context.capabilities.restricted_to(&[Capability::Evidence]),
            json!(["answer"]),
        ),
        (
            context
                .capabilities
                .restricted_to(&[Capability::WorkingNotes]),
            json!(["edit"]),
        ),
    ] {
        let mut scoped = context.clone();
        scoped.capabilities = capabilities;
        let tools = registry(scoped);
        let transport = RecordingHttpClient::default();
        let client = openai::OpenAI::new("test-key").with_http(transport.clone());
        tauri::async_runtime::block_on(async {
            let _ = client
                .chat("compatible-model")
                .call(CompletionRequest::new("Synthetic schema check").tools(tools.clone()))
                .await;
            let _ = client
                .responses("openai-model")
                .call(CompletionRequest::new("Synthetic schema check").tools(tools))
                .await;
        });
        let requests = transport.requests();
        assert_eq!(requests.len(), 2);
        for request in requests {
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            let tools = body["tools"].as_array().unwrap();
            for tool in tools {
                let function = tool.get("function").unwrap_or(tool);
                assert!(
                    function["parameters"]["properties"].is_object(),
                    "Compatible servers require root properties for {}: {function}",
                    function["name"]
                );
            }
            let read = tools
                .iter()
                .map(|tool| tool.get("function").unwrap_or(tool))
                .find(|function| function["name"] == "read_notes")
                .unwrap();
            let schema = &read["parameters"];
            assert_eq!(schema["properties"]["purpose"]["enum"], purposes);
            assert_eq!(schema["required"], json!(["purpose"]));
            assert_eq!(
                schema["oneOf"].as_array().unwrap().len(),
                purposes.as_array().unwrap().len()
            );
            let properties = schema["properties"].as_object().unwrap();
            assert_eq!(
                properties.contains_key("evidence_ids"),
                purposes.as_array().unwrap().contains(&json!("answer"))
            );
            assert_eq!(
                properties.contains_key("start_line"),
                purposes.as_array().unwrap().contains(&json!("edit"))
            );

            if let Some(change) = tools
                .iter()
                .map(|tool| tool.get("function").unwrap_or(tool))
                .find(|function| function["name"] == "propose_note_change")
            {
                let schema = &change["parameters"];
                assert_eq!(
                    schema["properties"]["operation"]["enum"],
                    json!(["edit", "replace", "create"])
                );
                assert_eq!(schema["required"], json!(["operation"]));
                for argument in [
                    "note_id",
                    "expected_content_hash",
                    "edits",
                    "markdown",
                    "title",
                ] {
                    assert!(
                        schema["properties"].get(argument).is_some(),
                        "Missing proposal argument {argument}"
                    );
                }
                assert_eq!(schema["oneOf"].as_array().unwrap().len(), 3);
            }
        }
    }
}

#[test]
#[ignore = "requires an explicitly configured OpenAI-compatible server"]
fn live_compatible_chat_accepts_registered_tool_schemas() {
    use rig_core::{completion::CompletionRequest, providers::openai};
    let endpoint = std::env::var("GNEAUX_LIVE_ENDPOINT").expect("local endpoint");
    let model = std::env::var("GNEAUX_LIVE_MODEL").expect("local model");
    let (_vault, context, _) = fixture();
    let tools = registry(context);
    if let Ok(path) = std::env::var("GNEAUX_SCHEMA_OUTPUT") {
        fs::write(path, serde_json::to_vec_pretty(&tools).unwrap()).unwrap();
    }
    tauri::async_runtime::block_on(async {
        let client = openai::OpenAIConfig::new("lm-studio")
            .with_base_url(endpoint)
            .client();
        // Only definitions and this synthetic prompt leave the test vault. A
        // stream cannot dispatch tools or send note content to the server.
        client
            .chat(model)
            .stream(
                CompletionRequest::new("Reply OK. Do not call any tools.")
                    .tools(tools)
                    .additional_params(json!({"max_tokens":16,"reasoning_effort":"medium"})),
            )
            .expect("The compatible request must encode")
            .finish()
            .await
            .expect("The compatible server must accept the production tool schemas");
    });
}

#[test]
fn model_registry_has_five_tools_and_worker_cannot_access_edit_branches() {
    let (_vault, context, id) = fixture();
    let mut names: Vec<_> = registry(context.clone())
        .into_iter()
        .map(|t| t.name)
        .collect();
    names.sort();
    assert_eq!(
        names,
        [
            "find_notes",
            "propose_note_change",
            "read_notes",
            "research_notes",
            "update_plan"
        ]
    );
    let mut worker = context.clone();
    worker.capabilities = context.capabilities.restricted_to(&[Capability::Evidence]);
    let tools = registry(worker.clone());
    assert_eq!(tools.len(), 2);
    let read_tool = tools.iter().find(|t| t.name == "read_notes").unwrap();
    assert!(!read_tool.parameters.to_string().contains("\"edit\""));
    assert!(!ReadNotesTool(worker.clone())
        .description()
        .contains("purpose=edit"));
    tauri::async_runtime::block_on(async {
        let rejected = ReadNotesTool(worker.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(json!({"purpose":"edit","note_id":id})).unwrap(),
            )
            .await;
        assert!(
            rejected.is_err(),
            "Even a forged read cannot restore edit authority"
        );
        let rejected = ProposeNoteChangeTool(worker)
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(
                    json!({"operation":"create","title":"Forbidden","markdown":"body"}),
                )
                .unwrap(),
            )
            .await;
        assert!(rejected.is_err());
    });
    assert!(serde_json::from_value::<ReadNotesArgs>(
        json!({"purpose":"answer","note_id":id,"start_line":1})
    )
    .is_err());
    assert!(serde_json::from_value::<ReadNotesArgs>(
        json!({"purpose":"edit","note_id":id,"include_provenance":true})
    )
    .is_err());
    assert!(serde_json::from_value::<NoteChangeArgs>(
        json!({"operation":"create","title":"New","markdown":"body","note_id":id})
    )
    .is_err());
}

#[test]
fn unified_reads_and_changes_preserve_canonical_pending_hash_and_full_read_boundaries() {
    let (vault, context, id) = fixture();
    let (path, _, _) = context.resolve_note(&id).unwrap();
    let original = fs::read_to_string(&path).unwrap();
    tauri::async_runtime::block_on(async {
        let working = read(&context, json!({"purpose":"edit","note_id":id})).await;
        let proposal = change(&context, json!({"operation":"edit","note_id":id,"expected_content_hash":working["contentHash"],"edits":[{"kind":"replace","oldText":"first line","newText":"pending first line"}]})).await;
        assert_eq!(proposal["status"], "pending_review");
        let canonical = read(&context, json!({"purpose":"answer","note_id":id})).await;
        assert!(!canonical.to_string().contains("pending first line"));
        assert!(canonical["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["excerpt"]
                .as_str()
                .is_some_and(|s| s.contains("first line"))));
        let partial = read(
            &context,
            json!({"purpose":"edit","note_id":id,"max_chars":20}),
        )
        .await;
        assert_eq!(partial["pendingChanges"], true);
        assert_eq!(partial["hasMore"], true);
        assert!(partial["content"]
            .as_str()
            .unwrap()
            .contains("pending first line"));
        let rejected = change(&context, json!({"operation":"replace","note_id":id,"expected_content_hash":partial["contentHash"],"markdown":"complete replacement"})).await;
        assert_eq!(rejected["code"], "note_not_fully_read");
        let full = read(
            &context,
            json!({"purpose":"edit","note_id":id,"max_chars":6000}),
        )
        .await;
        let stale = change(&context, json!({"operation":"replace","note_id":id,"expected_content_hash":working["contentHash"],"markdown":"stale replacement"})).await;
        assert_eq!(stale["status"], "error");
        let proposal = change(&context, json!({"operation":"replace","note_id":id,"expected_content_hash":full["contentHash"],"markdown":"complete replacement"})).await;
        assert_eq!(proposal["status"], "pending_review");
        let stored = context
            .service
            .pending_agent_proposal_for_note(&id)
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.preview["proposedEditorMarkdown"],
            "complete replacement"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        context
            .service
            .set_note_excluded(&id, "Tool note", true)
            .unwrap();
        let excluded = ReadNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(json!({"purpose":"answer","note_id":id})).unwrap(),
            )
            .await;
        assert!(excluded.is_err());
    });
    assert!(vault.notes.path().exists());
}

#[test]
fn unified_creation_stages_review_without_creating_a_file() {
    let (vault, context, _) = fixture();
    let before = fs::read_dir(vault.notes.path()).unwrap().count();
    let result = tauri::async_runtime::block_on(change(
        &context,
        json!({"operation":"create","title":"A new note","markdown":"Keep this body."}),
    ));
    assert_eq!(result["status"], "pending_review");
    assert_eq!(fs::read_dir(vault.notes.path()).unwrap().count(), before);
}

#[test]
fn unified_find_retains_activity_presentation_in_cursor_only_continuations() {
    let (vault, context, _) = fixture();
    for title in ["Alpha activity", "Beta activity", "Gamma activity"] {
        crate::test_support::save_and_finalize(
            &vault.state,
            title.into(),
            format!("Recorded {title} progress."),
            None,
        )
        .unwrap();
    }
    vault
        .state
        .lexical
        .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
        .unwrap();
    tauri::async_runtime::block_on(async {
        let find = FindNotesTool(context.clone());
        let mut call = ToolContext::new();
        let missing = find
            .call(
                &mut call,
                serde_json::from_value(json!({"result":"notes"})).unwrap(),
            )
            .await;
        assert!(missing.is_err());
        let first = find.call(&mut call, serde_json::from_value(json!({"result":"notes","activity_range":{"start":"2020-01-01","end":"2100-01-01"},"limit":1})).unwrap()).await.unwrap();
        assert_eq!(first["notesReturned"], 1);
        let cursor = first["nextCursor"]
            .as_str()
            .expect("Multiple changed notes need a continuation");
        let second = find
            .call(
                &mut call,
                serde_json::from_value(json!({"cursor":cursor})).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(second["notesReturned"], 1);
        assert_ne!(first["items"][0]["noteId"], second["items"][0]["noteId"]);
        let mixed = find
            .call(
                &mut call,
                serde_json::from_value(json!({"cursor":cursor,"result":"passages"})).unwrap(),
            )
            .await;
        assert!(mixed.is_err());
    });
}
