# 15 — Replace source spelling guards and strengthen closed contracts

Status: needs-triage
Type: task
Audit items: CC-01, CC-04, CC-05, FD-09, BT-12

Evidence: [module report](../reports/cross-cutting.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Classify ownership guards versus migration spelling; replace only checks with mapped behavior/compiler/visibility enforcement. Add exhaustive union-vocabulary checks. Define exact managed UTC grammar and invalid calendar boundary tests before considering chrono replacement.

## Acceptance and validation

Forbidden owner/bypass still fails; harmless formatting/comments do not. New union member fails contract gate unless listed. Invalid leap/day/month dates rejected while emitted managed timestamp bytes/precision unchanged. No new parser dependency solely for cosmetic assertions.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.

## Audit reconciliation and implementation status

Extend contract boundary reconciliation with BB-05: name codec/presence tests honestly and cover consequential invoked command/event routing before expanding fixture duplication. Preserve best-effort notification semantics. CC-02 duplicate compiler and CC-03 inherited error parsing are already addressed; other fitness/contract work remains open.
