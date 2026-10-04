# Formatting browser preparation loses the Alpha result panel

Status: ready-for-agent
Progress: Follow-up reproduced and corrected a real stale-focus race; see ../../intermittent-ui/results.md. The exact cause of the original uninstrumented failure remains unprovable.

## Observed failure

`.scratch/pre-merge-validation/clean-browser.log:69–93` contains three failures in `editor-formatting-load.spec.ts`, each at `prepareAlphaResult` waiting for `Open search result: Alpha note.md`. The rendered note is Beta. Invocation logs show `open_note`, another `search_notes_hybrid`, and subsequent read/recent calls. Logs retain argument **keys**, not values/results, so they do not prove which final query/result was delivered.

Inspected the saved first failure screenshot `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-browser-failure-hJkhWP/screen.png`: the search input visibly contains **Alpha note**, but no results panel is rendered. Thus the failure is not evidence that Alpha input text was cleared. The screenshot alone does not establish focus ownership, scope value, result contents, or event ordering.

## Call-path evidence

1. `seedLongNoteAndOpenBeta` (`editor-formatting-load.spec.ts:88–96`) opens search, selects All notes, enters Beta, sends Enter, then waits only for Beta title and editor `aria-busy=false`. `prepareAlphaResult` immediately clicks the input and enters Alpha (`105–108`). It does not join the previous complete navigation or observe final focus ownership.
2. `editorLifecycleController.ts:178–184` publishes ready after formatting/layout settles. Its caller `presentDocument` still awaits `documents.replacePaneDocument`, performs derived work, then invokes `focusAfterPresentation` (`notepadWorkspaceSession.ts:588–603`). That helper awaits another tick and focuses the pane if it is still active (`230–235`). It checks pane operation identity and active pane, not whether the user has since focused search. Consequently `aria-busy=false` is not, by itself, proof that no later navigation focus effect exists.
3. `SearchBar.svelte:154–161` closes search on focusout outside its shell, and renders the panel only while `isOpen` (`398`). It can retain Alpha text while its panel disappears. This matches the observed shape.
4. The proposed late `openFlow.clearSearch` explanation does **not** apply to Beta selected through ordinary search: `navigationSelectionController.ts:88–93` passes `clearSearch: () => {}`. Search text is intentionally preserved. Screenshot Alpha text corroborates this narrower rejection.
5. Scope is retained by `search/store.svelte.ts`; `handleSearchOpen` reloads recent focus only, and only `handleSearchModeChange` writes `searchMode`. No inspected same-pane activation path resets it. The second backend hybrid-search invocation is consistent with All-notes search but, without values, not definitive proof of the final mode.

## D2 attribution check

D2 adds `activatePaneSession` inside admitted `openNotePath`. In this one-pane scenario it assigns the already-active pane ID and calls `closeTransientUiExcept` for that same pane. `PaneTransientUiController.closeExcept` (`142–150`) skips the matching pane and only closes editor transients in *other* panes; it does not touch SearchBar. `WorkspaceStore.setActivePaneId` assigns the same ID and asserts invariants; it has no asynchronous focus operation. The late focus call above predates D2. There is no direct source mechanism establishing D2 as the cause, although timing perturbation cannot be excluded without an A/B run. Do not revert nearest-editor correctness based on temporal association.

## Ranked hypotheses and bounded next observation

1. **Late Beta focus closes newly reopened Alpha search.** Strongest source-supported hypothesis; not yet reproduced with event ordering. Root's isolated run should capture a short event list containing monotonic time, focusin/focusout targets, search input value, search shell `data-search-active`, mode button state, Beta editor busy transitions, and result-panel existence. Observe `document.activeElement` immediately before/after clicking and entering Alpha, then on failure. Keep listeners scoped and remove in `finally`.
2. **WebDriver focus/clear-input interaction or another existing focus-restoration effect closes the panel.** Same visible outcome; event targets distinguish this from workspace completion. Merely waiting longer for a hidden button cannot repair closed-panel state.
3. **Wrong mode or missing returned results.** Lower confidence. Capture final scope and exact fixture query/result count before rejecting it. Do not infer empty backend results from a button hidden by the closed panel.

If the event trace confirms Beta completion steals focus after explicit Alpha interaction, decide whether to correct navigation's stale focus intent or have this formatting-only helper await the complete intended Beta destination focus before starting a separate scenario. A user typing into a newly focused search should not be displaced by an old open; a helper-only delay must not hide a demonstrated production stale-intent bug. Any correction should retain the actual formatting/scroll assertions. Do not add an arbitrary sleep or increase timeouts. Full-run and isolated controls belong to root; no test, browser or source mutation has been performed by this reviewer for this diagnosis.

## Isolated control and diagnostic handoff

Root reports the unchanged isolated cursor12 + formatting5 run passed all17 in20.4s. This establishes intermittency, not a cause or correction; no formatting production/test-behavior fix is authorized.

Temporary copy: `.scratch/pre-merge-validation/formatting-diagnostic.spec.ts`. To execute, replace only the candidate's `e2e/specs/browser/editor-formatting-load.spec.ts` with this file; its existing relative support import is intentionally unchanged. The original live spec is untouched. Prefix `FORMATTING_DIAGNOSTIC` is emitted only after a failed case. It includes stage marks around Beta title/readiness and Alpha input actions; capture-phase focus/input events; observed busy, scope, panel and result changes; and invocation start/settlement IDs plus fixture query and result cardinality. No note content is logged. The trace retains at most600 records, automatically removes observers/listeners/restores invoke at20s, and cleans up again in afterEach. It returns the original invocation promise unchanged.

All original test actions, wait conditions/timeouts, formatting samplers, and assertions remain verbatim. Stage-mark WebDriver round trips and passive observation necessarily perturb timing; a passing diagnostic run does not disprove the race. No tests/builds were run by this reviewer.

Final root verification: unchanged formatting spec passed all five cases in the complete 26/26 browser suite. No diagnostic variant was used. This follow-up remains open because neither a passing isolated run nor a passing final complete run proves the cause or correction of the initial missing-panel failures.

Follow-up under the user-authorized investigation: a paused open_note response plus a newer search reproduces the same preserved-query/closed-panel symptom. The correction and lifecycle review are recorded in ../../intermittent-ui/results.md; earlier statements about no authorized correction describe the prior validation phase.
