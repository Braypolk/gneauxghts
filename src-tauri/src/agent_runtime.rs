use futures_util::StreamExt;
use rig_agent::agent::{
    Agent, AgentBuilder, AgentHook, CompletionCallAction,
    CompletionCallEvent as HookCompletionCall, HookContext, MultiTurnStreamItem, NoToolConfig,
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

// High enough for long research/editing runs while retaining a final guard
// against a provider getting stuck in an unbounded tool-call loop.
pub(crate) const MAX_MODEL_CALLS: usize = 64;
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
    pub(crate) reasoning_effort: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct AgentRuntimeResponse {
    pub(crate) output: String,
    pub(crate) usage: Usage,
    pub(crate) stats: crate::agent_guardrails::AgentRunStats,
}

pub(crate) type AgentEventSink = Arc<dyn Fn(AgentEvent) + Send + Sync>;

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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        step_index: Option<usize>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input_summary: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output_summary: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_millis: Option<u64>,
    },
    StepUpdated {
        index: usize,
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        usage: Option<AgentUsage>,
    },
    RunGuardTriggered {
        reason: String,
        message: String,
    },
    ProposalLinked {
        proposal_id: String,
        title: String,
        kind: String,
    },
    ContextUpdated {
        compacted: bool,
        selected_note_titles: Vec<String>,
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
    PermissionRequested {
        request: crate::agent_permissions::AgentPermissionRequest,
    },
    PermissionResolved {
        permission_id: String,
        resolution: crate::agent_permissions::AgentPermissionResolution,
    },
}

impl AgentEvent {
    pub(crate) fn is_durable(&self) -> bool {
        !matches!(
            self,
            Self::TextDelta { .. }
                | Self::PermissionRequested { .. }
                | Self::PermissionResolved { .. }
        )
    }
}

#[derive(Clone)]
pub(crate) struct AgentRuntimeObserver {
    pub(crate) cancelled: CancellationToken,
    pub(crate) on_event: AgentEventSink,
    pub(crate) permissions: Option<crate::agent_permissions::AgentPermissionBoundary>,
}

#[derive(Clone)]
struct RuntimeEventHook {
    on_event: AgentEventSink,
    cancelled: CancellationToken,
    permissions: Option<crate::agent_permissions::AgentPermissionBoundary>,
    guard: crate::agent_guardrails::AgentRunGuard,
    tools: Option<crate::agent_tools::AgentToolContext>,
}

impl AgentHook for RuntimeEventHook {
    async fn on_completion_call(
        &self,
        _context: &HookContext,
        event: HookCompletionCall<'_>,
    ) -> CompletionCallAction {
        if let Err(violation) = self.guard.begin_model_call(event.turn) {
            emit_guard_violation(&self.on_event, &violation);
            return CompletionCallAction::stop(violation.message);
        }
        (self.on_event)(AgentEvent::StepUpdated {
            index: product_step_index(event.turn),
            status: "running".to_string(),
            usage: None,
        });
        CompletionCallAction::continue_run()
    }

    async fn on_tool_call(&self, context: &HookContext, event: HookToolCall<'_>) -> ToolCallAction {
        if let Err(violation) =
            self.guard
                .begin_tool(event.internal_call_id, event.tool_name, event.args)
        {
            emit_guard_violation(&self.on_event, &violation);
            (self.on_event)(AgentEvent::ToolCallUpdated {
                call_id: event.internal_call_id.to_string(),
                name: event.tool_name.to_string(),
                title: tool_title(event.tool_name, event.args, self.tools.as_ref()),
                status: "error".to_string(),
                step_index: Some(product_step_index(context.turn())),
                input_summary: tool_input_summary(event.tool_name, event.args),
                output_summary: Some(violation.message.clone()),
                duration_millis: self.guard.finish_tool(event.internal_call_id),
            });
            return ToolCallAction::stop(violation.message);
        }
        let permission = match &self.permissions {
            Some(boundary) => {
                boundary
                    .request_for_tool(
                        event.internal_call_id,
                        event.tool_name,
                        self.cancelled.clone(),
                        Arc::clone(&self.on_event),
                    )
                    .await
            }
            None => Ok(None),
        };
        match permission {
            Ok(Some(crate::agent_permissions::AgentPermissionResolution::Denied)) => {
                (self.on_event)(AgentEvent::ToolCallUpdated {
                    call_id: event.internal_call_id.to_string(),
                    name: event.tool_name.to_string(),
                    title: tool_title(event.tool_name, event.args, self.tools.as_ref()),
                    status: "denied".to_string(),
                    step_index: Some(product_step_index(context.turn())),
                    input_summary: tool_input_summary(event.tool_name, event.args),
                    output_summary: Some("Permission denied".to_string()),
                    duration_millis: self.guard.finish_tool(event.internal_call_id),
                });
                return ToolCallAction::skip("The user denied this permission request");
            }
            Ok(Some(crate::agent_permissions::AgentPermissionResolution::Cancelled)) => {
                return ToolCallAction::stop("Request cancelled");
            }
            Err(error) => return ToolCallAction::stop(error),
            _ => {}
        }
        (self.on_event)(AgentEvent::ToolCallUpdated {
            call_id: event.internal_call_id.to_string(),
            name: event.tool_name.to_string(),
            title: tool_title(event.tool_name, event.args, self.tools.as_ref()),
            status: "running".to_string(),
            step_index: Some(product_step_index(context.turn())),
            input_summary: tool_input_summary(event.tool_name, event.args),
            output_summary: None,
            duration_millis: None,
        });
        ToolCallAction::run()
    }

