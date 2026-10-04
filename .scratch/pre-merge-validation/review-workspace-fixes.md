# Independent review of workspace corrections D1/D2

Reviewed frozen current `notepadWorkspaceSession.ts` and its regression test against the original candidate at `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-premerge-39n5lbfr`, using a direct unified file diff. Read issues 01/02, the coordinator's preserved failing logs, the current workspace membership/capability implementation, generic navigation contexts, pane-local wikilink and chat citation callers, departure/presentation code, and the real composition fixture. No source edits or test/build runs performed.

**Result: no production correctness or Standards blocker found in either correction.** Both stay inside the existing workspace owner and preserve its private admission, save/finalize, and editor lifecycle boundaries. One small test-oracle improvement is noted below.

## D1: concurrent split capacity

`notepadWorkspaceSession.ts:924–931` rechecks the current visible count after both asynchronous preparation operations and supersession validation. The capacity decision, fresh draft creation, and `completePaneCreation` are synchronous, so another split cannot interleave between the new check and membership insertion. This addresses the actual race rather than serializing unrelated work or introducing a second reservation owner.

On rejection, `created` remains false and the existing `finally` path at 956–963 sends the operation-correlated `creationFailed` transition and disposes that creating pane's runtime. The new check precedes draft creation, so it does not leave a new unreferenced document behind. Existing capacity-at-entry behavior and explicit pane commands are unchanged.

The test at `notepadWorkspaceSession.test.ts:339–355` uses the real WorkspaceStore and command owner, holds two preparation lookups, starts both splits from two visible panes, joins both completions, and requires exactly the configured three panes. The preserved baseline log demonstrates expected 3 versus actual 4. This is a meaningful concurrency oracle rather than an assertion of the new conditional's implementation. Runtime disposal itself is source-inspected, not independently asserted by this new case.

## D2: generic note destination

`notepadWorkspaceSession.ts:766–772` now resolves the target through `WorkspaceStore.getNavigationPaneId()` and activates that target within the existing navigation admission. This matches `docs/architecture/behavior-invariants.md` under “Chat context and note navigation agree with visible content”: generic navigation chooses the nearest editor, otherwise reuses the active retained-context pane.

The unchanged selector already implements active editor, nearest editor, and no-editor fallback. The unchanged `openDestination` still performs serialized departure, conflict admission, pending-save joining/saving, Editing Window finalization, snapshot adoption, and awaited editor presentation. No bypass of a save barrier or editor lifecycle was introduced. Activation also permits the existing active-pane-gated focus step after presentation.

Explicit destination behavior remains owned by its existing path:

- Location History and Previous pass their selected pane directly into private restoration, not the generic opener.
- Proposal presentation uses its selected pane and private destination operation.
- Pane-local wikilinks activate their invoking editor immediately before invoking the generic opener (`paneControllers.ts:101–105`).
- Chat citation handling selects and activates the nearest editor, or the invoking chat when no editor exists, before opening (`notepadChatPaneAdapter.ts:185–218`).

The strengthened test at `notepadWorkspaceSession.test.ts:246–268` executes the real generic command with a chat active beside an editor. It asserts the chat kind, retained conversation and document reference survive, while the existing editor adopts B. The coordinator's baseline log demonstrates the old command converted the chat to an editor and cleared its view conversation; the report correctly does not call this durable conversation loss. The wrong-target behavior predates the command rewrite, but conflicts with the documented invariant and was explicitly authorized for correction here.

## Small oracle improvement

The D2 test currently does not assert `workspace.activePaneId === second` after opening. Removing the new activation call would preserve the two asserted document outcomes while preventing the existing active-pane-gated editor focus step. Add that one assertion to the same test to protect the full intended correction; no new fixture or test case is necessary. This is a test completeness observation, not a claim that the current implementation is wrong.

## Validation limit

The coordinator owns positive reruns and integrated browser/native validation. The preserved logs establish both original failures; this review does not independently claim the corrected cases pass. Actual body/task reveal remains covered by the existing navigation/browser scenarios rather than this topology-focused composition case.
