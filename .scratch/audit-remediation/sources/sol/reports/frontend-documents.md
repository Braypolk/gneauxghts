# Frontend document, workspace, navigation, History Mode, and proposal audit

Status: needs-triage

Audit boundary: source inspection of 55 test files (12,206 lines), their target modules and composition callers. No production/test changes and no heavyweight suite runs were made by this reviewer. Suite timing is being measured centrally; performance opportunities below are structural, not claimed benchmark results. Findings use the current stable-handle/adoption/departure architecture, not the older architecture that these modules replaced.

## Module grouping and coverage judgment

| Module | Test files / lines | Coverage judgment |
| --- | ---: | --- |
| Document state, operations, external synchronization, editing, registry | 10 / 2,163 | Strong late-result, saved-baseline, tag-conflict, identity, and runtime coverage. An exception path in conflict application is missing. Reducer-only behaviors repeat across state and exhaustive sequence tests. |
| Note store + shared pane ownership | 2 / 625 | Valuable real Svelte proxy identity and canonical alias/collision tests. Keep them; they protect distinct contracts rather than simply repeating saves. |
| Orchestration/controllers | 14 / 3,785 | Good explicit queue/departure/adoption tests, but large dependency literals cast away type safety. The actual command-composition factory is untested, and Forget/Recovery commands lack focused behavior coverage. |
| Workspace policy/store/motion/shortcuts | 9 / 1,143 | Clear small behavior tests. Exhaustive command triples have an unsound success/rejection oracle. Source-regexp tests are weaker than behavioral permission tests. |
| Pane lifecycle/transient/view models | 5 / 779 | Good disposal concurrency tests; transient controller has literal duplicated assertions. View-model branch coverage is limited to one editor conflict case. |
| Location MRU + selection interactions | 5 / 821 | MRU contract is well exercised. Interaction tests generally verify routing into mocks, leaving actual post-open targeting untested. |
| History Mode | 6 / 1,900 | Strong request identity, restore publication/adoption separation, independent citation target, bounded anchored paging, and workspace-return tests. Rendering tests are SSR only; confirmation and callback wiring are not exercised there. |
| Proposal review | 4 / 990 | Reducer and actual CodeMirror hunk mapping tests are useful. The orchestration fake reimplements hunk state and hardcodes the original preview, so newer-preview and restoration tests cannot verify real extension behavior. |

## Prioritized findings

### FD-01 — P1: thrown editor replacement can strand an external conflict

- Locations: `src/lib/features/notepad/document/documentConflictController.ts:63`, `:86`, `:99`, `:122`; `src/lib/features/notepad/pane/paneEditorLifecycle.ts:97` and `:317`; `src/lib/features/notepad/document/documentConflictController.test.ts:173`.
- Evidence: Load Disk dispatches `beginApplyingExternal`, then awaits editor replacement without an exception handler. Its resolved `stale`/`disposed`/`unavailable` branches correctly dispatch `externalApplyFailed`, but a rejection skips that dispatch. Both Load Disk and Keep My Edits admit only `awaitingChoice`, so the rejected operation leaves both choices unavailable. The real serialized pane owner propagates failed effects; rejection is possible, not merely an exotic fake result. The rollback awaits can fail similarly.
- Recommendation: put the application and any rollback effects behind a correlated failure boundary. On an exception, return the still-current conflict to `awaitingChoice`, preserving the original diagnostic; never clear or overwrite a newer conflict. Decide whether the public operation rejects or returns an explicit failure consistently with the UI caller.
- Preserve: retained external snapshot, local Markdown, identity, baseline, conflict sequence, synchronous cross-pane fanout and protection from obsolete completions.
- Migration/tests: first add rejection at initial replacement and rejection during rollback; assert a subsequent Load/Keep is possible. Add a newer-conflict-arrives-before-rejection case. Then repair the controller. No module rewrite required.
- Confidence: high, direct control-flow evidence. This audit did not run the reproduction.

### FD-02 — P2: Recent Task navigation opens the target then checks the previous note's identity

