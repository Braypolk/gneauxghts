# Close excessive spacing left in accepted map geography

Status: ready-for-human
Type: bug

## Evidence — 2026-10-08

The clouds are compact but some are far from every other cloud. Read-only live
metadata confirmed that this is saved spacing, not current layout churn: 0/167
notes moved between the last two generations. Hidden geography covered roughly
7,050 × 4,976 world units; small roots had nearest contour gaps of 1,765–2,983
units. The prior repair compacted stretched clouds but did not reduce empty
space between otherwise healthy roots.

## Correction

Private `stable_layout/region_spacing.rs` measures gaps between actual filename
footprint envelopes. Roots and nearby isolated notes within 420 world units form
one neighborhood. Disconnected neighborhoods join across their nearest gap;
excessive gaps shrink to 210 units by rigid translation. The largest retained
neighborhood stays anchored. Internal note spacing, nearby-cloud relationships,
identities and names remain intact. A move is shorter than the nearest distance
to any other component, avoiding new footprint overlap.

This policy runs after initial placement and once for placement revisions below
2. Revision-zero extent/collision repair remains separately gated below 1.
Ordinary accepted updates never invoke compaction. Layout algorithm version 25
invalidates derived artifacts through existing publication compatibility.

## Validation

- All 69 Rust Atlas tests pass, including native publication/restart/cache-loss
  coverage and the 2,000-note fixture.
- The new production-calculation sequence reproduces a third cloud stranded over
  8,000 units away; compaction leaves the main neighborhood exactly fixed,
  translates the remote cloud rigidly, retains its name/identity, and remains
  exactly stationary after serialized restart and a same-footprint rename.
- The live application admitted revision 2 through its normal worker: Hidden
  extent is now 4,316 × 3,071; Remembered 4,555 × 4,131; All 3,788 × 4,187.
  A read-only repeat of the spacing policy moves 0/167 notes in each variant.
  Subsequent live revision-2 generations also retain all 167 notes at exactly
  the same coordinates in all three visibility variants.
- Independent focused review found no blocking defect in component joining,
  anchored translation, or migration gating. `git diff --check` passes.
- All 21 architecture fitness checks pass.

This reduces excessive envelope gaps; it does not enforce uniform spacing along
all concave organic contours. Private note content was not added to the repo and
live map files were not edited directly.
