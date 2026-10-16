mod compaction;
mod compatible_chat;
mod context_measurement;
pub(crate) use crate::provider_config::local_reasoning;
use crate::provider_config::model_metadata;
mod openai_model;
mod result_stream;
mod usage_context;
#[cfg(test)]
mod usage_context_live;
use futures_util::StreamExt;
use rig_agent::agent::{
    Agent, AgentBuilder, AgentHook, CompletionCallAction,
    CompletionCallEvent as HookCompletionCall, DispatchAction, DispatchEvent, HookContext,
    MultiTurnStreamItem, NoToolConfig, OutcomeAction, OutcomeEvent,
};
use rig_core::{
    completion::{Message, Usage},
    effect::EffectKind,
    operation::Completion,
    providers::openai,
    streaming::{Item, StreamEvent},
    DynModel,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

// Progress can continue across context compactions. Malformed output and
// repeated identical actions retain their separate recovery guards.
pub(crate) const MAX_MODEL_CALLS: usize = usize::MAX;
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

#[derive(Clone)]
pub(crate) struct AgentRuntimeRequest {
    pub(crate) provider: AgentProvider,
    pub(crate) model: String,
    pub(crate) api_key: Option<String>,
    pub(crate) local_base_url: String,
    pub(crate) preamble: String,
    /// Application-owned result shape, independent of executable capabilities.
    pub(crate) output_schema: Option<Value>,
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
    pub(crate) usage: AgentUsage,
    pub(crate) stats: crate::agent_guardrails::AgentRunStats,
}

pub(crate) type AgentEventSink = Arc<dyn Fn(AgentEvent) + Send + Sync>;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
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

impl AgentUsage {
    fn add(&mut self, other: &Self) {
        macro_rules! add { ($($field:ident),*) => { $(self.$field = self.$field.saturating_add(other.$field);)* }; }
        add!(
            input_tokens,
            output_tokens,
            total_tokens,
            cached_input_tokens,
            cache_creation_input_tokens,
            tool_use_prompt_tokens,
            reasoning_tokens
        );
    }
}

impl From<Usage> for AgentUsage {
    fn from(value: Usage) -> Self {
        Self {
            input_tokens: value.input_tokens.unwrap_or_default(),
            output_tokens: value.output_tokens.unwrap_or_default(),
            total_tokens: value.total_tokens.unwrap_or_default(),
            cached_input_tokens: value.cached_input_tokens.unwrap_or_default(),
            cache_creation_input_tokens: value.cache_creation_input_tokens.unwrap_or_default(),
            tool_use_prompt_tokens: value.tool_use_prompt_tokens.unwrap_or_default(),
            reasoning_tokens: value.reasoning_tokens.unwrap_or_default(),
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
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum AgentEvent {
    /// Internal transient result arguments; chat decodes them before UI delivery.
    ResultStream {
        attempt: usize,
        delta: Option<String>,
    },
    TextDelta {
        delta: String,
    },
    ToolCallUpdated {
        #[serde(alias = "call_id")]
        call_id: String,
        name: String,
        title: String,
        status: String,
        #[serde(default, alias = "step_index", skip_serializing_if = "Option::is_none")]
        step_index: Option<usize>,
        #[serde(
            default,
            alias = "input_summary",
            skip_serializing_if = "Option::is_none"
        )]
        input_summary: Option<String>,
        #[serde(
            default,
            alias = "output_summary",
            skip_serializing_if = "Option::is_none"
        )]
        output_summary: Option<String>,
        #[serde(
            default,
            alias = "duration_millis",
            skip_serializing_if = "Option::is_none"
        )]
        duration_millis: Option<u64>,
        /// App-admitted read destinations, never raw provider/tool output.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        read_sources: Vec<crate::chat::ChatSource>,
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
        #[serde(alias = "proposal_id")]
        proposal_id: String,
        title: String,
        kind: String,
    },
    ContextUpdated {
        compacted: bool,
        #[serde(alias = "selected_note_titles")]
        selected_note_titles: Vec<String>,
    },
    PlanUpdated {
        entries: Vec<AgentPlanEntry>,
    },
    UsageUpdated {
        #[serde(alias = "call_index")]
        call_index: usize,
        aggregate: AgentUsage,
    },
    QueryResolved {
        details: Value,
    },
    ResearchCompleted {
        details: Value,
    },
    ContextMeasured {
        details: Value,
    },
    ModelTurnRetried {
        turn: usize,
    },
    PermissionRequested {
        request: crate::agent_permissions::AgentPermissionRequest,
    },
    PermissionResolved {
        #[serde(alias = "permission_id")]
        permission_id: String,
        resolution: crate::agent_permissions::AgentPermissionResolution,
    },
}

impl AgentEvent {
    pub(crate) fn is_durable(&self) -> bool {
        !matches!(
            self,
            Self::ResultStream { .. }
                | Self::TextDelta { .. }
                | Self::PermissionRequested { .. }
                | Self::PermissionResolved { .. }
        )
    }
}

#[derive(Clone)]
pub(crate) struct AgentRuntimeObserver {
    /// Context validation remains active even when executable tools are disabled.
    pub(crate) evidence_context: Option<crate::agent_tools::AgentToolContext>,
    pub(crate) cancelled: CancellationToken,
    pub(crate) on_event: AgentEventSink,
    pub(crate) permissions: Option<crate::agent_permissions::AgentPermissionBoundary>,
}

#[derive(Clone)]
struct RuntimeEventHook {
    compatible_chat: bool,
    web_search_selection: Arc<openai_model::WebSearchSelection>,
    on_event: AgentEventSink,
    cancelled: CancellationToken,
    permissions: Option<crate::agent_permissions::AgentPermissionBoundary>,
    guard: crate::agent_guardrails::AgentRunGuard,
    tools: Option<crate::agent_tools::AgentToolContext>,
    evidence_context: Option<crate::agent_tools::AgentToolContext>,
    context: Option<Arc<usage_context::UsageContext>>,
    measurement: Option<Arc<context_measurement::Measurement>>,
    result_stream: Option<Arc<result_stream::ResultStream>>,
}