- Locations: `src/lib/features/notepad/interaction/navigationSelectionController.ts:116`; `src/lib/features/notepad/navigation/openFlow.ts:90`, `:144`; `src/lib/features/notepad/Notepad.svelte:461`; `src/lib/features/notepad/interaction/navigationSelectionController.test.ts:45`.
- Evidence: `handleRecentTaskSelect` obtains a `NavigationContext` before `openRecentTask` opens another note. The real Notepad factory returns concrete `currentNoteId` and `currentNotePath` values, not live getters. After opening, `openRecentTask` calls `navigateToPendingTaskTarget` with that old snapshot; the identity guard immediately returns when task and previous note differ. Searching all frontend tests found no direct openFlow/navigation tests; interaction/search tests replace `openRecentTask` with a spy.
- Recommendation: obtain a pane-bound context after opening has completed. Bind it to the navigation operation/document so a superseding transition cannot focus another note. This also gives section/link navigation a coherent post-open target seam rather than passing a pre-open DOM/model snapshot across an asynchronous open.
- Preserve: same-note targeting, semantic-only results that scroll without stealing focus, remembered title-only note positions, pending-task identity protection, current-search cursor previews.
- Migration/tests: real openFlow test from note A to a task in note B, same-note task, rejected save/open, and superseding note C while paint is pending. Stub only paint/DOM focus, not the openFlow function itself. Exercise section/link call sites before changing that shared interface.
- Confidence: high for cross-note task focus omission; medium for broader section/link problems, which depend on DOM reuse.

### FD-03 — P2: generated workspace sequences accept broken valid commands; both triple suites repeat shallow paths

- Locations: `src/lib/features/notepad/workspace/workspaceStore.sequence.test.ts:181`, `:199`; `src/lib/features/notepad/workspace/workspaceStoreTestSupport.ts:7`; `src/lib/features/notepad/document/documentState.sequence.test.ts:235`; associated `.test.ts` and machine test files.
- Evidence: workspace generator catches *every* command exception and accepts it whenever state is unchanged. It never says which command should succeed in the current model state. An add/activate command that unexpectedly throws can therefore pass much of the generator. `rejectedCommands > 0` does not repair this oracle. Its 20 commands generate 8,000 triples / 24,000 attempted commands; document generator's 12 commands generate 1,728 triples / 5,184 transitions. Prefixes are repeatedly reconstructed, many document commands are guarded no-ops, and most assertions concern monotonic counters/shape rather than expected outcomes. Three-step paths cannot cover a complete multi-effect close/dispose/reopen or realistic late-save/adopt/conflict sequence. This is not evidence that generated testing itself is inappropriate.
- Recommendation: keep explicit outcome tests; replace the workspace generator with a small independent reference model that declares success/rejection/no-op per command, checks result and next state, and exercises longer sequences with reproducible seeds and shrinking or carefully bounded transition exploration. For pure reducer checks, centralize comprehensive transition tables and keep a few integration sequences through the document API; do not repeat every pure reducer assertion at three layers.
- Preserve: atomic failure, nonempty workspace, active-pane adjacency, retained retiring records, shared document references, stale operation and conflict identities, monotonic counters.
- Migration/tests: prove oracle quality with a controlled mutation that forces a valid add or activate to throw; the replacement test must fail. Keep explicit close/disposal and stale-completion examples during migration; compare transitions/outcomes covered, not raw test count. Root timing baseline should determine runtime improvement.
- Confidence: high for the oracle defect and combinatorial work count; medium for net timing savings until measured.

### FD-04 — P2: proposal orchestration fake hardcodes the initial preview and bypasses real mapping

- Locations: `src/lib/features/proposals/proposalOrchestration.test.ts:59`, `:87`, `:92`, `:93`, `:461`; `src/lib/features/proposals/proposalOrchestration.ts:121`, `:145`, `:309`; `reviewExtension.test.ts`.
- Evidence: fake `setProposalReviewExtensions` ignores the supplied extension and builds state from the module-level original `preview.reviewId` and `preview.hunks`. The newer-preview test passes a review-2/hunk-2 request but checks only resulting Markdown and active proposal ID; the fake still reads review-1/hunk-1. It also does not run extension state-change callbacks or real CodeMirror range mapping. Real-extension tests cover three isolated single-hunk cases, not the orchestration/remount/sibling workflow tested with this fake.
- Recommendation: replace the reimplemented state engine with a lightweight capability adapter around a real CodeMirror `EditorState` and the installed review extension; no mounted EditorView is needed for most transactions. Retain spies for actual external effects (open, commit, dismiss, focus).
- Preserve: one global editable review, passive proposal arrival, suspended working text/hunk choices, replacement restrictions during resolution, confirmed reload, durable commit convergence.
- Migration/tests: newer preview must expose review-2/hunk-2, no automatic commit while pending, multi-hunk Keep/Undo with a user-modified hunk, remount restoring mapped ranges, and sibling synchronization. Keep reducer tests as the pure workflow oracle rather than duplicating them all in orchestration.
- Confidence: high for fake mismatch; medium for exact adapter implementation cost.

