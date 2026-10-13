//! Explicitly invoked synthetic local-provider acceptance test. No vault access.
use super::*;
use rig_agent::tool::{Tool, ToolContext};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

#[derive(Clone)]
struct PagedEvidence(Arc<AtomicUsize>, Arc<Mutex<Vec<u64>>>);
impl Tool for PagedEvidence {
    const NAME: &'static str = "read_test_page";
    type Error = std::io::Error;
    type Args = Value;
    type Output = Value;
    fn description(&self) -> String {
        "Read one synthetic page, then continue using nextPage until hasMore is false.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{"page":{"type":"integer","minimum":1,"maximum":10}},"required":["page"],"additionalProperties":false})
    }
    async fn call(&self, _: &mut ToolContext, args: Value) -> Result<Value, Self::Error> {
        let page = args["page"].as_u64().unwrap();
        if !(1..=10).contains(&page) {
            return Err(std::io::Error::other("Page must be between 1 and 10"));
        }
        self.0.fetch_add(1, Ordering::Relaxed);
        self.1.lock().unwrap().push(page);
        eprintln!("Synthetic evidence page {page}");
        Ok(
            json!({"page":page,"nextPage":if page<10 {Some(page+1)} else {None},"hasMore":page<10,
            "fact":"The synthetic project launches on Tuesday.","citation":"[Launch record](note://synthetic-launch)",
            "context":"Synthetic archival background: delivery readiness and documentation were reviewed. ".repeat(70)}),
        )
    }
}

#[test]
#[ignore = "requires an explicitly configured local provider; compaction uses synthetic data only"]
fn live_local_compaction_continues_tools_and_preserves_the_answer() {
    let endpoint = std::env::var("GNEAUX_LIVE_ENDPOINT").expect("local endpoint");
    let model_name = std::env::var("GNEAUX_LIVE_MODEL").expect("local model");
    let events = Arc::new(Mutex::new(Vec::new()));
    let capture = events.clone();
    let sink: AgentEventSink = Arc::new(move |event| {
        capture
            .lock()
            .unwrap()
            .push(serde_json::to_value(event).unwrap())
    });
    let request = AgentRuntimeRequest {
        provider: AgentProvider::Local, model: model_name.clone(), api_key: None, local_base_url: endpoint.clone(),
        output_schema: None, preamble: "Use the evidence tool to answer. Preserve its exact citation link.".into(),
        prompt: Message::user("When does the synthetic project launch? Start at page=1 and read every nextPage until hasMore=false, then answer with the launch day and its exact citation link. Do not skip pages."),
        history: vec![], enable_web: false, require_web: false, flex: false, reasoning_effort: Some("low".into()),
    };
    let calls = Arc::new(AtomicUsize::new(0));
    let pages = Arc::new(Mutex::new(Vec::new()));
    let response = tauri::async_runtime::block_on(async {
        let model = openai::OpenAIConfig::new("lm-studio")
            .with_base_url(&endpoint)
            .client()
            .chat(&model_name);
        let guard =
            crate::agent_guardrails::AgentRunGuard::new(crate::agent_guardrails::AgentRunLimits {
                max_elapsed: Some(std::time::Duration::from_secs(300)),
                max_tool_calls: 24,
                max_aggregate_tokens: 200_000,
                ..Default::default()
            });
        let mut context = usage_context::UsageContext::with_compaction(
            &request,
            sink.clone(),
            false,
            model.clone().into(),
            guard.clone(),
        );
        Arc::get_mut(&mut context)
            .unwrap()
            .set_test_capacity(19_000);
        let cancelled = CancellationToken::new();
        let agent = configured_builder(model, &request, local_parameters(Some("low")))
            .unwrap()
            .add_hook(RuntimeEventHook {
                compatible_chat: true,
                web_search_selection: Arc::default(),
                evidence_context: None,
                on_event: sink.clone(),
                cancelled: cancelled.clone(),
                permissions: None,
                guard: guard.clone(),
                tools: None,
                context: Some(context.clone()),
                measurement: None,
                result_stream: None,
            })
            .tool(PagedEvidence(calls.clone(), pages.clone()))
            .build();
        drive_agent(
            agent,
            request,
            AgentRuntimeObserver {
                evidence_context: None,
                cancelled,
                on_event: sink,
                permissions: None,
            },
            guard,
            None,
            Some(context),
            None,
        )
        .await
    });
    if let Ok(output) = std::env::var("GNEAUX_LIVE_OUTPUT") {
        std::fs::write(output, serde_json::to_vec_pretty(&json!({"toolCalls":calls.load(Ordering::Relaxed),"pages":*pages.lock().unwrap(),"events":*events.lock().unwrap(),"response":response.as_ref().ok().map(|r| &r.output),"error":response.as_ref().err()})).unwrap()).unwrap();
    }
    let response = response.unwrap();
    let mut pages = pages.lock().unwrap().clone();
    pages.sort_unstable();
    pages.dedup();
    assert_eq!(pages, (1..=10).collect::<Vec<_>>());
    assert!(response.output.contains("Tuesday"));
    assert!(response.output.contains("note://synthetic-launch"));
    assert!(events
        .lock()
        .unwrap()
        .iter()
        .any(|e| e["details"]["mode"] == "compaction" && e["details"]["phase"] == "completed"));
}
