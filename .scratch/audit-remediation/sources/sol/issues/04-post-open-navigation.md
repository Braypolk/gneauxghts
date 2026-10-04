# 04 — Resolve navigation targets after opening the destination

Status: ready-for-agent
Type: task
Audit items: FD-02, FD-10

Evidence: [module report](../reports/frontend-documents.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Replace pre-open concrete NavigationContext with a pane/operation-bound post-open context at Recent Task flow. Investigate overlapping location restoration suppression with a controlled two-pane reproduction before choosing a lease count or pane scope.

## Acceptance and validation

Task in note B opened from A focuses the exact task; same-note/rejected-open/superseding-C cases remain safe. Restoration suppression lasts through all admitted overlapping restores and releases on failure.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.
