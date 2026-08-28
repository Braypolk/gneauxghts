use crate::{
    agent_runtime::{
        AgentRuntime, AgentRuntimeObserver, AgentRuntimeRequest, AgentRuntimeResponse,
    },
    agent_tools::AgentToolContext,
};

/// Application-owned execution boundary for an agent run.
///
/// Chat owns durable lifecycle and context assembly; this coordinator owns the
/// handoff to the replaceable Rig runtime. Keeping that dependency behind one
/// boundary prevents provider/runtime types from spreading into chat state.
pub(crate) struct AgentRunCoordinator;

pub(crate) struct AgentRunFailure {
    pub(crate) error: String,
    pub(crate) stats: crate::agent_guardrails::AgentRunStats,
}

impl AgentRunCoordinator {
    pub(crate) async fn execute(
        request: AgentRuntimeRequest,
        tools: Option<AgentToolContext>,
        observer: AgentRuntimeObserver,
    ) -> Result<AgentRuntimeResponse, AgentRunFailure> {
        let guard = crate::agent_guardrails::AgentRunGuard::new(Default::default());
        AgentRuntime::run(request, tools, observer, guard.clone())
            .await
            .map_err(|error| AgentRunFailure {
                error,
                stats: guard.stats(),
            })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn coordinator_is_the_only_chat_handoff_to_the_runtime() {
        let chat = include_str!("chat.rs");
        assert!(chat.contains("AgentRunCoordinator::execute"));
        assert!(!chat.contains("AgentRuntime::run("));
    }
}
