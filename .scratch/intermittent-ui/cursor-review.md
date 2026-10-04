# Cursor follow-up: native selection versus CodeMirror admission

Scope: read-only investigation of the remaining intermittent failures from pre-merge issue 04. No tests/browser/builds or live-source edits performed. Used the repository diagnosing-bugs skill. The prepared diagnostic copy is `cursor-trace.spec.ts`; it includes the already approved range-bounds guard and all current assertions.

## Assessment

No additional production defect is established. Root reports two complete headless runs passed, including all 12 cursor cases; the latest complete run passed 26 files / 109 cases. Default `--headless=new` removes OS foreground stealing from future browser runs. The earlier unexpected `Wnrapped` is preserved evidence from a headed failure, not proof that foreground input caused it.

One test precondition is demonstrably insufficient: `editor-cursor.spec.ts:55` accepts any content containing `Wrapped text`, which all preceding wrapped fixtures also contain. It does not distinguish the intended prefix, font-specific case, or CodeMirror authored content. This is a latent readiness weakness, not a demonstrated explanation of the failure: native editing and mutation observation may already have settled before the check in normal execution. Do not change fixture behavior merely to obtain a pass.

The selected native range is checked synchronously immediately after `addRange`, while the cursor comes from CodeMirror's state. Those are different observations; a nonempty immediate DOM selection does not prove the model admitted it. The existing later cursor assertion should remain strict. Repeatedly applying a selection in its polling predicate would conceal the very loss under investigation.

## Narrowed hypotheses from current source

- The cursor layer (`editor/cursorExtension.ts`) draws only empty CodeMirror ranges. A nonempty **model** main range plus a persistent primary marker is a renderer/measurement problem. A nonempty native range with a collapsed model range is an admission/focus problem. Both collapsed at the fixture end means the selection was never admitted or was subsequently replaced.
- In locked `@codemirror/view` 6.43.1, `DOMObserver.onSelectionChange` reads selection and flushes it when content is active. `applyDOMChange` rejects selection-only changes if the view lacks focus. CodeMirror's ordinary measurement starts with `observer.forceFlush()`, so “the next animation frame forgot to read selection” is not supported by the source.
- `EditorView.update` does clear pending observer records and synchronizes DOM selection to its model. A later state update can therefore be relevant, but no particular application update has yet been correlated with the failure. The trace below records the real updates rather than forcing a synthetic failure through an injected update.
- Selection-only transactions in `EditorDocumentRuntime.dispatchFromPane` directly update the originating view; they do not broadcast the selection or rewrite root markdown. Normal save adoption only resets the runtime if working markdown changes. These paths do not currently substantiate a generic shared-root selection reset.
- The old global-DOM-offset concern is weaker for the observed ordered-list/task cases: all sampled rows are on the same authored line, active-line marker visibility remains active, and the due-date `+` widget is after the sampled text. Node splitting changes local offsets but not their summed total. Unexpected document mutation or changed decoration membership still matters; do not assume widgets alone caused these failures.
- The recent-focus “selection at element start” reset in CodeMirror requires a collapsed selection exactly at content start. Samples are inside `Wrapped`, and the native range is nonempty, so this heuristic is not a fit for the reported operations.
- EditContext handling is Android-only in the locked version. Desktop headless Chromium does not use that branch; do not switch input modes as a speculative fix.

## Bounded trace prepared for root

`cursor-trace.spec.ts` is a temporary replacement for the current live spec at the same `e2e/specs/browser/editor-cursor.spec.ts` path. Relative imports intentionally remain unchanged. Do not include this temporary replacement in merge contents.

The trace:

1. Installs before each case and removes itself after each case.
2. Observes the actual existing view through the source-observed `content.cmTile.root.view.constructor.findFromDOM` route. It does not instantiate/import a second editor.
3. Records the last 80 events: native selection/input/focus events at capture phase, post-selectionchange microtask snapshots, and the real `view.update` transactions before/after delegation. The wrapper calls the original method once with the original receiver and arguments.
4. Marks native `selectAll`, insertion, each row collapse, and code/table range selection **inside the original browser execution calls**. It adds no interstitial browser RPC, wait, frame, artificial selection event, or selection rewrite.
5. Records native mapped anchor/head, local node offsets, model anchor/head, focus/visibility, transaction document/selection flags and bounded update call stacks. Capturing these does not request layout.
6. Emits exact final expected/authored/DOM fixture text and a compact final snapshot for every case. Full event history and cursor geometry are emitted only after an original assertion fails. Errors in capture are caught and cannot suppress the original assertion.

Instrumentation inevitably adds CPU work and changes method identity; a diagnostic pass is not proof that the race is fixed. The earlier 422-line diagnostic copy under pre-merge validation adds extra browser calls and retains the pre-guard sampler, so this narrower current-source copy is preferable for the present investigation.

## Controlled interpretation, at most three serial runs

No further broad repetition is required by this reviewer. If root wants a bounded confirmation, run the instrumented current cursor spec under the same default headless configuration up to three times, without other browser/native runs. Stop after the first meaningful failure and retain its trace. Do not increase timeouts or change viewport between repetitions.

Use the trace to choose the next experiment:

| Observation | Conclusion / next action |
| --- | --- |
| Fixture DOM looks new but authored bytes still old at native target | Admit the exact authored fixture before sampling; retain the same input and geometry assertions. First reproduce with only that readiness precondition changed. |
| Native target is set, content remains focused, no selectionchange delivery/model update before it is lost | Browser-native selection delivery or intervening view update; inspect the captured real update stack. Do not patch cursor geometry. |
| Selectionchange admits intended model target, then another transaction resets it | The update stack and transaction identify the responsible production/harness operation. Reproduce that ordering directly before correcting its owner. |
| Native and model target agree, primary cursor remains on old row / remains for a nonempty range | Production cursor measurement is implicated. Preserve matching model/DOM proof and fix through the existing cursor owner. |
| Native mapped position differs from the intended sampled text after a decoration change | Replace only the unstable targeting mechanism with bounded authored-character targeting; retain native selection for the native-range contract. |
| Three headless repetitions pass with exact fixture agreement and ordinary selection delivery | Stop. Record the old headed failures as unproven, retain the confirmed bounds fix, and keep no diagnostic instrumentation. No speculative production change is justified. |

A deliberately injected `view.update` or forced `selectionchange` could manufacture a model/DOM difference, but would not show that the original scenario has that ordering. This investigation therefore does not recommend using such an artificial failure to justify a fix.
