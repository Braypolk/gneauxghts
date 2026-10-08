# Morph accepted map updates while preserving exploration

Status: ready-for-human
Type: task
Blocked by: 04, 05, 06

## Outcome

Local changes settle smoothly without disrupting inspection, naming, camera
position or current-content correctness.

## Work

Add one correlated frame clock for node, hull, caption, and connection transition
geometry; interruptions start from the current displayed pose. Stable angular
boundary samples support morphs; split/merge lineage supplies enter/exit behavior.
Keep reduced motion immediate. Selection and hit targets follow admitted IDs and
displayed geometry. Excluded/deleted notes disappear immediately, not after a fade.

Maintain the inspected/named region's screen anchor during transitions without
turning exploration into durable position pinning. Do not defer source invalidation
or current-content admission. Keep camera gestures interruptible and Fit map
explicit. Avoid expensive routing every frame; use a bounded safe transition
representation and compute normal routes for settled geometry once. Preserve all
authored links. Dispose clocks/state on scope/lifetime change. Follow [the spec](../spec.md).

## Acceptance and verification

- Mid-morph updates continue from the displayed pose without jumps.
- Camera/search/region inspection/naming remain stable and keyboard accessible.
- Splits preserve recognizable positions and promote the existing child identity.
- Deleted sources/marks cannot remain interactable through transition state.
- Reduced motion, disposal and visibility changes have no lingering animation.
- Browser tests exercise interrupted transitions and live exploration; measure
  routing work and frame behavior on the existing large fixture.

## Implementation — 2026-10-07

One bounded interruptible frame clock drives admitted geometry. Reduced motion, immediate deletion, inspection anchoring and settled routing are implemented. Motion unit tests and browser interaction coverage pass.

See [evaluation and limitations](../evaluation.md).
