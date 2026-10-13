//! Assembled completion boundary with optional counter-only observations.
//! The independent usage_context module owns context admission policy.
use super::*;
use rig_core::completion::CompletionRequest;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

static RUNTIME_SEQUENCE: AtomicUsize = AtomicUsize::new(0);

pub(super) struct Measurement {
    runtime: usize,
    sequence: AtomicUsize,
    pending: Mutex<Option<Value>>,
    on_event: AgentEventSink,
    provider: AgentProvider,
    model: String,
    worker: bool,
    result_schema: Option<Value>,
}

impl Measurement {
    pub(super) fn configured(
        request: &AgentRuntimeRequest,
        on_event: AgentEventSink,
        worker: bool,
    ) -> Option<Arc<Self>> {
        (std::env::var("GNEAUXGHTS_CONTEXT_DIAGNOSTICS").as_deref() == Ok("1"))
            .then(|| Self::enabled(request, on_event, worker))
    }

    pub(super) fn enabled(
        request: &AgentRuntimeRequest,
        on_event: AgentEventSink,
        worker: bool,
    ) -> Arc<Self> {
        Arc::new(Self {
            runtime: RUNTIME_SEQUENCE.fetch_add(1, Ordering::Relaxed),
            sequence: AtomicUsize::new(0),
            pending: Mutex::new(None),
            on_event,
            provider: request.provider.clone(),
            model: request.model.clone(),
            worker,
            result_schema: request.output_schema.clone(),
        })
    }

    pub(super) async fn begin(&self, request: &CompletionRequest, capacity: Option<u64>) {
        self.unreported("attempt_superseded");
        let mut details = measure(request);
        let formatter = usize::from(
            super::usage_context::result_formatter_name(request, self.result_schema.as_ref())
                .is_some(),
        );
        details["resultFormatterCount"] = json!(formatter);
        details["executableToolCount"] = json!(request.tools.len().saturating_sub(formatter));
        details["phase"] = json!("request");
        details["runtimeInstance"] = json!(self.runtime);
        details["attempt"] = json!(self.sequence.fetch_add(1, Ordering::Relaxed) + 1);
        details["worker"] = json!(self.worker);
        details["model"] = json!(request.model.as_deref().unwrap_or(&self.model));
        details["provider"] = json!(self.provider);
        // The documented maximum is not the loaded instance's configuration.
        details["loadedContextTokens"] = json!(capacity);
        details["capacitySource"] = json!(if capacity.is_some() {
            "lm_studio_loaded_instance"
        } else {
            "unknown"
        });
        *self.pending.lock().unwrap_or_else(|e| e.into_inner()) = Some(details.clone());
        (self.on_event)(AgentEvent::ContextMeasured { details });
    }

    pub(super) fn finish(&self, call_index: Option<usize>, usage: Usage) {
        let Some(mut details) = self
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        else {
            return;
        };
        details["phase"] = json!("usage");
        details["callIndex"] = json!(call_index);
        details["reportedUsage"] = if usage.is_reported() {
            json!({"inputTokens":usage.input_tokens,"outputTokens":usage.output_tokens,"totalTokens":usage.total_tokens,"cachedInputTokens":usage.cached_input_tokens,"cacheCreationInputTokens":usage.cache_creation_input_tokens,"toolUsePromptTokens":usage.tool_use_prompt_tokens,"reasoningTokens":usage.reasoning_tokens})
        } else {
            Value::Null
        };
        details["inputEstimateErrorTokens"] = details["estimatedInputTokens"]
            .as_u64()
            .zip(usage.input_tokens)
            .map(|(estimate, input)| json!(estimate as i128 - input as i128))
            .unwrap_or(Value::Null);
        (self.on_event)(AgentEvent::ContextMeasured { details });
    }

