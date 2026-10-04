# Workspace test reduction result

Status: complete
Progress: Approved D01–D25 implemented; focused tests passed; source frozen for coordinator integration and independent review.

34 actual test executions deleted across 13 test files. Physical source reduction is **461 lines** against this phase’s saved current-tree baseline, not Git HEAD. No production edits, new tests, new test helpers, moved assertions, skipped tests, or file moves. The initial audit line estimate was high; these measured numbers supersede it.

| File | Cases before → after | Lines before → after |
|---|---:|---:|
| `src/lib/features/notepad/document/documentRuntime.test.ts` | 3 → 2 | 60 → 54 |
| `src/lib/features/notepad/document/documentState.test.ts` | 11 → 5 | 264 → 150 |
| `src/lib/features/notepad/document/documentExternalSyncMachine.test.ts` | 8 → 5 | 163 → 116 |
| `src/lib/features/notepad/session/paneOwnership.test.ts` | 10 → 7 | 227 → 162 |
| `src/lib/features/notepad/workspace/workspaceStore.test.ts` | 7 → 4 | 167 → 113 |
| `src/lib/features/notepad/workspace/workspaceStore.sequence.test.ts` | 7 → 2 | 338 → 297 |
| `src/lib/features/notepad/pane/paneLifecycleMachine.test.ts` | 8 → 6 | 170 → 136 |
| `src/lib/features/history/historyModeMachine.test.ts` | 4 → 3 | 188 → 165 |
| `src/lib/features/history/historyModeSession.test.ts` | 45 → 44 | 1019 → 989 |
| `src/lib/features/notepad/workspace/paneRoles.test.ts` | 6 → 4 | 137 → 104 |
| `src/lib/features/notepad/navigation/locationMru.test.ts` | 19 → 18 | 305 → 298 |
| `src/lib/features/notepad/markdown/markdown.test.ts` | 24 → 23 | 318 → 311 |
| `src/lib/features/notepad/pane/paneTransientUiState.test.ts` | 8 → 3 | 72 → 72 |

## Verification

Focused Vitest: **38 files, 321 tests passed**. Log: `01-focused.log`. Includes all edited files plus retained document editing/adoption/conflict, real composition/pane commands/chat adapter/refresh, reactive note-store, History/API/rendering/timeline, Markdown format contracts, workspace policy/sequence/persistence and transient-controller owners. No full suite, browser, or native run by this owner.

The last source cleanup after that successful run removed only unused `Transaction`, `TransactionSpec`, and `EditorView` imports from the Markdown test. Other test-only dead imports left by removed cases were removed before the run. Coordinator owns full frontend/typecheck acceptance.

## Preserved contracts

The exact surviving owner for each removed test remains in `01-workspace-audit.md`. In particular, the independent workspace command model remains; only its two injected-helper-throw self-tests and duplicated adjacent-close cases were deleted. External conflict provenance rows were removed because that test only passes opaque strings, not actual event notifications. Transient UI retains both real open branches (ordinary and image session), matching/mismatched close behavior, and all actual controller entrypoints.

History omitted-selected-row, normal paging dedup, restore/clear admission and correlation, failed recovery/reentry, citation coordinates, persistence task attribution and queues, title/body later edits, all unique collision/vault contracts, and the six command/parser/decorations format contracts remain. No additional proposed opportunity beyond D01–D25 was removed.

## Evidence

- `01-metrics.json`: per-file baseline cases and physical lines.
- `01-deletions.json`: initial exact deletion names.
- `01-additional-deletions.json`: later MRU and Markdown exact deletion names.
- Same-branch matrix deletions are explicitly enumerated in audit D22–D23.
- Baseline snapshot: `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-test-reduction-meo8wffi`.

Source is frozen.
