//! Run-local context admission and compaction. Aggregate spending has a different owner.
use super::*;
use rig_core::{completion::CompletionRequest, error::ProviderError as CompletionError};
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    sync::Mutex,
};

const OUTPUT_RESERVE: u64 = 4_096;
const SAFETY_MARGIN: u64 = 1_024;

struct Snapshot {
    configuration: u64,
    messages: Vec<u64>,
    source_choices_bytes: u64,
}

impl Snapshot {
    fn projected_input(&self, sizes: &[u64], baseline: Option<&(Self, u64)>) -> Option<u64> {
        let (previous, input) = baseline?;
        if previous.configuration != self.configuration
            || !self.messages.starts_with(&previous.messages)
        {
            return None;
        }
        // Approximate only newly retained content: one token per UTF-8 byte
        // plus framing, deliberately overcounting ordinary text.
        Some(
            sizes[previous.messages.len()..].iter().fold(
                input.saturating_add(
                    self.source_choices_bytes
                        .saturating_sub(previous.source_choices_bytes),
                ),
                |sum, bytes| sum.saturating_add(*bytes).saturating_add(64),
            ),
        )
    }
}

#[derive(Default)]
struct State {
    capacity: Option<u64>,
    pending: Option<Snapshot>,
    baseline: Option<(Snapshot, u64)>,
}

pub(super) struct UsageContext {
    state: Mutex<State>,
    on_event: AgentEventSink,
    model: String,
    capacity_probe: Option<super::context_measurement::CapacityProbe>,
    rolling: super::compaction::RollingContext,
    guard: crate::agent_guardrails::AgentRunGuard,
    #[cfg(test)]
    capacity_override: Option<u64>,
}

impl UsageContext {
    #[cfg(test)]
    pub(super) fn set_test_capacity(&mut self, capacity: u64) {
        self.capacity_override = Some(capacity);
    }
    pub(super) fn with_compaction(
        request: &AgentRuntimeRequest,
        on_event: AgentEventSink,
        worker: bool,
        model: DynModel<Completion>,
        guard: crate::agent_guardrails::AgentRunGuard,
    ) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State::default()),
            on_event,
            model: request.model.clone(),
            capacity_probe: (request.provider == AgentProvider::Local).then(|| {
                super::context_measurement::CapacityProbe::new(
                    request.local_base_url.clone(),
                    request.api_key.clone(),
                )
            }),
            rolling: super::compaction::RollingContext::new(model, request, worker),
            guard,
            #[cfg(test)]
            capacity_override: None,
        })
    }

    pub(super) fn compaction_usage(&self) -> AgentUsage {
        self.rolling.usage()
    }

    pub(super) async fn prepare(
        &self,
        request: &mut CompletionRequest,
    ) -> Result<bool, CompletionError> {
        let capacity = if let Some(probe) = &self.capacity_probe {
            probe
                .observe(request.model.as_deref().unwrap_or(&self.model))
                .await
        } else {
            None
        };
        #[cfg(test)]
        let capacity = self.capacity_override.or(capacity);
        let original = self.rolling.project(request);
        let projected = capacity
            .and_then(|_| self.projected_input(request))
            .unwrap_or_else(|| serde_json::to_vec(request).map_or(u64::MAX, |b| b.len() as u64));
        let trigger = capacity.map_or(96_000, |n| {
            (n.saturating_mul(3) / 4).min(n.saturating_sub(OUTPUT_RESERVE + SAFETY_MARGIN + 4096))
        });
        let compacted = projected >= trigger;
        if compacted {
            self.rolling
                .compact(request, &original, capacity, &self.guard, &self.on_event)
                .await?;
            self.state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .baseline = None;
        }
        let bytes = serde_json::to_vec(&request.chat_history).map_or(usize::MAX, |b| b.len());
        self.guard.check_context_bytes(bytes).map_err(|v| {
            emit_guard_violation(&self.on_event, &v);
            CompletionError::request(v.message)
        })?;
        self.prepare_with_capacity(request, capacity)
            .map(|_| compacted)
    }

    pub(super) fn capacity(&self) -> Option<u64> {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .capacity
    }

    fn projected_input(&self, request: &CompletionRequest) -> Option<u64> {
        let (current, sizes) = snapshot(request)?;
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        current.projected_input(&sizes, state.baseline.as_ref())
    }

    fn prepare_with_capacity(
        &self,
        request: &CompletionRequest,
        capacity: Option<u64>,
    ) -> Result<(), CompletionError> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.capacity = capacity;
        let snapshot = snapshot(request);
        let projected = snapshot
            .as_ref()
            .and_then(|(current, sizes)| current.projected_input(sizes, state.baseline.as_ref()));
        if projected.is_none() {
            state.baseline = None;
        }
        state.pending = snapshot.map(|(snapshot, _)| snapshot);
        let Some((projected, capacity)) = projected.zip(capacity) else {
            return Ok(());
        };
        if projected.saturating_add(OUTPUT_RESERVE + SAFETY_MARGIN) >= capacity {
            return Err(context_error("The remaining context cannot safely fit a final answer. Narrow the question or start a new conversation."));
        }
        Ok(())
    }

    pub(super) fn observe(&self, usage: Usage) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.baseline = state
            .pending
            .take()
            .zip(usage.input_tokens.filter(|n| *n > 0))
            .map(|(s, input)| (s, input));
    }
}

