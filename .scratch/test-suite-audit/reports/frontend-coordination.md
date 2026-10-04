# Frontend coordination audit

Date: 2026-10-02. Baseline: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`.
Status: audit complete; recommendations below are not an authorization to change ownership invariants.

## Scope and method

Reviewed notepad document/state/session/workspace/pane/interaction/orchestration tests and their target call paths, plus proposal review and History Mode. Every test file in the ledger below was read; production depth is recorded separately. This report was written before production or test edits. No tests or production code were edited by this auditor.

Read repository domain/architecture guidance, behavior invariants, ADR 0002/0007, and the code-review and codebase-design skills. Findings distinguish static proofs, coverage gaps, and unconfirmed race investigations. Parent's baseline run passed **141 files / 1,007 Vitest tests**. Parent measured document/workspace sequence suites at approximately **165/182 ms** during a mixed-load cold run; their enumeration is not an established performance bottleneck. This audit does not justify shortening them for speed.

Paths in evidence are repository-relative, and line numbers refer to the baseline. Priorities: P2 = meaningful confidence/design problem; P3 = bounded cleanup. These are audit findings, not individual tracker tickets; follow the repository's one-file-per-ticket convention when scheduling them.

## Preserve these contracts

- WorkspaceStore owns pane membership/order/active pane; NotepadState owns shared documents by stable ephemeral DocumentHandle. The registry shares those handles. Canonical lookup/collision is derived and must be rebuilt after identity changes.
- DocumentEditingService is the committed-state adoption boundary. Later edits survive older save completions; committed publication warnings never become a write retry. Version Restore resets undo even for properties-only changes, and an unopened target must not create panes.
- The departure/navigation pipeline owns ordering and cancellation. Queues and operation correlation protect real races, so replacing them with direct view calls is not simplification.
- History Mode is a global overlay: flush/seal before entry, inert mounted workspace, exact focus/selection restoration, pinned immutable selection, explicit diagnostics. Restore and clear history must not repeat a committed mutation after a later publication problem.
- Proposal arrival is passive, one global review retains its working copy across navigation without canonical saving, and canonical collisions/external conflicts remain blockers.

## Findings grouped by module

### 1. Workspace and document model tests

**FC-01 — P2, confirmed weak oracle: legal commands may fail without failing the sequence test.**

`src/lib/features/notepad/workspace/workspaceStore.sequence.test.ts:177–225` enumerates every command triple, but the catch at line 199 accepts **any** exception if the state is unchanged. A regression making a normally legal command throw before mutation is therefore treated as an expected rejection. The test proves invariant preservation and atomic rejection; it does not prove the command succeeds when its preconditions hold. `workspaceStore.test.ts` supplies useful individual examples, but cannot make the sequence oracle complete.

Recommendation: retain enumeration and add independent precondition/expected-outcome information for each command. Unexpected exceptions must escape. Assert accepted/rejected outcomes against a small reference model rather than merely count attempted/rejected commands. Keep explicit rejection atomicity checks. Replacement coverage must include legal close/activate/create transitions after earlier commands, and documented invalid transitions. Risk: medium; do not reproduce production conditionals verbatim in the oracle.

The document sequence suite has 12 command choices and workspace has 20; 3-command enumeration gives 1,728 and 8,000 sequences respectively. The document suite checks useful token monotonicity and external-sync invariants, but its command alphabet does not cover every property/tag/collision or asynchronous adoption transition. This is a coverage boundary, not evidence the suite should be removed. Keep directed service/race tests for those scenarios.

**FC-02 — P2, confirmed duplicated adoption mechanics; suitable bounded production extraction.**

`src/lib/features/notepad/document/documentState.ts:385–460` repeats almost the same state adoption body in `applySessionSnapshotToDocument` and `applyCommittedNoteToDocument`: changed-field detection, preserve-working/preserve-tags handling, identity/baseline/warning replacement, revision bump, and `boundaryApplied`. The input conversion is genuinely different and should remain explicit.

Recommendation: extract a private normalized-snapshot application function, leaving both named boundary entry points and their conversions intact. Preserve tag copying, tagsError, returned changed flags, and revision semantics. Existing service tests cover later body/title/tag edits and properties-only restore; run those plus state/store collision tests. Add only a missing differential case if needed, not an additional large mirror suite. Risk: medium because saved baseline and working-copy rules are correctness-sensitive.

**FC-03 — P3, confirmed vacuous unopened-restore assertion.**

`document/documentEditingService.test.ts:28,48,203–212` creates and returns a `replaceNoteAcrossPanes` spy that is never passed into the service. Asserting it was not called cannot detect unwanted pane work. The positive `{ kind: 'notOpen' }` assertion remains useful.

Replace the spy with before/after assertions on the actual document collection and registry runtime identities/count for the unopened target; if pane creation must be verified, exercise the composition layer owning panes. Remove the unused spy entirely. Risk: low. Do not delete chat-only retained-document or undo-reset restore cases, which test separate behaviors.

### 2. Persistence, refresh and lifecycle

**FC-04 — P2, confirmed fixture retention and spy leakage.**

`orchestration/persistenceController.test.ts:98–109` resets timers/globals but never disposes runtimes created by `documentRegistry.ensure` in `persistenceController.ts:70,233`. It also creates a `console.warn` spy at test line 298 without restoring it. The registry is module-global, and `workspace/workspacePersistenceService.ts:31–35` awaits queues from **all** registry entries. Consequently later tests in this suite inherit runtimes/queue state they did not create; restoring real timers does not clear the registry. No Vitest `restoreMocks` or global cleanup setting was found in the inspected Vite config.

Recommendation: settle test promises, dispose runtimes owned by the fixture, and restore spies after each case. Prefer tracking created handles or a suite-owned cleanup helper; do not clear unrelated state in concurrent tests. Existing documentEditingService/documentTagConflicts tests demonstrate cleanup, but a broad shared fixture should be introduced only where ownership is unambiguous. Validate with the targeted suite, its workspace-persistence neighbor and the full suite. Risk: low. This proves test state retention, not a production memory leak or quantified performance regression.

**FC-05 — P2 investigation, not a confirmed bug: delayed external read versus newer canonical adoption.**

`orchestration/noteCommandController.ts:115–154` captures a path before `readNoteSession`, then correlates the response only by unchanged path. If a newer canonical save/adoption finishes while a read of the same path is pending, the returned old snapshot may be compared with a newer baseline and adopted or classified as a conflict. Existing refresh tests cover same-document coalescing, trailing refresh, path changes and different-document concurrency, but not this ordering against a canonical save.

First add a deferred-read experiment with a real shared document and adoption boundary: start old read, complete newer save to the same identity, resolve old read, inspect working content/baseline/conflict. Verify actual backend ordering before deciding whether a baseline/version correlation token or shared operation queue is needed. Do not add speculative guards based solely on this report. Risk if changed: high; identity-only versus content-revision correlation is an architectural decision.

The session lifecycle and editor lifecycle already guard stale async completions and teardown; those directed cases are valuable and should survive fixture consolidation.

### 3. Pane navigation, ownership and command composition

**FC-06 — P3, confirmed obsolete production helper island.**

`orchestration/paneSessionController.ts:27–43,63–83` exports `searchItemMatchesSplitSource`, `paneCommandPreviousNoteLabel`, and `findPaneCommandPreviousItem`. A repository `src` reference search found only their own calls and `paneSessionController.test.ts`; current previous-location rendering uses location-history state in `Notepad.svelte:1005`. The similarly named view-model field is not a consumer of the old exported helper.

Remove the three helpers and obsolete previous-item assertions/test setup, retaining `paneCommandNoteLabel`, `getSplitSourceNote`, and pane selection/capability methods still used in production. Run pane-session and location-history tests plus type checking. Risk: low. No replacement test is needed for removed, unreachable product behavior; current MRU/history tests protect the live behavior.

**FC-07 — P3, confirmed unreachable orphan cleanup branch.**

`orchestration/workspacePaneController.ts:286,401–403,438–443` initializes `orphanPlaceholderKey` to null, assigns only `closingDocument.handle` (or null), then requires that key to differ from `closingDocument.handle`. There is no subsequent assignment to `closingDocument` between the assignment and check. That cleanup branch cannot run.

Remove the dead variable/assignment/branch after review. Preserve the canonical-collision cleanup immediately above and normal teardown. If an independently orphaned placeholder was intended, that is a separate behavior investigation requiring an actual distinct handle and regression scenario; do not silently invent such behavior while removing dead code. Risk: low for dead-code deletion.

**FC-08 — P2 design opportunity: test the composed ownership boundary instead of reimplementing it in fixtures.**

`orchestration/workspacePaneController.test.ts:75–204` reconstructs membership state and reducer dispatch, pane order and workspace mutations in a large fixture, with invariant assertion replaced by a spy (line 82). `notepadCommandFacades.ts` exposes a broad forwarding surface, `notepadCommands.ts` wires mutually dependent command objects, and note-command tests repeatedly supply partial graphs with casts. The issue is duplicated knowledge of coordination, not file length.

A larger worthwhile rewrite is a reusable *test composition* containing real WorkspaceStore, NotepadState, DocumentEditingService, departure and navigation pipeline, with fake IO and editor capabilities only. Exercise open/split/close, chat-context transfer, queued save failure, final-reference cleanup, and current-location MRU as observable sessions. Once equivalent coverage exists, replace fixture-internal call-order assertions that merely mirror forwarding. Keep reducer tests for illegal transitions and asynchronous stale-operation tests at their current narrow seams. Then consider narrowing production dependencies into refresh/adoption and navigation/pane capability groups; do not create another document/pane owner or queue.

Risk: medium/high. This is a staged refactor candidate, not permission to delete controller tests before the composed replacement proves the invariants.

**FC-09 — P3, confirmed redundant assertions in transient UI ownership.**

`pane/paneTransientUiController.test.ts:72–79,94–101,110–117` asserts the exact same active state twice consecutively without an intervening operation. Remove the second assertion in each pair. Better additional coverage, if absent elsewhere, would assert the previous owner's editor menu closes when another owner opens; expose the relevant capability spies rather than repeat derived state. Keep tests for stale/non-owning close requests and owner disposal. Risk: low.

### 4. Proposal review and editor integration

**FC-10 — P2, confirmed fake diverges from real proposal state; second-preview test misses identity regression.**

`proposals/proposalOrchestration.test.ts:87–100` ignores the actual supplied review extension and always synthesizes review state from the module-global first `preview`. Its effect dispatcher further reimplements hunk transitions. The replacement test at `463–488` supplies `review-2`/`hunk-2`, yet only checks markdown and proposal ID; its fake still uses the first review/hunks. This suite cannot establish that new preview identities and actual CodeMirror state are installed correctly.

Replace the invented review-state engine with an adapter backed by real CodeMirror EditorState, compartment/review extensions and effects. Keep fake persistence/navigation callbacks. Preserve the current real-state `reviewExtension.test.ts` cases, which cover lower-level mapped/modified hunk behavior rather than duplicate orchestration.

Replacement scenarios: load two distinct previews in succession, verify second review/hunk identity, Keep All commits the second text exactly once, undo a locally modified hunk, detach/remount the same document with stale reader, and synchronize two editor panes of the same document. Risk: medium; do not satisfy this by merely parameterizing the existing fake's hardcoded ID.

**FC-11 — P2 coverage gap: real notepad proposal adapter has no direct behavioral suite.**

`orchestration/notepadProposalAdapter.ts` chooses/reuses/splits editor panes, transfers chat context and installs proposal orchestration; repository reference search found no test importing it. Orchestration unit tests fake these navigation capabilities, so agreement between adapter, WorkspaceStore and review document ownership is not directly checked in this scope.

Add a small composed adapter suite using the FC-08 harness: proposal arriving while chat is active, existing shared editor reuse, target absent, review retained during navigation, conflicting target refusing unsafe adoption. Before adding expensive browser tests, map existing proposal E2E coverage with the E2E auditor and keep only missing composition cases here. No claim is made that end-to-end coverage is entirely absent. Risk: medium; preserve passive proposal arrival.

### 5. History Mode and Note Timeline frontend

**FC-12 — P3, confirmed repeated SSR scenario; distinguish markup from interaction coverage.**

`history/HistoryMode.svelte.test.ts:100–168` renders the same open-state fixture twice and repeats the two revision-node count assertion; the second case's only distinct assertion is absence of “Editing Session.” Consolidate that distinct assertion into the first rendering (or the existing editing-window rendering case) and remove the duplicated full prop setup.

These tests use `svelte/server` render, so they validate markup/visibility, not clicking Cancel/Confirm. The native timeline suite **does** exercise Restore preview and confirmation (`e2e/specs/native/note-timeline-phase-1-3.spec.ts:384–390,422–429,594–601`), including properties-only restore. Do not duplicate those happy paths just because component tests are SSR. Map the remaining clear-history and cancel-without-mutation branches (`HistoryMode.svelte:260–280,356–362`) to the E2E inventory; add a mounted interaction case only for a confirmed gap. The API deliberately sends `confirmed: true` (`historyApi.ts:66–76,98–99`), so frontend confirmation belongs at the interaction boundary.

The large `historyModeSession.test.ts` and machine suite contain distinct request correlation, retry, stale result, committed-warning, entry/exit focus and pagination cases. They are not interchangeable and should not be wholesale merged. Extract typed scenario builders where repeated setup obscures intent, but retain each distinct failure boundary. Named revision, editing window and point revision rendering also represent distinct semantics.

## Prioritized handoff

1. **Ready for bounded cleanup after audit review:** FC-03/04/06/07/09/12. Write a small patch, run affected suites/type checks, and ensure test cleanup settles its queues. Expected gain is clarity/isolation, not a major runtime reduction.
2. **Strengthen confidence before architecture edits:** FC-01 and FC-10; their present oracles can accept broken behavior. Coordinate FC-11 with browser/native coverage ownership.
3. **Staged production simplification:** FC-02 then FC-08; keep ownership and separate boundary names. New composition tests replace corresponding mock-heavy tests after proving coverage.
4. **Research only:** FC-05 needs a deterministic reproduction and backend ordering review before any change.

## Coverage ledger

Every test listed below was read for assertions, fixtures, mocking, and target behavior. Deep production reading covered document state/editing/conflicts/registry/runtime, noteStore, WorkspaceStore/persistence service, pane editor lifecycle, pane-session/controller facades/command composition, note and workspace pane controllers, navigation pipeline, persistence, proposal orchestration/adapter and History Mode session. Other target modules were inspected through exported seams, relevant implementation branches and call sites; this was not an exhaustive line-by-line proof of all rendering/layout/interaction source. The exact distinctions prevent the inventory being mistaken for blanket execution or exhaustive formal verification.

No dedicated tests were found for the notepad proposal adapter, paneLayoutMotion or suppressResizeTransitions. The latter layout modules may be covered through browser motion tests; no deletion recommendation follows from absence of a colocated test. Domain-specific editor/search/chat/backend and E2E audits are assigned to other auditors; overlap here concerns coordination boundaries only.

### notepad/document (10 test files)

- `src/lib/features/notepad/document/documentConflictController.test.ts` — test body inspected.
- `src/lib/features/notepad/document/documentEditingService.test.ts` — test body inspected.
- `src/lib/features/notepad/document/documentExternalSyncMachine.test.ts` — test body inspected.
- `src/lib/features/notepad/document/documentOperationMachine.test.ts` — test body inspected.
- `src/lib/features/notepad/document/documentPaneCoordinator.test.ts` — test body inspected.
- `src/lib/features/notepad/document/documentRegistry.test.ts` — test body inspected.
- `src/lib/features/notepad/document/documentRuntime.test.ts` — test body inspected.
- `src/lib/features/notepad/document/documentState.sequence.test.ts` — test body inspected.
- `src/lib/features/notepad/document/documentState.test.ts` — test body inspected.
- `src/lib/features/notepad/document/documentTagConflicts.test.ts` — test body inspected.

### notepad/state (1 test files)

- `src/lib/features/notepad/state/noteStore.svelte.test.ts` — test body inspected.

### notepad/session (1 test files)

- `src/lib/features/notepad/session/paneOwnership.test.ts` — test body inspected.

### notepad/workspace (9 test files)

- `src/lib/features/notepad/workspace/paneCapabilities.test.ts` — test body inspected.
- `src/lib/features/notepad/workspace/paneCapabilityWiring.test.ts` — test body inspected.
- `src/lib/features/notepad/workspace/paneCloseAnimation.test.ts` — test body inspected.
- `src/lib/features/notepad/workspace/paneRoles.test.ts` — test body inspected.
- `src/lib/features/notepad/workspace/paneTopActions.test.ts` — test body inspected.
- `src/lib/features/notepad/workspace/shortcuts.test.ts` — test body inspected.
- `src/lib/features/notepad/workspace/workspacePersistenceService.test.ts` — test body inspected.
- `src/lib/features/notepad/workspace/workspaceStore.sequence.test.ts` — test body inspected.
- `src/lib/features/notepad/workspace/workspaceStore.test.ts` — test body inspected.

### notepad/pane (5 test files)

- `src/lib/features/notepad/pane/paneEditorLifecycle.test.ts` — test body inspected.
- `src/lib/features/notepad/pane/paneLifecycleMachine.test.ts` — test body inspected.
- `src/lib/features/notepad/pane/paneTransientUiController.test.ts` — test body inspected.
- `src/lib/features/notepad/pane/paneTransientUiState.test.ts` — test body inspected.
- `src/lib/features/notepad/pane/paneViewModelFactory.test.ts` — test body inspected.

### notepad/interaction (4 test files)

- `src/lib/features/notepad/interaction/navigationSelectionController.test.ts` — test body inspected.
- `src/lib/features/notepad/interaction/titleInteractionController.test.ts` — test body inspected.
- `src/lib/features/notepad/interaction/wikilinkInteractionController.test.ts` — test body inspected.
- `src/lib/features/notepad/interaction/workspaceChoiceController.test.ts` — test body inspected.

### notepad/orchestration (14 test files)

- `src/lib/features/notepad/orchestration/documentDepartureController.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/locationHistoryController.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/noteCommandController.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/notepadChatCoordinator.svelte.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/notepadChatPaneAdapter.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/notepadRefreshController.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/notepadSessionLifecycle.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/notepadTaskMutationAdapter.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/paneCommandController.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/paneCommandGroup.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/paneNavigationTransitionPipeline.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/paneSessionController.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/persistenceController.test.ts` — test body inspected.
- `src/lib/features/notepad/orchestration/workspacePaneController.test.ts` — test body inspected.

### proposals (4 test files)

- `src/lib/features/proposals/proposalOrchestration.test.ts` — test body inspected.
- `src/lib/features/proposals/proposalReviewMachine.test.ts` — test body inspected.
- `src/lib/features/proposals/reviewExtension.test.ts` — test body inspected.
- `src/lib/features/proposals/reviewSession.test.ts` — test body inspected.

### history (6 test files)

- `src/lib/features/history/HistoryDiff.svelte.test.ts` — test body inspected.
- `src/lib/features/history/HistoryMode.svelte.test.ts` — test body inspected.
- `src/lib/features/history/historyApi.test.ts` — test body inspected.
- `src/lib/features/history/historyModeMachine.test.ts` — test body inspected.
- `src/lib/features/history/historyModeSession.test.ts` — test body inspected.
- `src/lib/features/history/historyTimeline.test.ts` — test body inspected.