### FD-05 — P2: add a narrow real composition harness before reorganizing command modules

- Locations: `src/lib/features/notepad/orchestration/notepadCommands.ts:37`; `noteCommandController.test.ts:121`, `:185`, `:269`, `:371`, `:467`, `:545`, `:605`, `:721`; `workspacePaneController.test.ts:191`; `paneCommandController.test.ts:30`.
- Evidence: all tests call individual factories; search found no invocation of `createNotepadCommands` in tests. `noteCommandController.test.ts` has 742 lines for eight scenarios with repeated large partial dependency objects cast `as never`. Several of those tests reimplement baseline adoption or workspace reference updates instead of crossing the real owner. Direct `clearNotepad`/`unforgetNotepad` behavior tests were not found. The composition factory wires the same departure queue across nested location/open/kind transitions, so local factory coverage cannot verify wiring/ownership. Existing nested-departure tests are valuable and should remain.
- Recommendation: create one typed local test harness using real WorkspaceStore, NotepadState, editing/adoption service, persistence, command factory and departure pipeline, with only IPC, rendered editor effects, motion and focus faked. Add selected end-to-end controller scenarios through that public seam. Reuse document/committed-session/deferred fixture builders in this cluster; avoid introducing a repository-wide universal harness.
- Preserve: ownership split; queue release before nested completion; last-editor finalization; save-before-cursor/history order; collision recovery; direct chat creation; passive proposal arrival.
- Migration/tests: shared-document open + last close, failed nested restore + retry, Forget + transient/durable Forgotten-Note Recovery, save rename + MRU capture, and a pending review across navigation. Replace redundant routing/setup-heavy examples only after those invariants are covered. Keep pure reducers and reactivity identity tests independent.
- Confidence: high for missing command factory tests and unsafe setup casts. Broad deletion should wait for the new harness and baseline.

### FD-06 — P3: consolidate identical document adoption bodies behind a private implementation

- Locations: `src/lib/features/notepad/document/documentState.ts:385` and `:422`; callers in `state/noteStore.ts:335` and `:375`, editing service, and workspace persistence tests.
- Evidence: `applySessionSnapshotToDocument` and `applyCommittedNoteToDocument` each convert their DTO to an ExternalDocumentSnapshot, compute the same preservation/change predicates, replace identity/baseline/warning, apply tags/content, advance revision and clear external synchronization. Their logic is essentially copied. Future tag policy changes must be made twice. Operation-specific DocumentEditingService adoption methods, by contrast, choose meaningfully different undo and autosave policies and should not be flattened.
- Recommendation: one private apply-normalized-snapshot function; retain the public DTO entry points and their warning extraction. Do not add another public generic adoption policy to callers.
- Preserve: preserveWorking/preserveTags defaults and explicit overrides, tag diagnostic refresh, identity and baseline independence, exactly one revision advance per real authored change, boundaryApplied conflict sequence.
- Migration/tests: table-driven contract cases against both DTO adapters for clean, dirty body/title/tags, removal, diagnostics-only, identity-only and warning adoption; retain integration tests for each operation-specific runtime policy. This can remove duplicated implementation without a cross-module rewrite.
- Confidence: high.

### FD-07 — P3: remove actual duplicate and disconnected assertions

- Locations: `src/lib/features/notepad/pane/paneTransientUiController.test.ts:72`, `:76`, `:94`, `:98`, `:110`, `:114`; `src/lib/features/notepad/document/documentEditingService.test.ts:28`, `:48`, `:212`.
- Evidence: three transient owner assertions occur twice back-to-back with no intervening action. Editing-service harness creates and returns `replaceNoteAcrossPanes` but never injects it into the service; unopened Version Restore asserts that disconnected spy was not called. That assertion cannot detect a production regression.
- Recommendation: remove duplicated assertions; remove disconnected spy and replace its test assertion with unchanged document store/registry plus `notOpen` outcome. Add owner-exclusive effect assertions where useful, rather than repeating `active` state.
- Preserve: real owner transition checks and notOpen successful Version Restore semantics.
- Migration/tests: existing targeted suites; no new test needed for literal duplicate removal. A notOpen store/registry assertion should fail if an unopened target begins allocating runtime resources.
- Confidence: high. These are narrow safe cleanup candidates after global audit review.

