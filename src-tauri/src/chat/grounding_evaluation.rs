//! Controlled synthesis comparison through the real streaming AgentRuntime.
//! Retrieval is held fixed; source IDs below are synthetic, not live grants.
use super::agent_preamble;
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

const RULES: &str = include_str!("answer_grounding.txt");

#[test]
#[ignore = "requires the explicitly selected local provider; synthetic grounding comparison"]
fn live_answer_grounding_comparison() {
    let endpoint = std::env::var("GNEAUX_LIVE_ENDPOINT").expect("explicit local endpoint");
    let model = std::env::var("GNEAUX_LIVE_MODEL").expect("explicit model");
    let output = std::env::var("GNEAUX_LIVE_OUTPUT").expect("output path");
    crate::agent_runtime::validate_local_base_url(&endpoint).unwrap();
    let fixture_json = std::env::var("GNEAUX_GROUNDING_FIXTURE")
        .map(|path| fs::read_to_string(path).expect("read grounding fixture"))
        .unwrap_or_else(|_| include_str!("grounding_fixtures.json").to_string());
    let fixture: Value = serde_json::from_str(&fixture_json).unwrap();
    let cases: Vec<Value> = match fixture {
        Value::Array(cases) => cases,
        case @ Value::Object(_) => vec![case],
        _ => panic!("grounding fixture must contain cases"),
    };
    let filter = std::env::var("GNEAUX_LIVE_CASE").ok();
    let repeats: usize = std::env::var("GNEAUX_LIVE_REPEATS").map_or(1, |s| s.parse().unwrap());
    assert!(
        (1..=3).contains(&repeats),
        "one to three paired repetitions"
    );
    let cases: Vec<_> = cases
        .into_iter()
        .filter(|c| filter.as_ref().is_none_or(|f| c["id"] == *f))
        .collect();
    assert!(!cases.is_empty(), "no grounding cases match the filter");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    // After adoption, stripping only the exact added suffix retains an explicit
    // baseline of the former production prompt for repeatable A/B comparisons.
    let current = agent_preamble(&AgentProvider::Local, false);
    let base = current.strip_suffix(RULES).unwrap_or(&current);
    let baseline_rules = std::env::var("GNEAUX_GROUNDING_BASELINE_INSTRUCTIONS")
        .map(|path| fs::read_to_string(path).expect("read baseline grounding instructions"))
        .unwrap_or_default();
    let baseline = format!("{base}{baseline_rules}");
    let rules = std::env::var("GNEAUX_GROUNDING_INSTRUCTIONS")
        .map(|path| fs::read_to_string(path).expect("read explicit grounding instructions"))
        .unwrap_or_else(|_| RULES.to_string());
    let candidate = format!("{base}{rules}");
    let mut rows = Vec::new();
    for repeat in 0..repeats {
        for (index, case) in cases.iter().enumerate() {
            // Alternate order; do not attribute cache/order effects to policy.
            let variants = if (index + repeat) % 2 == 0 {
                [false, true]
            } else {
                [true, false]
            };
            for refined in variants {
                let label = if refined { "refined" } else { "baseline" };
                println!(
                    "GROUNDING START {} {label} repeat {}",
                    case["id"],
                    repeat + 1
                );
                let start = Instant::now();
                let response = runtime.block_on(AgentRuntime::run(
                    AgentRuntimeRequest {
                        provider: AgentProvider::Local,
                        model: model.clone(), api_key: None, local_base_url: endpoint.clone(),
                        preamble: if refined { candidate.clone() } else { baseline.clone() },
                        prompt: rig_core::completion::Message::user(json!({
                            "question": case["question"], "currentEvidence": case["sources"], "resolvedPeriod":case["resolvedPeriod"],
                            "responseInstruction": "Answer the question concisely using the supplied current evidence and its citation links."
                        }).to_string()),
                        history: vec![], enable_web: false, require_web: false, flex: false,
                        reasoning_effort: Some("medium".into()),
                    },
                    None,
                    AgentRuntimeObserver {
                        cancelled: tokio_util::sync::CancellationToken::new(),
                        on_event: Arc::new(|_| {}), permissions: None,
                    },
                    AgentRunGuard::new(AgentRunLimits { max_elapsed: Duration::from_secs(90), ..Default::default() }),
                ));
                let mut row = json!({"case":case["id"],"variant":label,"repeat":repeat+1,"latencyMillis":start.elapsed().as_millis(),"rubric":case["expected"]});
                match response {
                    Ok(answer) => {
                        row["status"] = json!("complete");
                        row["answer"] = json!(answer.output);
                        row["usage"] = json!(answer.usage);
                    }
                    Err(error) => {
                        row["status"] = json!("failed");
                        row["error"] = json!(error.to_string());
                    }
                }
                println!("GROUNDING DONE {} {label}: {}", case["id"], row["status"]);
                rows.push(row);
                fs::write(&output, serde_json::to_string_pretty(&json!({
                    "endpoint":endpoint,"model":model,"method":"actual AgentRuntime, fixed synthetic evidence, no retrieval/tools or live citation validation; manual rubric grading",
                    "baselinePreamble":baseline,"candidatePreamble":candidate,"cases":cases,"results":rows
                })).unwrap()).unwrap();
            }
        }
    }
    assert!(
        rows.iter().all(|r| r["status"] == "complete"),
        "See grounding artifact for runtime failures; answer quality is graded separately"
    );
}
