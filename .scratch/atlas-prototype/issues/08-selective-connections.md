# Show selective, relevant connections

Status: ready-for-human
Type: task

## Request and evidence

The focused note appears connected to everything. Prefer the most important
and relevant connections, with occasional variety. The cached snapshot for
`updates for kylie.md` contained 79 incident edges, with 25 still above the
original focused strength floor of 0.7. Filtering by confidence alone leaves
too many lines.

## Implementation

`atlasConnections.ts` indexes each published response once and selects up to
seven unique neighbors. Authored links rank first, then published strength,
raw similarity score and stable ID. Invalid/missing/self links are excluded;
semantic links require finite scores and strength >= 0.7. Authored/semantic
duplicates to the same neighbor collapse to the authored edge.

The strongest six remain fixed. If more than seven relevant candidates exist,
one slot can vary among the next five, restricted to candidates within 0.08
strength of the sixth anchor. No rotation displaces an authored link. A stable
note-ID offset plus an explicit-selection counter supplies variety; no timer,
camera change, hover movement or reader cycling advances the counter. If no
competitive alternative exists, show fewer connections rather than padding.
The seven-edge ceiling also applies to notes with many authored links.

The map edges, focused filenames, dot emphasis and reader neighborhood share
this policy. Reader browsing keeps its origin neighborhood and follows rank
order; search continues to use its existing independent matching-note pool.
The footer discloses shown versus total valid distinct-neighbor candidates.
Removed redundant incident membership/opacity branches. Backend projections,
geography and activity writes are unchanged.

## Validation

Five unit cases cover hub bounds, authored priority, duplicate collapse,
stable anchors/controlled variance, response-order independence, invalid and
weak candidates, a confidence cliff and authored-only hubs. The browser journey
checks graph/label/reader agreement, no reshuffle on zoom, variety on explicit
reselection and relevance-ordered reader browsing. The live 166-note preview
shows seven of the example note's 79 candidates.
All 15 map browser regressions pass, type checking reports zero errors/warnings,
and the production build passes.

## Follow-up

The user replaced the fixed budget and variance with strength-based selection
and unlimited authored connections. Current behavior is recorded in
[09-strength-based-connections.md](09-strength-based-connections.md).