impl AgentHook for RuntimeEventHook {
    async fn on_completion_call(
        &self,
        _context: &HookContext,
        event: HookCompletionCall<'_>,
    ) -> CompletionCallAction {
        // Context-managed runs check the projected context after compaction.
        if self.context.is_none() {
            let bytes = serde_json::to_vec(&(event.prompt, event.history))
                .map(|b| b.len())
                .unwrap_or(usize::MAX);
            if let Err(violation) = self.guard.check_context_bytes(bytes) {
                emit_guard_violation(&self.on_event, &violation);
                return CompletionCallAction::stop(violation.message);
            }
        }
        if let Some(context) = &self.evidence_context {
            if let Err(error) = context.validate_context() {
                return CompletionCallAction::stop(error);
            }
        }
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

    async fn on_dispatch(
        &self,
        _context: &HookContext,
        event: DispatchEvent<'_>,
    ) -> DispatchAction {
        if let EffectKind::Completion { request, stream } = event.kind {
            let mut request = request.clone();
            if self.compatible_chat {
                compatible_chat::merge_system_messages(&mut request.chat_history);
            }
            if let (Some(result_stream), Some(tools)) = (&self.result_stream, &self.tools) {
                if let Err(error) = result_stream.constrain_sources(&mut request, tools) {
                    return DispatchAction::stop(error);
                }
            }
            if let Some(context) = &self.context {
                let compacted = match context.prepare(&mut request).await {
                    Ok(compacted) => compacted,
                    Err(error) => return DispatchAction::stop(error.to_string()),
                };
                // Summary inference can take time. Recheck sources after that
                // await before sending the continuation to the provider.
                if compacted {
                    if let Some(evidence) = &self.evidence_context {
                        if let Err(error) = evidence.validate_context() {
                            return DispatchAction::stop(error);
                        }
                    }
                }
                if self.cancelled.is_cancelled() {
                    return DispatchAction::stop("Request cancelled");
                }
                if let Some(tools) = self.tools.as_ref().or(self.evidence_context.as_ref()) {
                    tools.configure_evidence_allowance(Some(usize::MAX));
                }
            }
            self.web_search_selection.prepare(&mut request);
            if let Some(result_stream) = &self.result_stream {
                result_stream.begin(&request, &self.on_event);
            }
            if let Some(m) = &self.measurement {
                m.begin(&request, self.context.as_ref().and_then(|c| c.capacity()))
                    .await;
            }
            return DispatchAction::patch(EffectKind::Completion {
                request,
                stream: *stream,
            });
        }
        let Some(name) = event.tool_name() else {
            return DispatchAction::proceed();
        };
        let args = event.tool_args().unwrap_or("{}");
        let call_id = event
            .call_id
            .expect("tool dispatch has call identity")
            .to_string();
        if let Some(tools) = &self.tools {
            if let Err(error) = tools.check_cancelled() {
                return DispatchAction::skip(error.payload().to_string());
            }
        }

        if let Err(violation) = self.guard.begin_tool(&call_id, name, args) {
            emit_guard_violation(&self.on_event, &violation);
            (self.on_event)(AgentEvent::ToolCallUpdated {
                call_id: call_id.clone(),
                name: name.to_string(),
                title: tool_title(name, args, self.tools.as_ref()),
                status: "error".to_string(),
                step_index: Some(product_step_index(event.turn)),
                input_summary: tool_input_summary(name, args),
                output_summary: Some(violation.message.clone()),
                duration_millis: self.guard.finish_tool(&call_id),
                read_sources: Vec::new(),
            });
            return DispatchAction::stop(violation.message);
        }
        let permission = match &self.permissions {
            Some(boundary) => {
                boundary
                    .request_for_tool(
                        &call_id,
                        name,
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
                    call_id: call_id.clone(),
                    name: name.to_string(),
                    title: tool_title(name, args, self.tools.as_ref()),
                    status: "denied".to_string(),
                    step_index: Some(product_step_index(event.turn)),
                    input_summary: tool_input_summary(name, args),
                    output_summary: Some("Permission denied".to_string()),
                    duration_millis: self.guard.finish_tool(&call_id),
                    read_sources: Vec::new(),
                });
                return DispatchAction::skip("The user denied this permission request");
            }
            Ok(Some(crate::agent_permissions::AgentPermissionResolution::Cancelled)) => {
                return DispatchAction::stop("Request cancelled");
            }
            Err(error) => return DispatchAction::stop(error),
            _ => {}
        }
        (self.on_event)(AgentEvent::ToolCallUpdated {
            call_id: call_id.clone(),
            name: name.to_string(),
            title: tool_title(name, args, self.tools.as_ref()),
            status: "running".to_string(),
            step_index: Some(product_step_index(event.turn)),
            input_summary: tool_input_summary(name, args),
            output_summary: None,
            duration_millis: None,
            read_sources: Vec::new(),
        });
        DispatchAction::proceed()
    }

