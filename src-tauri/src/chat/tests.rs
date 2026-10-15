use super::*;
use crate::test_support::{load_json_fixture, TestDir};
use serde_json::json;

pub(super) fn service(name: &str) -> (TestDir, ChatService) {
    let root = TestDir::new(name);
    let data = root.path().join(".gneauxghts");
    fs::create_dir_all(&data).unwrap();
    let service = ChatService::new(root.path().to_path_buf(), data).unwrap();
    (root, service)
}

#[test]
fn activity_read_sources_survive_restart_without_becoming_answer_citations() {
    use crate::agent_runtime::{
        AgentEvent, AgentProvider, AgentRuntimeObserver, AgentRuntimeRequest,
    };
    use rig_core::{
        completion::{Message, Usage},
        test_utils::{MockCompletionModel, MockStreamEvent},
    };
    let (vault, tools, note_id, service) = crate::agent_tools::AgentToolContext::test_fixture();
    let conversation_id = service.list_conversations().unwrap()[0].id.clone();
    let conversation = service.get_conversation(&conversation_id).unwrap();
    let message_id = conversation
        .messages
        .iter()
        .find(|m| m.role == "assistant")
        .unwrap()
        .id
        .clone();
    let run_id: String = service
        .connection()
        .unwrap()
        .query_row(
            "SELECT id FROM chat_agent_runs WHERE assistant_message_id = ?1",
            [&message_id],
            |row| row.get(0),
        )
        .unwrap();
    let capture = service.clone();
    let event_conversation = conversation_id.clone();
    let event_message = message_id.clone();
    let sequence = AtomicU64::new(1);
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call(
                "read",
                "read_notes",
                json!({"purpose":"answer","note_id":note_id}),
            ),
            MockStreamEvent::final_response(Usage::new()),
        ],
        vec![
            MockStreamEvent::text("Completed."),
            MockStreamEvent::final_response(Usage::new()),
        ],
    ]);
    let response = tauri::async_runtime::block_on(crate::agent_runtime::measure_test_model(
        model,
        AgentRuntimeRequest {
            provider: AgentProvider::Openai,
            model: "mock".into(),
            api_key: None,
            local_base_url: "http://localhost:1234/v1".into(),
            preamble: "Read the note.".into(),
            output_schema: None,
            prompt: Message::user("Read this note"),
            history: vec![],
            enable_web: false,
            require_web: false,
            flex: false,
            reasoning_effort: None,
        },
        Some(tools.clone()),
        AgentRuntimeObserver {
            evidence_context: Some(tools.clone()),
            cancelled: CancellationToken::new(),
            permissions: None,
            on_event: Arc::new(move |event| {
                if event.is_durable() {
                    capture
                        .append_agent_event(&ChatAgentEventEnvelope {
                            schema_version: 2,
                            request_id: "activity-test".into(),
                            conversation_id: event_conversation.clone(),
                            message_id: event_message.clone(),
                            run_id: run_id.clone(),
                            sequence: sequence.fetch_add(1, Ordering::Relaxed),
                            created_at_millis: now_millis(),
                            event,
                        })
                        .unwrap();
                }
            }),
        },
    ))
    .unwrap();
    service
        .finish_message(&message_id, "complete", &response.output, None, &[])
        .unwrap();
    drop(tools);
    drop(service);
    let service = ChatService::new(vault.notes.path().into(), vault.data.path().into()).unwrap();
    let reopened = service.get_conversation(&conversation_id).unwrap();
    let assistant = reopened
        .messages
        .iter()
        .find(|m| m.id == message_id)
        .unwrap();
    assert!(assistant.sources.is_empty());
    let read_sources = assistant
        .agent_events
        .iter()
        .find_map(|envelope| match &envelope.event {
            AgentEvent::ToolCallUpdated {
                call_id,
                status,
                read_sources,
                ..
            } if call_id == "read" && status == "success" => Some(read_sources),
            _ => None,
        })
        .unwrap();
    assert!(!read_sources.is_empty());
    assert!(read_sources
        .iter()
        .all(|s| s.title == "Tool note" && s.passage.is_some()));
    let source = &read_sources[0];
    assert!(crate::services::evidence::validate_citation(
        &vault.state,
        source.passage.as_ref().unwrap(),
        None,
        &HashSet::new()
    )
    .is_some());
    let mut allowed = read_sources.clone();
    crate::agent_tools::filter_revision_sources(
        &vault.state,
        &service,
        &VaultAccess::None,
        &HashSet::new(),
        &mut allowed,
    )
    .unwrap();
    assert!(
        allowed.is_empty(),
        "Revoked access hides activity destinations too"
    );
    service
        .set_note_excluded(&note_id, "Tool note", true)
        .unwrap();
    let hidden = service.get_conversation(&conversation_id).unwrap();
    assert!(hidden
        .messages
        .iter()
        .flat_map(|m| &m.agent_events)
        .all(|envelope| match &envelope.event {
            AgentEvent::ToolCallUpdated { read_sources, .. } => read_sources.is_empty(),
            _ => true,
        }));
    service
        .set_note_excluded(&note_id, "Tool note", false)
        .unwrap();
    let path = vault
        .state
        .notes_index
        .lock()
        .unwrap()
        .get_note_by_note_id(&note_id)
        .map(|(path, _)| path.clone())
        .unwrap();
    let mut changed = fs::read_to_string(&path).unwrap();
    changed.push_str("\nSource changed after this read.\n");
    fs::write(&path, changed).unwrap();
    let mut stale = read_sources.clone();
    crate::agent_tools::filter_revision_sources(
        &vault.state,
        &service,
        &VaultAccess::Full,
        &HashSet::new(),
        &mut stale,
    )
    .unwrap();
    assert!(
        stale.is_empty(),
        "Changed passages cannot remain navigation authority"
    );
}

#[test]
fn restart_quiescence_cancels_and_joins_admitted_request_and_title_work() {
    let tracker = Arc::new(ChatWorkTracker::new());
    let request_cancel = CancellationToken::new();
    let title_cancel = CancellationToken::new();
    let request = tracker
        .admit("request:active".to_string(), request_cancel.clone())
        .unwrap();
    let title = tracker
        .admit("title:active".to_string(), title_cancel.clone())
        .unwrap();
    let (settled_tx, settled_rx) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        scope.spawn(|| {
            tracker.quiesce_and_wait().unwrap();
            settled_tx.send(()).unwrap();
        });
        tauri::async_runtime::block_on(request_cancel.cancelled());
        tauri::async_runtime::block_on(title_cancel.cancelled());
        assert!(settled_rx.try_recv().is_err());
        drop(request);
        assert!(settled_rx.try_recv().is_err());
        drop(title);
        settled_rx.recv().unwrap();
    });
    assert!(tracker
        .admit("request:late".to_string(), CancellationToken::new())
        .is_err());
    tracker.resume().unwrap();
    assert!(tracker
        .admit("request:resumed".to_string(), CancellationToken::new())
        .is_ok());
}

