# 10 — Unify disposable Rust fixtures and remove obsolete test writers

Status: ready-for-agent
Type: task
Audit items: BT-01, BT-02, BT-03, BT-08, AA-06, AA-07, BT-14, BB-04, BB-06

Evidence: [module report](../reports/backend-timeline.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

RAII-own shared overrides/faults/workers; migrate four cfg(test) persist_note scenarios to production NoteTimeline before deleting replica. Use explicit entered/released channels instead of fixed 2-second index wait and unbounded watcher receive. Table-test parsed env options or subprocess-isolate wrappers.

## Acceptance and validation

Panic cleanup restores prior config and drops worker before releasing guard; concurrent same-title paths and nested rename remain covered through real save; failure abandons intent; ordinary parallel run matches serial; no existing env value lost. Keep real worker scheduler/restart tests.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.

## Audit reconciliation and implementation status

Reconcile forgotten/search/command/lifecycle fixtures from the supplements. Bound scope-owned latch release on panic and restore overrides/hooks before workers or directories are dropped. The implemented six fault-consumer guards address only part of this ticket.
