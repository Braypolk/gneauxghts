# Independent Standards review

Progress: Complete. Recompared all four files after coordinator source freeze; no actionable Standards findings. Ready for coordinator runtime and mutation validation.

## Scope and method

Compared current `src-tauri/src` with the saved `src` subtree at `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-slow-tests-baseline-zb6ipk8_`, obtained from this phase's `baseline.json`. Comparison used Python `difflib`, not the aggregate Git diff. Inspected all four changed files and followed the existing production queue, verification, recovery and fixture cleanup paths.

Standards: `AGENTS.md`, `.agents/skills/code-review/SKILL.md`, `ARCHITECTURE.md`, `docs/architecture/behavior-invariants.md`, ADRs 0004, 0005 and 0008, plus the explicit phase spec. Fowler smell names were treated as judgment prompts, not requirements to add abstractions. No tests, builds, benchmarks or source edits performed by reviewer.

## Findings

No actionable documented-standard violations, correctness defects, or maintenance smells found in the frozen changes.

* `runtime.rs:99–110, 137–142, 178–195, 398–404, 458–475`: observer storage, event type, setter, initialization and execution are all `cfg(test)`. The hook belongs to a runtime, not a process global; background clones start without it. Observer callbacks run after releasing the observer's own mutex. `try_lock` detects actual `WouldBlock` but does not replace the unchanged blocking `.lock()`/poison mapping; production lock ownership remains the same. This meets the phase's locking-parity requirement and ADR 0008's private runtime ownership.
* `editing_window_capture/tests.rs:488–560`: each reader-first/writer-first case owns a real A/B/C fixture. The first caller pauses after owning the real recovery mutex; two other callers must observe contention before release. Because both stop at the blocking lock, one caller cannot supply both contention messages before release. The existing `ReleaseOnDrop` is created inside the thread scope before spawns, so a parent assertion panic releases the first worker before `thread::scope` joins. Normal completion also releases before joins. Hook waits have failure bounds, and fixture Drop joins projection work. Final prepared-count, pending/canonical hash, seal and exact A/C history assertions remain. No general scheduler or alternate recovery implementation was added.
* `history_store/verification.rs:238–276`: test-only SQL remains inside the private SQLite implementation as ADR 0004 requires. The second payload is selected by lineage rather than row order. The intact chain passes, corruption is independently observed, and cancellation after the first payload returns typed Unavailable before the corrupted second payload is reached. The callback count matches the actual header/replay loops in `history_store.rs`; an explicit comment records this narrow coupling without introducing a production phase-label API. Retryable cancellation remains distinct from corruption per ADR 0008 and the behavior invariants.
* `commands/search_commands.rs:1516–1604`: two real notes preserve indexed/pending roles, pause/prewarm/search, pending signature absence, identity/highlights, deduplication and cache invalidation. Existing queue idle observation is followed by successful-signature checks for both notes, so worker idleness is not mistaken for successful indexing. The queue clears its idle flag when jobs are submitted. No mocks, detached work, production optimizations or inventory reductions were introduced.

## Validation limits

This is a source review. Mutation sensitivity, repeated deterministic contention and full-suite execution belong to the coordinator. The five-second receive/idle bounds are failure limits, not timing assertions. Source inspection alone does not establish measured speedup or scheduling reliability under load.

Frozen-source SHA-256 identities, captured before the coordinator's temporary mutation experiments:

| File under `src-tauri/src` | SHA-256 |
| --- | --- |
| `commands/search_commands.rs` | `e6b09e56d8d563ba31487f26142cc2a4c957d7cf4c6b2e9e9ecf89c45c45cdb7` |
| `services/note_timeline/runtime.rs` | `e4cd80079659cbcd62eec01deb3553dec8c11ad400f547085edbd689fc34cbb7` |
| `services/note_timeline/history_store/verification.rs` | `1b2d7f04dcae04c79dc7a4b33cbb2922d0bd30b83488b4c99f029df86809834e` |
| `services/note_timeline/editing_window_capture/tests.rs` | `fba33da6d8e42189d6fbac28b69352867db5df3346bc533e4e97d43241eca1aa` |
