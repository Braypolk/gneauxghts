# Editor, images and proposals reduction result

Status: ready-for-agent
Progress: implemented and focused validation complete; source frozen for independent review

Implemented all approved E01–E17 from `02-editor-audit.md`. Removed **16 executable test cases** and **five repeated format fixtures within a surviving case**, with **two complete files deleted**. No scenarios were combined, no assertions were moved into another test, no tests were skipped, and no production or shared support files changed.

Measured directly against the saved current-tree snapshot in `baseline.json`:

| Test file | Before lines | After lines | Delta |
|---|---:|---:|---:|
| `notepad/editor/inlineFormatting.test.ts` | 151 | 132 | -19 |
| `notepad/editor/structuralIndentation.test.ts` | 198 | 165 | -33 |
| `proposals/proposalOrchestration.test.ts` | 512 | 453 | -59 |
| `proposals/proposalReviewMachine.test.ts` | 148 | 124 | -24 |
| `notepad/images/imagePerformance.test.ts` | 16 | 0 | -16 |
| `notepad/editor/indentConfig.test.ts` | 21 | 0 | -21 |
| **Total** | **1046** | **874** | **-172** |

All paths above begin `src/lib/features/`. Raw measurements are saved in `02-metrics.json`. Actual savings are slightly below the audit estimate of 180–230 lines; the actual measurement, rather than the estimate, is the outcome. Production delta: **0**. Shared helper delta: **0**.

Focused command:

```sh
npx vitest run src/lib/features/notepad/editor/inlineFormatting.test.ts src/lib/features/notepad/editor/structuralIndentation.test.ts src/lib/features/notepad/markdown/inlineFormatSpec.test.ts src/lib/features/notepad/images/imageEmbedWidgets.test.ts src/lib/features/proposals src/lib/features/notepad/orchestration/notepadProposalAdapter.test.ts
```

Result: **10 files, 75 tests passed** (log: `02-focused.log`). This selection plus the two deleted files contained 91 cases at the baseline. The six surviving format compositions and all 12 proposal adapter compositions passed unchanged. The conflicted reload case remains a single named test after removal of the redundant ordinary-review parameter row; the remaining link-format case retains both link and wikilink fixtures. Snapshot diff inspection confirms only the approved test/fixture deletions, accurate names for those two surviving cases, and removal of unused imported CodeMirror Backspace/Delete commands.

Distinct root/history, image lifecycle, proposal failure/race/retention and document-bound reload regressions remain as mapped in the audit. Independent review and combined validation are owned by root. No broad suites were run by this agent.
