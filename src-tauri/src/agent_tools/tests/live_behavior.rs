//! Opt-in paid smoke evaluation: real streaming runner/tools, disposable vaults.
//! No application vault, credential value, or private reasoning enters the report.
use super::*;
use crate::agent_runtime::{AgentRuntimeObserver, AgentUsage};
use rig_core::{
    completion::CompletionRequest,
    driver::{Exchange, Model, Opening, Transport},
    error::{EncodeError, ProviderError as CompletionError},
    operation::Completion,
    providers::openai,
    wire::{Descriptor, Mode, Wire},
    DynModel,
};
use std::time::Duration;

const MODEL: &str = "gpt-6-luna";
const CASES: [&str; 8] = [
    "greeting",
    "selection",
    "different_note",
    "followup",
    "deadlines",
    "reviewed_edit",
    "semantic_status",
    "reviewed_rewrite",
];

#[derive(Clone)]
pub(super) struct BoundedModel<M> {
    pub(super) inner: M,
    pub(super) calls: Arc<AtomicUsize>,
    pub(super) request_sizes: Arc<Mutex<Vec<usize>>>,
    pub(super) traces: Arc<Mutex<Vec<Value>>>,
    pub(super) omit_signals: bool,
    pub(super) omit_source_guidance: bool,
    pub(super) presentation: Option<super::reliability_eval::PresentationAblation>,
}

impl<M> BoundedModel<M> {
    fn admit(&self, request: &mut CompletionRequest) -> Result<(), CompletionError> {
        if self.calls.fetch_add(1, Ordering::SeqCst) >= 6 {
            return Err(CompletionError::Provider(
                "Live evaluation call limit".into(),
            ));
        }
        if self.omit_signals {
            ablate_signals(request);
        }
        if self.omit_source_guidance {
            omit_source_guidance(request);
        }
        if let Some(presentation) = &self.presentation {
            presentation.apply(request);
        }
        request.max_tokens = Some(1024);
        let bytes = serde_json::to_vec(request).unwrap().len();
        if bytes > 64_000 {
            return Err(CompletionError::Provider(
                "Live evaluation request limit".into(),
            ));
        }
        self.request_sizes.lock().unwrap().push(bytes);
        self.traces.lock().unwrap().push(trace_request(request));
        Ok(())
    }
}

#[derive(Clone)]
struct BoundedWire<W>(BoundedModel<W>);
#[derive(Clone)]
struct BoundedTransport<T>(T);
impl<W: Wire<Op = Completion>> Wire for BoundedWire<W> {
    type Op = Completion;
    type Payload = W::Payload;
    type Frame = W::Frame;
    type Decoder<'id> = W::Decoder<'id>;
    type Reassembler = W::Reassembler;
    fn describe(&self) -> Descriptor<'_> {
        self.0.inner.describe()
    }
    fn encode(
        &self,
        mut request: CompletionRequest,
        mode: Mode,
    ) -> Result<Self::Payload, EncodeError> {
        self.0
            .admit(&mut request)
            .map_err(|e| EncodeError::request(e))?;
        self.0.inner.encode(request, mode)
    }
    fn decoder<'id>(&self) -> Self::Decoder<'id> {
        self.0.inner.decoder()
    }
    fn reassembler(&self) -> Self::Reassembler {
        self.0.inner.reassembler()
    }
}
impl<W: Wire<Op = Completion>, T: Transport<W>> Transport<BoundedWire<W>> for BoundedTransport<T> {
    fn send(&self, payload: W::Payload, exchange: Exchange) -> Opening<W::Frame> {
        self.0.send(payload, exchange)
    }
}
impl<W: Wire<Op = Completion>, T: Transport<W>> From<BoundedModel<Model<W, T>>>
    for DynModel<Completion>
{
    fn from(value: BoundedModel<Model<W, T>>) -> Self {
        let wire = BoundedWire(BoundedModel {
            inner: value.inner.wire,
            calls: value.calls,
            request_sizes: value.request_sizes,
            traces: value.traces,
            omit_signals: value.omit_signals,
            omit_source_guidance: value.omit_source_guidance,
            presentation: value.presentation,
        });
        Model::new(wire, BoundedTransport(value.inner.transport)).erase()
    }
}

// Capture only tool calls/results, never assistant text or reasoning blocks.
fn trace_request(request: &CompletionRequest) -> Value {
    use rig_core::completion::message::{AssistantContent, UserContent};
    let mut exchanges = Vec::new();
    for message in request.chat_history.iter() {
        match message {
            rig_core::completion::Message::Assistant(rig_core::completion::AssistantMessage {
                content,
                ..
            }) => {
                for part in content.iter() {
                    if let AssistantContent::ToolCall(call) = part {
                        exchanges.push(json!({"type":"toolcall","id":call.id,"callId":call.id,"function":call.function}));
                    }
                }
            }
            rig_core::completion::Message::User { content } => {
                for part in content.iter() {
                    if let UserContent::ToolResult(result) = part {
                        exchanges.push(json!({"type":"toolresult","id":result.call,"callId":result.call,"content":result.content}));
                    }
                }
            }
            _ => {}
        }
    }
    json!({"measurement":crate::agent_runtime::measure_synthetic_request(request),"toolExchanges":exchanges})
}

