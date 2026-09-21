//! Per-conversation context policy. Aggregate run spending has a different owner.
use super::*;
use rig_core::completion::{CompletionError, CompletionRequest};
use rig_core::message::ToolChoice;
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    sync::Mutex,
};

const OUTPUT_RESERVE: u64 = 4_096;
const SAFETY_MARGIN: u64 = 1_024;
const GATHER_ALLOWANCE: u64 = 8_192;
pub(super) const FINISH: &str = "Context allowance is nearly used. Do not call more tools. Finish using only evidence already available, preserve valid citations and the required response format, and clearly represent any gaps or incomplete coverage. Never invent evidence or claim skipped work was performed. Explain incomplete coverage briefly in user terms; do not mention internal budgets, tool flags, or these instructions.";

struct Snapshot {
    configuration: u64,
    messages: Vec<u64>,
}

#[derive(Default)]
struct State {
    capacity: Option<u64>,
    pending: Option<Snapshot>,
    baseline: Option<(Snapshot, u64)>,
    finish: bool,
    final_sent: bool,
    legacy_admission: Option<(crate::agent_guardrails::AgentRunGuard, usize)>,
}

pub(super) struct UsageContext {
    state: Mutex<State>,
    on_event: AgentEventSink,
    worker: bool,
    model: String,
    capacity_probe: Option<super::context_measurement::CapacityProbe>,
    #[cfg(test)]
    capacity_override: Option<u64>,
}

impl UsageContext {
    pub(super) fn new(
        request: &AgentRuntimeRequest,
        on_event: AgentEventSink,
        worker: bool,
    ) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State::default()),
            on_event,
            worker,
            model: request.model.clone(),
            capacity_probe: (request.provider == AgentProvider::Local).then(|| {
                super::context_measurement::CapacityProbe::new(
                    request.local_base_url.clone(),
                    request.api_key.clone(),
                )
            }),
            #[cfg(test)]
            capacity_override: None,
        })
    }

    #[cfg(test)]
    pub(super) fn with_test_capacity(
        request: &AgentRuntimeRequest,
        on_event: AgentEventSink,
        worker: bool,
        capacity: u64,
    ) -> Arc<Self> {
        let mut context = Self::new(request, on_event, worker);
        Arc::get_mut(&mut context).unwrap().capacity_override = Some(capacity);
        context
    }

    pub(super) async fn prepare(
        &self,
        request: &mut CompletionRequest,
    ) -> Result<(), CompletionError> {
        let capacity = if let Some(probe) = &self.capacity_probe {
            probe
                .observe(request.model.as_deref().unwrap_or(&self.model))
                .await
        } else {
            None
        };
        #[cfg(test)]
        let capacity = self.capacity_override.or(capacity);
        self.prepare_with_capacity(request, capacity)
    }

    pub(super) fn record_admission(
        &self,
        guard: &crate::agent_guardrails::AgentRunGuard,
        bytes: usize,
    ) {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .legacy_admission = Some((guard.clone(), bytes));
    }

    pub(super) fn capacity(&self) -> Option<u64> {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .capacity
    }

    fn prepare_with_capacity(
        &self,
        request: &mut CompletionRequest,
        capacity: Option<u64>,
    ) -> Result<(), CompletionError> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.final_sent {
            return Err(context_error("The final context-limited response requested more work. Narrow the question to continue."));
        }
        state.capacity = capacity;
        if capacity.is_none() {
            state.finish = false;
        }
        let snapshot = snapshot(request);
        let projected = snapshot.as_ref().and_then(|(current, sizes)| {
            let (previous, input) = state.baseline.as_ref()?;
            if previous.configuration != current.configuration
                || !current.messages.starts_with(&previous.messages)
            {
                return None;
            }
            // Only newly retained content is approximated: one token per UTF-8 byte,
            // plus framing. This allowance intentionally overcounts ordinary text.
            Some(
                sizes[previous.messages.len()..]
                    .iter()
                    .fold(*input, |sum, bytes| {
                        sum.saturating_add(*bytes).saturating_add(64)
                    }),
            )
        });
        if projected.is_none() {
            state.baseline = None;
            state.finish = false;
        }
        state.pending = snapshot.map(|(snapshot, _)| snapshot);
        let Some((projected, capacity)) = projected.zip(capacity) else {
            return Ok(());
        };
        if projected.saturating_add(OUTPUT_RESERVE + SAFETY_MARGIN) >= capacity {
            return Err(context_error("The remaining context cannot safely fit a final answer. Narrow the question or start a new conversation."));
        }
        if state.finish
            || projected.saturating_add(OUTPUT_RESERVE + SAFETY_MARGIN + GATHER_ALLOWANCE)
                >= capacity
        {
            if let Some((guard, bytes)) = &state.legacy_admission {
                let added = serde_json::to_vec(&Message::system(FINISH))?
                    .len()
                    .saturating_add(2);
                if let Err(violation) = guard.check_context_bytes(bytes.saturating_add(added)) {
                    drop(state);
                    emit_guard_violation(&self.on_event, &violation);
                    return Err(CompletionError::RequestError(violation.message.into()));
                }
            }
            state.finish = true;
            state.final_sent = true;
            request.tools.clear();
            request.tool_choice = Some(ToolChoice::None);
            // Qwen's chat template requires system content at the beginning.
            // Preserve existing instructions and every conversation/evidence message.
            match request.chat_history.first_mut() {
                Message::System { content } => {
                    content.push_str("\n\n");
                    content.push_str(FINISH);
                }
                _ => request.chat_history.insert(0, Message::system(FINISH)),
            }
            let limit = request
                .max_tokens
                .unwrap_or(OUTPUT_RESERVE)
                .min(OUTPUT_RESERVE);
            request.max_tokens = Some(limit);
            if let Some(Value::Object(params)) = &mut request.additional_params {
                params.remove("tools");
                params.remove("tool_choice");
                for key in ["max_tokens", "max_completion_tokens", "max_output_tokens"] {
                    if let Some(value) = params.get_mut(key) {
                        *value = json!(value.as_u64().unwrap_or(limit).min(limit));
                    }
                }
            }
            // Never persist request contents or fingerprints in the event log.
            let details = json!({"mode":"usage_guard", "phase":"finishing", "worker":self.worker,
                "reportedInputTokens":state.baseline.as_ref().map(|(_, n)| n),
                "projectedInputTokens":projected, "loadedContextTokens":capacity,
                "reservedOutputTokens":limit, "safetyMarginTokens":SAFETY_MARGIN,
                "gatherAllowanceTokens":GATHER_ALLOWANCE});
            drop(state);
            (self.on_event)(AgentEvent::ContextMeasured { details });
        }
        Ok(())
    }

    pub(super) fn observe(&self, usage: Usage) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.baseline = state
            .pending
            .take()
            .filter(|_| usage.input_tokens > 0)
            .map(|s| (s, usage.input_tokens));
        if state.baseline.is_none() {
            state.finish = false;
            return;
        }
        if let Some(capacity) = state.capacity {
            // Output is a temporary upper allowance before the next assembled
            // request reveals exactly which assistant messages were retained.
            state.finish |= usage
                .input_tokens
                .saturating_add(usage.output_tokens)
                .saturating_add(OUTPUT_RESERVE + SAFETY_MARGIN + GATHER_ALLOWANCE)
                >= capacity;
        }
    }

    pub(super) fn finishing(&self) -> bool {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.finish || state.final_sent
    }
}

