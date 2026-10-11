//! OpenAI request policy, independent of the engine's persistent raw parameters.
use rig_core::completion::CompletionRequest;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub(super) struct WebSearchSelection {
    dispatched: AtomicBool,
}

impl WebSearchSelection {
    pub(super) fn prepare(&self, request: &mut CompletionRequest) {
        // The initial hosted-tool selection makes search mandatory. Later calls
        // must allow ordinary tools and the non-executable result formatter.
        if self.dispatched.swap(true, Ordering::Relaxed) {
            if let Some(params) = request
                .additional_params
                .as_mut()
                .and_then(|p| p.as_object_mut())
            {
                if params
                    .get("tool_choice")
                    .and_then(|choice| choice.get("type"))
                    .and_then(|t| t.as_str())
                    == Some("web_search")
                {
                    params.remove("tool_choice");
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use rig_core::{
        completion::{CompletionRequest, ToolDefinition},
        providers::openai,
        test_utils::RecordingHttpClient,
    };
    use serde_json::{json, Value};

    #[test]
    fn forced_web_search_releases_selection_for_structured_answer_and_retries() {
        use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
        tauri::async_runtime::block_on(async {
            let model = MockCompletionModel::from_stream_turns([
                vec![
                    MockStreamEvent::text("Search results received."),
                    MockStreamEvent::final_response_with_default_usage(),
                ],
                vec![
                    MockStreamEvent::tool_call(
                        "done",
                        "final_result",
                        json!({"answer":"Verified answer"}),
                    ),
                    MockStreamEvent::final_response_with_default_usage(),
                ],
            ]);
            let request = AgentRuntimeRequest {
                provider: AgentProvider::Openai,
                model: "test-model".into(),
                api_key: None,
                local_base_url: "http://localhost:1234/v1".into(),
                output_schema: Some(
                    json!({"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"],"additionalProperties":false}),
                ),
                preamble: "Search, then answer.".into(),
                prompt: Message::user("Check the web"),
                history: vec![],
                enable_web: true,
                require_web: true,
                flex: true,
                reasoning_effort: Some("low".into()),
            };
            let result = run_model_with_measurement(
                model.clone(),
                request,
                None,
                openai_parameters(true, true, true, Some("low")),
                AgentRuntimeObserver {
                    evidence_context: None,
                    permissions: None,
                    cancelled: CancellationToken::new(),
                    on_event: Arc::new(|_| {}),
                },
                crate::agent_guardrails::AgentRunGuard::new(Default::default()),
                None,
                None,
            )
            .await
            .unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&result.output).unwrap(),
                json!({"answer":"Verified answer"})
            );
            let requests = model.requests();
            assert_eq!(requests.len(), 2);
            // Replay the captured production requests through the actual Responses
            // serializer: raw additional parameters otherwise override typed choices.
            let transport = RecordingHttpClient::default();
            let client = openai::OpenAI::new("test-key").with_http(transport.clone());
            let mut wire_model = client.responses("test-model");
            wire_model.wire = wire_model
                .wire
                .with_tool(openai::responses_api::ResponsesToolDefinition::web_search());
            for request in &requests {
                let _ = wire_model.call(request.clone()).await;
            }
            let mut finish = requests[1].clone();
            finish.tool_choice = Some(rig_core::message::ToolChoice::Specific {
                function_names: vec![rig_core::message::ToolName::new("final_result").unwrap()],
            });
            let _ = wire_model.call(finish).await;
            let bodies: Vec<Value> = transport
                .requests()
                .iter()
                .map(|r| serde_json::from_slice(&r.body).unwrap())
                .collect();
            assert_eq!(bodies[0]["tool_choice"], json!({"type":"web_search"}));
            for body in &bodies[1..2] {
                assert_ne!(
                    body["tool_choice"]["type"], "web_search",
                    "Forced search prevented the formatter: {body}"
                );
            }
            assert_eq!(
                bodies[2]["tool_choice"],
                json!({"type":"function","name":"final_result"})
            );
            for body in bodies {
                assert_eq!(body["service_tier"], "flex");
                assert_eq!(body["reasoning"]["effort"], "low");
                assert!(body["tools"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|t| t["type"] == "web_search"));
            }
        });
    }

    #[test]
    fn responses_wire_preserves_optional_function_arguments() {
        tauri::async_runtime::block_on(async {
            let transport = RecordingHttpClient::default();
            let client = openai::OpenAI::new("test-key").with_http(transport.clone());
            let mut model = client.responses("test-model");
            model.wire = model
                .wire
                .with_tool(openai::responses_api::ResponsesToolDefinition::web_search());
            let parameters = json!({"type":"object","properties":{"query":{"type":"string"},"cursor":{"type":"string"}},"oneOf":[{"required":["query"]},{"required":["cursor"]}],"additionalProperties":false});
            for _ in 0..2 {
                let request = CompletionRequest::new("Find launch code")
                    .tools(vec![ToolDefinition {
                        name: rig_core::message::ToolName::new("search_evidence").unwrap(),
                        description: "Search notes".into(),
                        parameters: parameters.clone(),
                    }])
                    .additional_params(json!({"reasoning":{"effort":"low"}}));
                // The empty mock response may fail decoding; the wire request is real.
                let _ = model.call(request).await;
            }
            let requests = transport.requests();
            assert_eq!(requests.len(), 2);
            for request in requests {
                let wire: Value = serde_json::from_slice(&request.body).unwrap();
                let tools = wire["tools"].as_array().unwrap();
                assert_eq!(
                    tools.len(),
                    2,
                    "Request tools must not accumulate across calls"
                );
                let function = tools
                    .iter()
                    .find(|tool| tool["name"] == "search_evidence")
                    .unwrap();
                assert_eq!(
                    function.get("strict"),
                    Some(&json!(false)),
                    "Responses must receive explicit false; omission changes optional fields"
                );
                assert_eq!(function["parameters"], parameters);
                assert!(tools.iter().any(|tool| tool["type"] == "web_search"));
                assert_eq!(wire["reasoning"]["effort"], "low");
            }
        });
    }
}
