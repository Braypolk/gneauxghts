# Independent review: cursor-test stabilization design

Scope: `.scratch/cursor-stability/spec.md`, current cursor spec, admission experiment/log, existing Notepad E2E bridge, editor capability and selection implementation, and the unchanged production cursor layer. Read only; no tests/browser/builds or live-source edits by this reviewer.

**Design verdict: approve the bounded test redesign, subject to the coverage conditions below.** The proposed division matches the actual contracts and removes unnecessary reliance on synthetic native selection for geometry setup. No production cursor correction is currently supported by the evidence.

## What the experiment establishes

`admission.log` records all three ordinary focus conditions (`focused`, `title`, `blurred`) with immediate native offset 2 while the model still has `{anchor:400,head:400}`, followed by model/native convergence to 2 after the event loop advances. This confirms the asynchronous selection boundary. It does **not** reproduce the old 2/10-second failure, and it does not show that selecting from title/blurred state permanently loses the selection: Chromium moved focus to content and admitted it in those cases.

The `new-tab` branch made the test document hidden; its bounded frame helper correctly rejected after no frames arrived. That deliberately hidden-tab condition is not the old same-tab cursor defect and is not evidence to loosen the helper or change the renderer. Headless removes operating-system foreground theft but still permits page visibility changes from opening a tab.

The earlier nine geometry cases mix three jobs: fixture publication, asynchronous programmatic native selection admission, and cursor rendering. Their `.includes('Wrapped text')` check accepts every previous fixture. Using an exact authored snapshot and the existing synchronous selection action gives geometry an explicit precondition. This is a test setup correction; report it as such rather than claiming the production cursor was repaired.

## Existing hook is a legitimate geometry setup boundary

`Notepad.svelte:1394` calls the existing editor capability's `focusSelection` with `scrollIntoView:false`. That delegates to `focusEditorSelection`, which clamps authored positions, dispatches a real CodeMirror selection transaction, and focuses the actual view. It does not modify cursor DOM, mock geometry, or call the cursor layer directly. `readEditorState` reads the real snapshot, including markdown and selection. Both hooks already exist for browser/native E2E builds and are erased from ordinary builds.

Require the action to return true, and require the observed model selection to equal the requested authored position. Otherwise clamping or an unavailable editor could yield a misleading geometry pass. Exact markdown equality must precede row sampling; initial `aria-busy=false` alone does not prove a subsequent native edit was admitted.

Do not add a new production bridge, reach into private `cmTile` internals, or replace note content through internal state merely to implement this redesign. The existing bridge suffices for setup; keep DOM geometry as independent observed evidence.

## Coverage that must remain

| Contract | Approved setup / required oracle |
| --- | --- |
| Nine wrapped styles (paragraph, unordered/ordered list, quote, H1/H3, task, code, large paragraph) | Exact authored fixture; choose interior authored character positions; select via existing hook; at least two rendered rows; cursor top and text height, cross-row height consistency, visible custom caret and transparent native caret unchanged |
| Due-date control geometry | Existing four completed/wrapped variants, authored end position excluding widget/buffer, top/left/height assertions, real typing and arrow/backspace round trip |
| Native range selection on opaque code and table backgrounds | A real pointer drag or Shift+Arrow creates the range; assert exact native selected text and the real model anchor/head/range; custom caret absent and nontransparent native selection background |
| Range collapse and blur | Real ArrowRight collapses selection and restores custom caret; title focus hides it; assert model/native collapse where needed to avoid accepting stale state |
| Click after multiple code blocks | Preserve actual hit-tested pointer path, each target block/paragraph, correct native/model destination, and cursor/text-row alignment |

Using the hook to seed the starting caret before **real** Shift+Arrow is acceptable. Using the hook to create the range and then calling it a native-range test is not. A strict model assertion should poll read-only until the real input is admitted, never dispatch or reapply selection from inside the predicate.

Keep the expected geometry independent: use DOM `Range.getBoundingClientRect` on actual rendered text. Do **not** replace it with `EditorView.coordsAtPos` as the expectation: `RectangleMarker.forRange` already uses that coordinate computation, so comparing the two would largely mirror the renderer's implementation. Authored offsets identify the intended character; the DOM range independently measures its rendered rectangle.

For these fixed fixtures, mapping sampled `Wrapped` occurrences to their occurrences in the exact authored string is sufficient and simpler than a new generic document/DOM mapping service. Preserve the bounds guard for fragmented text nodes, and do not reduce minimum row coverage when a sample is unavailable.

## Minimal implementation boundary

Keep this within `editor-cursor.spec.ts` and, only if reused, the existing narrow E2E support seam. A small typed local bridge accessor, exact-fixture waiter, and authored-selection helper are enough. Avoid a new driver abstraction or general command protocol. No changes to `cursorExtension.ts`, runtime selection propagation, application focus policy, retry counts, or geometry tolerances are warranted by current evidence.

