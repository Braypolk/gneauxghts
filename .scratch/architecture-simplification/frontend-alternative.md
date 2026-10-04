# Frontend alternative: retain editable review state with its document

Progress: Read-only design proposal; source unchanged. Coordinator review required before implementation.

## Recommendation

Replace two kinds of coordination, in that order: (1) the compatibility command graph with a concrete workspace command owner exposing named user operations, and (2) pane-owned proposal metadata with one document-owned review state. The second is this independent design's main distinction from the documents agent's aggregate design. It removes the need for a protocol, rather than giving that protocol a smaller constructor.

Do not build a universal event bus, generic `execute(event)` service, configurable pipeline, or one new factory that merely calls all existing factories. Keep `openNote`, `splitPane`, `closePane`, `showReview`, `keepHunk`, and `undoHunk` as meaningful operations. A large implementation is acceptable if the callers no longer coordinate its parts and the old mechanisms disappear.

Read sources: codebase-design SKILL.md, DEEPENING.md and DESIGN-IT-TWICE.md; ARCHITECTURE canonical ownership; behavior invariants for document lifetime, shared undo, pane navigation, proposal arrival/recovery, pending-review departure and committed adoption. Competing design coordinated directly with documents owner; no duplicate subagents spawned for an already parallel design exercise.

## Confirmed caller burden

1. `notepadCommandFacades.ts` mirrors WorkspaceStore methods in `NotepadWorkspaceCommands`, then `createNotepadWorkspaceCommands` forwards them with repeated casts between generic TPaneId and the actual NotepadPaneId. This is not an alternative runtime implementation: tests now use real WorkspaceStore composition. Removing this facade eliminates forwarding/types/casts instead of moving them.
2. `notepadCommands.ts:32` calls itself a compatibility facade. Its factories redistribute the same workspace, document, persistence, focus and history callbacks across location history, note commands, workspace pane commands and pane command controllers. The navigation pipeline request is a phase program assembled by each caller (`paneNavigationTransitionPipeline.ts:54`): guard, departure, history, prepare, mutate, ensure, complete, focus, stale/failure handling, and the `trackLatestForPane` escape for nested transitions. The invariant is real; exposing its implementation order to every command is the cost.
3. `ProposalReviewRuntime` in `proposals/types.ts:29` keeps a pane-scoped editor capability plus `hunkSnapshot`, `workingMarkdown`, and `suspendedMarkdown`. Its comments explicitly explain why the cached editor can later refer to another note and why a second fallback body must override a contaminated first fallback. This is evidence of a lifetime mismatch, not naming taste.
4. `reviewDisplay.ts:39` installs a separate StateField in every sibling editor. Each field maps hunk positions on a document transaction; orchestration then chooses a field and clones its state back into another snapshot (`proposalOrchestration.ts:147–244`). Keep resolves every editor independently. The body/undo already has one root EditorState in `editorDocumentRuntime.ts:92`; review coordinates do not share that lifetime.
5. Navigation compensates through `suspendDocument`, `restoreDocument`, `attachEditor`, `captureReview`, `installReviewInEditor`, `editorHasReviewInstalled`, and `liveReviewEditor`. Notepad wires leaving/opened/presented hooks at `Notepad.svelte:964`, plus `onEditorMounted` presentation at `:578`. Queued StateField notifications require review ID, live field ID and current editor checks before they can update fallback state. These checks protect reproduced bugs, but a document-owned field removes the pane-to-document mismatch that requires them.
6. `notepadProposalAdapter.ts` separately discovers panes, creates splits, resolves pane commands, changes kind, assigns documents, activates, ticks and ensures editors. Proposal “show this document” policy is reconstructed through approximately two dozen inputs; exposing one operation on the actual workspace owner is materially narrower.

## Alternative interface and ownership

The workspace owner accepts actual WorkspaceStore, actual NotepadState, existing document editing/persistence owners, and rendered/native boundaries. Internal helpers can remain separate functions, but their composition is private. No adapter copies in-process store methods.

Illustrative public usage (types/names are a design sketch, not a new framework):