### FD-08 — P3: expose/await real completion instead of polling predictable microtask work

- Locations: `src/lib/features/proposals/proposalOrchestration.test.ts:496` through `:604`; `src/lib/features/proposals/proposalOrchestration.ts:254`, `:280`, `:536`; `src/lib/features/notepad/orchestration/notepadSessionLifecycle.test.ts:29`; `src/lib/features/history/historyModeSession.test.ts:127`, `:905`.
- Evidence: proposal orchestration Keep/Undo/Retry start `void finishIfResolved()`; tests consequently use repeated `vi.waitFor` for local Promise chains. Session mount tests flush exactly 15 microtasks via `settle()`, coupling tests to implementation await count. Pane lifecycle tests already demonstrate explicit entered/release barriers; that is a better pattern for races. Polling remains reasonable for real reactive/rendered effects, so this is not a blanket waitFor prohibition.
- Recommendation: let proposal commands return/join their pending resolution completion (UI may intentionally discard it), or expose one lifecycle completion seam needed by real callers. Use test-controlled entered/release promises for async dependency boundaries; replace fixed microtask counts with observed completion. Do not add sleep delays or test-only public wait methods just to optimize tests.
- Preserve: single admitted proposal resolution, commit/dismiss exclusion, failure recovery and no accidental await deadlock. Must exercise multi-hunk automatic resolution before changing command return types.
- Migration/tests: rewrite one representative test per flow, then compare suite timing to root baseline. Preserve tests that explicitly hold a pending IPC or pane effect to assert non-navigation before release.
- Confidence: high for brittleness; medium for measured performance benefit and API choice.

### FD-09 — P3: move source-shape guards into architectural linting with semantic checks

- Locations: `src/lib/features/notepad/workspace/paneCapabilityWiring.test.ts:14`, `:39`, `:53`; overlap with `src/lib/architectureFitness.test.ts:172` onward.
- Evidence: regexp detects only immediate `getPaneKind(...) ===/!== literal` syntax; an assigned local variable or reversed comparison bypasses it. String checks reject names anywhere, including harmless comments. Another test prohibits literal `.ui.isEditorReady`, rather than proving document binding continues while presentation is pending; noteCommandController already tests the real behavior. These are useful architectural intent but weak independent behavior verification.
- Recommendation: consolidate this cluster's static architectural checks under the existing fitness tooling; use AST/import/call-owner checks where ownership matters. Preserve a few real capability/binding behavior tests, remove redundant source-string probes after equivalent semantic guard is established.
- Preserve: canonical capability policy, no presentation-readiness gate for document binding, workspace transition policy separated from pane-role selection.
- Migration/tests: demonstrate equivalent forbidden forms are detected and harmless comments are ignored. Coordinate with owner of architectureFitness audit; avoid overlapping edits.
- Confidence: high; this report does not own the repository-wide fitness rewrite.

### FD-10 — P2 review candidate: location restoration has one global suppression boolean

- Locations: `src/lib/features/notepad/orchestration/locationHistoryController.ts:76`, `:234`, `:328`; `locationHistoryController.test.ts:233`; `paneNavigationTransitionPipeline.test.ts:152`.
- Evidence: every restore sets shared `suppressLocationTouch = true`, then resets it to false in its own finally block. The pipeline permits asynchronous work on different panes, while composite restore is intentionally not latest-operation tracked. With two concurrent restores, the first finally resets suppression while the other restore is still running. Existing tests verify one failure resets it, not overlapping ownership.
- Recommendation: add a controlled overlapping restoration test before choosing scope. If suppression is intentionally workspace-wide, use a nesting/lease count; if it applies only to one pane's historical transition, represent pane/operation ownership explicitly. Do not change the global MRU policy speculatively.
- Preserve: restoring history does not recursively add synthetic locations; nested open/kind leaves can acquire departure ownership; failures recover and genuine user navigation still gets recorded.
- Migration/tests: two pane restorations blocked at different effects; release one, ensure remaining restore stays suppressed, then release/fail the other and ensure normal touching returns. Also test nested same-pane restoration only if actually supported by public commands.
- Confidence: high for overlapping boolean lifecycle; medium for user-reachable impact and intended scope. Treat as investigation, not confirmed lost-history bug.

