# Streaming Measurement

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: audit_agent
Findings: CHAT-05

## Plan

Measure deterministic accumulated-answer bytes written before redesign. Preserve partial-output durability and mandatory final persistence; adopt optimization only with an explicit retained durability contract and tests.

## Verification

Record delta/write/byte counts; cancellation/restart and terminal content tests. If coalescing changes existing durability guarantees, reject that unrequested behavioral change with evidence and prefer representation/locality improvements.

## Constraints

Keep ChatService, NoteTimeline and app-owned AgentRuntime ownership; preserve canonical freshness, permissions and byte budgets. No live provider calls or broad suite runs. Coordinate Cargo with audit_timeline.

## Comments

2026-10-03: Plan recorded before implementation after review of both audits, architecture and ADRs 0001/0003/0009.

## Outcome

Measured100 full-answer writes (25,600B final,1,292,800B cumulative SQL content). Reused connection measured9ms vs78ms per-delta opens; preserves100commits and removes accumulated String clone. Benchmark passed. Coalescing/new append-log redesign evidence-rejected under current partial-durability contract; residual SQL amplification explicit.

See [per-finding outcomes](../agent.md) and [focused measurements](../measurements/agent-costs.json).

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
