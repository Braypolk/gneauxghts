//! Opt-in diagnosis on synthetic notes, including exact delivered/selected IDs.
use super::*;
use crate::{
    agent_guardrails::{AgentRunGuard, AgentRunLimits},
    agent_runtime::{AgentProvider, AgentRuntimeObserver},
};
use rig_core::{completion::Message, providers::openai};
use std::time::{Duration, Instant};

#[test]
#[ignore = "requires explicitly configured local server; synthetic notes only"]
fn live_multi_note_source_selection() {
    let endpoint = std::env::var("GNEAUX_LIVE_ENDPOINT").unwrap();
    let model = std::env::var("GNEAUX_LIVE_MODEL").unwrap();
    let output = PathBuf::from(std::env::var("GNEAUX_LIVE_OUTPUT").unwrap());
    let (vault, mut tools, _) = fixture();
    let mut expected = Vec::new();
    for (name, code, date) in [
        ("Aster", "KITE-417", "2026-10-14"),
        ("Birch", "MOSS-268", "2026-10-15"),
        ("Cedar", "RIVER-953", "2026-10-16"),
        ("Dahlia", "EMBER-624", "2026-10-17"),
        ("Elm", "LARK-751", "2026-10-18"),
        ("Fern", "ORBIT-386", "2026-10-19"),
    ] {
        let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
            &vault.state, format!("{name} checklist"),
            format!("Background: release package {name}.\n- [x] Archive old paperwork.\n- [ ] Complete review {code} @due({date})\nThe review blocks release. Owner: {name} team.\n"), None,
        ).unwrap().unwrap();
        expected.push(json!({"name":name,"code":code,"noteId":saved.note_id.unwrap()}));
    }
    vault
        .state
        .lexical
        .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
        .unwrap();
    tools.capabilities = tools.capabilities.restricted_to(&[Capability::Evidence]);
    let mut input = request();
    input.provider = AgentProvider::Local;
    input.model = model.clone();
    input.local_base_url = endpoint.clone();
    input.output_schema = Some(crate::chat::ChatService::test_structured_answer_contract().0);
    input.preamble = format!(
        "{}\n\n{}",
        crate::chat::agent_preamble(&AgentProvider::Local, true),
        crate::chat::ChatService::test_structured_answer_contract().1
    );
    input.prompt = Message::user("What are the most important items still left to do? Search the vault for unchecked tasks, read the matching task evidence for all six package checklists, then rank the six pending reviews by deadline. Include each review code and cite each checklist separately. Do not change notes.");
    let client = openai::OpenAIConfig::new("lm-studio")
        .with_base_url(&endpoint)
        .client();
    let trace = Arc::new(Mutex::new(Vec::new()));
    let start = Instant::now();
    let result = tauri::async_runtime::block_on(crate::agent_runtime::run_traced_test_model(
        client.chat(&model),
        input,
        Some(tools.clone()),
        AgentRuntimeObserver {
            evidence_context: Some(tools.clone()),
            cancelled: tokio_util::sync::CancellationToken::new(),
            permissions: None,
            on_event: Arc::new(|_| {}),
        },
        AgentRunGuard::new(AgentRunLimits {
            max_elapsed: Some(Duration::from_secs(180)),
            max_tool_calls: 24,
            ..Default::default()
        }),
        trace.clone(),
    ));
    let sources = tools.sources();
    let references = tools.passage_references.lock().unwrap();
    let issued: Vec<_> = sources.iter().filter_map(|s| s.passage.as_ref()).map(|p| json!({"id":p.id,"sourceId":references.source_ids(&sources).into_iter().find(|id| references.passage_id(id)==Some(&p.id)),"excerpt":p.excerpt})).collect();
    let rendered = result
        .as_ref()
        .ok()
        .map(|r| crate::chat::structured_answer::render(&r.output, &references, &sources));
    fs::write(output, serde_json::to_vec_pretty(&json!({"model":model,"elapsedSeconds":start.elapsed().as_secs_f64(),"expected":expected,"response":result.as_ref().ok().map(|r| &r.output),"error":result.as_ref().err(),"issued":issued,"rendered":rendered,"trace":*trace.lock().unwrap()})).unwrap()).unwrap();
    let response = result.unwrap();
    let value: Value = serde_json::from_str(&response.output).unwrap();
    for item in &expected {
        let code = item["code"].as_str().unwrap();
        assert!(
            value["segments"].as_array().unwrap().iter().any(|segment| {
                segment["text"]
                    .as_str()
                    .is_some_and(|text| text.contains(code))
                    && segment["sources"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter_map(Value::as_str)
                        .any(|id| {
                            references
                                .source(id, &sources)
                                .is_some_and(|s| s.excerpt.contains(code))
                        })
            }),
            "Missing correctly cited review: {code}"
        );
    }
    for id in value["segments"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|s| s["sources"].as_array().unwrap())
        .filter_map(Value::as_str)
    {
        assert!(
            references.source(id, &sources).is_some(),
            "Unissued selection: {id}"
        );
    }
}