    async fn on_outcome(&self, _context: &HookContext, event: OutcomeEvent<'_>) -> OutcomeAction {
        let (Some(name), Some(result)) = (event.tool_name(), event.tool_result()) else {
            return OutcomeAction::proceed();
        };
        let args = event.tool_args().unwrap_or("{}");
        let call_id = event
            .call_id
            .expect("tool outcome has call identity")
            .to_string();
        (self.on_event)(AgentEvent::ToolCallUpdated {
            call_id: call_id.clone(),
            name: name.to_string(),
            title: tool_title(name, args, self.tools.as_ref()),
            status: presented_tool_status(result).to_string(),
            step_index: Some(product_step_index(event.turn)),
            input_summary: tool_input_summary(name, args),
            output_summary: Some(tool_output_summary(name, result)),
            duration_millis: self.guard.finish_tool(&call_id),
            read_sources: if presented_tool_status(result) != "error" {
                self.tools
                    .as_ref()
                    .and_then(|tools| {
                        result
                            .output()
                            .as_json()
                            .map(|output| tools.activity_read_sources(name, output))
                    })
                    .unwrap_or_default()
            } else {
                Vec::new()
            },
        });
        OutcomeAction::proceed()
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
        "find_notes" | "search_notes" | "search_evidence" | "list_note_activity" => value
            .as_ref()
            .and_then(|value| value.get("limit"))
            .and_then(Value::as_u64)
            .map(|limit| format!("Up to {limit} results")),
        "read_note" | "read_working_note" | "read_notes"
            if name != "read_notes" || value.as_ref().is_some_and(|v| v["purpose"] == "edit") =>
        {
            value
                .as_ref()
                .and_then(|value| value.get("start_line"))
                .and_then(Value::as_u64)
                .filter(|line| *line > 1)
                .map(|line| format!("Continue from line {line}"))
                .or_else(|| Some("From the beginning".to_string()))
        }
        "current_note_history" => Some("Current excerpts and revision evidence only".to_string()),
        "get_active_note" => Some("Adjacent to this chat".to_string()),
        "propose_note_change" => match value.as_ref().and_then(|v| v["operation"].as_str()) {
            Some("create") => Some("Review required before creation".into()),
            Some("replace") => Some("Complete note replacement".into()),
            _ => value
                .as_ref()
                .and_then(|v| v["edits"].as_array())
                .map(|edits| format!("{} targeted edits", edits.len())),
        },
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
            .or_else(|| result.output().as_text())
            .map(short_activity_text)
            .unwrap_or_else(|| "Could not complete this action".to_string());
    }
    match (name, output) {
        ("read_evidence" | "read_notes" | "research_notes", Some(value))
            if value.get("items").is_some() =>
        {
            format!(
                "Read {} passages from {} notes{}",
                value["items"].as_array().map_or(0, Vec::len),
                value["notesRead"].as_u64().unwrap_or_else(|| {
                    value["items"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|item| item["noteId"].as_str())
                        .collect::<std::collections::HashSet<_>>()
                        .len() as u64
                }),
                if value["delivery"]["complete"] == false
                    || value["truncated"] == true
                    || matches!(value["status"].as_str(), Some("partial" | "limited"))
                {
                    "; incomplete delivery"
                } else if value["failures"]
                    .as_array()
                    .is_some_and(|items| !items.is_empty())
                {
                    "; some passages unavailable"
                } else if value["nextCursor"].as_str().is_some() {
                    "; more remains"
                } else {
                    ""
                }
            )
        }
        ("list_note_activity" | "find_notes", Some(value))
            if value.get("notesReturned").is_some() =>
        {
            format!(
                "Found {} notes with recorded activity{}",
                value["notesReturned"].as_u64().unwrap_or(0),
                if value["coverage"]["complete"] == false {
                    "; coverage is partial"
                } else {
                    ""
                }
            )
        }
        ("search_evidence" | "find_notes", Some(value)) => format!(
            "Matched {} candidate passages{}",
            value["items"].as_array().map_or(0, Vec::len),
            if value["coverage"]["complete"] == false {
                "; coverage is partial"
            } else {
                ""
            }
        ),
        ("current_note_history", _) => "Checked current-note history evidence".to_string(),
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
        ("read_note" | "read_working_note" | "read_notes", Some(value)) => {
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
        (
            "propose_note_change"
            | "propose_note_edits"
            | "propose_note_rewrite"
            | "propose_create_note",
            _,
        ) => "Ready for review".to_string(),
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
        "find_notes" if argument("result") == Some("notes") => {
            "Find notes with recorded activity".into()
        }
        "find_notes" | "search_notes" | "search_evidence" => argument("query")
            .and_then(quoted_activity_text)
            .map(|query| format!("Search notes for {query}"))
            .unwrap_or_else(|| "Search notes".to_string()),
        "read_notes" if argument("purpose") == Some("edit") => note_title()
            .map(|title| format!("Read {title} for editing"))
            .unwrap_or_else(|| "Read note for editing".into()),
        "read_notes" | "read_evidence" => "Read selected passages".into(),
        "list_note_activity" => "Find notes with recorded activity".into(),
        "research_notes" => "Research across notes".into(),
        "current_note_history" => "Check current-note history".to_string(),
        "read_note" | "read_working_note" => note_title()
            .map(|title| format!("Read {title}"))
            .unwrap_or_else(|| "Read selected note".to_string()),
        "propose_note_change" if argument("operation") == Some("create") => argument("title")
            .and_then(quoted_activity_text)
            .map(|title| format!("Prepare new note {title}"))
            .unwrap_or_else(|| "Prepare new note".into()),
        "propose_note_change" | "propose_note_edits" => note_title()
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
        if let Some(tools) = &tools {
            tools.configure_research(request.clone(), observer.clone(), guard.clone());
        }
        match request.provider {
            AgentProvider::Openai => {
                let key = request
                    .api_key
                    .take()
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| "Add an OpenAI API key in Settings".to_string())?;
                let client = openai::OpenAIConfig::new(key)
                    .with_base_url(openai_api_base_url()?)
                    .client();
                let mut model = client.responses(&request.model);
                if request.enable_web {
                    model.wire = model
                        .wire
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
                ensure_compatible_chat_supported()?;
                validate_local_base_url(&request.local_base_url)?;
                // Rig requires a bearer token even when the compatible server
                // does not. Use the provider's credential when configured and
                // retain a harmless placeholder for unauthenticated servers.
                let key = request
                    .api_key
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "lm-studio".to_string());
                let client = openai::OpenAIConfig::new(key)
                    .with_base_url(&request.local_base_url)
                    .client();
                let model = client.chat(&request.model);
                let reasoning = local_reasoning::discover(
                    &request.local_base_url,
                    request.api_key.as_deref(),
                    &request.model,
                )
                .await;
                let params = local_parameters(local_reasoning::wire_effort(
                    reasoning.as_ref(),
                    request.reasoning_effort.as_deref(),
                ));
                run_model(model, request, tools, params, observer, guard).await
            }
        }
    }
}

// Size-only diagnostics reused by the opt-in synthetic provider wrapper.
#[cfg(test)]
pub(crate) fn measure_synthetic_request(
    request: &rig_core::completion::CompletionRequest,
) -> Value {
    context_measurement::measure(request)
}

