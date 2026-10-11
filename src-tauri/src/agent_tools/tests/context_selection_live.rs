//! Opt-in paired experiment, always using disposable synthetic notes.
use super::live_behavior::{
    canonical, per_call_usage, save, saved_client, semantic_status_claims_match, BoundedModel,
};
use super::*;
use crate::agent_runtime::{AgentRuntimeObserver, AgentUsage};
use std::time::Duration;

const MODEL: &str = "gpt-6-luna";
const CASES: [&str; 6] = [
    "named_note",
    "selected_text",
    "long_link",
    "uncertain_actor",
    "cross_note_actor",
    "explicit_source_record",
];

#[test]
#[ignore = "Paid paired OpenAI synthetic evaluation; explicit opt-in and macOS Keychain required"]
fn openai_context_selection_comparison() {
    assert_eq!(
        std::env::var("GNEAUX_OPENAI_SELECTION_EVAL").as_deref(),
        Ok("1")
    );
    let output =
        PathBuf::from(std::env::var("GNEAUX_OPENAI_SELECTION_OUTPUT").expect("Report path"));
    assert!(output.is_absolute());
    let repeats: usize =
        std::env::var("GNEAUX_OPENAI_SELECTION_REPEATS").map_or(3, |s| s.parse().unwrap());
    assert!((1..=3).contains(&repeats));
    let start_repeat: usize =
        std::env::var("GNEAUX_OPENAI_SELECTION_START_REPEAT").map_or(1, |s| s.parse().unwrap());
    assert!((1..=repeats).contains(&start_repeat));
    // An explicit baseline selects the focused source-scope experiment. The original
    // four-case signal ablation stays available with its original corpus and checks.
    let baseline = std::env::var("GNEAUX_OPENAI_SELECTION_BASELINE_INSTRUCTIONS")
        .ok()
        .map(|path| fs::read_to_string(path).expect("Baseline instructions"));
    let interface_comparison = std::env::var("GNEAUX_OPENAI_SELECTION_SOURCE_GUIDANCE_EVAL")
        .is_ok_and(|value| value == "1");
    let reliability = std::env::var("GNEAUX_OPENAI_SELECTION_RELIABILITY_EVAL").ok();
    if let Some(kind) = &reliability {
        assert!([
            "coverage",
            "references",
            "scope",
            "holdout",
            "scope_holdout",
            "shortcuts"
        ]
        .contains(&kind.as_str()));
        assert!(
            baseline.is_none() && !interface_comparison,
            "Compare one variable at a time"
        );
    }
    let holdout = reliability
        .as_deref()
        .is_some_and(|kind| ["holdout", "scope_holdout", "shortcuts"].contains(&kind));
    let focused = baseline.is_some() || interface_comparison || reliability.is_some();
    let indices: &[usize] = if reliability.as_deref() == Some("scope_holdout") {
        &[3, 4, 5]
    } else if reliability.as_deref() == Some("shortcuts") {
        &[0, 1, 2]
    } else if holdout {
        &[0, 1, 2, 3, 4, 5]
    } else if interface_comparison || reliability.is_some() {
        &[5, 3, 4]
    } else if focused {
        &[3, 4]
    } else {
        &[0, 1, 2, 3]
    };
    let current = crate::chat::agent_preamble(&request().provider, true);
    if let Some(baseline) = &baseline {
        assert!(!baseline.trim().is_empty());
        assert_ne!(baseline.trim(), current);
    }
    let client = saved_client();
    let mut report = json!({
        "model":MODEL,"reasoningEffort":"provider default","repeats":repeats,"startRepeat":start_repeat,
        "method":"Paired signal ablation on the current implementation, not a full historical baseline. Same canonical identities per pair; fresh run/context per variant; alternating order. Real AgentRuntime streaming and tools; no research worker, web, UI or final durable chat completion. Only tool exchanges are logged; no reasoning or credentials.",
        "limits":{"cases":4,"variants":2,"repeats":repeats,"callsPerRun":6,"outputTokensPerCall":1024,"serializedBytesPerCall":64000,"secondsPerRun":60,"aggregateTokensPerRun":40000},
        "costRates":{"source":"https://developers.openai.com/api/docs/pricing","checked":"2026-10-09","usdPerMillion":{"input":0.10,"cachedInput":0.01,"cacheWrite":0.125,"output":0.50},"basis":"Standard short-context rates applied to provider-reported categories; not an invoice. Missing usage is unknown. No web/research charges."},
        "traceStages":"requests contains actual model-visible exchanges after ablation. toolLifecycle contains original executed tool presentations before ablation, including terminal/guard paths; 32 records and 64KB per record, oversized records explicitly marked.",
        "semanticReview":"Automated checks are smoke checks only. Manually inspect every answer, especially actor, September 18 event date, substep versus entire launch, and unspecified approver; citations establish delivered text, not entailment.",
        "cases":[]
    });
    if let Some(baseline) = &baseline {
        report["method"] = json!("Paired instruction comparison with current tools and coverage/reuse signals unchanged. Same canonical identities per pair; fresh run/context per variant; alternating order. Synthetic named-note and explicit cross-note questions share the same corpus, including an approval recorded outside the named note. Only tool exchanges are logged; no reasoning or credentials.");
        report["instructions"] = json!({"baseline":baseline.trim(),"current":current});
        report["traceStages"] = json!("requests contains actual model-visible tool exchanges, with no signal ablation. toolLifecycle contains original executed tool presentations, including terminal/guard paths; 32 records and 64KB per record, oversized records explicitly marked.");
        report["semanticReview"] = json!("Automated checks are smoke checks only. Manually review every claim and its citation: Priya finished checksum verification on September 18; entire-launch completion is unrecorded; the named retrospective leaves the approver unspecified, while cross-note investigation should find Mateo in approvals. Check complete named-source coverage before an absence claim and gathering outside the requested scope.");
    }
    if focused {
        report["semanticReview"] = json!("Automated checks are smoke checks only. Manually review every claim and its citation: Priya finished checksum verification on September 18; entire-launch completion is unrecorded; the strict named-source rubric expects an unspecified approver, while cross-note investigation should find Mateo. The named question has an ambiguous final clause; separate policy adherence from factual support. Check canonical coverage and gathering outside the intended scope.");
    }
    if interface_comparison {
        report["method"] = json!("Paired completion-hint ablation: identical original core instructions, tools, text, coverage and reuse signals; baseline removes only the Source scope interpretation rule at the model boundary. Same canonical identities per pair, fresh run/context, alternating order. The source-record question explicitly asks what the retrospective records; the cross-note question asks for a factual investigation. The original multipart factual question now expects the related approver with explicit note attribution, as clarified by the user. Original strict scores remain retained in the historical traces and instruction-comparison mode. All exact tool presentations retained.");
        report["semanticReview"] = json!("Review every claim and citation. Explicit source-record answers should identify Priya's checksum verification on September 18, preserve unrecorded entire-launch completion, and report the approver unrecorded in the retrospective after complete canonical coverage; an explicitly attributed supplementary finding from approvals is allowed. The multipart factual question should use Mateo's related approval and name Meridian approvals beside that finding. Explicit cross-note investigation should also find Mateo. Track pre/post-coverage unrelated gathering separately from factual support. Automated checks are smoke only.");
        if baseline.is_some() {
            report["method"] = json!("Paired before/after comparison of shared related-note attribution instructions plus once-per-evidence-session source-sufficiency guidance. Baseline uses the preserved original core and removes only the added Source scope rule; current uses both changes. Tools, canonical evidence, coverage and reuse remain identical. Same identities per pair; fresh contexts; alternating order. Explicit record, factual related-note, and explicit cross-note questions follow the user's clarified intent. Historical strict scores retained separately. This measures the combined change, not either component in isolation.");
        }
        report["instructions"] =
            json!({"baseline":baseline.as_deref().unwrap_or(&current).trim(),"current":current});
        report["traceStages"] = json!("requests contains actual model-visible exchanges after hint-only ablation. toolLifecycle retains original executed presentations including hints and terminal paths.");
    }
    if let Some(kind) = &reliability {
        report["method"] = json!(format!("Isolated {kind} comparison with identical current core instructions and current production tools/admission. Coverage baseline removes only wholeNoteComplete/nextReads and their description. Reference baseline expands only issued evidence selectors to durable IDs in model-visible results and prior calls. Scope compares preserved original, revised and removed Source scope rule with all coverage/references unchanged. Same canonical identities per case, fresh independent run/context per variant; alternating order. Synthetic corpus only, no web/research/UI or final chat completion."));
        report["variable"] = json!(kind);
        report["scopeRules"] = json!({"original":super::reliability_eval::ORIGINAL_SCOPE,"revised":super::reliability_eval::REVISED_SCOPE,"production":"revised"});
        report["instructions"] = json!({"allVariants":current});
        if kind == "scope" {
            report["revisedScope"] = json!(super::reliability_eval::REVISED_SCOPE);
        }
        report["semanticReview"] = json!("Manually review every answer and claim-level citation. Priya completed checksum verification on September 18; entire-launch completion is unrecorded. Explicit source-record questions need complete canonical retrospective coverage before claiming its approver omission; attributed supplementary Mateo finding allowed. Factual and cross-note questions should find Mateo from Meridian approvals; title-bearing citation attribution and explicit prose title are recorded separately. Count guards/failures and incomplete answers before costs. Evidence fields describe scoped reads, never real-world completeness.");
    }
    if holdout {
        report["method"] = json!("Current implementation only on held-out checks, not a causal comparison. Three shortcut/recovery cases reuse their original corpus with new questions. Three intent cases use new phrasings; absent-actor case deliberately omits the related approvals note. Same bounded real runtime/tools, disposable synthetic notes, no web/research/UI/final chat completion.");
        report["semanticReview"] = json!("Manually review all citations and claims. Named-note identifier SABLE-472; highlighted herb basil; recovery QUARTZ-908 beyond clipped linked body. Related factual question should find Mateo with source attribution and distinguish Priya's September 18 checksum verification from entire-launch completion. Absent-actor corpus contains no approvals note: keep approver unknown, and do not turn a search miss into an exhaustive vault absence. Source-record question restricts answer to retrospective; canonical coverage needed before claiming the approver is unnamed. Preserve exclusions and canonical bytes.");
    }
    if reliability.as_deref() == Some("scope_holdout") {
        report["method"] = json!("Paired preserved original versus revised Source scope rule on three held-out intent phrasings, with the absent-actor case omitting the approvals note. Identical current core, tools, coverage and references; same canonical identities per pair, fresh contexts and rotated order. Only the hint changes at the model boundary; production tools/admission stay current. Same finite caps and exact retained traces. Not a full historical replay.");
        report["revisedScope"] = json!(super::reliability_eval::REVISED_SCOPE);
    }
    let variants: &[&str] = match reliability.as_deref() {
        Some("coverage") => &["coverage_removed", "current"],
        Some("references") => &["canonical_ids", "current"],
        Some("scope") => &["scope_removed", "scope_revised", "scope_original"],
        Some("holdout" | "shortcuts") => &["current"],
        Some("scope_holdout") => &["scope_revised", "scope_original"],
        _ if focused => &["baseline", "current"],
        _ => &["signals_removed", "current"],
    };
    report["limits"]["variants"] = json!(variants.len());
    report["limits"]["cases"] = json!(indices.len());
    let mut failed = false;
    'matrix: for repeat in (start_repeat - 1)..repeats {
        for &index in indices {
            let name = if holdout {
                [
                    "heldout_named_note",
                    "heldout_selection",
                    "heldout_long_link",
                    "heldout_related_fact",
                    "heldout_absent_actor",
                    "heldout_source_record",
                ][index]
            } else {
                CASES[index]
            };
            let (vault, initial_context, _) = fixture();
            drop(initial_context);
            let garden = save(
                &vault,
                "Garden plan",
                "Water basil every morning.\nGarden-only code: FERN-831.\n",
            );
            let launch = save(
                &vault,
                "Meridian launch",
                "Launch code: SABLE-472.\nOwner: Priya.\n",
            );
            let long_body = format!("Meridian long plan.\n\n{}\nRecovery code: QUARTZ-908.\n", (0..45).map(|i| format!("Stage {i}: Keep the archived packing checklist for the launch rehearsal. This is background logistics, with no recovery credential.\n")).collect::<String>());
            let long = save(&vault, "Meridian long plan", &long_body);
            let actor = save(&vault, "Meridian retrospective", "On September 18, 2026, Priya finished checksum verification; deployment was approved.\nOn September 19, Anika planned the rollout.\nChecksum verification is one substep; the entire launch has no recorded completion.\n");
            let approval = (focused && !(holdout && index == 4)).then(|| save(&vault, "Meridian approvals", "Mateo approved deployment on September 18, 2026. This approval does not establish completion of the entire launch.\n"));
            let hidden = save(&vault, "Meridian private", "Private canary: HIDDEN-615.\n");
            vault
                .state
                .lexical
                .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
                .unwrap();
            let originals: Vec<_> = [&garden, &launch, &long, &actor, &hidden]
                .into_iter()
                .chain(approval.iter())
                .map(|id| (id.clone(), canonical(&vault, id)))
                .collect();
            let question = match index {
                0 => "What is the launch code in Meridian launch?",
                1 => "What plant should I water in the selected text?",
                2 => "What is the recovery code at the end of [[Meridian long plan]]?",
                5 => "What does Meridian retrospective record about Priya's work on September 18, completion of the entire launch, and the identity of the deployment approver? Use three bullets labeled Priya, Entire launch, and Deployment approver, with citations.",
                4 => "Investigate across the Meridian notes: what did Priya complete on September 18, is the entire launch recorded as complete, and who approved deployment? Use three bullets labeled Priya, Entire launch, and Deployment approver, with citations.",
                _ => "In Meridian retrospective, what did Priya complete on September 18? Is the entire launch recorded as complete, and who approved deployment? Use three bullets labeled Priya, Entire launch, and Deployment approver, with citations.",
            };
            let question = if holdout {
                match index {
                0 => "I need the launch identifier from the note titled Meridian launch. What is it?",
                1 => "From my highlighted passage, which herb needs watering?",
                2 => "Look at [[Meridian long plan]] and find the recovery credential near the end.",
                3 => "Meridian retrospective mentions deployment approval. Who gave that approval, what exactly did Priya finish on September 18, and does that establish the entire launch was completed? Use three bullets labeled Priya, Entire launch, and Deployment approver, with citations.",
                4 => "Across the Meridian notes, identify who approved deployment, what Priya finished on September 18, and whether the entire launch is documented as complete. State any unresolved fact. Use three bullets labeled Priya, Entire launch, and Deployment approver, with citations.",
                _ => "Report only what Meridian retrospective documents: Priya's September 18 accomplishment, whole-launch completion, and the name of the deployment approver. Keep any missing detail explicit. Use three bullets labeled Priya, Entire launch, and Deployment approver, with citations.",
            }
            } else {
                question
            };
            let mut order = variants.to_vec();
            order.rotate_left((index + repeat) % variants.len());
            for variant in order {
                let comparison = variant != "current";
                let omit_signals = !focused && comparison;
                let service =
                    ChatService::new(vault.notes.path().into(), vault.data.path().into()).unwrap();
                service
                    .set_note_excluded(&hidden, "Meridian private", true)
                    .unwrap();
                let (conversation, message, run) = service.test_tool_run();
                let raw = canonical(&vault, &garden);
                let context = AgentToolContext::with_host(
                    ToolHost::Test(vault.state.clone(), Arc::new(|_, _| {})),
                    service,
                    "selection-eval".into(),
                    run,
                    conversation,
                    message,
                    VaultAccess::Full,
                    Some(ActiveNoteSnapshot {
                        note_id: Some(garden.clone()),
                        title: "Garden plan".into(),
                        path: None,
                        body: note::strip_frontmatter(&raw).into(),
                        body_hash: content_hash(&raw),
                        selection: (index == 1).then(|| "Water basil every morning.".into()),
                    }),
                    HashSet::new(),
                    false,
                    None,
                );
                let mut input = request();
                input.model = MODEL.into();
                input.preamble = if comparison {
                    baseline.as_deref().unwrap_or(&current).trim().into()
                } else {
                    current.clone()
                };
                let hint = context.active_note_context().unwrap();
                let linked = context.explicit_wikilink_context(question).unwrap();
                let prompt = format!("{question}\n\nQuery reference instant, local timezone and editor date/time conventions: {}\n\n{hint}\n\nAllowed notes explicitly linked by the user:\n{linked}", context.query_anchor_label());
                input.prompt = rig_core::completion::Message::user(&prompt);
                let events = Arc::new(Mutex::new(Vec::<Value>::new()));
                let capture = events.clone();
                let observer = AgentRuntimeObserver {
                    evidence_context: None,
                    cancelled: Default::default(),
                    permissions: None,
                    on_event: Arc::new(move |event| {
                        if matches!(
                            event,
                            AgentEvent::StepUpdated { .. }
                                | AgentEvent::UsageUpdated { .. }
                                | AgentEvent::ToolCallUpdated { .. }
                                | AgentEvent::RunGuardTriggered { .. }
                        ) {
                            capture
                                .lock()
                                .unwrap()
                                .push(serde_json::to_value(event).unwrap());
                        }
                    }),
                };
                context.set_event_sink(observer.on_event.clone());
                let traces = Arc::new(Mutex::new(Vec::new()));
                let model = BoundedModel {
                    inner: client.responses(MODEL),
                    calls: Default::default(),
                    request_sizes: Default::default(),
                    traces: traces.clone(),
                    omit_signals,
                    omit_source_guidance: variant == "scope_removed"
                        || (reliability.is_none()
                            && if interface_comparison {
                                comparison
                            } else {
                                baseline.is_some()
                            }),
                    presentation: match variant {
                        "coverage_removed" => {
                            Some(super::reliability_eval::PresentationAblation::Coverage)
                        }
                        "canonical_ids" => {
                            Some(super::reliability_eval::PresentationAblation::References(
                                context.clone(),
                            ))
                        }
                        "scope_revised" => {
                            Some(super::reliability_eval::PresentationAblation::Scope(
                                super::reliability_eval::REVISED_SCOPE,
                            ))
                        }
                        "scope_original" => {
                            Some(super::reliability_eval::PresentationAblation::Scope(
                                super::reliability_eval::ORIGINAL_SCOPE,
                            ))
                        }
                        _ => None,
                    },
                };
                let lifecycle = Arc::new(Mutex::new(Vec::new()));
                let guard = crate::agent_guardrails::AgentRunGuard::new(
                    crate::agent_guardrails::AgentRunLimits {
                        max_elapsed: Duration::from_secs(60),
                        max_context_bytes: 64000,
                        max_tool_calls: 8,
                        max_aggregate_tokens: 40000,
                        max_repeated_tool_calls: 2,
                    },
                );
                println!("SELECTION START {name} {variant} repeat {}", repeat + 1);
                let result =
                    tauri::async_runtime::block_on(crate::agent_runtime::run_traced_test_model(
                        model,
                        input,
                        Some(context.clone()),
                        observer,
                        guard.clone(),
                        lifecycle.clone(),
                    ));
                let (answer, usage, error) = match result {
                    Ok(response) => (
                        context.render_passage_references(&response.output).unwrap(),
                        json!(AgentUsage::from(response.usage)),
                        None,
                    ),
                    Err(error) => (
                        String::new(),
                        Value::Null,
                        Some(safe_runtime_failure(&error)),
                    ),
                };
                let events = events.lock().unwrap().clone();
                let traces = traces.lock().unwrap().clone();
                let sources = context.sources();
                let expected_ids: Vec<&String> = if approval.is_some()
                    && (index == 4
                        || ((interface_comparison || reliability.is_some())
                            && matches!(index, 3 | 5)))
                {
                    vec![&actor, approval.as_ref().unwrap()]
                } else {
                    vec![match index {
                        0 => &launch,
                        1 => &garden,
                        2 => &long,
                        _ => &actor,
                    }]
                };
                let citations: Vec<_> = regex::Regex::new(r"\]\(passage:([^\)]+)\)")
                    .unwrap()
                    .captures_iter(&answer)
                    .map(|c| c[1].to_string())
                    .collect();
                let citations_valid = !citations.is_empty()
                    && citations.iter().all(|id| {
                        sources.iter().any(|s| {
                            s.passage.as_ref().is_some_and(|p| {
                                p.id == *id
                                    && expected_ids.iter().any(|expected| p.note_id == **expected)
                            })
                        })
                    })
                    && context.validate_context().is_ok();
                let correct = match index {
                    0 => answer.contains("SABLE-472"),
                    1 => answer.to_lowercase().contains("basil"),
                    2 => answer.contains("QUARTZ-908"),
                    3 if interface_comparison || reliability.is_some() => {
                        answer.contains("Mateo")
                            && answer.to_lowercase().contains("meridian approvals")
                    }
                    // Cross-note smoke only; manually review all three claims and
                    // claim-level citations in both variants before reporting quality.
                    4 if holdout => semantic_status_claims_match(&answer),
                    4 => {
                        answer.contains("Mateo")
                            && answer.to_lowercase().contains("checksum verification")
                    }
                    _ => semantic_status_claims_match(&answer),
                };
                let unchanged = originals
                    .iter()
                    .all(|(id, raw)| canonical(&vault, id) == *raw);
                let privacy = !answer.contains("HIDDEN-615")
                    && !serde_json::to_string(&traces)
                        .unwrap()
                        .contains("HIDDEN-615")
                    && !sources.iter().any(|s| s.note_id.as_ref() == Some(&hidden));
                let passed = error.is_none() && correct && citations_valid && unchanged && privacy;
                let per_call = per_call_usage(&events);
                let stats = guard.stats();
                report["cases"].as_array_mut().unwrap().push(json!({"name":name,"variant":variant,"repeat":repeat+1,
                    "question":question,"promptComponentBytes":{"question":question.len(),"hint":hint.len(),"linked":linked.len()},
                    "answer":answer,"usage":usage,"perCallUsage":per_call,"runtimeError":error,"requests":traces,
                    "events":events,"toolLifecycle":lifecycle.lock().unwrap().clone(),"sources":sources,"stats":{"modelCalls":stats.model_calls,"toolCalls":stats.tool_calls,"elapsedMillis":stats.elapsed_millis},
                    "checks":{"passed":passed,"answer":correct,"citations":citations_valid,"canonicalUnchanged":unchanged,"privacy":privacy}}));
                fs::write(&output, serde_json::to_string_pretty(&report).unwrap()).unwrap();
                println!(
                    "SELECTION DONE {name} {variant} repeat {} passed={passed}",
                    repeat + 1
                );
                if error.is_some_and(|code| code == "runtime_failed") {
                    failed = true;
                    break 'matrix;
                }
            }
        }
    }
    assert!(
        !failed,
        "Runtime failure: inspect fixed failure marker and partial usage in the synthetic report"
    );
    assert_eq!(
        report["cases"].as_array().unwrap().len(),
        (repeats - start_repeat + 1) * indices.len() * variants.len()
    );
    assert!(
        report["cases"]
            .as_array()
            .unwrap()
            .iter()
            .all(|case| case["checks"]["passed"] == true),
        "Synthetic quality checks failed; manually review answers independently"
    );
}

