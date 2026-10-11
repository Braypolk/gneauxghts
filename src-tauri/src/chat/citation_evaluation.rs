//! Opt-in fixed-evidence citation baseline through the app-owned runtime.
//! No user vault, retrieval, tools, private reasoning or credentials in artifacts.
use super::{agent_preamble, citations::PassageReferences, ChatSource};
use crate::{
    agent_guardrails::{AgentRunGuard, AgentRunLimits},
    agent_runtime::{AgentProvider, AgentRuntime, AgentRuntimeObserver, AgentRuntimeRequest},
};
use serde_json::{json, Value};
use std::{
    fs,
    sync::Arc,
    time::{Duration, Instant},
};

fn synthesis_input(case: &Value) -> Value {
    let items: Vec<Value> = case["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|source| {
            let mut item = source.clone();
            item["excerpt"] = item.as_object_mut().unwrap().remove("text").unwrap();
            let metadata = item.as_object_mut().unwrap().remove("metadata").unwrap();
            for (key, value) in metadata.as_object().unwrap() {
                item[key] = value.clone();
            }
            item["citation"] = if source["authority"] == "read" {
                json!(format!(
                    "[Source](passage:{})",
                    source["id"].as_str().unwrap()
                ))
            } else {
                Value::Null
            };
            item
        })
        .collect();
    json!({"question":case["question"], "context":case["context"],
        "evidence":{"items":items,
            "interpretationGuidance":crate::services::evidence::interpretation_guidance(&items)}})
}

// Synthetic delivered sources exercise the real reference preparation/renderer.
// They are not canonical reads or grants; only the citation representation changes.
fn production_references(input: &mut Value) -> (PassageReferences, Vec<ChatSource>) {
    let mut positions = Vec::new();
    let mut sources = Vec::new();
    let mut read_items = Vec::new();
    for (index, item) in input["evidence"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        if item["authority"] != "read" {
            continue;
        }
        let id = item["id"].as_str().unwrap().to_string();
        let excerpt = item["excerpt"].as_str().unwrap().to_string();
        let note_id = format!("synthetic-note-{index}");
        positions.push(index);
        read_items.push(json!({"evidenceId":id,"excerpt":excerpt}));
        sources.push(ChatSource {
            kind: "passage".into(),
            note_id: Some(note_id.clone()),
            note_path: Some(format!("synthetic/note-{index}.md")),
            title: item["title"]
                .as_str()
                .unwrap_or("Synthetic source")
                .to_string(),
            excerpt: excerpt.clone(),
            url: None,
            anchor: Some(id.clone()),
            revision: None,
            passage: Some(crate::services::evidence::PassageCitation {
                id,
                note_id,
                content_hash: "synthetic-not-a-canonical-grant".into(),
                location: item["location"].as_str().unwrap_or("body").to_string(),
                start: 0,
                end: excerpt.len(),
                excerpt,
                revisions: vec![],
                historical: None,
            }),
        });
    }
    let mut references = PassageReferences::default();
    let mut payload = json!({"items":read_items});
    references
        .prepare(&mut payload, &sources)
        .expect("exact synthetic delivered bytes");
    for (position, item) in positions
        .into_iter()
        .zip(payload["items"].as_array().unwrap())
    {
        input["evidence"]["items"][position]["citation"] = item["citation"].clone();
    }
    (references, sources)
}

