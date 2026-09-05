# Frontend behavior-test usefulness audit

Scope: full current working tree, `src/**/*.test.ts`, excluding `architectureFitness.test.ts`, `contracts/*`, and `*.svelte.test.ts`. This assignment contains **103 files, 18,194 physical lines** at inventory capture. Existing edits were preserved. No production/test files were changed and no broad suite was run.

Standards: updated local code-review and TDD skills, architecture ownership/invariants, and behavior-oriented tests. Mocks and a large test count are not defects. Findings below are test-quality findings, not claims that the current production behavior is broken.

## Coverage and limits

Every assigned file received a purpose-level inspection of imports, test declarations, and sampled setup/assertion/end-of-file excerpts. **15 files were read in full**, **14 received additional focused fixture/scenario inspection**, and **74 were sampled only**; the inventory below identifies each. Parameterized cases are included in classification, but no unreliable source-regex test-count total is reported. This is a complete file inventory with risk-directed review, not a claim to have checked every assertion in all 18,194 lines. Candidate findings were checked against relevant production sources and surviving tests. Parent reviewer confirmed browser/native E2E does not exercise block movement followed by undo/caret restoration.

## Findings and disposition

### F1 — Strengthen block-move regression coverage through the actual action

Location: `src/lib/features/notepad/editor/blockMoveUndo.test.ts:67–71` (helper used by cases at 74 and 96).

`moveViaMinimalChange` manually builds the desired transaction from `minimalDocChange` and a chosen selection. Neither regression case invokes `moveCurrentBlock`, `moveBlockTo`, or the private publication helper used by those actions. Restoring a whole-document replacement inside production `blockTypes.ts:571–576` would leave these tests green: the test helper would still use the corrected algorithm. The tests therefore demonstrate a helper plus CodeMirror semantics, while claiming to guard the reported Option+Arrow block-move bug.

**Disposition:** retain the three focused `minimalDocChange` cases; replace the two synthetic movement scenarios with cases invoking a real block action against a mutable real CodeMirror state/history (and shared runtime if needed for the selection interaction). Assert resulting ordering plus undo/redo caret position. `editorDocumentRuntime.test.ts:92–108` is valuable general runtime undo coverage but does not call a block action. Parent found no E2E replacement coverage, so do not simply delete the two scenarios.

### F2 — Remove the aliasing test presented as refresh deduplication

Location: `src/lib/features/notepad/document/documentState.sequence.test.ts:368–385`.

The test creates `[shared, shared, shared]`, directly calls `applySessionSnapshotToDocument(shared, ...)` once, and then asserts that the array contains one unique object and every alias sees the change. The exact-once behavior is supplied by the test itself. It cannot fail if the real watcher refresh path begins refreshing once per pane.

**Disposition:** remove this individual case. Its meaningful snapshot/revision assertions already survive in `documentState.test.ts:270–291`; the actual refresh controller's deduplication survives in `notepadRefreshController.test.ts:95–116`, which enters `handleVaultNoteChanged` with two referencing panes and verifies one refresh. Keep the generated state-transition sequences: independent monotonicity/conflict invariants remain useful under mixed operations.

### F3 — Replace search timer callbacks with a functioning deterministic clock

Locations: `src/lib/features/notepad/search/store.test.ts:23–29`, `:70–101`, `:197–207`.

The timer fake remembers only the most recently supplied callback, always returns timer ID 1, and implements cancellation as an inert spy. The debounce test sends only one input; the cancellation test checks that `clearTimeout` was called without advancing queued work. The fixture cannot represent two outstanding timers or prove that the correct timer was cancelled. A broken implementation could issue one backend request per keystroke while these tests still appear to validate debouncing.

**Disposition:** strengthen the existing scenarios using Vitest fake timers: input a short burst, advance to the configured deadline, assert only the final query is sent; clear after scheduling and advance time to show no request/highlight publication occurs. Retain current-mode local-search and pinned/recent result tests. `related/store.test.ts` uses a similar callback fake, but its narrow promise is lazy Markdown reading rather than full debounce correctness; those two tests remain useful and need not be removed merely for using a fake.

### F4 — Check each settings section independently

Location: `src/lib/features/settings/refreshCoordinator.test.ts:27–34`.

The test calls both `vault` and `forgetting` before checking that each loader ran once. Swapping those two branches in `refreshCoordinator.ts:21–24`, or running both loaders for the first section and none for the second, would still pass. The asserted aggregate does not establish the advertised minimal per-section loader selection.

