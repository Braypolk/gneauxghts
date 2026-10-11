//! Opt-in offline diagnostics. Scripted tool choices measure delivery, not model behavior.
use super::*;
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};

fn save(vault: &crate::test_support::TestVault, title: &str, body: &str) -> String {
    crate::test_support::save_and_finalize(&vault.state, title.into(), body.into(), None)
        .unwrap()
        .unwrap()
        .note_id
        .unwrap()
}

fn fresh(vault: &crate::test_support::TestVault, garden: &str) -> AgentToolContext {
    let service = ChatService::new(vault.notes.path().into(), vault.data.path().into()).unwrap();
    let (conversation, message, run) = service.test_tool_run();
    let context = AgentToolContext::with_host(
        ToolHost::Test(vault.state.clone(), Arc::new(|_, _| {})),
        service,
        "context-selection-audit".into(),
        run,
        conversation,
        message,
        VaultAccess::Full,
        Some(ActiveNoteSnapshot {
            note_id: Some(garden.into()),
            title: "STALE TITLE".into(),
            path: None,
            body: "STALE BODY CANARY".into(),
            body_hash: "stale".into(),
            selection: None,
        }),
        HashSet::new(),
        false,
        None,
    );
    context.evidence.lock().unwrap().anchor.instant =
        chrono::DateTime::parse_from_rfc3339("2026-10-09T18:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
    context
}

fn prompt(context: &AgentToolContext, question: &str) -> (String, Value) {
    let hint = context.active_note_context().unwrap();
    let linked = context.explicit_wikilink_context(question).unwrap();
    let selected = context.selected_context_prompt(&[]).unwrap();
    let mut prompt = format!("{question}\n\nQuery reference instant, local timezone and editor date/time conventions: {}", context.query_anchor_label());
    for (label, text) in [
        ("", hint.as_str()),
        (
            "Allowed notes explicitly linked by the user:\n",
            linked.as_str(),
        ),
        (
            "Notes explicitly included for this turn:\n",
            selected.as_str(),
        ),
    ] {
        if !text.is_empty() {
            prompt.push_str(&format!("\n\n{label}{text}"));
        }
    }
    let parts = json!({"questionBytes":question.len(),"adjacentHintBytes":hint.len(),"linkedContextBytes":linked.len(),"selectedContextBytes":selected.len(),"hint":hint,"linkedContext":linked});
    (prompt, parts)
}

fn end() -> MockStreamEvent {
    MockStreamEvent::final_response(rig_core::completion::Usage::new())
}

fn replay(context: AgentToolContext, prompt: &str, turns: Vec<Vec<MockStreamEvent>>) -> Value {
    let model = MockCompletionModel::from_stream_turns(turns);
    let measurements = Arc::new(Mutex::new(Vec::new()));
    let capture = measurements.clone();
    let mut input = request();
    input.preamble = crate::chat::agent_preamble(&input.provider, true);
    input.prompt = rig_core::completion::Message::user(prompt);
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
                    if details["phase"] == "request" {
                        capture.lock().unwrap().push(details);
                    }
                }
            }),
        },
    ))
    .unwrap();
    let histories: Vec<_> = model
        .requests()
        .iter()
        .map(|r| serde_json::to_value(&r.chat_history).unwrap())
        .collect();
    json!({"measurements":*measurements.lock().unwrap(),"histories":histories})
}

async fn find(context: &AgentToolContext, args: Value) -> Value {
    FindNotesTool(context.clone())
        .call(
            &mut ToolContext::new(),
            serde_json::from_value(args).unwrap(),
        )
        .await
        .unwrap()
}

async fn read(context: &AgentToolContext, args: Value) -> Value {
    ReadNotesTool(context.clone())
        .call(
            &mut ToolContext::new(),
            serde_json::from_value(args).unwrap(),
        )
        .await
        .unwrap()
}

