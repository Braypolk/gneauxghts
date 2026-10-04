# Prebuilt Rust history fixtures

Reduce repeated canonical history construction in read/query tests using portable prebuilt real data, copied into isolated temporary vaults. Keep writer/checkpoint/corruption/recovery tests building their own histories. Record audits before source edits. Preserve all read assertions, data density, continuation, privacy and mutation checks. Fixtures must have a documented reproducible generator through production writers; no silent cache rebuilding or schema handcrafting. Measure same workloads and full suite, separate compile time.

## Approved audit outcome

Reuse four immutable, compressed current-schema vault snapshots for exactly three reader tests. Keep the excluded Window note in inventory vaults. Loader restores into new notes/app-data roots before constructing AppState, validates the archive and real store, rebases only documented path columns, and loads the real catalog. Explicit ignored generator calls production writers and clean close. Adaptive-checkpoint and all fault/recovery writer tests stay live. Read assertion tails are byte-identical after consumer edits; cardinality checks make required seed geometry explicit.

Before measurements: original three reader tests21.52s total in fresh process; original full suite measured separately using saved binary. No concurrent test/build/typecheck workloads. Compilation and fixture generation are excluded from steady-state test timing and reported separately.

Initial read-fixture run18.35s vs21.52s baseline, less gain than expected. Temporarily time decode, restore/validate/AppState, and catalog initialization before deciding whether setup or real query work dominates; no performance claim yet. Probe instrumentation removed before final acceptance.

Probe: decode+restore are 46–134ms per fixture; synchronous catalog initialization adds about4.6s across four fixtures, issuing one lexical commit per note. Experiment uses existing real batch lexical sync after production prewarm under foreground admission, then releases/drains normal projections before assertions. No projection skip or hand-built catalog. Keep all original counts; temporarily record inventory page counts to assess remaining query cost.

Batch setup probe: sparse catalog ready in106ms, dense267ms, nine-dense92ms, context73ms including decode/restore. Three readers15.87s overall (libtest14.79s). Retain existing batch synchronization; remove all probe instrumentation. Keep all55 dense notes and original page/query checks: remaining time is real continuation/currentness validation, not seed reconstruction. No density reduction or production validation bypass in this change.
