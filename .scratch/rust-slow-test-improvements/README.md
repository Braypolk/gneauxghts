# Focused Rust test improvements

Progress: Complete. Implemented, independently reviewed, mutation-checked and validated.

Implemented the three first recommendations from [the slow-test audit](../rust-slow-tests/README.md).

- Pending keyword search now imports two notes, one indexed and one pending, instead of 64. Real foreground ownership, catalog prewarm, fallback search, background projection and all identity/highlight/deduplication assertions remain. Queue idleness is followed by successful-signature assertions. This removes 62 file writes and projections. The test no longer exercises 64-note volume; no throughput assertion or 64-note behavior boundary existed.
- Verification cancellation now builds three revisions instead of 13. It first verifies the intact chain, corrupts exactly the second payload, proves uncancelled verification detects it, then cancels after the first replay and before that corrupt payload. This corrects the old test's early cancellation during header enumeration, as well as removing ten live save/finalize operations.
- Recovery replaces ten uncontrolled simultaneous-start attempts with reader-first and writer-first ownership schedules. A small cfg(test), runtime-local observer records actual acquisition and WouldBlock; both competitors must reach real shared-lock contention before release. Real B failure/C save and every final-state assertion remain. Gates release on unwind and wait with deadlines. Eight fresh vault/publication cycles are removed.

The same three regular tests remain. No production runtime behavior, persistence settings, test ignores or dependencies changed. The retained diff is four files, net 91 source lines added: deterministic concurrency instrumentation and stronger cancellation assertions cost source lines while reducing executed fixture work. This is not a source-size reduction.

## Validation and timing

| Measurement | Before | After |
| --- | ---: | ---: |
| Three selected tests, median of five fresh processes | 3.51s | 0.28s |
| Three selected tests inside matched full-suite profiles | 7.06s | 1.14s |
| Full Rust serial library, first pair | 97.99s | 100.98s |
| Full Rust serial library, attribution pair | 110.94s | 99.20s |

The focused median improves 92%; the changed cases inside the full profiles improve 84%. All numbers exclude compilation. Fresh-process totals include startup; the first newly rebuilt candidate sample paid startup cost (1.65s), and remains included in the five-sample median. Full profiling uses completion timestamps, so attribution includes fixture/body/teardown plus tiny harness overhead. These are local serial measurements, not CI/default-concurrency guarantees.

**No precise overall suite speedup is claimed.** The unchanged binary itself varied from 97.99s to 110.94s. The full candidate remains roughly 100s, and the matched profiles also show changes in untouched tests (for example, checkpoint chain 11.65s→8.88s). The savings in the three edited cases are clear, but whole-suite variation is too large to attribute the complete difference to this change. The remaining inventory/checkpoint work still dominates.

All four full-library runs pass 725 tests with 16 existing ignored entries. Architecture: 21/21 pass. Exact regular and ignored names match the baseline; no additions/removals/renames. Both five-run focused groups pass, and recovery passes 20 further fresh processes, 40 controlled schedules. The final normal compilation (library and architecture targets) took 16.45s separately. No frontend/browser/native code changed or required rerunning.

Both negative mutations detect the intended regressions: removing replay cancellation fails the Unavailable assertion; prematurely releasing the shared recovery guard fails the genuine contention check within 5.08s and exits without hanging. [Mutation results](mutation-results.md) records those checks and the overbroad aborted experiment, which is not counted as validation. Final source hashes match independent review, production history_store.rs matches baseline, and whitespace checks pass.

Raw evidence: [focused results](focused-results.json), [profile comparison](profile-comparison.json), [inventory check](inventory-check.json), [recovery repetitions](recovery-stability.json). Full and focused logs/JSON are retained alongside these files.

## Review and handoff

[Spec](spec.md), [baseline](baseline.json), [exact phase diff](source-changes.patch), [source hashes](changes.json), [validation plan](validation-plan.md), [Standards review](review-standards.md), [Spec review](review-spec.md).

Implementation details: [pending search](pending-search.md), [payload cancellation](payload-cancellation.md), [recovery contention](recovery-contention.md). Reports and local issues preserve the scope and findings; earlier uncommitted changes are excluded from the phase diff. No changes were committed.
