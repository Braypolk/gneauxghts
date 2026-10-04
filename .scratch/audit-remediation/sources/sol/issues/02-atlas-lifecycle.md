# 02 — Scope Atlas search and initialization to visibility and lifetime

Status: ready-for-agent
Type: task
Audit items: AA-03, AA-04

Evidence: [module report](../reports/agent-app.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Capture query/visibility/generation for success/error/finally; invalidate on visibility, cache invalidation, input and dispose. Make pending initialization retire on dispose and join repeated callers, retaining legal route reentry.

## Acceptance and validation

Deferred all-to-hidden and dispose/reentry cannot admit old matches/errors or subscriptions. Retain stale-while-revalidate geometry and polling behavior; one subscription set per lifetime.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.