#[test]
#[ignore = "Offline diagnostic; set GNEAUX_CONTEXT_SELECTION_AUDIT_OUTPUT to retain synthetic traces"]
fn context_selection_offline_audit() {
    let (vault, _, _) = fixture();
    let garden = save(
        &vault,
        "Garden plan",
        "Water basil every morning.\nGarden-only code: FERN-831.\n",
    );
    save(
        &vault,
        "Meridian launch",
        "Launch code: SABLE-472.\nOwner: Priya.\nKeep the cobalt checklist unchanged.\n",
    );
    let retrospective_body = "On September 18, 2026, Priya finished checksum verification; deployment was approved.\nOn September 19, Anika planned the rollout.\nChecksum verification is one substep; the entire launch has no recorded completion.\n";
    let retrospective = save(&vault, "Meridian retrospective", retrospective_body);
    let hidden = save(&vault, "Meridian private", "Private canary: HIDDEN-615.\n");
    let long_body = format!(
        "{}\nTAIL CANARY",
        "Background unrelated to approval.\n".repeat(120)
    );
    save(&vault, "Long project", &long_body);
    fresh(&vault, &garden)
        .service
        .set_note_excluded(&hidden, "Meridian private", true)
        .unwrap();
    vault
        .state
        .lexical
        .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
        .unwrap();
    let mut starting = Vec::new();
    for (name, question, selection) in [
        ("greeting", "Hi! How are you?", None),
        (
            "plain_named_note",
            "What is the launch code in Meridian launch?",
            None,
        ),
        (
            "linked_named_note",
            "What is the launch code in [[Meridian launch]]?",
            None,
        ),
        (
            "selected_text",
            "What plant should I water in the selected text?",
            Some("Water basil every morning."),
        ),
        (
            "long_linked_note",
            "Who approved deployment in [[Long project]]?",
            None,
        ),
    ] {
        let mut context = fresh(&vault, &garden);
        context.active_note.as_mut().unwrap().selection = selection.map(str::to_owned);
        let (prompt, parts) = prompt(&context, question);
        assert!(!prompt.contains("FERN-831") && !prompt.contains("STALE BODY CANARY"));
        assert!(!prompt.contains("HIDDEN-615"));
        if name == "long_linked_note" {
            assert!(!prompt.contains("TAIL CANARY"));
            assert!(parts["linkedContext"]
                .as_str()
                .unwrap()
                .contains("\"complete\":false"));
            assert!(parts["linkedContext"]
                .as_str()
                .unwrap()
                .contains("\"nextRead\""));
        }
        let trace = replay(
            context,
            &prompt,
            vec![vec![MockStreamEvent::text("Offline diagnostic."), end()]],
        );
        starting.push(json!({"name":name,"prompt":prompt,"components":parts,"trace":trace}));
    }
    let probes = tauri::async_runtime::block_on(async {
        let context = fresh(&vault, &garden);
        let discovery_args = json!({"query":"Meridian retrospective","limit":10});
        let discovery = find(&context, discovery_args.clone()).await;
        let body_id = discovery["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["noteId"] == retrospective && i["location"] == "body")
            .unwrap()["evidenceId"]
            .clone();
        let read_args = json!({"purpose":"answer","evidence_ids":[body_id]});
        let passage = read(&context, read_args.clone()).await;
        assert_eq!(passage["delivery"]["complete"], true);
        assert!(passage["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["excerpt"]
                .as_str()
                .is_some_and(|e| e.contains("deployment was approved"))));
        let mut alternatives = Vec::new();
        for args in [
            json!({"query":"Meridian retrospective","mode":"lexical","note_ids":[retrospective],"limit":10}),
            json!({"query":"deployment approv","limit":10}),
            json!({"query":"approved","mode":"literal","limit":20}),
            json!({"query":"approved","mode":"lexical","limit":20}),
            json!({"query":"approved","mode":"literal","note_ids":[retrospective],"limit":20}),
        ] {
            let probe_context = fresh(&vault, &garden);
            let result = find(&probe_context, args.clone()).await;
            let repeated: Vec<_> = result["items"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|i| i["evidenceId"] == body_id)
                .cloned()
                .collect();
            let same_text = result["items"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|i| {
                    i["noteId"] == retrospective
                        && i["preview"]
                            .as_str()
                            .is_some_and(|p| p.trim() == retrospective_body.trim())
                })
                .count();
            alternatives.push(json!({"args":args,"resultBytes":result.to_string().len(),"result":result,"repeatedBodyCandidates":repeated.len(),"sameReadTextPreviews":same_text}));
        }
        let direct = read(
            &fresh(&vault, &garden),
            json!({"purpose":"answer","note_id":retrospective}),
        )
        .await;
        let repeated = read(&context, read_args.clone()).await;
        assert_eq!(passage["coverage"]["scope"], "selected_passages");
        assert_eq!(direct["coverage"]["scope"], "canonical_note");
        assert_eq!(direct["coverage"]["complete"], true);
        assert_eq!(passage["items"][0]["alreadyRead"], "none");
        assert_eq!(repeated["items"][0]["alreadyRead"], "full");
        let mut original_items = passage["items"].clone();
        let mut repeated_items = repeated["items"].clone();
        for items in [&mut original_items, &mut repeated_items] {
            for item in items.as_array_mut().unwrap() {
                item.as_object_mut().unwrap().remove("alreadyRead");
            }
        }
        assert_eq!(original_items, repeated_items);
        let repeat_discovery = find(&context, discovery_args.clone()).await;
        assert!(repeat_discovery["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["evidenceId"] == body_id && i["alreadyRead"] == "full"));
        let (allowed, excluded) = context.evidence_scope().unwrap();
        let ids = crate::services::evidence::scope_ids(
            &vault.state,
            allowed.as_ref(),
            &excluded,
            &Default::default(),
        )
        .unwrap();
        assert!(vault
            .state
            .lexical
            .evidence_is_current(&vault.state.notes_index.lock().unwrap().entries, &ids));
        let (matches, _) = vault
            .state
            .lexical
            .evidence_matches("Meridian retrospective", &ids, 4096)
            .unwrap();
        let indexed_matches: Vec<_> = matches.into_iter().map(|hit| {
            let (path, title, _) = context.resolve_note(&hit.note_id).unwrap();
            let raw = fs::read_to_string(path).unwrap();
            json!({"noteId":hit.note_id,"title":title,"indexedText":hit.text,"section":hit.section_label,"score":hit.score,"location":hit.location.as_str(),"canonicalBodyContains":note::strip_frontmatter(&raw).contains(&hit.text)})
        }).collect();
        assert!(indexed_matches
            .iter()
            .any(|m| m["section"] == "Title" && m["canonicalBodyContains"] == false));
        assert!(!alternatives[0]["result"]["coverage"]["gaps"]
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g == "An indexed passage changed or was ambiguous"));
        json!({"discoveryArgs":discovery_args,"discovery":discovery,"readArgs":read_args,"passageRead":passage,"directNoteRead":direct,"repeatRead":repeated,"repeatDiscovery":repeat_discovery,"searchAlternatives":alternatives,"freshIndexTitleMatches":indexed_matches})
    });
    let question = "In Meridian retrospective, what did Priya complete on September 18? Is the entire launch recorded as complete, and who approved deployment?";
    let context = fresh(&vault, &garden);
    let (initial, _) = prompt(&context, question);
    let trace = replay(
        context,
        &initial,
        vec![
            vec![
                MockStreamEvent::tool_call(
                    "discover",
                    "find_notes",
                    probes["discoveryArgs"].clone(),
                ),
                end(),
            ],
            vec![
                MockStreamEvent::tool_call("read", "read_notes", probes["readArgs"].clone()),
                MockStreamEvent::tool_call(
                    "followup",
                    "find_notes",
                    json!({"query":"deployment approv","limit":10}),
                ),
                end(),
            ],
            vec![
                MockStreamEvent::tool_call(
                    "final_search",
                    "find_notes",
                    json!({"query":"approved","mode":"literal","limit":20}),
                ),
                end(),
            ],
            vec![
                MockStreamEvent::text("Offline scripted replay complete."),
                end(),
            ],
        ],
    );
    assert_eq!(trace["measurements"].as_array().unwrap().len(), 4);
    let context = fresh(&vault, &garden);
    let (initial, _) = prompt(&context, question);
    let focused = replay(
        context,
        &initial,
        vec![
            vec![
                MockStreamEvent::tool_call(
                    "discover",
                    "find_notes",
                    probes["discoveryArgs"].clone(),
                ),
                end(),
            ],
            vec![
                MockStreamEvent::tool_call("read", "read_notes", probes["readArgs"].clone()),
                end(),
            ],
            vec![
                MockStreamEvent::text("Offline scripted replay complete."),
                end(),
            ],
        ],
    );
    assert_eq!(focused["measurements"].as_array().unwrap().len(), 3);
    let context = fresh(&vault, &garden);
    let connection = rusqlite::Connection::open_with_flags(
        vault.data.path().join("ai.sqlite3"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let history_marker = || {
        connection
            .query_row(
                "SELECT has_revision_evidence FROM chat_messages WHERE id = ?1",
                [&context.assistant_message_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap()
    };
    let before_hint = history_marker();
    context.active_note_context().unwrap();
    let after_hint = history_marker();
    assert_eq!(
        (before_hint, after_hint, context.sources().len()),
        (0, 0, 0)
    );
    let report = json!({"scope":"Offline actual context helpers, registered tools and streaming runner with scripted model choices. No provider requests, native UI or model reasoning. Search modes in the scripted replay are explicit experimental inputs; the prior live report did not retain full tool arguments.","startingCases":starting,"probes":probes,"scriptedRetrievalTrace":trace,"focusedRetrievalTrace":focused,"hintOnlyHistoryMarker":{"beforeHint":before_hint,"afterHint":after_hint,"citableSources":context.sources().len()}});
    assert!(!report.to_string().contains("HIDDEN-615"));
    if let Ok(path) = std::env::var("GNEAUX_CONTEXT_SELECTION_AUDIT_OUTPUT") {
        fs::write(path, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    }
}
