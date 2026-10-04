# Scoped stale-navigation focus review

Status: ready-for-agent
Progress: Read-only Standards and Spec review complete. Reported route-disposal listener finding is closed by the reviewed component-local abort wiring and pending-IPC regression. No tests, browser runs, builds or source edits by reviewer.

## Scope and evidence

Applied repository `.agents/skills/code-review/SKILL.md` locally to the narrow new `captureFocusIntent` module and its integration in `openFlow.withNavigationFocus` and `NotepadWorkspaceSession.navigate/focusAfterPresentation/dispose`. The working tree has older cumulative changes, so this review explicitly excludes unrelated differences shown by `git diff HEAD`. Read the current issue01/spec, `ARCHITECTURE.md` navigation ownership rule, actual search selection/Notepad context callers, and root's controlled before/after logs.

`search-before.log` shows the paused Beta open completing after Alpha input and calling CodeMirror focus; Alpha input survives but the panel closes. `search-after.log` shows the same controlled journey retaining search focus and Alpha results. This establishes repair of that controlled defect, not attribution of the earlier uninstrumented formatting failure.

## Finding

**[P2, Spec] Retire the outer openFlow intent when its route/operation is disposed.** `src/lib/features/notepad/navigation/openFlow.ts:28–35` creates an interaction guard independent from `notepadWorkspaceSession.ts:166`. Workspace supersession (`192`) and disposal (`767`) retire only the workspace operation's guard. The outer one only reaches its `finally` after its action settles. If `openNotePath` remains blocked on IPC while Notepad is disposed, its five capture listeners stay attached to the window until a later interaction or IPC settlement. No disposal/cancellation registration reaches this outer guard through `NavigationContextSource`; current-context checks are lazy and do not remove listeners. Programmatic supersession has the same lifetime limitation.

This misses issue01's explicit “all listeners must be removed on success, failure, supersession or disposal” requirement. It is not a demonstrated wrong focus in the controlled after run. Connect this guard to the existing route/operation cancellation lifetime (including same-document operations that only await paint), and verify disposal removes its listeners without waiting for the blocked IPC to resolve. Keep ordinary settled cleanup in `finally`; do not add a timer or global manager merely to mask the lifetime gap.

## Behavior and timing assessment

- Ordinary search selection enters the guard synchronously from the initiating click/keydown handler. Window capture has already passed, so that initiating event does not cancel itself. Keyup/click following keyboard activation are not cancellation events. Search's ordinary programmatic element blur is correctly excluded by `event.target !== window`.
- Subsequent pointerdown, keydown, input, wheel, or window blur cancels only automatic focus/reveal. Note loading, outgoing persistence barriers, destination adoption and cursor restoration still run through their existing owners. This is consistent with the issue's intended limited scope.
- The workspace check occurs after its final tick, immediately before focus. The openFlow guard survives the note-open await and is combined with existing document/root correlation; its paint-time recheck suppresses later section scrolling/focus as well. Existing title-only behavior and semantic-only `focus:false` remain intact.
- The two guards have distinct necessary spans in the current arrangement: workspace covers named operations outside openFlow; openFlow extends through post-load targeting. This is not by itself an actionable duplication smell, though their cancellation lifetimes must both be owned.
- Success/error cleanup and first-interaction cancellation use the same listener identity/capture flag and are idempotent. SSR safely creates no browser listeners. Review found no event prevention, stale state write, or changed persistence ownership in the scoped patch.
- Existing new unit cases cover input during open and during paint, and root's real browser witness covers workspace late focus. No reviewer-run validation was performed. I did not find a new ordinary-search-navigation cancellation defect in the inspected call path.

Readiness: the controlled focus defect is repaired; resolve the explicit outer listener lifetime gap before claiming full cleanup acceptance. No additional Standards finding in this narrow scope.

## Smallest lifetime correction assessment

No existing abort signal is exposed by Notepad or `NotepadSessionLifecycle`; their disposal is an explicit synchronous callback. Prefer a component-local `AbortController`, its signal carried by `NavigationContext`, and abort at the start of the existing Notepad dispose callback. `withNavigationFocus` must obtain the signal before awaiting load; `captureFocusIntent(signal?)` must handle an already-aborted signal and remove its abort listener together with interaction listeners. This supplies the missing route lifetime without a global state owner, timeout, or a new generic phase protocol. It also covers operations that do not open a new note and only wait for paint. A window custom cancellation event is less plumbing but has cross-instance scope and implicit sender/listener coupling.

This route signal alone does not prove immediate listener cleanup for every *programmatic* same-route supersession; workspace's own operation cancellation remains correct, and a new real user input already cancels the old outer guard. If the explicit broader supersession requirement is retained, thread an existing operation cancellation signal rather than calling the route controller on each navigation (that would permanently abort subsequent valid navigation). Do not silently claim route disposal wiring satisfies that additional case.

Do **not** add unconditional `focusin` cancellation: destination presentation intentionally focuses the editor before openFlow's section targeting. That normal focus event would cancel the still-valid outer guard and suppress its section reveal. Pointer/keyboard/input/wheel/window-blur admission covers the demonstrated actual user interaction race and same-input typing; arbitrary programmatic focus without such input is outside this selected policy. Element blur must continue to be ignored.

## Follow-up review: route-disposal finding closed

Reviewed the final narrow correction read-only. `Notepad.svelte` now owns `navigationLifetime`, passes its signal through `getNavigationContext`, and aborts it as the first action in its existing disposal callback. `withNavigationFocus` reads that signal before awaiting note load. `captureFocusIntent` removes both window and abort listeners on cancellation/disposal and immediately cancels an already-aborted signal. Repeated cleanup is safe; no timer, global owner, document-write change, or unconditional focusin listener was added.

The added `openFlow.test.ts` case “releases pending interaction listeners when the workspace is disposed” holds the actual openFlow continuation behind a controlled pending open, aborts the supplied lifetime, and compares listener removals with additions **before** releasing that open. It then proves no reveal occurs after completion. This directly protects the reported route-disposal ordering rather than checking cleanup only after normal settlement. The component wiring was separately source-inspected; no reviewer-run tests were performed.

Disposition: close the concrete P2 route-disposal finding. No new correctness/Standards finding in this correction. The earlier note about arbitrary programmatic same-route supersession remains a scope qualification, not a reproduced focus failure: normal new user navigation cancels the old guard through its initiating interaction, workspace-owned operations retire their own guards immediately, and route disposal now retires outer guards as well. Do not describe the route signal as per-operation cancellation. Root owns final execution evidence.
