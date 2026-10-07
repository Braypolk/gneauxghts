# Clear image search without starting another query

Status: ready-for-human
Updated: 2026-10-06

## Report and cause

The user could not force-clear an image search without starting another query.
The shared SearchBar showed its Clear search button only for nonempty text;
image-only queries keep that text empty. A Chrome regression reproduced the
missing control. The search store already correctly retires pending image
requests on clear.

## Implementation

The shared search bar now accepts non-text query presence for its clear control
and expanded layout. Notepad supplies image-query presence through the existing
search owner. The Clear search button preserves input focus. Clearing releases
the preview and empties image/passage results; late responses/errors remain
rejected by the existing request admission counter.

## Validation

The browser regression failed before the fix and passed afterward. Focused
search-store/controller tests passed (31), including late image result/error
rejection after clear. Type checking passed with zero errors/warnings. The
browser flow covers main Clear search, preview Clear image query, Escape, and
subsequent current-viewer navigation without importing assets or editing notes.

## Follow-up: preview inside the bar

2026-10-06: Per the user's request, moved the thumbnail from the results-panel
header into the shared search bar's query-preview slot. It sits immediately to the right of the
magnifier while an image query is active; the ordinary Clear search control clears
it. Removed the duplicate preview clear button and its unused callback. Chrome
checks verified preview containment on desktop/narrow layouts, clear/Escape, and
subsequent viewer navigation. Type checking passed with zero errors/warnings.