// Isolate the once-per-session completion rule, preserving coverage and text.
fn omit_source_guidance(request: &mut CompletionRequest) {
    use rig_core::completion::message::{ToolResultContent, UserContent};
    fn strip(value: &mut Value) {
        if let Some(guidance) = value["interpretationGuidance"].as_array_mut() {
            guidance.retain(|rule| {
                !rule
                    .as_str()
                    .is_some_and(|s| s.starts_with("Source scope: "))
            });
        }
    }
    for message in request.chat_history.iter_mut() {
        if let rig_core::completion::Message::User { content } = message {
            for part in content.iter_mut() {
                if let UserContent::ToolResult(result) = part {
                    for part in result.content.iter_mut() {
                        match part {
                            ToolResultContent::Json { value } => strip(value),
                            ToolResultContent::Text(text) => {
                                if let Ok(mut value) = serde_json::from_str::<Value>(&text.text) {
                                    strip(&mut value);
                                    text.text = value.to_string();
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }
}

// Test-only ablation, not a historical production implementation. Remove just
// the new presentation signals after real tools/admission have run normally.
fn ablate_signals(request: &mut CompletionRequest) {
    use rig_core::completion::message::{ToolResultContent, UserContent};
    for tool in &mut request.tools {
        tool.description = tool.description
            .replace("coverage.complete applies to coverage.scope across pages. ", "")
            .replace("Previews are not citable; reuse prior reads or read_notes purpose=answer. alreadyRead is prior text overlap, not provenance.", "Previews are not citable; read_notes purpose=answer before citing.");
    }
    for message in request.chat_history.iter_mut() {
        if let rig_core::completion::Message::User { content } = message {
            for part in content.iter_mut() {
                match part {
                    UserContent::ToolResult(result) => {
                        for part in result.content.iter_mut() {
                            match part {
                                ToolResultContent::Text(text) => {
                                    if let Ok(mut value) = serde_json::from_str::<Value>(&text.text)
                                    {
                                        remove_signals(&mut value);
                                        text.text = value.to_string();
                                    }
                                }
                                ToolResultContent::Json { value } => remove_signals(value),
                                _ => {}
                            }
                        }
                    }
                    UserContent::Text(text) => {
                        text.text = text
                            .text
                            .lines()
                            .filter(|line| !line.starts_with("coverage: {"))
                            .collect::<Vec<_>>()
                            .join("\n");
                    }
                    _ => {}
                }
            }
        }
    }
}

fn remove_signals(value: &mut Value) {
    if let Some(items) = value["items"].as_array_mut() {
        for item in items {
            item.as_object_mut().unwrap().remove("alreadyRead");
        }
    }
    if value["coverage"]["scope"] == "canonical_note"
        || value["coverage"]["scope"] == "selected_passages"
    {
        value["coverage"] = json!({"meaning":"Selected passages or one canonical note; does not claim all work or retained history"});
    }
    for field in ["coverage", "delivery"] {
        if let Some(object) = value[field].as_object_mut() {
            object.remove("kind");
        }
    }
}

pub(super) fn save(vault: &crate::test_support::TestVault, title: &str, body: &str) -> String {
    crate::test_support::save_and_finalize(&vault.state, title.into(), body.into(), None)
        .unwrap()
        .unwrap()
        .note_id
        .unwrap()
}

pub(super) fn canonical(vault: &crate::test_support::TestVault, id: &str) -> String {
    let path = vault
        .state
        .notes_index
        .lock()
        .unwrap()
        .get_note_by_note_id(id)
        .unwrap()
        .0
        .clone();
    fs::read_to_string(path).unwrap()
}

#[test]
fn live_evaluation_caps_requests_before_provider_dispatch() {
    use rig_core::test_utils::{MockCompletionModel, MockTurn};
    let inner = MockCompletionModel::from_turns([MockTurn::text("unused")]);
    let mut request = rig_core::completion::CompletionRequest::new("small");
    let bounded = BoundedModel {
        inner,
        calls: Arc::new(AtomicUsize::new(0)),
        request_sizes: Default::default(),
        traces: Default::default(),
        omit_signals: false,
        omit_source_guidance: false,
        presentation: None,
    };
    for _ in 0..6 {
        bounded.admit(&mut request).unwrap();
    }
    assert_eq!(request.max_tokens, Some(1024));
    assert!(bounded.admit(&mut request).is_err());
    let inner = MockCompletionModel::from_turns([MockTurn::text("unused")]);
    let mut large = rig_core::completion::CompletionRequest::new("x".repeat(64_001));
    let bounded = BoundedModel {
        inner,
        calls: Arc::new(AtomicUsize::new(0)),
        request_sizes: Default::default(),
        traces: Default::default(),
        omit_signals: false,
        omit_source_guidance: false,
        presentation: None,
    };
    assert!(bounded.admit(&mut large).is_err());
    assert!(bounded.request_sizes.lock().unwrap().is_empty());
}

#[test]
fn synthetic_trace_keeps_exact_tools_and_sizes_without_reasoning() {
    use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
    let (_vault, context, id) = fixture();
    let args = json!({"purpose":"answer","note_id":id});
    let inner = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::reasoning("PRIVATE_REASONING_CANARY"),
            MockStreamEvent::tool_call("read-1", "read_notes", args.clone()),
            MockStreamEvent::final_response(
                rig_core::completion::Usage::default()
                    .input_tokens(100)
                    .output_tokens(5)
                    .total_tokens(105),
            ),
        ],
        vec![
            MockStreamEvent::text("Done"),
            MockStreamEvent::final_response(
                rig_core::completion::Usage::default()
                    .input_tokens(200)
                    .output_tokens(7)
                    .total_tokens(207),
            ),
        ],
    ]);
    let events = Arc::new(Mutex::new(Vec::new()));
    let capture = events.clone();
    let traces = Arc::new(Mutex::new(Vec::new()));
    let bounded = BoundedModel {
        inner: inner.clone(),
        calls: Default::default(),
        request_sizes: Default::default(),
        traces: traces.clone(),
        omit_signals: false,
        omit_source_guidance: false,
        presentation: None,
    };
    tauri::async_runtime::block_on(crate::agent_runtime::run_test_model(
        bounded,
        request(),
        Some(context.clone()),
        AgentRuntimeObserver {
            evidence_context: None,
            cancelled: Default::default(),
            permissions: None,
            on_event: Arc::new(move |event| {
                capture
                    .lock()
                    .unwrap()
                    .push(serde_json::to_value(event).unwrap())
            }),
        },
        crate::agent_guardrails::AgentRunGuard::new(Default::default()),
    ))
    .unwrap();
    let calls = per_call_usage(&events.lock().unwrap());
    assert_eq!(
        calls
            .iter()
            .map(|e| e["usage"]["inputTokens"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        vec![100, 200]
    );
    let traces = traces.lock().unwrap();
    assert_eq!(traces.len(), 2);
    assert!(!serde_json::to_string(&*traces)
        .unwrap()
        .contains("PRIVATE_REASONING_CANARY"));
    assert!(
        traces[0]["measurement"]["componentBytes"]["tools"]
            .as_u64()
            .unwrap()
            > 0
    );
    let exchanges = traces[1]["toolExchanges"].as_array().unwrap();
    assert_eq!(exchanges[0]["function"]["arguments"], args);
    let result = &exchanges[1]["content"][0];
    let envelope: Value = result
        .get("value")
        .cloned()
        .unwrap_or_else(|| serde_json::from_str(result["text"].as_str().unwrap()).unwrap());
    assert_eq!(envelope["coverage"]["scope"], "canonical_note");
    assert_eq!(envelope["coverage"]["complete"], true);
    assert_eq!(envelope["items"][0]["alreadyRead"], "none");
    // Isolate each reliability candidate on the actual model-visible envelope.
    for candidate in [
        super::reliability_eval::PresentationAblation::Coverage,
        super::reliability_eval::PresentationAblation::References(context.clone()),
        super::reliability_eval::PresentationAblation::Scope(
            super::reliability_eval::ORIGINAL_SCOPE,
        ),
        super::reliability_eval::PresentationAblation::Scope(
            super::reliability_eval::REVISED_SCOPE,
        ),
    ] {
        let mut request = inner.requests()[1].clone();
        candidate.apply(&mut request);
        let trace = trace_request(&request);
        let result = &trace["toolExchanges"][1]["content"][0];
        let actual: Value = result
            .get("value")
            .cloned()
            .unwrap_or_else(|| serde_json::from_str(result["text"].as_str().unwrap()).unwrap());
        let mut expected = envelope.clone();
        match candidate {
            super::reliability_eval::PresentationAblation::Coverage => {
                let coverage = expected["coverage"].as_object_mut().unwrap();
                assert!(coverage.remove("wholeNoteComplete").is_some());
                assert!(coverage.remove("nextReads").is_some());
                assert!(request.tools.iter().all(|t| !t
                    .description
                    .contains(super::reliability_eval::COVERAGE_DESCRIPTION)));
            }
            super::reliability_eval::PresentationAblation::References(_) => {
                for item in expected["items"].as_array_mut().unwrap() {
                    item["evidenceId"] = json!(
                        context
                            .resolve_evidence_ids(vec![item["evidenceId"].as_str().unwrap().into()])
                            .unwrap()[0]
                    );
                }
            }
            super::reliability_eval::PresentationAblation::Scope(rule_text) => {
                for rule in expected["interpretationGuidance"].as_array_mut().unwrap() {
                    if rule.as_str().unwrap().starts_with("Source scope: ") {
                        *rule = json!(rule_text);
                    }
                }
            }
        }
        assert_eq!(actual, expected);
        assert_eq!(trace["toolExchanges"][0]["function"]["arguments"], args);
    }
    let mut hint_baseline_request = inner.requests()[1].clone();
    omit_source_guidance(&mut hint_baseline_request);
    let hint_trace = trace_request(&hint_baseline_request);
    let result = &hint_trace["toolExchanges"][1]["content"][0];
    let hint_ablated: Value = result
        .get("value")
        .cloned()
        .unwrap_or_else(|| serde_json::from_str(result["text"].as_str().unwrap()).unwrap());
    let mut expected = envelope.clone();
    let rules = expected["interpretationGuidance"].as_array_mut().unwrap();
    let before = rules.len();
    rules.retain(|rule| !rule.as_str().unwrap().starts_with("Source scope: "));
    assert_eq!(before - rules.len(), 1);
    assert_eq!(
        hint_ablated, expected,
        "Only the source-scope rule may change"
    );
    assert_eq!(
        hint_trace["toolExchanges"][0]["function"]["arguments"],
        args
    );
    let mut ablated_request = inner.requests()[1].clone();
    let baseline = BoundedModel {
        inner,
        calls: Default::default(),
        request_sizes: Default::default(),
        traces: Default::default(),
        omit_signals: true,
        omit_source_guidance: false,
        presentation: None,
    };
    baseline.admit(&mut ablated_request).unwrap();
    let trace = baseline.traces.lock().unwrap();
    let result = &trace[0]["toolExchanges"][1]["content"][0];
    let ablated: Value = result
        .get("value")
        .cloned()
        .unwrap_or_else(|| serde_json::from_str(result["text"].as_str().unwrap()).unwrap());
    assert!(ablated["coverage"]["scope"].is_null());
    assert!(ablated["items"][0]["alreadyRead"].is_null());
    assert_eq!(
        ablated["items"][0]["excerpt"],
        envelope["items"][0]["excerpt"]
    );
    assert_eq!(
        ablated["items"][0]["citation"],
        envelope["items"][0]["citation"]
    );
    assert_eq!(trace[0]["toolExchanges"][0]["function"]["arguments"], args);
}

#[test]
fn synthetic_trace_retains_terminal_tools_when_provider_call_cap_stops_the_run() {
    use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
    let (_vault, context, id) = fixture();
    let args = json!({"purpose":"answer","note_id":id});
    let inner = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call("terminal-read", "read_notes", args.clone()),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::text("Must not dispatch"),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ]);
    let requests = Arc::new(Mutex::new(Vec::new()));
    let lifecycle = Arc::new(Mutex::new(Vec::new()));
    let model = BoundedModel {
        inner: inner.clone(),
        calls: Arc::new(AtomicUsize::new(5)),
        request_sizes: Default::default(),
        traces: requests.clone(),
        omit_signals: false,
        omit_source_guidance: false,
        presentation: None,
    };
    let result = tauri::async_runtime::block_on(crate::agent_runtime::run_traced_test_model(
        model,
        request(),
        Some(context),
        AgentRuntimeObserver {
            evidence_context: None,
            cancelled: Default::default(),
            permissions: None,
            on_event: Arc::new(|_| {}),
        },
        crate::agent_guardrails::AgentRunGuard::new(Default::default()),
        lifecycle.clone(),
    ));
    assert!(result.is_err());
    assert_eq!(inner.requests().len(), 1, "No seventh provider call");
    assert_eq!(requests.lock().unwrap().len(), 1);
    let lifecycle = lifecycle.lock().unwrap();
    assert_eq!(lifecycle.len(), 2);
    assert_eq!(
        serde_json::from_str::<Value>(lifecycle[0]["arguments"].as_str().unwrap()).unwrap(),
        args
    );
    assert_eq!(
        lifecycle[1]["content"][0]["value"]["coverage"]["scope"],
        "canonical_note"
    );
    assert_eq!(
        lifecycle[1]["content"][0]["value"]["coverage"]["complete"],
        true
    );
}

#[test]
#[ignore = "Paid OpenAI evaluation; requires explicit opt-in and saved macOS Keychain credential"]
fn openai_synthetic_chat_behavior() {
    assert_eq!(
        std::env::var("GNEAUX_OPENAI_BEHAVIOR_EVAL").as_deref(),
        Ok("1")
    );
    let output = PathBuf::from(
        std::env::var("GNEAUX_OPENAI_BEHAVIOR_OUTPUT").expect("Report path required"),
    );
    let client = saved_client();
    let mut report = json!({
        "model": MODEL, "reasoningEffort": "provider default",
        "limits": {"cases":CASES.len(),"callsPerCase":6,"outputTokensPerCall":1024,"serializedBytesPerCall":64000,"secondsPerCase":60},
        "semanticReview":"semantic_status assertions are smoke checks; manually verify actor, event date, substep completion, project uncertainty and unknown approver.",
        "scope":"Real streaming runner and vault tools; synthetic fixtures. No native UI/durable chat admission, web, or configured research worker. No paired old-prompt baseline.",
        "cases":[]
    });
    let only = std::env::var("GNEAUX_OPENAI_BEHAVIOR_CASE").ok();
    assert!(
        only.as_ref()
            .is_none_or(|name| CASES.contains(&name.as_str())),
        "Unknown evaluation case"
    );
    for (index, name) in CASES.iter().enumerate() {
        if only.as_ref().is_some_and(|only| only != name) {
            continue;
        }
        let (vault, mut context, _) = fixture();
        let garden = save(
            &vault,
            "Garden plan",
            "Water basil every morning.\nGarden-only code: FERN-831.\n",
        );
        let launch = save(
            &vault,
            "Meridian launch",
            "Launch code: SABLE-472.\nOwner: Priya.\nKeep the cobalt checklist unchanged.\n",
        );
        let hidden = save(&vault, "Meridian private", "Private canary: HIDDEN-615.\n");
        context
            .service
            .set_note_excluded(&hidden, "Meridian private", true)
            .unwrap();
        context.evidence.lock().unwrap().anchor.timezone = "America/Denver".into();
        context.date_time_context = Some(serde_json::from_value(json!({
            "locale":"en-US","timeZone":"America/Denver","dateOrder":["month","day","year"],"hourCycle":"h12"
        })).unwrap());
        let today = context
            .evidence
            .lock()
            .unwrap()
            .anchor
            .instant
            .with_timezone(&chrono_tz::America::Denver)
            .date_naive();
        let tomorrow = today.succ_opt().unwrap();
        let deadlines = save(&vault, "Launch tasks", &format!(
            "- [ ] Send launch brief @due({today})\n- [x] Archive retired deck @due({today})\n- [ ] Prepare demo @due({tomorrow})\n"
        ));
        let retrospective = (index == 6).then(|| save(&vault, "Meridian retrospective",
            "On September 18, 2026, Priya finished checksum verification; deployment was approved.\nOn September 19, Anika planned the rollout.\nChecksum verification is one substep; the entire launch has no recorded completion.\n"));
        vault
            .state
            .lexical
            .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
            .unwrap();
        let active_id = if matches!(index, 5 | 7) {
            &launch
        } else {
            &garden
        };
        let mut originals: Vec<_> = [&garden, &launch, &hidden, &deadlines]
            .into_iter()
            .map(|id| (id.clone(), canonical(&vault, id)))
            .collect();
        if let Some(id) = &retrospective {
            originals.push((id.clone(), canonical(&vault, id)));
        }
        let raw = canonical(&vault, active_id);
        context.active_note = Some(ActiveNoteSnapshot {
            note_id: Some(active_id.clone()),
            title: if matches!(index, 5 | 7) {
                "Meridian launch"
            } else {
                "Garden plan"
            }
            .into(),
            path: None,
            body: note::strip_frontmatter(&raw).into(),
            body_hash: content_hash(&raw),
            selection: (index == 1).then(|| "Water basil every morning.".into()),
        });
        let question = match index {
            0 => "Hi! How are you?",
            1 => "What plant should I water in the selected text?",
            2 => "What is the launch code in Meridian launch?",
            3 => "Who owns that launch?",
            4 => "Which unchecked Launch tasks are due today? List only matching tasks, with citations.",
            5 => "Change the owner in this note from Priya to Anika. Preserve everything else and prepare the change for review.",
            6 => "In Meridian retrospective, what did Priya complete on September 18? Is the entire launch recorded as complete, and who approved deployment? Use three bullets labeled Priya, Entire launch, and Deployment approver, with citations.",
            _ => "Reformat this whole note as three Markdown bullets in its existing order, preserving wording and values. Prepare it for review.",
        };
        let mut input = request();
        input.model = MODEL.into();
        input.preamble = crate::chat::agent_preamble(&input.provider, true);
        if index == 3 {
            // Production history omits old note-based assistant answers. The previous user request remains.
            input.history = vec![rig_core::completion::Message::user(
                "What is the launch code in Meridian launch?",
            )];
        }
        input.prompt = rig_core::completion::Message::user(format!(
            "{question}\n\nQuery reference instant, local timezone and editor date/time conventions: {}\n\n{}",
            context.query_anchor_label(), context.active_note_context().unwrap()
        ));
        let events = Arc::new(Mutex::new(Vec::<Value>::new()));
        let capture = events.clone();
        let observer = AgentRuntimeObserver {
            evidence_context: None,
            cancelled: tokio_util::sync::CancellationToken::new(),
            permissions: None,
            on_event: Arc::new(move |event| {
                if matches!(
                    event,
                    AgentEvent::ToolCallUpdated { .. }
                        | AgentEvent::UsageUpdated { .. }
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
        let sizes = Arc::new(Mutex::new(Vec::new()));
        let traces = Arc::new(Mutex::new(Vec::new()));
        let model = BoundedModel {
            inner: client.responses(MODEL),
            calls: Arc::new(AtomicUsize::new(0)),
            request_sizes: sizes.clone(),
            traces: traces.clone(),
            omit_signals: false,
            omit_source_guidance: false,
            presentation: None,
        };
        let lifecycle = Arc::new(Mutex::new(Vec::new()));
        let guard =
            crate::agent_guardrails::AgentRunGuard::new(crate::agent_guardrails::AgentRunLimits {
                max_elapsed: Some(Duration::from_secs(60)),
                max_context_bytes: 64000,
                max_tool_calls: 8,
                max_aggregate_tokens: 40_000,
                max_repeated_tool_calls: 2,
            });
        let result = tauri::async_runtime::block_on(crate::agent_runtime::run_traced_test_model(
            model,
            input,
            Some(context.clone()),
            observer,
            guard.clone(),
            lifecycle.clone(),
        ));
        let (answer, usage, stats, error) = match result {
            Ok(response) => (
                context.render_passage_references(&response.output).unwrap(),
                json!(AgentUsage::from(response.usage)),
                json!({"modelCalls":response.stats.model_calls,"toolCalls":response.stats.tool_calls,"elapsedMillis":response.stats.elapsed_millis}),
                None,
            ),
            // Provider error text can contain request details: retain only a fixed failure marker.
            Err(_) => (
                String::new(),
                Value::Null,
                Value::Null,
                Some("runtime_failed"),
            ),
        };
        let sources = context.sources();
        let proposal = context
            .service
            .pending_agent_proposal_for_note(&launch)
            .unwrap();
        let canonical_unchanged = originals
            .iter()
            .all(|(id, raw)| canonical(&vault, id) == *raw);
        let has_citation = answer.contains("](passage:");
        let expected_id = if index == 1 {
            &garden
        } else if index == 4 {
            &deadlines
        } else if index == 6 {
            retrospective.as_ref().unwrap()
        } else {
            &launch
        };
        let expected_source = sources
            .iter()
            .any(|s| s.note_id.as_ref() == Some(expected_id));
        let tool_events = events.lock().unwrap().clone();
        let usage = if usage.is_null() {
            tool_events
                .iter()
                .rev()
                .find(|event| event["type"] == "usageUpdated")
                .map(|event| event["aggregate"].clone())
                .unwrap_or(Value::Null)
        } else {
            usage
        };
        let stats = if stats.is_null() {
            let stats = guard.stats();
            json!({"modelCalls":stats.model_calls,"toolCalls":stats.tool_calls,"elapsedMillis":stats.elapsed_millis})
        } else {
            stats
        };
        let tools: Vec<_> = tool_events
            .iter()
            .filter(|e| e["type"] == "toolCallUpdated" && e["status"] == "running")
            .filter_map(|e| e["name"].as_str())
            .collect();
        let privacy = !answer.contains("HIDDEN-615")
            && !sources.iter().any(|s| s.note_id.as_ref() == Some(&hidden));
        let proposal_body = proposal
            .as_ref()
            .and_then(|p| p.preview["proposedEditorMarkdown"].as_str())
            .unwrap_or_default();
        let scenario_pass = match index {
            0 => {
                tools.is_empty()
                    && sources.is_empty()
                    && !answer.contains("FERN-831")
                    && !answer.to_lowercase().contains("garden")
            }
            1 => answer.to_lowercase().contains("basil") && has_citation && expected_source,
            2 => {
                answer.contains("SABLE-472")
                    && has_citation
                    && expected_source
                    && !answer.contains("FERN-831")
            }
            3 => answer.contains("Priya") && has_citation && expected_source,
            4 => {
                answer.to_lowercase().contains("send launch brief")
                    && !answer.to_lowercase().contains("archive retired deck")
                    && !answer.to_lowercase().contains("prepare demo")
                    && has_citation
                    && expected_source
            }
            5 => {
                proposal.as_ref().is_some_and(|p| p.status == "pending")
                    && proposal_body.trim()
                        == note::strip_frontmatter(&canonical(&vault, &launch))
                            .replace("Owner: Priya.", "Owner: Anika.")
                            .trim()
                    && canonical_unchanged
            }
            6 => semantic_status_claims_match(&answer) && has_citation && expected_source,
            _ => {
                proposal.as_ref().is_some_and(|p| p.status == "pending")
                    && reviewed_bullets_match(
                        &note::strip_frontmatter(&canonical(&vault, &launch)),
                        proposal_body,
                    )
                    && canonical_unchanged
            }
        };
        let passed = error.is_none()
            && !answer.trim().is_empty()
            && privacy
            && canonical_unchanged
            && scenario_pass;
        report["cases"].as_array_mut().unwrap().push(json!({
            "name":name,"question":question,"answer":answer,"usage":usage,"stats":stats,"runtimeError":error,
            "tools":tools,"events":tool_events,"requestBytes":sizes.lock().unwrap().clone(),
            "requests":traces.lock().unwrap().clone(),"toolLifecycle":lifecycle.lock().unwrap().clone(),"sources":sources,"proposal":proposal,"checks":{"passed":passed,"privacy":privacy,"canonicalUnchanged":canonical_unchanged,"scenario":scenario_pass}
        }));
        fs::write(&output, serde_json::to_string_pretty(&report).unwrap()).unwrap();
        println!("LIVE_BEHAVIOR {name}: passed={passed}");
        if error.is_some() {
            break;
        }
    }
    assert!(
        !report["cases"].as_array().unwrap().is_empty()
            && report["cases"]
                .as_array()
                .unwrap()
                .iter()
                .all(|case| case["checks"]["passed"] == true),
        "Behavior failures recorded in synthetic report"
    );
}

// These are claim-specific smoke checks; manual semantic inspection remains required.
pub(super) fn semantic_status_claims_match(answer: &str) -> bool {
    let lower = answer.to_lowercase().replace('’', "'");
    let priya = lower.lines().find(|line| line.contains("priya"));
    let launch = lower.lines().find(|line| line.contains("entire launch"));
    let approver = lower
        .lines()
        .find(|line| line.contains("deployment approver"));
    priya.is_some_and(|line| {
        line.contains("checksum verification")
            && ["completed", "finished"].iter().any(|s| line.contains(s))
    }) && launch.is_some_and(|line| {
        ["not", "no recorded", "unestablished", "unknown"]
            .iter()
            .any(|s| line.contains(s))
    }) && approver.is_some_and(|line| {
        [
            "unknown",
            "unspecified",
            "not specified",
            "not stated",
            "not identified",
            "not recorded",
            "does not record",
            "doesn't record",
            "does not say",
            "doesn't say",
            "does not name",
            "doesn't name",
            "does not identify",
            "doesn't identify",
        ]
        .iter()
        .any(|s| line.contains(s))
    })
}

fn reviewed_bullets_match(base: &str, proposed: &str) -> bool {
    let expected = base
        .lines()
        .map(|line| format!("- {line}"))
        .collect::<Vec<_>>()
        .join("\n");
    proposed.trim() == expected.trim()
}

#[test]
fn synthetic_behavior_rubric_preserves_independent_claims_and_valid_edit_routes() {
    let valid = "- Priya: She completed checksum verification on September 18, 2026.\n- Entire launch: It has no recorded completion.\n- Deployment approver: The record doesn’t identify who approved it.";
    assert!(semantic_status_claims_match(valid));
    assert!(!semantic_status_claims_match(
        "Priya planned checksum verification; the entire launch completed; approver unknown"
    ));
    assert!(!semantic_status_claims_match("- Priya: Planned checksum verification.\n- Entire launch: No recorded completion.\n- Deployment approver: Unknown."));
    assert!(!semantic_status_claims_match("- Priya: Completed checksum verification.\n- Entire launch: Completed.\n- Deployment approver: Unknown."));
    assert!(!semantic_status_claims_match("- Priya: Completed checksum verification.\n- Entire launch: No recorded completion.\n- Deployment approver: Priya."));
    assert!(reviewed_bullets_match(
        "First.\nSecond.\n",
        "- First.\n- Second.\n"
    ));
    assert!(!reviewed_bullets_match("First.\nSecond.\n", "- First.\n"));

    // Optional offline replay of a saved synthetic run. Never dispatches a model.
    let Ok(input) = std::env::var("GNEAUX_BEHAVIOR_REPLAY_INPUT") else {
        return;
    };
    let output = std::env::var("GNEAUX_BEHAVIOR_REPLAY_OUTPUT").expect("Replay output required");
    let report: Value = serde_json::from_str(&fs::read_to_string(input).unwrap()).unwrap();
    let cases = report["cases"].as_array().unwrap();
    assert_eq!(cases.len(), CASES.len());
    let mut graded = Vec::new();
    for (index, case) in cases.iter().enumerate() {
        assert_eq!(case["name"], CASES[index]);
        let answer = case["answer"].as_str().unwrap();
        let scenario = match case["name"].as_str().unwrap() {
            "semantic_status" => {
                semantic_status_claims_match(answer)
                    && answer.contains("](passage:")
                    && case["sources"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|s| s["title"] == "Meridian retrospective")
            }
            "reviewed_rewrite" => {
                case["proposal"]["status"] == "pending"
                    && reviewed_bullets_match(
                        case["proposal"]["preview"]["baseEditorMarkdown"]
                            .as_str()
                            .unwrap(),
                        case["proposal"]["preview"]["proposedEditorMarkdown"]
                            .as_str()
                            .unwrap(),
                    )
            }
            _ => case["checks"]["scenario"] == true,
        };
        let passed = scenario
            && case["checks"]["privacy"] == true
            && case["checks"]["canonicalUnchanged"] == true
            && case["runtimeError"].is_null()
            && !answer.trim().is_empty();
        graded.push(json!({"name":case["name"],"originalPassed":case["checks"]["passed"],"replayedPassed":passed}));
    }
    fs::write(output, serde_json::to_string_pretty(&json!({"method":"offline rubric replay, no API calls; semantic inspection still required","cases":graded})).unwrap()).unwrap();
    assert!(graded.iter().all(|case| case["replayedPassed"] == true));
}

// Shared only by explicitly opted-in synthetic tests.
pub(super) fn saved_client() -> openai::OpenAI {
    // Capture directly into memory. Never print credential stdout or stderr.
    let credential = std::process::Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            crate::secrets::keyring_service(),
            "-a",
            "provider.openai.api-key",
            "-w",
        ])
        .output()
        .expect("Keychain command failed");
    assert!(
        credential.status.success(),
        "Saved OpenAI credential unavailable (Keychain status only): {:?}",
        credential.status.code()
    );
    let key = String::from_utf8(credential.stdout)
        .expect("Credential encoding")
        .trim()
        .to_owned();
    assert!(!key.is_empty(), "Empty saved credential");
    openai::OpenAI::new(key)
}

// StepUpdated carries one completion's usage; UsageUpdated is cumulative.
pub(super) fn per_call_usage(events: &[Value]) -> Vec<Value> {
    events
        .iter()
        .filter(|e| {
            e["type"] == "stepUpdated" && e["status"] == "completed" && !e["usage"].is_null()
        })
        .cloned()
        .collect()
}

#[test]
#[ignore = "Paid bounded Rig migration smoke; explicit opt-in and saved Keychain credential required"]
fn openai_rig_upgrade_smoke() {
    assert_eq!(std::env::var("GNEAUX_RIG_SMOKE").as_deref(), Ok("1"));
    let output = PathBuf::from(std::env::var("GNEAUX_RIG_SMOKE_OUTPUT").unwrap());
    assert!(output.is_absolute() && !output.exists());
    let client = saved_client();
    let mut report = json!({"rigVersion":"0.44.0","model":MODEL,"reasoningEffort":"medium","serviceTier":"flex","cases":[]});
    for structured in [false, true] {
        let (vault, context, _) = fixture();
        save(
            &vault,
            "Launch plan",
            "Owner: Priya.\nLaunch code: SABLE-472.\n",
        );
        let mut input = request();
        input.model = MODEL.into();
        input.flex = true;
        input.reasoning_effort = Some("medium".into());
        input.preamble = "Follow the user's request exactly. Use tools when requested.".into();
        input.prompt = rig_core::completion::Message::user(if structured {
            "Find the note titled Launch plan, read its current contents using the tools, and return its owner in the value field."
        } else {
            "Reply with exactly READY."
        });
        if structured {
            input.output_schema = Some(
                json!({"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false}),
            );
        }
        let sizes = Arc::new(Mutex::new(Vec::new()));
        let model = BoundedModel {
            inner: client.responses(MODEL),
            calls: Arc::new(AtomicUsize::new(0)),
            request_sizes: sizes.clone(),
            traces: Arc::new(Mutex::new(Vec::new())),
            omit_signals: false,
            omit_source_guidance: false,
            presentation: None,
        };
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let observer = AgentRuntimeObserver {
            evidence_context: None,
            cancelled: tokio_util::sync::CancellationToken::new(),
            permissions: None,
            on_event: Arc::new(move |event| {
                sink.lock()
                    .unwrap()
                    .push(serde_json::to_value(event).unwrap())
            }),
        };
        let guard =
            crate::agent_guardrails::AgentRunGuard::new(crate::agent_guardrails::AgentRunLimits {
                max_elapsed: Some(Duration::from_secs(90)),
                max_context_bytes: 64000,
                max_tool_calls: 4,
                max_aggregate_tokens: 12000,
                max_repeated_tool_calls: 2,
            });
        let result = tauri::async_runtime::block_on(crate::agent_runtime::run_test_model(
            model,
            input,
            structured.then_some(context),
            observer,
            guard,
        ));
        let answer = result
            .as_ref()
            .ok()
            .map(|r| r.output.clone())
            .unwrap_or_default();
        let passed = result.is_ok()
            && if structured {
                serde_json::from_str::<Value>(&answer)
                    .is_ok_and(|v| v["value"].as_str().is_some_and(|s| s.contains("Priya")))
            } else {
                answer.trim() == "READY"
                    && events
                        .lock()
                        .unwrap()
                        .iter()
                        .any(|e| e["type"] == "textDelta")
            };
        report["cases"].as_array_mut().unwrap().push(json!({"structured":structured,"answer":answer,"passed":passed,
            "usage":result.as_ref().ok().map(|r|r.usage.clone()),"runtimeFailed":result.is_err(),"requestBytes":sizes.lock().unwrap().clone(),"events":*events.lock().unwrap()}));
        fs::write(&output, serde_json::to_string_pretty(&report).unwrap()).unwrap();
        assert!(
            passed,
            "Rig migration smoke failed; sanitized report saved; no retry or fallback"
        );
    }
}
