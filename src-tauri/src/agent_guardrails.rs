use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Debug)]
pub(crate) struct AgentRunLimits {
    pub(crate) max_elapsed: Duration,
    pub(crate) max_tool_calls: usize,
    pub(crate) max_aggregate_tokens: u64,
    pub(crate) max_repeated_tool_calls: usize,
}

impl Default for AgentRunLimits {
    fn default() -> Self {
        Self {
            max_elapsed: Duration::from_secs(15 * 60),
            max_tool_calls: 96,
            max_aggregate_tokens: 400_000,
            max_repeated_tool_calls: 3,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AgentGuardViolation {
    pub(crate) reason: &'static str,
    pub(crate) message: String,
}

#[derive(Default)]
struct AgentRunGuardState {
    model_calls: usize,
    tool_calls: usize,
    tool_signatures: HashMap<String, usize>,
    tool_started: HashMap<String, Instant>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct AgentRunStats {
    pub(crate) model_calls: usize,
    pub(crate) tool_calls: usize,
    pub(crate) elapsed_millis: u64,
}

#[derive(Clone)]
pub(crate) struct AgentRunGuard {
    started: Instant,
    limits: AgentRunLimits,
    state: Arc<Mutex<AgentRunGuardState>>,
}

impl AgentRunGuard {
    pub(crate) fn new(limits: AgentRunLimits) -> Self {
        Self {
            started: Instant::now(),
            limits,
            state: Arc::new(Mutex::new(AgentRunGuardState::default())),
        }
    }

    pub(crate) fn deadline_remaining(&self) -> Result<Duration, AgentGuardViolation> {
        self.limits
            .max_elapsed
            .checked_sub(self.started.elapsed())
            .ok_or_else(|| AgentGuardViolation {
                reason: "timeBudgetExceeded",
                message: "The agent stopped after reaching its time limit.".to_string(),
            })
    }

    pub(crate) fn begin_tool(
        &self,
        call_id: &str,
        name: &str,
        args: &str,
    ) -> Result<(), AgentGuardViolation> {
        self.deadline_remaining()?;
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.tool_calls += 1;
        if state.tool_calls > self.limits.max_tool_calls {
            return Err(AgentGuardViolation {
                reason: "toolCallBudgetExceeded",
                message: "The agent stopped after reaching its tool-call limit.".to_string(),
            });
        }
        let signature = format!("{name}:{}", canonical_json(args));
        let repeated = state.tool_signatures.entry(signature).or_default();
        *repeated += 1;
        if *repeated > self.limits.max_repeated_tool_calls {
            return Err(AgentGuardViolation {
                reason: "repeatedToolCall",
                message: format!(
                    "The agent stopped because it repeated {name} with the same input."
                ),
            });
        }
        state
            .tool_started
            .insert(call_id.to_string(), Instant::now());
        Ok(())
    }

    pub(crate) fn begin_model_call(&self, turn: usize) -> Result<(), AgentGuardViolation> {
        self.deadline_remaining()?;
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.model_calls = state.model_calls.max(turn);
        Ok(())
    }

    pub(crate) fn finish_tool(&self, call_id: &str) -> Option<u64> {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .tool_started
            .remove(call_id)
            .map(|started| started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64)
    }

    pub(crate) fn check_tokens(&self, total: u64) -> Result<(), AgentGuardViolation> {
        if total > self.limits.max_aggregate_tokens {
            return Err(AgentGuardViolation {
                reason: "tokenBudgetExceeded",
                message: "The agent stopped after reaching its token budget.".to_string(),
            });
        }
        Ok(())
    }

    pub(crate) fn stats(&self) -> AgentRunStats {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        AgentRunStats {
            model_calls: state.model_calls,
            tool_calls: state.tool_calls,
            elapsed_millis: self.started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        }
    }
}

fn canonical_json(raw: &str) -> String {
    fn normalize(value: Value) -> Value {
        match value {
            Value::Object(values) => Value::Object(
                values
                    .into_iter()
                    .map(|(key, value)| (key, normalize(value)))
                    .collect::<BTreeMap<_, _>>()
                    .into_iter()
                    .collect(),
            ),
            Value::Array(values) => Value::Array(values.into_iter().map(normalize).collect()),
            other => other,
        }
    }
    serde_json::from_str(raw)
        .map(normalize)
        .and_then(|value| serde_json::to_string(&value))
        .unwrap_or_else(|_| raw.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_tool_guard_normalizes_json_key_order() {
        let guard = AgentRunGuard::new(AgentRunLimits {
            max_repeated_tool_calls: 1,
            ..AgentRunLimits::default()
        });
        guard
            .begin_tool("one", "read_note", r#"{"b":2,"a":1}"#)
            .unwrap();
        let violation = guard
            .begin_tool("two", "read_note", r#"{"a":1,"b":2}"#)
            .unwrap_err();
        assert_eq!(violation.reason, "repeatedToolCall");
    }

    #[test]
    fn changed_pagination_arguments_do_not_trip_repeat_guard() {
        let guard = AgentRunGuard::new(AgentRunLimits {
            max_repeated_tool_calls: 1,
            ..AgentRunLimits::default()
        });
        guard
            .begin_tool("one", "read_note", r#"{"start_line":1}"#)
            .unwrap();
        guard
            .begin_tool("two", "read_note", r#"{"start_line":100}"#)
            .unwrap();
    }

    #[test]
    fn aggregate_token_budget_has_a_product_owned_terminal_reason() {
        let guard = AgentRunGuard::new(AgentRunLimits {
            max_aggregate_tokens: 10,
            ..AgentRunLimits::default()
        });
        assert_eq!(
            guard.check_tokens(11).unwrap_err().reason,
            "tokenBudgetExceeded"
        );
    }
}
