# Chat Admission Terminal

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: audit_agent
Findings: CHAT-01

## Plan

Extract private admission and terminal storage operations under ChatService. Atomically persist user/attachments/assistant/run/context; projection after admission is best-effort/recoverable. Route actual send/retry through same operation. Persist terminal message/sources/run together and do not report success after durable terminal failure.

## Verification

Trigger-injected attachment/context/source failures roll back; retry lineage retained; projection failure does not lose accepted receipt; restart converges.

## Constraints

Keep ChatService, NoteTimeline and app-owned AgentRuntime ownership; preserve canonical freshness, permissions and byte budgets. No live provider calls or broad suite runs. Coordinate Cargo with audit_timeline.

## Comments

2026-10-03: Plan recorded before implementation after review of both audits, architecture and ADRs 0001/0003/0009.

## Outcome

Implemented private atomic admission and terminal operations, real attachment fixture, trigger/sink failure tests and retry. Latest lifecycle3 plus attachment1 passed; chat57 passed. Architecture/invariants updated.

See [per-finding outcomes](../agent.md) and [focused measurements](../measurements/agent-costs.json).

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