pub(super) fn seed_agent_run(
    service: &ChatService,
    conversation_id: &str,
    suffix: &str,
    first_ordinal: i64,
) -> (String, String) {
    let user_id = format!("user-{suffix}");
    let assistant_id = format!("assistant-{suffix}");
    let connection = service.connection().unwrap();
    connection
        .execute(
            "INSERT INTO chat_messages
                 (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                 VALUES (?1, ?2, ?3, 'user', 'complete', 'request', 1, 1)",
            params![user_id, conversation_id, first_ordinal],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO chat_messages
                 (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                 VALUES (?1, ?2, ?3, 'assistant', 'complete', 'response', 1, 2)",
            params![assistant_id, conversation_id, first_ordinal + 1],
        )
        .unwrap();
    drop(connection);
    let run_id = service
        .create_agent_run(
            conversation_id,
            &user_id,
            &assistant_id,
            None,
            "openai",
            "test-model",
        )
        .unwrap();
    (run_id, assistant_id)
}

fn stage_test_proposal(
    service: &ChatService,
    kind: &str,
    note_id: Option<&str>,
    suggested_path: Option<&Path>,
    title: &str,
    proposed_markdown: &str,
) -> ChatAgentProposal {
    let conversation = service.create_conversation(None, None).unwrap();
    let (run_id, assistant_id) = seed_agent_run(service, &conversation.summary.id, "commit", 1);
    service
        .stage_agent_proposal(
            &run_id,
            &conversation.summary.id,
            &assistant_id,
            kind,
            note_id,
            suggested_path.map(|path| path.to_string_lossy()).as_deref(),
            title,
            Some("base-hash"),
            &json!({"title":title,"markdown":proposed_markdown}),
            &json!({"proposedEditorMarkdown":proposed_markdown}),
        )
        .unwrap()
}

#[test]
fn saved_addition_refreshes_against_changed_note_before_another_keep() {
    let fixture = crate::test_support::TestVault::new("promotion-append-refresh");
    let service = ChatService::new(
        fixture.notes.path().to_path_buf(),
        fixture.notes.path().join(".gneauxghts"),
    )
    .unwrap();
    let path = fixture.notes.path().join("Target.md");
    let initial = fixture
        .state
        .note_timeline()
        .create_note_at(
            crate::services::note_timeline::MutationSource::Editor,
            &path,
            "Original",
        )
        .unwrap()
        .unwrap();
    let conversation = service
        .create_conversation(None, Some(VaultAccess::Full))
        .unwrap();
    let (_, message) = seed_agent_run(&service, &conversation.summary.id, "save-addition", 1);
    let proposal = service
        .prepare_note_save_target(
            &conversation.summary.id,
            &message,
            None,
            None,
            Some(initial.note_id().as_str()),
            None,
            None,
            None,
        )
        .unwrap();
    fixture
        .state
        .note_timeline()
        .edit_note(
            crate::services::note_timeline::MutationSource::Editor,
            &path,
            Some(initial.note_id()),
            |_| Ok("Original\n\nExternal addition".into()),
        )
        .unwrap();
    let result = crate::commands::proposal_commands::commit_agent_proposal_with_state(
        &fixture.state,
        &service,
        proposal.id.clone(),
        None,
    )
    .unwrap();
    assert_eq!(result.status, "conflict");
    assert!(!fs::read_to_string(&path).unwrap().contains("response"));
    let draft = service.proposal_draft(&proposal.id).unwrap();
    assert!(draft.markdown.contains("External addition"));
    assert!(draft.markdown.contains("response"));
    let kept = crate::commands::proposal_commands::commit_agent_proposal_with_state(
        &fixture.state,
        &service,
        proposal.id.clone(),
        Some(draft.markdown),
    )
    .unwrap();
    assert_eq!(kept.status, "committed");
    let again = crate::commands::proposal_commands::commit_agent_proposal_with_state(
        &fixture.state,
        &service,
        proposal.id,
        None,
    )
    .unwrap();
    assert_eq!(again.note_id, kept.note_id);
    assert!(fs::read_to_string(&path)
        .unwrap()
        .contains("External addition"));
}

#[test]
fn populated_legacy_proposals_migrate_without_losing_work_or_foreign_keys() {
    let (root, service) = service("populated-proposal-migration");
    let proposal = stage_test_proposal(
        &service,
        "create",
        None,
        Some(&root.path().join("Legacy.md")),
        "Legacy",
        "Retained body",
    );
    let db = service.inner.db_path.clone();
    drop(service);
    let connection = Connection::open(&db).unwrap();
    connection.execute_batch("PRAGMA foreign_keys=OFF; DROP TABLE chat_proposal_drafts; DROP TABLE chat_note_saves; DROP TABLE chat_proposal_receipts; ALTER TABLE chat_agent_proposals RENAME TO proposals_copy;
        CREATE TABLE chat_agent_proposals (id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES chat_agent_runs(id) ON DELETE CASCADE,conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,assistant_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,kind TEXT NOT NULL,note_id TEXT,suggested_path TEXT,title TEXT NOT NULL,base_hash TEXT,payload_json TEXT NOT NULL,preview_json TEXT NOT NULL,status TEXT NOT NULL,superseded_by TEXT,commit_target_path TEXT,intended_editor_content_hash TEXT,created_at_millis INTEGER NOT NULL,updated_at_millis INTEGER NOT NULL);
        INSERT INTO chat_agent_proposals SELECT * FROM proposals_copy; DROP TABLE proposals_copy;").unwrap();
    drop(connection);
    let reopened = ChatService::new(root.path().into(), root.path().join(".gneauxghts")).unwrap();
    let loaded = reopened.get_agent_proposal(&proposal.id).unwrap();
    assert_eq!(loaded.run_id, proposal.run_id);
    assert_eq!(loaded.payload, proposal.payload);
    assert_eq!(
        reopened.proposal_draft(&proposal.id).unwrap().markdown,
        "Retained body"
    );
    assert!(!reopened
        .connection()
        .unwrap()
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .exists([])
        .unwrap());
    reopened
        .resolve_agent_proposal(&proposal.id, "dismissed")
        .unwrap();
    assert!(reopened.proposal_draft(&proposal.id).is_err());
    assert_eq!(
        reopened
            .connection()
            .unwrap()
            .query_row("SELECT count(*) FROM chat_proposal_drafts", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn action_note_save_is_durable_deduplicated_and_has_no_synthetic_run() {
    let (root, service) = service("action-note-save");
    let conversation = service
        .create_conversation(None, Some(VaultAccess::Full))
        .unwrap();
    let (_, message) = seed_agent_run(&service, &conversation.summary.id, "save", 1);
    service
        .connection()
        .unwrap()
        .execute(
            "UPDATE chat_messages SET content='# Decision\n\nKeep the pilot.' WHERE id=?1",
            [&message],
        )
        .unwrap();
    let proposal = service
        .prepare_note_save(&conversation.summary.id, &message, None)
        .unwrap();
    assert_eq!(proposal.title, "Decision");
    assert!(proposal.run_id.is_none());
    assert!(!root.path().join("Decision.md").exists());
    assert_eq!(
        service
            .prepare_note_save(&conversation.summary.id, &message, None)
            .unwrap()
            .id,
        proposal.id
    );
    let draft = service.proposal_draft(&proposal.id).unwrap();
    let changed = service
        .checkpoint_proposal_draft(
            &proposal.id,
            draft.version,
            "Edited body",
            "Edited title",
            None,
            &json!([]),
        )
        .unwrap();
    assert_eq!(changed.version, draft.version + 1);
    assert!(service
        .checkpoint_proposal_draft(
            &proposal.id,
            draft.version,
            "stale",
            "stale",
            None,
            &json!([])
        )
        .is_err());
    let reopened = ChatService::new(root.path().into(), root.path().join(".gneauxghts")).unwrap();
    let recovered = reopened.proposal_draft(&proposal.id).unwrap();
    assert_eq!(recovered.markdown, "Edited body");
    assert_eq!(recovered.title, "Edited title");
    assert_eq!(
        reopened.get_agent_proposal(&proposal.id).unwrap().run_id,
        None
    );
}

#[test]
fn selected_save_intents_and_backlinks_bind_the_verified_occurrence() {
    let (_root, service) = service("save-repeated-selection");
    let conversation = service
        .create_conversation(None, Some(VaultAccess::Full))
        .unwrap();
    let (_, message_id) =
        seed_agent_run(&service, &conversation.summary.id, "repeated-selection", 1);
    let answer = "Same pilot. Same pilot.";
    service
        .connection()
        .unwrap()
        .execute(
            "UPDATE chat_messages SET content=?1 WHERE id=?2",
            params![answer, message_id],
        )
        .unwrap();
    let select = |occurrence| note_proposals::SaveSelection {
        text: "Same pilot.".into(),
        markdown: "Same pilot.".into(),
        occurrence: Some(occurrence),
    };
    let first = service
        .prepare_note_save_selection(
            &conversation.summary.id,
            &message_id,
            None,
            Some(&select(0)),
        )
        .unwrap();
    let second = service
        .prepare_note_save_selection(
            &conversation.summary.id,
            &message_id,
            None,
            Some(&select(1)),
        )
        .unwrap();
    assert_ne!(first.id, second.id);
    assert_eq!(
        service
            .prepare_note_save_selection(
                &conversation.summary.id,
                &message_id,
                None,
                Some(&select(1))
            )
            .unwrap()
            .id,
        second.id
    );
    let connection = service.connection().unwrap();
    let mut stmt = connection.prepare("SELECT start_offset, end_offset FROM chat_excerpts WHERE message_id=?1 ORDER BY start_offset").unwrap();
    let positions = stmt
        .query_map([&message_id], |row| {
            Ok((row.get::<_, usize>(0)?, row.get::<_, usize>(1)?))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect::<Vec<_>>();
    assert_eq!(positions, vec![(0, 11), (12, 23)]);
}

fn seed_streaming_agent_run(
    service: &ChatService,
    conversation_id: &str,
    suffix: &str,
    partial_content: &str,
) -> (String, String, String) {
    let user_id = format!("stream-user-{suffix}");
    let assistant_id = format!("stream-assistant-{suffix}");
    let connection = service.connection().unwrap();
    connection
        .execute(
            "INSERT INTO chat_messages
                 (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                 VALUES (?1, ?2, 1, 'user', 'complete', 'request', 1, 1)",
            params![user_id, conversation_id],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO chat_messages
                 (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                 VALUES (?1, ?2, 2, 'assistant', 'streaming', ?3, 1, 2)",
            params![assistant_id, conversation_id, partial_content],
        )
        .unwrap();
    drop(connection);
    let run_id = service
        .create_agent_run(
            conversation_id,
            &user_id,
            &assistant_id,
            None,
            "openai",
            "test-model",
        )
        .unwrap();
    (run_id, user_id, assistant_id)
}

#[test]
fn streaming_events_match_contract_fixture() {
    let fixture = load_json_fixture("contracts/chat-stream-events.json");
    let conversation = ChatConversationSummary {
        id: "conversation-1".to_string(),
        title: "Contract conversation".to_string(),
        access: VaultAccess::Full,
        status: "active".to_string(),
        created_at_millis: 1_699_999_999_000,
        updated_at_millis: 1_700_000_000_000,
        message_count: 2,
        detached: false,
        provider: "openai".to_string(),
        model: "gpt-5.6-terra".to_string(),
        reasoning_effort: "medium".to_string(),
    };
    let mut started = stream_payload("request-1", "conversation-1", "message-assistant-1");
    started.conversation = Some(conversation.clone());
    let mut delta = stream_payload("request-1", "conversation-1", "message-assistant-1");
    delta.delta = Some("Partial".to_string());
    let mut source = stream_payload("request-1", "conversation-1", "message-assistant-1");
    source.source = Some(ChatSource {
        kind: "note".to_string(),
        note_id: Some("note-1".to_string()),
        note_path: Some("/vault/Title.md".to_string()),
        title: "Title".to_string(),
        excerpt: "Relevant text".to_string(),
        url: None,
        anchor: Some("section".to_string()),
        revision: None,
        passage: None,
    });
    let mut completed = stream_payload("request-1", "conversation-1", "message-assistant-1");
    completed.conversation = Some(conversation.clone());
    completed.content = Some("Complete response".to_string());
    let mut failed = stream_payload("request-1", "conversation-1", "message-assistant-1");
    failed.conversation = Some(conversation.clone());
    failed.content = Some("Partial response".to_string());
    failed.error = Some("Provider disconnected".to_string());
    let mut cancelled = stream_payload("request-1", "conversation-1", "message-assistant-1");
    cancelled.conversation = Some(conversation);
    cancelled.content = Some("Partial response".to_string());

    let actual = [
        ("chat://started", started),
        ("chat://text-delta", delta),
        ("chat://source", source),
        ("chat://completed", completed),
        ("chat://failed", failed),
        ("chat://cancelled", cancelled),
    ]
    .into_iter()
    .map(|(channel, payload)| {
        json!({
            "channel": channel,
            "payload": payload,
        })
    })
    .collect::<Vec<_>>();

    assert_eq!(fixture["version"], 1);
    assert_eq!(fixture["events"], json!(actual));
}

#[test]
fn structured_agent_events_are_durable_and_idempotent() {
    let (_root, service) = service("chat-agent-events");
    let conversation = service.create_conversation(None, None).unwrap();
    let (run_id, assistant_id) = seed_agent_run(&service, &conversation.summary.id, "events", 1);
    let plan = ChatAgentEventEnvelope {
        schema_version: 2,
        request_id: "request-events".to_string(),
        conversation_id: conversation.summary.id.clone(),
        message_id: assistant_id.clone(),
        run_id: run_id.clone(),
        sequence: 2,
        created_at_millis: 10,
        event: crate::agent_runtime::AgentEvent::PlanUpdated {
            entries: vec![crate::agent_runtime::AgentPlanEntry {
                id: "step-1".to_string(),
                text: "Inspect the note".to_string(),
                status: "inProgress".to_string(),
                detail: None,
            }],
        },
    };
    service.append_agent_event(&plan).unwrap();
    service.append_agent_event(&plan).unwrap();
    service
        .append_agent_event(&ChatAgentEventEnvelope {
            schema_version: 2,
            request_id: "request-events".to_string(),
            conversation_id: conversation.summary.id.clone(),
            message_id: assistant_id.clone(),
            run_id: run_id.clone(),
            sequence: 3,
            created_at_millis: 10,
            event: crate::agent_runtime::AgentEvent::ModelTurnRetried { turn: 2 },
        })
        .unwrap();
    service
        .append_agent_event(&ChatAgentEventEnvelope {
            schema_version: 2,
            request_id: "request-events".to_string(),
            conversation_id: conversation.summary.id.clone(),
            message_id: assistant_id.clone(),
            run_id,
            sequence: 4,
            created_at_millis: 11,
            event: crate::agent_runtime::AgentEvent::UsageUpdated {
                call_index: 1,
                aggregate: crate::agent_runtime::AgentUsage {
                    input_tokens: 8,
                    output_tokens: 5,
                    total_tokens: 13,
                    cached_input_tokens: 2,
                    cache_creation_input_tokens: 0,
                    tool_use_prompt_tokens: 0,
                    reasoning_tokens: 1,
                },
            },
        })
        .unwrap();

    let reloaded = service.get_conversation(&conversation.summary.id).unwrap();
    let assistant = reloaded
        .messages
        .iter()
        .find(|message| message.id == assistant_id)
        .unwrap();
    assert_eq!(assistant.agent_events.len(), 3);
    assert_eq!(assistant.agent_events[0], plan);
    assert!(matches!(
        assistant.agent_events[1].event,
        crate::agent_runtime::AgentEvent::ModelTurnRetried { turn: 2 }
    ));
    assert!(matches!(
        assistant.agent_events[2].event,
        crate::agent_runtime::AgentEvent::UsageUpdated { call_index: 1, .. }
    ));
}

#[test]
fn agent_event_wire_contract_preserves_details_and_reopens_legacy_records() {
    use crate::agent_runtime::AgentEvent;
    let fixture = load_json_fixture("contracts/agent-events.json");
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(fixture["version"], 1);
    for case in cases {
        let event: AgentEvent = serde_json::from_value(case["legacy"].clone()).unwrap();
        assert_eq!(serde_json::to_value(&event).unwrap(), case["wire"]);
        assert_eq!(
            serde_json::from_value::<AgentEvent>(case["wire"].clone()).unwrap(),
            event
        );
    }

    let (root, service) = service("legacy-agent-event-contract");
    let conversation = service.create_conversation(None, None).unwrap();
    let (run, assistant) = seed_agent_run(&service, &conversation.summary.id, "legacy", 1);
    let connection = service.connection().unwrap();
    // Simulate records written by the previous app, rather than serializing
    // through the corrected type before exercising the actual reload path.
    for (index, case) in cases.iter().take(4).enumerate() {
        connection.execute(
            "INSERT INTO chat_agent_events (run_id, sequence, request_id, conversation_id, message_id, event_json, created_at_millis) VALUES (?1, ?2, 'legacy-request', ?3, ?4, ?5, ?2)",
            params![run, index as i64 + 1, conversation.summary.id, assistant, case["legacy"].to_string()],
        ).unwrap();
    }
    drop(connection);
    drop(service);
    let reopened = ChatService::new(root.path().into(), root.path().join(".gneauxghts")).unwrap();
    let conversation = reopened.get_conversation(&conversation.summary.id).unwrap();
    let message = conversation
        .messages
        .iter()
        .find(|m| m.id == assistant)
        .unwrap();
    let serialized = serde_json::to_value(message).unwrap();
    let events = serialized["agentEvents"].as_array().unwrap();
    assert_eq!(events.len(), 4);
    for (event, case) in events.iter().zip(cases) {
        assert_eq!(event["event"], case["wire"]);
    }
}

#[test]
fn retired_agent_event_variants_do_not_prevent_conversation_replay() {
    let (_root, service) = service("chat-retired-agent-event");
    let conversation = service.create_conversation(None, None).unwrap();
    let (run_id, assistant_id) =
        seed_agent_run(&service, &conversation.summary.id, "retired-event", 1);
    service
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO chat_agent_events
                 (run_id, sequence, request_id, conversation_id, message_id, event_json, created_at_millis)
                 VALUES (?1, 1, 'request-retired', ?2, ?3, ?4, 1)",
                params![
                    run_id,
                    conversation.summary.id,
                    assistant_id,
                    r#"{"type":"reasoningUpdated","status":"completed"}"#
                ],
            )
            .unwrap();

    let reloaded = service.get_conversation(&conversation.summary.id).unwrap();
    let assistant = reloaded
        .messages
        .iter()
        .find(|message| message.id == assistant_id)
        .unwrap();
    assert!(assistant.agent_events.is_empty());
    assert_eq!(assistant.content, "response");
}

#[test]
fn checkpoint_branch_copies_history_and_records_lineage() {
    let (_root, service) = service("chat-checkpoint-branch");
    let conversation = service
        .create_conversation(Some("Research".to_string()), None)
        .unwrap();
    let connection = service.connection().unwrap();
    connection
        .execute(
            "INSERT INTO chat_messages
                 (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                 VALUES ('checkpoint-user', ?1, 1, 'user', 'complete', 'Question', 1, 1),
                        ('checkpoint-assistant', ?1, 2, 'assistant', 'complete', 'Answer', 1, 2),
                        ('after-checkpoint', ?1, 3, 'user', 'complete', 'Later', 1, 3)",
            [&conversation.summary.id],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO chat_sources
                 (message_id, kind, note_id, note_path, title, excerpt, url, anchor)
                 VALUES ('checkpoint-assistant', 'note', 'note-1', 'Notes/One.md',
                         'One', 'Evidence', NULL, 'section')",
            [],
        )
        .unwrap();
    drop(connection);
    let run_id = service
        .create_agent_run(
            &conversation.summary.id,
            "checkpoint-user",
            "checkpoint-assistant",
            None,
            "openai",
            "test-model",
        )
        .unwrap();
    service
        .append_agent_event(&ChatAgentEventEnvelope {
            schema_version: 2,
            request_id: "checkpoint-request".to_string(),
            conversation_id: conversation.summary.id.clone(),
            message_id: "checkpoint-assistant".to_string(),
            run_id,
            sequence: 1,
            created_at_millis: 2,
            event: crate::agent_runtime::AgentEvent::PlanUpdated {
                entries: Vec::new(),
            },
        })
        .unwrap();

    let branch = service.branch_from_message("checkpoint-assistant").unwrap();
    assert_eq!(branch.summary.title, "Research (branch)");
    assert_eq!(branch.messages.len(), 2);
    assert_eq!(branch.messages[1].content, "Answer");
    assert_eq!(branch.messages[1].sources.len(), 1);
    assert_eq!(branch.messages[1].agent_events.len(), 1);
    let lineage = service
        .connection()
        .unwrap()
        .query_row(
            "SELECT branched_from_conversation_id, branched_from_message_id
                 FROM chat_conversations WHERE id = ?1",
            [&branch.summary.id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .unwrap();
    assert_eq!(lineage.0, conversation.summary.id);
    assert_eq!(lineage.1, "checkpoint-assistant");
}

#[test]
fn startup_reconciles_every_running_run_from_its_durable_assistant_status() {
    let (root, service) = service("chat-running-run-reconciliation");
    let data = root.path().join(".gneauxghts");
    let cases = [
        ("complete", "complete", "completed"),
        ("error", "error", "error"),
        ("cancelled", "cancelled", "cancelled"),
        ("streaming", "streaming", "cancelled"),
    ];
    let mut records = Vec::new();
    for (suffix, message_status, expected_run_status) in cases {
        let conversation = service.create_conversation(None, None).unwrap();
        let partial = format!("durable content for {suffix}");
        let (run_id, _, assistant_id) =
            seed_streaming_agent_run(&service, &conversation.summary.id, suffix, &partial);
        if message_status != "streaming" {
            service
                .connection()
                .unwrap()
                .execute(
                    "UPDATE chat_messages SET status = ?2 WHERE id = ?1",
                    params![assistant_id, message_status],
                )
                .unwrap();
        }
        records.push((
            run_id,
            assistant_id,
            message_status.to_string(),
            expected_run_status.to_string(),
            partial,
        ));
    }
    drop(service);

    let first =
        ChatService::new(root.path().to_path_buf(), data.clone()).expect("reconcile running runs");
    let mut first_states = Vec::new();
    for (run_id, assistant_id, message_status, expected_run_status, content) in &records {
        let state = first
            .connection()
            .unwrap()
            .query_row(
                "SELECT m.status, m.content, r.status, r.updated_at_millis
                     FROM chat_messages m
                     JOIN chat_agent_runs r ON r.assistant_message_id = m.id
                     WHERE m.id = ?1 AND r.id = ?2",
                params![assistant_id, run_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .unwrap();
        let expected_message_status = if message_status == "streaming" {
            "cancelled"
        } else {
            message_status
        };
        assert_eq!(state.0, expected_message_status);
        assert_eq!(&state.1, content);
        assert_eq!(&state.2, expected_run_status);
        first_states.push(state);
    }
    drop(first);

    let second = ChatService::new(root.path().to_path_buf(), data).expect("repeat reconciliation");
    for ((run_id, assistant_id, _, _, _), first_state) in records.iter().zip(first_states.iter()) {
        let second_state = second
            .connection()
            .unwrap()
            .query_row(
                "SELECT m.status, m.content, r.status, r.updated_at_millis
                     FROM chat_messages m
                     JOIN chat_agent_runs r ON r.assistant_message_id = m.id
                     WHERE m.id = ?1 AND r.id = ?2",
                params![assistant_id, run_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(&second_state, first_state);
    }
}

#[test]
fn retry_agent_run_keeps_interrupted_message_lineage_across_restart() {
    let (root, service) = service("chat-retry-lineage");
    let data = root.path().join(".gneauxghts");
    let conversation = service.create_conversation(None, None).unwrap();
    let (_, user_id, interrupted_assistant_id) =
        seed_streaming_agent_run(&service, &conversation.summary.id, "original", "Partial");
    drop(service);

    let recovered =
        ChatService::new(root.path().to_path_buf(), data.clone()).expect("recover original");
    let retry_assistant_id = "stream-assistant-retry";
    recovered
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO chat_messages
                 (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                 VALUES (?1, ?2, 3, 'assistant', 'streaming', 'Retry partial', 1, 3)",
            params![retry_assistant_id, conversation.summary.id],
        )
        .unwrap();
    let retry_run_id = recovered
        .create_agent_run(
            &conversation.summary.id,
            &user_id,
            retry_assistant_id,
            Some(&interrupted_assistant_id),
            "openai",
            "test-model",
        )
        .unwrap();
    drop(recovered);

    let reopened = ChatService::new(root.path().to_path_buf(), data).expect("recover retry");
    let (retry_of, run_status) = reopened
        .connection()
        .unwrap()
        .query_row(
            "SELECT retry_of_message_id, status
                 FROM chat_agent_runs WHERE id = ?1",
            [&retry_run_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .unwrap();
    assert_eq!(retry_of.as_deref(), Some(interrupted_assistant_id.as_str()));
    assert_eq!(run_status, "cancelled");
}

#[test]
fn retry_run_context_survives_restart() {
    let (root, service) = service("chat-retry-context");
    let data = root.path().join(".gneauxghts");
    let conversation = service.create_conversation(None, None).unwrap();
    let (_, user_id, assistant_id) =
        seed_streaming_agent_run(&service, &conversation.summary.id, "context", "Partial");
    let active_note = crate::agent_tools::ActiveNoteSnapshot {
        note_id: Some("note-1".to_string()),
        title: "Current note".to_string(),
        path: Some("Current note.md".to_string()),
        body: "Important context".to_string(),
        body_hash: "hash-1".to_string(),
        selection: Some("selected context".to_string()),
    };
    let selected_context = ChatRunContextItem {
        note_id: "note-2".to_string(),
        note_path: "Project plan.md".to_string(),
        title: "Project plan".to_string(),
        section_label: Some("Decisions".to_string()),
        excerpt: "Use the durable coordinator boundary.".to_string(),
        content_hash: "hash-2".to_string(),
        reason: "related".to_string(),
        start_line: Some(4),
        end_line: Some(9),
        block_anchor: Some("decision-1".to_string()),
    };
    service
        .connection()
        .unwrap()
        .execute(
            "DELETE FROM chat_agent_runs WHERE assistant_message_id = ?1",
            [&assistant_id],
        )
        .unwrap();
    service
        .create_agent_run_with_context(
            &conversation.summary.id,
            &user_id,
            &assistant_id,
            None,
            "openai",
            "test-model",
            "medium",
            true,
            Some(&active_note),
            std::slice::from_ref(&selected_context),
        )
        .unwrap();
    drop(service);

    let reopened = ChatService::new(root.path().to_path_buf(), data).unwrap();
    let context = reopened
        .retry_run_context(&conversation.summary.id, &assistant_id)
        .unwrap();
    let restored = context.active_note.expect("active note context");
    assert!(context.force_web_search);
    assert_eq!(restored.note_id.as_deref(), Some("note-1"));
    assert_eq!(restored.title, "Current note");
    assert_eq!(restored.selection.as_deref(), Some("selected context"));
    assert_eq!(context.selected_context, vec![selected_context]);
}

#[test]
fn chat_defaults_and_atlas_visibility_do_not_overwrite_each_other() {
    let (_root, service) = service("chat-flex-setting");
    let mut settings = service.get_settings().expect("load defaults");
    assert_eq!(settings.service_tier, ChatServiceTier::Standard);
    settings.service_tier = ChatServiceTier::Flex;
    // A settings form retains the earlier read projection while Atlas changes.
    let defaults: ChatDefaults =
        serde_json::from_value(serde_json::to_value(settings).unwrap()).unwrap();
    service.set_atlas_visibility("remembered").unwrap();
    let saved = service.set_defaults(defaults).expect("save flex setting");
    assert_eq!(saved.atlas_visibility, "remembered");
    service.set_atlas_visibility("all").unwrap();
    assert!(service.set_atlas_visibility("invalid").is_err());
    assert_eq!(service.get_settings().unwrap().atlas_visibility, "all");
    assert_eq!(saved.service_tier, ChatServiceTier::Flex);
    assert_eq!(
        service
            .get_settings()
            .expect("reload flex setting")
            .service_tier,
        ChatServiceTier::Flex
    );
}

#[test]
fn web_access_setting_defaults_to_auto_and_persists_per_vault() {
    let (_root, service) = service("chat-web-setting");
    let mut settings = service.get_settings().expect("load defaults");
    assert_eq!(settings.web_access, WebAccess::Auto);
    settings.web_access = WebAccess::Off;
    let defaults = ChatDefaults {
        provider: settings.provider,
        model: settings.model,
        openai_model: settings.openai_model,
        local_model: settings.local_model,
        local_base_url: settings.local_base_url,
        reasoning_effort: settings.reasoning_effort,
        service_tier: settings.service_tier,
        web_access: settings.web_access,
        default_access: settings.default_access,
    };
    let saved = service.set_defaults(defaults).expect("save web setting");
    assert_eq!(saved.web_access, WebAccess::Off);
    assert_eq!(
        service
            .get_settings()
            .expect("reload web setting")
            .web_access,
        WebAccess::Off
    );
}

#[test]
fn local_model_capabilities_are_persisted_per_model() {
    let (_root, service) = service("chat-local-model-capabilities");
    assert_eq!(
        service
            .local_model_capabilities("qwen/Qwen3.8-27B")
            .unwrap(),
        LocalModelCapabilitySelection::default()
    );
    let configured = LocalModelCapabilitySelection {
        images: true,
        tools: false,
        audio: true,
        video: true,
        reasoning_effort: "xhigh".to_string(),
    };
    service
        .set_local_model_capabilities("qwen/Qwen3.8-27B", configured.clone())
        .unwrap();
    assert_eq!(
        service
            .local_model_capabilities("qwen/Qwen3.8-27B")
            .unwrap(),
        configured
    );
    assert_eq!(
        service.local_model_capabilities("another-model").unwrap(),
        LocalModelCapabilitySelection::default()
    );
}

#[test]
fn new_vaults_default_to_full_but_legacy_limited_rows_migrate_to_approved() {
    let (root, service) = service("chat-access-migration");
    assert_eq!(
        service.get_settings().unwrap().default_access,
        VaultAccess::Full
    );
    service
        .connection()
        .unwrap()
        .execute(
            "UPDATE chat_settings SET default_access = 'limited' WHERE id = 1",
            [],
        )
        .unwrap();
    let conversation = service
        .create_conversation(None, Some(VaultAccess::Full))
        .unwrap();
    service
        .connection()
        .unwrap()
        .execute(
            "UPDATE chat_conversations SET access = 'limited' WHERE id = ?1",
            [&conversation.summary.id],
        )
        .unwrap();
    drop(service);

    let reopened =
        ChatService::new(root.path().to_path_buf(), root.path().join(".gneauxghts")).unwrap();
    assert_eq!(
        reopened.get_settings().unwrap().default_access,
        VaultAccess::Approved
    );
    assert_eq!(
        reopened
            .get_conversation(&conversation.summary.id)
            .unwrap()
            .summary
            .access,
        VaultAccess::Approved
    );
}

#[test]
fn draft_chat_configuration_is_applied_when_the_conversation_is_created() {
    let (_root, service) = service("chat-draft-configuration");

    let conversation = service
        .create_conversation_with_config(
            Some("Configured draft".to_string()),
            Some(VaultAccess::Full),
            Some("local".to_string()),
            Some("qwen3:8b".to_string()),
            Some("high".to_string()),
        )
        .unwrap();

    assert_eq!(conversation.summary.title, "Configured draft");
    assert_eq!(conversation.summary.access, VaultAccess::Full);
    assert_eq!(conversation.summary.provider, "local");
    assert_eq!(conversation.summary.model, "qwen3:8b");
    assert_eq!(conversation.summary.reasoning_effort, "high");
}

#[test]
fn reasoning_settings_accept_server_identifiers_and_reject_malformed_values() {
    assert_eq!(validate_reasoning_effort(" xhigh ").unwrap(), "xhigh");
    assert_eq!(validate_reasoning_effort("on").unwrap(), "on");
    assert_eq!(
        validate_reasoning_effort("future_level").unwrap(),
        "future_level"
    );
    assert!(validate_reasoning_effort("").is_err());
    assert!(validate_reasoning_effort("bad value").is_err());
    assert!(validate_reasoning_effort(&"a".repeat(65)).is_err());
}

#[test]
fn local_toggle_reasoning_survives_profile_conversation_and_reload() {
    let (_root, service) = service("chat-local-reasoning-toggle");
    let mut selection = LocalModelCapabilitySelection::default();
    selection.reasoning_effort = "on".into();
    service
        .set_local_model_capabilities("custom-model", selection)
        .unwrap();
    let conversation = service
        .create_conversation_with_config(
            None,
            None,
            Some("local".into()),
            Some("custom-model".into()),
            None,
        )
        .unwrap();
    assert_eq!(conversation.summary.reasoning_effort, "on");
    service
        .update_conversation_provider(&conversation.summary.id, "local", "custom-model", "off")
        .unwrap();
    assert_eq!(
        service
            .get_conversation(&conversation.summary.id)
            .unwrap()
            .summary
            .reasoning_effort,
        "off"
    );
}

#[test]
fn local_conversations_use_the_models_saved_reasoning_effort() {
    let (_root, service) = service("chat-local-model-reasoning");
    service
        .set_local_model_capabilities(
            "qwen/Qwen3.8-27B",
            LocalModelCapabilitySelection {
                reasoning_effort: "xhigh".to_string(),
                ..LocalModelCapabilitySelection::default()
            },
        )
        .unwrap();

    let conversation = service
        .create_conversation_with_config(
            None,
            None,
            Some("local".to_string()),
            Some("qwen/Qwen3.8-27B".to_string()),
            None,
        )
        .unwrap();

    assert_eq!(conversation.summary.reasoning_effort, "xhigh");
}

#[test]
fn conversation_model_changes_wait_for_the_active_run() {
    let (_root, service) = service("chat-model-change-boundary");
    let conversation = service.create_conversation(None, None).unwrap();
    let (run_id, _) = seed_agent_run(&service, &conversation.summary.id, "model", 1);

    let error = service
        .update_conversation_provider(&conversation.summary.id, "local", "qwen3:8b", "medium")
        .unwrap_err();
    assert!(error.contains("current response"));

    service
        .connection()
        .unwrap()
        .execute(
            "UPDATE chat_agent_runs SET status = 'completed' WHERE id = ?1",
            [&run_id],
        )
        .unwrap();
    let updated = service
        .update_conversation_provider(&conversation.summary.id, "local", "qwen3:8b", "high")
        .unwrap();
    assert_eq!(updated.summary.provider, "local");
    assert_eq!(updated.summary.model, "qwen3:8b");
    assert_eq!(updated.summary.reasoning_effort, "high");
}

#[test]
fn automatic_titles_remove_request_scaffolding_and_support_attachments() {
    assert_eq!(
        automatic_conversation_title("Hey, could you please help me plan a trip to Tokyo?", &[]),
        "Plan a trip to Tokyo"
    );
    assert_eq!(
        automatic_conversation_title("", &["quarterly-plan.pdf".to_string()]),
        "Discuss quarterly-plan"
    );
    assert!(
            automatic_conversation_title(
                "Compare the authentication architecture of these two applications and recommend improvements",
                &[]
            )
            .chars()
            .count()
                <= MAX_CONVERSATION_TITLE_CHARS
        );
    assert_eq!(
        normalize_generated_conversation_title("**Title: Tokyo Trip Planning**\n"),
        Some("Tokyo Trip Planning".to_string())
    );
}

#[test]
fn model_title_refinement_is_hosted_only() {
    assert!(supports_background_title_refinement("openai"));
    assert!(!supports_background_title_refinement("local"));
}

#[test]
fn startup_backfills_default_titles_without_replacing_named_conversations() {
    let (root, service) = service("chat-title-backfill");
    let unnamed = service.create_conversation(None, None).unwrap();
    let named = service
        .create_conversation(Some("Release planning".to_string()), None)
        .unwrap();
    let connection = service.connection().unwrap();
    connection
        .execute(
            "INSERT INTO chat_messages
                 (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                 VALUES ('unnamed-user', ?1, 1, 'user', 'complete',
                         'Could you investigate the login redirect bug?', 1, 1)",
            [&unnamed.summary.id],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO chat_messages
                 (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                 VALUES ('named-user', ?1, 1, 'user', 'complete',
                         'This text should not become the title', 1, 1)",
            [&named.summary.id],
        )
        .unwrap();
    drop(connection);
    drop(service);

    let reopened =
        ChatService::new(root.path().to_path_buf(), root.path().join(".gneauxghts")).unwrap();
    assert_eq!(
        reopened
            .get_conversation(&unnamed.summary.id)
            .unwrap()
            .summary
            .title,
        "Investigate the login redirect bug"
    );
    assert_eq!(
        reopened
            .get_conversation(&named.summary.id)
            .unwrap()
            .summary
            .title,
        "Release planning"
    );
}

#[test]
fn exclusion_overrides_full_and_approved_access_by_stable_id() {
    let (_root, service) = service("chat-exclusion-precedence");
    service.grant_note("stable-note", "Original title").unwrap();
    assert!(service
        .note_is_allowed(&VaultAccess::Approved, "stable-note")
        .unwrap());
    service
        .set_note_excluded("stable-note", "Renamed title", true)
        .unwrap();
    assert!(!service
        .note_is_allowed(&VaultAccess::Approved, "stable-note")
        .unwrap());
    assert!(!service
        .note_is_allowed(&VaultAccess::Full, "stable-note")
        .unwrap());
    assert!(service.excluded_note_ids().unwrap().contains("stable-note"));
}

#[test]
fn assistant_core_is_shared_and_disabled_tools_have_no_capability_supplement() {
    let hosted = agent_preamble(&crate::agent_runtime::AgentProvider::Openai, true);
    let local = agent_preamble(&crate::agent_runtime::AgentProvider::Local, true);
    assert_eq!(hosted, local);
    assert!(hosted.len() < 3200);
    assert!(hosted.contains("An open note is a clue"));
    assert!(hosted.contains("app-issued source IDs"));
    assert!(hosted.contains("only after the user accepts"));
    let disabled = agent_preamble(&crate::agent_runtime::AgentProvider::Local, false);
    assert!(disabled.contains("Tools are unavailable"));
    for instructions in [&hosted, &disabled] {
        assert!(!instructions.contains("taskDates"));
        assert!(!instructions.contains("statusMarkerChangedInPeriod"));
        assert!(!instructions.contains("propose_note_rewrite"));
    }
}

#[test]
fn web_sources_are_normalized_from_plain_and_markdown_urls() {
    let sources = web_sources_from_text(
        "See [OpenAI](https://openai.com/research) and https://example.com/news.",
    );
    assert_eq!(sources.len(), 2);
    assert_eq!(
        sources[0].url.as_deref(),
        Some("https://openai.com/research")
    );
    assert_eq!(sources[1].url.as_deref(), Some("https://example.com/news"));
}

#[test]
fn normalized_history_excludes_latest_user_and_provider_payloads() {
    let messages = vec![
        ChatMessage {
            saved_note: None,
            id: "m1".to_string(),
            conversation_id: "conversation".into(),
            ordinal: 1,
            role: "assistant".to_string(),
            status: "complete".to_string(),
            content: "- pizza\n- caprese salad".to_string(),
            error: None,
            part: 1,
            created_at_millis: 1,
            sources: Vec::new(),
            has_revision_evidence: false,
            note_reference_ids: vec![],
            attachments: Vec::new(),
            agent_events: Vec::new(),
        },
        ChatMessage {
            saved_note: None,
            id: "m2".to_string(),
            conversation_id: "conversation".into(),
            ordinal: 2,
            role: "user".to_string(),
            status: "complete".to_string(),
            content: "Add these meals to the end of the note".to_string(),
            error: None,
            part: 1,
            created_at_millis: 2,
            sources: Vec::new(),
            has_revision_evidence: false,
            note_reference_ids: vec![],
            attachments: Vec::new(),
            agent_events: Vec::new(),
        },
    ];
    let history = normalized_rig_history(&messages, "m2", None, |_| None)
        .unwrap()
        .messages;
    assert_eq!(history.len(), 1);
    assert!(matches!(
        history.first(),
        Some(rig_core::completion::Message::Assistant { .. })
    ));
}

#[test]
fn passage_citations_and_explicit_grants_survive_branching() {
    let (root, service) = service("chat-passage-branch");
    let conversation = service.create_conversation(None, None).unwrap();
    let (run, _, assistant) =
        seed_streaming_agent_run(&service, &conversation.summary.id, "passage", "");
    service.connection().unwrap().execute("INSERT INTO chat_agent_run_context (run_id,ordinal,note_id,note_path,title,excerpt,content_hash,reason) VALUES (?1,0,'note-current','Current.md','Current','current','hash','explicit')",[run]).unwrap();
    let passage = crate::services::evidence::PassageCitation {
        historical: None,
        id: "passage-1".into(),
        note_id: "note-current".into(),
        content_hash: "hash".into(),
        location: "body".into(),
        start: 0,
        end: 7,
        excerpt: "current".into(),
        revisions: vec![],
    };
    let sources = vec![ChatSource {
        kind: "passage".into(),
        note_id: Some("note-current".into()),
        note_path: Some("Current.md".into()),
        title: "Current".into(),
        excerpt: "current".into(),
        url: None,
        anchor: Some("passage-1".into()),
        revision: None,
        passage: Some(passage),
    }];
    let mut references = citations::PassageReferences::default();
    references.register("passage-1");
    let content = references.render("current [S1]", &sources);
    service
        .finish_message(&assistant, "complete", &content, None, &sources)
        .unwrap();
    drop(references);
    drop(service);
    let service =
        ChatService::new(root.path().to_path_buf(), root.path().join(".gneauxghts")).unwrap();
    let reopened = service.get_conversation(&conversation.summary.id).unwrap();
    assert_eq!(
        reopened.messages[1].content,
        "current [Source 1](passage:passage-1)"
    );
    assert!(service
        .source_run_grants(&assistant)
        .unwrap()
        .contains("note-current"));
    let branch = service.branch_from_message(&assistant).unwrap();
    let copied = &branch.messages[1];
    assert!(service
        .source_run_grants(&copied.id)
        .unwrap()
        .contains("note-current"));
    assert_eq!(copied.content, "current [Source 1](passage:passage-1)");
    assert_eq!(copied.sources[0].passage.as_ref().unwrap().id, "passage-1");
    assert!(!serde_json::to_string(
        &normalized_rig_history(&branch.messages, "next", None, |_| None)
            .unwrap()
            .messages
    )
    .unwrap()
    .contains("\"current\""));
}

#[test]
fn repeated_passage_admission_preserves_durable_proofs_after_plain_reads() {
    let _guard = crate::test_support::lock_test_env();
    let (root, service) = service("chat-proof-admission");
    crate::state::initialize_app_data_dir(root.path().join("app-data")).unwrap();
    crate::state::set_notes_root_override(Some(root.path().to_path_buf())).unwrap();
    let state = crate::index::AppState::new(
        crate::semantic::SemanticState::new_disabled("test"),
        crate::app::EventBus::disabled(),
    )
    .unwrap();
    let note = crate::commands::note_persistence::persist_note_session_with_outcome(
        &state,
        "Proof note".into(),
        "Recorded delivery evidence.".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let mut evidence = crate::services::evidence::EvidenceSession::default();
    let page = evidence
        .search(
            &state,
            None,
            &HashSet::new(),
            crate::services::evidence::SearchRequest {
                query: "Recorded delivery evidence.".into(),
                mode: crate::services::evidence::SearchMode::Literal,
                ..Default::default()
            },
        )
        .unwrap();
    let id = page["items"][0]["evidenceId"].as_str().unwrap().to_string();
    let mut sources = Vec::new();
    let mut proofs = Vec::new();
    for provenance in [false, true, true, false] {
        let (_, read) = evidence
            .read(&state, None, &HashSet::new(), &[id.clone()], provenance)
            .unwrap();
        for (citation, path, title) in read {
            for proof in &citation.revisions {
                if !proofs.contains(proof) {
                    proofs.push(proof.clone());
                }
            }
            citations::admit_passage(
                &mut sources,
                citation,
                path.to_string_lossy().into_owned(),
                title,
            );
        }
    }
    assert!(!proofs.is_empty());
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].passage.as_ref().unwrap().revisions, proofs);
    let conversation = service.create_conversation(None, None).unwrap();
    let (_, _, assistant) =
        seed_streaming_agent_run(&service, &conversation.summary.id, "proofs", "");
    service
        .finish_message(
            &assistant,
            "complete",
            "Recorded delivery evidence.",
            None,
            &sources,
        )
        .unwrap();
    drop(service);
    let reopened =
        ChatService::new(root.path().to_path_buf(), root.path().join(".gneauxghts")).unwrap();
    let mut persisted = reopened
        .get_conversation(&conversation.summary.id)
        .unwrap()
        .messages[1]
        .sources
        .clone();
    assert_eq!(persisted[0].passage.as_ref().unwrap().revisions, proofs);
    crate::agent_tools::filter_revision_sources(
        &state,
        &reopened,
        &VaultAccess::Full,
        &HashSet::new(),
        &mut persisted,
    )
    .unwrap();
    assert_eq!(persisted.len(), 1);
    state
        .note_timeline()
        .clear_note_history(&crate::services::note_timeline::NoteIdentity::new(
            note.note_id.unwrap(),
        ))
        .unwrap();
    crate::agent_tools::filter_revision_sources(
        &state,
        &reopened,
        &VaultAccess::Full,
        &HashSet::new(),
        &mut persisted,
    )
    .unwrap();
    assert!(
        persisted.is_empty(),
        "Cleared temporal proof must invalidate the durable source"
    );
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn recent_history_preserves_requirements_until_explicit_context_admission() {
    let (_root, service) = service("chat-complete-recent-history");
    let conversation = service.create_conversation(None, None).unwrap();
    let question = format!("{} Keep the final table in French.", "背景 ".repeat(900));
    let reply = format!(
        "{} Preserve the agreed column order.",
        "Detailed discussion. ".repeat(180)
    );
    let (_, user, assistant) =
        seed_streaming_agent_run(&service, &conversation.summary.id, "long-history", "");
    service
        .connection()
        .unwrap()
        .execute(
            "UPDATE chat_messages SET content=?1 WHERE id=?2",
            params![question, user],
        )
        .unwrap();
    service
        .finish_message(&assistant, "complete", &reply, None, &[])
        .unwrap();
    let current = service.get_conversation(&conversation.summary.id).unwrap();
    let history = normalized_rig_history(&current.messages, "follow-up", None, |_| None)
        .unwrap()
        .messages;
    let serialized = serde_json::to_string(&history).unwrap();
    assert!(
        serialized.contains(&question),
        "Prior user requirements were clipped"
    );
    assert!(
        serialized.contains(&reply),
        "Source-free dialogue was clipped"
    );
    let guard = crate::agent_guardrails::AgentRunGuard::new(Default::default());
    assert!(guard.check_context_bytes(serialized.len()).is_ok());
    let limited =
        crate::agent_guardrails::AgentRunGuard::new(crate::agent_guardrails::AgentRunLimits {
            max_context_bytes: 2_000,
            ..Default::default()
        });
    assert_eq!(
        limited
            .check_context_bytes(serialized.len())
            .unwrap_err()
            .reason,
        "contextBudgetExceeded"
    );
}

#[test]
fn revision_answers_do_not_replay_removed_prose_through_history_or_compaction() {
    let (_root, service) = service("chat-revision-context");
    let conversation = service.create_conversation(None, None).unwrap();
    let (_, _, assistant) =
        seed_streaming_agent_run(&service, &conversation.summary.id, "history", "");
    let citation = crate::services::note_timeline::RevisionCitation {
        note_id: "note-current".into(),
        revision_id: "revision-old".into(),
        at_millis: 15,
        time_evidence: Some(
            crate::services::note_timeline::RevisionTimeEvidence::EditingWindow {
                version: 1,
                first_wall_millis: 10,
                last_wall_millis: 15,
                min_wall_millis: 10,
                max_wall_millis: 15,
                clock_discontinuity: false,
            },
        ),
        source: crate::services::note_timeline::MutationSource::Editor,
        current_excerpt: "once-current secret".into(),
    };
    service
        .finish_message(
            &assistant,
            "complete",
            "once-current secret",
            None,
            &[ChatSource {
                kind: "revision".into(),
                note_id: Some(citation.note_id.clone()),
                note_path: Some("Current.md".into()),
                title: "Current".into(),
                excerpt: citation.current_excerpt.clone(),
                url: None,
                anchor: Some(citation.revision_id.clone()),
                revision: Some(citation),
                passage: None,
            }],
        )
        .unwrap();
    let reloaded = service.get_conversation(&conversation.summary.id).unwrap();
    assert_eq!(
        reloaded.messages[1].sources[0]
            .revision
            .as_ref()
            .unwrap()
            .revision_id,
        "revision-old"
    );
    let branched = service.branch_from_message(&assistant).unwrap();
    assert_eq!(
        serde_json::to_value(&branched.messages[1].sources[0].revision).unwrap(),
        serde_json::to_value(&reloaded.messages[1].sources[0].revision).unwrap()
    );
    let history = normalized_rig_history(&reloaded.messages, "next-user", None, |_| None)
        .unwrap()
        .messages;
    assert!(!serde_json::to_string(&history)
        .unwrap()
        .contains("once-current secret"));
    // Exclusion hides source cards, but must not erase the context-safety marker.
    service
        .set_note_excluded("note-current", "Current", true)
        .unwrap();
    let excluded = service.get_conversation(&conversation.summary.id).unwrap();
    assert!(excluded.messages[1].sources.is_empty());
    let branch = service.branch_from_message(&assistant).unwrap();
    assert!(!serde_json::to_string(
        &normalized_rig_history(&branch.messages, "next-user", None, |_| None)
            .unwrap()
            .messages
    )
    .unwrap()
    .contains("once-current secret"));
    let connection = service.connection().unwrap();
    for ordinal in 3..=22 {
        connection.execute("INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis) VALUES (?1, ?2, ?3, 'user', 'complete', 'later question', 1, 1)", params![format!("later-{ordinal}"), conversation.summary.id, ordinal]).unwrap();
    }
    drop(connection);
    service
        .refresh_continuation_summary(&conversation.summary.id)
        .unwrap();
    assert!(!service
        .context_compaction(&conversation.summary.id)
        .unwrap()
        .unwrap()
        .summary
        .contains("once-current secret"));
    let history = normalized_rig_history(&excluded.messages, "next-user", None, |_| None)
        .unwrap()
        .messages;
    assert!(!serde_json::to_string(&history)
        .unwrap()
        .contains("once-current secret"));
}

#[test]
fn durable_compaction_covers_the_entire_older_transcript_and_is_reused() {
    let (_root, service) = service("chat-durable-compaction");
    let conversation = service.create_conversation(None, None).unwrap();
    let connection = service.connection().unwrap();
    for ordinal in 1..=20i64 {
        let id = format!("message-{ordinal}");
        let role = if ordinal % 2 == 0 {
            "assistant"
        } else {
            "user"
        };
        connection
            .execute(
                "INSERT INTO chat_messages
                     (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                     VALUES (?1, ?2, ?3, ?4, 'complete', ?5, 1, ?3)",
                params![
                    id,
                    conversation.summary.id,
                    ordinal,
                    role,
                    format!("message content {ordinal}")
                ],
            )
            .unwrap();
    }
    drop(connection);

    service
        .refresh_continuation_summary(&conversation.summary.id)
        .unwrap();
    let compaction = service
        .context_compaction(&conversation.summary.id)
        .unwrap()
        .expect("durable compaction");
    assert_eq!(compaction.through_ordinal, 4);
    assert!(compaction.summary.contains("message content 1"));
    assert!(compaction.summary.contains("message content 4")); // Source-free dialogue remains usable.

    let reloaded = service.get_conversation(&conversation.summary.id).unwrap();
    let history =
        normalized_rig_history(&reloaded.messages, "message-20", Some(&compaction), |_| {
            None
        })
        .unwrap()
        .messages;
    assert_eq!(history.len(), 16);
    assert!(matches!(
        history.first(),
        Some(rig_core::completion::Message::System { .. })
    ));
}

#[test]
fn terminal_reasons_are_stable_product_values() {
    assert_eq!(
        terminal_reason_from_error("The agent stopped after reaching its time limit."),
        "timeBudgetExceeded"
    );
    assert_eq!(
        terminal_reason_from_error(
            "The agent stopped because it repeated read_note with the same input.",
        ),
        "repeatedToolCall"
    );
    assert_eq!(
        terminal_reason_from_error("provider failed"),
        "runtimeError"
    );
}

#[test]
fn attachment_validation_builds_typed_image_and_document_content() {
    let attachments = validate_attachments(vec![
        ChatAttachmentInput {
            kind: "image".to_string(),
            name: "shot.png".to_string(),
            mime_type: "image/png".to_string(),
            size_bytes: 4,
            data_base64: BASE64_STANDARD.encode([137, 80, 78, 71]),
        },
        ChatAttachmentInput {
            kind: "file".to_string(),
            name: "notes.txt".to_string(),
            mime_type: "text/plain".to_string(),
            size_bytes: 5,
            data_base64: BASE64_STANDARD.encode("hello"),
        },
    ])
    .unwrap();

    let message = rig_user_message("Describe these".to_string(), &attachments).unwrap();
    let rig_core::completion::Message::User { content } = message else {
        panic!("expected a user message");
    };
    assert!(content
        .iter()
        .any(|item| matches!(item, rig_core::message::UserContent::Image(_))));
    assert!(content
        .iter()
        .any(|item| matches!(item, rig_core::message::UserContent::Document(_))));
}

#[test]
fn attachment_validation_rejects_spoofed_sizes_and_binary_text() {
    let spoofed = ChatAttachmentInput {
        kind: "file".to_string(),
        name: "notes.txt".to_string(),
        mime_type: "text/plain".to_string(),
        size_bytes: 99,
        data_base64: BASE64_STANDARD.encode("hello"),
    };
    assert!(validate_attachments(vec![spoofed]).is_err());

    let binary = ChatAttachmentInput {
        kind: "file".to_string(),
        name: "notes.txt".to_string(),
        mime_type: "text/plain".to_string(),
        size_bytes: 2,
        data_base64: BASE64_STANDARD.encode([0xff, 0xfe]),
    };
    assert!(validate_attachments(vec![binary]).is_err());
}

#[test]
fn durable_proposals_supersede_the_same_target_across_runs() {
    let (_root, service) = service("chat-durable-proposals");
    let conversation = service.create_conversation(None, None).unwrap();
    let (first_run, first_assistant) = seed_agent_run(&service, &conversation.summary.id, "one", 1);
    let first = service
        .stage_agent_proposal(
            &first_run,
            &conversation.summary.id,
            &first_assistant,
            "update",
            Some("note-1"),
            None,
            "Plan",
            Some("hash-1"),
            &json!({"edits":[]}),
            &json!({"proposedEditorMarkdown":"one"}),
        )
        .unwrap();
    let replacement = service
        .stage_agent_proposal(
            &first_run,
            &conversation.summary.id,
            &first_assistant,
            "update",
            Some("note-1"),
            None,
            "Plan",
            Some("hash-1"),
            &json!({"edits":[]}),
            &json!({"proposedEditorMarkdown":"two"}),
        )
        .unwrap();
    assert_eq!(
        service.get_agent_proposal(&first.id).unwrap().status,
        "superseded"
    );
    assert_eq!(replacement.status, "pending");

    let (later_run, later_assistant) = seed_agent_run(&service, &conversation.summary.id, "two", 3);
    let folded = service
        .stage_agent_proposal(
            &later_run,
            &conversation.summary.id,
            &later_assistant,
            "update",
            Some("note-1"),
            None,
            "Plan",
            Some("hash-1"),
            &json!({"edits":[]}),
            &json!({"proposedEditorMarkdown":"three"}),
        )
        .unwrap();
    assert_eq!(
        service.get_agent_proposal(&replacement.id).unwrap().status,
        "superseded"
    );
    assert_eq!(folded.status, "pending");
    assert_eq!(folded.run_id, Some(later_run));
    assert_eq!(
        service
            .pending_agent_proposal_for_note("note-1")
            .unwrap()
            .map(|proposal| proposal.id),
        Some(folded.id.clone())
    );
    assert_eq!(
        service
            .list_pending_agent_proposals(&conversation.summary.id)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        service
            .resolve_agent_proposal(&folded.id, "conflict")
            .unwrap()
            .status,
        "conflict"
    );
    assert_eq!(
        service
            .resolve_agent_proposal(&folded.id, "dismissed")
            .unwrap()
            .status,
        "dismissed"
    );
}

#[test]
fn proposal_command_returns_published_editor_text_after_title_normalization() {
    let fixture = crate::test_support::TestVault::new("proposal-normalized-receipt");
    let service = ChatService::new(
        fixture.notes.path().to_path_buf(),
        fixture.notes.path().join(".gneauxghts"),
    )
    .unwrap();
    let conversation = service
        .create_conversation(None, Some(VaultAccess::Full))
        .unwrap();
    let path = fixture.notes.path().join("Plan.md");
    let original = fixture
        .state
        .note_timeline()
        .create_note_at(
            crate::services::note_timeline::MutationSource::Editor,
            &path,
            "Old body",
        )
        .unwrap()
        .unwrap();
    let submitted = "# Plan\n\nSee [[Details]]";
    let preview = crate::proposals::preview_note_rewrite(
        fixture.notes.path(),
        &path.to_string_lossy(),
        submitted,
    )
    .unwrap();
    let (run_id, assistant_id) =
        seed_agent_run(&service, &conversation.summary.id, "normalized", 1);
    let proposal = service
        .stage_agent_proposal(
            &run_id,
            &conversation.summary.id,
            &assistant_id,
            "update",
            Some(original.note_id().as_str()),
            None,
            "Plan",
            Some(&preview.base_content_hash),
            &json!({"title": "Plan", "markdown": submitted}),
            &serde_json::to_value(&preview).unwrap(),
        )
        .unwrap();
    let result = crate::commands::proposal_commands::commit_agent_proposal_with_state(
        &fixture.state,
        &service,
        proposal.id.clone(),
        Some(submitted.into()),
    )
    .unwrap();
    assert_eq!(result.status, "committed");
    assert_eq!(
        result.committed_markdown.as_deref(),
        Some("See [[Details]]")
    );
    let reread = crate::commands::read_note_session_from_path(&path).unwrap();
    assert_eq!(
        result.committed_markdown.as_deref(),
        Some(reread.markdown.as_str())
    );
    assert_eq!(
        service.get_agent_proposal(&proposal.id).unwrap().status,
        "committed"
    );
}

#[test]
fn proposal_commit_intent_converges_to_committed_after_success() {
    let fixture = crate::test_support::TestVault::new("chat-proposal-commit-success");
    let root = &fixture.notes;
    let service =
        ChatService::new(root.path().to_path_buf(), root.path().join(".gneauxghts")).unwrap();
    let path = root.path().join("Plan.md");
    let original = "# Plan\n\nOld body";
    fs::write(&path, original).unwrap();
    let proposal =
        stage_test_proposal(&service, "update", Some("note-1"), None, "Plan", "New body");
    let plan = crate::proposals::plan_agent_update_commit(
        root.path(),
        &path.to_string_lossy(),
        "New body",
    )
    .unwrap();

    let intent = service
        .begin_agent_proposal_commit(
            &proposal.id,
            &plan.target_path,
            &plan.intended_editor_content_hash,
        )
        .unwrap();
    assert_eq!(
        service.get_agent_proposal(&proposal.id).unwrap().status,
        "committing"
    );
    let result = fixture
        .state
        .note_timeline()
        .edit_note(
            crate::services::note_timeline::MutationSource::AcceptedChatProposal,
            &intent.target_path,
            None,
            |current| {
                assert_eq!(content_hash(current), content_hash(original));
                Ok("New body".to_string())
            },
        )
        .unwrap();
    assert!(result.warning().is_none());

    let resolved = service
        .finish_agent_proposal_commit(&proposal.id, "committed")
        .unwrap();
    assert_eq!(resolved.status, "committed");
}

#[test]
fn startup_recovers_canonical_write_after_status_update_was_missed() {
    let fixture = crate::test_support::TestVault::new("chat-proposal-startup-recovery");
    let root = &fixture.notes;
    let service =
        ChatService::new(root.path().to_path_buf(), root.path().join(".gneauxghts")).unwrap();
    let data = root.path().join(".gneauxghts");
    let path = root.path().join("Plan.md");
    let original = "# Plan\n\nOld body";
    fs::write(&path, original).unwrap();
    let proposal = stage_test_proposal(
        &service,
        "update",
        Some("note-1"),
        None,
        "Plan",
        "\n\nRecovered body",
    );
    let plan = crate::proposals::plan_agent_update_commit(
        root.path(),
        &path.to_string_lossy(),
        "\n\nRecovered body",
    )
    .unwrap();
    let intent = service
        .begin_agent_proposal_commit(
            &proposal.id,
            &plan.target_path,
            &plan.intended_editor_content_hash,
        )
        .unwrap();
    fixture
        .state
        .note_timeline()
        .edit_note(
            crate::services::note_timeline::MutationSource::AcceptedChatProposal,
            &intent.target_path,
            None,
            |current| {
                assert_eq!(content_hash(current), content_hash(original));
                Ok("\n\nRecovered body".to_string())
            },
        )
        .unwrap();
    drop(service);

    let reopened = ChatService::new(root.path().to_path_buf(), data).unwrap();
    assert_eq!(
        reopened.get_agent_proposal(&proposal.id).unwrap().status,
        "committed"
    );
}

#[test]
fn explicit_recovery_converges_after_status_write_failure() {
    let fixture = crate::test_support::TestVault::new("chat-proposal-status-write-recovery");
    let root = &fixture.notes;
    let service =
        ChatService::new(root.path().to_path_buf(), root.path().join(".gneauxghts")).unwrap();
    let path = root.path().join("Plan.md");
    let original = "# Plan\n\nOld body";
    fs::write(&path, original).unwrap();
    let proposal = stage_test_proposal(
        &service,
        "update",
        Some("note-1"),
        None,
        "Plan",
        "Recovered body",
    );
    let plan = crate::proposals::plan_agent_update_commit(
        root.path(),
        &path.to_string_lossy(),
        "Recovered body",
    )
    .unwrap();
    let intent = service
        .begin_agent_proposal_commit(
            &proposal.id,
            &plan.target_path,
            &plan.intended_editor_content_hash,
        )
        .unwrap();
    fixture
        .state
        .note_timeline()
        .edit_note(
            crate::services::note_timeline::MutationSource::AcceptedChatProposal,
            &intent.target_path,
            None,
            |current| {
                assert_eq!(content_hash(current), content_hash(original));
                Ok("Recovered body".to_string())
            },
        )
        .unwrap();
    service
        .connection()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER fail_proposal_commit_status
                 BEFORE UPDATE OF status ON chat_agent_proposals
                 WHEN NEW.status = 'committed'
                 BEGIN
                   SELECT RAISE(FAIL, 'injected status write failure');
                 END;",
        )
        .unwrap();
    assert!(service
        .finish_agent_proposal_commit(&proposal.id, "committed")
        .is_err());
    assert_eq!(
        service.get_agent_proposal(&proposal.id).unwrap().status,
        "committing"
    );
    service
        .connection()
        .unwrap()
        .execute("DROP TRIGGER fail_proposal_commit_status", [])
        .unwrap();

    assert!(service.recover_agent_proposal_commit(&proposal.id).unwrap());
    assert_eq!(
        service.get_agent_proposal(&proposal.id).unwrap().status,
        "committed"
    );
}

#[test]
fn mismatched_commit_target_recovers_as_conflict_without_reapplying() {
    let (root, service) = service("chat-proposal-mismatch-recovery");
    let path = root.path().join("Plan.md");
    fs::write(&path, "# Plan\n\nExisting body").unwrap();
    let proposal = stage_test_proposal(
        &service,
        "update",
        Some("note-1"),
        None,
        "Plan",
        "Intended body",
    );
    let plan = crate::proposals::plan_agent_update_commit(
        root.path(),
        &path.to_string_lossy(),
        "Intended body",
    )
    .unwrap();
    service
        .begin_agent_proposal_commit(
            &proposal.id,
            &plan.target_path,
            &plan.intended_editor_content_hash,
        )
        .unwrap();

    assert_eq!(service.recover_agent_proposal_commits().unwrap(), 1);
    assert_eq!(
        service.get_agent_proposal(&proposal.id).unwrap().status,
        "conflict"
    );
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "# Plan\n\nExisting body"
    );
}

#[test]
fn fixed_creation_target_collision_becomes_conflict_without_new_path() {
    let fixture = crate::test_support::TestVault::new("chat-proposal-create-collision");
    let root = &fixture.notes;
    let service =
        ChatService::new(root.path().to_path_buf(), root.path().join(".gneauxghts")).unwrap();
    let target = root.path().join("Created.md");
    let proposal = stage_test_proposal(
        &service,
        "create",
        None,
        Some(&target),
        "Created",
        "Intended body",
    );
    let plan = crate::proposals::plan_agent_creation_commit(
        root.path(),
        &target.to_string_lossy(),
        "Intended body",
    )
    .unwrap();
    let intent = service
        .begin_agent_proposal_commit(
            &proposal.id,
            &plan.target_path,
            &plan.intended_editor_content_hash,
        )
        .unwrap();
    fs::write(&target, "Occupying note").unwrap();

    let result = fixture
        .state
        .note_timeline()
        .create_note_at(
            crate::services::note_timeline::MutationSource::AcceptedChatProposal,
            &intent.target_path,
            "Intended body",
        )
        .unwrap();
    assert!(result.is_none());
    service
        .finish_agent_proposal_commit(&proposal.id, "conflict")
        .unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "Occupying note");
    assert!(!root.path().join("Created 2.md").exists());
}

#[test]
fn proposal_commit_recovery_is_idempotent() {
    let (root, service) = service("chat-proposal-recovery-idempotent");
    let target = root.path().join("Missing.md");
    let proposal = stage_test_proposal(
        &service,
        "create",
        None,
        Some(&target),
        "Missing",
        "Intended body",
    );
    let plan = crate::proposals::plan_agent_creation_commit(
        root.path(),
        &target.to_string_lossy(),
        "Intended body",
    )
    .unwrap();
    service
        .begin_agent_proposal_commit(
            &proposal.id,
            &plan.target_path,
            &plan.intended_editor_content_hash,
        )
        .unwrap();

    assert_eq!(service.recover_agent_proposal_commits().unwrap(), 1);
    assert_eq!(service.recover_agent_proposal_commits().unwrap(), 0);
    assert_eq!(
        service.get_agent_proposal(&proposal.id).unwrap().status,
        "conflict"
    );
}

#[test]
fn proposal_commit_intent_columns_migrate_existing_database() {
    let root = TestDir::new("chat-proposal-intent-migration");
    let data = root.path().join(".gneauxghts");
    fs::create_dir_all(&data).unwrap();
    let db_path = data.join("ai.sqlite3");
    Connection::open(&db_path)
        .unwrap()
        .execute_batch(
            "CREATE TABLE chat_agent_proposals (
                   id TEXT PRIMARY KEY,
                   run_id TEXT NOT NULL,
                   conversation_id TEXT NOT NULL,
                   assistant_message_id TEXT NOT NULL,
                   kind TEXT NOT NULL,
                   note_id TEXT,
                   suggested_path TEXT,
                   title TEXT NOT NULL,
                   base_hash TEXT,
                   payload_json TEXT NOT NULL,
                   preview_json TEXT NOT NULL,
                   status TEXT NOT NULL DEFAULT 'pending',
                   superseded_by TEXT,
                   created_at_millis INTEGER NOT NULL,
                   updated_at_millis INTEGER NOT NULL
                 );
                 CREATE TABLE chat_agent_runs (
                   id TEXT PRIMARY KEY,
                   conversation_id TEXT NOT NULL,
                   user_message_id TEXT NOT NULL,
                   assistant_message_id TEXT NOT NULL,
                   retry_of_message_id TEXT,
                   provider TEXT NOT NULL,
                   model TEXT NOT NULL,
                   force_web_search INTEGER NOT NULL DEFAULT 0,
                   active_note_json TEXT,
                   status TEXT NOT NULL,
                   input_tokens INTEGER NOT NULL DEFAULT 0,
                   output_tokens INTEGER NOT NULL DEFAULT 0,
                   created_at_millis INTEGER NOT NULL,
                   updated_at_millis INTEGER NOT NULL
                 );",
        )
        .unwrap();

    let service = ChatService::new(root.path().to_path_buf(), data).unwrap();
    let connection = service.connection().unwrap();
    let mut statement = connection
        .prepare("PRAGMA table_info(chat_agent_proposals)")
        .unwrap();
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<Result<HashSet<_>, _>>()
        .unwrap();
    assert!(columns.contains("commit_target_path"));
    assert!(columns.contains("intended_editor_content_hash"));

    let mut statement = connection
        .prepare("PRAGMA table_info(chat_agent_runs)")
        .unwrap();
    let run_columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<Result<HashSet<_>, _>>()
        .unwrap();
    assert!(run_columns.contains("terminal_reason"));
    assert!(run_columns.contains("model_call_count"));
    assert!(run_columns.contains("tool_call_count"));
    assert!(run_columns.contains("elapsed_millis"));
}

#[test]
fn newly_excluded_notes_disappear_from_historical_citations() {
    let (_root, service) = service("chat-excluded-citations");
    let conversation = service.create_conversation(None, None).unwrap();
    let connection = service.connection().unwrap();
    connection
        .execute(
            "INSERT INTO chat_messages
                 (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                 VALUES ('assistant-source', ?1, 1, 'assistant', 'complete', 'Answer', 1, 1)",
            [&conversation.summary.id],
        )
        .unwrap();
    connection
            .execute(
                "INSERT INTO chat_sources
                 (message_id, kind, note_id, note_path, title, excerpt)
                 VALUES ('assistant-source', 'note', 'note-private', 'Private.md', 'Private', 'secret')",
                [],
            )
            .unwrap();
    drop(connection);
    assert_eq!(
        service
            .get_conversation(&conversation.summary.id)
            .unwrap()
            .messages[0]
            .sources
            .len(),
        1
    );

    service
        .set_note_excluded("note-private", "Private", true)
        .unwrap();
    assert!(service
        .get_conversation(&conversation.summary.id)
        .unwrap()
        .messages[0]
        .sources
        .is_empty());
}

#[test]
fn conversations_persist_and_project_as_read_only_parts() {
    let (_root, service) = service("chat-persist");
    let conversation = service
        .create_conversation(Some("Planning".into()), None)
        .unwrap();
    let loaded = service.get_conversation(&conversation.summary.id).unwrap();
    assert_eq!(loaded.summary.title, "Planning");
    let stored_mode: String = service
        .connection()
        .unwrap()
        .query_row(
            "SELECT mode FROM chat_conversations WHERE id = ?1",
            [&conversation.summary.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored_mode, "auto");
    let paths = service
        .connection()
        .unwrap()
        .prepare("SELECT path FROM chat_projection_files")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(paths.iter().any(|path| path.ends_with("Conversation.md")));
}

#[test]
fn projection_observation_waits_for_own_publication_before_classifying_conflict() {
    use std::{sync::mpsc, time::Duration};
    struct PausedSink {
        written: mpsc::Sender<()>,
        resume: Mutex<mpsc::Receiver<()>>,
    }
    impl ChatProjectionSink for PausedSink {
        fn publish(&self, path: &Path, markdown: &str) -> Result<bool, String> {
            let changed =
                FilesystemChatProjectionSink { app_handle: None }.publish(path, markdown)?;
            if changed && path.file_name().is_some_and(|name| name == "Part 001.md") {
                self.written.send(()).unwrap();
                self.resume.lock().unwrap().recv().unwrap();
            }
            Ok(changed)
        }
    }
    let (_root, mut service) = service("chat-projection-publication-observation");
    let conversation = service
        .create_conversation(Some("Publication".into()), None)
        .unwrap();
    let id = conversation.summary.id;
    service.connection().unwrap().execute(
            "INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis) VALUES ('m1', ?1, 1, 'user', 'complete', 'first', 1, 1)", [&id]
        ).unwrap();
    service.write_projection(&id, false).unwrap();
    service
        .connection()
        .unwrap()
        .execute(
            "UPDATE chat_messages SET content = 'second' WHERE id = 'm1'",
            [],
        )
        .unwrap();
    let (written, arrived) = mpsc::channel();
    let (resume, resumed) = mpsc::channel();
    Arc::get_mut(&mut service.inner).unwrap().projection_sink = Arc::new(PausedSink {
        written,
        resume: Mutex::new(resumed),
    });
    let writer = service.clone();
    let writer_id = id.clone();
    let publication = std::thread::spawn(move || writer.write_projection(&writer_id, false));
    arrived.recv_timeout(Duration::from_secs(5)).unwrap();
    let observer = service.clone();
    let observed_id = id.clone();
    let (finished, result) = mpsc::channel();
    let observation = std::thread::spawn(move || {
        finished
            .send(observer.mark_projection_detached_if_needed(&observed_id))
            .unwrap()
    });
    let early = result.recv_timeout(Duration::from_millis(100));
    resume.send(()).unwrap();
    publication.join().unwrap().unwrap();
    observation.join().unwrap();
    let detached = early.unwrap_or_else(|_| result.recv().unwrap()).unwrap();
    assert!(
        !detached,
        "Own published bytes were compared against the previous receipt"
    );
    assert!(!service.get_conversation(&id).unwrap().summary.detached);
    let path = PathBuf::from(service.get_conversation(&id).unwrap().projection_path);
    fs::write(path, "external edit after publication").unwrap();
    assert!(
        service.mark_projection_detached_if_needed(&id).unwrap(),
        "Real external edits must still detach"
    );
}

#[test]
fn adding_a_message_to_an_existing_part_does_not_rewrite_conversation_index() {
    let (_root, mut service) = service("chat-projection-index-stable");
    #[derive(Default)]
    struct RecordingSink(Mutex<Vec<PathBuf>>);
    impl ChatProjectionSink for RecordingSink {
        fn publish(&self, path: &Path, markdown: &str) -> Result<bool, String> {
            let changed =
                FilesystemChatProjectionSink { app_handle: None }.publish(path, markdown)?;
            if changed {
                self.0.lock().unwrap().push(path.to_path_buf());
            }
            Ok(changed)
        }
    }
    let writes = Arc::new(RecordingSink::default());
    Arc::get_mut(&mut service.inner).unwrap().projection_sink = writes.clone();
    let conversation = service
        .create_conversation(Some("Stable".into()), None)
        .unwrap();
    let connection = service.connection().unwrap();
    connection.execute(
            "INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
             VALUES ('m1', ?1, 1, 'user', 'complete', 'first', 1, 1)",
            [&conversation.summary.id],
        ).unwrap();
    drop(connection);
    service
        .write_projection(&conversation.summary.id, false)
        .unwrap();
    let index_path = PathBuf::from(
        service
            .get_conversation(&conversation.summary.id)
            .unwrap()
            .projection_path,
    );
    writes.0.lock().unwrap().clear();
    service.connection().unwrap().execute(
            "INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
             VALUES ('m2', ?1, 2, 'assistant', 'complete', 'second', 1, 2)",
            [&conversation.summary.id],
        ).unwrap();
    service
        .write_projection(&conversation.summary.id, false)
        .unwrap();
    let changed = writes.0.lock().unwrap();
    assert!(!changed.contains(&index_path));
    assert!(changed
        .iter()
        .any(|path| path.file_name().unwrap() == "Part 001.md"));
}

#[test]
fn projection_owner_lookup_returns_the_conversation_for_a_managed_path() {
    let (_root, service) = service("chat-projection-owner");
    let conversation = service
        .create_conversation(Some("Owner".into()), None)
        .unwrap();
    let projection_path = PathBuf::from(
        service
            .get_conversation(&conversation.summary.id)
            .unwrap()
            .projection_path,
    );

    assert_eq!(
        service
            .projection_owner_for_path(&projection_path)
            .unwrap()
            .as_deref(),
        Some(conversation.summary.id.as_str())
    );
    assert_eq!(
        service
            .projection_owner_for_path(&service.notes_root().join("missing.md"))
            .unwrap(),
        None
    );
}

#[test]
fn excerpt_requires_valid_utf8_boundaries_and_remember_is_explicit() {
    let (_root, service) = service("chat-excerpt");
    let conversation = service.create_conversation(None, None).unwrap();
    let connection = service.connection().unwrap();
    connection.execute("INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis) VALUES ('m1', ?1, 1, 'assistant', 'complete', 'hello 😀 world', 1, 1)", [&conversation.summary.id]).unwrap();
    let excerpt = service
        .create_excerpt(&conversation.summary.id, "m1", 0, 5)
        .unwrap();
    for (start, end) in [(7, 10), (6, 8), (10, 6), (0, 100)] {
        assert!(service
            .create_excerpt(&conversation.summary.id, "m1", start, end)
            .is_err());
    }
    assert_eq!(
        service
            .create_excerpt(&conversation.summary.id, "m1", 6, 10)
            .unwrap()
            .quote,
        "😀"
    );
    assert!(!excerpt.remembered);
    assert!(
        service
            .set_excerpt_remembered(&excerpt.id, true)
            .unwrap()
            .remembered
    );
}

#[test]
fn excerpt_accepts_text_selected_from_rendered_markdown() {
    let (_root, service) = service("chat-rendered-excerpt");
    let conversation = service.create_conversation(None, None).unwrap();
    let connection = service.connection().unwrap();
    connection
            .execute(
                "INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis) VALUES ('m1', ?1, 1, 'assistant', 'complete', 'This is **bold** and [linked text](https://example.com).', 1, 1)",
                [&conversation.summary.id],
            )
            .unwrap();

    let excerpt = service
        .create_excerpt_from_selection(&conversation.summary.id, "m1", "bold and linked text", None)
        .unwrap();

    assert_eq!(excerpt.quote, "bold and linked text");
    assert_eq!((excerpt.start_offset, excerpt.end_offset), (0, 0));
}

#[test]
fn part_rollover_is_bounded() {
    let (_root, service) = service("chat-rollover");
    let conversation = service.create_conversation(None, None).unwrap();
    let connection = service.connection().unwrap();
    for ordinal in 1..=MAX_PART_MESSAGES {
        connection.execute("INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis) VALUES (?1, ?2, ?3, 'user', 'complete', 'x', 1, 1)", params![format!("m{ordinal}"), conversation.summary.id, ordinal]).unwrap();
    }
    assert_eq!(
        choose_part(&connection, &conversation.summary.id).unwrap(),
        2
    );
}

#[test]
fn archiving_moves_the_complete_projection_folder_and_restoring_reactivates_it() {
    let (_root, service) = service("chat-forgotten-note");
    let conversation = service
        .create_conversation(Some("Release planning".into()), None)
        .unwrap();
    let connection = service.connection().unwrap();
    connection
        .execute(
            "INSERT INTO chat_messages
                 (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                 VALUES ('user-1', ?1, 1, 'user', 'complete', 'Can we ship Friday?', 1, 1)",
            [&conversation.summary.id],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO chat_messages
                 (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                 VALUES ('assistant-1', ?1, 2, 'assistant', 'complete', 'Yes, after QA.', 1, 2)",
            [&conversation.summary.id],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO chat_sources
                 (message_id, kind, title, excerpt, url)
                 VALUES ('assistant-1', 'web', 'Release guide', '', 'https://example.com/release')",
            [],
        )
        .unwrap();
    drop(connection);
    service
        .write_projection(&conversation.summary.id, false)
        .unwrap();

    let snapshot = service
        .forgotten_folder_snapshot(&conversation.summary.id)
        .unwrap();
    assert_eq!(snapshot.title, "Release planning");
    assert!(snapshot
        .original_path
        .starts_with(_root.path().join("Chats")));
    let forgotten_path = _root.path().join(".forgotten").join(
        snapshot
            .original_path
            .file_name()
            .expect("conversation folder name"),
    );
    fs::create_dir_all(_root.path().join(".forgotten")).unwrap();

    let archived = service
        .archive_conversation_folder(&conversation.summary.id, &forgotten_path)
        .unwrap();
    assert!(archived.previous_paths.len() >= 2);
    assert!(archived.previous_paths.iter().all(|path| !path.exists()));
    assert!(archived
        .current_paths
        .iter()
        .all(|path| path.is_file() && path.starts_with(&forgotten_path)));
    assert!(!snapshot.original_path.exists());
    assert!(forgotten_path.is_dir());
    let transcript = fs::read_to_string(forgotten_path.join("Part 001.md")).unwrap();
    assert!(transcript.contains("Can we ship Friday?"));
    assert!(transcript.contains("Yes, after QA."));
    assert!(transcript.contains("[Release guide](https://example.com/release)"));
    assert_eq!(
        service
            .get_conversation(&conversation.summary.id)
            .unwrap()
            .summary
            .status,
        "archived"
    );
    let projection_count: i64 = service
        .connection()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM chat_projection_files WHERE conversation_id = ?1",
            [&conversation.summary.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(projection_count as usize, archived.current_paths.len());

    let restored = service
        .restore_conversation_folder(
            &conversation.summary.id,
            &forgotten_path,
            &snapshot.original_path,
        )
        .unwrap();
    assert!(restored
        .current_paths
        .iter()
        .all(|path| path.is_file() && path.starts_with(&snapshot.original_path)));
    assert!(!forgotten_path.exists());
    assert_eq!(
        service
            .get_conversation(&conversation.summary.id)
            .unwrap()
            .summary
            .status,
        "active"
    );
}

#[test]
fn conflict_conversion_prepares_an_ordinary_note_then_restores_projection() {
    let (_root, service) = service("chat-conflict-convert");
    let conversation = service
        .create_conversation(Some("Edited chat".into()), None)
        .unwrap();
    let projection: String = service.connection().unwrap().query_row(
            "SELECT path FROM chat_projection_files WHERE conversation_id = ?1 AND path LIKE '%Conversation.md'",
            [&conversation.summary.id],
            |row| row.get(0),
        ).unwrap();
    let original = fs::read_to_string(&projection).unwrap();
    fs::write(&projection, format!("{original}\nUser-added thought\n")).unwrap();

    let conversion = service
        .projection_conflict_conversion(&conversation.summary.id)
        .unwrap();
    assert_eq!(conversion.title, "Edited chat");
    assert!(conversion.markdown.contains("User-added thought"));

    service
        .restore_projection_after_conflict(&conversation.summary.id)
        .unwrap();
    assert!(!fs::read_to_string(projection)
        .unwrap()
        .contains("User-added thought"));
}

#[test]
fn composer_drafts_round_trip_per_slot_and_clear_when_emptied() {
    let (_root, service) = service("chat-composer-drafts");

    assert_eq!(service.get_composer_draft("pane:left").unwrap(), "");

    service
        .set_composer_draft("pane:left", "half a thought")
        .unwrap();
    service
        .set_composer_draft("pane:right", "another thought")
        .unwrap();
    assert_eq!(
        service.get_composer_draft("pane:left").unwrap(),
        "half a thought"
    );
    assert_eq!(
        service.get_composer_draft("pane:right").unwrap(),
        "another thought"
    );

    service.set_composer_draft("pane:left", "").unwrap();
    assert_eq!(service.get_composer_draft("pane:left").unwrap(), "");
    assert_eq!(
        service.get_composer_draft("pane:right").unwrap(),
        "another thought"
    );
}

#[test]
fn composer_draft_slots_must_be_named() {
    for slot in [
        "".to_string(),
        "   ".to_string(),
        "s".repeat(MAX_COMPOSER_DRAFT_SLOT_LEN + 1),
    ] {
        assert!(normalize_composer_draft_slot(&slot).is_err());
    }
    assert_eq!(
        normalize_composer_draft_slot(" pane:left ").unwrap(),
        "pane:left"
    );
}

#[test]
fn deleting_an_archived_conversation_takes_its_draft_with_it() {
    let (_root, service) = service("chat-composer-draft-cleanup");
    let conversation = service.create_conversation(None, None).unwrap();
    let slot = composer_draft_slot_for_conversation(&conversation.summary.id);
    service.set_composer_draft(&slot, "unsent reply").unwrap();

    let forgotten_path = _root.path().join(".forgotten").join("conversation");
    fs::create_dir_all(_root.path().join(".forgotten")).unwrap();
    service
        .archive_conversation_folder(&conversation.summary.id, &forgotten_path)
        .unwrap();
    service
        .delete_archived_conversation(&conversation.summary.id)
        .unwrap();

    assert_eq!(service.get_composer_draft(&slot).unwrap(), "");
}

mod lifecycle;

impl ChatService {
    pub(crate) fn test_store_structured_answer(
        &self,
        tools: &crate::agent_tools::AgentToolContext,
        message: &str,
        run: &str,
        output: String,
    ) -> Result<(), String> {
        let success = Self::finalize_agent_response(
            tools,
            crate::agent_runtime::AgentRuntimeResponse {
                output,
                usage: Default::default(),
                stats: Default::default(),
            },
            true,
            &CancellationToken::new(),
        )
        .map_err(|failure| failure.error)?;
        self.persist_terminal_outcome(
            message,
            run,
            "complete",
            &success.content,
            None,
            &success.sources,
            &success.note_reference_ids,
            &(0, 0),
            &success.stats,
            None,
        )
    }

    pub(crate) fn test_structured_answer_contract() -> (serde_json::Value, &'static str) {
        (structured_answer::schema(), structured_answer::INSTRUCTIONS)
    }

    pub(crate) fn test_store_structured_edit_answer(
        &self,
        tools: &crate::agent_tools::AgentToolContext,
        message: &str,
        run: &str,
    ) {
        let success = Self::finalize_agent_response(tools, crate::agent_runtime::AgentRuntimeResponse {
            output: serde_json::json!({"segments":[{"text":"Prepared changes for review.","sources":[]}]}).to_string(),
            usage: Default::default(), stats: Default::default(),
        }, true, &CancellationToken::new()).ok().unwrap();
        assert!(
            success.sources.is_empty(),
            "Editing reads must not become passage citations"
        );
        self.persist_terminal_outcome(
            message,
            run,
            "complete",
            &success.content,
            None,
            &success.sources,
            &success.note_reference_ids,
            &(0, 0),
            &success.stats,
            None,
        )
        .unwrap();
    }

    pub(crate) fn test_model_history_with_note_hints(
        &self,
        conversation_id: &str,
        tools: &crate::agent_tools::AgentToolContext,
    ) -> String {
        let conversation = self.get_conversation(conversation_id).unwrap();
        let compaction = self.context_compaction(conversation_id).unwrap();
        serde_json::to_string(
            &assemble_model_history(&conversation.messages, "next", compaction.as_ref(), tools)
                .unwrap(),
        )
        .unwrap()
    }

    pub(crate) fn finish_message_for_history_test(&self, id: &str, sources: &[ChatSource]) {
        self.finish_message(id, "complete", "OBSOLETE_ANSWER_FACT", None, sources)
            .unwrap();
    }

    /// Exercise terminal storage and both subsequent model-context paths for a tool fixture.
    pub(crate) fn test_complete_and_model_context(
        &self,
        message_id: &str,
        reply: &str,
        sources: &[ChatSource],
    ) -> (String, String) {
        self.finish_message(message_id, "complete", reply, None, sources)
            .unwrap();
        let connection = self.connection().unwrap();
        let conversation_id: String = connection
            .query_row(
                "SELECT conversation_id FROM chat_messages WHERE id = ?1",
                [message_id],
                |row| row.get(0),
            )
            .unwrap();
        let current = self.get_conversation(&conversation_id).unwrap();
        let recent = serde_json::to_string(
            &normalized_rig_history(&current.messages, "next-user", None, |_| None)
                .unwrap()
                .messages,
        )
        .unwrap();
        drop(connection);
        let compacted = self.test_compact_saved_conversation(&conversation_id);
        (recent, compacted)
    }

    pub(crate) fn test_compact_saved_conversation(&self, conversation_id: &str) -> String {
        let connection = self.connection().unwrap();
        for ordinal in 3..=22 {
            connection.execute("INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis) VALUES (?1, ?2, ?3, 'user', 'complete', 'later question', 1, 1)", params![format!("{conversation_id}-later-{ordinal}"), conversation_id, ordinal]).unwrap();
        }
        drop(connection);
        self.refresh_continuation_summary(conversation_id).unwrap();
        self.context_compaction(conversation_id)
            .unwrap()
            .unwrap()
            .summary
    }

    pub(crate) fn test_complete_answer(&self, id: &str, body: &str) {
        self.finish_message(id, "complete", body, None, &[])
            .unwrap();
    }

    pub(crate) fn test_tool_run(&self) -> (String, String, String) {
        let conversation = self.create_conversation(None, None).unwrap();
        let admission = self
            .admit_request(
                ChatRequest::New {
                    conversation_id: conversation.summary.id.clone(),
                    content: "Test tools".into(),
                    attachments: vec![],
                    force_web_search: false,
                    active_note: None,
                    selected_context: vec![],
                    date_time_context: None,
                },
                "tool-test".into(),
            )
            .unwrap();
        (
            conversation.summary.id,
            admission.accepted.assistant_message_id,
            admission.run_id,
        )
    }
}

#[test]
fn history_note_references_preserve_turns_and_stay_bounded_without_old_claims() {
    let (_root, service) = service("chat-note-reference-budget");
    let conversation = service.create_conversation(None, None).unwrap();
    let mut messages = Vec::new();
    for ordinal in 1..=20 {
        messages.push(ChatMessage {
            saved_note: None,
            id: format!("m-{ordinal}"),
            conversation_id: conversation.summary.id.clone(),
            ordinal,
            role: "assistant".into(),
            status: "complete".into(),
            content: "OBSOLETE_FACT".into(),
            error: None,
            part: 1,
            created_at_millis: 1,
            has_revision_evidence: true,
            note_reference_ids: vec![],
            attachments: vec![],
            agent_events: vec![],
            sources: vec![ChatSource {
                kind: "passage".into(),
                note_id: Some(format!("note-{ordinal}")),
                note_path: Some("obsolete-path.md".into()),
                title: "OBSOLETE_TITLE".into(),
                excerpt: "OBSOLETE_EXCERPT".into(),
                url: None,
                anchor: Some("OLD_CITATION".into()),
                revision: None,
                passage: None,
            }],
        });
    }
    let plain = serde_json::to_string(
        &normalized_rig_history(&messages, "next", None, |_| None)
            .unwrap()
            .messages,
    )
    .unwrap();
    let normalized = normalized_rig_history(&messages, "next", None, |id| {
        Some(json!({"noteId":id,"title":"current ".repeat(30)}))
    })
    .unwrap();
    assert!(normalized.admitted_note_ids.contains("note-20"));
    assert!(!normalized.admitted_note_ids.contains("note-1"));
    let history = normalized.messages;
    let text = serde_json::to_string(&history).unwrap();
    for obsolete in [
        "OBSOLETE_FACT",
        "OBSOLETE_TITLE",
        "OBSOLETE_EXCERPT",
        "OLD_CITATION",
        "obsolete-path",
    ] {
        assert!(!text.contains(obsolete));
    }
    assert!(text.contains("mostRecentAnswer") && text.contains("note-20"));
    assert!(matches!(
        history.last(),
        Some(rig_core::completion::Message::System { .. })
    ));
    for message in &history {
        if matches!(message, rig_core::completion::Message::Assistant { .. }) {
            assert!(
                !serde_json::to_string(message).unwrap().contains("noteId"),
                "Fresh app-issued IDs must not look like old assistant prose"
            );
        }
    }

    assert!(
        !text.contains("note-1\""),
        "Recent references should win the bound"
    );
    assert!(
        text.len() - plain.len() <= 2600,
        "Serialized framing must stay close to the 2400-byte text allowance"
    );
    let content_bytes = |history: &[rig_core::completion::Message]| -> usize {
        history
            .iter()
            .map(|m| match m {
                rig_core::completion::Message::Assistant(
                    rig_core::completion::AssistantMessage { content, .. },
                ) => content
                    .iter()
                    .map(|c| match c {
                        rig_core::completion::AssistantContent::Text(t) => t.text.len(),
                        _ => 0,
                    })
                    .sum(),
                rig_core::completion::Message::System { content } => content.len(),
                _ => 0,
            })
            .sum()
    };
    let plain_history = normalized_rig_history(&messages, "next", None, |_| None)
        .unwrap()
        .messages;
    assert!(content_bytes(&history) - content_bytes(&plain_history) <= 2400);
}

#[test]
fn promotion_checkpoint_failure_retains_previous_version_and_terminal_work_rejects_late_output() {
    let (root, service) = service("promotion-checkpoint-fault");
    let conversation = service
        .create_conversation(None, Some(VaultAccess::Full))
        .unwrap();
    let (run, message) = seed_agent_run(&service, &conversation.summary.id, "draft-fault", 1);
    let proposal = service
        .prepare_note_save(&conversation.summary.id, &message, None)
        .unwrap();
    let before = service.proposal_draft(&proposal.id).unwrap();
    service.connection().unwrap().execute_batch("CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON chat_proposal_drafts BEGIN SELECT RAISE(FAIL,'injected checkpoint failure'); END;").unwrap();
    assert!(service
        .checkpoint_proposal_draft(
            &proposal.id,
            before.version,
            "New typing",
            &before.title,
            None,
            &json!([])
        )
        .is_err());
    let unchanged = service.proposal_draft(&proposal.id).unwrap();
    assert_eq!(unchanged.markdown, before.markdown);
    assert_eq!(unchanged.version, before.version);
    service
        .connection()
        .unwrap()
        .execute_batch("DROP TRIGGER fail_checkpoint")
        .unwrap();
    let current = service
        .checkpoint_proposal_draft(
            &proposal.id,
            before.version,
            "New typing",
            &before.title,
            None,
            &json!([]),
        )
        .unwrap();
    assert!(service
        .refine_proposal_draft(&proposal.id, before.version, "Late model output", &run)
        .is_err());
    assert_eq!(
        service.proposal_draft(&proposal.id).unwrap().markdown,
        "New typing"
    );
    service
        .resolve_agent_proposal(&proposal.id, "dismissed")
        .unwrap();
    assert!(service
        .refine_proposal_draft(&proposal.id, current.version, "Late model output", &run)
        .is_err());
    assert!(service
        .checkpoint_proposal_draft(
            &proposal.id,
            current.version,
            "Late checkpoint",
            &before.title,
            None,
            &json!([])
        )
        .is_err());
    assert!(!root.path().join(format!("{}.md", before.title)).exists());
}

#[test]
fn concurrent_promotion_keep_returns_one_identity_and_late_collision_requires_new_approval() {
    let fixture = crate::test_support::TestVault::new("promotion-keep-race");
    let service = ChatService::new(
        fixture.notes.path().into(),
        fixture.notes.path().join(".gneauxghts"),
    )
    .unwrap();
    let conversation = service
        .create_conversation(None, Some(VaultAccess::Full))
        .unwrap();
    let (_, message) = seed_agent_run(&service, &conversation.summary.id, "race", 1);
    let proposal = service
        .prepare_note_save(&conversation.summary.id, &message, None)
        .unwrap();
    let before = service.proposal_draft(&proposal.id).unwrap();
    fs::write(&before.path, "Occupied while reviewing").unwrap();
    let collision = crate::commands::proposal_commands::commit_agent_proposal_with_state(
        &fixture.state,
        &service,
        proposal.id.clone(),
        None,
    )
    .unwrap();
    assert_eq!(collision.status, "conflict");
    assert_eq!(
        fs::read_to_string(&before.path).unwrap(),
        "Occupied while reviewing"
    );
    let refreshed = service.proposal_draft(&proposal.id).unwrap();
    assert_ne!(refreshed.path, before.path);
    assert!(!Path::new(&refreshed.path).exists());
    let (one, two) = std::thread::scope(|scope| {
        let one = scope.spawn(|| {
            crate::commands::proposal_commands::commit_agent_proposal_with_state(
                &fixture.state,
                &service,
                proposal.id.clone(),
                None,
            )
            .unwrap()
        });
        let two = scope.spawn(|| {
            crate::commands::proposal_commands::commit_agent_proposal_with_state(
                &fixture.state,
                &service,
                proposal.id.clone(),
                None,
            )
            .unwrap()
        });
        (one.join().unwrap(), two.join().unwrap())
    });
    assert_eq!(one.status, "committed");
    assert_eq!(one.note_id, two.note_id);
    assert_eq!(one.committed_markdown, two.committed_markdown);
    assert_eq!(
        fs::read_to_string(&before.path).unwrap(),
        "Occupied while reviewing"
    );
    assert!(fs::read_to_string(&refreshed.path)
        .unwrap()
        .contains("response"));
    assert_eq!(
        service.get_agent_proposal(&proposal.id).unwrap().status,
        "committed"
    );
    assert_eq!(
        service
            .resolve_agent_proposal(&proposal.id, "dismissed")
            .unwrap()
            .status,
        "committed"
    );
    assert!(service.proposal_draft(&proposal.id).is_err());
}

#[test]
fn promoted_existing_note_keep_without_a_body_uses_the_latest_checkpoint() {
    let fixture = crate::test_support::TestVault::new("promotion-latest-body");
    let service = ChatService::new(
        fixture.notes.path().into(),
        fixture.notes.path().join(".gneauxghts"),
    )
    .unwrap();
    let path = fixture.notes.path().join("Target.md");
    let initial = fixture
        .state
        .note_timeline()
        .create_note_at(
            crate::services::note_timeline::MutationSource::Editor,
            &path,
            "Original",
        )
        .unwrap()
        .unwrap();
    let conversation = service
        .create_conversation(None, Some(VaultAccess::Full))
        .unwrap();
    let (_, message) = seed_agent_run(&service, &conversation.summary.id, "latest-body", 1);
    let proposal = service
        .prepare_note_save_target(
            &conversation.summary.id,
            &message,
            None,
            None,
            Some(initial.note_id().as_str()),
            None,
            None,
            None,
        )
        .unwrap();
    let draft = service.proposal_draft(&proposal.id).unwrap();
    let revised = draft.markdown.replace("response", "My reviewed addition");
    service
        .checkpoint_proposal_draft(
            &proposal.id,
            draft.version,
            &revised,
            &draft.title,
            None,
            &json!([]),
        )
        .unwrap();
    let receipt = crate::commands::proposal_commands::commit_agent_proposal_with_state(
        &fixture.state,
        &service,
        proposal.id,
        None,
    )
    .unwrap();
    assert_eq!(
        receipt.committed_markdown.as_deref(),
        Some(revised.as_str())
    );
}
