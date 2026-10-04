# 01 — Reduce document, pane, persistence and History test machinery

Status: ready-for-agent
Progress: Complete; implemented, reviewed, and accepted after combined validation. See ../validation.md.
Owner: audit_documents

## Scope and baseline

Use the frozen current-tree snapshot recorded in `../baseline.json`, not HEAD. Read `../spec.md`, `../plan.md`, issue-tracker instructions and codebase-design skill. This proposal excludes editor runtime, search, chat internals and proposals. The existing real notepad composition support and proposal acknowledgement cases remain coverage owners (coordinated with owner 02).

The main opportunity is duplicated ownership machinery, not the mere size of suites. `workspacePaneController.test.ts` has 459 lines and implements its own pane membership/retirement model through an 13-option fixture. `notepadCompositionTestSupport.ts` already exercises real WorkspaceStore, document state, persistence, commands, document coordination and pane sessions behind a smaller setup call. Keeping both models makes changes cost twice and permits incorrect fake transitions to pass.

## Proposed first tranche: remove fake ownership, retain boundary behaviors

1. **Replace `src/lib/features/notepad/orchestration/workspacePaneController.test.ts`'s handwritten workspace model with the existing composition support.** Delete `createHarness`, manual membership transitions, retirement/disposal bookkeeping and unsafe fake-facade cast. Keep tests short and separately named; do not turn them into one scenario script or a new option-heavy harness. Reuse existing composition behavior where it already owns successful close/finalization. Preserve:
   - blocked close returns ready, preparation failure keeps the pane;
   - ordering: prepare, remove membership, rendered teardown, release retired state;
   - two dirty canonical-collision participants block close; after deliberately cleaning one side, close waits on its existing save queue and does not write it;
   - chat split retains source document, creates no throwaway editor/draft; failed creation cleans its runtime;
   - split inherits the active pane, and editor-to-chat departure identifies the exact pane.
   `notepadComposition.test.ts` already owns shared-document final departure and independent concurrent navigation. Add only missing assertions/scenarios above with real owners and IO/render spies. Estimated net reduction **230–280 lines**, including any changes to support. No production interface expansion.

2. **Delete overlapping departure and workspace-save scenarios after the real composition cases own their full assertion.**
   - `documentDepartureController.test.ts`: `lets a clean collision participant depart without attempting a canonical write` duplicates the real departure path in workspacePaneController's dirty-collision/clean-side case. Preserve queued-save-before-cursor ordering in that retained case before deleting approximately 55 lines. Retain authoritative persisted cursor path, failed seal, concurrent shared departures (including first failure), and preliminary-save versus actual-departure tests.
   - `workspacePersistenceService.test.ts`: delete `retries a document changed during its first save before allowing navigation` (approximately 35 lines). `persistenceController.test.ts`'s new-draft readiness/follow-up-save matrix already exercises the real save queue and workspace persistence barrier, including assigned identity and failure. Keep the separate multi-document/pending-proposal barrier and unresolved-external-conflict tests.

## Proposed second tranche: concentrate History contracts

3. **Reduce `historyModeMachine.test.ts` (264 lines) where real session tests own the same state outcome.** Remove barrier failure (`historyModeSession.test.ts`, `leaves the workspace active and reports a clear error when saving fails`); remove immutable selected-diff pinning (`refreshes record headers while keeping the selected revision body pinned`); remove retry workspace preservation (`retries unavailable history without recapturing or replacing the original focus`). The finalized-window fixture distinction is already tested by History timeline/component and native editing-window coverage; preserve any state initialization assertion not owned there. Keep reducer-only older-page deduplication, explicit note-unavailable transition, stale request-id rejection, and **keep omitted-selected-revision refresh**: the current session rename/pinning cases do not omit that row. Estimated net reduction **75–100 lines**, without weakening the missing-row contract.

4. **Reduce `HistoryMode.svelte.test.ts` (251 lines), preserving unique rendering.** Remove replacement-preview SSR case in favor of actual mounted `e2e/specs/browser/history-entry-and-return.spec.ts` complete Version Restore confirmation/adoption and `history-controls.spec.ts` cancellation/in-flight exclusion. Remove adjacent-direction SSR case in favor of `history-citations.spec.ts` actual citation paging. Replace repeated twelve-callback `vi.fn` blocks (none invoked in SSR) with one explicitly inert callback-props value. Retain unavailable-history escape controls, diagnostics/read-only surface, and named interval/combined diff rendering beside a point revision. Trim assertions for state identity and schema/copy already asserted through mounted controls, not unique rendered fields. Estimated net reduction **90–120 lines** including fixture simplification.

5. **Simplify persistence fixture vocabulary, not its concurrency contracts.** `persistenceController.test.ts` (637 lines) currently knows snapshot, committed NoteSession, and a committedSnapshot round-trip representation, repeats last-saved boundary fields, and repeatedly constructs the same editing-service/controller ports. Use one note input and one persisted-result constructor; remove snapshot-to-NoteSession reconstruction and repeated four-port construction with a small local setup function returning real editing/controller and IO spy. No universal configurable test framework. Retain every existing save invalidation, post-commit collision/warning, inactive-draft restore identity, attribution, delayed observation, exact revision/scope correlation, recovery-readiness and follow-up barrier case. Estimated **70–110 lines** net reduction. History session's 1,019 lines are mostly distinct concurrency and citation admission cases; do not delete these merely to reach a target. Its 19 boundary ports correspond to actual operations, so a new fixture abstraction would obscure rather than remove burden.