    async fn on_tool_result(
        &self,
        context: &HookContext,
        event: ToolResultEvent<'_>,
    ) -> ToolResultAction {
        let status = presented_tool_status(event.raw_result);
        (self.on_event)(AgentEvent::ToolCallUpdated {
            call_id: event.internal_call_id.to_string(),
            name: event.tool_name.to_string(),
            title: tool_title(event.tool_name, event.args, self.tools.as_ref()),
            status: status.to_string(),
            step_index: Some(product_step_index(context.turn())),
            input_summary: tool_input_summary(event.tool_name, event.args),
            output_summary: Some(tool_output_summary(event.tool_name, event.raw_result)),
            duration_millis: self.guard.finish_tool(event.internal_call_id),
        });
        ToolResultAction::keep()
    }
}

fn emit_guard_violation(
    on_event: &AgentEventSink,
    violation: &crate::agent_guardrails::AgentGuardViolation,
) {
    on_event(AgentEvent::RunGuardTriggered {
        reason: violation.reason.to_string(),
        message: violation.message.clone(),
    });
}

/// Rig hook turns are one-based while streamed completion-call indices are
/// zero-based. The app protocol uses the latter consistently.
fn product_step_index(rig_turn: usize) -> usize {
    rig_turn.saturating_sub(1)
}

fn tool_input_summary(name: &str, args: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(args).ok();
    match name {
        "search_notes" => value
            .as_ref()
            .and_then(|value| value.get("limit"))
            .and_then(Value::as_u64)
            .map(|limit| format!("Up to {limit} results")),
        "read_note" => value
            .as_ref()
            .and_then(|value| value.get("start_line"))
            .and_then(Value::as_u64)
            .filter(|line| *line > 1)
            .map(|line| format!("Continue from line {line}"))
            .or_else(|| Some("From the beginning".to_string())),
        "get_active_note" => Some("Adjacent to this chat".to_string()),
        "propose_note_edits" => value
            .as_ref()
            .and_then(|value| value.get("edits"))
            .and_then(Value::as_array)
            .map(|edits| {
                let count = edits.len();
                format!(
                    "{count} targeted {}",
                    if count == 1 { "edit" } else { "edits" }
                )
            }),
        "propose_note_rewrite" => Some("Complete note rewrite".to_string()),
        "propose_create_note" => Some("Review required before creation".to_string()),
        "update_plan" => value
            .as_ref()
            .and_then(|value| value.get("entries"))
            .and_then(Value::as_array)
            .map(|entries| {
                let count = entries.len();
                format!("{count} plan {}", if count == 1 { "item" } else { "items" })
            }),
        _ => None,
    }
}

fn presented_tool_status(result: &rig_core::tool::ToolResult) -> &str {
    let app_status = result
        .output()
        .as_json()
        .and_then(|value| value.get("status"))
        .and_then(Value::as_str);
    if matches!(app_status, Some("error" | "unavailable")) {
        "error"
    } else {
        result.status_name()
    }
}