#[test]
fn citation_production_references_preserve_evidence_and_expose_raw_omissions() {
    let case = json!({"question":"Who?", "context":{}, "sources":[
        {"id":"one","text":"Asha approved.","authority":"read","metadata":{}},
        {"id":"preview","text":"Preview","authority":"preview","metadata":{}},
        {"id":"two","text":"Hold release.","authority":"read","metadata":{}}]});
    let baseline = synthesis_input(&case);
    let mut input = baseline.clone();
    let (references, sources) = production_references(&mut input);
    assert_eq!(input["evidence"]["items"][0]["citation"], "[S1]");
    assert!(input["evidence"]["items"][1]["citation"].is_null());
    assert_eq!(input["evidence"]["items"][2]["citation"], "[S2]");
    let mut restored = input.clone();
    for (item, prior) in restored["evidence"]["items"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .zip(baseline["evidence"]["items"].as_array().unwrap())
    {
        item["citation"] = prior["citation"].clone();
    }
    assert_eq!(restored, baseline, "Only reference representation changes");
    assert_eq!(
        references.render("Asha approved. [S1]", &sources),
        "Asha approved. [Source 1](passage:one)"
    );
    assert_eq!(
        references.render("No citation. Malformed 【Source】. Unknown [S3].", &sources),
        "No citation. Malformed 【Source】. Unknown [citation unavailable]."
    );
    assert_eq!(
        references.render("Asha approved. [S1]", &[]),
        "Asha approved. [citation unavailable]"
    );
}

#[test]
fn citation_synthesis_withholds_controls_and_selects_structural_guidance() {
    let case = json!({"question":"When?", "context":{},
        "requirements":{"secret":"DO_NOT_SEND"}, "rubric":["DO_NOT_SEND"],
        "controls":[{"answer":"DO_NOT_SEND"}],
        "sources":[{"id":"read", "text":"[x] Done", "authority":"read",
            "metadata":{"task":{}, "taskDates":{}}},
            {"id":"preview", "text":"Preview", "authority":"preview", "metadata":{}}]});
    let input = synthesis_input(&case);
    assert!(!input.to_string().contains("DO_NOT_SEND"));
    assert_eq!(
        input["evidence"]["items"][0]["citation"],
        "[Source](passage:read)"
    );
    assert!(input["evidence"]["items"][1]["citation"].is_null());
    assert_eq!(input["evidence"]["items"][0]["excerpt"], "[x] Done");
    let guidance = input["evidence"]["interpretationGuidance"]
        .as_str()
        .unwrap();
    assert!(guidance.contains("Checkbox facts:") && guidance.contains("taskDates"));
}

#[test]
#[ignore = "explicit opt-in paid synthetic citation baseline; saved provider settings"]
fn live_citation_fixed_evidence_baseline() {
    assert_eq!(std::env::var("GNEAUX_CITATION_LIVE").as_deref(), Ok("1"));
    let settings: Value = serde_json::from_str(
        &fs::read_to_string(std::env::var("GNEAUX_CITATION_SETTINGS").expect("settings snapshot"))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        settings["provider"], "openai",
        "This launcher supports OpenAI only"
    );
    let key = std::env::var("OPENAI_API_KEY").expect("in-memory credential");
    let model = settings["model"].as_str().unwrap();
    let effort = settings["reasoning_effort"].as_str().unwrap();
    let corpus_text = fs::read_to_string(std::env::var("GNEAUX_CITATION_CORPUS").unwrap()).unwrap();
    let corpus: Value = serde_json::from_str(&corpus_text).unwrap();
    let selected: Option<Vec<String>> = std::env::var("GNEAUX_CITATION_CASES")
        .ok()
        .map(|value| serde_json::from_str(&value).expect("case ID array"));
    if let Some(ids) = &selected {
        assert!(
            !ids.is_empty()
                && ids.iter().all(|id| corpus["cases"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|case| case["id"] == *id)),
            "Unknown or empty case selection"
        );
    }
    let output = std::env::var("GNEAUX_LIVE_OUTPUT").expect("explicit output path");
    let use_production_references =
        std::env::var("GNEAUX_CITATION_REFERENCES").as_deref() == Ok("production");
    let repeats: usize =
        std::env::var("GNEAUX_CITATION_REPEATS").map_or(1, |value| value.parse().unwrap());
    assert!(
        (1..=3).contains(&repeats),
        "One to three bounded repetitions"
    );
    assert!(
        !std::path::Path::new(&output).exists(),
        "Never overwrite a paid run"
    );
    let preamble = std::env::var("GNEAUX_CITATION_PREAMBLE").map_or_else(
        |_| agent_preamble(&AgentProvider::Openai, false),
        |path| fs::read_to_string(path).expect("explicit test-only preamble"),
    );
    let variant = std::env::var("GNEAUX_CITATION_VARIANT").unwrap_or_else(|_| {
        if use_production_references {
            "current-production-references"
        } else {
            "current"
        }
        .into()
    });
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let mut rows = Vec::new();
    for repeat in 1..=repeats {
        for case in corpus["cases"].as_array().unwrap() {
            if selected
                .as_ref()
                .is_some_and(|ids| !ids.iter().any(|id| case["id"] == *id))
            {
                continue;
            }
            let mut input = synthesis_input(case);
            let references = use_production_references.then(|| production_references(&mut input));
            println!("CITATION START {} repeat {repeat}", case["id"]);
            let start = Instant::now();
            let result = runtime.block_on(AgentRuntime::run(
                AgentRuntimeRequest {
                    provider: AgentProvider::Openai,
                    model: model.to_string(),
                    api_key: Some(key.clone()),
                    local_base_url: String::new(),
                    output_schema: None,
                    preamble: preamble.clone(),
                    prompt: rig_core::completion::Message::user(input.to_string()),
                    history: vec![],
                    enable_web: false,
                    require_web: false,
                    flex: settings["service_tier"] == "flex",
                    reasoning_effort: Some(effort.to_string()),
                },
                None,
                AgentRuntimeObserver {
                    evidence_context: None,
                    cancelled: tokio_util::sync::CancellationToken::new(),
                    on_event: Arc::new(|_| {}),
                    permissions: None,
                },
                AgentRunGuard::new(AgentRunLimits {
                    max_elapsed: Duration::from_secs(120),
                    max_aggregate_tokens: 12_000,
                    ..Default::default()
                }),
            ));
            let mut row = json!({"caseId":case["id"], "variant":variant, "repeat":repeat,
            "model":model, "latencyMillis":start.elapsed().as_millis(), "input":input});
            let failed = result.is_err();
            match result {
                Ok(answer) => {
                    row["status"] = json!("complete");
                    row["rawAnswer"] = json!(answer.output);
                    row["answer"] = json!(references.as_ref().map_or_else(
                        || answer.output.clone(),
                        |(references, sources)| references.render(&answer.output, sources)
                    ));
                    row["usage"] = json!(answer.usage);
                    row["modelCalls"] = json!(answer.stats.model_calls);
                }
                Err(error) => {
                    row["status"] = json!("failed");
                    row["error"] = json!(error);
                }
            }
            if let Some((_, sources)) = references {
                row["citationSources"] = json!(sources);
            }
            println!("CITATION DONE {} {}", case["id"], row["status"]);
            rows.push(row);
            fs::write(&output, serde_json::to_string_pretty(&json!({
            "method":"Actual AgentRuntime, no tools/retrieval; synthetic normalized fixed evidence, manual claim review; optional real reference preparation/rendering over synthetic delivered sources; not native production delivery or live citation validation",
            "referenceFormat":if use_production_references {"production"} else {"synthetic-markdown"}, "repeats":repeats,
            "settings":settings, "preamble":preamble, "corpusSnapshot":corpus,
            "results":rows,
        })).unwrap()).unwrap();
            assert!(
                !failed,
                "Stopped after first provider/runtime failure; retained artifact has details"
            );
        }
    }
}
