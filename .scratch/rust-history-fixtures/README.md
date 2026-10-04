# Prebuilt Rust history fixtures

Progress: Complete. Implemented, reviewed and validated.

## Confirmed finding

The three selected reader tests rebuilt their data on every run: two 55-note inventory scenarios, nine notes with twelve additional edits each, and an 80-revision history with seven renames. Reusable histories are appropriate for their query/paging contracts. Writer, checkpoint, corruption and recovery tests still construct their own data, because those writes are the behavior under test.

## Implemented

Four checked-in compressed vault archives now supply the reader setup. The explicit ignored generator creates them through production saves/finalization and public clean close. It preserves every original note, history depth, body density and the excluded Window note in inventory scenarios. Archive data totals 129,463 bytes (about 126 KiB); generation took 12.04s including startup, once when deliberately invoked.

Each test restores an independent copy, verifies file digests and schema/geometry, relocates only stored paths, and constructs normal AppState with fresh app-local observations. The normal catalog prewarm and existing batch lexical synchronizer prepare real indexes; normal queued task/generation projections drain before queries. This avoids a separate lexical commit for every restored note. Masters remain byte-for-byte unchanged after the repeated readers and their history-clear operations.

All original query assertions and live history-clear mutations remain. No production behavior or dependencies changed. There is a maintenance cost: the generator/loader and four artifacts must be updated deliberately when the fixture recipe or current history schema changes. They are not a silent local cache or replacements for writer tests.

## Measured results

| Workload | Original | Final | Reduction |
| --- | ---: | ---: | ---: |
| Three reader tests, fresh process | 21.52s | 13.65s | 37% |
| Full Rust library, default concurrency | 117.63s | 103.74s | 12% |
| Complete fixture loading/index preparation | — | about 0.1–0.3s each | — |

These are controlled local execution measurements with no competing test/build/typecheck workloads. Compilation is excluded; the last incremental test compilation took 14.94s. This does not bring the full suite below a minute. Live writer tests and actual query/continuation/proof validation remain substantial. The initial prebuilt loader took 18.35s for the three readers; measuring its per-note index commits led to the batch refinement. All temporary probes are removed.

## Existing flaky assertion corrected

The first full candidate run exposed an unchanged evidence test that assumed a bounded read returned every selected passage. Candidate ordering varies with generated identities, and the legitimate partial response included a continuation. The original binary failed 2/10 repetitions and the candidate 1/10, confirming a pre-existing issue. The corrected test follows real cursors, checks complete/nonduplicate delivery of the selected IDs, and applies the original content assertions to the aggregate. It passed 20/20 fresh-process repetitions and the final full suite. No production limit or assertion was weakened.

## Acceptance

- Full library: 725 passed, zero failures, 16 ignored. All 725 regular test names are unchanged; the extra ignored entry is only the explicit fixture generator, alongside the original 15 ignored tests.
- Architecture: all 21 passed.
- Three fixture readers pass repeatedly, including after the full suite. Archive hashes remain unchanged.
- Independent review passed; a Windows-generated separator issue was corrected at the export boundary. Runtime verification was performed on macOS; Windows/Linux execution was not performed here.
- All original read assertion tails remain intact in the three converted tests. The separate flaky-test correction strengthens bounded-delivery checks. Checkpoint/writer test source is byte-identical to this phase's baseline.
- Final whitespace check passed. No frontend/native/browser changes or reruns were needed in this phase.

## Evidence and maintenance

[Fixture README and regeneration command](../../src-tauri/test-fixtures/history-read/README.md).

[Portability audit](portability-audit.md), [test contract audit](test-contract-audit.md), [independent review](review.md), [reader cost investigation](reader-cost-followup.md), [flake diagnosis](issues/02-bounded-read-flake.md), [phase baseline](baseline.json), [exact source diff](source-changes.patch), and [test inventory comparison](inventory-check.json). Raw timing/repetition logs and master hashes are saved alongside these files. The phase diff excludes earlier uncommitted work; archives and their README are additional new files.
