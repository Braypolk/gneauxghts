# Workspace improvements — 2026-10-22

Implemented the six requested improvements in five parallel workstreams. The
user confirmed polished Markdown tables with editable cells, keyboard navigation
and row/column controls.

## Coordination and outcome

- Popup split navigation and Last edited shared the command bar and workspace
  glue, so one integration owner coordinated those edits. Saved note results in
  Search, Related, pinned and idle browsing expose a separate accessible split
  action when the viewport permits and no split exists. Loading completes before
  exposing the destination pane; the source and passage navigation are retained.
  Unsaved draft results retain ordinary selection without a dead split action.
- Tables and images shared the slash menu, with coordinated menu entries and
  independent implementation owners. `/table` inserts a GFM table. Cells support
  Markdown, Tab/Shift-Tab/Enter navigation, row/column controls, alignment, Source
  mode and the existing shared Undo/Redo. Dragging moves the whole table.
- Block dragging has proportional edge scrolling under a stationary pointer,
  refreshed drop targets, and Escape cancellation for pending and active gestures.
  All termination paths stop scrolling and ignore a later release.
- Recent / Last edited uses the existing rounded navigation style. The native
  read lists eligible saved notes by authored edit time, with deterministic ties
  and legacy filesystem-time fallback. Opening notes does not change this order.
  Loading, retry, stale requests and keyboard navigation are covered.
- `/image` exposes **Image from file…**, opens a file input and imports through
  the same upload owner as paste. Cancellation/failure retains command text;
  success is one shared Undo step. Mapped destinations retire safely after
  overlap, replacement, read-only takeover or view disposal.

Existing document, persistence and workspace ownership remain authoritative.
Current contracts are recorded in [ARCHITECTURE.md](../../ARCHITECTURE.md) and
the [behavior invariants](../../docs/architecture/behavior-invariants.md).
Independent Standards/correctness and Spec reviews were performed; confirmed
findings were corrected and regressions retained.

## Validation

- Full suite: 143 support tests and 1,460 frontend tests passed; one existing
  frontend test remains skipped. `pnpm check` passed with zero Svelte errors or
  warnings, including E2E TypeScript checks. Production build passed.
- Native: four Last edited tests and 19 architecture fitness tests passed.
- Browser: 64 existing search/navigation/Related scenarios passed, along with
  13 drag lifecycle scenarios and maintained discovery, image-picker and table
  regressions (7, 3 and 3 scenarios respectively).
- UI verification used the required named WDIO session, screenshot inspection,
  trace/export and fresh replay loop. Owned sessions and fixture servers were
  closed. The browser fixture uses simulated IPC and does not access user notes.

## Explicit limits

Nested tables and irregular rows with extra cells retain literal Markdown editing
to avoid losing container prefixes or content. Visual cells are single-line;
pasted newlines become spaces. Column resizing and merged cells were outside the
confirmed scope.

The image picker regression supplies a real FileList/change event while preventing
headless Chrome from auto-cancelling the OS dialog. Real platform chooser use and
native asset storage were not separately smoke-tested in this work. Existing
native image containment/storage ownership is reused.

## Main integration

Rebased onto the newer editor-input/task-date/image-drop fixes. Resolved the
shared image-import seam by retaining pointer-position drops and the slash
picker through one upload submission path; both documentation contracts remain.
The combined tree passed 1,462 frontend tests, 143 support tests, type checks and
production build. Fresh browser replay covers all 17 image-drop, file-picker,
discovery and table scenarios.