// Never retain provider error text, which can contain request/credential details.
fn safe_runtime_failure(error: &str) -> &'static str {
    if error.contains("Live evaluation call limit") {
        "model_call_limit"
    } else if error.contains("Live evaluation request limit") {
        "request_byte_limit"
    } else if error.contains("time limit") {
        "time_limit"
    } else if error.contains("The agent stopped after reaching its tool-call limit.") {
        "tool_call_limit"
    } else if error.contains("The agent stopped after reaching its token budget.") {
        "token_limit"
    } else if error.contains("The model context limit was reached.") {
        "context_limit"
    } else if error.contains("The agent stopped because it repeated ")
        && error.contains("with the same input.")
    {
        "repeated_tool_limit"
    } else {
        "runtime_failed"
    }
}

#[test]
fn synthetic_matrix_retains_guard_outcomes_without_retaining_error_text() {
    for (error, code) in [
        ("Live evaluation call limit", "model_call_limit"),
        ("Live evaluation request limit", "request_byte_limit"),
        (
            "The agent stopped after reaching its time limit.",
            "time_limit",
        ),
        (
            "The agent stopped after reaching its tool-call limit.",
            "tool_call_limit",
        ),
        (
            "The agent stopped after reaching its token budget.",
            "token_limit",
        ),
        (
            "The model context limit was reached. Narrow the task or reduce attachments.",
            "context_limit",
        ),
        (
            "The agent stopped because it repeated read_notes with the same input.",
            "repeated_tool_limit",
        ),
        ("Provider failure PRIVATE_ERROR_CANARY", "runtime_failed"),
    ] {
        assert_eq!(safe_runtime_failure(error), code);
    }
}
