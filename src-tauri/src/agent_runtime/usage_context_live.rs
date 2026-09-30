//! Explicitly invoked synthetic local-provider acceptance test. No vault access.
use super::*;
use rig_agent::tool::{Tool, ToolContext};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

#[derive(Clone)]
struct SyntheticEvidence(Arc<AtomicUsize>);
impl Tool for SyntheticEvidence {
    const NAME: &'static str = "read_synthetic_evidence";
    type Error = std::io::Error;
    type Args = serde_json::Value;
    type Output = serde_json::Value;
    fn description(&self) -> String {
        "Read the next page of synthetic evidence.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{},"additionalProperties":false})
    }
    async fn call(&self, _: &mut ToolContext, _: Self::Args) -> Result<Self::Output, Self::Error> {
        self.0.fetch_add(1, Ordering::Relaxed);
        Ok(
            json!({"fact":"The synthetic project launches on Tuesday.","citation":"[Launch record](note://synthetic-launch)",
            "context":"Synthetic archival background: the review covers delivery readiness and documentation. ".repeat(65),
            "hasMore":true}),
        )
    }
}

#[test]
#[ignore = "requires the explicitly configured local Qwen provider"]
fn live_usage_guard_finishes_from_synthetic_evidence() {
    let endpoint = std::env::var("GNEAUX_LIVE_ENDPOINT").expect("local endpoint");
    let model_name = std::env::var("GNEAUX_LIVE_MODEL").expect("local model");
    let output = std::path::PathBuf::from(
        std::env::var("GNEAUX_LIVE_OUTPUT").expect("absolute output path"),
    );
    assert!(output.is_absolute());
    let events = Arc::new(Mutex::new(Vec::new()));
    let capture = events.clone();
    let sink: AgentEventSink = Arc::new(move |e| {
        capture
            .lock()
            .unwrap()
            .push(serde_json::to_value(e).unwrap())
    });
    let request = AgentRuntimeRequest {
        provider: AgentProvider::Local, model: model_name.clone(), api_key: None, local_base_url: endpoint.clone(),
        output_schema: None,
        preamble: "Use the evidence tool to answer. Preserve its exact citation link. Explain incomplete coverage when applicable.".into(),
        prompt: Message::user("When does the synthetic project launch? Read available evidence, then continue to the next page if one exists before answering."),
        history: vec![], enable_web: false, require_web: false, flex: false, reasoning_effort: Some("medium".into()),
    };
    // This lowers only our test's allowance, never the server's loaded capacity.
    let context =
        usage_context::UsageContext::with_test_capacity(&request, sink.clone(), false, 17000);
    let calls = Arc::new(AtomicUsize::new(0));
    let start = std::time::Instant::now();
    let result = tauri::async_runtime::block_on(async {
        let client = openai::CompletionsClient::builder()
            .api_key("lm-studio")
            .base_url(&endpoint)
            .build()
            .unwrap();
        let model = context_measurement::MeasuredModel {
            inner: client.completion_model(&model_name),
            measurement: None,
            context: Some(context.clone()),
        };
        let cancelled = CancellationToken::new();
        let guard = crate::agent_guardrails::AgentRunGuard::new(Default::default());
        let agent = configured_builder(model, &request, local_parameters(Some("medium")))
            .unwrap()
            .add_hook(RuntimeEventHook {
                on_event: sink.clone(),
                cancelled: cancelled.clone(),
                permissions: None,
                guard: guard.clone(),
                tools: None,
                context: Some(context.clone()),
            })
            .tool(SyntheticEvidence(calls.clone()))
            .build();
        drive_agent(
            agent,
            request,
            AgentRuntimeObserver {
                cancelled,
                on_event: sink,
                permissions: None,
            },
            guard,
            None,
            Some(context),
        )
        .await
    });
    let evidence = json!({"endpoint":endpoint,"model":model_name,"simulatedContextAllowance":17000,
        "latencyMillis":start.elapsed().as_millis(),"toolCalls":calls.load(Ordering::Relaxed),
        "answer":result.as_ref().ok().map(|r| &r.output),"error":result.as_ref().err(),"events":*events.lock().unwrap()});
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    std::fs::write(output, serde_json::to_vec_pretty(&evidence).unwrap()).unwrap();
    let result = result.unwrap();
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    assert!(result.output.contains("Tuesday"));
    assert!(result.output.contains("note://synthetic-launch"));
    assert_eq!(
        events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e["details"]["phase"] == "finishing")
            .count(),
        1
    );
}