fn tool_output_summary(name: &str, result: &rig_core::tool::ToolResult) -> String {
    let output = result.output().as_json();
    if presented_tool_status(result) == "error" {
        return output
            .and_then(|value| value.get("message").or_else(|| value.get("reason")))
            .and_then(Value::as_str)
            .map(short_activity_text)
            .unwrap_or_else(|| "Could not complete this action".to_string());
    }
    match (name, output) {
        ("search_notes", Some(value)) => value
            .get("items")
            .and_then(Value::as_array)
            .map(|items| {
                let count = items.len();
                format!(
                    "Found {count} {}",
                    if count == 1 { "note" } else { "notes" }
                )
            })
            .unwrap_or_else(|| "Search completed".to_string()),
        ("read_note", Some(value)) => {
            let start = value.get("startLine").and_then(Value::as_u64);
            let end = value.get("endLine").and_then(Value::as_u64);
            match (start, end) {
                (Some(start), Some(end))
                    if value.get("hasMore").and_then(Value::as_bool) == Some(true) =>
                {
                    format!("Read lines {start}–{end}; more remains")
                }
                (Some(start), Some(end)) => format!("Read lines {start}–{end}"),
                _ => "Note read".to_string(),
            }
        }
        ("get_active_note", Some(value))
            if value.get("truncated").and_then(Value::as_bool) == Some(true) =>
        {
            "Loaded a shortened view of the note".to_string()
        }
        ("get_active_note", _) => "Loaded the note".to_string(),
        ("propose_note_edits" | "propose_note_rewrite" | "propose_create_note", _) => {
            "Ready for review".to_string()
        }
        ("update_plan", Some(value)) => value
            .get("steps")
            .and_then(Value::as_u64)
            .map(|count| {
                format!(
                    "Updated {count} plan {}",
                    if count == 1 { "item" } else { "items" }
                )
            })
            .unwrap_or_else(|| "Plan updated".to_string()),
        (_, _) => match result.status_name() {
            "success" => "Completed".to_string(),
            "skipped" => "Skipped".to_string(),
            "denied" => "Permission denied".to_string(),
            _ => "Tool failed".to_string(),
        },
    }
}

fn short_activity_text(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = normalized.chars();
    let shortened = chars.by_ref().take(120).collect::<String>();
    if chars.next().is_some() {
        format!("{shortened}…")
    } else {
        shortened
    }
}

fn quoted_activity_text(value: &str) -> Option<String> {
    let value = short_activity_text(value.trim());
    (!value.is_empty()).then(|| format!("“{value}”"))
}

fn tool_title(
    name: &str,
    args: &str,
    tools: Option<&crate::agent_tools::AgentToolContext>,
) -> String {
    let value = serde_json::from_str::<Value>(args).ok();
    let argument = |key: &str| {
        value
            .as_ref()
            .and_then(|value| value.get(key))
            .and_then(Value::as_str)
    };
    let note_title = || {
        argument("note_id")
            .and_then(|note_id| tools.and_then(|tools| tools.activity_note_title(note_id)))
            .and_then(|title| quoted_activity_text(&title))
    };
    match name {
        "get_active_note" => tools
            .and_then(crate::agent_tools::AgentToolContext::active_note_title)
            .and_then(quoted_activity_text)
            .map(|title| format!("Read {title}"))
            .unwrap_or_else(|| "Read adjacent note".to_string()),
        "search_notes" => argument("query")
            .and_then(quoted_activity_text)
            .map(|query| format!("Search notes for {query}"))
            .unwrap_or_else(|| "Search notes".to_string()),
        "read_note" => note_title()
            .map(|title| format!("Read {title}"))
            .unwrap_or_else(|| "Read selected note".to_string()),
        "propose_note_edits" => note_title()
            .map(|title| format!("Prepare changes to {title}"))
            .unwrap_or_else(|| "Prepare note changes".to_string()),
        "propose_note_rewrite" => note_title()
            .map(|title| format!("Prepare rewrite of {title}"))
            .unwrap_or_else(|| "Prepare note rewrite".to_string()),
        "propose_create_note" => argument("title")
            .and_then(quoted_activity_text)
            .map(|title| format!("Prepare new note {title}"))
            .unwrap_or_else(|| "Prepare new note".to_string()),
        "update_plan" => value
            .as_ref()
            .and_then(|value| value.get("entries"))
            .and_then(Value::as_array)
            .and_then(|entries| {
                entries
                    .iter()
                    .find(|entry| entry.get("status").and_then(Value::as_str) == Some("inProgress"))
                    .or_else(|| entries.first())
            })
            .and_then(|entry| entry.get("text"))
            .and_then(Value::as_str)
            .map(short_activity_text)
            .filter(|text| !text.is_empty())
            .map(|text| format!("Update plan: {text}"))
            .unwrap_or_else(|| "Update plan".to_string()),
        other => other.replace('_', " "),
    }
}

