# Documents reduction implementation

Status: ready-for-agent
Progress: Complete; source frozen for coordinator integration and independent review.

Proposal and retained behavior map: [issue 01](issues/01-documents.md). Comparison baseline is the frozen **current-source snapshot** in baseline.json, not HEAD.

## Result

Removed **683 net test/helper lines across nine existing files**; no test files or helpers added. The same 12 focused files had **156 cases** in coordinator baseline-frontend.log and now have **144**, preserving separately named parameter rows. [Exact per-file metrics](documents-metrics.md) include the three added composition-support lines. The reductions remove maintained concepts, not just formatting:

- Deleted the pane-controller suite's 13-option fake facade, handwritten membership transitions, retirement/disposal state, duplicate document-reference model and broad unsafe cast. The eight separately named lifecycle tests now use the existing real WorkspaceStore/document/persistence/command composition. Guarded close, failed preparation, teardown order, dirty collision, existing queue drainage, cursor order, cleanup, chat split source and exact leaving pane remain asserted.
- The shared composition fixture gained the same existing document-conflict guard used by Notepad and one departure callback spy; it gained no configuration flags. Collision setup uses two actual editor panes, so closing one cannot intentionally adopt its document into a following chat pane and invalidate the cleanup premise.
- Removed the now-duplicated clean collision departure case only after moving queue-before-cursor/no-write and timer cancellation checks into the real composed collision test.
- Persistence cases all remain. Removed snapshot-to-committed-result reconstruction, ignored lastSaved return fields and repeated controller wiring. Persisted fixtures now use NoteSession fields directly; local controller setup uses production types and retains caller-supplied editing ownership.
- Removed three History reducer tests and two SSR cases with named session/mounted owners in the proposal. Kept missing-selected-row refresh, page deduplication, stale request rejection, note-unavailable transitions, unavailable UI escape, diagnostics and finalized interval rendering. SSR uses inert callbacks rather than repeated unobserved spies.
- Removed exact document operation/state overlap, keeping duplicate-completion-after-failure and all correlated-progress terminal/invalidation protection.
- Chat adapter tests keep distinct context snapshot, save failure, citation/current passage/stale editor, non-body evidence and bookkeeping cases. A singlePane scenario replaces four fixture options; exact Unicode occurrence assertions are consolidated into the existing backend revalidation case. Two wikilink cases remain separate named parameter rows. Removed whole-module fake coordinator/proposal casts; idle proposal state now comes from its actual session owner.

Production scope is deliberately narrow: removed the adapter's unused `getEditorPaneIds` dependency and its Notepad argument, and narrowed coordinator/proposal dependencies to consumed `Pick` members. No runtime algorithm, state owner, persistence policy or navigation behavior changed in this reduction pass.

## Disputed deletion rejected by evidence

The proposed deletion of workspacePersistenceService's retry-while-dirty test was **not** applied. Temporarily reducing its attempt loop from three to one caused exactly that test to fail while all 23 persistence-controller cases still passed. The latter exercise queue coalescing; they do not replace the workspace barrier's repeat-until-clean behavior. The production source was restored before continuing. [Mutation log](documents-barrier-mutation.log).

The History session rename/pinning tests likewise do not cover a refreshed page omitting the selected row; that direct reducer case remains. Large History session tests were not removed simply for size: its admission, restore exclusion and citation concurrency contracts are distinct.

## Validation

- `pnpm exec vitest run` with the following explicit files: `workspacePaneController.test.ts`, `notepadComposition.test.ts`, `persistenceController.test.ts`, `documentDepartureController.test.ts`, `notepadChatPaneAdapter.test.ts`, `workspacePersistenceService.test.ts`, `historyModeMachine.test.ts`, `historyModeSession.test.ts`, `HistoryMode.svelte.test.ts`, `documentOperationMachine.test.ts`, `documentState.test.ts`, `documentState.sequence.test.ts`: **12 files / 144 tests passed**. [Log](documents-final.log). Diagnostic output from intentionally rejected persistence operations remains expected.
- After replacing the impossible null proposal snapshot with the real idle session, reran `notepadChatPaneAdapter.test.ts`: **18 tests passed**. [Log](documents-adapter-final.log).
- `pnpm exec svelte-check --tsconfig ./tsconfig.json`: **0 errors, 0 warnings**. [Log](documents-typecheck.log).
- `git diff --check`: clean.
- No browser/native/full suite run by this owner. Coordinator owns integration and mapped mounted History coverage. No speed claim: targeted run timing is not a controlled before/after benchmark.

Independent review after source freeze: agent reviewer reports no actionable coverage/behavior issue; editor reviewer reports no Standards issue in the adapter follow-on (coordinator retains final review report). No changes to baseline audit reports or prior reproduced-bug production fixes.
