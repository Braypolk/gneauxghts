# Close large internal gaps within a cloud

Status: ready-for-agent
Type: bug

## Evidence

The accepted revision-5 security cloud has 17 notes and no child clouds.
Its largest vertical gap is 260 world units within a 535-unit height. The
radius-based compactness check sees extent 334 below its 463-unit threshold:
long filenames increase the footprint budget without revealing the empty gap.

## Required behavior

Detect excessive empty gaps between spatial note neighborhoods using their actual
footprints, independent of overall cloud size. Bring disconnected neighborhoods
closer as rigid units, retaining their internal spacing and anchoring the largest
neighborhood. This is geometric cleanup, not semantic subgroup creation. Keep
cloud identities, unrelated roots and unchanged accepted replay stable. Apply to
existing maps once, then use the existing changed-cloud gate for local updates.
Reuse the existing gap-closing calculation rather than a second force solver.

## Implemented

The existing region-spacing calculation now exposes its private footprint-gap
operation. Both root-spacing migration and leaf cleanup use it. Leaf cleanup
connects nearby note footprints, anchors the largest connected neighborhood, and
translates disconnected neighborhoods toward each other. It runs before the
existing overall density check and subsequent sibling/root territory clearance.
No semantic identities, memberships, persistence owner, or renderer layout changed.
Placement revision 6 repairs saved maps once; algorithm revision 29 invalidates
older derived artifacts. The existing affected-cloud gate handles later updates.

## Validation

- New production-seam regression failed before correction with `long filenames
  still mask the empty gap between neighborhoods`.
- All 80 retained Rust Atlas tests passed, including earlier rigid root-spacing,
  sibling clearance, unrelated-region stability and 2,000-note stationary replay.
- Anonymous replay of the authoritative 167-note map passed. The security cloud's
  internal vertical gap shrank from 259.8 to 105.0 world units. Its groups of 4 and
  13 notes retained their relative coordinates (within f32 rounding). All sibling
  and root pairs remain disjoint; a second calculation preserves every coordinate
  and outline exactly. Inspected an anonymous before/after rendering.
- Temporary replay source removed. This did not write to the user's vault or
  exercise a live app rebuild; runtime appearance remains a visual follow-up.
- Local review covered both spec and architecture: this reuses the existing
  bounded geometry calculation and preserves the backend's single ownership.
- Final focused regression additionally verifies that the larger neighborhood
  remains anchored, with three moving notes and five stationary notes; passed.
- All 21 backend architecture checks and `git diff --check` pass. Anonymous
  replay inputs/outputs and temporary scripts were removed.
