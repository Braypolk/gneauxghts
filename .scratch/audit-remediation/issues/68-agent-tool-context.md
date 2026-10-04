# Agent Tool Context

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: audit_agent
Findings: AGENT-01/02

## Plan

Introduce private concrete app-owned operation context/event dependencies for real tool tests; research worker constructor explicitly separates inherited grants/budgets from fresh state. Consistently dispatch file/database/diff work through blocking seam.

## Verification

Real tool rewrite requires full read; permission/currentness failure; worker empty scope/no inference, cancellation/failure lease reuse, deterministic runtime injection; event-loop progress during blocked work.

## Constraints

Keep ChatService, NoteTimeline and app-owned AgentRuntime ownership; preserve canonical freshness, permissions and byte budgets. No live provider calls or broad suite runs. Coordinate Cargo with audit_timeline.

## Comments

2026-10-03: Plan recorded before implementation after review of both audits, architecture and ADRs 0001/0003/0009.

## Outcome

Implemented concrete ToolHost, real tools under deterministic production runtime, explicit research-worker fields and injectable research runner, and consistent blocking dispatch. Agent tools/research23 passed incl causal current-thread responsiveness, exclusion at handoff, timeout/cancel/error/lease cases.

See [per-finding outcomes](../agent.md) and [focused measurements](../measurements/agent-costs.json).

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
