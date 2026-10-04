# Evidence Continuations

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: audit_agent
Findings: EVIDENCE-01/02

## Plan

Move fresh-search capacity enforcement after cursor admission; retain one inventory search and ordered witness set per cursor; keep scope, canonical and proof validation on every continuation. Update stateless fixture to reuse the production session. Remove unused full source payload only after tracing consumers.

## Verification

Boundary regression at 32 searches; same-session inventory pages retain one search; changed scope/content/history invalidates continuation; read cursor cap permits existing continuations.

## Constraints

Keep ChatService, NoteTimeline and app-owned AgentRuntime ownership; preserve canonical freshness, permissions and byte budgets. No live provider calls or broad suite runs. Coordinate Cargo with audit_timeline.

## Comments

2026-10-03: Plan recorded before implementation after review of both audits, architecture and ADRs 0001/0003/0009.

## Outcome

Implemented existing-cursor capacity handling and cached inventory paging. Evidence11 and inventory4 passed, including same-session scope/history invalidation and one retained search across pages.

See [per-finding outcomes](../agent.md) and [focused measurements](../measurements/agent-costs.json).

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
