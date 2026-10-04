# Chat Storage Tests

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: audit_agent
Findings: CHAT-02/03/04; AA-12 backend

## Plan

Centralize SQLite connection foreign-key policy, extract coherent private storage/projection/test modules without a new owner. Consolidate only subsumed recovery tests, replace sleep/mtime projection assertion with recording sink, table-test pure slot/history logic and real multibyte excerpt boundaries.

## Verification

Foreign-key enforcement and cascade contract; exact retained recovery matrix; projection sink proves index not rewritten; narrow pure tests need no database.

## Constraints

Keep ChatService, NoteTimeline and app-owned AgentRuntime ownership; preserve canonical freshness, permissions and byte budgets. No live provider calls or broad suite runs. Coordinate Cargo with audit_timeline.

## Comments

2026-10-03: Plan recorded before implementation after review of both audits, architecture and ADRs 0001/0003/0009.

## Outcome

Implemented FK connection policy and private storage/runtime/projection modules; extracted tests and consolidated redundant startup tests, pure fixtures and mtime sleep. Chat57/recovery7 passed; parsed architecture handoff ownership check coordinated with timeline owner.

See [per-finding outcomes](../agent.md) and [focused measurements](../measurements/agent-costs.json).

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
