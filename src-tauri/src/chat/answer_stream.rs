//! Answer delivery owns the distinction between provisional JSON and durable text.
use super::*;
use crate::agent_runtime::AgentEvent;

pub(super) enum AnswerUpdate {
    Draft { attempt: usize, text: String },
    Text { delta: String },
}
pub(super) struct AnswerStream {
    structured: bool,
    cancelled: CancellationToken,
    state: Mutex<StreamState>,
}
struct StreamState {
    draft: structured_answer::Draft,
    content: String,
    checkpoint: Option<store::StreamingCheckpoint>,
}
impl AnswerStream {
    pub(super) fn new(
        service: &ChatService,
        message_id: &str,
        structured: bool,
        cancelled: CancellationToken,
    ) -> Result<Arc<Self>, String> {
        Ok(Arc::new(Self {
            structured,
            cancelled,
            state: Mutex::new(StreamState {
                draft: Default::default(),
                content: String::new(),
                checkpoint: if structured {
                    None
                } else {
                    Some(service.streaming_checkpoint(message_id)?)
                },
            }),
        }))
    }
    pub(super) fn observe(&self, event: &AgentEvent) -> Option<AnswerUpdate> {
        if self.cancelled.is_cancelled() {
            return None;
        }
        let mut state = self.state.lock().ok()?;
        match event {
            AgentEvent::ResultStream { attempt, delta } if self.structured => state
                .draft
                .update(*attempt, delta.as_deref())
                .map(|text| AnswerUpdate::Draft {
                    attempt: *attempt,
                    text,
                }),
            AgentEvent::TextDelta { delta } if !self.structured => {
                state.content.push_str(delta);
                if let Some(checkpoint) = &state.checkpoint {
                    let _ = checkpoint.write(&state.content);
                }
                Some(AnswerUpdate::Text {
                    delta: delta.clone(),
                })
            }
            _ => None,
        }
    }
    pub(super) fn partial(&self) -> String {
        self.state
            .lock()
            .map(|s| s.content.clone())
            .unwrap_or_default()
    }
}
