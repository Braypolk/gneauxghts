# Search filter clicks and native text correction

Status: resolved

The October 23 recording showed a separate failure from the earlier startup
focus race. macOS corrected the search query `test` to `Test` immediately before
mouse-down. That new query cleared results and shortened the bottom-anchored
popup, leaving the pointer over the editor. The editor then received the click
and search lost focus. Reopening worked because the correction had committed.

The shared search input now disables autocorrection, autocapitalization and
spellchecking, preserving the exact query during filter selection. Owner:
`src/lib/ui/search/SearchBar.svelte`.

## Native reproduction and verification

With user permission for foreground input, a temporary app bundle ran the pinned
native E2E executable with the harness's disposable vault. CUA supplied actual
typing and mouse clicks; a temporary document listener recorded input, pointer
and focus ordering through the real WebKit page. Four fixture notes contained
`test`; unavailable semantic setup left lexical matches visible.

Before the change, typing `test`, waiting about a second and clicking the visible
Notes position reproduced dismissal. The captured sequence was:

| Relative time | Event | Query | Popup height | Target |
| --- | --- | --- | --- | --- |
| 0 ms | beforeinput: insertReplacementText | test | 442px | Search input |
| 1 ms | input: insertReplacementText | Test | 442px | Search input |
| 9 ms | pointerdown / mousedown | Test | 110px | Editor line |
| 12 ms | focusout | Test | 110px | Search input |
| 13 ms | focusin | Test | 110px | Editor |

After a fresh page loaded the change, the same native typing, delay and physical
click reached Notes. A fresh query followed by Images also worked. Both retained
`test`, input focus and the open popup. The captured pointer-down events were
trusted, targeted the intended filter, and saw the full 442px panel. No
`insertReplacementText` events occurred during the fixed run.

The temporary app, diagnostic spec and configuration were removed after the
comparison. The ordinary native `search-filter-click` suite dispatches synthetic
DOM mouse events and cannot establish this OS correction behavior; its earlier
passing result did not verify the reported failure. The browser filter suite
continues to cover popup padding, button edges, stable filter refresh geometry,
Retry removal and keyboard dismissal.

## Loading presentation follow-up

Historical: the loading bars, skeletons and their animation described below
were superseded by the debounced result presentation at the end of this record.

After restarting, the user confirmed the click fix and reported a brief
“Searching notes…” flash when switching filters. The popup rendered that label
immediately whenever retrieval cleared an incompatible result set.

`NotepadCommandBar.svelte` now follows chat's static placeholder treatment:
200 ms before a 160 ms reveal, with the same reserved loading-row footprint.
Fast requests show no visual loading cue; slow requests show two muted bars.
The existing-result refresh label uses the same delay. Readiness never waits
for the animation. Reduced motion removes the fade while preserving the delay;
screen readers receive a status and the popup exposes its immediate busy state.
Search admission and result compatibility remain owned by the search store.

The WDIO session reproduced the immediate label before the change, then checked
the hidden early placeholder and visible slow placeholder. The exported
`search-loading.e2e.js` covers quick type/date changes at wide and narrow widths,
including reduced motion. The existing filter suite checks the slow reveal,
retained geometry and completed empty state. These are browser fixture checks;
this follow-up does not repeat the earlier OS input experiment.

Validation: all 14 browser cases across search loading, filter UX, recovery and
retrieval cues passed on fresh replay. `pnpm check` passed with no Svelte errors
or warnings and a successful E2E TypeScript check.

## Retained results and fixed height

The user preferred retaining the old list over even a quiet blank interval when
changing filters. `NotepadCommandBar` now captures a display-only preview before
type/date changes. Canonical search arrays still clear at the existing store
boundary. The preview survives partial channel delivery and superseded requests,
then swaps when both channels finish successfully. Failure leaves it inert with
Retry; query/scope/image-source changes and popup dismissal retire it.

Retained rows cannot supply pointer, keyboard or split selection. A focused row
requests the existing input focus handoff before becoming inert. Selection/scroll
synchronization pauses while the preview is displayed. Loading feedback remains
delayed and sits outside the result flow so it cannot move the list.

The old measured minimum-height reservation is removed. `SearchResultsPanel`
uses a fixed 26 rem height, clamped to available viewport space. Its result list
scrolls below the filter controls; empty results and new queries preserve the
same shell dimensions. A 390×520 browser capture verified viewport containment.

`search-filter-continuity.e2e.js` covers both channel ordering, pointer/keyboard
selection blocking and recovery at wide/narrow widths, focused-row handoff,
crossed requests, failure/Retry, query retirement and scrolling in a short window.
The preceding loading-only treatment is retained for searches without an existing
list to preview. The earlier native correction coverage boundary still applies.

