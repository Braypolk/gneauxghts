# Deterministic released-capture recovery contention

Status: ready-for-agent
Progress: Source frozen; static preservation checks complete. Root owns compile, execution, mutation proof and timing.

## Change and maintained contracts

Replaced ten probabilistic simultaneous-start races with two explicit schedules: reader owns recovery first, then writer owns it first. Both still use fresh real vaults, canonical A, injected finalization failure publishing B, two real recovery readers, real C publication, and every original prepared-count/pending-hash/finalized-history assertion. Final assertion tails are byte-identical against the saved phase snapshot. No other test function changed; regular test inventory is unchanged.

One cfg(test) observer is retained on this runtime only, absent from worker clones. Ownership notification runs after `ensure_history_recovered` acquires the real recovery mutex, before admission/replay. Competitors report contention only when `try_lock` returns `WouldBlock`; the probe is observational and then enters the unchanged real blocking lock. Both competitors must report before the owner is released. This proves reader/writer contention at shared recovery ownership rather than inferring it from thread start order.

Existing `ReleaseOnDrop` is created inside the thread scope, so assertion unwinding releases the owner before scoped joins. Gate/observation receives are bounded to five seconds; no sleep or generic scheduler was added. Callback lookup drops its observer mutex before invocation. The hook is cleared before final assertions; failure discards the isolated runtime. No non-test production state/algorithm changes.

## Exact source cost

| File relative to src-tauri | Before lines | After lines | Delta |
| --- | ---: | ---: | ---: |
| `src/services/note_timeline/runtime.rs` | 501 | 541 | +40 |
| `src/services/note_timeline/editing_window_capture/tests.rs` | 2688 | 2722 | +34 |

This adds test instrumentation while eliminating eight complete vault/publication/recovery cycles. The benefit is stronger schedule coverage and less executed setup, not a source-line reduction. No shared fixture abstraction, new regular case or production scheduling framework introduced.

## Validation handoff

Formatting and snapshot comparison only; no tests/builds run by this owner. Root will compile and run both schedules, repeat the focused test, and run the full suite serially. Recommended mutation keeps the observer/probe code but releases the actual shared guard immediately after acquisition, copies its bool into a local mutex and proceeds holding only that local guard. With the Acquired gate still active, competing real callers no longer return WouldBlock on the shared mutex; the test must fail through a bounded receive, and RAII must release/join without hanging. Root restores the original source before final compilation.

Measured before/after duration and mutation results remain pending root validation. Do not infer an80% time reduction from the ten-to-two setup count.

## Final coordinator acceptance

All 725 library tests and 21 architecture checks pass, with unchanged inventory. Targeted comparisons and repetitions pass; mutation-sensitivity checks fail as intended and all sources are restored. Exact timing and full-suite variability are in README.md. Implementation is complete.
