# Naming speed and quality comparison

Status: resolved

Requested: benchmark current naming first; implement improved embedding naming; benchmark it; expose both names on the same map for human evaluation. See [spec](../spec.md).

## Comments

2026-10-04: Work started. Current production names and map generation remain authoritative. Benchmark and comparison use a disposable frozen snapshot.

## Answer

Implemented a runnable, test-only embedding naming experiment and a development-only comparison on the existing map route. `pnpm atlas:naming` serves the frozen report on localhost port 1423. Current/Improved buttons change cloud names without remounting the map. The expandable comparison includes both names, representative note titles, note counts, cache timings and separately measured model startup. `pnpm atlas:naming --benchmark` captures a new snapshot and reruns both release benchmarks before serving it. The native app still publishes production v7 names.

Final measurement: 166 notes, 36 clouds, 16 root regions; same frozen membership and indexed content, same installed local Jina model, standard 8192 context/12 threads/4 slots, optimized Rust builds. Production v7: median empty-cache 1225.28 ms, cached 141.98 ms. Experimental v3: median empty-cache 209.63 ms, cached 15.72 ms. Three empty-cache runs and five cached runs each. Unique embedded candidates: 784 vs 131. Startup/warmup measured separately: 650.25 vs 534.92 ms. Startup is a single observation, not a cold-disk benchmark. Snapshot copying, compilation, map/index rebuilding, artifact publication and rendering are excluded. This measures full labeling passes, not incremental edits or end-to-end application latency.

The first open-vocabulary experiment was faster but still chose overly narrow prose words. The final experiment restricts names to readable topics and common authored tags, with definitions for ambiguous topics. This trades vocabulary coverage for readability. It does not invent unrestricted umbrella names, perform full grammatical noun extraction, or implement production label retention/incremental invalidation. Human quality evaluation is intentionally pending.

Validation: 17 Rust naming tests; 5 frontend comparison/layout tests; `pnpm check` with zero errors/warnings; production frontend build. Browser verification confirms 166 rendered nodes, exact camera transform, exact node geometry and exact cloud outlines across toggling. Both name columns and release timing tables render; no perpetual pending-label state. The comparison tab is kept open for the user.

Private raw results and screenshot: `/private/tmp/gneauxghts-atlas-naming/report.json` and `/private/tmp/gneauxghts-atlas-naming/comparison.jpg`. No vault copies, note excerpts, names or screenshots were committed to the repository. Existing dirty work was preserved.

## Promotion

2026-10-04: The user approved the Improved names. The comparison described
above is now retired: its scripts, frontend controls, benchmark-only Rust code,
local server/tab and private snapshot artifacts have been removed. The measured
results remain historical evidence; see [production adoption](02-promote-topic-naming.md).
