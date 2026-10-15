# Exclude old lifecycle coordination from the Pi evaluation build

Status: ready-for-agent
Type: task
Milestone: first-usable-desktop
Blocked by: 01

Follow [the spec](../spec.md). Empty generic tables do not prove replacement:
startup still constructs ChatService, and the Pi frontend proxy can delegate
unimplemented operations to its native implementation.

## Work

- Separate retained settings, composer configuration, grants, exclusions,
  permission decisions, evidence and deterministic proposal policy from legacy
  conversation/run/review lifecycle ownership where needed.
- Compose the evaluation path without constructing the old lifecycle owner.
  Exclude AgentRunCoordinator and the custom Rust model/tool loop from this build;
  remove indirect call paths rather than placing Pi over them.
- Make supported ChatApi operations explicit. Deferred capabilities return an
  unavailable result; proxy fallback cannot invoke legacy coordination.
- Keep Pi authoritative for submissions, entries, tasks, checkpoints and decisions.
  Native effect receipts remain narrowly scoped to canonical mutation.
- Research stays explicitly unavailable until issue 09 provides a Pi worker. It
  cannot keep AgentRuntime compiled as fallback. Extract reusable leaf types/
  utilities only when retained callers need them.

## Acceptance

- An evaluation build compiles without legacy coordinator/model-loop modules and
  starts the real UI; the default build retains its existing path.
- Architecture checks forbid old lifecycle construction/calls and accidental
  fallback. Generic native conversation/run/proposal tables receive no Pi state.
- Settings/access/evidence and Keep use retained services without hidden legacy
  startup recovery or duplicate lifecycle stores.
- Missing capabilities are explicit and cannot reach Rust research. Record
  extracted, excluded and retained responsibilities separately.

## Starting points

`src-tauri/src/{lib,chat,agent_run_coordinator,agent_runtime}.rs`,
`src-tauri/src/agent_tools/research.rs`, native Pi facades,
`src/lib/prototypes/pi/chatApi.ts` and architecture fitness checks. This remains
an isolated deviation from ADR 0001, not production architecture adoption.

## Comments
