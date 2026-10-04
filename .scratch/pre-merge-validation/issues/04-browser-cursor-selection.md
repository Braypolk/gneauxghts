# Diagnose browser cursor geometry and native-selection failures

Status: ready-for-agent
Progress: Cursor harness correction complete and reviewed; all 110 headless browser cases pass. Historical headed timeout cause remains unproven.

## Signal and scope

`clean-browser.log:41–68` records four failures in `editor-cursor.spec.ts` (the task wrapped-row failure appeared after the first report):

1. Ordered list: cursor did not reach row at 172.2109375, test line 102.
2. Heading 3: `Range.setEnd` offset 2 exceeds text-node length 1, test line 62/72.
3. Task: cursor did not reach row at 200.2109375, test line 102.
4. Native code/table selection: `.cm-cursor-primary` remains after 10 seconds, test line 240.

Preserved screenshots under `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/`:

- `gneauxghts-browser-failure-Z3yvKb/screen.png` — ordered list; caret visibly remains at the text end.
- `gneauxghts-browser-failure-xjcYrm/screen.png` — heading 3; expected heading rendered, caret at text end.
- `gneauxghts-browser-failure-kjT80V/screen.png` — task (log inspected; image not needed for the initial distinction).
- `gneauxghts-browser-failure-ldwzkI/screen.png` — code/table; no visible range highlight, caret at final table cell.

The original and clean candidate cursor specs are byte-identical. `cursorExtension.ts` has no cumulative diff from HEAD. The only cumulative spec changes before these failures were an initial Chromium content click and replacing inline two-frame waits with the equivalent bounded `waitForTwoAnimationFrames` helper. The helper waits for actual frames or rejects; it does not silently fall back to a timer.

## Confirmed harness defect

`e2e/specs/browser/editor-cursor.spec.ts:68–72` loops through all characters of each DOM text node, selects every `W`, then unconditionally measures `[index + 1, index + 2]` in that same node. DOM text-node segmentation is not a semantic word boundary. A valid single-character `W` node, or a `W` at a node's final character, makes this range invalid. The observed offset-2/length-1 exception proves this failure occurs before the geometry assertion.

A correction must bound the local range or traverse the next authored text node while retaining an interior-word sample and at least two real wrapped rows. Merely catching the exception, lowering row coverage, or skipping the heading case would weaken the geometry contract. The origin of the one-character segmentation is not yet known and need not be guessed from the screenshot.

## Remaining hypotheses, not confirmed production defects

### H1: fixture/native selection is not stably admitted

The test replaces content through native `execCommand(selectAll/insertText)` and waits only for `getText().includes('Wrapped text')` (`43–56`). Every preceding case contains that same string, so this condition cannot prove the new fixture reached CodeMirror. Two delivered frames are not an explicit document/selection admission proof.

Each row then mutates native Selection once (`87–99`), waits for an already existing cursor element, and checks geometry. The code/table test similarly checks the text immediately after `addRange`, but never checks whether that selection survives asynchronous observation (`228–240`). The failure screenshots show the cursor at the fixture end and no selected background, which is consistent with selection not being admitted or being replaced. This does **not** yet establish whether the cause is harness scheduling, lost focus, or application synchronization.

The task failure context contains `Wnrapped`, which the exact fixture string never inserts. Preserve this discrepancy in the next capture: compare both CodeMirror authored bytes and DOM text to the expected fixture. It is evidence of unexplained content mutation, not proof of user interference or a particular application bug.

### H2: raw DOM offsets target non-authored or changed text

The row sampler, collapse, and geometry check separately traverse *all* text nodes and reuse summed DOM text offsets (`63–118`). They include noneditable widgets and have no authored-text mapping. Markdown decoration rebuilds occur on selection and syntax-tree changes; task date widgets add `+`, and CodeMirror uses widget boundary DOM. A cached DOM offset is not guaranteed to retain semantic identity after that rebuild. Sampling and later assertion must identify the same authored character; they must not silently follow a changed node layout.

This possibility alone does not explain why the caret remains at the end in both screenshots. Capture target node/ancestor/mapped document position to distinguish it from H1.

### H3: admitted CodeMirror selection is correct, but cursor layer is stale/wrong

The production cursor layer derives markers only from `view.state.selection`: empty ranges draw a caret; nonempty ranges draw none (`cursorExtension.ts:21–33`). It requests a measure on selection/document/focus changes; CodeMirror's layer also requests measurement on geometry and doc-view updates. Selection-only transactions still pass directly to `controller.view.update` in `editorDocumentRuntime.ts:224–226`.