```ts
await workspace.openNote({ noteId, path, paneId });
await workspace.closePane(paneId);
await workspace.splitPane({ from: paneId, kind: 'chat' });

// Passive arrival never creates/focuses/repurposes a pane.
await reviews.offer(request);

// Explicit user action owns the presentation and its destination.
await workspace.showReview(request.proposalId);
reviews.keepHunk(request.preview.reviewId, hunkId);
await reviews.keepAll();
```

The existing global ProposalReviewSession workflow remains the sole admission/commit/dismiss owner. It retains request, immutable DocumentHandle and operation state; it does not retain an EditorCapabilityAdapter or duplicate editable text/hunks. At most one active editable review remains globally. Durable queued proposals stay in ChatService and are not loaded into every document.

The active document's EditorDocumentRuntime owns review hunk positions/status alongside its root text/history. A review operation validates reviewId, resolves current hunk by ID, then applies one root transaction. Text edits from either pane map the metadata once. Pane extensions render the current root review snapshot and forward clicks by reviewId/hunkId; they do not independently map or resolve domain state. Old widgets therefore cannot mutate a newer review even if their DOM callback survives one render.

Keep the pure hunk mapping logic and the global workflow reducer; neither is a useless wrapper. Separate the existing review StateField's mapping from DOM widgets as necessary for a headless root, but file splitting alone is not the improvement. The improvement is eliminating independently mutable pane fields and their fallback/capture protocol. Read-only per-view rendering caches are allowed; they must never become another authoritative hunk state.

The exact root body captured when commit begins is passed to the existing durable request callback. DocumentEditingService remains responsible for committed adoption, warnings, later-edit preservation and external-readback conflict handling. No new persistence policy belongs in review or the renderer.

## Presentation as the remaining view boundary

The concrete workspace owner privately implements the existing review placement policy (including single chat workspace split and pane-limit behavior) once. It resolves/open-binds the document and awaits the actual pane lifecycle, including formatting and scroll restoration. The returned internal presentation token is tied to existing pane operation identity, document handle and mount generation.

Root review state supplies a hunk range; the presentation token can reveal that range only if its operation/document/mount is still current. Reuse existing operation identity rather than introduce a second ticket system. This replaces the proposal adapter's open/activate/reopen/get-editor choices and repeated `tick`/ensure calls. It also provides a future common destination for task/search/wiki/passage navigation, but do not migrate all navigation types at once or replace their distinct matching rules with one generic string matcher.

No arbitrary callback-phase request crosses the owner boundary. Existing transition serialization and stale checks become private implementation details of named actions. `openNote` called from an internal restore should not create a nested public transition requiring `trackLatestForPane: false`; the owner invokes private load/bind/present stages under the same operation.

## Crucial costs that must not be hidden

- **Lifetime pinning is required.** Current `noteStore.ts:278` removes a document once pane references disappear; DocumentRegistry disposal destroys the root. An active review must count as one explicit retained document reference until resolution/discard, independent of visible panes. Add this known owner to the concrete workspace lifetime policy; do not add a general-purpose lease/reference framework. Release it on every terminal path and workspace disposal. Without this, “move review to the root” merely loses the review when the last pane closes.
- **Root transaction admission must change deliberately.** `dispatchFromPane` currently selects docChanged transactions; `buildRootForwardSpec` forwards only changes, selection and selected history annotations. Review resolution is effect-only, and proposal edits need `proposalTransaction` semantics. A naive move of the current StateField into the root silently drops both. Use named root review operations and explicitly preserve their annotation/undo semantics; keep selection-only transactions pane-owned.
- **No-pane edits need a document notification owner.** Runtime markdown notification currently selects an attached controller. Review operations on a retained document with no editor must update the canonical working model exactly once through the existing editing boundary, or explicitly require presentation before editing. Prefer document-bound notification installed once when resources are created, with pane focus/viewport callbacks separate. This is a real ownership change, not an optional convenience.
- **Undo contract is separate from Keep/Undo hunk choice.** Root history survives pane remount; removing a proposal should not accidentally leave stale metadata in undo history or flush ordinary history without an explicit existing contract. Preserve current proposal transaction annotations and existing shared-undo outcomes during migration.
- **Global state remains reactive.** The session snapshot must observe the root review revision, without one subscription per pane or asynchronous pane callbacks. A single session-to-active-document subscription is sufficient and must be retired on replacement/terminal completion.
- **View readiness remains asynchronous.** Replacing constructors cannot remove the actual formatting/scroll wait that fixed the offscreen task regression. Presentation completion must mean current mounted editor and settled initial scroll, not merely that membership changed.