### FD-11 — P2 review candidate: History Mode SSR tests leave the user confirmation seam untested

- Locations: `src/lib/features/history/HistoryMode.svelte.test.ts:95`; `HistoryMode.svelte:121`, `:260`, `:329`, `:339`; `HistoryDiff.svelte.test.ts:43`.
- Evidence: all local component tests use `svelte/server` rendering and assert text/attributes. They cannot click Clear/Confirm/Cancel, change comparison, invoke Escape, or verify disabled controls during restore commit. HistoryModeSession tests validate the underlying operations but bypass these handlers. Existing native history tests provide broader real-history acceptance; they are not grounds to duplicate every session scenario in DOM tests.
- Recommendation: retain SSR assertions for read-only historical content and disclosure rendering; add a small mounted component test group for clear confirmation, cancel, callback identity, comparison routing, and restore-busy exit blocking. Collapse the duplicate openState SSR rendering in the first two cases. Test changing selected revision while a revision-name editor is open if that state is retained across updates.
- Preserve: explicit destructive-action confirmation, complete authored restore preview, role-limited history reads, immutable selected revision, read-only overlay and restored workspace state.
- Migration/tests: a handful of event-driven component cases at the actual confirmation boundary; reuse session/model tests for asynchronous correctness and native cases for filesystem durability. No broad History Mode rewrite recommended.
- Confidence: high for local coverage gap; cross-layer redundancy should be confirmed with the E2E owner.

## Larger rewrite candidates and rejected deletions

The largest justified restructuring is FD-05: deepen the command composition seam and keep controller implementation details private to it, after establishing a faithful typed integration harness. Today callers/test authors must understand a very large dependency object and wire three layers correctly. Replacing every small controller with another facade would add complexity; any rewrite should reduce this caller burden and remove duplicated setup, not merely rename files. Two activation/focus phase blocks in `workspacePaneController.ts:145` and `:629` can share a private helper while retaining split-at-capacity behavior.

Keep DocumentRegistry/DocumentRuntime: they own lazy shared resources, timers and the latest-pending save drain, not merely forwarding aliases. Keep DocumentEditingService's operation-specific adoption methods: Version Restore resets undo even for properties-only changes; clean external refresh, pending saves and accepted proposals choose different preservation/autosave policies. Keep WorkspaceStore versus NotepadState ownership: alias collisions, Svelte proxy identity, shared handles and pane retirement make this division valuable. Keep HistoryModeSession versus pure historyModeMachine: async request identity and restoration barriers are real effects. Keep proposalReviewMachine versus reviewSession: the latter owns raw runtime reactivity and derived projections. Do not deduplicate tests across these seams solely because they share terms such as save, stale, or restore.

The comprehensive HistoryModeSession suite is long because it covers materially different citation and post-commit failures. Splitting it into entry/return, browsing/citation, and restore/label cases sharing typed fixtures would improve navigation, but line count alone is not a reason to remove coverage or rewrite the state machine.

## Suggested implementation order

1. Root completes all module audits and cross-checks overlap.
2. FD-01 regression/fix, FD-02 regression/fix, FD-07 literal cleanup.
3. Strengthen generated-test oracle (FD-03) and faithful proposal fixture (FD-04).
4. Build typed command composition harness and lifecycle coverage (FD-05), then trim duplicative setup/routing tests.
5. Private adoption consolidation (FD-06), measured async-test improvements (FD-08).
6. Investigate overlapping restoration suppression (FD-10), mounted history confirmation tests (FD-11); coordinate fitness consolidation (FD-09).

## Overlap exclusions and validation limitations

Editor internals, image behavior and assets, tasks' own mutation algorithm, chat controller/model APIs, app/settings/bootstrap admission, contracts/Rust timeline durability, E2E execution/performance and repository-wide architecture fitness are audited by other owners. This report traces their adapters/callers only where needed to understand the owned seams. Native tests were searched for coverage overlap, not executed or fully audited here. No benchmark conclusion is inferred from source size. All priorities above are review proposals; only direct control-flow problems are called confirmed evidence, and FD-10 explicitly requires a focused experiment.

## Reviewed-file inventory

