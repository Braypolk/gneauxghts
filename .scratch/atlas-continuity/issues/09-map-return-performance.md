# Keep smooth-cloud caption placement fast on map re-entry

Status: ready-for-human
Type: bug

## Report and cause

Switching from another page back to Map became noticeably slower after the cloud
contours grew from 48 to 384 samples. Each AtlasMap mount creates a fresh layout
instance, so its caption search runs synchronously again. The search scanned
hundreds of polygon edges for every proposed label corner, including placements
already covered by note labels. Each scan calculated segment distances with
`Math.hypot`. Refreshing the same component reused its layout and hid the cost.

## Correction

Caption placement prepares polygon edges and bounds once, uses squared clearance
checks with the existing inclusive rule preserved at floating-point ties, and
rejects occupied candidates before testing their corners once a fallback exists.
Candidate order, fallback selection, full-resolution contours, note positions,
and per-activation backend freshness checks remain intact. No cross-route cache
or additional geometry owner was introduced.

## Evidence — 2026-10-08

- Read-only replay of the current saved geometry: 166 notes, 29 clouds, 384 points
  per outline. Fresh/remounted layout took about 740–760 ms before the fix;
  replacing only the outline sampling with 48 points took about 103 ms.
- Optimized replay: about 22 ms cold, 15 ms remounted, 1 ms same-instance refresh.
  All caption coordinates and font sizes matched the original output exactly.
- Fictional 2,000-note/18-cloud replay: about 5.6 seconds before, 60–115 ms after.
- Browser regression now uses 384-point accepted-world clouds and navigates away
  and back. Measured re-entry was 193 ms, including rendering, under a generous
  1-second guard. The fixture retains all 2,000 notes.
- Geometry equivalence checks cover concave waists, margin ties, and empty hulls.

Measurements are local diagnostics, not production latency guarantees. No private
note text or saved-map payload was added to the repository.

Validation: 20 frontend geometry/layout/routing/motion tests, all 26 browser map
tests, and `pnpm check` pass (zero errors/warnings). Temporary replay scripts and
caption snapshots were removed after recording the aggregate measurements.
