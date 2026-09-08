use crate::agent_runtime::{AgentEvent, AgentEventSink};
use futures_util::future::Either;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentPermissionKind {
    ProcessExecution,
    FileMutation,
    NetworkMutation,
    DestructiveAction,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPermissionIdentity {
    pub(crate) permission_id: String,
    pub(crate) request_id: String,
    pub(crate) conversation_id: String,
    pub(crate) message_id: String,
    pub(crate) run_id: String,
    pub(crate) tool_call_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPermissionRequest {
    #[serde(flatten)]
    pub(crate) identity: AgentPermissionIdentity,
    pub(crate) tool_name: String,
    pub(crate) title: String,
    pub(crate) kind: AgentPermissionKind,
    /// Product-owned, human-readable boundary such as a command family or
    /// target host. It is part of the narrowly-scoped run grant key.
    pub(crate) scope: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentPermissionDecision {
    AllowOnce,
    AllowForSession,
    Deny,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentPermissionResolution {
    AllowedOnce,
    AllowedForSession,
    Denied,
    Cancelled,
}

impl AgentPermissionDecision {
    fn resolution(&self) -> AgentPermissionResolution {
        match self {
            Self::AllowOnce => AgentPermissionResolution::AllowedOnce,
            Self::AllowForSession => AgentPermissionResolution::AllowedForSession,
            Self::Deny => AgentPermissionResolution::Denied,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPermissionDecisionCommand {
    #[serde(flatten)]
    pub(crate) identity: AgentPermissionIdentity,
    pub(crate) decision: AgentPermissionDecision,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AgentPermissionRunContext {
    pub(crate) request_id: String,
    pub(crate) conversation_id: String,
    pub(crate) message_id: String,
    pub(crate) run_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AgentPermissionRequirement {
    pub(crate) title: String,
    pub(crate) kind: AgentPermissionKind,
    pub(crate) scope: String,
}

/// Product-owned policy adapter used by the runtime pre-tool hook. Production
/// currently supplies no requirements, so existing safe tools remain unchanged.
#[derive(Clone)]
pub(crate) struct AgentPermissionBoundary {
    broker: AgentPermissionBroker,
    context: AgentPermissionRunContext,
    requirements: Arc<HashMap<String, AgentPermissionRequirement>>,
}

impl AgentPermissionBoundary {
    /// Constructs the dormant production boundary for a run. Future
    /// side-effecting tools opt in by adding a narrow requirement in
    /// `production_requirements`; the runtime and observer wiring stay fixed.
    pub(crate) fn for_run(
        broker: AgentPermissionBroker,
        context: AgentPermissionRunContext,
    ) -> Self {
        Self::new(broker, context, production_requirements())
    }

    fn new(
        broker: AgentPermissionBroker,
        context: AgentPermissionRunContext,
        requirements: HashMap<String, AgentPermissionRequirement>,
    ) -> Self {
        Self {
            broker,
            context,
            requirements: Arc::new(requirements),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_requirements(
        broker: AgentPermissionBroker,
        context: AgentPermissionRunContext,
        requirements: HashMap<String, AgentPermissionRequirement>,
    ) -> Self {
        Self::new(broker, context, requirements)
    }

    pub(crate) async fn request_for_tool(
        &self,
        tool_call_id: &str,
        tool_name: &str,
        cancelled: CancellationToken,
        event_sink: AgentEventSink,
    ) -> Result<Option<AgentPermissionResolution>, String> {
        let Some(requirement) = self.requirements.get(tool_name) else {
            return Ok(None);
        };
        let request = AgentPermissionRequest {
            identity: AgentPermissionIdentity {
                permission_id: format!("permission:{}:{}", self.context.run_id, tool_call_id),
                request_id: self.context.request_id.clone(),
                conversation_id: self.context.conversation_id.clone(),
                message_id: self.context.message_id.clone(),
                run_id: self.context.run_id.clone(),
                tool_call_id: tool_call_id.to_string(),
            },
            tool_name: tool_name.to_string(),
            title: requirement.title.clone(),
            kind: requirement.kind.clone(),
            scope: requirement.scope.clone(),
        };
        self.broker
            .request(request, cancelled, event_sink)
            .await
            .map(Some)
    }
}

fn production_requirements() -> HashMap<String, AgentPermissionRequirement> {
    // Existing reads and proposal-producing tools are safe by construction and
    // intentionally absent. Add only genuinely side-effecting future tools.
    HashMap::new()
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct RunGrantKey {
    request_id: String,
    conversation_id: String,
    message_id: String,
    run_id: String,
    tool_name: String,
    kind: AgentPermissionKind,
    scope: String,
}

impl From<&AgentPermissionRequest> for RunGrantKey {
    fn from(request: &AgentPermissionRequest) -> Self {
        Self {
            request_id: request.identity.request_id.clone(),
            conversation_id: request.identity.conversation_id.clone(),
            message_id: request.identity.message_id.clone(),
            run_id: request.identity.run_id.clone(),
            tool_name: request.tool_name.clone(),
            kind: request.kind.clone(),
            scope: request.scope.clone(),
        }
    }
}

struct PendingPermission {
    request: AgentPermissionRequest,
    sender: oneshot::Sender<AgentPermissionResolution>,
    event_sink: AgentEventSink,
}

#[derive(Default)]
struct PermissionState {
    pending: HashMap<String, PendingPermission>,
    run_grants: HashSet<RunGrantKey>,
}

#[derive(Clone, Default)]
pub(crate) struct AgentPermissionBroker {
    inner: Arc<Mutex<PermissionState>>,
}

impl AgentPermissionBroker {
    pub(crate) async fn request(
        &self,
        request: AgentPermissionRequest,
        cancelled: CancellationToken,
        event_sink: AgentEventSink,
    ) -> Result<AgentPermissionResolution, String> {
        if cancelled.is_cancelled() {
            return Ok(AgentPermissionResolution::Cancelled);
        }
        let receiver = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| "Agent permission lock poisoned".to_string())?;
            if state.run_grants.contains(&RunGrantKey::from(&request)) {
                return Ok(AgentPermissionResolution::AllowedForSession);
            }
            if state.pending.contains_key(&request.identity.permission_id) {
                return Err("That permission request is already pending".to_string());
            }
            let (sender, receiver) = oneshot::channel();
            state.pending.insert(
                request.identity.permission_id.clone(),
                PendingPermission {
                    request: request.clone(),
                    sender,
                    event_sink: Arc::clone(&event_sink),
                },
            );
            receiver
        };
        event_sink(AgentEvent::PermissionRequested {
            request: request.clone(),
        });

        let cancelled_future = cancelled.cancelled();
        futures_util::pin_mut!(receiver, cancelled_future);
        match futures_util::future::select(receiver, cancelled_future).await {
            Either::Left((resolution, _)) => {
                resolution.map_err(|_| "The permission request ended before a decision".to_string())
            }
            Either::Right((_, receiver)) => {
                if let Some(resolution) = self.cancel_pending(&request.identity)? {
                    Ok(resolution)
                } else {
                    receiver
                        .await
                        .map_err(|_| "The permission request ended before a decision".to_string())
                }
            }
        }
    }

    pub(crate) fn decide(
        &self,
        command: AgentPermissionDecisionCommand,
    ) -> Result<AgentPermissionResolution, String> {
        let resolution = command.decision.resolution();
        let event_sink = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| "Agent permission lock poisoned".to_string())?;
            let Some(current) = state.pending.get(&command.identity.permission_id) else {
                return Err("That permission request is no longer pending".to_string());
            };
            if current.request.identity != command.identity {
                return Err(
                    "That decision does not match the active permission request".to_string()
                );
            }
            let current = state
                .pending
                .remove(&command.identity.permission_id)
                .expect("pending permission was checked");
            current
                .sender
                .send(resolution.clone())
                .map_err(|_| "That permission request is no longer waiting".to_string())?;
            if command.decision == AgentPermissionDecision::AllowForSession {
                state.run_grants.insert(RunGrantKey::from(&current.request));
            }
            current.event_sink
        };
        event_sink(AgentEvent::PermissionResolved {
            permission_id: command.identity.permission_id,
            resolution: resolution.clone(),
        });
        Ok(resolution)
    }

    fn cancel_pending(
        &self,
        identity: &AgentPermissionIdentity,
    ) -> Result<Option<AgentPermissionResolution>, String> {
        let pending = self
            .inner
            .lock()
            .map_err(|_| "Agent permission lock poisoned".to_string())?
            .pending
            .remove(&identity.permission_id);
        let Some(pending) = pending else {
            return Ok(None);
        };
        if pending.request.identity != *identity {
            return Err("Permission cancellation identity mismatch".to_string());
        }
        let resolution = AgentPermissionResolution::Cancelled;
        (pending.event_sink)(AgentEvent::PermissionResolved {
            permission_id: identity.permission_id.clone(),
            resolution: resolution.clone(),
        });
        Ok(Some(resolution))
    }

    pub(crate) fn finish_run(&self, run_id: &str) {
        let pending = {
            let Ok(mut state) = self.inner.lock() else {
                return;
            };
            state.run_grants.retain(|grant| grant.run_id != run_id);
            let ids = state
                .pending
                .iter()
                .filter(|(_, pending)| pending.request.identity.run_id == run_id)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| state.pending.remove(&id))
                .collect::<Vec<_>>()
        };
        for pending in pending {
            let resolution = AgentPermissionResolution::Cancelled;
            let _ = pending.sender.send(resolution.clone());
            (pending.event_sink)(AgentEvent::PermissionResolved {
                permission_id: pending.request.identity.permission_id,
                resolution,
            });
        }
    }

    pub(crate) fn cancel_all(&self) {
        let pending = {
            let Ok(mut state) = self.inner.lock() else {
                return;
            };
            state.run_grants.clear();
            state
                .pending
                .drain()
                .map(|(_, pending)| pending)
                .collect::<Vec<_>>()
        };
        for pending in pending {
            let resolution = AgentPermissionResolution::Cancelled;
            let _ = pending.sender.send(resolution.clone());
            (pending.event_sink)(AgentEvent::PermissionResolved {
                permission_id: pending.request.identity.permission_id,
                resolution,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Mutex, time::Duration};

    fn wait_for_registration(broker: &AgentPermissionBroker, permission_id: &str) {
        for _ in 0..100 {
            if broker
                .inner
                .lock()
                .unwrap()
                .pending
                .contains_key(permission_id)
            {
                return;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        panic!("permission request was not registered");
    }

    fn request(permission_id: &str, run_id: &str, scope: &str) -> AgentPermissionRequest {
        AgentPermissionRequest {
            identity: AgentPermissionIdentity {
                permission_id: permission_id.to_string(),
                request_id: "request-1".to_string(),
                conversation_id: "conversation-1".to_string(),
                message_id: "message-1".to_string(),
                run_id: run_id.to_string(),
                tool_call_id: "tool-call-1".to_string(),
            },
            tool_name: "fake_side_effect".to_string(),
            title: "Run fake side effect".to_string(),
            kind: AgentPermissionKind::ProcessExecution,
            scope: scope.to_string(),
        }
    }

    fn sink() -> (Arc<Mutex<Vec<AgentEvent>>>, AgentEventSink) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&events);
        (
            events,
            Arc::new(move |event| captured.lock().unwrap().push(event)),
        )
    }

    #[test]
    fn correlated_decision_resumes_exactly_once_and_rejects_late_or_wrong_identity() {
        tauri::async_runtime::block_on(async {
            let broker = AgentPermissionBroker::default();
            let request = request("permission-1", "run-1", "command:echo");
            let (_, sink) = sink();
            let waiting = tauri::async_runtime::spawn({
                let broker = broker.clone();
                let request = request.clone();
                async move {
                    broker
                        .request(request, CancellationToken::new(), sink)
                        .await
                }
            });
            wait_for_registration(&broker, "permission-1");
            let mut wrong = request.identity.clone();
            wrong.tool_call_id = "wrong-call".to_string();
            assert!(broker
                .decide(AgentPermissionDecisionCommand {
                    identity: wrong,
                    decision: AgentPermissionDecision::AllowOnce,
                })
                .is_err());
            assert_eq!(
                broker
                    .decide(AgentPermissionDecisionCommand {
                        identity: request.identity.clone(),
                        decision: AgentPermissionDecision::AllowOnce,
                    })
                    .unwrap(),
                AgentPermissionResolution::AllowedOnce
            );
            assert_eq!(
                waiting.await.unwrap().unwrap(),
                AgentPermissionResolution::AllowedOnce
            );
            assert!(broker
                .decide(AgentPermissionDecisionCommand {
                    identity: request.identity,
                    decision: AgentPermissionDecision::AllowOnce,
                })
                .is_err());
        });
    }

    #[test]
    fn production_boundary_leaves_existing_safe_tools_ungated() {
        tauri::async_runtime::block_on(async {
            let boundary = AgentPermissionBoundary::for_run(
                AgentPermissionBroker::default(),
                AgentPermissionRunContext {
                    request_id: "request-1".to_string(),
                    conversation_id: "conversation-1".to_string(),
                    message_id: "message-1".to_string(),
                    run_id: "run-1".to_string(),
                },
            );
            let (events, sink) = sink();
            for tool in [
                "get_active_note",
                "search_notes",
                "read_note",
                "propose_note_edits",
                "propose_note_rewrite",
                "propose_create_note",
                "update_plan",
            ] {
                assert_eq!(
                    boundary
                        .request_for_tool(
                            "call-1",
                            tool,
                            CancellationToken::new(),
                            Arc::clone(&sink),
                        )
                        .await
                        .unwrap(),
                    None
                );
            }
            assert!(events.lock().unwrap().is_empty());
        });
    }

    #[test]
    fn allow_once_is_consumed_but_run_grant_is_narrow_and_ephemeral() {
        tauri::async_runtime::block_on(async {
            let broker = AgentPermissionBroker::default();
            let (events, sink) = sink();
            let first = request("permission-1", "run-1", "command:echo");
            let waiting = tauri::async_runtime::spawn({
                let broker = broker.clone();
                let first = first.clone();
                let sink = Arc::clone(&sink);
                async move { broker.request(first, CancellationToken::new(), sink).await }
            });
            wait_for_registration(&broker, "permission-1");
            broker
                .decide(AgentPermissionDecisionCommand {
                    identity: first.identity.clone(),
                    decision: AgentPermissionDecision::AllowOnce,
                })
                .unwrap();
            assert_eq!(
                waiting.await.unwrap().unwrap(),
                AgentPermissionResolution::AllowedOnce
            );

            let second = request("permission-2", "run-1", "command:echo");
            let waiting = tauri::async_runtime::spawn({
                let broker = broker.clone();
                let second = second.clone();
                let sink = Arc::clone(&sink);
                async move { broker.request(second, CancellationToken::new(), sink).await }
            });
            wait_for_registration(&broker, "permission-2");
            broker
                .decide(AgentPermissionDecisionCommand {
                    identity: second.identity.clone(),
                    decision: AgentPermissionDecision::AllowForSession,
                })
                .unwrap();
            assert_eq!(
                waiting.await.unwrap().unwrap(),
                AgentPermissionResolution::AllowedForSession
            );

            let same_scope = request("permission-3", "run-1", "command:echo");
            assert_eq!(
                broker
                    .request(same_scope, CancellationToken::new(), Arc::clone(&sink))
                    .await
                    .unwrap(),
                AgentPermissionResolution::AllowedForSession
            );
            let other_scope = request("permission-4", "run-1", "command:delete");
            let other_cancel = CancellationToken::new();
            other_cancel.cancel();
            assert_eq!(
                broker
                    .request(other_scope, other_cancel, Arc::clone(&sink))
                    .await
                    .unwrap(),
                AgentPermissionResolution::Cancelled
            );
            let other_run = request("permission-5", "run-2", "command:echo");
            let other_cancel = CancellationToken::new();
            other_cancel.cancel();
            assert_eq!(
                broker
                    .request(other_run, other_cancel, Arc::clone(&sink))
                    .await
                    .unwrap(),
                AgentPermissionResolution::Cancelled
            );
            broker.finish_run("run-1");
            let after_finish = request("permission-6", "run-1", "command:echo");
            let after_cancel = CancellationToken::new();
            after_cancel.cancel();
            assert_eq!(
                broker
                    .request(after_finish, after_cancel, sink)
                    .await
                    .unwrap(),
                AgentPermissionResolution::Cancelled
            );
            assert_eq!(
                events
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|event| matches!(event, AgentEvent::PermissionRequested { .. }))
                    .count(),
                2
            );
        });
    }

    #[test]
    fn denial_and_cancellation_resolve_waiters_without_granting() {
        tauri::async_runtime::block_on(async {
            let broker = AgentPermissionBroker::default();
            let (events, sink) = sink();
            let denied = request("permission-1", "run-1", "command:echo");
            let waiting = tauri::async_runtime::spawn({
                let broker = broker.clone();
                let denied = denied.clone();
                let sink = Arc::clone(&sink);
                async move { broker.request(denied, CancellationToken::new(), sink).await }
            });
            wait_for_registration(&broker, "permission-1");
            broker
                .decide(AgentPermissionDecisionCommand {
                    identity: denied.identity,
                    decision: AgentPermissionDecision::Deny,
                })
                .unwrap();
            assert_eq!(
                waiting.await.unwrap().unwrap(),
                AgentPermissionResolution::Denied
            );

            let cancelled = request("permission-2", "run-1", "command:echo");
            let token = CancellationToken::new();
            let waiting = tauri::async_runtime::spawn({
                let broker = broker.clone();
                let token = token.clone();
                let sink = Arc::clone(&sink);
                async move { broker.request(cancelled, token, sink).await }
            });
            wait_for_registration(&broker, "permission-2");
            token.cancel();
            assert_eq!(
                waiting.await.unwrap().unwrap(),
                AgentPermissionResolution::Cancelled
            );

            let finished = request("permission-3", "run-1", "command:echo");
            let waiting = tauri::async_runtime::spawn({
                let broker = broker.clone();
                let sink = Arc::clone(&sink);
                async move {
                    broker
                        .request(finished, CancellationToken::new(), sink)
                        .await
                }
            });
            wait_for_registration(&broker, "permission-3");
            broker.finish_run("run-1");
            assert_eq!(
                waiting.await.unwrap().unwrap(),
                AgentPermissionResolution::Cancelled
            );
            assert!(events.lock().unwrap().iter().any(|event| matches!(
                event,
                AgentEvent::PermissionResolved {
                    resolution: AgentPermissionResolution::Denied,
                    ..
                }
            )));
            assert!(events.lock().unwrap().iter().any(|event| matches!(
                event,
                AgentEvent::PermissionResolved {
                    resolution: AgentPermissionResolution::Cancelled,
                    ..
                }
            )));
        });
    }

    #[test]
    fn restart_cancellation_releases_every_permission_waiter() {
        tauri::async_runtime::block_on(async {
            let broker = AgentPermissionBroker::default();
            let request = request("permission-restart", "run-restart", "command:echo");
            let (registered_tx, registered_rx) = std::sync::mpsc::channel();
            let events = Arc::new(Mutex::new(Vec::new()));
            let captured = Arc::clone(&events);
            let sink: AgentEventSink = Arc::new(move |event| {
                if matches!(event, AgentEvent::PermissionRequested { .. }) {
                    let _ = registered_tx.send(());
                }
                captured.lock().unwrap().push(event);
            });
            let waiting = tauri::async_runtime::spawn({
                let broker = broker.clone();
                async move {
                    broker
                        .request(request, CancellationToken::new(), sink)
                        .await
                }
            });

            registered_rx.recv().unwrap();
            broker.cancel_all();
            assert_eq!(
                waiting.await.unwrap().unwrap(),
                AgentPermissionResolution::Cancelled
            );
            let state = broker.inner.lock().unwrap();
            assert!(state.pending.is_empty());
            assert!(state.run_grants.is_empty());
            assert!(events.lock().unwrap().iter().any(|event| matches!(
                event,
                AgentEvent::PermissionResolved {
                    resolution: AgentPermissionResolution::Cancelled,
                    ..
                }
            )));
        });
    }
}
