# Keep root cloud territories distinct

Status: ready-for-agent
Type: bug

## Evidence

The revision-3 affinity migration protected note/filename footprints, allowing
filled cloud spans and child outlines to interpenetrate. The user's saved map
contains 167 notes, 16 roots and 11 children at placement revision 3.
The durable head's artifact is authoritative; the older derived ready pointer
references different geometry and must not stand in for the current map. A production
sequence regression with nested note rings reproduces overlapping root contours
without any dot collisions; it fails before the correction.

## Correction

Whole-root clearance takes priority over attraction. Construct conservative
16-direction support envelopes from rendered root/child outlines and note
footprints. This accounts for a cloud's empty spans while avoiding oversized
circular collision radii. Repair interpenetrating roots with bounded directional
free-space placement, keeping isolated notes fixed and larger roots as anchors.
Semantic proximity optimization may only accept placements with visible clearance.

Placement revision 4 repairs already-admitted revision-3 maps once without rerunning
attraction. New maps and earlier migrations use the same whole-region constraint.
Sibling clearance runs bottom-up first, moving whole children and keeping direct
parent notes fixed. Parent outlines adapt around the separated children. Roots
then move as whole families. Child centroids, radii, core/outlier classifications
and final outlines are recomputed from accepted coordinates for exact replay. Geometry is still
owned by stable_layout::calculate and admitted through the existing map store;
ordinary unchanged updates cannot rerun migration. Algorithm revision 27 rebuilds
derived artifacts. No scoring changes are part of this correction.

## Validation

- The nested-ring production sequence fails on the prior implementation with
  `root clouds still interpenetrate`, then passes with territory clearance.
- Retained sibling regression checks independent contour intersection, parent
  containment, fixed isolated obstacles, rigid child spacing, and exact equality
  of positions, hulls, centroids, radii, core/outlier sets and labels after restart.
- Authoritative durable-head replay: 167 notes, 16 roots, 11 children. Its six
  overlapping sibling pairs become zero; root pairs remain non-overlapping.
  Every node position and every outline is exactly identical on the next
  calculation. Debug repair/contour time was 3.71 seconds; the revision gate
  prevents repeating this work on ordinary reopening. This is a geometry replay
  with saved membership, not a real-vault reindex or a semantic-quality claim.
- Inspected an anonymized before/after rendering of this accepted geometry.
- Independent standards/spec reviews completed. Follow-up review identified
  post-child-movement core classification and f32 centroid replay issues; final
  metadata/contour calculation now uses final accepted coordinates, covered by
  the exact replay test.
- All 77 retained Rust Atlas tests, 48 frontend Atlas tests, and 21 backend
  architecture checks pass. `pnpm check` passes with zero Svelte errors/warnings
  and clean E2E TypeScript checks.
- The earlier preview-cache replay was not the current accepted map. Its overlap
  counts are superseded by the durable-head replay above. Temporary replay code
  and JSON inputs/outputs were removed; no vault state was written.
- Scope: territory clearance is enforced during initialization and placement
  migration. Ordinary growth/reassignment retains the existing local note
  footprint policy, without recurring global re-packing.
