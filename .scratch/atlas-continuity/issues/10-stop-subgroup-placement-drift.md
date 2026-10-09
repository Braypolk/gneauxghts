# Stop subgroup updates from inflating saved map geography

Status: ready-for-human
Type: bug

## Report and reproduction — 2026-10-08

The map developed very large empty distances and elongated clouds after small
edits. Read-only inspection confirmed persisted coordinates, not a camera or
caption artifact: the Hidden map spanned roughly 54,847 × 24,574 world units;
one 20-note root had radius 29,707. Other visibility variants were also expanded.

A deterministic production-layout reproduction alternates two notes between two
subgroups while preserving primary membership and filenames. Six placement
passes displaced unchanged notes by more than 2,000 units. Enclosing-circle
separation recalculated each subgroup radius from its newly interleaved members,
pushed those members apart, and then persisted the expanded positions. Repeating
the operation grew the next circle again. The original no-op fixtures never
changed child memberships and therefore missed this feedback loop.

A second defect restored accepted positions only for retained root assignments.
Reassignment without a suitable new neighbor could therefore reuse the obsolete
SQLite migration hint loaded by publication.

## Correction

- Restore every known note's accepted position before deciding whether its
  assignment needs a local move.
- Apply subgroup circle separation only before note placements are established.
  Repartitioning settled notes changes boundaries; actual filename collisions
  continue through the existing local packing pass.
- Keep unchanged established regions anchored during neighbor separation.
- Record placement revision 1 in existing durable metadata, defaulting older
  states to revision 0. During migration, only retained multi-note clouds whose
  extent/anchor drift exceeds eight times a generous readable-packing allowance
  are repaired. Their relative directions are retained at a compact scale, then
  they are placed outside the nearest unaffected region. Current-content
  admission, identities, names, normal geometry and isolated notes are preserved.
  Normal generation admission publishes the repair; subsequent builds do not
  repeat it. Layout algorithm version 23 invalidates old derived artifacts.

## Verification

- The alternating-subgroup regression now has zero displacement.
- Regression coverage checks selective recovery, name preservation, serialized
  restart stability, and reassignment with a deliberately far stale cache hint.
- The running app admitted the Hidden-map repair during investigation: extent
  fell to roughly 7,050 × 4,976 units. A read-only replay of its repaired saved
  state through five placement passes moved 0/167 notes. A subsequent live
  generation comparison also found zero displacement and zero root reassignment.
- A geometry-only rendering of that saved state has compact clouds without the
  giant stretched envelope. The camera may need Fit map after the one-time repair.
- All 64 Rust Atlas tests pass, including native publication/restart/cache-loss
  coverage and the 2,000-note sequence fixture.

The repair does not reconstruct an unavailable historical layout or globally
compact unaffected regions. Temporary saved-map snapshots and replay code were
removed; no private note content was added to the repository.
- All 21 Rust architecture fitness checks also pass; `git diff --check` is clean.

## Follow-up architecture consolidation

[Issue 11](11-consolidate-accepted-layout.md) replaces the remaining group-change
flags and weighted incremental circle separation with immutable accepted
placements and one map-wide footprint index. Initialization and legacy recovery
are separate private paths; publication and sequence tests share the full
accepted-layout operation.