**Disposition:** strengthen as independent/table-driven section cases with fresh spies, one expected loader, and no nonselected loader calls. Retain search's specialized loader test and the distinct after-vault-change refresh scenario. No deletion prerequisite beyond preserving those separate behaviors.

### F5 — Consolidate duplicated task-adapter success coverage after retaining attribution checks

Locations: `src/lib/features/notepad/orchestration/notepadTaskMutationAdapter.test.ts:85–148` and `:150–275`.

The first scenario hand-implements document editing in its `replaceMarkdown` fake and asserts the adapter call chain. The following scenario already runs the real editing and persistence owners and verifies preparation → runtime update → save, preservation of local text, clean saved baseline, and idle operation state. Maintaining the fake editing protocol duplicates the stronger scenario. However, the first currently provides unique checks for `{ autosave: false }` and task attribution: the integrated fixture uses the same `saveNoteSession` spy for both editor and task save paths (`:193–197`), so it cannot distinguish them.

**Disposition:** consolidate, not delete immediately. Give the integrated test distinct editor/task save spies, retain the no-extra-autosave expectation through observable scheduling/save counts, and assert task save was selected while editor save was not. Then delete the fake-editing success case. Keep the separate referenced-document identity test and the task mutation conflict/stale-result suite.

## High-value coverage to retain

- `editorDocumentRuntime.test.ts`: real shared runtime plus CodeMirror transactions/history, independent pane selections, cross-pane undo, and properties-only restore undo reset.
- `historyModeSession.test.ts`: controlled publication/adoption promises, stale selections, truthful post-commit failures, retained workspace snapshots, and navigation-barrier integration. API substitutes leave the session/reducer coordination real.
- `persistenceController.test.ts`: newer local edits while a save is pending, authoritative committed-warning adoption, exact task attribution, unresolved conflicts, and prepublication failure.
- `documentConflictController.test.ts`: controlled stale editor results, partial fanout rollback, and newer conflict identity protection.
- `paneEditorLifecycle.test.ts`, `workspacePaneController.test.ts`, and `paneNavigationTransitionPipeline.test.ts`: ordering/call-count assertions express the actual serialization/teardown contract; they are not generic forwarding tests.
- `composerDraftPersistence.test.ts`, `atlasStore.test.ts`, and `chat/controller.test.ts`: delayed completion, cancellation, late response, retry, and ownership scenarios at real store/controller interfaces.
- `chat/api.test.ts` and `historyApi.test.ts`: keep explicit IPC command/payload assertions; TypeScript cannot verify the Rust command string or argument casing. These are useful adapter contracts even when the test uses an invoke spy. They do not independently prove backend security or durability.
- Real CodeMirror parser/transaction tests for Markdown, wikilinks, formatting, structural indentation, proposal hunk mapping, and enter handling. Their headless views intentionally omit DOM while retaining the behavior under test; browser coverage still owns layout/native input integration.

## Inventory

`Full` means whole file read; `Focused` means imports/test inventory and samples plus selected complete fixtures/scenarios; `Sample` means purpose-level sampling only. `Keep` means no concrete removal candidate found in the inspected coverage, not exhaustive proof of test completeness.

