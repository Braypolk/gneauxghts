# Remaining three Rust test targets

Progress: Complete. All six originally identified targets are implemented across this phase and ../rust-slow-test-improvements/. See results.md for verification and timing.

The prior request covered all six listed slow-test targets. First three are complete in ../rust-slow-test-improvements/. Finish the remaining inventory pagination, adaptive checkpoint chain, and storage reclamation targets. Earlier findings are saved in ../rust-slow-tests/ and ../rust-history-fixtures/reader-cost-followup.md.

Audit and measure before implementation. Reduce incidental fixture/work volume while preserving explicit pagination budgets, scope and freshness invalidation, real durable writes/checkpoint policy/restart reconstruction, logical deletion/physical reclamation and byte-budget assertions. Correct weak oracles where found. Do not silently delete scale or durability checks, replace real writer paths with prebuilt passing outcomes, or disable fsync/verification. Production optimization is allowed only when a demonstrated duplicated operation can be removed safely with its freshness/coordination invariants retained and measured tests unchanged. Prefer smaller coherent tests over broad architecture changes solely for tests.

Root owns all builds, timing and integration. Independent subagents investigate disjoint modules and document plan/findings before assigned edits. Capture exact phase diff excluding existing work, preserve test inventory unless a deliberate consolidation is supported by evidence, run appropriate targeted checks and full Rust/architecture acceptance after changes settle. Report honest limits and any target where a safe speedup is not established; do not call investigation-only work an implemented optimization.
