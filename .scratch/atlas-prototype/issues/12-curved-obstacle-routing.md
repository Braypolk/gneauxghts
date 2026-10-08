# Curve connections around Atlas clouds and notes

Status: ready-for-human
Type: task

## Request

Implement gentle curves with obstacle avoidance: use the gaps between clouds,
enter a cloud only to reach its endpoint, avoid notes/titles, keep paths
distinguishable, and preserve smooth zoom. Avoid excessive detours and shared
trunks that obscure individual connections.

## Change

`atlasRouting.ts` privately rasterizes world geometry on a bounded grid, runs
A* with source/outside/destination phases, prunes stair-steps and rounds safe
corners. Clearance covers unrelated cloud polygons, dots, filenames and region
captions. Light lane costs and validated offsets separate shared corridors.
Routes clip to node radii shared with the renderer. Existing routes are cached
across zoom, pan, selection and strength changes; geometry/title changes reset
the cache. Lazy construction avoids routing work in the unselected overview.

An excessive/unavailable strict route retries with penalized cloud crossings.
An unroutable connection retains a direct fallback rather than hiding any
authored relationship. Hover/focus uses the existing full-path emphasis.
A temporary panel checkbox enables comparison with the original straight lines.
No backend, persistence, score, geography or connection-count changes.

## Verification

Seven geometry tests sample the actual SVG curves for cloud clearance, single
source exit/destination entry, same-region dot/title clearance, lane separation,
cache stability/invalidation, unlimited authored routes, production layout and
fallback behavior when strict avoidance is impossible.
Browser tests cover curved/straight comparison, stable paths through zoom,
reselection and strength changes, an authored connection with an intervening
cloud, and full-path destination emphasis. All 43 Atlas unit tests and 17 map
browser tests pass. Type checking reports zero errors/warnings; the production
build passes. The live vault shows the new routes and the comparison toggle
preserves all eleven qualifying connections while switching their drawing.
Broad corner bends shrink adaptively where clearance requires a tighter curve.

Temporary read-only benchmarks against the 166-note cached vault measured
approximately 30 ms for the initial eleven routes, 0.3 ms for cache reuse and
42 ms to add the remaining sixty-eight routes at minimum strength zero. A
synthetic 2,000-note fixture with twenty long routes measured approximately
126 ms cold and 0.4 ms cached. These are local computation measurements, not
native-app frame timings. The temporary benchmark was removed.
