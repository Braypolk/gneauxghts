# Keep cloud geography anchored during local changes

Status: ready-for-human
Type: task
Blocked by: 02

## Outcome

Growing or shrinking a theme primarily changes its boundary and nearby notes.
Unrelated clouds keep their position and relative neighborhood.

## Work

Replace routine global placement with the continuity-based local adjustment in
[the spec](../spec.md). Seed accepted clouds/notes from durable positions; use
global UMAP for initial layout or candidate structure rather than unconstrained
routine placement. Remove highest-centrality recentering and origin attraction.
Add movement/direction penalties with stronger anchors for unaffected regions.
Place new notes/clouds locally. Stabilize boundary sample correspondence and
adjust affected envelopes/neighbors for clearance.

Include final readable filename spacing in accepted geometry: port the existing
conservative visible-title extents/world text size into the private backend layout
policy. Reconcile existing placements by Note Identity and resolve changed labels
locally. Publish final note positions, not pre-renderer-packing targets, so cold
restart and incremental updates share one geometry authority. Keep viewport and
camera out of this calculation.

Keep finite coordinates, containment and readable non-overlap constraints. Movement
budgets are soft when resolving real crowding, with local minimum-displacement
resolution rather than an overlapping result. Persist only final admitted targets.

## Acceptance and verification

- Unchanged inputs and activity/label-only updates have stationary geometry.
- Related addition/removal keeps unaffected anchors and relative directions.
- New isolated notes cannot recenter/rescale the whole map.
- Dense growth and neighboring obstacles retain containment and clearance.
- Long filename changes adjust only required local spacing; backend/display title
  and world text-size contracts agree.
- A clearly required local collision adjustment can exceed soft motion limits.
- Sequence fixtures measure displacement and layout time; compare to baseline.
- Run focused geometry/publication tests and applicable Rust formatting.

## Implementation — 2026-10-07

Accepted positions initialize local packing, anchored envelopes and clearance. Promotion/replacement lineage preserves saved positions. Dense filename and stationary 2,000-note fixtures pass.

See [evaluation and limitations](../evaluation.md).

## Comments

2026-10-08: Corrected a visual regression reported by the user. The final geometry
step had replaced node-following blobs with nearly circular collision envelopes.
Visible hulls now use directional member/filename footprints and child outlines,
with 48 corresponding samples for stable interpolation. Collision radii and
accepted positions remain the spacing authority. Layout version 18 refreshes
existing artifacts. Regression coverage checks elongated member distributions,
unchanged-input stability, wide filenames and parent/child containment.

2026-10-08 follow-up: Tightened the contours after screenshot review. Corrected
support-distance interpretation: neighboring boundary lines now intersect to
form a rounded envelope instead of projecting their distances radially. Reduced
note-footprint margins and replaced proportional outline expansion with a fixed
6-world-unit border, including around child clouds. Parent margins therefore do
not grow with their diameter. The 96 ordered boundary samples remain deterministic;
layout version 19 refreshes cached outlines without relocating notes. A rendered
fixture and a regression for sparse groups and repeated parent wrapping verify
that the outline no longer gains excess sideways padding.

2026-10-08 corner refinement: Softened abrupt turns by averaging along a short
fixed-length contour window and publishing 384 evenly spaced perimeter samples.
Rounding stays inside the tight envelope, so it adds no parent padding and leaves
accepted note positions intact. Layout version 20 refreshes existing outlines.
A rendered two-child/parent fixture confirms the softer silhouette; the 59 existing
Rust Atlas tests and 19 frontend geometry/motion tests pass, including filename
and child containment, unchanged-input stability, and the 2,000-note fixture.
A focused curvature regression also checks gradual turns and unchanged bounds.

2026-10-08 organic-shape refinement: Restored the original two-, three-, and
five-wave contour character, seeded by the persistent cloud ID. Waves now follow
the fitted perimeter instead of scaling collision radii. Empty areas can dip
inward, limited smoothly by distance to note/child footprints; outward variation
is capped at 18 world units for leaves and 8 for parents. A final contour smoothing
pass removes sharp turns. Layout version 21 refreshes the visible hulls without
moving accepted notes. Inspected a rendered parent/two-child fixture. All 60 Rust
Atlas and 19 frontend geometry/motion tests pass, plus a standalone 100-identity
fixture verifying deterministic outlines and complete child containment.

2026-10-08 parent-region refinement: Parent envelopes now contract through empty
space between member/child footprints, leaving rounded lobes and a connected
waist. Local footprint clearance protects containment, and the envelope's opposite
side bounds contraction so sparse groups stay connected. Existing organic leaf
contours and accepted positions are unchanged. Layout version 22 refreshes hulls.
Parents have lighter fill/outline; child contours remain faintly visible at overview
zoom, while child captions retain their zoom/inspection rule. Parents render before
children. Removed a redundant smoothing pass after a containment check exposed
corner trimming. Verified the rendered two-lobe fixture, a new waist/containment
regression, 100 identity variants, 61 Rust Atlas tests, 19 frontend geometry tests,
26 browser map tests, and `pnpm check` (zero errors/warnings).
