# Smooth highway forks and enforce dot clearance

Status: ready-for-human
Type: task

## Request

Fix the harsher angles and routes passing too close to unrelated notes in the
image-cloud fan-out screenshot.

## Diagnosis

Dot avoidance was a soft cost, so a straighter candidate could win while crossing
an unrelated dot. Final curve validation only enforced cloud silhouettes.
Clamping only the branch's initial direction could concentrate bending at its
first knot; older cubic fallback branches could also reintroduce a sharper fork.

Read-only reproduction against the published cached vault found negative
edge-to-line gaps in the image cloud, including the Falcon & Automation Stack
neighborhood. Two geometry regressions reproduced a dot crossing and excessive
curvature at a highway junction before the fix.

## Change

Unrelated dots now reserve six world units beyond their radius. The seed search,
shortcut pruning, elastic relaxation and final curve validation honor that gap;
final validation checks sampled curve segments rather than only knots. The two
actual endpoints are exempt. Cloud avoidance can yield before dot clearance.
A spatial index limits clearance checks to nearby notes.

A broad departure profile carries highway direction into the branch. The global
spline adjusts its adjacent free knots to match zero curvature as well as the
shared tangent at a fork. Branches that cannot retain these constraints use an
independent route rather than the older sharper fork fallback. Filenames remain
soft obstacles; authored links, score filtering and route caching are unchanged.

## Verification

All 47 Atlas unit tests and 18 map browser tests pass. The new geometry tests
sample the public SVG curves for six-unit dot clearance and gentle initial
curvature. The browser highway fixture contains an unrelated dot near a final
approach and verifies the rendered full SVG routes clear its visible radius,
while retaining shared trunks, highlighting and stable slider behavior.
Type checking and the production build pass.

The temporary cached-vault probe checked all visible routes for the three source
neighborhoods matching the screenshot's destination notes. Minimum gaps were
approximately 7.13, 6.55 and 6.63 world units. The Falcon image-cloud branches
were inspected in the live browser at close zoom. Temporary instrumentation and
the vault-dependent probe were removed.
