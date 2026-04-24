# Main App QA: Not Addressed Items

Date: 2026-04-22

Related docs:
- [Main App Deep QA Audit](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/docs/main-app-deep-qa-audit-2026-04-22.md)
- [Main App QA Remediation Playbook](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/docs/main-app-qa-remediation-playbook-2026-04-22.md)
- [Remaining Partially Addressed Items](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/docs/main-app-qa-remaining-partial-items-2026-04-22.md)

Scope:
- Items that were previously not addressed based on the latest implementation pass.
- Status updated after the follow-up implementation pass.

## 1) Major Notepad Decomposition

Status: Addressed in the follow-up pass.

Current state:
- [Notepad.svelte](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/notepad/Notepad.svelte) still owns rendering and UI event wiring, but the largest multi-step workflows have been moved behind focused orchestration modules.
- Refresh orchestration remains in:
  - [notepadRefreshController.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/notepad/orchestration/notepadRefreshController.ts)
- Pane/session orchestration moved to:
  - [paneSessionController.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/notepad/orchestration/paneSessionController.ts)
- Persistence/autosave orchestration moved to:
  - [persistenceController.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/notepad/orchestration/persistenceController.ts)
- Proposal-mode preview/display workflow moved to:
  - [proposalController.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/notepad/orchestration/proposalController.ts)

Completed implementation:
- Extracted split-pane selection, navigation-pane choice, visible/editor pane lookup, split picker source matching, and split picker labels.
- Extracted note save queues, autosave timer management, clean-buffer detection, stale-save guarding, and post-save sync scheduling.
- Extracted proposal update lookup, selected-hunk preview building, document proposal ownership checks, and proposal display title resolution.
- Added targeted tests for the extracted pane/session, persistence/autosave, and proposal modules.

Original required implementation steps:
1. Extract pane/session orchestration into a dedicated controller module.
2. Extract persistence/autosave command flow into a separate controller/service.
3. Extract proposal-mode workflows into their own module.
4. Keep `Notepad.svelte` focused on rendering and event wiring only.

Acceptance criteria:
- Met. `Notepad.svelte` no longer contains the extracted multi-step workflow logic.
- Met. Extracted modules have clear ownership and targeted tests.

## 2) Frontend Automated Test Safety Net

Status: Addressed in the follow-up pass.

Current state:
- Frontend tests are configured through Vitest in [vite.config.js](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/vite.config.js).
- [package.json](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/package.json) now exposes:
  - `pnpm run test`
  - `pnpm run test:watch`
- First-wave tests cover:
  - split-pane selection behavior
  - settings refresh routing behavior
  - inbox list resource foreground concurrency behavior
  - notepad pane/session orchestration
  - notepad persistence/autosave orchestration
  - notepad proposal preview/display orchestration

Completed test files:
- [paneSessionController.test.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/notepad/orchestration/paneSessionController.test.ts)
- [persistenceController.test.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/notepad/orchestration/persistenceController.test.ts)
- [proposalController.test.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/notepad/orchestration/proposalController.test.ts)
- [refreshCoordinator.test.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/settings/refreshCoordinator.test.ts)
- [listResource.test.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/inbox/listResource.test.ts)

Original required implementation steps:
1. Add frontend test framework and script in `package.json` (for example, `test` / `test:watch`).
2. Add first-wave tests for high-risk logic:
   - split-pane selection behavior
   - settings refresh policy behavior
   - inbox list resource concurrency behavior
3. Add tests for notepad orchestration modules as they are extracted.

Acceptance criteria:
- Met. Frontend tests are runnable locally and suitable for CI with `pnpm run test`.
- Met. Critical store/orchestration behavior now has an initial automated safety net.

Verification:
- `pnpm run check`: passed with 0 errors and 0 warnings.
- `pnpm run test`: passed, 5 files and 12 tests.
- `pnpm run build`: passed.

## Suggested Implementation Sequence

Status: Completed.

1. Added frontend test harness.
2. Decomposed Notepad orchestration in focused phases.
3. Added targeted tests for extracted controllers and adjacent high-risk stores.
