# Compact clouds and distinct sibling concepts

Status: ready-for-agent
Type: bug

## Evidence and scope

The current durable Hidden head already records placement revision 4 but still
contains six intersecting sibling pairs. Its largest leaf contains 20 notes
across a 778 by 669 world-unit span. The one-time territory repair is not a
continuing constraint; retaining every internal coordinate also preserves sparse
legacy clouds. Frontend projection consumes these accepted contours directly.

## Intended behavior

Keep organic contours and cloud identity. Contract excessive empty space inside
leaf clouds, using note/filename footprint area to allow reasonable growth.
Distinct siblings get separate territories within their parent. Unaffected roots
are fixed during incremental updates. Unchanged siblings retain placement within
their parent; an affected parent family can translate rigidly for root clearance. Relatedness still
seeds placement, but cannot override region readability. No recurring global
attraction or map reflow on navigation/content-only changes.

One admitted revision repairs existing maps. Later new memberships, subgroups,
and changed footprints invoke the same local constraints. Deletion and renames
that fit their old footprint do not repack accepted notes. Parent and child fills
intentionally nest; separate sibling concepts do not interpenetrate.

## Validation

Sparse-leaf production-seam regression fails on prior code: `sparse leaf still
encloses mostly empty space`. The completed sequence and accepted-map checks are recorded below.

## Implemented

`stable_layout::calculate` now determines affected clouds from accepted membership,
footprints and coordinates. Excessive leaf extent contracts around the member mean
using footprint area and slack, resolving note collisions with the existing local
placement index. Sibling then root clearance uses the existing support-envelope
solver; unaffected participants are stationary. Geometry remains under one backend
owner, with no additional persisted state or frontend placement pass. Placement
revision 5 applies this once to existing maps; algorithm revision 28 invalidates
old derived geometry. Subsequent unchanged input skips constraint repair.

The older repartition regression required every position to remain fixed even
when sibling regions interpenetrated. Updated it to require separate siblings
following the structural change and exact positions on repeated unchanged input.
The nested-ring fixtures now have compact internal geometry, preserving their
rigid-translation assertions independently of sparse-leaf contraction.

## Verification

- Authoritative accepted-map replay: all six sibling intersections removed;
  root pairs remain separate. The 20-note sparse cloud's span falls from
  778×669 to 313×323 world units, and its filled area falls about 76%.
  Node positions and cloud contours are exactly identical on the next calculation.
- Inspected anonymous before/after geometry rendering; no live vault writes.
- Production-seam regressions cover sparse-leaf contraction, unaffected root
  positions, note clearance, newly visible siblings on a current placement
  version, structural repartition, and unchanged restart.
- Independent standards and spec reviews found no blocking issues. Clarified that
  unchanged siblings retain placement within a parent; an affected family may
  translate together to clear another root. Direct-parent-note versus child-fill
  intersections remain an existing separate limitation of stationary parent notes.
- Frontend Atlas tests: 48 passed. Backend architecture fitness: 21 passed.
  `pnpm check`: zero errors/warnings; E2E TypeScript checks pass.
- Temporary accepted-map replay source removed; no private note content retained.
- Final retained Rust Atlas suite: 79 passed, including the 2,000-note no-drift
  fixture. `git diff --check` passes.
