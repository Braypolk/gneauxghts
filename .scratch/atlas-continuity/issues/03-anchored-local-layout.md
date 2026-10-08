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