The following inventory records every in-scope test file and target file, plus composition/reference files consulted. Tests were reviewed for scenario inventory, setup/teardown, effects/assertions, oracle quality, and target behavior; repeated broad files were also inspected through focused source/line extracts. No coverage-tool percentage was available in this audit.

### src/lib/features/notepad/document

- `src/lib/features/notepad/document/documentConflictController.test.ts` — test; 311 lines
- `src/lib/features/notepad/document/documentConflictController.ts` — target/support
- `src/lib/features/notepad/document/documentEditingService.test.ts` — test; 498 lines
- `src/lib/features/notepad/document/documentEditingService.ts` — target/support
- `src/lib/features/notepad/document/documentExternalSyncMachine.test.ts` — test; 163 lines
- `src/lib/features/notepad/document/documentExternalSyncMachine.ts` — target/support
- `src/lib/features/notepad/document/documentExternalSyncTestSupport.ts` — target/support
- `src/lib/features/notepad/document/documentOperationMachine.test.ts` — test; 105 lines
- `src/lib/features/notepad/document/documentOperationMachine.ts` — target/support
- `src/lib/features/notepad/document/documentPaneCoordinator.test.ts` — test; 203 lines
- `src/lib/features/notepad/document/documentPaneCoordinator.ts` — target/support
- `src/lib/features/notepad/document/documentRegistry.test.ts` — test; 27 lines
- `src/lib/features/notepad/document/documentRegistry.ts` — target/support
- `src/lib/features/notepad/document/documentRuntime.test.ts` — test; 60 lines
- `src/lib/features/notepad/document/documentRuntime.ts` — target/support
- `src/lib/features/notepad/document/documentState.sequence.test.ts` — test; 366 lines
- `src/lib/features/notepad/document/documentState.test.ts` — test; 293 lines
- `src/lib/features/notepad/document/documentState.ts` — target/support
- `src/lib/features/notepad/document/documentTagConflicts.test.ts` — test; 137 lines

### src/lib/features/notepad/state

- `src/lib/features/notepad/state/noteState.svelte.ts` — target/support
- `src/lib/features/notepad/state/noteStore.svelte.test.ts` — test; 398 lines
- `src/lib/features/notepad/state/noteStore.ts` — target/support
- `src/lib/features/notepad/state/noteStoreReactiveFixture.svelte.ts` — target/support

### src/lib/features/notepad/session

- `src/lib/features/notepad/session/bootstrap.ts` — target/support
- `src/lib/features/notepad/session/noteRuntime.ts` — target/support
- `src/lib/features/notepad/session/paneOwnership.test.ts` — test; 227 lines
- `src/lib/features/notepad/session/runtimeStore.svelte.ts` — target/support
- `src/lib/features/notepad/session/session.ts` — target/support

### src/lib/features/notepad/orchestration

- `src/lib/features/notepad/orchestration/documentDepartureController.test.ts` — test; 263 lines
- `src/lib/features/notepad/orchestration/documentDepartureController.ts` — target/support
- `src/lib/features/notepad/orchestration/locationHistoryController.test.ts` — test; 271 lines
- `src/lib/features/notepad/orchestration/locationHistoryController.ts` — target/support
- `src/lib/features/notepad/orchestration/noteCommandController.test.ts` — test; 742 lines
- `src/lib/features/notepad/orchestration/noteCommandController.ts` — target/support
- `src/lib/features/notepad/orchestration/notepadChatCoordinator.svelte.test.ts` — test; 102 lines
- `src/lib/features/notepad/orchestration/notepadChatCoordinator.svelte.ts` — target/support
- `src/lib/features/notepad/orchestration/notepadChatPaneAdapter.test.ts` — test; 393 lines
- `src/lib/features/notepad/orchestration/notepadChatPaneAdapter.ts` — target/support
- `src/lib/features/notepad/orchestration/notepadCommandFacades.ts` — target/support
- `src/lib/features/notepad/orchestration/notepadCommands.ts` — target/support
- `src/lib/features/notepad/orchestration/notepadProposalAdapter.ts` — target/support
- `src/lib/features/notepad/orchestration/notepadRefreshController.test.ts` — test; 202 lines
- `src/lib/features/notepad/orchestration/notepadRefreshController.ts` — target/support
- `src/lib/features/notepad/orchestration/notepadSessionLifecycle.test.ts` — test; 86 lines
- `src/lib/features/notepad/orchestration/notepadSessionLifecycle.ts` — target/support
- `src/lib/features/notepad/orchestration/notepadTaskMutationAdapter.test.ts` — test; 224 lines
- `src/lib/features/notepad/orchestration/notepadTaskMutationAdapter.ts` — target/support
- `src/lib/features/notepad/orchestration/paneCommandController.test.ts` — test; 64 lines
- `src/lib/features/notepad/orchestration/paneCommandController.ts` — target/support
- `src/lib/features/notepad/orchestration/paneCommandGroup.test.ts` — test; 44 lines
- `src/lib/features/notepad/orchestration/paneCommandGroup.ts` — target/support
- `src/lib/features/notepad/orchestration/paneNavigationTransitionPipeline.test.ts` — test; 232 lines
- `src/lib/features/notepad/orchestration/paneNavigationTransitionPipeline.ts` — target/support
- `src/lib/features/notepad/orchestration/paneSessionController.test.ts` — test; 79 lines
- `src/lib/features/notepad/orchestration/paneSessionController.ts` — target/support
- `src/lib/features/notepad/orchestration/persistenceController.test.ts` — test; 624 lines
- `src/lib/features/notepad/orchestration/persistenceController.ts` — target/support
- `src/lib/features/notepad/orchestration/workspacePaneController.test.ts` — test; 459 lines
- `src/lib/features/notepad/orchestration/workspacePaneController.ts` — target/support

