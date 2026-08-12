use futures_util::{future::Either, StreamExt};
use rig_agent::agent::{
    run::AgentRun, Agent, AgentBuilder, AgentHook, HookContext, MultiTurnStreamItem, NoToolConfig,
    ToolCall as HookToolCall, ToolCallAction, ToolResultAction, ToolResultEvent,
};
use rig_core::{
    client::CompletionClient,
    completion::{CompletionModel, GetTokenUsage, Message, Usage},
    providers::openai,
    streaming::StreamedAssistantContent,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use url::Url;

pub(crate) const MAX_MODEL_CALLS: usize = 6;
pub(crate) const MAX_INVALID_TOOL_RETRIES: usize = 2;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentProvider {
    Openai,
    Local,
}

impl AgentProvider {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "openai" => Ok(Self::Openai),
            "local" => Ok(Self::Local),
            other => Err(format!("Unsupported chat provider '{other}'")),
        }
    }
}

pub(crate) struct AgentRuntimeRequest {
    pub(crate) provider: AgentProvider,
    pub(crate) model: String,
    pub(crate) api_key: Option<String>,
    pub(crate) local_base_url: String,
    pub(crate) preamble: String,
    pub(crate) prompt: Message,
    pub(crate) history: Vec<Message>,
    pub(crate) enable_web: bool,
    pub(crate) require_web: bool,
    pub(crate) flex: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct AgentRuntimeResponse {
    pub(crate) output: String,
    pub(crate) usage: Usage,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentUsage {
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) total_tokens: u64,
    pub(crate) cached_input_tokens: u64,
    pub(crate) cache_creation_input_tokens: u64,
    pub(crate) tool_use_prompt_tokens: u64,
    pub(crate) reasoning_tokens: u64,
}

impl From<Usage> for AgentUsage {
    fn from(value: Usage) -> Self {
        Self {
            input_tokens: value.input_tokens,
            output_tokens: value.output_tokens,
            total_tokens: value.total_tokens,
            cached_input_tokens: value.cached_input_tokens,
            cache_creation_input_tokens: value.cache_creation_input_tokens,
            tool_use_prompt_tokens: value.tool_use_prompt_tokens,
            reasoning_tokens: value.reasoning_tokens,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPlanEntry {
    pub(crate) id: String,
    pub(crate) text: String,
    pub(crate) status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum AgentEvent {
    TextDelta {
        delta: String,
    },
    ToolCallUpdated {
        call_id: String,
        name: String,
        title: String,
        status: String,
    },
    PlanUpdated {
        entries: Vec<AgentPlanEntry>,
    },
    UsageUpdated {
        call_index: usize,
        aggregate: AgentUsage,
    },
    ModelTurnRetried {
        turn: usize,
    },
    ReasoningUpdated {
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
    },
}

#[derive(Clone)]
pub(crate) struct AgentRuntimeObserver {
    pub(crate) cancelled: CancellationToken,
    pub(crate) on_event: Arc<dyn Fn(AgentEvent) + Send + Sync>,
}

#[derive(Clone)]
struct RuntimeEventHook {
    on_event: Arc<dyn Fn(AgentEvent) + Send + Sync>,
}

impl AgentHook for RuntimeEventHook {
    async fn on_tool_call(
        &self,
        _context: &HookContext,
        event: HookToolCall<'_>,
    ) -> ToolCallAction {
        (self.on_event)(AgentEvent::ToolCallUpdated {
            call_id: event.internal_call_id.to_string(),
            name: event.tool_name.to_string(),
            title: tool_title(event.tool_name),
            status: "running".to_string(),
        });
        ToolCallAction::run()
    }

    async fn on_tool_result(
        &self,
        _context: &HookContext,
        event: ToolResultEvent<'_>,
    ) -> ToolResultAction {
        (self.on_event)(AgentEvent::ToolCallUpdated {
            call_id: event.internal_call_id.to_string(),
            name: event.tool_name.to_string(),
            title: tool_title(event.tool_name),
            status: event.raw_result.status_name().to_string(),
        });
        ToolResultAction::keep()
    }
}

fn tool_title(name: &str) -> String {
    match name {
        "get_active_note" => "Read active note",
        "search_notes" => "Search notes",
        "read_note" => "Read note",
        "propose_note_edits" => "Prepare note changes",
        "propose_note_rewrite" => "Prepare note rewrite",
        "propose_create_note" => "Prepare new note",
        "update_plan" => "Update plan",
        other => return other.replace('_', " "),
    }
    .to_string()
}

/// The application-owned boundary around Rig. Provider-specific model types,
/// tool machinery, and Rig history never escape this module.
pub(crate) struct AgentRuntime;

impl AgentRuntime {
    pub(crate) fn configured_run(prompt: impl Into<Message>, history: Vec<Message>) -> AgentRun {
        AgentRun::new(prompt)
            .with_history(history)
            .max_turns(MAX_MODEL_CALLS)
            .max_invalid_tool_call_retries(MAX_INVALID_TOOL_RETRIES)
    }

    pub(crate) async fn run(
        mut request: AgentRuntimeRequest,
        tools: Option<crate::agent_tools::AgentToolContext>,
        observer: AgentRuntimeObserver,
    ) -> Result<AgentRuntimeResponse, String> {
        // Construct this explicitly as the stable, testable execution contract.
        // Rig's AgentRunner drives the same AgentRun state machine internally.
        let _run_contract = Self::configured_run(request.prompt.clone(), request.history.clone());

        match request.provider {
            AgentProvider::Openai => {
                let key = request
                    .api_key
                    .take()
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| "Add an OpenAI API key in Settings".to_string())?;
                let client = openai::Client::new(key)
                    .map_err(|error| format!("OpenAI setup failed: {error}"))?;
                let mut model = client.completion_model(&request.model);
                if request.enable_web {
                    model = model
                        .with_tool(openai::responses_api::ResponsesToolDefinition::web_search());
                }
                let params =
                    openai_parameters(request.enable_web, request.require_web, request.flex);
                run_model(model, request, tools, params, observer).await
            }
            AgentProvider::Local => {
                ensure_local_desktop()?;
                validate_local_base_url(&request.local_base_url)?;
                // LM Studio ignores this placeholder bearer token by default.
                // Supplying one lets us reuse Rig's OpenAI-compatible Chat
                // Completions client without coupling local chat to the user's
                // hosted OpenAI credential.
                let client = openai::CompletionsClient::builder()
                    .api_key("lm-studio")
                    .base_url(&request.local_base_url)
                    .build()
                    .map_err(|error| format!("Local model setup failed: {error}"))?;
                let model = client.completion_model(&request.model);
                run_model(model, request, tools, None, observer).await
            }
        }
    }
}

async fn run_model<M>(
    model: M,
    request: AgentRuntimeRequest,
    tools: Option<crate::agent_tools::AgentToolContext>,
    additional_params: Option<Value>,
    observer: AgentRuntimeObserver,
) -> Result<AgentRuntimeResponse, String>
where
    M: CompletionModel + 'static,
    M::StreamingResponse: Send + Unpin + GetTokenUsage,
{
    let builder =
        configured_builder(model, &request, additional_params).add_hook(RuntimeEventHook {
            on_event: Arc::clone(&observer.on_event),
        });
    let agent = match tools {
        Some(tools) => tools.build_agent(builder),
        None => builder.build(),
    };
    drive_agent(agent, request, observer).await
}

fn configured_builder<M>(
    model: M,
    request: &AgentRuntimeRequest,
    additional_params: Option<Value>,
) -> AgentBuilder<M, NoToolConfig>
where
    M: CompletionModel,
{
    let mut builder = AgentBuilder::new(model)
        .name("gneauxghts-vault-agent")
        .description("Searches and reads the local vault and prepares reviewed note changes")
        .preamble(&request.preamble)
        .default_max_turns(MAX_MODEL_CALLS);
    if let Some(params) = additional_params {
        builder = builder.additional_params(params);
    }
    builder
}

async fn drive_agent<M>(
    agent: Agent<M>,
    request: AgentRuntimeRequest,
    observer: AgentRuntimeObserver,
) -> Result<AgentRuntimeResponse, String>
where
    M: CompletionModel + 'static,
    M::StreamingResponse: Send + Unpin + GetTokenUsage,
{
    (observer.on_event)(AgentEvent::ReasoningUpdated {
        status: "running".to_string(),
        summary: None,
    });
    let mut stream = agent
        .runner(request.prompt)
        .history(request.history)
        .max_turns(MAX_MODEL_CALLS)
        .max_invalid_tool_call_retries(MAX_INVALID_TOOL_RETRIES)
        .tool_concurrency(4)
        .stream()
        .await;
    let mut response = None;
    let mut aggregate_usage = Usage::new();
    loop {
        let next = stream.next();
        let cancelled = observer.cancelled.cancelled();
        futures_util::pin_mut!(next, cancelled);
        let item = match futures_util::future::select(next, cancelled).await {
            Either::Left((item, _)) => item,
            Either::Right(_) => {
                (observer.on_event)(AgentEvent::ReasoningUpdated {
                    status: "cancelled".to_string(),
                    summary: None,
                });
                return Err("Request cancelled".to_string());
            }
        };
        let Some(item) = item else { break };
        let item = match item {
            Ok(item) => item,
            Err(error) => {
                (observer.on_event)(AgentEvent::ReasoningUpdated {
                    status: "error".to_string(),
                    summary: None,
                });
                return Err(format!("Agent run failed: {error}"));
            }
        };
        match item {
            MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(text)) => {
                (observer.on_event)(AgentEvent::TextDelta { delta: text.text });
            }
            MultiTurnStreamItem::CompletionCall(call) => {
                aggregate_usage += call.usage;
                (observer.on_event)(AgentEvent::UsageUpdated {
                    call_index: call.call_index,
                    aggregate: aggregate_usage.into(),
                });
            }
            MultiTurnStreamItem::ModelTurnRetried { turn } => {
                (observer.on_event)(AgentEvent::ModelTurnRetried { turn });
            }
            MultiTurnStreamItem::FinalResponse(final_response) => {
                response = Some(final_response);
            }
            // Reasoning and raw provider events are deliberately not exposed.
            _ => {}
        }
    }
    let Some(response) = response else {
        (observer.on_event)(AgentEvent::ReasoningUpdated {
            status: "error".to_string(),
            summary: None,
        });
        return Err("Agent run ended without a final response".to_string());
    };
    (observer.on_event)(AgentEvent::ReasoningUpdated {
        status: "completed".to_string(),
        summary: None,
    });
    Ok(AgentRuntimeResponse {
        output: response.output().to_string(),
        usage: response.usage(),
    })
}

fn openai_parameters(enable_web: bool, require_web: bool, flex: bool) -> Option<Value> {
    let mut values = Map::new();
    if enable_web && require_web {
        values.insert("tool_choice".to_string(), json!({"type": "web_search"}));
    }
    if flex {
        values.insert("service_tier".to_string(), json!("flex"));
    }
    (!values.is_empty()).then_some(Value::Object(values))
}

pub(crate) fn ensure_local_desktop() -> Result<(), String> {
    if cfg!(any(target_os = "ios", target_os = "android")) {
        Err("Local model chat is available on desktop only".to_string())
    } else {
        Ok(())
    }
}

pub(crate) fn validate_local_base_url(value: &str) -> Result<(), String> {
    let parsed = Url::parse(value.trim())
        .map_err(|_| "Enter a valid OpenAI-compatible base URL".to_string())?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Local model URLs cannot contain credentials".to_string());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Local model URLs cannot contain a query or fragment".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "Local model URL must include a host".to_string())?;
    let loopback = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if parsed.scheme() == "http" && !loopback {
        return Err("Plain HTTP is only allowed for a loopback local model server".to_string());
    }
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Local model URL must use HTTP or HTTPS".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rig_agent::tool::{Tool, ToolContext};
    use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
    use std::sync::Mutex;

    #[derive(Clone)]
    struct EchoTool;

    #[derive(Deserialize)]
    struct EchoArgs {
        value: String,
    }

    #[derive(Debug, thiserror::Error)]
    #[error("{0}")]
    struct EchoError(String);

    impl Tool for EchoTool {
        const NAME: &'static str = "echo";
        type Error = EchoError;
        type Args = EchoArgs;
        type Output = Value;

        fn description(&self) -> String {
            "Return the provided value".to_string()
        }

        fn parameters(&self) -> Value {
            json!({
                "type": "object",
                "properties": {"value": {"type": "string"}},
                "required": ["value"],
                "additionalProperties": false
            })
        }

        async fn call(
            &self,
            _context: &mut ToolContext,
            args: Self::Args,
        ) -> Result<Self::Output, Self::Error> {
            Ok(json!({"value": args.value}))
        }
    }

    fn fake_request(prompt: &str) -> AgentRuntimeRequest {
        AgentRuntimeRequest {
            provider: AgentProvider::Local,
            model: "fake".to_string(),
            api_key: None,
            local_base_url: "http://localhost:1234/v1".to_string(),
            preamble: "Use tools when useful.".to_string(),
            prompt: Message::user(prompt),
            history: Vec::new(),
            enable_web: false,
            require_web: false,
            flex: false,
        }
    }

    #[test]
    fn runtime_contract_uses_product_turn_budgets() {
        let run = AgentRuntime::configured_run(Message::user("hello"), vec![]);
        let encoded = serde_json::to_value(run).unwrap();
        assert_eq!(encoded["max_turns"], MAX_MODEL_CALLS);
        assert_eq!(
            encoded["max_invalid_tool_call_retries"],
            MAX_INVALID_TOOL_RETRIES
        );
    }

    #[test]
    fn local_url_policy_allows_loopback_http_and_credential_free_https() {
        assert!(validate_local_base_url("http://localhost:1234/v1").is_ok());
        assert!(validate_local_base_url("http://127.0.0.1:1234/v1").is_ok());
        assert!(validate_local_base_url("https://models.example.com/v1").is_ok());
        assert!(validate_local_base_url("http://models.example.com/v1").is_err());
        assert!(validate_local_base_url("https://user@example.com/v1").is_err());
        assert!(validate_local_base_url("https://example.com/v1?q=1").is_err());
    }

    #[test]
    fn forced_openai_web_selects_the_hosted_tool_and_flex_tier() {
        let params = openai_parameters(true, true, true).unwrap();
        assert_eq!(params["tool_choice"], json!({"type": "web_search"}));
        assert_eq!(params["service_tier"], "flex");
    }

    #[test]
    fn fake_completion_drives_tool_then_final_answer_without_reasoning_output() {
        tauri::async_runtime::block_on(async {
            let model = MockCompletionModel::from_stream_turns([
                vec![
                    MockStreamEvent::tool_call("call-1", "echo", json!({"value":"found"})),
                    MockStreamEvent::final_response_with_default_usage(),
                ],
                vec![
                    MockStreamEvent::reasoning("private reasoning"),
                    MockStreamEvent::text("Prepared the change."),
                    MockStreamEvent::final_response_with_total_tokens(7),
                ],
            ]);
            let observed = Arc::new(Mutex::new(String::new()));
            let observed_text = Arc::clone(&observed);
            let request = fake_request("Find and update it");
            let agent = configured_builder(model.clone(), &request, None)
                .tool(EchoTool)
                .build();
            let response = drive_agent(
                agent,
                request,
                AgentRuntimeObserver {
                    cancelled: CancellationToken::new(),
                    on_event: Arc::new(move |event| {
                        if let AgentEvent::TextDelta { delta } = event {
                            observed_text.lock().unwrap().push_str(&delta);
                        }
                    }),
                },
            )
            .await
            .unwrap();

            assert_eq!(model.request_count(), 2);
            assert_eq!(response.output, "Prepared the change.");
            assert_eq!(response.usage.total_tokens, 7);
            assert_eq!(&*observed.lock().unwrap(), "Prepared the change.");
        });
    }
}
