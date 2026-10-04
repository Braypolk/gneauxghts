# Proposal Edits

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: audit_agent
Findings: PROPOSAL-02; CC-06

## Plan

Enumerate overlapping UTF-8 occurrences; add ambiguity and context-selected overlap regressions and pure invalid-edit/diff reconstruction tables. Remove environment configuration from read-only explicit-path previews.

## Verification

banana/ana ambiguity, selected second overlap, multibyte boundaries, overlapping edits and fallback reconstruct exact proposed content.

## Constraints

Keep ChatService, NoteTimeline and app-owned AgentRuntime ownership; preserve canonical freshness, permissions and byte budgets. No live provider calls or broad suite runs. Coordinate Cargo with audit_timeline.

## Comments

2026-10-03: Plan recorded before implementation after review of both audits, architecture and ADRs 0001/0003/0009.

## Outcome

Implemented overlapping Unicode-boundary occurrence resolution, pure invalid-edit matrix and UTF-16 diff reconstruction/fallback coverage. Proposal15 passed.

See [per-finding outcomes](../agent.md) and [focused measurements](../measurements/agent-costs.json).

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