### src/lib/features/notepad/workspace

- `src/lib/features/notepad/workspace/paneCapabilities.test.ts` — test; 197 lines
- `src/lib/features/notepad/workspace/paneCapabilities.ts` — target/support
- `src/lib/features/notepad/workspace/paneCapabilityWiring.test.ts` — test; 74 lines
- `src/lib/features/notepad/workspace/paneCloseAnimation.test.ts` — test; 46 lines
- `src/lib/features/notepad/workspace/paneCloseAnimation.ts` — target/support
- `src/lib/features/notepad/workspace/paneLayoutMotion.ts` — target/support
- `src/lib/features/notepad/workspace/paneRoles.test.ts` — test; 137 lines
- `src/lib/features/notepad/workspace/paneRoles.ts` — target/support
- `src/lib/features/notepad/workspace/paneTopActions.test.ts` — test; 42 lines
- `src/lib/features/notepad/workspace/paneTopActions.ts` — target/support
- `src/lib/features/notepad/workspace/paneTypes.ts` — target/support
- `src/lib/features/notepad/workspace/shortcuts.test.ts` — test; 109 lines
- `src/lib/features/notepad/workspace/shortcuts.ts` — target/support
- `src/lib/features/notepad/workspace/suppressResizeTransitions.ts` — target/support
- `src/lib/features/notepad/workspace/workspacePersistenceService.test.ts` — test; 109 lines
- `src/lib/features/notepad/workspace/workspacePersistenceService.ts` — target/support
- `src/lib/features/notepad/workspace/workspaceStore.sequence.test.ts` — test; 262 lines
- `src/lib/features/notepad/workspace/workspaceStore.svelte.ts` — target/support
- `src/lib/features/notepad/workspace/workspaceStore.test.ts` — test; 167 lines
- `src/lib/features/notepad/workspace/workspaceStoreTestSupport.ts` — target/support

### src/lib/features/notepad/pane

- `src/lib/features/notepad/pane/chatPaneBindings.ts` — target/support
- `src/lib/features/notepad/pane/paneControllers.ts` — target/support
- `src/lib/features/notepad/pane/paneEditorLifecycle.test.ts` — test; 315 lines
- `src/lib/features/notepad/pane/paneEditorLifecycle.ts` — target/support
- `src/lib/features/notepad/pane/paneLifecycleMachine.test.ts` — test; 170 lines
- `src/lib/features/notepad/pane/paneLifecycleMachine.ts` — target/support
- `src/lib/features/notepad/pane/paneRuntime.svelte.ts` — target/support
- `src/lib/features/notepad/pane/paneTransientUiController.svelte.ts` — target/support
- `src/lib/features/notepad/pane/paneTransientUiController.test.ts` — test; 144 lines
- `src/lib/features/notepad/pane/paneTransientUiState.test.ts` — test; 72 lines
- `src/lib/features/notepad/pane/paneTransientUiState.ts` — target/support
- `src/lib/features/notepad/pane/paneViewModelFactory.test.ts` — test; 78 lines
- `src/lib/features/notepad/pane/paneViewModelFactory.ts` — target/support

