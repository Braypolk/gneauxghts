# Compare four whole-vault visual encodings

Status: ready-for-human
Type: prototype

Question: Which visualization lets the user see all notes, recognize idea relationships, and filter attention while keeping context?

Artifact: [Visualization spec](../spec.md). Primary source: `codex/atlas-visualization-prototype`. Earlier research: [Atlas report](../../atlas-research/report.md).

## Verdict

Round 1 rejected by the user: the options were browsing workflows, reskins and old-note review, rather than sufficiently different whole-vault visualization techniques. Round 2 implements a treemap, adjacency matrix, radial bundled links, and topic-by-time plot. User comparison is pending; no replacement for the existing Atlas is approved.

## Validation

`pnpm check` passes with zero errors and warnings; `pnpm build` passes. Browser checks on the native snapshot confirm 166 treemap leaves,166 ring marks,166 plot marks, and166 rows/columns in the matrix. A topic lens dims 151 notes and retains all 166; treemap and time-plot positions remain stable under search/inspection. Matrix keyboard inspection and magnified pair targeting work. Ring cross-topic/type/density controls and persistent clicked-note tracing work. Temporal rectangle selection collected 12 sources; native created/updated layouts both retain 166 marks with zero overlapping base circle pairs. Demo tag lens highlights 6 of 38 notes and retains all 38 glyphs. Source reading, dataset reset and selection across views work. Wide and narrow layouts inspected.

Treemap hover inspection initially changed its height and moved targets; fixed height and click-pinned inspection now keep geometry stable. Verified Go Operator selects the correct source, topic zoom shows 15 notes, and All vault restores 166.

Original `/map` and `atlasStore` SHA-1 fingerprints remain `a5dad06356e88be6b4e223371da55819ad3e710e` and `1fd21b743f7f9a3540bf131aad202d445d018789`. The baseline renders normally with the same launcher snapshot. No performance claim beyond this corpus.

## Comments

2026-10-02: Four subagents each implemented a distinct visual encoding. The parent integrated shared lenses, snapshot loading, selection/source inspection and compact comparison chrome. Browser testing prompted a matrix detail lens, larger radial labels and collision handling for dates. These changes respond to observed issues in the real 166-note snapshot rather than smooth demo data alone.
