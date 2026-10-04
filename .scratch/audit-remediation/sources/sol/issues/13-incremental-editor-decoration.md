# 13 — Measure and replace full-tree decoration rebuilds

Status: needs-triage
Type: task
Audit items: FE-10, FE-12

Evidence: [module report](../reports/frontend-editor.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Measure visited nodes/lines for selection/viewport changes in 1/2/4-pane long notes. Start with document-derived passive-table cache; prototype shared immutable syntax inventory plus pane-local reveal/selection overlays. Keep image invariant tests bounded and move observational scale work to explicit lane after coverage map.

## Acceptance and validation

Selection/viewport change avoids full scan where possible; background syntax publication, nested concealment/atomic ranges, task/link widgets, cursor geometry and presentation-before-reveal unchanged. Deterministic complexity checks plus real browser benchmark; no invented SLA.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.