Final validation: all 19 cases in the five search browser suites passed on fresh
replay, including the focused-row handoff. `pnpm check` passed with zero Svelte
errors/warnings and a successful E2E TypeScript check. Owned sessions and fixture
servers were closed.

## Full result skeletons

At the user's request, the two small initial-loading bars were replaced with
three result-card skeletons: title, section metadata, retrieval badge and excerpt
shapes. Image-only searches use thumbnail blocks and compact text rows. The
existing 200 ms delay, reduced-motion handling, fixed popup height and retained
filter previews are preserved. Browser captures verified the wide note layout
and the image layout in a 390×520 viewport. `pnpm check` passed.
All seven existing loading/continuity browser checks passed on fresh replay;
the owned browser session and fixture server were closed.

## Skeleton handoff and split-action spacing

Visible skeletons now crossfade with ready results over 160 ms in one grid cell,
preserving the fixed popup height. Fast searches that never reveal the skeleton
skip the handoff animation. Reduced motion swaps immediately; its delayed static
loading reveal explicitly overrides the global animation reset, which otherwise
left the placeholders invisible.

Note skeletons reserve the same split-action gutter as real rows: 32 px normally
and 44 px on narrow screens, with the shared touch-target class. Image-only rows
retain their full width. Narrow-screen verification also exposed a real result
button's intrinsic minimum width overflowing its available space; `min-w-0` now
allows it to fit beside the split action.

WDIO captures verified the wide skeleton and the mobile crossfade midpoint.
`search-skeleton-transition.e2e.js` checks overlapping fades, unchanged card,
split-action and popup geometry, reduced-motion readiness, and image-only layout.
All 23 cases across the six search browser suites passed on fresh replay.
`pnpm check` passed with zero Svelte errors/warnings and a successful E2E
TypeScript check. The owned session and fixture server were closed.

## Steady debounced result presentation

The latest app recording showed repeated clearing, intermediate results and
skeletons during typing. The supplied Spotlight recording decoded without its
search UI; the user's description established the desired quiet result update.
All search skeletons, including their split-action placeholders, and the visible
loading cue have been removed. The obsolete loading and skeleton-only browser
specs and fade helper were removed with them.

`NotepadCommandBar` retains its previous presentation through query edits and
filter changes until input has been quiet for 250 ms and retrieval settles.
Typing extends the same quiet period rather than exposing intermediate queries.
Existing pinned/browse content can remain through the first search. Old rows
remain inert, including their split actions and keyboard navigation; clearing,
scope/image-source changes and dismissal retire the preview and timer. The
fixed, viewport-bounded popup height and scrolling result area remain.

`NotepadSearchStore` now publishes notes and images together after both channels
settle. Its 120 ms retrieval debounce, request supersession and compatibility
rules are unchanged. A failed replacement retains its preview with Retry unless
a successful channel supplies usable new results. Same-query retries keep their
compatible results visible. The channel-publication regression failed before
the change and passed afterward.

The named WDIO session `search-quiet-results` verified burst typing, partial
delivery, first-search content retention, stale selection blocking and
cancellation. Inspected captures covered wide and narrow layouts. The exported
`search-result-presentation.e2e.js` adds frame samples proving that intermediate
query lists and blank result frames do not replace an existing list, including
reduced motion. These are browser fixture checks; this presentation change does
not repeat the earlier native OS correction experiment.

Final validation: 66 focused store/command-bar unit cases passed. All 14 browser
cases in presentation, continuity and recovery passed on fresh replay after the
final retry and scrolling fixes; the six filter-UX and three retrieval-cue cases
also passed during this change. `pnpm check` reported zero Svelte errors or
warnings and passed E2E TypeScript checking. `git diff --check` passed. The named
session and its server were closed before replay; replay's owned browser and
fixture processes exited afterward.

## Follow-up audit

The audit covered the working-tree search changes against the user's final
presentation requirements, with independent standards and spec inspections.
No obsolete skeleton implementation or fade helper remained. Preview ownership,
request supersession, focus boundaries and timer/listener disposal needed no
further restructuring.

One missed case was reproduced: deleting the text refinement from an image query
kept its image source active but cleared the presentation snapshot. With media
retrieval held, the popup contained zero image rows and no retained preview.
`NotepadCommandBar.onSearchInput` now retires an empty-text preview only when no
image source exists. Deleting just the refinement keeps the prior list inert
until replacement is ready; the explicit Clear control still retires both the
image and preview and rejects a late response.

The `search-audit` WDIO session established the failure before the correction
and verified the original journey afterward. Its exported regression is
`search-image-refinement.e2e.js`. The owned session and fixture server were
closed before fresh replay. This remains frontend fixture coverage.

Audit validation: all seven cases in image refinement and result presentation
passed on fresh replay. `pnpm check` passed with zero Svelte errors/warnings and
successful E2E TypeScript checking; `git diff --check` passed. Focused re-review
found no further actionable defects. Replay's owned processes exited.