#[cfg(test)]
pub(crate) async fn run_test_model(
    model: impl Into<DynModel<Completion>>,
    request: AgentRuntimeRequest,
    tools: Option<crate::agent_tools::AgentToolContext>,
    observer: AgentRuntimeObserver,
    guard: crate::agent_guardrails::AgentRunGuard,
) -> Result<AgentRuntimeResponse, String> {
    run_model_with_measurement(model, request, tools, None, observer, guard, None, None).await
}

/// Exact tool lifecycle capture is compiled only for opted-in synthetic tests.
#[cfg(test)]
pub(crate) async fn run_traced_test_model(
    model: impl Into<DynModel<Completion>>,
    request: AgentRuntimeRequest,
    tools: Option<crate::agent_tools::AgentToolContext>,
    observer: AgentRuntimeObserver,
    guard: crate::agent_guardrails::AgentRunGuard,
    trace: Arc<std::sync::Mutex<Vec<Value>>>,
) -> Result<AgentRuntimeResponse, String> {
    run_model_with_measurement(
        model,
        request,
        tools,
        None,
        observer,
        guard,
        None,
        Some(trace),
    )
    .await
}

#[cfg(test)]
struct SyntheticToolTrace(Arc<std::sync::Mutex<Vec<Value>>>);

#[cfg(test)]
impl SyntheticToolTrace {
    fn record(&self, value: Value) {
        // Keep diagnostic retention bounded even on rejected tool paths.
        let mut trace = self.0.lock().unwrap();
        if trace.len() < 32 {
            trace.push(if value.to_string().len() <= 64_000 {
                value
            } else {
                json!({"type":"trace_oversized"})
            });
        }
    }
}

#[cfg(test)]
impl AgentHook for SyntheticToolTrace {
    async fn on_dispatch(
        &self,
        _context: &HookContext,
        event: DispatchEvent<'_>,
    ) -> DispatchAction {
        if let Some(name) = event.tool_name() {
            self.record(json!({"type":"toolcall","turn":event.turn,"id":event.call_id.map(ToString::to_string),"name":name,"arguments":event.tool_args()}));
        }
        DispatchAction::proceed()
    }
    async fn on_outcome(&self, _context: &HookContext, event: OutcomeEvent<'_>) -> OutcomeAction {
        if let (Some(name), Some(result)) = (event.tool_name(), event.tool_result()) {
            self.record(json!({"type":"toolresult","turn":event.turn,"id":event.call_id.map(ToString::to_string),"name":name,"arguments":event.tool_args(),"content":result.output().as_content()}));
        }
        OutcomeAction::proceed()
    }
}

#[cfg(test)]
pub(crate) async fn measure_test_model(
    model: rig_core::test_utils::MockCompletionModel,
    request: AgentRuntimeRequest,
    tools: Option<crate::agent_tools::AgentToolContext>,
    observer: AgentRuntimeObserver,
) -> Result<AgentRuntimeResponse, String> {
    let measurement =
        context_measurement::Measurement::enabled(&request, observer.on_event.clone(), false);
    run_model_with_measurement(
        model,
        request,
        tools,
        None,
        observer,
        crate::agent_guardrails::AgentRunGuard::new(Default::default()),
        Some(measurement),
        None,
    )
    .await
}

async fn run_model(
    model: impl Into<DynModel<Completion>>,
    request: AgentRuntimeRequest,
    tools: Option<crate::agent_tools::AgentToolContext>,
    additional_params: Option<Value>,
    observer: AgentRuntimeObserver,
    guard: crate::agent_guardrails::AgentRunGuard,
) -> Result<AgentRuntimeResponse, String> {
    let measurement = context_measurement::Measurement::configured(
        &request,
        observer.on_event.clone(),
        tools
            .as_ref()
            .is_some_and(|tools| tools.is_research_worker()),
    );
    run_model_with_measurement(
        model,
        request,
        tools,
        additional_params,
        observer,
        guard,
        measurement,
        #[cfg(test)]
        None,
    )
    .await
}

async fn run_model_with_measurement(
    model: impl Into<DynModel<Completion>>,
    request: AgentRuntimeRequest,
    tools: Option<crate::agent_tools::AgentToolContext>,
    additional_params: Option<Value>,
    observer: AgentRuntimeObserver,
    guard: crate::agent_guardrails::AgentRunGuard,
    measurement: Option<Arc<context_measurement::Measurement>>,
    #[cfg(test)] synthetic_trace: Option<Arc<std::sync::Mutex<Vec<Value>>>>,
) -> Result<AgentRuntimeResponse, String> {
    let result_stream = request
        .output_schema
        .clone()
        .map(result_stream::ResultStream::new);
    let model = model.into();
    let context = usage_context::UsageContext::with_compaction(
        &request,
        observer.on_event.clone(),
        tools.as_ref().is_some_and(|t| t.is_research_worker()),
        model.clone(),
        guard.clone(),
    );
    let hook_context = tools.clone();
    let hook_tools = tools.clone();
    let builder = configured_builder(model, &request, additional_params)?;
    #[cfg(test)]
    let builder = if let Some(trace) = synthetic_trace {
        builder.add_hook(SyntheticToolTrace(trace))
    } else {
        builder
    };
    let builder = builder.add_hook(RuntimeEventHook {
        compatible_chat: request.provider == AgentProvider::Local,
        web_search_selection: Arc::default(),
        on_event: Arc::clone(&observer.on_event),
        cancelled: observer.cancelled.clone(),
        permissions: observer.permissions.clone(),
        guard: guard.clone(),
        evidence_context: observer
            .evidence_context
            .clone()
            .or_else(|| hook_tools.clone()),
        tools: hook_tools,
        context: Some(context.clone()),
        measurement: measurement.clone(),
        result_stream: result_stream.clone(),
    });
    let agent = match tools {
        Some(tools) => tools.build_agent(builder),
        None => builder.build(),
    };
    let mut response = drive_agent(
        agent,
        request,
        observer,
        guard,
        measurement,
        Some(context),
        result_stream,
    )
    .await?;
    if let Some(tools) = &hook_context {
        let child = tools.research_usage();
        response.usage.input_tokens += child.input_tokens;
        response.usage.output_tokens += child.output_tokens;
        response.usage.total_tokens += child.total_tokens;
        response.usage.cached_input_tokens += child.cached_input_tokens;
        response.usage.cache_creation_input_tokens += child.cache_creation_input_tokens;
        response.usage.tool_use_prompt_tokens += child.tool_use_prompt_tokens;
        response.usage.reasoning_tokens += child.reasoning_tokens;
    }
    Ok(response)
}