These are the cost/risk of the stronger design. They are reasons for a focused migration and test gate, not reasons to preserve four writable copies forever.

## Deletion contract

| Current mechanism | Replacement / deletion requirement |
| --- | --- |
| WorkspaceStore mirror interface and ID-casting facade | Concrete store consumed privately; delete mirror/forwarders. |
| Public per-command callback phase scripts | Named workspace operations; private shared departure serialization/stale checking. No public phase escape hatch. |
| ProposalReviewRuntime cached editor + three snapshots | DocumentHandle plus single document runtime review state. Remove all four fields, not retain compatibility copies. |
| Per-pane independently mapped review fields | Stateless/read-only render projection of root review state. No sibling loop for resolving hunk status. |
| Capture/suspend/restore/reattach protocol | Retained document root and ordinary pane attachment; delete those orchestration methods and Notepad's corresponding callbacks. |
| Proposal adapter pane creation/open/activation/reopen callbacks | One named workspace review presentation operation using real workspace state. |
| Test fake editor/runtime snapshot synchronization setup | Real document runtime with two panes and native/durable boundary doubles; replace old cross-copy unit tests once the same bug outcomes are proven. |

A review rewrite is unsuccessful if it merely moves `suspendedMarkdown`, `hunkSnapshot`, editor identity guards and reattachment helpers into a new class. A workspace rewrite is unsuccessful if its constructor still accepts the facade's getter/setter inventory or its public operations accept phase callbacks.

## Comparison with competing designs

| Design | Concrete benefit | Limitation / risk |
| --- | --- | --- |
| Leave current code, prune only tests | Already removed shallow test machinery without changing behavior. | Does not remove the repeated runtime synchronization that future changes must respect. |
| Documents agent: concrete named workspace aggregate | Deletes facade/type/callback redistribution and puts navigation ordering at one owner. Strong immediate reduction, lower semantic risk; real composition tests already exist. | Can still carry all proposal capture/restore logic internally unless document review ownership also changes. |
| This alternative: document-lifetime review state, concrete presentation boundary | Deletes writable duplicates, stale pane snapshot callbacks and navigation review hooks; review remount becomes normal document presentation. | Requires explicit root effects, document pinning and document-bound change notification; more demanding correctness gate. |
| Global event/store rewrite | Could express everything as events. | Would replace existing working reducers with a broad new protocol, make effects/order implicit, and offer no demonstrated reduction. Reject. |

Recommend the concrete command owner first, measured by deleted constructors/facades/callback contracts and unchanged composition outcomes. Then implement the document-lifetime review design only if the owner can delete the listed state/protocol outright. The alternatives combine at one narrow named presentation operation; they should not be layered as two competing workspace managers.

## Verification and migration gates

1. Keep current source as behavioral baseline and persist the approved ownership change/invariants before edits. Do not create a parallel production mode or flag to keep both owners alive.
2. Establish root review mapping/effect-only resolution and document lifetime pinning with real CodeMirror and existing document registry. Preserve ED01 sequential/same-length/interleaved transaction regression, untouched sibling scroll and exactly-once working-model notification.
3. Migrate one review end-to-end, then delete old pane state readers/installers and capture/suspend/restore callbacks in the same change. Keep existing global workflow tests where their states remain the domain contract.
4. Required retained scenarios: passive arrival in open editor without focus; closed target remains queued; explicit chat-only placement; last editor leaves and later remount restores exact body/hunks; unrelated note edits cannot contaminate review; same-document replacement review; two-pane edits/keep; modified-hunk coordinates; remount during commit; conflict retry/double-discard; commit warning and later-local-edit adoption; stale widget click; final pin release. Replace setup, not these outcomes.
5. Run actual offscreen task navigation and review workspace browser outcomes after presentation changes. Unit timing or dispatch counters do not prove visible destination geometry.
6. Report net production/test/helper delta against this phase's frozen snapshot, plus removed writable states, callback dependencies and constructors. No LOC quota; if root ownership adds more mandatory machinery than it deletes, stop and compare the concrete aggregate-only option rather than justify the design by terminology.

