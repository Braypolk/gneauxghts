# Combined patch verification

## Implemented scope

The pre-change [review gate](review.md) was completed before source edits.
The patch touches 15 tracked source/test/config/documentation files: 181 lines
added, 283 removed (net 102 removed), plus this audit package. It does not implement
the larger rewrites or all correctness findings.

- Retired the vacuous whole-program legacy-field checker; preserved structured
  NoteDraftState/ownership checks and the required type-checking gate.
- Added `pnpm test:support` and documented Node/Python support checks.
- Removed three unused pane-session helpers and unreachable pane cleanup.
- Replaced the unopened-restore dummy spy with real document/registry assertions;
  restored test-owned runtime cleanup and spies; removed duplicate SSR/transient
  assertions while retaining their distinct behavior coverage.
- Isolated the watcher hash test in disposable storage with unwind-safe override
  cleanup. Removed a falsely named duplicate task success test; used independent
  literal expected Markdown for toggle/delete/due operations.
- Constructed each reconciled TaskRecord once.
- Corrected sibling editor batch transaction chaining, and strengthened the view
  fake to enforce transaction start states. Three new regression cases fail on
  the old mapping and pass on the fix, covering insertions, same-length edits,
  interleaved selection, callbacks, pane viewport/selection, undo and redo.

Implementation details: [frontend](implementation-frontend.md),
[persistence](implementation-persistence.md), [editor](implementation-editor.md).

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Full Vitest | 141 files, **1,008 passed**, 0 failed | [JSON](measurements/vitest-after.json), [compact summary](measurements/vitest-after-summary.json) |
| `pnpm check` | Passed; 0 Svelte errors/warnings, E2E TypeScript passed | [log](measurements/check-after.log) |
| Default Rust library suite | 709 passed, 1 sandbox-only failure, 16 ignored; 162.75 s | [log](measurements/rust-after.log) |
| The one blocked Rust test, approved rerun | 1 passed; localhost listener worked outside sandbox | [log](measurements/capacity-probe-approved.log) |
| Rust architecture integration | 19 passed | [log](measurements/rust-architecture-after.log) |
| Node E2E support | 8 passed | [log](measurements/support-after.log) |
| Python fixture checks | 8 passed | [log](measurements/python-after.log) |
| Rust build-artifact probe | Passed in baseline; profile/build implementation unchanged | [log](measurements/node-baseline.log) |
| `git diff --check` | Passed | Combined source diff inspected |

All **710 nonignored library tests** and **19 architecture tests** passed across
the full run and the one targeted rerun. The original full Cargo invocation exits
101 because the sandbox refuses `TcpListener::bind` in the capacity probe, before
its assertions run. [Exact sandbox error](measurements/capacity-probe-sandbox.log)
and approved success are retained; this is not reported as a single green full
Cargo invocation. No live model endpoint was used. The 16 ignored cases remain
opt-in and were not executed.

Affected frontend suites and the watcher/task Rust suites also passed individually
as recorded by their implementation owners. No broad rerun was needed after the
isolated environment failure was resolved.

## Independent review

- Backend-agent auditor reviewed the architecture-test removal, support command
  and README: no actionable issues. Normal compiler checks cover ordinary removed
  field access; repaired scanning could theoretically catch explicitly suppressed
  accesses, but there is no current usage establishing a lost guarantee.
- UI/indexing auditor reviewed the frontend deletion/fixture cleanup and editor
  batching patch: no actionable issues; live callers, retained assertions,
  shared undo and independent pane state checked.
- Root reviewed the combined diff, Rust record equivalence, watcher fixture
  construction/teardown, implementation scope and validation outcomes.

## Limits

Browser, native WebKit, process-relaunch, scale and live-provider suites were not
executed. The runtime fix is covered through the owning runtime with real
CodeMirror state, not an actual browser gesture producing a transaction batch.
No persistence format, state ownership or canonical write seam changed.

The warm final Vitest run completed in roughly 16 seconds versus the 47.52-second
cold baseline while Rust was compiling. Cache, reporter and system load differ;
this is **not a controlled speedup measurement**. The meaningful measured baseline
finding is the old architecture test's 1.75-second ineffective compiler walk.
No performance reduction is attributed to deleted assertions or small fixtures.

Open correctness/design work remains in the [14 issues](README.md): notably
Unicode search, async store lifetimes, evidence cursors, clipboard cut targeting,
calendar validation and durable chat admission/finalization. They are not fixed
by this cleanup pass.
