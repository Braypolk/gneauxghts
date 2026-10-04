# Remaining three slow Rust tests

The earlier request covered six targets. The previous pass completed three; narrowing the scope to those three was a coordinator mistake. This pass implements the other three. Findings and chosen changes were recorded in the module audits before implementation.

## Changes

| Target | Finding | Implemented change and retained contract |
| --- | --- | --- |
| Inventory pagination | Loading the existing archive was cheap; querying and validating four dense pages dominated. | Reduce the dense archive from 55 to 20 notes, retaining real byte-budget continuation, exact union/no duplicates, scope rejection and history-change invalidation. Sparse remains 55 notes to cross the 50-row boundary. No freshness cache or production query behavior changed. |
| Adaptive checkpoint chain | The old 140-write test reached only 57 consecutive deltas: early ratio checkpoints prevented it from reaching the 128-revision boundary. | Load a production-generated prefix containing root checkpoint 0 and deltas 1–126; execute publications 127–139 live. Assert delta 127, checkpoint 128, then deltas 129–139. Cleanly close/join the old runtime and reopen before checking reconstruction at 0/127/128/129/139. The target checkpoint is absent from the archive. |
| Storage reclamation | Twenty-four repetitive, multiline writes were incidental to the physical reclamation contract. | Four deterministic 32 KiB bodies with low compressibility allocate enough actual free pages. Retain deletion, per-pass 32 KiB ceiling, convergence, surviving revision and deletion-marker assertions. Add physical freelist proof and explicit baseline provenance. No durability settings changed. |

The storage probe measured 20 free pages after clear (80 KiB), 12 after the first pass, and zero after three passes. Its measured live-write stage fell from 716 ms to 122 ms; total target body from 796 ms to 208 ms. These are single instrumented observations, not medians.

## Timing

Three fresh processes per version, the same three exact test filters, serial execution, no concurrent test/build workloads, compilation excluded:

| Version | Run times | Median |
| --- | --- | --- |
| Saved original binary and original dense archive | 15.35 / 15.47 / 15.22 s | 15.35 s |
| Final binary and final archives | 6.88 / 5.41 / 5.51 s | 5.51 s |

The selected group is **64% faster**, saving about 9.84 seconds per run. These are process wall times, including startup. This percentage does not describe the whole suite. See `timing-comparison.json` and the corresponding logs.

One preliminary baseline repetition was rejected by the loader because the old binary saw the new dense recipe. It is retained as `baseline-recipe-mismatch-excluded*` and excluded from timings. `measure-baseline.py` then installed the original dense archive for the baseline runs and restored the exact final bytes in `finally`.

## Validation

- Explicit ignored generation succeeded through real canonical publication/finalization/clean close. Only dense and checkpoint archives changed; sparse, nine-dense and revision-context archives remain byte-identical to the phase baseline.
- Final focused group passed, including three further fresh-process repetitions. Test names/counts are identical to baseline: 741 registered library tests (725 regular, 16 ignored).
- An early threshold mutation (128 → 127) failed at the live revision-127 delta assertion; a late mutation (128 → 129) failed at the revision-128 checkpoint assertion. Both restored the exact production source afterward. These checks use the unchanged prebuilt prefix.
- Independent Standards and Spec reviews found no actionable issues. They checked preserved assertions, archive digests/schema/geometry, and that the checkpoint outcome remains a live writer decision.
- Full Rust acceptance: **725 passed, 16 intentionally ignored, 0 failed**, in **83.55 s** process wall time (83.54 s reported execution). Architecture acceptance: **21 passed**, 8.36 s process wall time. Build time excluded. The previous phase recorded full runs around 99–101 s, but run-to-run variation means the controlled focused comparison above is the stronger attribution evidence.

The retained code changes are confined to tests, test-only fixture support and test-only store inspection. No regular tests were added or removed. The extra fixture machinery extends the existing loader/generator rather than introducing another framework. Archive maintenance and regeneration are documented in `src-tauri/test-fixtures/history-read/README.md`.

## All six targets

1. Pending keyword search: completed in `../rust-slow-test-improvements/`.
2. Verification cancellation: completed there, with replay fault injection.
3. Recovery contention: completed there, with deterministic lock contention and a lock-removal fault check.
4. Inventory pagination: implemented here.
5. Checkpoint chain: implemented here, including the newly discovered coverage gap.
6. Storage reclamation: implemented here.

`baseline.json`, `phase.patch`, `phase-files.json` and `final-source-hashes.json` isolate this phase from the large pre-existing working-tree changes. All builds, measurements and mutation checks were coordinator-owned; subagents worked on separate modules and independent reviews.
