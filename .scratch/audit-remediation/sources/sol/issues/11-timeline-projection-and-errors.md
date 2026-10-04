# 11 — Deepen private timeline storage and projection consistency

Status: needs-triage
Type: task
Audit items: BT-05, BT-06, BT-10, BT-11

Evidence: [module report](../reports/backend-timeline.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Preserve typed observation errors with with_context and exact replay regression. Bootstrap task/state schemas once at bound storage construction. Profile watermark churn before queue-aware retirement. Mechanically split private history_store codec/observation/administration/test support without public visibility expansion.

## Acceptance and validation

Corrupt/Stale types survive contextual replay; retained observation is not acknowledged on failure; startup concurrent migration/rollback works. Old lexical work cannot resurrect removed content. All durable ordering, receipt, scope, lineage and portability invariants remain. SQL/transaction count measured.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.
