// THROWAWAY: included temporarily in chat::citation_evaluation by run.py.
// Reuses the actual runtime and reference renderer, with no executable tools.
fn prototype_schema(input: &Value) -> Value {
    let ids: Vec<_> = input["evidence"]["items"].as_array().unwrap().iter()
        .filter_map(|item| item["citation"].as_str())
        .map(|reference| reference.trim_matches(['[', ']']).to_string()).collect();
    json!({"type":"object","additionalProperties":false,"required":["segments"],
        "properties":{"segments":{"type":"array","minItems":1,"maxItems":24,
            "items":{"type":"object","additionalProperties":false,"required":["text","sources"],
                "properties":{"text":{"type":"string"},"sources":{"type":"array",
                    "uniqueItems":true,"items":{"type":"string","enum":ids}}}}}}})
}

fn prototype_render(raw: &str, input: &Value, references: &PassageReferences,
    sources: &[ChatSource]) -> Result<(String, Value), String> {
    let parsed: Value = serde_json::from_str(raw).map_err(|_| "Not a JSON result")?;
    let object = parsed.as_object().ok_or("Result is not an object")?;
    if object.len() != 1 || !object.contains_key("segments") { return Err("Unknown result fields".into()); }
    let segments = parsed["segments"].as_array().ok_or("Missing segments")?;
    if segments.is_empty() || segments.len() > 24 { return Err("Invalid segment count".into()); }
    let mut markdown = Vec::new();
    let mut associations = Vec::new();
    for segment in segments {
        let object = segment.as_object().ok_or("Invalid segment")?;
        if object.len() != 2 || !object.contains_key("text") || !object.contains_key("sources") {
            return Err("Unknown segment fields".into());
        }
        let text = segment["text"].as_str().filter(|s| !s.trim().is_empty()).ok_or("Empty segment text")?;
        let selected = segment["sources"].as_array().ok_or("Invalid source list")?;
        let mut seen = std::collections::HashSet::new();
        let mut links = Vec::new();
        let mut passage_ids = Vec::new();
        for selected in selected {
            let id = selected.as_str().ok_or("Source is not an ID")?;
            if !seen.insert(id) { return Err("Duplicate source".into()); }
            let marker = format!("[{id}]");
            let item = input["evidence"]["items"].as_array().unwrap().iter()
                .find(|item| item["citation"] == marker).ok_or("Source not issued for this answer")?;
            let link = references.render(&marker, sources);
            if !link.contains("](passage:") { return Err("Source no longer delivered".into()); }
            links.push(link);
            passage_ids.push(item["id"].clone());
        }
        // A table or paragraph is one segment; its sources explicitly apply to that segment.
        let separator = if text.contains('\n') { "\n\n" } else { " " };
        let rendered_text = references.render(text, sources);
        markdown.push(if links.is_empty() { rendered_text } else {
            format!("{rendered_text}{separator}{}", links.join(" "))
        });
        associations.push(json!({"text":text,"sourceIds":selected,"passageIds":passage_ids}));
    }
    Ok((markdown.join("\n\n"), json!(associations)))
}

