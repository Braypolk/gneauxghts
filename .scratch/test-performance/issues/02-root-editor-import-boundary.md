# Root editor import boundary

Status: ready-for-agent
Progress: Complete; accepted frontend changes verified, Rust experiment reverted.

## Problem and evidence

Root/model tests eagerly import pane UI because `editorDocumentRuntime.ts` imports root creation from the pane extension module and `documentRuntime.ts` imports resource creation through the broad editor façade. `rg createRootState src` finds one definition and one caller. A static local graph simulating both edge changes removes DateTimePicker reachability from 26 of 38 test files; this is not a timing result and ignores mocks.

## Exact changes

1. `src/lib/features/notepad/editor/editorDocumentRuntime.ts`: remove the `createRootState` import. Within existing private `documentRoot(markdown)`, create the EditorState using exactly `history()`, `imageResizeHistory`, `keymap.of(historyKeymap)`, `createMarkdownBaseExtensions()` in that order. Preserve the existing `.update({ effects: StateEffect.appendConfig.of(documentReviewField) }).state` step. Add required imports from existing actual owners. Do not directly include the review field in the initial extension list or change history semantics.
2. `src/lib/features/notepad/editor/editorExtensions.ts`: delete the now-unused exported root constructor and only imports made dead by its removal (image resize history, history/historyKeymap, keymap if unused). Pane construction and extensions remain unchanged.
3. `src/lib/features/notepad/document/documentRuntime.ts`: import `createSharedEditorResources` directly from `editorDocumentResources`; import `SharedEditorResources` as a type from `editor/types`. This bypasses the façade's independent pane-controller reexports.

No new modules, mocks, asynchronous factories, runtime flags, test removals, package alias changes, or isolation changes. Root construction belongs privately to its sole runtime caller. Review extension still imports real CodeMirror/MarkdownIt; removing those is out of scope.

## Verification and measurement proposal

Coordinator owns all runs. Capture before/after using identical pool settings and this focused filter:

`src/lib/features/notepad/document/documentRegistry.test.ts src/lib/features/notepad/document/documentRuntime.test.ts src/lib/features/notepad/document/documentEditingService.test.ts src/lib/features/proposals/documentReview.test.ts`

These four files lose the pane UI edge and include actual document editing/review behavior rather than only trivial constructors. Capture wall time and Vitest collect/transform, repeat for noise. Validate the full unchanged 1,065-case/143-file suite after the edit; it includes transaction forwarding, undo selection, image resize history and real review lifecycle regressions. Typecheck separately at coordinator discretion. The root runtime test itself also imports `editorViewController`, so it remains a correctness owner but is not a clean performance probe for this cut.

## Risk and acceptance

Low semantic risk if extension order and post-construction append transaction remain identical. The source graph changes intentionally; there are no other callers of the removed helper. Public editor façade remains intact for existing consumers/mocks. Keep the change if controlled measurement supports improvement or the coordinator accepts the demonstrated root/pane dependency correction; do not claim a speedup without measurement.

## Implementation result

The exact three-file plan is implemented. The sole root-construction body is now private to `editorDocumentRuntime.ts`, with the same extension sequence and subsequent review-field append transaction. The document resource import bypasses the pane façade. The old root export and dead pane-module imports are removed. No new file, test, mock or behavioral interface was introduced. Diff inspected against the phase snapshot; `git diff --check` passes for the three files. Coordinator owns focused/full validation and timing; no speedup claimed yet. Remaining semantic risk is confined to unintended import initialization effects, which full validation should detect.

## Acceptance

Implemented in three existing files, net nine production lines removed. All 1,065 frontend cases pass; exact case names unchanged. Four-file focused probe fell from 4.91s to 0.42s under the same thread pool. Independent review passed; unused-import cleanup completed.
