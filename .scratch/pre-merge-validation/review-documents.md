# Frontend document/workspace/editor/proposal Spec review

Progress: Initial findings persisted; read-only review except coordinator-authorized regression for finding D1. Root owns all test/build execution.

Baseline: exact `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b` versus current tracked working tree plus intentional untracked frontend sources. Used `git diff cb4d4c02 -- src/lib/features/notepad src/lib/features/proposals src/lib/features/history`, separately read new workspace owner/composition files, and inspected local-main `04f13b35a253974c01070a7502c940e20332b165` plus root's disposable integrated checkout.

Applied repository `code-review` skill (Spec axis; Standards examined where needed to establish ownership), ARCHITECTURE canonical ownership, behavior invariants for workspace navigation, proposal lifetime, committed adoption, and history browsing/restore. Requirements came from the four requested remediation/architecture/test-reduction specs. Prior phase reports were navigation rather than evidence substitutes.

## Findings

### D1 — P2: concurrent splits can exceed configured pane capacity

`src/lib/features/notepad/orchestration/notepadWorkspaceSession.ts:905–923` checks maximum capacity before two asynchronous lookups. Two simultaneous calls from two of three panes get distinct operation identities, both pass, and both reach `completePaneCreation`, producing four panes. The store has no independent maximum (`workspaceStore.svelte.ts:155–190`). External callers do not serialize: `workspaceChoiceController.ts:30–37` checks only the injected viewport rule, Notepad supplies width/height at `Notepad.svelte:923–924`, and `SplitPaneButton.svelte:105` invokes without disabling while pending.

This leaves the architecture rewrite's complete workspace-operation/capacity policy partial. Review presentation already has a post-admission check at `notepadWorkspaceSession.ts:665–680`; normal split needs its own completion-time admission check or serialized capacity reservation. Existing real-composition tests exercise failed creation cleanup and review-capacity races but not two concurrent ordinary splits. See issue `issues/01-concurrent-split-capacity.md` for the bounded reproduction and correction scope.

### D2 — P2: generic navigation can repurpose an active chat instead of the nearest editor

`src/lib/features/notepad/orchestration/notepadWorkspaceSession.ts:765–768` chooses `workspace.activePaneId` for `openNotePath`. Generic search/task/related entry points build their source document and navigation destination from the nearest editor (`Notepad.svelte:376–408,440–468`; `navigationSelectionController.ts:51–54`), but the open call does not target or activate that editor. With chat active beside editor A, selecting note B opens B in the chat pane and changes its kind to editor. The destination-context callback still identifies the original editor A; `openFlow.ts:108–109` then rejects the mismatch, so section/task reveal also fails.

This directly contradicts `behavior-invariants.md:81–84`: generic note navigation targets the nearest editor, otherwise reuses the active retained-context pane. The older note controller also chose active pane, so this is a retained defect/missing remediation rather than an asserted new regression from one line. It remains a requirement gap in the current cumulative rewrite. The retained test named `selects the nearest editor for navigation and cycles real workspace panes` only asserts the selector and does not execute navigation (`notepadWorkspaceSession.test.ts:246–256`). A real action regression should assert B opens in the existing editor while the chat pane and conversation remain intact, and destination reveal uses that editor. Distinguish generic opens from intentional pane-local location-history operations when correcting it.

## Integrated behavior checked without further findings

- Document adoption: private shared snapshot adoption preserves operation-specific APIs. Accepted saves retain eligible later body/title/tag edits; Version Restore always resets the root even when only properties changed. Unopened restore does not create panes. Conflict load checks correlation and revision, rolls back stale partial fanout, and failed publication preserves choices.
- Proposal lifetime: one retained root owns Markdown and hunk mapping; pane projections follow it. Passive arrival checks existing ready editors and does not call presentation. Explicit presentation uses one workspace operation. Route disposal retires local admission but preserves root/workflow and save suppression. Already admitted durable commit adoption checks the same document object even after disposal. Terminal follow-on save runs after root review ends, preserving dirty failure state. The current composition tests include no-pane edits, disposal/remount, in-flight completion, reviewed-A/visible-B reload, typing during disk read, and failed follow-on persistence.
- Navigation: full-document target resolution verifies hints and rejects ambiguous matches; offscreen reveal uses CodeMirror coordinates. Editor lifecycle now awaits the old scroll restoration before returning. New navigation context correlation rejects a different pane/document lifetime. These fixes retain tests and mounted scenarios; no rerun claimed by this reviewer.
- Workspace replacement: ten obsolete controller/facade modules are removed, and substantive command policy lives in the new owner with concrete document/workspace/persistence owners. Shared save/finalize departure, stale open/dispose, MRU suppression, blocked close, collision and teardown cases survive through the real composition fixture. Capacity and generic target gaps above are exceptions, not reasons to reintroduce the old callback graph.
- Editor changes sampled beyond the root: clipboard cut captures document/selection/read-only ownership before asynchronous deletion; code-context parsing replaces separate fence recognition; full-document decorations no longer rebuild solely for viewport movement. Shared-root undo, sibling selection/scroll and properties-only reset remain explicit tests. Full CSS/browser behavior remains a coordinator execution gate.
- Test reduction: sampled deletions are supported by surviving composition or direct state behavior rather than case renaming. The selector-only navigation case demonstrates one insufficient retained oracle (D2). No claim is made that every deleted assertion across the entire repository was re-proven in this frontend review.

## Local-main Open File Location integration

Inspected root's `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-premerge-39n5lbfr` copies of Notepad, NotepadPane, paneViewModelFactory and notepadPane.types. Both `onMount/tick/untrack` and `revealItemInDir` imports are retained. The action resolves the selected pane's current document path at invocation, no-ops for a draft without a path, and reports opener failure. The editor-only menu uses the new typed availability flag derived from the same document. It neither persists nor changes pane/document ownership; no manual integration mismatch found in those four files. Typecheck and actual native opener permissions remain root validation responsibilities.

## Readiness and limits

Not ready to close the Spec review until D1 is reproduced/corrected and D2 is dispositioned with an actual generic-navigation action test. No broad source modifications or runs performed by this reviewer. This is source reasoning plus current regression inspection, not a claim of browser/native execution. Root's clean-checkout integration gates remain mandatory.

## Review correction handoff

D1 reproduced by root: `split-regression-before.log` received four panes instead of three. The authorized correction rechecks capacity immediately after the async preparation/current-operation check and before draft/membership creation; existing failed-creation cleanup disposes the rejected runtime. Root validation pending.

D2 has a separate inherited-defect issue (`issues/02-generic-navigation-target.md`) and a coordinator-authorized baseline regression extending the selector-only composition case to perform the actual open. No D2 production correction yet. Source changes for this review are limited to the D1 guard and these two existing-file regression changes; no builds/tests run here.

Applicable ADRs read: 0002 (canonical mutation seam) and 0007 (Editing Window boundary policy). No proposal to move persistence or finalization into pane/render ownership is made.

D1's regression passes after the bounded correction, as confirmed by root. D2's action regression failed on the prior source (active chat became editor and lost its conversation); root then authorized correction. Generic `openNotePath` now uses the existing navigation selector and activates that pane inside navigation admission. Explicit editor wikilinks/chat citations already activate their chosen editor; pane-local history and proposal presentation bypass the generic API with their private explicit operation. Existing departure/save/finalization/presentation behavior is unchanged. Source and tests frozen for root validation; no remaining unimplemented findings from this review, but D2 and combined integration checks are still pending.
