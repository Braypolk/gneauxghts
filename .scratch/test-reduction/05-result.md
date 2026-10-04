# Frontend test reduction result

Status: complete; owned source frozen for root integration.

Implemented approved UI-R1–R10 and removed the two exact chat aggregate call-count assertions from architectureFitness. No production edits, new tests, helpers, fixtures, skips or assertion relocations. The failed-open machine recovery case remains. Existing privacy, wire/identity and race tests remain as mapped in 05-ui-audit.md.

## Exact phase delta

Compared with the saved working-tree snapshot in `baseline.json`, not HEAD:

| Test file | Before lines | After lines | Net lines | Before cases |
|---|---:|---:|---:|---:|
| `src/lib/features/chat/api.test.ts` | 638 | 538 | -100 | 29 |
| `src/lib/contracts/ipcFixtures.test.ts` | 213 | 196 | -17 | 5 |
| `src/lib/contracts/timelineContractFixtures.test.ts` | 137 | 117 | -20 | 4 |
| `src/lib/features/chat/machines/contentOperationMachines.test.ts` | 127 | 34 | -93 | 4 |
| `src/lib/features/atlas/atlasStore.test.ts` | 496 | 471 | -25 | 26 |
| `src/lib/features/settings/store.test.ts` | 608 | 598 | -10 | 28 |
| `src/lib/features/settings/settingsCatalog.test.ts` | 33 | 18 | -15 | 16 |
| `src/lib/architectureFitness.test.ts` | 165 | 162 | -3 | 9 |

**Net removal: 283 physical lines in 8 test files; 22 executed cases removed (121 → 99).** Thirteen test declarations were deleted; the catalog declaration contributed ten executed alias cases. Two source-pinning assertions plus their unused local source variable were removed. The now-unused test-only cursor interface member was removed; shared fixture data was untouched. No imports became unused. The exact diff consists exclusively of removed lines.

Evidence: `05-delta.json`, `05-changes.patch` (test-source-only comparison), and `05-focused.log`.

## Validation

`pnpm exec vitest run src/lib/features/chat/api.test.ts src/lib/contracts/ipcFixtures.test.ts src/lib/contracts/timelineContractFixtures.test.ts src/lib/features/chat/machines/contentOperationMachines.test.ts src/lib/features/atlas/atlasStore.test.ts src/lib/features/settings/store.test.ts src/lib/features/settings/settingsCatalog.test.ts src/lib/architectureFitness.test.ts`

Result: **8 files / 99 tests passed**, exit 0, 747 ms reported wall duration. Settings failure-path cases intentionally emit caught-error stderr; no test failed. Two leftover blank lines after removed leading cases were subsequently removed; no executable content changed after this run. Root owns combined typechecks and browser acceptance. No full-suite or browser/native run was started here.

Residual coverage tradeoffs are exactly those approved in the audit: individual unmounted editorial catalog aliases and a requested-provider key-status pass-through no longer have dedicated equality assertions; raw activity forwarding equality was never a privacy proof. Native transformation/identity fixtures, real-owner event behavior and rendered privacy checks remain.
