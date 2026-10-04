# 06 — Replace permissive or copied state-machine test oracles

Status: ready-for-agent
Type: task
Audit items: FD-03, FD-04, FE-08, BT-13

Evidence: [module report](../reports/frontend-documents.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Model success/rejection/no-op independently in workspace generated testing; execute real review extension state in proposal orchestration; port deep-caret undo cases through EditorDocumentRuntime.dispatchFromPane before deleting copied algorithms. See also frontend-editor FE-08.

## Acceptance and validation

A controlled broken valid command must fail generated tests; review-2/hunk-2 and multi-hunk mapping observed; removing production selection sync fails migrated undo case. Keep explicit close/disposal/restore and pure reducer coverage.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.

## Audit reconciliation and implementation status

Replace the misleading repaired-input forgotten metadata case with actual damaged-metadata/catalog continuity, or rename/remove it after proving existing command coverage. See the backend timeline supplement.