/// The application-owned boundary around Rig. Provider-specific model types,
/// tool machinery, and Rig history never escape this module.
pub(crate) struct AgentRuntime;

impl AgentRuntime {
    pub(crate) async fn run(
        mut request: AgentRuntimeRequest,
        tools: Option<crate::agent_tools::AgentToolContext>,
        observer: AgentRuntimeObserver,
        guard: crate::agent_guardrails::AgentRunGuard,
    ) -> Result<AgentRuntimeResponse, String> {
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
                let params = openai_parameters(
                    request.enable_web,
                    request.require_web,
                    request.flex,
                    request.reasoning_effort.as_deref(),
                );
                run_model(model, request, tools, params, observer, guard).await
            }
            AgentProvider::Local => {
                ensure_local_desktop()?;
                validate_local_base_url(&request.local_base_url)?;
                // Rig requires a bearer token even when the compatible server
                // does not. Use the provider's credential when configured and
                // retain a harmless placeholder for unauthenticated servers.
                let key = request
                    .api_key
                    .take()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "lm-studio".to_string());
                let client = openai::CompletionsClient::builder()
                    .api_key(key)
                    .base_url(&request.local_base_url)
                    .build()
                    .map_err(|error| format!("Local model setup failed: {error}"))?;
                let model = client.completion_model(&request.model);
                let params = local_parameters(request.reasoning_effort.as_deref());
                run_model(model, request, tools, params, observer, guard).await
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
    guard: crate::agent_guardrails::AgentRunGuard,
) -> Result<AgentRuntimeResponse, String>
where
    M: CompletionModel + 'static,
    M::StreamingResponse: Send + Unpin + GetTokenUsage,
{
    let hook_tools = tools.clone();
    let builder =
        configured_builder(model, &request, additional_params).add_hook(RuntimeEventHook {
            on_event: Arc::clone(&observer.on_event),
            cancelled: observer.cancelled.clone(),
            permissions: observer.permissions.clone(),
            guard: guard.clone(),
            tools: hook_tools,
        });
    let agent = match tools {
        Some(tools) => tools.build_agent(builder),
        None => builder.build(),
    };
    drive_agent(agent, request, observer, guard).await
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
        .preamble(&request.preamble);
    if let Some(params) = additional_params {
        builder = builder.additional_params(params);
    }
    builder
}

async fn drive_agent<M>(
    agent: Agent<M>,
    request: AgentRuntimeRequest,
    observer: AgentRuntimeObserver,
    guard: crate::agent_guardrails::AgentRunGuard,
) -> Result<AgentRuntimeResponse, String>
where
    M: CompletionModel + 'static,
    M::StreamingResponse: Send + Unpin + GetTokenUsage,
{
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
        let remaining = match guard.deadline_remaining() {
            Ok(remaining) => remaining,
            Err(violation) => {
                emit_guard_violation(&observer.on_event, &violation);
                return Err(violation.message);
            }
        };
        let item = tokio::select! {
            item = stream.next() => item,
            _ = observer.cancelled.cancelled() => {
                return Err("Request cancelled".to_string());
            },
            _ = tokio::time::sleep(remaining) => {
                let violation = crate::agent_guardrails::AgentGuardViolation {
                    reason: "timeBudgetExceeded",
                    message: "The agent stopped after reaching its time limit.".to_string(),
                };
                emit_guard_violation(&observer.on_event, &violation);
                return Err(violation.message);
            },
        };
        let Some(item) = item else { break };
        let item = match item {
            Ok(item) => item,
            Err(error) => return Err(format!("Agent run failed: {error}")),
        };
        match item {
            MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(text)) => {
                (observer.on_event)(AgentEvent::TextDelta { delta: text.text });
            }
            MultiTurnStreamItem::CompletionCall(call) => {
                aggregate_usage += call.usage;
                (observer.on_event)(AgentEvent::StepUpdated {
                    index: call.call_index,
                    status: "completed".to_string(),
                    usage: Some(call.usage.into()),
                });
                (observer.on_event)(AgentEvent::UsageUpdated {
                    call_index: call.call_index,
                    aggregate: aggregate_usage.into(),
                });
                if let Err(violation) = guard.check_tokens(aggregate_usage.total_tokens) {
                    emit_guard_violation(&observer.on_event, &violation);
                    return Err(violation.message);
                }
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
        return Err("Agent run ended without a final response".to_string());
    };
    Ok(AgentRuntimeResponse {
        output: response.output().to_string(),
        usage: response.usage(),
        stats: guard.stats(),
    })
}