    fn unreported(&self, reason: &'static str) {
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(mut details) = pending {
            details["phase"] = json!("unreported");
            details["reason"] = json!(reason);
            details["reportedUsage"] = Value::Null;
            details["inputEstimateErrorTokens"] = Value::Null;
            // Provider errors may include request text. Only fixed codes leave here.
            (self.on_event)(AgentEvent::ContextMeasured { details });
        }
    }
}

impl Drop for Measurement {
    fn drop(&mut self) {
        // Also covers mid-stream errors and cancellation by an outer worker timeout.
        self.unreported("runtime_ended_without_usage");
    }
}

fn bytes(value: &Value) -> usize {
    if value.is_null() {
        0
    } else {
        serde_json::to_vec(value).map_or(0, |b| b.len())
    }
}

pub(super) fn has_media(value: &Value) -> bool {
    match value {
        Value::Array(values) => values.iter().any(has_media),
        Value::Object(object) => {
            object.get("type").and_then(Value::as_str).is_some_and(|t| {
                matches!(
                    t,
                    "image" | "image_url" | "audio" | "input_audio" | "video" | "document" | "file"
                )
            }) || object.values().any(has_media)
        }
        _ => false,
    }
}

pub(super) fn measure(request: &CompletionRequest) -> Value {
    let Ok(value) = serde_json::to_value(request) else {
        return json!({"mode":"measurement_only","countingMethod":"unavailable","enforcementEligible":false});
    };
    let mut components = Map::new();
    let mut input_bytes = 0;
    for field in [
        "preamble",
        "documents",
        "tools",
        "additional_params",
        "output_schema",
    ] {
        let count = bytes(&value[field]);
        input_bytes += count;
        components.insert(field.into(), json!(count));
    }
    // Canonical preambles normally arrive as system messages at this boundary.
    for message in value["chat_history"].as_array().into_iter().flatten() {
        let category = if message["role"] == "system" {
            "systemMessages"
        } else if message["content"]
            .as_array()
            .is_some_and(|parts| parts.iter().any(|p| p["type"] == "toolresult"))
        {
            "toolResults"
        } else {
            "conversationMessages"
        };
        let count = bytes(message);
        input_bytes += count;
        let previous = components
            .get(category)
            .and_then(Value::as_u64)
            .unwrap_or(0);
        components.insert(category.into(), json!(previous + count as u64));
    }
    let media = has_media(&value["chat_history"]) || has_media(&value["documents"]);
    let output_limit = request
        .additional_params
        .as_ref()
        .and_then(|p| {
            p.get("max_completion_tokens")
                .or_else(|| p.get("max_output_tokens"))
                .or_else(|| p.get("max_tokens"))
        })
        .and_then(Value::as_u64)
        .or(request.max_tokens);
    json!({
        "mode":"measurement_only", "countingMethod":"assembled_utf8_bytes_div_4_v1",
        "coverage":"assembled request before provider formatting; provider chat template and hidden input overhead are not counted",
        "enforcementEligible":false, "componentBytes":components, "requestBytes":bytes(&value),
        "inputBytes":input_bytes, "estimatedInputTokens": if media { None } else { Some(input_bytes.div_ceil(4)) },
        "multimodalTokensUnknown":media, "configuredOutputLimitTokens":output_limit,
        "reservedOutputTokens":Value::Null, "safetyMarginTokens":Value::Null,
        "toolCount":request.tools.len(), "messageCount":request.chat_history.len(),
        "providerParametersPresent":request.additional_params.is_some(),
    })
}

fn capacity_from_models(value: &Value, model: &str) -> Option<u64> {
    let mut capacities = Vec::new();
    for entry in value["models"].as_array()? {
        for instance in entry["loaded_instances"].as_array().into_iter().flatten() {
            if entry["key"] == model || instance["id"] == model {
                capacities.push(
                    instance["config"]["context_length"]
                        .as_u64()
                        .filter(|n| *n > 0),
                );
            }
        }
    }
    if capacities.len() == 1 {
        capacities[0]
    } else {
        None
    }
}

