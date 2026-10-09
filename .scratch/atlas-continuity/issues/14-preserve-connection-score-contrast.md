# Preserve meaningful connection weights before improving semantic proximity

Status: ready-for-agent
Type: bug

## Evidence — 2026-10-08

The user expects most strong relationships to lie in nearby clouds. The current
map has semantic membership and semantic/graph-based first placement, then
anchored updates. Gap compaction is geometric; it does not optimize affinity.

Read-only inspection of the saved Hidden response found 3,314 of 3,319 semantic
links at exactly 0.935 displayed strength. The selected note has 24 suggested
links across 11 roots, four in its own root. Raw similarity scores for those
24 links vary from roughly 0.815 to 0.861, but all have identical strength.

`geometry::normalize_edge_strength` maps `(score - 0.30) / (0.82 - 0.30)`
then caps at 0.90; same-folder boosting adds 0.035. Similarities above roughly
0.768 therefore collapse together. `build_layout_graph` ranks and weights by
this capped strength, with path-based tie breakers and a degree limit. The
frontend automatic threshold also uses capped strength. Cloud membership still
uses raw embedding prototypes, so this does not imply every semantic assignment
is wrong, but useful relationship contrast is lost in both graph and display.

## Recommended next design

Preserve score ordering and calibrate relevance/neighbor selection against actual
score distributions, without claiming cosine values are confidence percentages.
Keep authored links explicit. Use meaningful weighted relationships consistently
for connection display and aggregate inter-cloud affinity; prevent cloud size or
a few generic hubs from dominating. Evaluate strong-link locality separately
from stable placement. Improving an existing map's semantic geography requires
an intentional transition policy; ordinary reopening and unchanged input must
remain stationary. Simply increasing attraction or repeatedly compacting space
would not address the demonstrated loss of score contrast.

No score or semantic-layout policy changes were made as part of the routing fix.

## Implementation — 2026-10-09

Authorized as the next map improvement. Raw cosine remains available as `score`.
Semantic strength multiplies an uncapped linear absolute score (0.30–1.00)
by the geometric mean of endpoint-relative affinities. Each endpoint measures
its score gap from its best neighbor in units of its mean neighbor gap, with a
0.01 scale floor. Flat/tiny neighborhoods retain absolute evidence rather than
manufacturing confidence. Folder affinity uses remaining headroom, so high
scores retain ordering. Authored links survive graph degree limits and cannot
be overwritten by semantic duplicates.

Placement revision 3 performs one bounded coordinate-descent improvement using
strong graph edges aggregated between roots, normalized by endpoint degree and
cloud size. A displacement penalty retains orientation; collision checks prevent
new note/filename overlaps. Each root translates rigidly, including children.
Unrelated roots and isolated notes are obstacles. The same relationship
aggregation seeds genuinely new regions beside related accepted geography.
Normal edits, reopening, naming and cache rebuilding after migration do not run
the optimizer. Algorithm revision 26 invalidates old derived weights without
clearing durable names or identities. Existing spacing recovery remains gated
at revision 2; it is not rerun just because revision 3 is new.

## Validation

- Independent Standards and Spec reviews completed. Spec review found a padding
  proximity loophole that could permit actual filename overlap. Corrected it and
  retained the isolated-obstacle regression; no remaining review blockers.
- Retained tests cover the original high-score saturation pattern through the
  layout graph, flat/weak neighborhoods, authored degree/duplicate handling,
  rigid one-time affinity migration, restart and rename stability, isolated
  obstacle clearance, and graph-guided new-root placement over raw similarity.
- All 48 Atlas frontend tests, 21 backend architecture checks, and `pnpm check`
  pass (zero Svelte errors/warnings and E2E TypeScript clean).
- Current saved map differs from the original report: 167 notes / 2,942 candidate
  links, with broader raw similarity distribution (median about 0.477). Replaying
  its anonymized candidate scores and filename footprints through production
  scoring and layout yields 1,528 distinct strengths at four decimals; 109
  candidates meet the 0.7 floor. Strong cross-root weighted note distance fell
  from 498.54 to 408.99 world units (18%). Layout/contours took about 245 ms in a
  debug test; the next calculation retained every coordinate exactly.
- This replay holds saved membership fixed and reconstructs top-24 rows from
  saved candidate links. It verifies scoring/geometry, not embedding relevance
  quality or a new real-vault community partition. Native worker fixture tests
  cover publication/restart/cache-loss separately. Human visual quality remains
  to be evaluated in the updated app.
- Temporary replay code and anonymized input were removed. Tests never wrote to
  the vault. All 75 retained Rust Atlas tests pass, including native worker and
  2,000-note stability coverage.

## Validation correction — 2026-10-09

Issue 15 investigation found that the derived `ready-hidden` artifact used for
the 167-note/2,942-link replay was older than the durable accepted head. Those
measurements (including the 18% distance reduction) describe that older fixture,
not the user's current map. The accepted head instead references 3,408 links and
27 clouds. Regression and native-worker results above remain valid; future live
replays should resolve the artifact through the durable map head.
