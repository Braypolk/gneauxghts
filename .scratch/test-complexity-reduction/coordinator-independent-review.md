# Independent review of coordinator reduction

Reviewer: editor/discovery owner
Scope: issue06 and current diffs against the saved `baseline.json` snapshot, not Git HEAD. Source review only; browser execution remains coordinator-owned.

## One actionable preservation detail

`e2e/specs/browser/history-browsing.spec.ts`, immediately after Confirm clear: the retained wait for absence of “Load older history” is already satisfied by the preceding paging step. The deleted `history-controls.spec.ts` case explicitly awaited `[data-revision-id="note-alpha-baseline-after-clear"]`. Transfer that completion wait into the retained journey before checking canonical args and resulting timeline text. This preserves the deleted case's actual-clear completion boundary and avoids making the merged case timing-dependent.

## Supported deletions

- The removed navigation test patched dispatch, DOM scroll methods and matchMedia, then counted implementation effects. The retained route test first proves the destination is unmounted, navigates through Tasks, then checks real scroller/line rectangles and unchanged persisted Markdown. `navigation.test.ts` retains full-document matching and ambiguous/stale target handling. The pane animation reduced-motion case asserts actual opening/closing frames have no movement. No counter test needs replacement.
- Clear Cancel/no-write and exact canonical `{ noteId, confirmed: true }` assertions are transferred faithfully into the existing paged/read-only/return-state journey. Naming identity and restore-busy interactions remain separately covered. Only the completion wait above needs correction.
- Removing the middle 1440px branch retains both left/right narrow/wide matrix boundaries. Other opening variants, border focus, Related/chat and interrupted entrance tests still run at default 1440px. Reduced-motion frames and close focus are retained.
- The three removed AST cases froze field inventories, readonly syntax, exact reducer call names and readiness identifiers. Types and existing document identity, lifecycle, proposal/session and persistence behavioral tests remain. The retained fitness suite still checks duplicate state owners, global History ownership, all external-sync writes and capability bypasses, with executable scanner controls. These are deliberate removal of representation constraints, not deletion of a reproduced behavioral regression.

No additional lost behavior found in the reviewed snapshot diffs. Coordinator transferred the exact baseline-after-clear completion wait; verified in final source. Source review approved; root owns focused browser validation.
