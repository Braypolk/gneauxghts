//! Explicitly opted-in synthetic vault through the real parent/worker runtime.
use super::*;
use crate::agent_guardrails::{AgentRunGuard, AgentRunLimits};
use crate::agent_runtime::{AgentRuntime, AgentRuntimeObserver};
use rig_core::completion::Message;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

#[test]
#[ignore = "requires local LM Studio and the synthetic capacity proxy; no private notes"]
fn live_research_notes_survives_multiple_worker_compactions_and_delivers_cited_facts() {
    let endpoint = std::env::var("GNEAUX_LIVE_ENDPOINT").expect("capacity proxy endpoint");
    assert!(
        endpoint.starts_with("http://127.0.0.1:"),
        "Use the synthetic loopback proxy"
    );
    let model = std::env::var("GNEAUX_LIVE_MODEL").expect("local model");
    let output = PathBuf::from(std::env::var("GNEAUX_LIVE_OUTPUT").expect("synthetic report path"));
    assert!(output.is_absolute());
    let (vault, mut tools, _) = fixture();
    let mut expected = Vec::new();
    for (index, (name, code)) in [
        ("Aster", "KITE-417"),
        ("Birch", "MOSS-268"),
        ("Cedar", "RIVER-953"),
        ("Dahlia", "EMBER-624"),
        ("Elm", "LARK-751"),
        ("Fern", "ORBIT-386"),
    ]
    .into_iter()
    .enumerate()
    {
        let mut body = String::new();
        for row in 0..240 {
            let text = format!("Synthetic archive {index}/{row:03}: packaging review recorded delivery readiness, document checks and routine follow-up.");
            assert!(text.len() < 119);
            body.push_str(&format!("{text:<119}\n"));
        }
        assert_eq!(body.len(), 28_800); // Fact starts in its own canonical passage.
        body.push_str(&format!(
            "\nFinal review: Package {name} has review code {code}.\n"
        ));
        let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
            &vault.state,
            format!("Package {name}"),
            body,
            None,
        )
        .unwrap()
        .unwrap();
        expected.push(json!({"name":name,"code":code,"noteId":saved.note_id.unwrap()}));
    }
    vault
        .state
        .lexical
        .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
        .unwrap();
    tools.capabilities = tools
        .capabilities
        .restricted_to(&[Capability::Evidence, Capability::Research]);
    let ids: Vec<_> = expected
        .iter()
        .map(|item| item["noteId"].as_str().unwrap().to_string())
        .collect();
    let question = format!("For each of these six package notes, find its final review code: {}. Read each canonical note in this order with read_notes purpose=answer and note_id, following every returned cursor until wholeNoteComplete=true before moving to the next note. Do not skip or search around unread pages. Preserve the final code and its exact read evidenceId for each note across compactions. Select the six short final-code passages for the parent; do not select title or archive background passages.", ids.join(", "));
    assert!(question.len() < 2000);
    let mut input = request();
    input.provider = crate::agent_runtime::AgentProvider::Local;
    input.model = model.clone();
    input.local_base_url = endpoint.clone();
    input.reasoning_effort = Some("none".into());
    let (schema, instructions) = crate::chat::ChatService::test_structured_answer_contract();
    input.output_schema = Some(schema);
    input.preamble = format!("Use research_notes exactly once for the requested full review. Do not substitute direct retrieval if research fails. If a validated handoff is partial, read only remainingEvidenceIds. {instructions}");
    input.prompt = Message::user(format!("Call research_notes with this exact question and note_ids, then give each package's final review code in its own cited answer segment. Research arguments: {}", json!({"question":question,"note_ids":ids})));
    let events = Arc::new(Mutex::new(Vec::new()));
    let capture = events.clone();
    let sink: crate::agent_runtime::AgentEventSink = Arc::new(move |event| {
        if let AgentEvent::ContextMeasured { details } = &event {
            if details["mode"] == "compaction" {
                eprintln!("Research compaction: {}", details);
            }
        }
        if let AgentEvent::ResearchCompleted { details } = &event {
            eprintln!("Research terminal: {}", details);
        }
        capture
            .lock()
            .unwrap()
            .push(serde_json::to_value(event).unwrap());
    });
    tools.set_event_sink(sink.clone());
    let start = Instant::now();
    let result = tauri::async_runtime::block_on(AgentRuntime::run(
        input,
        Some(tools.clone()),
        AgentRuntimeObserver {
            evidence_context: Some(tools.clone()),
            cancelled: CancellationToken::new(),
            permissions: None,
            on_event: sink,
        },
        AgentRunGuard::new(AgentRunLimits {
            max_elapsed: Some(Duration::from_secs(600)),
            max_tool_calls: 180,
            max_aggregate_tokens: 2_000_000,
            ..Default::default()
        }),
    ));
    let sources = tools.sources();
    let rendered = result.as_ref().ok().map(|response| {
        crate::chat::structured_answer::render(
            &response.output,
            &tools.passage_references.lock().unwrap(),
            &sources,
        )
    });
    let report = json!({"model":model,"endpoint":endpoint,"simulatedLoadedContextTokens":32000,
        "elapsedSeconds":start.elapsed().as_secs_f64(),"expected":expected,
        "response":result.as_ref().ok().map(|r| &r.output),"error":result.as_ref().err(),
        "rendered":rendered,"sources":sources,"events":*events.lock().unwrap()});
    fs::write(output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    let response = result.unwrap();
    tools.validate_context().unwrap();
    let (answer, cited) = crate::chat::structured_answer::render(
        &response.output,
        &tools.passage_references.lock().unwrap(),
        &sources,
    )
    .unwrap();
    for item in &expected {
        assert!(
            answer.contains(item["code"].as_str().unwrap()),
            "Missing code: {answer}"
        );
        assert!(
            cited
                .iter()
                .any(|s| s.note_id.as_deref() == item["noteId"].as_str()
                    && s.excerpt.contains(item["code"].as_str().unwrap())),
            "Missing supporting source for {item}"
        );
    }
    let events = events.lock().unwrap();
    let compactions = events
        .iter()
        .filter(|e| {
            e["type"] == "contextMeasured"
                && e["details"]["mode"] == "compaction"
                && e["details"]["phase"] == "completed"
                && e["details"]["worker"] == true
        })
        .count();
    assert!(
        compactions >= 2,
        "Expected multiple worker compactions; saw {compactions}"
    );
    let research: Vec<_> = events
        .iter()
        .filter(|e| e["type"] == "researchCompleted")
        .collect();
    assert_eq!(research.len(), 1);
    assert_eq!(research[0]["details"]["reason"], "validated");
    assert_eq!(research[0]["details"]["selectedPassages"], 6);
    // The bounded handoff may page selected evidence. Final fact/source checks
    // above require the parent to finish any remainingEvidenceIds successfully.
    let delivered = research[0]["details"]["deliveredPassages"]
        .as_u64()
        .unwrap();
    assert!((1..=6).contains(&delivered));
    assert_eq!(
        research[0]["details"]["outcome"],
        if delivered == 6 { "ready" } else { "partial" }
    );
    assert!(research[0]["details"]["readCalls"].as_u64().unwrap() > 12);
    assert_eq!(research[0]["details"]["toolErrors"], 0);
    assert!(!tools.research_active.load(Ordering::SeqCst));
    assert!(tools.research_usage().total_tokens > 0);
}
