# Render accepted readable world coordinates directly

Status: ready-for-human
Type: task
Blocked by: 03

## Outcome

Backend continuity remains visible: a new note or long filename does not rescale
the map or repack every cloud.

## Work

Remove dataset-bounds normalization and the independent full-map packing/
separation pass from `atlasLayout.ts`. Render issue 03's accepted readable world
geometry directly. Cache geometry separately from captions/activity; keep camera
and captions in the renderer. Cold restart/remount must render the same admitted
positions, without frontend persistence or semantic decisions. Keep any legacy
packing path temporary and remove it after migration. Keep Fit map explicit and
preserve normal refresh/search camera behavior.

Audit routing-cache invalidation and region selection against stable IDs. Prepare
layout output for child hulls without duplicating note marks. Follow [the spec](../spec.md).

## Acceptance and verification

- Adding a faraway isolated note leaves existing world positions unchanged.
- Small edits/additions and title-length changes visibly adjust only necessary neighbors.
- Refresh/remount/cold restart renders the same accepted placement for the same map scope.
- Labels/activity/search and camera changes do not invalidate geography.
- All notes remain readable/contained; deletion removes marks immediately.
- Extend layout/store/browser map regressions, measuring rendered displacement;
  exercise dense names and the existing 2,000-note fixture.

## Implementation — 2026-10-07

Backend geometry includes readable world placements. The renderer consumes these coordinates directly; a distant addition has zero retained-note displacement. Legacy fallback remains for migration.

See [evaluation and limitations](../evaluation.md).