### src/lib/features/notepad/navigation

- `src/lib/features/notepad/navigation/locationMru.test.ts` — test; 289 lines
- `src/lib/features/notepad/navigation/locationMru.ts` — target/support
- `src/lib/features/notepad/navigation/navigation.ts` — target/support
- `src/lib/features/notepad/navigation/openFlow.ts` — target/support
- `src/lib/features/notepad/navigation/pendingNoteSave.ts` — target/support

### src/lib/features/notepad/interaction

- `src/lib/features/notepad/interaction/navigationSelectionController.test.ts` — test; 176 lines
- `src/lib/features/notepad/interaction/navigationSelectionController.ts` — target/support
- `src/lib/features/notepad/interaction/titleInteractionController.test.ts` — test; 131 lines
- `src/lib/features/notepad/interaction/titleInteractionController.ts` — target/support
- `src/lib/features/notepad/interaction/wikilinkInteractionController.test.ts` — test; 132 lines
- `src/lib/features/notepad/interaction/wikilinkInteractionController.ts` — target/support
- `src/lib/features/notepad/interaction/workspaceChoiceController.test.ts` — test; 93 lines
- `src/lib/features/notepad/interaction/workspaceChoiceController.ts` — target/support

### src/lib/features/history

- `src/lib/features/history/HistoryDiff.svelte` — target/support
- `src/lib/features/history/HistoryDiff.svelte.test.ts` — test; 116 lines
- `src/lib/features/history/HistoryDiffLines.svelte` — target/support
- `src/lib/features/history/HistoryMode.svelte` — target/support
- `src/lib/features/history/HistoryMode.svelte.test.ts` — test; 272 lines
- `src/lib/features/history/HistoryRevisionSummary.svelte` — target/support
- `src/lib/features/history/HistoryTimelineRevision.svelte` — target/support
- `src/lib/features/history/RevisionNameEditor.svelte` — target/support
- `src/lib/features/history/historyApi.test.ts` — test; 154 lines
- `src/lib/features/history/historyApi.ts` — target/support
- `src/lib/features/history/historyModeMachine.test.ts` — test; 264 lines
- `src/lib/features/history/historyModeMachine.ts` — target/support
- `src/lib/features/history/historyModeSession.svelte.ts` — target/support
- `src/lib/features/history/historyModeSession.test.ts` — test; 1004 lines
- `src/lib/features/history/historyTimeline.test.ts` — test; 90 lines
- `src/lib/features/history/historyTimeline.ts` — target/support

### src/lib/features/proposals

- `src/lib/features/proposals/ProposedChangesCard.svelte` — target/support
- `src/lib/features/proposals/index.ts` — target/support
- `src/lib/features/proposals/proposalOrchestration.test.ts` — test; 610 lines
- `src/lib/features/proposals/proposalOrchestration.ts` — target/support
- `src/lib/features/proposals/proposalReviewMachine.test.ts` — test; 201 lines
- `src/lib/features/proposals/proposalReviewMachine.ts` — target/support
- `src/lib/features/proposals/review.css` — target/support
- `src/lib/features/proposals/reviewDisplay.ts` — target/support
- `src/lib/features/proposals/reviewExtension.test.ts` — test; 77 lines
- `src/lib/features/proposals/reviewExtension.ts` — target/support
- `src/lib/features/proposals/reviewSession.svelte.ts` — target/support
- `src/lib/features/proposals/reviewSession.test.ts` — test; 102 lines
- `src/lib/features/proposals/types.ts` — target/support

### Additional composition/domain files

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/agents/issue-tracker.md`
- `docs/agents/triage-labels.md`
- `docs/agents/domain.md`
- `docs/architecture/behavior-invariants.md`
- `docs/adr/0002-own-note-timelines-at-the-canonical-mutation-seam.md`
- `docs/adr/0007-retain-editor-history-at-editing-window-boundaries.md`
- `docs/adr/0008-verify-target-note-history-before-background-coverage.md`
- `.agents/skills/codebase-design/SKILL.md`
- `src/lib/features/notepad/Notepad.svelte`
- `src/lib/features/notepad/host.test.ts`
- `src/lib/architectureFitness.test.ts`
- `src/lib/features/notepad/wikilinks/runtime.ts`