The old nine native collapses were repetitive setup for geometry. Replacing them while strengthening the explicit native selection case does not lose nine distinct application input contracts. The true click and keyboard behavior stays real and independently asserted.

## Deterministic evidence and what not to claim

The current focus experiment already deterministically proves that reading native Selection immediately after `collapse` is not a model-admission proof. It is sufficient motivation to give geometry an explicit setup boundary, but not sufficient proof of the historical timeout's exact cause.

For a retained setup regression, the honest controllable boundary is fixture readiness: arrange an old wrapped fixture, keep the next fixture's publication behind a test-owned gate, begin the proposed exact-fixture admission, and assert it has not admitted the old text; release the actual native insertion and require admission of the complete new markdown. This tests the setup predicate's responsibility. It must be labelled a harness-admission test and cannot be reported as reproducing a production cursor bug. Such a separate case is optional if it adds more scaffolding than value; exact assertions in the existing cases may be the simpler retained contract.

Do not stop selectionchange propagation, inject a compensating selection transaction, open a hidden tab, or force an unrelated editor update solely to manufacture a red cursor case and then claim the application has that bug. If a realistic delayed publication/update is used, retain the actual owner and identify the observed ordering it reproduces.

After the bounded redesign, validate all existing 12 cases headlessly and retain real input/selection assertions. Repetition can establish the new harness's observed stability, not retroactively prove the cause of old headed failures. Remove diagnostic specs and wrappers from discovered E2E paths when finished. Native WebKit validation remains a separate surface; this review and current experiment cover headless Chromium only.

## Final implementation review

Compared the actual final `e2e/specs/browser/editor-cursor.spec.ts` with `.scratch/cursor-stability/cursor-before.spec.ts` by direct file diff. Final source SHA-256: `f428d56600568ab4ea91dc2e9ba9218a5ce0d8be05b4a9ab4e5d1e9a790bccdc`; before SHA-256: `c7ffb949c5e836279be858fd6e625b9f9563fbc9bec35bef79276c6771fa5c01`.

**No actionable correctness or coverage-weakening finding in the final implementation.** The file shrinks from 324 to 300 lines. Production cursor, selection/runtime owners, E2E hook implementation, and assertion tolerances are unchanged.

- `insertFixture` (11–24) uses the same native paste route already used by the prior task/code/table cases and requires exact authored markdown from the real snapshot. It replaces the shared-substring readiness condition and repeated fixture setup without bypassing native paste processing.
- `placeCursor` (26–34) asserts all three preconditions: selection applied, exact unclamped authored anchor/head, and actual content focus. It performs a single real selection action, not a retry inside a geometry poll.
- `wrappedRows` (39–69) measures DOM Range rectangles. It maps each rendered `Wrapped` occurrence by ordinal to the known authored fixture and rejects unequal occurrence counts. Noneditable widget text is excluded, while a word fragmented across text nodes is resolved through separate bounded start/end points. The measured interior `r` character exists because the matched full `Wrapped` token exists. No CodeMirror coordinate API supplies the expected rectangle, so the geometry oracle remains independent.
- All nine wrapped styles, at least two distinct rows, up to three sampled rows, row-top tolerance, text-height tolerance, cross-row height consistency, custom cursor display and transparent native caret checks remain (109–137).
- All four due-date end-of-text scenarios and their top/left/height plus real typing/arrow/backspace checks remain. Authored end setup no longer depends on walking through the control's DOM buffer.
- The code/table native-range case (201–228) now creates each range with real Shift+Arrow. It requires the exact native text and exact model anchor/head with content focus before checking the existing selection background and absence of the primary caret. This strengthens the old immediate `selection.toString().length > 0` oracle. Real ArrowRight collapse and title-focus hiding remain.
- The five-block pointer journey still uses actual Chromium pointer actions and independent DOM geometry. It now additionally requires the model's collapsed selection to be on the same intended authored line as the native selection (278–296). Its line-level contract is preserved rather than claiming pixel-exact horizontal placement that the old case never asserted.

The updated `findings.md` correctly separates the controlled immediate native/model gap from a sustained failure: no-op update/focus-refresh controls converged within two frames and did not reproduce the historical timeout. The final report must preserve that limitation rather than call the old failure fully diagnosed.

Root reports the final 12 focused cases and E2E typechecking passed; this reviewer did not execute them. The shared non-Chromium branch retains its existing native single-click adaptation and native `execCommand` fallback for character insertion. The newly strengthened Shift+Arrow range contract assumes the embedded driver delivers modifier/key events to CodeMirror; the prior keyboard navigation coverage supports the choice, but the current headless run does not validate macOS WebKit. The E2E bridge is present in both explicit browser and native builds, so no new browser-only production seam was introduced. A future native run should retain failures rather than skip the stricter range checks if its driver behaves differently.
