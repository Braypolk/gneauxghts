# 03 — Repair task-screen subscription and projection admission

Status: ready-for-agent
Type: task
Audit items: FE-04, FE-05, FE-06

Evidence: [module report](../reports/frontend-editor.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Retire initialize completion before unmount cleanup; introduce view generation and per-note response ordering for full loads, refresh patches and mutation responses. Consolidate mutation mechanics only after the ordering oracle is tested.

## Acceptance and validation

Late bootstrap attaches no orphan subscriptions; stale all-view group cannot replace completed-view tasks; same-note responses obey order; committed warning never causes a second canonical write. Preserve dirty-document routing and picker error behavior.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.
