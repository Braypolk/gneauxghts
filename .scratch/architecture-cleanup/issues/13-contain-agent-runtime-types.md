# 13 — Contain runtime-library types behind the existing agent adapter

Status: needs-triage
Depends on: None; fresh triage required
Scope: deferred; excluded from Round 1. Do not implement without a new scope decision after the Round 1 audit.

Read [the spec](../spec.md) and its execution/measurement rules first. Source lines refer to the 2026-09-07 working tree; use named symbols after preceding tickets move them.

## Problem and evidence

ADR 0001 promises an app-owned runtime boundary, but `AgentRuntimeRequest.prompt/history` and response usage contain Rig types (`src-tauri/src/agent_runtime.rs:41`, `:56`). `chat.rs:4168`, `:4337`, `:4429` constructs Rig messages/media. `AgentToolContext.build_agent` exposes registration machinery (`agent_tools.rs:164`). `agent_run_coordinator.rs` only constructs a guard and maps failure, while its test checks a string handoff.

## Chosen boundary and implementation

1. Keep `AgentRuntime` as the sole app-owned execution entry. Move guard construction and typed failure-with-stats behavior into that entry; delete the pass-through AgentRunCoordinator and its include-string test. Preserve a private guard-injected implementation only where deterministic runtime tests need it.
2. Use narrowly sufficient app-owned message/attachment inputs and the existing `AgentUsage`, including replacing the Rig usage in `AgentResponseSuccess` (`chat.rs:403`); do not clone the whole Rig schema. Chat chooses eligible history/context/compaction/citations. Runtime privately converts selected app data to provider messages/media.
3. Move Rig agent/tool registration from `AgentToolContext.build_agent` into runtime adapter code; domain tool operations remain app-owned and policy-checked.
4. Migrate both ordinary replies (`chat.rs:2362`) and background titles (`:2427`), preserving their different prompt/context policies and failure usage.
5. Delete Rig imports/types/conversion helpers from chat and app-owned protocol surfaces. Do not add provider registries, another event protocol, or a generic runtime framework. Update ARCHITECTURE and ADR 0001 implementation references.

## Acceptance and validation

- Boundary assertions protect dependency direction and absence of Rig types in chat/app protocol, not one spelling of an execute call.
- Existing history tests (`chat.rs:5874`), attachment/media conversions, temporal-answer exclusion, cancellation, bounded guardrails, pre-tool permission, failure stats and durable event fixtures retain behavior.
- Provider-safe summaries remain safe; no raw reasoning/tool arguments enter public events.
- Report deleted coordinator/conversions and net line delta. This ticket is an adapter-containment improvement, not a guaranteed deletion win; if it grows substantially, justify the exact input cases instead of adding speculative provider features.

## Comments

- Planning baseline: 2026-09-07. Append implementation evidence and resolution here; preserve the measured before/after and review follow-ups.

- Scope revision: deferred by the user's narrowed first-round decision. Retained as investigation/design evidence; ready-for-agent status and the original execution order no longer apply.