fn configured_builder(
    model: impl Into<DynModel<Completion>>,
    request: &AgentRuntimeRequest,
    additional_params: Option<Value>,
) -> Result<AgentBuilder<NoToolConfig>, String> {
    let mut builder = AgentBuilder::new(model)
        .name("gneauxghts-vault-agent")
        .description("Searches and reads the local vault and prepares reviewed note changes")
        .preamble(&request.preamble);
    if let Some(params) = additional_params {
        builder = builder.additional_params(params);
    }
    if let Some(schema) = &request.output_schema {
        builder = builder
            .output_schema_raw(
                schema
                    .clone()
                    .try_into()
                    .map_err(|_| "Configured result schema must be an object".to_string())?,
            )
            .output_mode(rig_agent::agent::OutputMode::Tool);
    }
    Ok(builder)
}

async fn drive_agent(
    agent: Agent,
    request: AgentRuntimeRequest,
    observer: AgentRuntimeObserver,
    guard: crate::agent_guardrails::AgentRunGuard,
    measurement: Option<Arc<context_measurement::Measurement>>,
    context: Option<Arc<usage_context::UsageContext>>,
    result_stream: Option<Arc<result_stream::ResultStream>>,
) -> Result<AgentRuntimeResponse, String> {
    let mut stream = agent
        .prompt(request.prompt)
        .history(request.history)
        .max_turns(MAX_MODEL_CALLS)
        .max_invalid_tool_call_retries(MAX_INVALID_TOOL_RETRIES)
        .tool_concurrency(1)
        .stream();
    let mut response = None;
    let mut aggregate_usage = AgentUsage::default();
    loop {
        if observer.cancelled.is_cancelled() {
            return Err("Request cancelled".into());
        }
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
            _ = async { match remaining { Some(duration) => tokio::time::sleep(duration).await, None => std::future::pending::<()>().await } } => {
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
            Err(error) => {
                return Err(format!("Agent run failed: {error}"));
            }
        };
        if let (Some(result_stream), MultiTurnStreamItem::StreamAssistantItem(Item::Event(event))) =
            (&result_stream, &item)
        {
            result_stream.observe(event, &observer.on_event);
        }
        match item {
            MultiTurnStreamItem::StreamAssistantItem(Item::Event(StreamEvent::Text {
                text,
                ..
            })) if result_stream.is_none() => {
                (observer.on_event)(AgentEvent::TextDelta { delta: text });
            }
            MultiTurnStreamItem::CompletionCall(call) => {
                if let Some(context) = &context {
                    context.observe(call.usage);
                }
                if let Some(m) = &measurement {
                    m.finish(Some(call.call_index), call.usage);
                }
                let counted = AgentUsage::from(call.usage);
                aggregate_usage.input_tokens += counted.input_tokens;
                aggregate_usage.output_tokens += counted.output_tokens;
                aggregate_usage.total_tokens += counted.total_tokens;
                aggregate_usage.cached_input_tokens += counted.cached_input_tokens;
                aggregate_usage.cache_creation_input_tokens += counted.cache_creation_input_tokens;
                aggregate_usage.tool_use_prompt_tokens += counted.tool_use_prompt_tokens;
                aggregate_usage.reasoning_tokens += counted.reasoning_tokens;
                (observer.on_event)(AgentEvent::StepUpdated {
                    index: call.call_index,
                    status: "completed".to_string(),
                    usage: Some(call.usage.into()),
                });
                let mut reported = aggregate_usage.clone();
                if let Some(context) = &context {
                    reported.add(&context.compaction_usage());
                }
                (observer.on_event)(AgentEvent::UsageUpdated {
                    call_index: call.call_index,
                    aggregate: reported,
                });
                if let Err(violation) =
                    guard.add_tokens(call.usage.total_tokens.unwrap_or_default())
                {
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
    let mut usage: AgentUsage = response.usage().into();
    if let Some(context) = &context {
        usage.add(&context.compaction_usage());
    }
    if observer.cancelled.is_cancelled() {
        return Err("Request cancelled".into());
    }
    Ok(AgentRuntimeResponse {
        output: response.output().to_string(),
        usage,
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
    // The local OpenAI-compatible endpoint consumes this at the request root.
    // LM Studio silently ignores the nested chat_template_kwargs form.
    reasoning_effort.map(|effort| json!({ "reasoning_effort": effort }))
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
        AgentProvider::Local => local_reasoning::valid_option(effort),
        _ => false,
    };
    supported.then(|| effort.to_string())
}

#[cfg(test)]
use crate::provider_config::validate_openai_fixture_url;
pub(crate) use crate::provider_config::{
    ensure_compatible_chat_supported, openai_api_base_url, validate_local_base_url,
};

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

    // Own the coupled hook/runner setup once; each test still supplies its
    // concrete tools, formatter, permission decisions, and usage context.
    struct RuntimeHarness {
        observer: AgentRuntimeObserver,
        guard: crate::agent_guardrails::AgentRunGuard,
        context: Option<Arc<usage_context::UsageContext>>,
    }
    impl RuntimeHarness {
        fn builder(
            &self,
            model: impl Into<DynModel<Completion>>,
            request: &AgentRuntimeRequest,
        ) -> AgentBuilder<NoToolConfig> {
            configured_builder(model, request, None)
                .unwrap()
                .add_hook(RuntimeEventHook {
                    compatible_chat: request.provider == AgentProvider::Local,
                    web_search_selection: Arc::default(),
                    on_event: self.observer.on_event.clone(),
                    cancelled: self.observer.cancelled.clone(),
                    permissions: self.observer.permissions.clone(),
                    guard: self.guard.clone(),
                    tools: None,
                    evidence_context: self.observer.evidence_context.clone(),
                    context: self.context.clone(),
                    measurement: None,
                    result_stream: None,
                })
        }
        async fn run(
            self,
            agent: Agent,
            request: AgentRuntimeRequest,
        ) -> Result<AgentRuntimeResponse, String> {
            drive_agent(
                agent,
                request,
                self.observer,
                self.guard,
                None,
                self.context,
                None,
            )
            .await
        }
    }

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
            output_schema: None,
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
    fn context_measurement_covers_system_and_reports_usage_without_content() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let capture = events.clone();
        let mut request = fake_request("PRIVATE_PROMPT_CANARY");
        request.provider = AgentProvider::Openai; // Mock only; no metadata probe.
        request.preamble = "PRIVATE_SYSTEM_CANARY ".repeat(500);
        let measurement_capture = events.clone();
        let measurement = context_measurement::Measurement::enabled(
            &request,
            Arc::new(move |e| {
                measurement_capture
                    .lock()
                    .unwrap()
                    .push(serde_json::to_value(e).unwrap());
            }),
            false,
        );
        let response = tauri::async_runtime::block_on(run_model_with_measurement(
            MockCompletionModel::from_stream_turns([vec![
                MockStreamEvent::text("Test answer"),
                MockStreamEvent::final_response(
                    Usage::default()
                        .input_tokens(3000)
                        .output_tokens(3)
                        .total_tokens(3003),
                ),
            ]]),
            request,
            None,
            None,
            AgentRuntimeObserver {
                evidence_context: None,
                cancelled: CancellationToken::new(),
                on_event: Arc::new(move |e| {
                    capture
                        .lock()
                        .unwrap()
                        .push(serde_json::to_value(e).unwrap())
                }),
                permissions: None,
            },
            crate::agent_guardrails::AgentRunGuard::new(Default::default()),
            Some(measurement),
            None,
        ));
        assert_eq!(response.unwrap().output, "Test answer");
        let events = events.lock().unwrap();
        let measurements: Vec<_> = events
            .iter()
            .filter(|e| e["type"] == "contextMeasured")
            .collect();
        assert_eq!(
            measurements.len(),
            2,
            "before-call and completed usage diagnostics"
        );
        assert!(measurements[0]["details"]["inputBytes"].as_u64().unwrap() > 10000);
        assert_eq!(
            measurements[0]["details"]["attempt"],
            measurements[1]["details"]["attempt"]
        );
        assert!(
            measurements[1]["details"]["reportedUsage"]["inputTokens"]
                .as_u64()
                .unwrap()
                > 0
        );
        let diagnostic = serde_json::to_string(&measurements).unwrap();
        assert!(!diagnostic.contains("PRIVATE_"));
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
        let failed =
            rig_core::tool::ToolResult::failed(rig_core::tool::ToolExecutionError::invalid_args(
                "Choose exactly one of evidence_ids, note_id, or cursor",
            ));
        assert_eq!(
            tool_output_summary("read_evidence", &failed),
            "Choose exactly one of evidence_ids, note_id, or cursor"
        );
        let read = rig_core::tool::ToolResult::success(rig_core::tool::ToolOutput::json(json!({
            "items":[{"noteId":"a"},{"noteId":"a"},{"noteId":"b"}],
            "delivery":{"complete":false,"hasMore":true}
        })));
        assert_eq!(
            tool_output_summary("read_notes", &read),
            "Read 3 passages from 2 notes; incomplete delivery"
        );
        let partial = rig_core::tool::ToolResult::success(rig_core::tool::ToolOutput::json(
            json!({"status":"partial","items":[],"gaps":["Research could not finish"]}),
        ));
        assert_eq!(
            tool_output_summary("research_notes", &partial),
            "Read 0 passages from 0 notes; incomplete delivery"
        );
        let inventory = rig_core::tool::ToolResult::success(rig_core::tool::ToolOutput::json(
            json!({"status":"ready","notesReturned":9,"coverage":{"complete":true}}),
        ));
        assert_eq!(
            tool_output_summary("find_notes", &inventory),
            "Found 9 notes with recorded activity"
        );
        let search = rig_core::tool::ToolResult::success(rig_core::tool::ToolOutput::json(
            json!({"status":"ready","items":[{"title":"One"},{"title":"Two"}]}),
        ));
        assert_eq!(
            tool_output_summary("search_notes", &search),
            "Found 2 notes"
        );

        assert_eq!(
            tool_output_summary("find_notes", &search),
            "Matched 2 candidate passages"
        );
        assert_eq!(
            tool_title("read_notes", r#"{"purpose":"edit"}"#, None),
            "Read note for editing"
        );
        assert_eq!(
            tool_title(
                "propose_note_change",
                r#"{"operation":"create","title":"Draft"}"#,
                None
            ),
            "Prepare new note “Draft”"
        );
        assert_eq!(
            tool_input_summary("read_notes", r#"{"purpose":"answer"}"#),
            None
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
    fn protocol_fixture_endpoint_cannot_send_credentials_to_a_remote_host() {
        for endpoint in [
            "http://127.0.0.1:18440/v1",
            "http://localhost:18440/v1",
            "http://[::1]:18440/v1",
        ] {
            assert!(validate_openai_fixture_url(endpoint).is_ok());
        }
        for endpoint in [
            "https://models.example.com/v1",
            "http://192.168.1.5/v1",
            "http://user@localhost/v1",
            "http://localhost/v1?key=secret",
        ] {
            assert!(validate_openai_fixture_url(endpoint).is_err());
        }
    }

    #[test]
    fn forced_openai_web_selects_the_hosted_tool_and_flex_tier() {
        let params = openai_parameters(true, true, true, Some("high")).unwrap();
        assert_eq!(params["tool_choice"], json!({"type": "web_search"}));
        assert_eq!(params["service_tier"], "flex");
        assert_eq!(params["reasoning"], json!({"effort": "high"}));
    }

    #[test]
    fn local_reasoning_is_not_gated_by_model_names() {
        assert_eq!(
            supported_reasoning_effort(&AgentProvider::Local, "qwen/Qwen3.8-27B", "xhigh"),
            Some("xhigh".to_string())
        );
        assert_eq!(
            supported_reasoning_effort(&AgentProvider::Local, "qwen3-8b", "medium"),
            Some("medium".to_string())
        );
        assert_eq!(
            supported_reasoning_effort(&AgentProvider::Openai, "gpt-5.4", "max"),
            None
        );
        let params = local_parameters(Some("medium")).unwrap();
        assert_eq!(params, json!({"reasoning_effort": "medium"}));
        assert_eq!(
            local_parameters(Some("xhigh")),
            Some(json!({"reasoning_effort": "xhigh"}))
        );
        assert_eq!(local_parameters(None), None);
    }

    #[test]
    fn structured_formatter_streams_only_result_arguments_and_resets_each_attempt() {
        tauri::async_runtime::block_on(async {
            let model = MockCompletionModel::from_stream_turns([vec![
                MockStreamEvent::text("PRIVATE_FORMATTING_COMMENTARY"),
                MockStreamEvent::tool_call_name_delta("answer", "final_result"),
                MockStreamEvent::tool_call_arguments_delta("answer", "{\"value\":\""),
                MockStreamEvent::tool_call_arguments_delta("answer", "shown\"}"),
                MockStreamEvent::tool_call_end("answer"),
                MockStreamEvent::final_response_with_default_usage(),
            ]]);
            let mut request = fake_request("Answer");
            request.output_schema = Some(
                json!({"type":"object","required":["value"],"properties":{"value":{"type":"string"}},"additionalProperties":false}),
            );
            let events = Arc::new(std::sync::Mutex::new(Vec::new()));
            let saved = events.clone();
            let result = run_test_model(
                model,
                request,
                None,
                AgentRuntimeObserver {
                    evidence_context: None,
                    permissions: None,
                    cancelled: CancellationToken::new(),
                    on_event: Arc::new(move |event| {
                        saved
                            .lock()
                            .unwrap()
                            .push(serde_json::to_value(event).unwrap())
                    }),
                },
                crate::agent_guardrails::AgentRunGuard::new(Default::default()),
            )
            .await
            .unwrap();
            assert!(result.output.contains("shown"));
            let events = events.lock().unwrap();
            assert!(
                events
                    .iter()
                    .any(|e| e["type"] == "resultStream" && e["delta"].is_string()),
                "formatter arguments must stream through the runtime seam"
            );
            assert!(
                !events.iter().any(|e| e["type"] == "textDelta"),
                "formatter commentary is not answer text"
            );
        });
    }

    #[test]
    fn structured_results_handle_tool_name_collisions_and_reject_prose_as_the_final_result() {
        tauri::async_runtime::block_on(async {
            let selected = json!({"evidence_ids":["read-id"],"gaps":[]});
            let model = MockCompletionModel::from_stream_turns([
                vec![
                    MockStreamEvent::tool_call(
                        "read",
                        "final_result",
                        json!({"evidence_ids":["private-executable-id"],"gaps":[]}),
                    ),
                    MockStreamEvent::final_response(Usage::new()),
                ],
                vec![
                    MockStreamEvent::text("PRIVATE_PROSE_INSTEAD_OF_SELECTION"),
                    MockStreamEvent::final_response(Usage::new()),
                ],
                vec![
                    MockStreamEvent::tool_call("result", "final_result_1", selected.clone()),
                    MockStreamEvent::final_response(Usage::new()),
                ],
            ]);
            let mut request = fake_request("Gather evidence, then return a selection");
            request.provider = AgentProvider::Openai; // Mock network; production runner and formatter.
            request.output_schema = Some(
                json!({"type":"object","required":["evidence_ids","gaps"],"additionalProperties":false,"properties":{
                    "evidence_ids":{"type":"array","items":{"type":"string"}},"gaps":{"type":"array","items":{"type":"string"}}
                }}),
            );
            let calls = Arc::new(AtomicUsize::new(0));
            let sink: AgentEventSink = Arc::new(|_| {});
            let cancelled = CancellationToken::new();
            let guard = crate::agent_guardrails::AgentRunGuard::new(Default::default());
            let harness = RuntimeHarness {
                observer: AgentRuntimeObserver {
                    evidence_context: None,
                    on_event: sink.clone(),
                    cancelled: cancelled.clone(),
                    permissions: None,
                },
                guard: guard.clone(),
                context: None,
            };
            let result_schema = request.output_schema.clone().unwrap();
            let counter = calls.clone();
            let evidence = selected.clone();
            let action = rig_agent::tool::DynamicTool::new(
                rig_core::message::ToolName::new("final_result").unwrap(),
                "Read evidence",
                request.output_schema.clone().unwrap(),
                move |_| {
                    let counter = counter.clone();
                    let evidence = evidence.clone();
                    Box::pin(async move {
                        counter.fetch_add(1, Ordering::Relaxed);
                        Ok(rig_core::tool::ToolOutput::json(evidence))
                    })
                },
            );
            let agent = harness
                .builder(model.clone(), &request)
                .dynamic_tool(action)
                .build();
            let response = harness.run(agent, request).await.unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&response.output).unwrap(),
                selected
            );
            assert_eq!(calls.load(Ordering::Relaxed), 1);
            assert_eq!(model.request_count(), 3);
            for request in model.requests() {
                assert!(request.tools.iter().any(|t| t.name == "final_result"));
                assert_eq!(request.tools.last().unwrap().name, "final_result_1");
                assert_eq!(
                    usage_context::result_formatter_name(&request, Some(&result_schema)).as_deref(),
                    Some("final_result_1"),
                );
                assert!(
                    request.output_schema.is_none(),
                    "Tool output must not impose native JSON on gathering turns"
                );
            }
        });
    }

    #[test]
    fn streaming_run_compacts_repeatedly_and_keeps_tool_results_and_original_request() {
        tauri::async_runtime::block_on(async {
            use rig_core::test_utils::MockTurn;
            let compact_model = MockCompletionModel::from_turns((0..8).map(|_| MockTurn::text(
                r#"{"summary":"The original request is still active. Verified launch record [S1]: Tuesday. Continue the next evidence page."}"#
            ).with_usage(Usage::default().input_tokens(2_000).output_tokens(20).total_tokens(2_020))));
            let mut turns = (0..9).map(|i| vec![
                MockStreamEvent::tool_call(format!("page-{i}"), "echo", json!({"value":format!("page-{i} {}", "synthetic context ".repeat(120))})),
                MockStreamEvent::final_response(Usage::default().input_tokens(if i % 2 == 0 { 4_000 } else { 12_000 }).output_tokens(30).total_tokens(if i % 2 == 0 { 4_030 } else { 12_030 })),
            ]).collect::<Vec<_>>();
            turns.push(vec![
                MockStreamEvent::text("Tuesday [S1]"),
                MockStreamEvent::final_response(
                    Usage::default()
                        .input_tokens(5_000)
                        .output_tokens(10)
                        .total_tokens(5_010),
                ),
            ]);
            let model = MockCompletionModel::from_stream_turns(turns);
            let request = fake_request("ORIGINAL-USER-REQUIREMENT: Find the launch day, cite [S1], then check every requested page.");
            let guard = crate::agent_guardrails::AgentRunGuard::new(Default::default());
            let events = Arc::new(Mutex::new(Vec::new()));
            let capture = events.clone();
            let sink: AgentEventSink = Arc::new(move |event| capture.lock().unwrap().push(event));
            let mut context = usage_context::UsageContext::with_compaction(
                &request,
                sink.clone(),
                false,
                compact_model.clone().into(),
                guard.clone(),
            );
            Arc::get_mut(&mut context)
                .unwrap()
                .set_test_capacity(19_000);
            let calls = Arc::new(AtomicUsize::new(0));
            let harness = RuntimeHarness {
                observer: AgentRuntimeObserver {
                    evidence_context: None,
                    on_event: sink,
                    cancelled: CancellationToken::new(),
                    permissions: None,
                },
                guard,
                context: Some(context.clone()),
            };
            let agent = harness
                .builder(model.clone(), &request)
                .tool(EchoTool(calls.clone()))
                .build();
            let response = harness.run(agent, request).await.unwrap();
            assert_eq!(response.output, "Tuesday [S1]");
            assert_eq!(
                response.usage.total_tokens,
                73_280 + compact_model.request_count() as u64 * 2_020
            );
            assert_eq!(calls.load(Ordering::Relaxed), 9);
            assert!(
                compact_model.request_count() >= 2,
                "Long work must continue across multiple compactions"
            );
            let requests = model.requests();
            let mut result_pairs = 0;
            for request in &requests {
                let text = serde_json::to_string(&request.chat_history).unwrap();
                assert!(text.contains("ORIGINAL-USER-REQUIREMENT"));
                assert_eq!(
                    request
                        .chat_history
                        .iter()
                        .filter(|m| matches!(m, Message::System { .. }))
                        .count(),
                    1
                );
                // Every retained result must still have its call in this context.
                let value = serde_json::to_value(&request.chat_history).unwrap();
                let mut calls = std::collections::HashSet::new();
                for message in value.as_array().unwrap() {
                    for content in message["content"].as_array().into_iter().flatten() {
                        if content["type"] == "toolcall" {
                            calls.insert(content["id"].clone().to_string());
                        }
                        if content["type"] == "toolresult" {
                            result_pairs += 1;
                            assert!(calls.contains(&content["call"].clone().to_string()));
                        }
                    }
                }
            }
            assert!(
                result_pairs >= 9,
                "Pair validation must observe actual retained tool results"
            );
            assert!(
                requests.last().unwrap().chat_history.len() < requests[3].chat_history.len() + 4
            );
            assert!(events.lock().unwrap().iter().any(|e| matches!(e, AgentEvent::ContextMeasured { details } if details["mode"] == "compaction" && details["phase"] == "completed")));
            assert_eq!(
                response.stats.model_calls,
                model.request_count() + compact_model.request_count()
            );
        });
    }

    #[test]
    fn productive_tool_runs_continue_past_old_cumulative_quotas() {
        tauri::async_runtime::block_on(async {
            let mut turns = (0..110)
                .map(|i| {
                    vec![
                        MockStreamEvent::tool_call(
                            format!("read-{i}"),
                            "echo",
                            json!({"value":format!("page-{i}")}),
                        ),
                        MockStreamEvent::final_response(
                            Usage::default()
                                .input_tokens(5_000)
                                .output_tokens(20)
                                .total_tokens(5_020),
                        ),
                    ]
                })
                .collect::<Vec<_>>();
            turns.push(vec![
                MockStreamEvent::text("Research complete"),
                MockStreamEvent::final_response(Usage::new()),
            ]);
            let model = MockCompletionModel::from_stream_turns(turns);
            let request = fake_request("Continue through every distinct evidence page");
            let calls = Arc::new(AtomicUsize::new(0));
            let harness = RuntimeHarness {
                observer: AgentRuntimeObserver {
                    evidence_context: None,
                    on_event: Arc::new(|_| {}),
                    cancelled: CancellationToken::new(),
                    permissions: None,
                },
                guard: crate::agent_guardrails::AgentRunGuard::new(Default::default()),
                context: None,
            };
            let agent = harness
                .builder(model.clone(), &request)
                .tool(EchoTool(calls.clone()))
                .build();
            let response = harness.run(agent, request).await.unwrap();
            assert_eq!(response.output, "Research complete");
            assert_eq!(calls.load(Ordering::Relaxed), 110);
            assert_eq!(model.request_count(), 111);
            assert!(response.usage.total_tokens > 400_000);
        });
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
            let harness = RuntimeHarness {
                observer: AgentRuntimeObserver {
                    evidence_context: None,
                    on_event: Arc::clone(&event_sink),
                    cancelled: cancelled.clone(),
                    permissions: Some(permission_boundary.clone()),
                },
                guard: guard.clone(),
                context: None,
            };
            let agent = harness
                .builder(model.clone(), &request)
                .tool(EchoTool(Arc::clone(&tool_calls)))
                .build();
            let response = harness.run(agent, request).await.unwrap();

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
            let harness = RuntimeHarness {
                observer: AgentRuntimeObserver {
                    evidence_context: None,
                    on_event: Arc::clone(&event_sink),
                    cancelled: cancelled.clone(),
                    permissions: Some(permission_boundary.clone()),
                },
                guard: guard.clone(),
                context: None,
            };
            let agent = harness
                .builder(model.clone(), &request)
                .tool(EchoTool(Arc::clone(&tool_calls)))
                .build();
            let response = harness.run(agent, request).await.unwrap();

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
