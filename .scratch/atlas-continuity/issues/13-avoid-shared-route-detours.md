# Prevent oversized shared connection detours

Status: ready-for-human
Type: bug

## Evidence — 2026-10-08

The selected-note screenshot showed a route looping far below the map. A replay
of the saved response reproduced it. A reduced, anonymized geometry fixture has
three notes and two irregular cloud silhouettes; the old route travels 2.73 times
the direct endpoint distance.

Two mechanisms contributed. Gateway selection accepted the first feasible
clamped spline even when matching its entry tangent required a large excursion.
Independent routing also exhausted its 30,000-entry search budget on equivalent
long diagonal grid paths, falling through to an unsafe direct cubic.

## Correction

- Grid search uses octile distance and deterministic goal-progress tie breaking
  for equal costs. The existing search budget stays bounded.
- Smoothed results carry actual travel length and whether they retained full
  clearance. Candidate shared gateways are ranked by smoothed travel plus
  remaining distance to the destination cloud center.
- Sharing may add up to 35% travel compared with a fully clear independent path.
  Longer shared detours use that independent route. Relaxed/unchecked fallbacks
  cannot displace a verified shared route merely because they are shorter.
- Selection remains geometry-based and cached independently of filtering/order.

## Verification

- The new fixture fails against the old router (2.73× direct distance) and passes
  with the correction, including forward travel and six-unit unrelated-dot clearance.
- Existing shared-fork, curvature, obstacle, filtering and link-retention coverage
  passes. One former forced-sharing fixture now asserts the intended independent
  choice: its shared routes were 812/873 units versus clear alternatives 502/552.
- All 48 retained Atlas frontend tests pass; the temporary saved-map replay also
  passes with all 24 requested links retained. Its worst reported excursion falls
  from 1.226× chord to 0.063× chord. Replay runtime is roughly 2.4 seconds for the
  full saved geometry and selected-note neighborhood.
- `pnpm check` passes (Svelte: zero errors/warnings; E2E TypeScript: success).
  Local review completed; the independent follow-up was interrupted before
  inspection and does not provide an additional approval.

No connection scores, cloud membership, or accepted geography changed. Temporary
replay code and private saved-map snapshots were removed. The retained fixture
contains only geometry and synthetic identifiers/labels.
