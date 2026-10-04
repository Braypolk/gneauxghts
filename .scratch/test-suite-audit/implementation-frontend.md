# Frontend bounded cleanup implementation

Status: implemented; targeted validation passed. Parent audit gate: `review.md`.

Implemented only FC-03/04/06/07/09/12 from the baseline frontend report. Original audit report remains unchanged.

## Changes

- **FC-03:** Removed the unwired `replaceNoteAcrossPanes` spy. The unopened Version Restore test now observes the real NotepadState snapshot, existing document identity, registry contents and existing runtime identity. Its name describes the boundary it actually exercises: no created documents or runtimes.
- **FC-04:** Persistence fixtures capture registry entries present before each case. Teardown cancels owned runtime timers, settles their save queues, disposes only entries created during the case, restores mocks, and restores timers/globals. Queue rejection is handled during teardown because failure tests assert authoritative rejections themselves. Existing registry entries retain their lifetimes.
- **FC-06:** Deleted the three unused previous-note helpers and obsolete SearchItem fixture. Preserved a distinct live `paneCommandNoteLabel` filename-fallback test and pane capability/navigation checks. Current MRU/location-history behavior is unchanged.
- **FC-07:** Removed the impossible `orphanPlaceholderKey` branch and its variable/assignment. The actual canonical-collision cleanup and pane teardown remain intact.
- **FC-09:** Removed three identical consecutive transient-owner assertions; each distinct transition is still asserted.
- **FC-12:** Removed one duplicate History Mode SSR rendering and moved its unique “Editing Session” absence assertion into the original identical render case.

Seven frontend files changed: 28 added / 128 removed lines. No state ownership, public persistence behavior, navigation ordering, proposal semantics or History Mode interactions were rewritten.

## Validation

Command:

```sh
pnpm test src/lib/features/notepad/document/documentEditingService.test.ts src/lib/features/notepad/orchestration/persistenceController.test.ts src/lib/features/notepad/orchestration/paneSessionController.test.ts src/lib/features/notepad/orchestration/workspacePaneController.test.ts src/lib/features/notepad/pane/paneTransientUiController.test.ts src/lib/features/history/HistoryMode.svelte.test.ts src/lib/features/notepad/orchestration/locationHistoryController.test.ts src/lib/features/notepad/workspace/workspacePersistenceService.test.ts
```

Result: **8 files / 69 tests passed** (6.64 s wall time; not a speed comparison). Expected negative-path persistence diagnostics appeared on stderr; restoring the leaked console spy also makes later warning diagnostics visible again. No unhandled test errors were reported.

Scoped `git diff --check` passed. Reference search confirmed deleted `searchItemMatchesSplitSource`, `findPaneCommandPreviousItem`, and `orphanPlaceholderKey` have no remaining source references. Reviewed production deletion against original assignment/call sites. Full suite and TypeScript/Svelte validation are left to the parent combined gate as requested; browser/native suites were not run.