fn openai_parameters(
    enable_web: bool,
    require_web: bool,
    flex: bool,
    reasoning_effort: Option<&str>,
) -> Option<Value> {
    let mut values = Map::new();
    if enable_web && require_web {
        values.insert("tool_choice".to_string(), json!({"type": "web_search"}));
    }
    if flex {
        values.insert("service_tier".to_string(), json!("flex"));
    }
    if let Some(effort) = reasoning_effort {
        values.insert("reasoning".to_string(), json!({ "effort": effort }));
    }
    (!values.is_empty()).then_some(Value::Object(values))
}

fn local_parameters(reasoning_effort: Option<&str>) -> Option<Value> {
    reasoning_effort.map(|effort| {
        json!({
            "chat_template_kwargs": {
                "reasoning_effort": effort
            }
        })
    })
}

fn local_model_supports_reasoning_effort(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    normalized.contains("qwen3.8") || normalized.contains("qwen-3.8")
}

pub(crate) fn supported_reasoning_effort(
    provider: &AgentProvider,
    model: &str,
    effort: &str,
) -> Option<String> {
    let model = model.trim().to_ascii_lowercase();
    let supported = match provider {
        AgentProvider::Openai if model.starts_with("gpt-5.6") => {
            matches!(effort, "low" | "medium" | "high" | "xhigh" | "max")
        }
        AgentProvider::Openai if model.starts_with("gpt-5") => {
            matches!(effort, "low" | "medium" | "high" | "xhigh")
        }
        AgentProvider::Local if local_model_supports_reasoning_effort(&model) => {
            matches!(effort, "low" | "medium" | "xhigh")
        }
        _ => false,
    };
    supported.then(|| effort.to_string())
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
    parsed
        .host_str()
        .ok_or_else(|| "Local model URL must include a host".to_string())?;
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
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Mutex,
        },
    };

    #[derive(Clone)]
    struct EchoTool(Arc<AtomicUsize>);

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
            self.0.fetch_add(1, Ordering::Relaxed);
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
            reasoning_effort: Some("medium".to_string()),
        }
    }

    #[test]
    fn rig_hook_turns_share_the_streamed_completion_index() {
        assert_eq!(product_step_index(1), 0);
        assert_eq!(product_step_index(2), 1);
        assert_eq!(product_step_index(0), 0);
    }

    #[test]
    fn activity_titles_describe_search_create_and_plan_targets() {
        assert_eq!(
            tool_title(
                "search_notes",
                r#"{"query":"quarterly budget","limit":8}"#,
                None
            ),
            "Search notes for “quarterly budget”"
        );
        assert_eq!(
            tool_title(
                "propose_create_note",
                r#"{"title":"Q3 planning","markdown":"body"}"#,
                None
            ),
            "Prepare new note “Q3 planning”"
        );
        assert_eq!(
            tool_title(
                "update_plan",
                r#"{"entries":[{"text":"Review research","status":"completed"},{"text":"Draft the summary","status":"inProgress"}]}"#,
                None
            ),
            "Update plan: Draft the summary"
        );
    }

    #[test]
    fn activity_outcomes_summarize_known_tool_results() {
        let search = rig_core::tool::ToolResult::success(rig_core::tool::ToolOutput::json(
            json!({"status":"ready","items":[{"title":"One"},{"title":"Two"}]}),
        ));
        assert_eq!(
            tool_output_summary("search_notes", &search),
            "Found 2 notes"
        );

        let unavailable = rig_core::tool::ToolResult::success(rig_core::tool::ToolOutput::json(
            json!({"status":"unavailable","reason":"The note is outside the allowed vault."}),
        ));
        assert_eq!(presented_tool_status(&unavailable), "error");
        assert_eq!(
            tool_output_summary("read_note", &unavailable),
            "The note is outside the allowed vault."
        );
    }

    #[test]
    fn local_url_policy_allows_http_and_credential_free_https() {
        assert!(validate_local_base_url("http://localhost:1234/v1").is_ok());
        assert!(validate_local_base_url("http://127.0.0.1:1234/v1").is_ok());
        assert!(validate_local_base_url("http://models.example.com/v1").is_ok());
        assert!(validate_local_base_url("https://models.example.com/v1").is_ok());
        assert!(validate_local_base_url("https://user@example.com/v1").is_err());
        assert!(validate_local_base_url("https://example.com/v1?q=1").is_err());
    }

    #[test]
    fn forced_openai_web_selects_the_hosted_tool_and_flex_tier() {
        let params = openai_parameters(true, true, true, Some("high")).unwrap();
        assert_eq!(params["tool_choice"], json!({"type": "web_search"}));
        assert_eq!(params["service_tier"], "flex");
        assert_eq!(params["reasoning"], json!({"effort": "high"}));
    }

    #[test]
    fn qwen_local_reasoning_uses_chat_template_kwargs() {
        assert_eq!(
            supported_reasoning_effort(&AgentProvider::Local, "qwen/Qwen3.8-27B", "xhigh"),
            Some("xhigh".to_string())
        );
        assert_eq!(
            supported_reasoning_effort(&AgentProvider::Local, "qwen3-8b", "medium"),
            None
        );
        assert_eq!(
            supported_reasoning_effort(&AgentProvider::Openai, "gpt-5.4", "max"),
            None
        );
        let params = local_parameters(Some("medium")).unwrap();
        assert_eq!(params["chat_template_kwargs"]["reasoning_effort"], "medium");
    }

    #[test]
    fn fake_completion_waits_at_permission_boundary_then_drives_tool_without_reasoning_output() {
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
            let permission_broker = crate::agent_permissions::AgentPermissionBroker::default();
            let permission_boundary =
                crate::agent_permissions::AgentPermissionBoundary::with_requirements(
                    permission_broker.clone(),
                    crate::agent_permissions::AgentPermissionRunContext {
                        request_id: "request-1".to_string(),
                        conversation_id: "conversation-1".to_string(),
                        message_id: "message-1".to_string(),
                        run_id: "run-1".to_string(),
                    },
                    HashMap::from([(
                        "echo".to_string(),
                        crate::agent_permissions::AgentPermissionRequirement {
                            title: "Run fake side effect".to_string(),
                            kind: crate::agent_permissions::AgentPermissionKind::ProcessExecution,
                            scope: "test:echo".to_string(),
                        },
                    )]),
                );
            let saw_permission = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let saw_permission_event = Arc::clone(&saw_permission);
            let decision_broker = permission_broker.clone();
            let event_sink: Arc<dyn Fn(AgentEvent) + Send + Sync> =
                Arc::new(move |event| match event {
                    AgentEvent::TextDelta { delta } => {
                        observed_text.lock().unwrap().push_str(&delta);
                    }
                    AgentEvent::PermissionRequested { request } => {
                        saw_permission_event.store(true, std::sync::atomic::Ordering::Relaxed);
                        decision_broker
                            .decide(crate::agent_permissions::AgentPermissionDecisionCommand {
                                identity: request.identity,
                                decision:
                                    crate::agent_permissions::AgentPermissionDecision::AllowOnce,
                            })
                            .unwrap();
                    }
                    _ => {}
                });
            let cancelled = CancellationToken::new();
            let guard = crate::agent_guardrails::AgentRunGuard::new(Default::default());
            let tool_calls = Arc::new(AtomicUsize::new(0));
            let request = fake_request("Find and update it");
            let agent = configured_builder(model.clone(), &request, None)
                .add_hook(RuntimeEventHook {
                    on_event: Arc::clone(&event_sink),
                    cancelled: cancelled.clone(),
                    permissions: Some(permission_boundary.clone()),
                    guard: guard.clone(),
                    tools: None,
                })
                .tool(EchoTool(Arc::clone(&tool_calls)))
                .build();
            let response = drive_agent(
                agent,
                request,
                AgentRuntimeObserver {
                    cancelled,
                    on_event: event_sink,
                    permissions: Some(permission_boundary),
                },
                guard,
            )
            .await
            .unwrap();

            assert_eq!(model.request_count(), 2);
            assert_eq!(response.output, "Prepared the change.");
            assert_eq!(response.usage.total_tokens, 7);
            assert_eq!(&*observed.lock().unwrap(), "Prepared the change.");
            assert!(saw_permission.load(std::sync::atomic::Ordering::Relaxed));
            assert_eq!(tool_calls.load(Ordering::Relaxed), 1);
        });
    }

    #[test]
    fn denied_permission_skips_fake_tool_body_and_emits_denied_lifecycle() {
        tauri::async_runtime::block_on(async {
            let model = MockCompletionModel::from_stream_turns([
                vec![
                    MockStreamEvent::tool_call("call-1", "echo", json!({"value":"blocked"})),
                    MockStreamEvent::final_response_with_default_usage(),
                ],
                vec![
                    MockStreamEvent::reasoning("private denial reasoning"),
                    MockStreamEvent::text("Permission denied."),
                    MockStreamEvent::final_response_with_default_usage(),
                ],
            ]);
            let permission_broker = crate::agent_permissions::AgentPermissionBroker::default();
            let permission_boundary =
                crate::agent_permissions::AgentPermissionBoundary::with_requirements(
                    permission_broker.clone(),
                    crate::agent_permissions::AgentPermissionRunContext {
                        request_id: "request-denied".to_string(),
                        conversation_id: "conversation-1".to_string(),
                        message_id: "message-1".to_string(),
                        run_id: "run-denied".to_string(),
                    },
                    HashMap::from([(
                        "echo".to_string(),
                        crate::agent_permissions::AgentPermissionRequirement {
                            title: "Run fake side effect".to_string(),
                            kind: crate::agent_permissions::AgentPermissionKind::ProcessExecution,
                            scope: "test:echo".to_string(),
                        },
                    )]),
                );
            let observed = Arc::new(Mutex::new(Vec::<AgentEvent>::new()));
            let captured = Arc::clone(&observed);
            let decision_broker = permission_broker.clone();
            let event_sink: Arc<dyn Fn(AgentEvent) + Send + Sync> = Arc::new(move |event| {
                let decision = match &event {
                    AgentEvent::PermissionRequested { request } => {
                        Some(crate::agent_permissions::AgentPermissionDecisionCommand {
                            identity: request.identity.clone(),
                            decision: crate::agent_permissions::AgentPermissionDecision::Deny,
                        })
                    }
                    _ => None,
                };
                captured.lock().unwrap().push(event);
                if let Some(decision) = decision {
                    decision_broker.decide(decision).unwrap();
                }
            });
            let cancelled = CancellationToken::new();
            let guard = crate::agent_guardrails::AgentRunGuard::new(Default::default());
            let tool_calls = Arc::new(AtomicUsize::new(0));
            let request = fake_request("Try the fake side effect");
            let agent = configured_builder(model.clone(), &request, None)
                .add_hook(RuntimeEventHook {
                    on_event: Arc::clone(&event_sink),
                    cancelled: cancelled.clone(),
                    permissions: Some(permission_boundary.clone()),
                    guard: guard.clone(),
                    tools: None,
                })
                .tool(EchoTool(Arc::clone(&tool_calls)))
                .build();
            let response = drive_agent(
                agent,
                request,
                AgentRuntimeObserver {
                    cancelled,
                    on_event: event_sink,
                    permissions: Some(permission_boundary),
                },
                guard,
            )
            .await
            .unwrap();

            let events = observed.lock().unwrap();
            assert_eq!(tool_calls.load(Ordering::Relaxed), 0);
            assert_eq!(model.request_count(), 2);
            assert_eq!(response.output, "Permission denied.");
            assert!(events.iter().any(|event| matches!(
                event,
                AgentEvent::PermissionResolved {
                    resolution: crate::agent_permissions::AgentPermissionResolution::Denied,
                    ..
                }
            )));
            assert!(events.iter().any(|event| matches!(
                event,
                AgentEvent::ToolCallUpdated { status, .. } if status == "denied"
            )));
            assert!(events.iter().all(|event| {
                serde_json::to_string(event)
                    .map(|payload| !payload.contains("private denial reasoning"))
                    .unwrap_or(false)
            }));
        });
    }
}