#[test]
#[ignore = "explicit paid disposable paired structured-answer prototype"]
fn live_structured_answer_prototype() {
    assert_eq!(std::env::var("GNEAUX_CITATION_LIVE").as_deref(), Ok("1"));
    let settings: Value = serde_json::from_str(&fs::read_to_string(
        std::env::var("GNEAUX_CITATION_SETTINGS").unwrap()).unwrap()).unwrap();
    assert_eq!(settings["provider"], "openai");
    let key = std::env::var("OPENAI_API_KEY").expect("in-memory credential");
    let corpus: Value = serde_json::from_str(&fs::read_to_string(
        std::env::var("GNEAUX_CITATION_CORPUS").unwrap()).unwrap()).unwrap();
    let output = std::env::var("GNEAUX_LIVE_OUTPUT").unwrap();
    assert!(!std::path::Path::new(&output).exists(), "Never overwrite paid results");
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 6);
    let baseline = fs::read_to_string(std::env::var("GNEAUX_CITATION_PREAMBLE").unwrap()).unwrap();
    let old = "Cite exact returned [S#] references; the app builds links.";
    assert!(baseline.ends_with(old));
    let structured = baseline.strip_suffix(old).unwrap().to_string() +
        "Submit your answer through the final-result tool as {\"segments\":[{\"text\":\"answer text\",\"sources\":[\"S1\"]}]}. Each segment is a complete Markdown paragraph, list item, or table. Its sources apply to the claims in that segment. Use exact supplied S IDs without brackets in sources; do not write citation markers or source links in text. Use an empty sources array for text that needs no source.";
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let mut rows = Vec::new();
    let mut total_tokens = 0;
    for (index, case) in corpus["cases"].as_array().unwrap().iter().enumerate() {
        // Alternate order to reduce systematic first/second-arm cache/timing bias.
        let arms = if index % 2 == 0 { ["markdown", "structured"] } else { ["structured", "markdown"] };
        for arm in arms {
            assert!(total_tokens < 40_000, "Stop before another request after observed pilot cap");
            let mut input = synthesis_input(case);
            let (references, sources) = production_references(&mut input);
            let schema = (arm == "structured").then(|| prototype_schema(&input));
            let preamble = if arm == "structured" { &structured } else { &baseline };
            let events = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
            let saved_events = events.clone();
            let start = Instant::now();
            let clock = start;
            let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let observed_calls = calls.clone();
            let cancelled = tokio_util::sync::CancellationToken::new();
            let cancel_after_calls = cancelled.clone();
            println!("PROTOTYPE START {} {arm}", case["id"]);
            let result = runtime.block_on(AgentRuntime::run(AgentRuntimeRequest {
                provider: AgentProvider::Openai, model: settings["model"].as_str().unwrap().into(),
                api_key: Some(key.clone()), local_base_url: String::new(), output_schema: schema.clone(),
                preamble: preamble.clone(), prompt: rig_core::completion::Message::user(input.to_string()),
                history: vec![], enable_web: false, require_web: false,
                flex: settings["service_tier"] == "flex",
                reasoning_effort: Some(settings["reasoning_effort"].as_str().unwrap().into()),
            }, None, AgentRuntimeObserver {
                evidence_context: None, cancelled, permissions: None,
                on_event: Arc::new(move |event| {
                    use crate::agent_runtime::AgentEvent;
                    let kind = match event {
                        AgentEvent::TextDelta { .. } => "textDelta",
                        AgentEvent::ModelTurnRetried { .. } => "modelTurnRetried",
                        AgentEvent::StepUpdated { ref status, .. } if status == "running" => {
                            if observed_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) >= 2 {
                                cancel_after_calls.cancel();
                            }
                            "modelStarted"
                        },
                        AgentEvent::StepUpdated { .. } => "stepUpdated",
                        AgentEvent::UsageUpdated { .. } => "usageUpdated",
                        _ => "other",
                    };
                    saved_events.lock().unwrap().push(json!({"type":kind,"millis":clock.elapsed().as_millis()}));
                }),
            }, AgentRunGuard::new(AgentRunLimits {
                max_elapsed: Duration::from_secs(90), max_aggregate_tokens: 8_000, max_tool_calls: 2,
                ..Default::default()
            })));
            let mut row = json!({"caseId":case["id"],"variant":arm,"input":input,
                "preamble":preamble,"schema":schema,"latencyMillis":start.elapsed().as_millis(),
                "events":events.lock().unwrap().clone(),"citationSources":sources});
            let failed = result.is_err();
            match result {
                Ok(answer) => {
                    total_tokens += answer.usage.total_tokens;
                    row["status"] = json!("complete");
                    row["rawAnswer"] = json!(answer.output);
                    row["usage"] = json!(answer.usage);
                    row["modelCalls"] = json!(answer.stats.model_calls);
                    if arm == "structured" {
                        match prototype_render(&answer.output, &input, &references, &sources) {
                            Ok((rendered, associations)) => { row["answer"] = json!(rendered); row["associations"] = associations; row["formatValid"] = json!(true); },
                            Err(error) => { row["formatValid"] = json!(false); row["validationError"] = json!(error); },
                        }
                    } else { row["answer"] = json!(references.render(&answer.output, &sources)); }
                },
                Err(error) => { row["status"] = json!("failed"); row["error"] = json!(error); },
            }
            println!("PROTOTYPE DONE {} {arm} {}", case["id"], row["status"]);
            rows.push(row);
            fs::write(&output, serde_json::to_string_pretty(&json!({
                "method":"Paired pilot through actual AgentRuntime; same fixed evidence, production reference prepare/render, no executable tools or vault. Structured arm uses existing Tool formatter, not provider-native strict response_format. One sample per arm/case; not native/E2E or a reliability estimate.",
                "settings":settings,"corpusSnapshot":corpus,"results":rows,
                "limits":{"cases":6,"arms":2,"maxSecondsPerAnswer":90,"observedTokensPerAnswer":8000,"observedPilotTokenCap":40000,"note":"Usage limits are observed after requests; cancellation on third model-start is best effort. No provider failure retry or tier switch."}
            })).unwrap()).unwrap();
            assert!(!failed, "Stopped after provider/runtime failure; artifact retained");
        }
    }
}