Thus a nonempty **CodeMirror** range with a remaining primary cursor would implicate layer measurement/rendering. A collapsed CodeMirror range with a nonempty native selection instead implicates selection observation/focus/synchronization. Current screenshots/logs do not expose that distinction. No production cursor change is justified yet.

## Discriminating next experiment (coordinator only)

1. Finish the frozen full run, then run the unchanged cursor spec alone. Preserve success/failure and existing geometry/focus assertions. No retry loop or timeout increase.
2. If a selection failure remains, add temporary distinctly named diagnostic capture at: fixture insertion completion, immediately after native collapse/addRange, and at the failed wait. Capture:
   - Exact expected fixture versus current authored document and DOM text; editor/root connectivity and `aria-busy`.
   - `document.hasFocus`, `visibilityState`, `document.activeElement`, content focus, editor class.
   - Native anchor/focus node text, local offsets, closest `.cm-line`, noneditable/widget ancestry, selected text/collapsed state.
   - CodeMirror main anchor/head/ranges and document length, viewport, `coordsAtPos` for the intended authored position, cursor DOM count/rect/display.
   - Target text-node lengths and a bounded local DOM excerpt before building the row range; a valid split word must not crash the diagnostic.
   - `selectionchange` count/order and any content change observed between fixture readiness and row assertion, if the static snapshots remain ambiguous.
3. Use the app's actual view via the supported `EditorView.findFromDOM` boundary when instrumenting; do not create a second editor or write through the root to force a green result. Capture is read-only. If module access needs a temporary E2E export, keep it explicitly temporary and remove it after diagnosis.
4. Choose the fix from the observed distinction. If harness admission is wrong, wait for the actual intended fixture/selection and use authored, bounded text targeting while keeping all row/height/native-range/focus assertions. If admitted model state is correct and layer geometry is not, fix and regress the production owner. Do not reapply selection inside a polling predicate to conceal replacement.

## Completion criteria

Original wrapped paragraph/list/heading/task/code/large-text geometry still runs; the heading walker cannot exceed node bounds; native ranges remain selected and suppress the custom caret; keyboard collapse restores it; title focus hides it. Confirm the unchanged/or corrected original browser scenario, preserve failure evidence, and remove temporary instrumentation. Native WebKit remains a separate validation surface.

## Comments

Coordinator reports the unchanged isolated cursor (12 cases) plus formatting (5 cases) run passed in 20.4 seconds. This distinguishes the deterministic invalid range assumption from the currently non-reproduced selection failures; it does not establish their cause or justify increasing timeouts.

The coordinator authorized only the confirmed bounds correction. Original `editor-cursor.spec.ts` now skips a `W` sample unless `[index + 1, index + 2]` fits in the same text node. All cases, minimum wrapped-row coverage, coordinate/height tolerances, native-range assertions, and focus assertions remain unchanged. No production selection/runtime change was made. The reviewer performed no test/build runs; root owns validation.

Temporary `.scratch/pre-merge-validation/cursor-diagnostic.spec.ts` is a copy for one diagnostic run, retaining the original failing sampler (before the authorized guard) and all original assertions. It records bounded expected/DOM/authored text, actual view selection, native selection and mapped positions, focus/visibility, cursor geometry, target-node geometry and nearby text nodes. It resolves the existing view through the locked implementation's observed `content.cmTile.root.view.constructor.findFromDOM` facility without loading or constructing another CodeMirror instance. Snapshot failures are caught and logged; they cannot replace the original assertion failure. The extra browser calls/layout reads can perturb scheduling and must be disclosed when interpreting a diagnostic pass. It is not a permanent test or a fix, and must not accidentally replace the corrected live spec in final merge contents.

Final root verification: corrected plain source passed the complete browser suite (26/26 files). The bounds defect is fixed; other initial selection failures remain unproven and this follow-up stays open. Final source hashes match the reviewed candidate.

Follow-up investigation: three bounded headless traces passed all 36 cursor cases with exact authored agreement for all 27 wrapped fixtures. Temporary tracing was removed; no new cursor production change. See ../../intermittent-ui/cursor-review.md and ../../intermittent-ui/results.md. The original remaining selection failure is still unproven.

## Cursor harness follow-up (2026-10-03)

Corrected exact fixture admission and authored selection setup, replaced synthetic
native ranges with real Shift+Arrow plus native/model agreement, and preserved
independent DOM geometry and all 12 cases/tolerances. No production cursor change.
Focused 12/12 and full headless 110/110 cases across 26 files passed; E2E types and
independent review passed. The old timeout was not reproduced, so its exact cause
remains unproven. No speculative renderer fix or further retry loop is warranted.
Native WebKit is unverified. See ../../cursor-stability/results.md and
../../cursor-stability/findings.md; earlier paragraphs describe historical stages.