## Proposed third tranche: eliminate exact reducer overlap

6. `documentOperationMachine.test.ts` (105 lines): remove success matrix, stale-terminal supersession and independent-content-revision cases. `documentState.test.ts` owns real operation dispatch success and actual-content revision, and `documentState.sequence.test.ts` explicitly checks both stale success/failure after saving/forgetting supersession. Retain duplicate completion cannot erase terminal failure and correlated save progress, including invalidation/terminal clearing. Approximately **55 lines** removed.
7. `documentState.test.ts` (293 lines): remove the stale-failure-only test duplicated by the explicit sequence-test pair above, approximately **29 lines**. Retain boundary DTO roundtrip, exact content change and external conflict resolution. Do not treat sequence triples' structural invariants as a substitute for exact behavior: external sync examples and duplicate terminal handling stay.

## Protected coverage and boundaries

No removal of History busy restore/citation admission races, current-vs-previous diff refresh, document conflict read-versus-save races, shared concurrent departure, assigned note identity on follow-up save, undo/tag/unopened restoration, MRU suppression/retry, last-editor ownership or task reveal/presentation ordering. Preserve distinct live `paneCommandNoteLabel` test. Do not globally clear document runtimes: dispose only fixture-owned lifetimes. No deletion of proposal adapter/composition cases or browser/native cases. No production changes proposed in this tranche: removing the duplicate test-owned workspace state machine offers the concrete reduction without creating a new production seam.

## Verification and measurement

- Coordinator reviews the proposal before implementation.
- Measure changed test files plus helper LOC against the frozen current snapshot; anticipated aggregate net reduction **roughly 600–750 lines**, an estimate rather than a quota. Report removed fake concepts separately from LOC and executed cases.
- Run only focused Vitest for changed files plus retained composition/persistence/session owners; root owns full integration/browser/native runs. Report exact commands/counts and failures. No claim of speed benefit from case count.
- For disputed overlap, retain the scenario unless an existing owner detects a focused mutation. Representative mutation: break workspace barrier repeat-until-clean and verify retained real readiness/follow-up-save case fails; restore production before final validation. For workspace migration verify blocked/failed close and teardown ordering remain observable through real commands.
- Review deletion diff against every mapped owner; reject support growth that merely relocates the fake model.

## Comments

- Initial proposal includes a correction discovered during audit: the older loaded revision rename case does not cover refresh omitting the selected record. That reducer regression is explicitly retained.

## Follow-on: chat pane adapter boundary (coordinator requested)

Progress: Coordinator approved the bounded follow-on; implemented and verified.

Inspected all 393 lines/19 cases of `notepadChatPaneAdapter.test.ts` and its production adapter. The notepad command composition does **not** instantiate this adapter. Snapshot/save failure, retained context, revision/passsage routing, stale editor rejection, non-body evidence and conversation bookkeeping therefore remain distinct owners. Unlike the removed workspace fixture, this fixture has no transition algorithm: its maps are static boundary inputs plus one reference assignment. Replacing these with WorkspaceStore would add required creation/membership orchestration, IDs and asynchronous setup to tests of read-only context selection; it does not demonstrate reduced burden here.

Bounded simplification proposal:

- Delete the **unused production `getEditorPaneIds` dependency** from adapter deps, the Notepad call site, and the test fixture. The implementation consistently uses `getNearestEditorPaneId`; the old fixture's editorPaneIds flag is misleading and cannot affect behavior.
- Narrow coordinator and proposal inputs to the members actually consumed with `Pick` (including only `session.snapshot` from the proposal session). Remove the two `as unknown as` whole-module fake casts; no new adapter/interface layer. Keep the controller opaque token because this adapter only forwards its identity.
- Replace the fixture's four independently configurable paneOrder/paneKinds/documents/editorPaneIds options with one explicit `singlePane` scenario. No caller customizes documents; three callers use the same no-editor state. The alignment test mutates the existing boundary pane list after synchronization; keep that readable transition without reconstructing a workspace.
- Parameterize the two existing wikilink routing cases over the two named destinations; same assertions and explicit case names. Consolidate backend passage revalidation/current-location case with the repeated-Unicode-occurrence case by using the latter data and retaining exact backend request, openNote and focus coordinates. No protected behavior is dropped.

Expected modest additional reduction (~35–55 test LOC plus one dead production port), chiefly fewer fixture options and removal of whole-module casts. Do not delete the adapter merely because it forwards some callbacks: this is the sole tested chat-to-notepad snapshot/navigation contract, and recent passage regressions live here.

## Implementation notes

- Coordinator approved original three tranches. Corrected initial override count: 13 optional keys, not 18.
- Replaced fake workspace model with real composition; fixture now uses the same existing conflict guard as Notepad and exposes its existing onDocumentLeaving boundary spy. This adds three support lines, not configurable flags.
- Mutation `workspacePersistenceService` attempt bound 3→1: the existing retry test fails, while all 23 persistence controller tests pass. Production restored immediately. **Retain the retry test**; real save-queue coalescing otherwise masks the barrier's repeat-until-clean contract. Log: `../documents-barrier-mutation.log`.