## Explicit behavior without a mounted editor

Recommended contract: once an active review has been admitted on a clean document, its editing operations depend on that retained document, not on a visible pane. A passive offer for an unopened target still stays queued; this does not admit every durable proposal into memory.

- Keep one/all resolves root hunk status, then captures the root Markdown once for commit when no unresolved hunks remain. No pane opens or receives focus merely to Keep. The session retains the document reference until durable completion and committed adoption finish; errors/conflict leave the root available for retry/copy.
- Undo All restores only pending proposed spans, in descending order, using the same root change batch and proposal annotation as the current implementation. Modified hunks remain unresolved for explicit Keep Current or Restore Original. A single-hunk Restore Original validates review ID, reads current bounds by hunk ID and checks expected text where required. No pane is needed to perform these source changes; this removes the current implementation's “Open the proposed note…” limitation rather than its protection against stale ranges.
- With every hunk undone, dismiss the durable proposal and release the review reference only after completion. Ordinary unsaved text left outside the proposal follows existing persistence policy; do not quietly save proposed content on navigation.
- Reload Disk still needs two explicit requests. After dismissal/reload succeeds, adopt disk content through the existing document boundary, clear root review metadata and release the review reference. On failure keep the working root and workflow error available; do not free the only copy or invent a retry write.
- Review Next and explicit Show Review are the only operations above that require presentation. Their returned current destination reveals the root hunk range after the awaited editor lifecycle.

This is an intentional relaxation of a view-availability implementation restriction, not a change to durable commit/dismiss policy. If strict current UI behavior is required, Show Review can precede Undo at the caller; do not reintroduce pane-owned review data to enforce it.

## Root transaction rules

1. Normal user document edits are admitted into the root exactly once with the existing start-state/selection/history semantics. The root maps active review coordinates for that same transaction, then publishes document changes and one immutable review projection to attached panes. A view projection never maps those positions again.
2. Proposal-origin changes retain `proposalTransaction` on the root so restoring/applying a hunk is not classified as user modification. Do not indiscriminately forward every CodeMirror annotation; explicitly preserve the existing history annotations and this named domain annotation.
3. Keep/status resolution can be effect-only. Root review revision and pane decorations/session snapshot must change, while document revision, markdown callbacks and text undo history remain unchanged. Conversely, replacing proposed text and resolving its status should be one coherent root operation, not a pane edit followed by N sibling status changes.
4. A root review operation that changes text with no attached pane must update NoteDraftState through the document editing owner once. Establish a document-bound change sink at resource composition, or one explicit root-review operation completion into that owner; do not retain the current arbitrary-pane callback as the only notification route. Whichever implementation is chosen must have a single caller, not both competing routes.
5. Proposal replacement and Version Restore must explicitly initialize/clear root metadata in the same operation that replaces the relevant document state. Closing/remounting a pane must not clear/reinitialize it. Preserve independent viewport/selection during broadcasts.

## Parallel implementation boundary

Documents owner owns Notepad.svelte and workspace command migration. Review owner can own `features/proposals/*`, EditorDocumentRuntime and the proposal-renderer/capability integration. Shared lifecycle retention belongs to the document/workspace owner and must be agreed before implementation:

- Workspace lifetime recognizes the global active-review DocumentHandle as a retained reference before deleting a note or disposing its document runtime.
- Notepad's `onDocumentLeaving -> suspendDocument`, `onDocumentOpened -> restoreDocument`, `onDocumentPresented -> attachEditor`, and editor-mounted proposal attachment disappear after renderer attachment reads the document root. Pending durable proposal discovery remains a separate arrival concern and may still run on document presentation; do not delete that discovery with the synchronization hook.
- The review service requests one named show-review/document-presentation action and consumes its current destination; it does not construct split/kind/activation steps.
- Document-bound text notification wiring is changed once by its owner. Both work streams must preserve existing persistence/autosave suppression and use DocumentEditingService for adoption.

The review rewrite must not independently edit the top-level composition while the workspace rewrite is doing so. A small shared integration patch with explicit ownership is safer than introducing compatibility hooks that preserve the deleted protocol.
