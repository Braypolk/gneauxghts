# Map architecture and calculation cleanup

Status: ready-for-agent
Type: task

## Scope

Review the accepted Atlas implementation after issues 09–17, retaining its visual
appearance, identity and stable geography. Remove demonstrated duplication and
unnecessary work; preserve durable admission, compatibility and freshness checks.
Review baseline: HEAD c44b8466e7d491f89862f94bdb508af109ec53a9 plus the existing dirty
map changes. Current-turn source snapshots were used to isolate this cleanup.

## Findings and implementation

- Contour smoothing checked every segment for every sample over three wraps.
  Binary window bounds now visit only intersecting segments in the identical
  order with identical arithmetic. A retained full-integration oracle checks exact
  equality, including wraparound, tiny/large windows and degenerate contours.
- Child separation regenerated all map contours after each changed parent.
  Intermediate rebuilds now include only clouds containing moved notes, including
  their containing ancestors, in bottom-up order. Final geometry still uses the
  canonical metadata/outline pass.
- Centroid/radius/member refresh was duplicated three times. One private
  `refresh_specs` operation now derives canonical geometry after coordinate changes.
- Dense gap grouping repeatedly scanned every component when already joined.
  It now skips redundant unions. Fixed support-envelope directions are cached.
- Freshness checks decoded every embedding vector merely to fingerprint metadata.
  A lightweight dependency inventory preserves the same join, ordering and hash
  fields without fetching vectors. Structural calculation still loads vectors;
  all generation/admission rechecks remain in place.
- SQLite position hints and uncached interpolation ran on accepted-map builds
  before being discarded by durable placement. They now run only at bootstrap.
- Routing rasterization repeated polygon edge work and square roots for every
  grid cell. Routing and caption checks share prepared edges and squared-distance
  predicates, retaining inclusive/exclusive boundary rules as appropriate.
- Active feature documentation had contradictory historical placement promises.
  It now states the current local-repair policy; migration history remains in issues.

## Architecture assessment

Independent Standards and Spec audits found one backend geometry owner, one
semantic worker queue and one durable admission boundary, with no conflicting
placement writer. The renderer still owns camera, captions, selection and route
presentation. The legacy renderer remains intentionally available for old cached
responses; deleting it would remove supported bootstrap compatibility. No new
persistent state, scheduler, layout policy revision or map reset was introduced.

Potential later optimization: semantic medoid metadata is assembled before and
after a repair; a geometry-only intermediate representation could avoid that work.
It remains within the same owner and has not been shown to dominate costs after
this cleanup. Avoid introducing another representation/cache without evidence.

## Validation

- Authoritative 167-note, 27-cloud replay, identical serialized cloud output:
  debug calculation samples before 0.528/0.513/0.511 seconds; after
  0.185/0.176/0.178 seconds (~65% less time). This measures backend calculation,
  not end-to-end map reopening.
- Fictional 192-note/16-cloud routing benchmark with 384-point contours:
  cold construction/routing 113/105/101 ms before, 24/23/23 ms after. The tested
  SVG route is identical. This preserves all contour points rather than reducing
  geometric quality.
- Prepared-polygon equivalence checks cover concave boundaries, interior and
  outer margins, exact ties and empty polygons. All 49 frontend Atlas tests pass.
- Lightweight dependency inventory test verifies ordering/membership and identical
  hash fields, and proves that unreadable vector payloads are not selected. Passed.
- `pnpm check` passes with zero errors/warnings, including E2E TypeScript.
- Independent follow-up reviews found no remaining blocking regression; a
  transient missing Clone derive was corrected before successful verification.
- Final retained backend run (`cargo test atlas --lib`) passes 93 tests,
  covering Atlas, dependency inventory and relevant cache/indexer integration.
  The 2,000-note sequence remains stationary; the final full-run repeat took
  about 2.44 seconds in the debug build (not a UI latency promise).
- Removed the now-unused structure hash field from vector-loading records; the
  dependency inventory owns that field. Updated bootstrap/visibility fixtures.
- Temporary benchmark source and private-map-derived JSON are removed after
  verification. No live vault state was edited.
- Final architecture fitness run passes all 21 checks. Formatting/type checks
  and `git diff --check` pass. The final library compilation emits no warnings.
