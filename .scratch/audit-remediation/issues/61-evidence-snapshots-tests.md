# Evidence Snapshots Tests

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: audit_agent
Findings: EVIDENCE-03/04; AA-09/10

## Plan

Measure repeated canonical reads and introduce operation-local snapshots only where redundant reads are proven. Preserve independent before-delivery validation. Group evidence contracts under evidence owner, separate envelope sizing from real I/O sweeps, and test hybrid composition with controlled candidates.

## Verification

Count canonical reads across long-note slices; prove edit rejection; retain Unicode/provenance/budget contracts and test hybrid agreement/fallback.

## Constraints

Keep ChatService, NoteTimeline and app-owned AgentRuntime ownership; preserve canonical freshness, permissions and byte budgets. No live provider calls or broad suite runs. Coordinate Cargo with audit_timeline.

## Comments

2026-10-03: Plan recorded before implementation after review of both audits, architecture and ADRs 0001/0003/0009.

## Outcome

Implemented operation-local canonical snapshots and hybrid composition seam/tests (evidence11 passed). Measured ten→one preparation reads with changed-note rejection. Evidence-rejected pure sizing extraction and relocation of private-clock temporal tests after timing/ownership inspection; details in agent.md.

See [per-finding outcomes](../agent.md) and [focused measurements](../measurements/agent-costs.json).

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
