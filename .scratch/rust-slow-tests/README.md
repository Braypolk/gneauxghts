# Remaining slow-test audit

Progress: Complete. Source review and timing only; no application or test source edited.

## Measurement

A fresh serial pass of the current Rust binary took **100.64s**, excluding compilation. Completion timestamps attribute setup, scenario and teardown together. These are approximate per-test costs, not internal stage profiles. Serial execution removes contention for the process-wide test-environment lock; timings must not be compared directly with the preceding default-concurrency 103.74s run as an optimization result.

724 tests passed, 16 were ignored, and one context-capacity test failed because the sandbox denied binding its local server. The exact blocked test passed alone with local socket access (0.02s). This was an environmental restriction, not a newly discovered application regression. No full all-green rerun was needed for this read-only profiling pass.

Timeline/history accounts for **81.68s**, about 81% of this run. The top 10 cases account for 39.06s. See [ranked tests](ranking.md), [raw log](serial-current.log), and [timings](serial-current.json). Prior frontend measurements remain about 9s for 1,065 cases; there is substantially more headroom in Rust. Browser/native end-to-end runtime was not remeasured.

## Prioritized candidates

| Module / current serial time | Finding | Recommended next action |
| --- | --- | --- |
| Verification cancellation / 1.34s | Builds 13 revisions, then cancels at the fifth callback while still enumerating headers. The named payload-replay boundary is not exercised. | First fix: use a small real chain and prove cancellation after replay has begun. Mutation-check that removing replay cancellation fails the test. This improves coverage as well as reducing setup. |
| Keyword search pending projection / 2.80s | Imports 64 notes, tests pending title/body fallback and deduplication against one indexed note, then drains real per-note lexical work for all 64. | Two notes cover the two observed roles: indexed and pending. No 64-note threshold exists in the inspected path. Retain fallback, highlights, identity, deduplication and successful post-drain projection checks. This reduces unasserted scale exercise; use idle completion only with successful-signature assertions and a deliberate timeout choice. |
| Storage reclamation / 2.20s |24 revisions of 512 changed lines create reclaimable pages. The 128-pass loop is only a bound and already stops at zero. | Measure physical reclaimable bytes; use the smallest live seed that still exceeds one 32KiB compaction budget. Preserve budget accounting and eventual reclamation. Merely reducing the loop bound saves nothing. |
| Initialization restart / 1.08s |64 files, one injected failure, persisted progress and retry. No 64-item batch threshold on the path. | A small multi-note case can cover continued processing, retry and idempotence. This reduces explicit volume coverage, so document that tradeoff rather than calling it equivalent scale coverage. |
| Checkpoint long chain / 11.02s |140 real publications. Only cardinality and reconstruction at 0/ 127/ 139 are asserted; the policy also checkpoints by ratio, bytes and replay time. | Inspect actual payload kinds/replay counts and time preparation, append, finalization and projections. Strengthen the checkpoint oracle. Keep live writer coverage and the long sequence until the actual threshold behavior is established. Prior foreground-coalescing experiment did not yield a convincing whole-suite improvement. |
| Inventory pagination / 12.94s | Prebuilt loading is already cheap. Continuations validate all retained candidates, delivery validates rows, and is_current validates admitted citations. Citation validation reads/parses/hashes canonical content and checks history proofs. | Profile these real validation boundaries. Consider sharing per-note reads within a single validated operation only if freshness/scope/history-clear contracts remain intact. This is a production performance investigation, not another fixture shortcut. No saving yet quantified. |
| Capture recovery contention / 2.83s | Real concurrent recovery/read/save work. | Ten identical fresh-store races use a start barrier without proving recovery-mutex contention. Replace repetition with deterministic reader-first and writer-first schedules only after a bounded test hook proves the competing callers reach admission. Retain real fault/recovery and every final-state assertion. |
| Missing-note history / 1.82s; corruption attestation / 1.00s | Multi-stage paging/restart/recovery and corruption integrity contracts. | Keep the exact 30+8 paging geometry and all nine distinct corruption variants. A clean 36-revision seed is possible for the former, but its modest runtime may not justify another archive. Keep live naming, damage, disappearance, restart, reset and recovery. |
| Scheduler lifecycle / 1.18s | Starts actual scheduler, then advances atomic fake clock. Atomic clock change does not wake condition variable; worker can be in its up-to 1s fallback wait. | Lower priority: a coordinated test clock/wake could avoid wall-clock delay while preserving real worker scheduling and lifetime checks. Directly invoking the callback would skip the test's purpose. This is a source-supported hypothesis, not measured stage attribution. |

## Keep unless stronger evidence emerges

The settled-publication retention test (1.54s) submits 16 identical large bodies and 8 abandoned intents against a 512KiB live-storage ceiling, then checks clean close/restart reconstruction. Shrinking sizes/counts could let retained copies fall under that ceiling. Require a leak-sensitivity argument or mutation test before reducing it. The nine-note dense reader is now 1.38s; another fixture rewrite has lower likely value than the targets above.

The many 2–25ms polling sleeps are not themselves evidence of large avoidable delay. Several 5–30s timeouts are only failure bounds. Do not lower safety timeouts or skip worker joins as a speed optimization.

## Larger opportunity: test isolation

TestVault holds a process-wide environment mutex across setup, body and teardown because paths, compatibility storage bindings and fault hooks are mutable globals. More libtest threads therefore cannot run many expensive cases concurrently. Removing the lock would be incorrect. A separate measured experiment with process-isolated test execution could avoid this particular contention without rewriting state ownership. First audit shared ports, fixed paths and cross-process resources; compare wall time, I/O contention and memory, and verify the exact same inventory. No gain or compatibility is established in this audit. If staying with a single process, isolating injected configuration/fault hooks is an architecture change and should be evaluated separately.

## Secondary non-Rust finding

The last support-test log contains a 2.03s TERM-resistant child shutdown test. It deliberately waits the real 2s graceful-termination period before SIGKILL. A configurable grace duration could preserve the real child/kill/join contract with a shorter test value, but fake timers alone would not verify OS process termination. This is a lower-value candidate than history and introduces a small configuration seam; no change or new timing was made here.

## Recommended sequence

1. Correct/reduce the cancellation test and simplify bulk search to its indexed/pending roles.
2. Replace repeated recovery races with deterministic ownership schedules. Establish physical boundaries for smaller reclamation and initialization fixtures; retain intentional scale obligations explicitly.
3. Profile the 11s checkpoint case and 13s inventory case internally, with correctness oracles intact.
4. Evaluate process isolation as an independent suite-wide experiment if the remaining serial runtime still matters.

Detailed module audits: [writers and verification](writer-audit.md), [concurrency, search and history commands](concurrency-search-audit.md). These findings precede any future source edits. No speedup is claimed from this audit itself.

## Implemented follow-up

The first three recommended improvements (pending search, payload cancellation, deterministic recovery) are complete. See [implementation and measured results](../rust-slow-test-improvements/README.md). Other recommendations above remain future work; this follow-up did not change checkpoint/inventory production behavior.