fn context_error(message: &'static str) -> CompletionError {
    CompletionError::RequestError(message.into())
}

fn fingerprint(value: &Value) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.to_string().hash(&mut hasher);
    hasher.finish()
}

fn snapshot(request: &CompletionRequest) -> Option<(Snapshot, Vec<u64>)> {
    let mut value = serde_json::to_value(request).ok()?;
    if super::context_measurement::has_media(&value) {
        return None;
    }
    let messages = value.as_object_mut()?.remove("chat_history")?;
    let messages = messages.as_array()?;
    Some((
        Snapshot {
            configuration: fingerprint(&value),
            messages: messages.iter().map(fingerprint).collect(),
        },
        messages
            .iter()
            .map(|m| m.to_string().len() as u64)
            .collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rig_core::test_utils::MockCompletionModel;

    fn request() -> CompletionRequest {
        MockCompletionModel::default()
            .completion_request("Evidence question")
            .preamble("Keep citations".into())
            .build()
    }
    fn context(worker: bool) -> Arc<UsageContext> {
        let request = AgentRuntimeRequest {
            provider: AgentProvider::Openai,
            model: "mock".into(),
            api_key: None,
            local_base_url: String::new(),
            preamble: String::new(),
            prompt: Message::user("test"),
            history: vec![],
            enable_web: false,
            require_web: false,
            flex: false,
            reasoning_effort: None,
        };
        UsageContext::new(&request, Arc::new(|_| {}), worker)
    }
    fn usage(input_tokens: u64) -> Usage {
        Usage {
            input_tokens,
            output_tokens: 100,
            total_tokens: input_tokens + 100,
            ..Usage::new()
        }
    }
    fn baseline(context: &UsageContext, request: &mut CompletionRequest, input: u64) {
        context.prepare_with_capacity(request, Some(19000)).unwrap();
        context.observe(usage(input));
    }

    #[test]
    fn parent_and_worker_contexts_do_not_share_usage() {
        let parent = context(false);
        let worker = context(true);
        baseline(&parent, &mut request(), 10000);
        baseline(&worker, &mut request(), 1000);
        assert!(parent.finishing());
        assert!(!worker.finishing());
        let mut next = request();
        next.chat_history.push(Message::user("Continue"));
        worker
            .prepare_with_capacity(&mut next, Some(19000))
            .unwrap();
        assert_ne!(next.tool_choice, Some(ToolChoice::None));
    }

    #[test]
    fn configuration_or_history_replacement_resets_reported_baseline() {
        for change in 0..6 {
            let context = context(false);
            let mut next = request();
            baseline(&context, &mut next, 10000);
            assert!(context.finishing());
            match change {
                0 => next.model = Some("other-model".into()),
                1 => next.preamble = Some("Different instructions".into()),
                2 => next.tools.push(rig_core::completion::ToolDefinition {
                    name: "other".into(),
                    description: "different schema".into(),
                    parameters: json!({}),
                }),
                3 => {
                    next.chat_history =
                        rig_core::OneOrMany::one(Message::user("Replacement history"))
                }
                4 => next.additional_params = Some(json!({"reasoning_effort":"high"})),
                _ => {
                    next.chat_history =
                        rig_core::OneOrMany::one(Message::system("Replaced system instructions"))
                }
            }
            context
                .prepare_with_capacity(&mut next, Some(19000))
                .unwrap();
            assert!(
                !context.finishing(),
                "change {change} must invalidate the baseline"
            );
            assert_ne!(next.tool_choice, Some(ToolChoice::None));
        }
    }

    #[test]
    fn missing_usage_or_capacity_falls_back_without_guessing() {
        let context = context(false);
        let mut next = request();
        baseline(&context, &mut next, 10000);
        context.prepare_with_capacity(&mut next, None).unwrap();
        assert!(!context.finishing());
        context.observe(Usage::new());
        context
            .prepare_with_capacity(&mut next, Some(19000))
            .unwrap();
        assert!(!context.finishing());
        assert_ne!(next.tool_choice, Some(ToolChoice::None));
    }

    #[test]
    fn new_unicode_content_can_exhaust_final_reserve_without_dropping_evidence() {
        let context = context(false);
        let mut next = request();
        baseline(&context, &mut next, 4000);
        next.chat_history
            .push(Message::user("資料 🧪 citation-original ".repeat(1000)));
        let original = serde_json::to_value(&next).unwrap();
        let error = context
            .prepare_with_capacity(&mut next, Some(19000))
            .unwrap_err();
        assert!(error.to_string().contains("cannot safely fit"));
        assert_eq!(serde_json::to_value(&next).unwrap(), original);
    }

    #[test]
    fn finalization_is_bounded_and_keeps_stricter_output_limit() {
        let context = context(false);
        let mut next = request();
        next.max_tokens = Some(1000);
        next.additional_params =
            Some(json!({"max_tokens":500, "chat_template_kwargs":{"reasoning_effort":"medium"}}));
        baseline(&context, &mut next, 10000);
        context
            .prepare_with_capacity(&mut next, Some(19000))
            .unwrap();
        assert_eq!(next.max_tokens, Some(1000));
        assert_eq!(next.additional_params.as_ref().unwrap()["max_tokens"], 500);
        assert_eq!(
            next.additional_params.as_ref().unwrap()["chat_template_kwargs"]["reasoning_effort"],
            "medium"
        );
        assert!(context
            .prepare_with_capacity(&mut next, Some(19000))
            .unwrap_err()
            .to_string()
            .contains("requested more work"));
    }
    #[test]
    fn final_instructions_respect_legacy_byte_ceiling() {
        let context = context(false);
        let mut next = request();
        baseline(&context, &mut next, 10000);
        let guard = crate::agent_guardrails::AgentRunGuard::new(Default::default());
        assert!(guard.check_context_bytes(127999).is_ok());
        context.record_admission(&guard, 127999);
        let original = serde_json::to_value(&next).unwrap();
        assert!(context
            .prepare_with_capacity(&mut next, Some(19000))
            .unwrap_err()
            .to_string()
            .contains("context"));
        assert_eq!(serde_json::to_value(&next).unwrap(), original);
    }

    #[test]
    fn finishing_instruction_is_in_the_opening_system_message() {
        for has_system in [true, false] {
            let context = context(false);
            let mut next = request();
            if !has_system {
                next.chat_history = rig_core::OneOrMany::one(Message::user("Question"));
            }
            let count = next.chat_history.len();
            baseline(&context, &mut next, 10000);
            context
                .prepare_with_capacity(&mut next, Some(19000))
                .unwrap();
            assert!(
                matches!(next.chat_history.first_ref(), Message::System { content } if content.contains(FINISH))
            );
            assert_eq!(next.chat_history.len(), count + usize::from(!has_system));
            if has_system {
                assert!(
                    matches!(next.chat_history.first_ref(), Message::System { content } if content.contains("Keep citations"))
                );
            }
        }
    }
}