/// Private compatibility seam for the pinned engine's Tool output mode: its
/// formatter is appended after executable definitions, with the exact schema.
/// Matching the last definition also handles collision-renamed output tools.
pub(super) fn result_formatter_name(
    request: &CompletionRequest,
    schema: Option<&Value>,
) -> Option<String> {
    schema.and_then(|schema| {
        request
            .tools
            .last()
            .filter(|tool| {
                request.output_schema.is_none()
                    && (&tool.parameters == schema
                        || crate::chat::structured_answer::unconstrained_schema(&tool.parameters)
                            .as_ref()
                            == Some(schema))
            })
            .map(|tool| tool.name.to_string())
    })
}

fn context_error(message: &'static str) -> CompletionError {
    CompletionError::request(message)
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
    let source_choices_bytes = crate::chat::structured_answer::normalize_source_choices(&mut value);
    Some((
        Snapshot {
            configuration: fingerprint(&value),
            messages: messages.iter().map(fingerprint).collect(),
            source_choices_bytes,
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

    fn request() -> CompletionRequest {
        CompletionRequest::new("Evidence question").preamble("Keep citations")
    }
    fn context(worker: bool) -> Arc<UsageContext> {
        let request = AgentRuntimeRequest {
            provider: AgentProvider::Openai,
            model: "mock".into(),
            api_key: None,
            local_base_url: String::new(),
            output_schema: None,
            preamble: String::new(),
            prompt: Message::user("test"),
            history: vec![],
            enable_web: false,
            require_web: false,
            flex: false,
            reasoning_effort: None,
        };
        UsageContext::with_compaction(
            &request,
            Arc::new(|_| {}),
            worker,
            rig_core::test_utils::MockCompletionModel::text("unused summary").into(),
            crate::agent_guardrails::AgentRunGuard::new(Default::default()),
        )
    }
    fn usage(input_tokens: u64) -> Usage {
        Usage::default()
            .input_tokens(input_tokens)
            .output_tokens(100)
            .total_tokens(input_tokens + 100)
    }
    fn baseline(context: &UsageContext, request: &mut CompletionRequest, input: u64) {
        context.prepare_with_capacity(request, Some(19000)).unwrap();
        context.observe(usage(input));
    }

    #[test]
    fn growing_source_choices_keep_usage_baseline_and_count_their_added_bytes() {
        let context = context(false);
        let mut request = request();
        request.tools.push(rig_core::completion::ToolDefinition {
            name: rig_core::message::ToolName::new("final_result").unwrap(),
            description: "Final answer".into(),
            parameters: crate::chat::structured_answer::schema(),
        });
        crate::chat::structured_answer::constrain_sources(
            &mut request.tools.last_mut().unwrap().parameters,
            vec!["S1".into()],
        );
        baseline(&context, &mut request, 1000);
        let before = snapshot(&request).unwrap().0.source_choices_bytes;
        crate::chat::structured_answer::constrain_sources(
            &mut request.tools.last_mut().unwrap().parameters,
            vec!["S1".into(), "S3".into()],
        );
        let after = snapshot(&request).unwrap().0.source_choices_bytes;
        assert!(after > before);
        assert_eq!(
            context.projected_input(&request),
            Some(1000 + after - before)
        );
    }

    #[test]
    fn parent_and_worker_contexts_do_not_share_usage() {
        let parent = context(false);
        let worker = context(true);
        baseline(&parent, &mut request(), 10000);
        baseline(&worker, &mut request(), 1000);
        assert_eq!(parent.projected_input(&request()), Some(10000));
        assert_eq!(worker.projected_input(&request()), Some(1000));
        let mut next = request();
        next.chat_history.push(Message::user("Continue"));
        worker.prepare_with_capacity(&next, Some(19000)).unwrap();
        assert!(worker.projected_input(&next).unwrap() > 1000);
        assert_eq!(parent.projected_input(&request()), Some(10000));
    }

    #[test]
    fn configuration_or_history_replacement_resets_reported_baseline() {
        for change in 0..6 {
            let context = context(false);
            let mut next = request();
            baseline(&context, &mut next, 10000);
            assert_eq!(context.projected_input(&next), Some(10000));
            match change {
                0 => next.model = Some("other-model".into()),
                1 => next.chat_history[0] = Message::system("Different instructions"),
                2 => next.tools.push(rig_core::completion::ToolDefinition {
                    name: rig_core::message::ToolName::new("other").unwrap(),
                    description: "different schema".into(),
                    parameters: json!({}),
                }),
                3 => next.chat_history = vec![Message::user("Replacement history")],
                4 => next.additional_params = Some(json!({"reasoning_effort":"high"})),
                _ => next.chat_history = vec![Message::system("Replaced system instructions")],
            }
            context
                .prepare_with_capacity(&mut next, Some(19000))
                .unwrap();
            assert!(
                context.state.lock().unwrap().baseline.is_none(),
                "change {change} must invalidate the baseline"
            );
        }
    }

    #[test]
    fn missing_usage_or_capacity_falls_back_without_guessing() {
        let context = context(false);
        let mut next = request();
        baseline(&context, &mut next, 10000);
        context.prepare_with_capacity(&mut next, None).unwrap();
        assert_eq!(context.capacity(), None);
        context.observe(Usage::new());
        context
            .prepare_with_capacity(&mut next, Some(19000))
            .unwrap();
        assert_eq!(context.projected_input(&next), None);
    }

    #[test]
    fn partial_usage_without_input_does_not_supply_a_context_baseline() {
        let context = context(false);
        let mut next = request();
        context
            .prepare_with_capacity(&mut next, Some(19000))
            .unwrap();
        context.observe(Usage::default().output_tokens(10000).total_tokens(20000));
        context
            .prepare_with_capacity(&mut next, Some(19000))
            .unwrap();
        assert_eq!(context.projected_input(&next), None);
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
}