| Test file | Lines | Inspection | Purpose | Disposition |
| --- | ---: | --- | --- | --- |
| `src/lib/editorTextSize.test.ts` | 28 | Sample | uses current sizes for medium | Keep |
| `src/lib/features/atlas/atlasStore.test.ts` | 413 | Sample | maps zoom values to semantic focus tiers | Keep |
| `src/lib/features/chat/agentEvents.test.ts` | 293 | Sample | upserts tool lifecycle and ignores duplicate sequence numbers | Keep |
| `src/lib/features/chat/api.test.ts` | 598 | Focused | defaults automatic web access for settings from older vaults | Keep |
| `src/lib/features/chat/attachments.test.ts` | 116 | Sample | encodes supported image and text files for the IPC boundary | Keep |
| `src/lib/features/chat/chatConfiguration.test.ts` | 90 | Sample | selects only the backend-resolved model for each provider | Keep |
| `src/lib/features/chat/controller.test.ts` | 1085 | Focused | does not create a conversation before backend settings establish the draft model | Keep |
| `src/lib/features/chat/machines/contentOperationMachines.test.ts` | 126 | Sample | rejects stale initialization completion | Keep |
| `src/lib/features/chat/proposalVisibility.test.ts` | 57 | Sample | shows the review only in the conversation that owns the proposal | Keep |
| `src/lib/features/chat/ui/chatMarkdown.test.ts` | 157 | Sample | renders the safe note dialect | Keep |
| `src/lib/features/chat/ui/chatMessageScroll.test.ts` | 71 | Sample | places an ordinary conversation directly at the bottom | Keep |
| `src/lib/features/chat/ui/chatPanelHelpers.test.ts` | 82 | Sample | uses stable context keys for conversations and unsaved drafts | Keep |
| `src/lib/features/chat/ui/chatSelectionMarkdown.test.ts` | 52 | Sample | restores headings and nested inline formatting | Keep |
| `src/lib/features/chat/ui/composerDraftPersistence.test.ts` | 222 | Sample | restores the unsent text stored for a slot | Keep |
| `src/lib/features/history/historyApi.test.ts` | 136 | Full | requests a bounded page through the History Mode command seam | Keep |
| `src/lib/features/history/historyModeMachine.test.ts` | 263 | Sample | refuses entry when the autosave barrier fails | Keep |
| `src/lib/features/history/historyModeSession.test.ts` | 803 | Focused | crosses the save barrier before requesting role-limited history | Keep |
| `src/lib/features/history/historyTimeline.test.ts` | 114 | Sample | orders records newest first while retaining every revision inside its Editing Session | Keep |
| `src/lib/features/notepad/document/documentConflictController.test.ts` | 309 | Sample | keeps working content, resolves the conflict, then overwrites through normal save | Keep |
| `src/lib/features/notepad/document/documentEditingService.test.ts` | 162 | Sample | increments the operation revision once per actual markdown change | Keep |
| `src/lib/features/notepad/document/documentExternalSyncMachine.test.ts` | 163 | Sample | starts without a conflict | Keep |
| `src/lib/features/notepad/document/documentOperationMachine.test.ts` | 85 | Sample | rejects stale terminal results after supersession | Keep |
| `src/lib/features/notepad/document/documentPaneCoordinator.test.ts` | 207 | Sample | flushes only a pending cursor snapshot during pane teardown | Keep |
| `src/lib/features/notepad/document/documentRegistry.test.ts` | 53 | Full | preserves the canonical editor runtime when a draft receives a path key | Keep |
| `src/lib/features/notepad/document/documentRuntime.test.ts` | 66 | Full | keeps one running operation and only the latest pending operation | Keep |
| `src/lib/features/notepad/document/documentState.sequence.test.ts` | 387 | Focused | preserves state-machine invariants across every command triple | Remove one case F2; keep sequences |
| `src/lib/features/notepad/document/documentState.test.ts` | 293 | Focused | rejects stale failures without replacing a newer operation | Keep |
| `src/lib/features/notepad/editor/blockHandleExtension.test.ts` | 59 | Sample | spans single-line and multiline blocks without changing width | Keep |
| `src/lib/features/notepad/editor/blockMoveUndo.test.ts` | 112 | Full | trims shared prefix and suffix to a targeted middle change | Strengthen F1; keep helper cases |
| `src/lib/features/notepad/editor/editorCapabilities.test.ts` | 112 | Sample | replaces the selection in one undoable transaction and places the cursor after it | Keep |
| `src/lib/features/notepad/editor/editorDocumentRuntime.test.ts` | 234 | Full | broadcasts one pane edit while preserving independent pane selections | Keep |
| `src/lib/features/notepad/editor/editorLifecycleController.test.ts` | 325 | Focused | routes body edits to the live pane note after a save rekeys the draft | Keep |
| `src/lib/features/notepad/editor/editorMenuKeyboard.test.ts` | 43 | Sample | clamps hover indices to menu bounds | Keep |
| `src/lib/features/notepad/editor/editorViewState.test.ts` | 113 | Sample | round-trips the selection and scroll offset for a pane | Keep |
| `src/lib/features/notepad/editor/enterKey.test.ts` | 120 | Sample | inserts exactly one newline at the end of a plain text line | Keep |
| `src/lib/features/notepad/editor/indentConfig.test.ts` | 21 | Full | configures CodeMirror with the logical indent and visual tab width | Keep |
| `src/lib/features/notepad/editor/inlineFormatting.test.ts` | 178 | Focused | wraps plain selected text in bold markers | Keep |
| `src/lib/features/notepad/editor/passiveTableExtension.test.ts` | 105 | Sample | groups a header, delimiter, and any number of body rows | Keep |
| `src/lib/features/notepad/editor/searchHighlightExtension.test.ts` | 32 | Sample | detects partial and multiline-style selection overlap | Keep |
| `src/lib/features/notepad/editor/selectionSurround.test.ts` | 86 | Focused | wraps selected text with asterisks instead of replacing it | Keep |
| `src/lib/features/notepad/editor/structuralIndentation.test.ts` | 206 | Focused | moves an item and its complete descendant subtree | Keep |
| `src/lib/features/notepad/editor/undoSelection.test.ts` | 169 | Full | carries the pane selection into the forwarded root transaction | Keep |
| `src/lib/features/notepad/host.test.ts` | 171 | Full | returns a detached document snapshot for feature consumers | Keep |
| `src/lib/features/notepad/images/imageEmbedWidgets.test.ts` | 62 | Full | detects overlapping selection | Keep |
| `src/lib/features/notepad/interaction/navigationSelectionController.test.ts` | 177 | Sample | routes non-note search results to chat and clears search | Keep |
| `src/lib/features/notepad/interaction/titleInteractionController.test.ts` | 131 | Sample | activates the pane and dismisses its pane command on input | Keep |
| `src/lib/features/notepad/interaction/wikilinkInteractionController.test.ts` | 132 | Sample | lets pane commands take keyboard precedence | Keep |
| `src/lib/features/notepad/interaction/workspaceChoiceController.test.ts` | 113 | Sample | does not split below the supported viewport | Keep |
| `src/lib/features/notepad/markdown/inlineFormatSpec.test.ts` | 97 | Full | keeps the canonical format catalog explicit | Keep |
| `src/lib/features/notepad/markdown/markdown.test.ts` | 348 | Sample | rebuilds when background parsing publishes a more complete syntax tree | Keep |
| `src/lib/features/notepad/navigation/locationMru.test.ts` | 289 | Sample | touches move-to-front with dedupe and cap | Keep |
| `src/lib/features/notepad/orchestration/documentDepartureController.test.ts` | 98 | Sample | persists before saving the cursor against the authoritative document | Keep |
| `src/lib/features/notepad/orchestration/locationHistoryController.test.ts` | 204 | Sample | restores chat as the previous location in a single-pane workspace | Keep |
| `src/lib/features/notepad/orchestration/noteCommandController.test.ts` | 691 | Sample | allows different loaded documents to refresh simultaneously | Keep |
| `src/lib/features/notepad/orchestration/notepadChatPaneAdapter.test.ts` | 321 | Sample | opens proposal review only through the explicit review binding | Keep |
| `src/lib/features/notepad/orchestration/notepadRefreshController.test.ts` | 181 | Focused | ignores classified chat projection changes | Keep |
| `src/lib/features/notepad/orchestration/notepadTaskMutationAdapter.test.ts` | 276 | Focused | only resolves documents currently referenced by the workspace | Consolidate conditionally F5 |
| `src/lib/features/notepad/orchestration/paneCommandGroup.test.ts` | 44 | Full | activates a pane and refreshes derived views through the grouped seam | Keep |
| `src/lib/features/notepad/orchestration/paneNavigationTransitionPipeline.test.ts` | 185 | Sample | runs mutation phases in one deterministic order | Keep |
| `src/lib/features/notepad/orchestration/paneSessionController.test.ts` | 79 | Sample | chooses editor panes for navigation and cycles split panes | Keep |
| `src/lib/features/notepad/orchestration/persistenceController.test.ts` | 376 | Sample | schedules autosave through the note queue and clears clean buffers | Keep |
| `src/lib/features/notepad/orchestration/workspacePaneController.test.ts` | 308 | Sample | returns a policy-blocked close to ready | Keep |
| `src/lib/features/notepad/pane/paneEditorLifecycle.test.ts` | 257 | Sample | restores an exact captured view state through the serialized pane owner | Keep |
| `src/lib/features/notepad/pane/paneLifecycleMachine.test.ts` | 170 | Sample | uses the owning navigation operation for creation | Keep |
| `src/lib/features/notepad/pane/paneTransientUiController.test.ts` | 144 | Sample | publishes only the owner selected by the discriminated state | Keep |
| `src/lib/features/notepad/pane/paneTransientUiState.test.ts` | 69 | Full | Parameterized ownership/capability transition behavior | Keep |
| `src/lib/features/notepad/pane/paneViewModelFactory.test.ts` | 81 | Sample | surfaces an external conflict on the editor branch | Keep |
| `src/lib/features/notepad/paneCommandPicker.test.ts` | 65 | Sample | defines the shared split choices in their numbered order | Keep |
| `src/lib/features/notepad/related/store.test.ts` | 83 | Full | does not read current markdown while the panel is collapsed | Keep |
| `src/lib/features/notepad/search/currentNoteSearch.test.ts` | 59 | Sample | passes case and whole-word options to the search engine | Keep |
| `src/lib/features/notepad/search/draftRef.test.ts` | 72 | Sample | computeDraftHash is stable for identical input | Keep |
| `src/lib/features/notepad/search/search.test.ts` | 81 | Sample | does not send current markdown for recent note loading | Keep |
| `src/lib/features/notepad/search/searchReturnFocus.test.ts` | 126 | Sample | restores the editor selection captured before search moved it | Keep |
| `src/lib/features/notepad/search/store.test.ts` | 220 | Focused | exposes reactive search fields directly without requiring a $-store bridge | Strengthen F3 |
| `src/lib/features/notepad/session/paneOwnership.test.ts` | 239 | Sample | two panes can reference the same note key | Keep |
| `src/lib/features/notepad/ui/notepadCommandBarState.test.ts` | 290 | Sample | orders pinned notes before recent locations for empty search | Keep |
| `src/lib/features/notepad/wikilinks/state.test.ts` | 85 | Sample | does not send current markdown for note-only autocomplete | Keep |
| `src/lib/features/notepad/wikilinks/wikilinks.test.ts` | 208 | Sample | extracts a custom alias and its separator position | Keep |
| `src/lib/features/notepad/workspace/paneCapabilities.test.ts` | 197 | Sample | selects the nearest capable pane with stable pane-order ties | Keep |
| `src/lib/features/notepad/workspace/paneCapabilityWiring.test.ts` | 74 | Full | does not reintroduce direct live-pane kind permission checks | Architecture source guard; owner cross-review |
| `src/lib/features/notepad/workspace/paneRoles.test.ts` | 137 | Sample | keeps the active editor as the generic navigation target | Keep |
| `src/lib/features/notepad/workspace/paneTopActions.test.ts` | 42 | Sample | shows note actions in a solo pane | Keep |
| `src/lib/features/notepad/workspace/shortcuts.test.ts` | 107 | Sample | opens the thought partner in the current pane with Cmd+T | Keep |
| `src/lib/features/notepad/workspace/workspacePersistenceService.test.ts` | 103 | Sample | flushes every open document before crossing a navigation barrier | Keep |
| `src/lib/features/notepad/workspace/workspaceStore.sequence.test.ts` | 262 | Focused | preserves atomic invariants across every command triple | Keep |
| `src/lib/features/notepad/workspace/workspaceStore.test.ts` | 167 | Sample | keeps the split source pane distinct from its backing note | Keep |
| `src/lib/features/proposals/proposalOrchestration.test.ts` | 537 | Focused | passively installs a proposal in an existing editor without navigating or focusing | Keep |
| `src/lib/features/proposals/proposalReviewMachine.test.ts` | 201 | Sample | opens a prepared review | Keep |
| `src/lib/features/proposals/reviewExtension.test.ts` | 77 | Sample | tracks the complete edited proposed span for Restore Original | Keep |
| `src/lib/features/proposals/reviewSession.test.ts` | 102 | Sample | projects active proposal and hunk state from the workflow runtime | Keep |
| `src/lib/features/settings/excludedNotes.test.ts` | 49 | Sample | shows only exclusions and sorts them by title | Keep |
| `src/lib/features/settings/localModels.test.ts` | 37 | Sample | keeps the configured model available while discovery is offline | Keep |
| `src/lib/features/settings/refreshCoordinator.test.ts` | 45 | Full | loads semantic state for search visibility | Strengthen F4 |
| `src/lib/features/settings/semanticStatus.test.ts` | 47 | Sample | uses one label for each backend health state | Keep |
| `src/lib/features/settings/store.test.ts` | 425 | Sample | keeps component-passed actions bound to the settings store | Keep |
| `src/lib/features/tasks/openDocumentTaskMutation.test.ts` | 191 | Sample | uses the same lowercase SHA-256 contract as the backend | Keep |
| `src/lib/features/tasks/taskListStore.test.ts` | 129 | Sample | refreshes projection after applying a mutation to an open dirty document | Keep |
| `src/lib/keyboardShortcuts.test.ts` | 98 | Sample | uses Cmd+K on macOS and Ctrl+K elsewhere | Keep |
| `src/lib/noteNavigation.test.ts` | 31 | Sample | stores and consumes a pending note target once | Keep |
| `src/lib/ui/listSelection.test.ts` | 50 | Sample | wraps through selectable indexes | Keep |
| `src/lib/ui/modifierHints.test.ts` | 33 | Sample | reveals hints only after a deliberate modifier hold | Keep |
| `src/lib/ui/navigationCoordinator.test.ts` | 152 | Sample | drops a stale destination when a newer click arrives during a save | Keep |
| `src/lib/ui/search/searchMatch.test.ts` | 23 | Sample | matches case-insensitively by default | Keep |
