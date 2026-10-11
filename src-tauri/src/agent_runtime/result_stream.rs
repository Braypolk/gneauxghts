//! Transient fragments from the non-executable result formatter only.
//! Consumers own decoding and final validation; executable arguments never leave here.
use super::*;
use std::sync::Mutex;

pub(super) struct ResultStream {
    schema: Value,
    state: Mutex<State>,
}
#[derive(Default)]
struct State {
    attempt: usize,
    formatter: Option<String>,
    part: Option<usize>,
    rejected: bool,
}
impl ResultStream {
    pub(super) fn new(schema: Value) -> Arc<Self> {
        Arc::new(Self {
            schema,
            state: Mutex::new(State::default()),
        })
    }
    pub(super) fn begin(
        &self,
        request: &rig_core::completion::CompletionRequest,
        sink: &AgentEventSink,
    ) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let attempt = state.attempt + 1;
        *state = State {
            attempt,
            formatter: usage_context::result_formatter_name(request, Some(&self.schema)),
            ..Default::default()
        };
        drop(state);
        sink(AgentEvent::ResultStream {
            attempt,
            delta: None,
        });
    }
    pub(super) fn observe(&self, event: &StreamEvent, sink: &AgentEventSink) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.rejected {
            return;
        }
        let outgoing = match event {
            StreamEvent::Start {
                part,
                name: Some(name),
                ..
            } if state.formatter.as_deref() == Some(name.as_str()) => {
                if state.part.is_some() {
                    state.rejected = true;
                    Some(AgentEvent::ResultStream {
                        attempt: state.attempt,
                        delta: None,
                    })
                } else {
                    state.part = Some(part.index());
                    None
                }
            }
            StreamEvent::Arguments { part, json } if state.part == Some(part.index()) => {
                Some(AgentEvent::ResultStream {
                    attempt: state.attempt,
                    delta: Some(json.clone()),
                })
            }
            StreamEvent::End {
                part,
                content: rig_core::message::AssistantContent::ToolCall(call),
            } if state.part == Some(part.index())
                && state.formatter.as_deref() != Some(call.function.name.as_str()) =>
            {
                state.rejected = true;
                Some(AgentEvent::ResultStream {
                    attempt: state.attempt,
                    delta: None,
                })
            }
            _ => None,
        };
        drop(state);
        if let Some(event) = outgoing {
            sink(event);
        }
    }
}