const CAPACITY_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(30);

/// One HTTP client per runtime. Successful observations are always refreshed;
/// only unavailable metadata backs off, using the existing unknown-capacity policy.
pub(super) struct CapacityProbe {
    client: super::model_metadata::ModelMetadataClient,
    base: String,
    key: Option<String>,
    retry_after: Mutex<Option<(String, std::time::Instant)>>,
}
impl CapacityProbe {
    pub(super) fn new(base: String, key: Option<String>) -> Self {
        Self {
            client: super::model_metadata::ModelMetadataClient::new(),
            base,
            key,
            retry_after: Mutex::new(None),
        }
    }
    pub(super) async fn observe(&self, model: &str) -> Option<u64> {
        self.observe_at(model, std::time::Instant::now()).await
    }
    async fn observe_at(&self, model: &str, now: std::time::Instant) -> Option<u64> {
        if self
            .retry_after
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .is_some_and(|(prior, deadline)| prior == model && now < *deadline)
        {
            return None;
        }
        let capacity = self.fetch(model).await;
        *self.retry_after.lock().unwrap_or_else(|e| e.into_inner()) = capacity
            .is_none()
            .then(|| (model.to_string(), now + CAPACITY_RETRY_DELAY));
        capacity
    }
    async fn fetch(&self, model: &str) -> Option<u64> {
        let value = self.client.fetch(&self.base, self.key.as_deref()).await?;
        capacity_from_models(&value, model)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rig_core::test_utils::{MockCompletionModel, MockTurn};

    #[test]
    fn full_request_measurement_includes_tools_and_does_not_mutate_forwarded_request() {
        tauri::async_runtime::block_on(async {
            let model = MockCompletionModel::from_turns([MockTurn::text("unchanged")]);
            let request = rig_core::completion::CompletionRequest::new("PRIVATE_PROMPT")
                .model("mock-model")
                .preamble("PRIVATE_SYSTEM".repeat(100))
                .tools(vec![rig_core::completion::ToolDefinition {
                    name: rig_core::message::ToolName::new("read_evidence").unwrap(), description: "PRIVATE_TOOL_DESCRIPTION".repeat(100),
                    parameters: json!({"type":"object","properties":{"evidence_ids":{"type":"array","items":{"type":"string"}}}}),
                }]).max_tokens(123);
            let expected = serde_json::to_value(&request).unwrap();
            let counters = measure(&request);
            assert!(
                counters["componentBytes"]["systemMessages"]
                    .as_u64()
                    .unwrap()
                    > 1000
            );
            assert!(counters["componentBytes"]["tools"].as_u64().unwrap() > 2000);
            assert_eq!(counters["configuredOutputLimitTokens"], 123);
            assert!(counters["reservedOutputTokens"].is_null());
            assert_eq!(counters["enforcementEligible"], false);
            assert!(!counters.to_string().contains("PRIVATE_"));
            let observed = Arc::new(Mutex::new(Vec::new()));
            let capture = observed.clone();
            let measurement = Arc::new(Measurement {
                runtime: 1,
                sequence: AtomicUsize::new(0),
                pending: Mutex::new(None),
                on_event: Arc::new(move |e| {
                    capture
                        .lock()
                        .unwrap()
                        .push(serde_json::to_value(e).unwrap())
                }),
                provider: AgentProvider::Openai,
                model: "mock".into(),
                worker: false,
                result_schema: None,
            });
            measurement.begin(&request, None).await;
            let response = model.call(request).await.unwrap();
            measurement.finish(None, response.usage);
            assert_eq!(
                serde_json::to_value(&model.requests()[0]).unwrap(),
                expected
            );
            assert_eq!(observed.lock().unwrap().len(), 2);
            assert!(!serde_json::to_string(&*observed.lock().unwrap())
                .unwrap()
                .contains("PRIVATE_"));
        });
    }

    #[test]
    fn loaded_capacity_does_not_substitute_advertised_or_ambiguous_maximum() {
        assert_eq!(
            capacity_from_models(
                &json!({"models":[{"key":"qwen","max_context_length":262144,"loaded_instances":[]}]}),
                "qwen"
            ),
            None
        );
        let single = json!({"models":[{"key":"qwen","max_context_length":262144,"loaded_instances":[{"id":"qwen","config":{"context_length":32768}}]}]});
        assert_eq!(capacity_from_models(&single, "qwen"), Some(32768));
        assert_eq!(capacity_from_models(&single, "different"), None);
        let multiple = json!({"models":[{"key":"qwen","loaded_instances":[{"id":"one","config":{"context_length":32768}},{"id":"two","config":{"context_length":65536}}]}]});
        assert_eq!(capacity_from_models(&multiple, "qwen"), None);
        assert_eq!(capacity_from_models(&multiple, "two"), Some(65536));
    }

    #[test]
    fn capacity_probe_backs_off_unknown_but_refreshes_success_and_model_changes() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            time::Instant,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        struct ServerGuard {
            stop: Arc<std::sync::atomic::AtomicBool>,
            worker: Option<std::thread::JoinHandle<()>>,
        }
        impl Drop for ServerGuard {
            fn drop(&mut self) {
                self.stop.store(true, Ordering::Release);
                if let Some(worker) = self.worker.take() {
                    let _ = worker.join();
                }
            }
        }
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stopped = stop.clone();
        let mut server = ServerGuard {
            stop,
            worker: Some(std::thread::spawn(move || {
                for (model, capacity) in [
                    ("qwen", None),
                    ("qwen", Some(90112)),
                    ("qwen", Some(45056)),
                    ("qwen", None),
                    ("other", Some(32768)),
                ] {
                    let deadline = Instant::now() + std::time::Duration::from_secs(5);
                    let (mut stream, _) = loop {
                        if stopped.load(Ordering::Acquire) {
                            return;
                        }
                        match listener.accept() {
                            Ok(stream) => break stream,
                            Err(error)
                                if error.kind() == std::io::ErrorKind::WouldBlock
                                    && Instant::now() < deadline =>
                            {
                                std::thread::sleep(std::time::Duration::from_millis(2))
                            }
                            Err(error) => {
                                panic!("metadata fixture accept failed or timed out: {error}")
                            }
                        }
                    };
                    // macOS inherits the listener's nonblocking mode; the read timeout
                    // only bounds a blocking stream's wait for request bytes.
                    stream.set_nonblocking(false).unwrap();
                    stream
                        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                        .unwrap();
                    let mut request = Vec::new();
                    while !request.ends_with(b"\r\n\r\n") {
                        assert!(
                            request.len() < 8192,
                            "fixture request header exceeded bound"
                        );
                        let mut byte = [0];
                        stream.read_exact(&mut byte).unwrap();
                        request.push(byte[0]);
                    }
                    assert!(String::from_utf8(request)
                        .unwrap()
                        .starts_with("GET /api/v1/models "));
                    count.fetch_add(1, Ordering::SeqCst);
                    let instances = capacity
                        .map(|c| vec![json!({"id":model,"config":{"context_length":c}})])
                        .unwrap_or_default();
                    let body =
                        json!({"models":[{"key":model,"loaded_instances":instances}]}).to_string();
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .unwrap();
                }
            })),
        };
        tauri::async_runtime::block_on(async {
            let probe = CapacityProbe::new(base, None);
            let now = Instant::now();
            assert_eq!(probe.observe_at("qwen", now).await, None);
            assert_eq!(probe.observe_at("qwen", now).await, None);
            assert_eq!(
                calls.load(Ordering::SeqCst),
                1,
                "Unavailable metadata retried too early"
            );
            let later = now + CAPACITY_RETRY_DELAY;
            assert_eq!(probe.observe_at("qwen", later).await, Some(90112));
            assert_eq!(probe.observe_at("qwen", later).await, Some(45056));
            assert_eq!(probe.observe_at("qwen", later).await, None);
            assert_eq!(probe.observe_at("qwen", later).await, None);
            assert_eq!(calls.load(Ordering::SeqCst), 4);
            assert_eq!(probe.observe_at("other", later).await, Some(32768));
        });
        server.worker.take().unwrap().join().unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 5);
    }

    #[test]
    fn media_is_not_presented_as_an_exact_text_token_count() {
        assert!(has_media(
            &json!({"content":[{"type":"image","data":"PRIVATE_IMAGE"}]})
        ));
        assert!(!has_media(
            &json!({"content":[{"type":"text","text":"ordinary image description"}]})
        ));
    }

    #[test]
    fn abandoned_and_superseded_attempts_close_once_without_error_content() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let capture = events.clone();
        let measurement = Measurement {
            runtime: 7,
            sequence: AtomicUsize::new(1),
            pending: Mutex::new(Some(
                json!({"runtimeInstance":7,"attempt":1,"estimatedInputTokens":100}),
            )),
            on_event: Arc::new(move |event| {
                capture
                    .lock()
                    .unwrap()
                    .push(serde_json::to_value(event).unwrap())
            }),
            provider: AgentProvider::Openai,
            model: "mock".into(),
            worker: true,
            result_schema: None,
        };
        measurement.unreported("attempt_superseded");
        *measurement.pending.lock().unwrap() =
            Some(json!({"runtimeInstance":7,"attempt":2,"worker":true}));
        drop(measurement); // Mirrors a dropped streaming future, including research timeout.
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 2);
        for (index, event) in events.iter().enumerate() {
            assert_eq!(event["details"]["attempt"], index + 1);
            assert_eq!(event["details"]["runtimeInstance"], 7);
            assert_eq!(event["details"]["phase"], "unreported");
            assert!(event["details"]["reportedUsage"].is_null());
        }
    }

    #[test]
    fn reported_zero_and_partial_usage_remain_distinct_from_absence() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let measurement = Measurement {
            runtime: 1,
            sequence: AtomicUsize::new(1),
            pending: Mutex::new(None),
            on_event: Arc::new(move |e| {
                sink.lock().unwrap().push(serde_json::to_value(e).unwrap())
            }),
            provider: AgentProvider::Openai,
            model: "mock".into(),
            worker: false,
            result_schema: None,
        };
        for usage in [
            Usage::default().input_tokens(0),
            Usage::default().output_tokens(7),
        ] {
            *measurement.pending.lock().unwrap() = Some(json!({"estimatedInputTokens":100}));
            measurement.finish(Some(0), usage);
        }
        let events = events.lock().unwrap();
        assert_eq!(events[0]["details"]["reportedUsage"]["inputTokens"], 0);
        assert_eq!(events[0]["details"]["inputEstimateErrorTokens"], 100);
        assert!(events[0]["details"]["reportedUsage"]["outputTokens"].is_null());
        assert_eq!(events[1]["details"]["reportedUsage"]["outputTokens"], 7);
        assert!(events[1]["details"]["reportedUsage"]["inputTokens"].is_null());
        assert!(events[1]["details"]["inputEstimateErrorTokens"].is_null());
    }

    #[test]
    fn missing_usage_remains_unknown_and_is_consumed_once() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let measurement = Measurement {
            runtime: 1,
            sequence: AtomicUsize::new(1),
            pending: Mutex::new(Some(json!({"attempt":1,"estimatedInputTokens":100}))),
            on_event: Arc::new(move |e| {
                sink.lock().unwrap().push(serde_json::to_value(e).unwrap())
            }),
            provider: AgentProvider::Openai,
            model: "mock".into(),
            worker: false,
            result_schema: None,
        };
        measurement.finish(Some(0), Usage::new());
        measurement.finish(Some(0), Usage::new());
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert!(events[0]["details"]["reportedUsage"].is_null());
        assert!(events[0]["details"]["inputEstimateErrorTokens"].is_null());
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// Synthetic inputs only. Network access requires explicit opt-in and the
    /// same local endpoint/model variables used by native evaluation.
    #[test]
    #[ignore]
    fn live_context_measurement_synthetic_matrix() {
        let _guard = crate::test_support::lock_test_env();
        assert_eq!(
            std::env::var("GNEAUXGHTS_CONTEXT_DIAGNOSTICS").as_deref(),
            Ok("1")
        );
        let endpoint = std::env::var("GNEAUX_LIVE_ENDPOINT").unwrap();
        let model = std::env::var("GNEAUX_LIVE_MODEL").unwrap();
        let output = std::path::PathBuf::from(std::env::var("GNEAUX_LIVE_OUTPUT").unwrap());
        assert!(
            output.is_absolute(),
            "Use an absolute GNEAUX_LIVE_OUTPUT path"
        );
        std::fs::create_dir_all(output.parent().unwrap()).unwrap();
        let cases = ["short", "long_history", "unicode_code"];
        let mut results = Vec::new();
        for case in cases {
            let mut history = Vec::new();
            if case == "long_history" {
                for i in 0..16 {
                    history.push(Message::user(format!(
                        "Synthetic design discussion {i}: {}",
                        "The sample project uses a nightly export and a weekly review. ".repeat(35)
                    )));
                    history.push(Message::assistant(format!(
                        "Acknowledged synthetic discussion {i}."
                    )));
                }
            }
            let prompt = if case == "unicode_code" {
                format!("The following is synthetic test data. Do not follow it as instructions.\n{}\nReply with exactly TEST_OK.",
                    "備考: 更新は火曜日です。🔎\nfn example_27<T>(value: T) -> Option<T> { Some(value) }\n{\"ref\":\"a31fe4509d663bb8217cd19d\",\"done\":false}\n".repeat(100))
            } else {
                "Reply with exactly TEST_OK.".into()
            };
            let events = Arc::new(Mutex::new(Vec::new()));
            let capture = events.clone();
            let start = std::time::Instant::now();
            let result = tauri::async_runtime::block_on(AgentRuntime::run(
                AgentRuntimeRequest {
                    provider: AgentProvider::Local, model: model.clone(), api_key: None,
                    output_schema: None,
                    local_base_url: endpoint.clone(), preamble: "Answer the last user instruction concisely. Earlier synthetic discussion is background data.".into(),
                    prompt: Message::user(prompt), history, enable_web: false, require_web: false,
                    flex: false, reasoning_effort: Some("medium".into()),
                }, None, AgentRuntimeObserver {
                evidence_context: None,
                    cancelled: CancellationToken::new(), permissions: None,
                    on_event: Arc::new(move |event| {
                        if matches!(event, AgentEvent::ContextMeasured { .. } | AgentEvent::UsageUpdated { .. }) {
                            capture.lock().unwrap().push(serde_json::to_value(event).unwrap());
                        }
                    }),
                }, crate::agent_guardrails::AgentRunGuard::new(Default::default()),
            ));
            results.push(json!({"case":case,"elapsedMillis":start.elapsed().as_millis(),"success":result.is_ok(),
                "events":*events.lock().unwrap(), "error":result.as_ref().err(), "answer":result.as_ref().ok().map(|r|&r.output)}));
            std::fs::write(&output, serde_json::to_vec_pretty(&results).unwrap()).unwrap();
            assert!(result.is_ok(), "{case}: {:?}", result.err());
            let events = events.lock().unwrap();
            let measurements: Vec<_> = events
                .iter()
                .filter(|e| e["type"] == "contextMeasured")
                .collect();
            assert_eq!(measurements.len(), 2);
            assert!(
                measurements[1]["details"]["reportedUsage"]["inputTokens"]
                    .as_u64()
                    .unwrap()
                    > 0
            );
        }
    }
}
