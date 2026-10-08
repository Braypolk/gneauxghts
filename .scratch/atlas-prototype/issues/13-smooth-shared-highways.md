# Smooth forward routes and shared Atlas highways

Status: ready-for-human
Type: task

## Request

Replace the sharp, backward cloud-exit detours shown in the updates-for-Kylie
example. Keep within-cloud connections direct and bundle routes heading toward
the same destination cloud into shared highways. This supersedes the separate
lanes and strict exit/entry phases in issue 12.

## Change

The geometry router uses monotone A* progress, wider cloud clearance, soft
note/title costs, broad cubic splines and common tangents at joins. It no longer
forces connections out of their own cloud. Source-oriented routing uses the
selected node even when the backend edge is stored in reverse order.

A stable gateway toward each destination cloud supplies a shared trunk and
smooth individual branches. The renderer draws that trunk once when at least
two visible connections share it. Hover/focus highlights an individual full
route. Dropping to one connection renders its unchanged full path, so strength
filtering does not change its geometry. Cached world geometry remains separate
from the camera. Authored links remain unlimited. The comparison toggle stays.

## Verification

All 44 Atlas unit tests and 18 map browser tests pass. Coverage includes sampled
cubic cloud clearance and forward progress, same-cloud dot/title clearance,
shared-trunk/branch tangent alignment, reverse edge orientation, cache stability,
unlimited authored edges, fallback behavior, actual highway rendering,
full-path emphasis, zoom stability and slider changes. Type checking and the
production build pass.

Read-only measurement of the 166-note cached vault: eleven qualifying routes,
two highways, approximately 28 ms cold and 0.3 ms cached; adding the other 68
routes took approximately 33 ms. Sampling every qualifying full curve found no
backward progress, including the updates-for-Kylie to NPG-Tasks route. These are
local geometry computation timings, not native WebKit frame measurements.
The temporary benchmark was removed. The live map was inspected at normal
viewport size with the selected note and new shared highways.
