# Architecture simplification validation

Progress: Complete. Implementation, independent review and final acceptance finished. Historical entries below retain their original interim status; this final result supersedes their pending gates. This is a record of this phase only; earlier audit results are not acceptance evidence for these rewrites.

## Baseline and scope

Compare against the saved working-tree snapshot in `baseline.json`, not Git HEAD. The snapshot predates all source edits in this architecture phase and includes the completed earlier audit/cleanup work. `measure.py` produces the exact phase patch and physical line deltas. Production/test classification and deleted contracts are recorded by each owner; inline Rust test lines are not represented as production savings.

Accepted implementation scope: issues01–08 and the deletion/invariant contracts in the five designs and plan. The coordinator reviewed those designs before releasing source edits.

## Focused evidence

- Issue03 scheduler: actual stale-recall regression failed before implementation. Reinstating old label retry overwrite in the replacement failed the new newer-label case; fixed source restored afterward. The temporary mutant binary must not be used for acceptance. Owner records final fixed-source runs.
- Issue05 document review: initial real-root proof passed13 tests covering effect-only resolution, shared pane projection, no-pane updates and retention. Broader migrated orchestration validation remains an integration gate.
- Issue08 independent settings writes:29 frontend API tests passed (`08-api.log`). SQL/call-path lost-update finding recorded in issue08; no pre-change executable reproduction claimed. Actual SQLite interleaving proof is in the existing chat-default persistence case and will run with the final Rust build.

## Final integration gates

Run once source and independent review fixes stabilize. Do not reuse earlier-phase results.

1. Independent Standards and Spec reviews against the saved snapshot, with focused verification of every actionable finding.
2. `pnpm test`: support lifecycle/transport tests and full frontend suite.
3. `pnpm check`: Svelte/TypeScript plus browser/native harness TypeScript.
4. `python3 -B -m unittest discover -s scripts/tests -v`: fixture safeguards.
5. `cargo test --offline --manifest-path src-tauri/Cargo.toml`: full Rust and architecture suites, including shared timeline contract fixtures. Network/socket tests require local socket permission.
6. `cargo check --offline --manifest-path src-tauri/Cargo.toml`: production build without test-only cfg.
7. All browser specs, serial, with an owned Vite server and isolated browser backend. Do not run heavy compilation during motion measurements.
8. Fresh native test binary, then seven-file smoke lane, serial with disposable vaults. This validates real IPC, persistence and mounted document/chat workflows. Provider/live evaluation and opt-in release performance measurements are outside this deterministic rewrite gate; no performance improvement claim is made.

Failed runs, corrections, final counts and log paths will be recorded below as they occur.

## Completed common checks

- Fixture safeguards:8 passed (`python.log`).
- Support harness: initial sandboxed run could not bind loopback sockets (`support.log`, EPERM). Rerun with local-socket permission passed32/32 (`support-sockets.log`), including owned server shutdown and native transport lifecycle. This was an environment failure, not a code correction.

## Integration failures and corrections

The first full Rust run failed at `clean_close_waits_for_active_save_then_finalizes_and_old_runtime_is_inert_after_vault_switch`;190 reported failures included a cascade from the poisoned global file lock. Its manual prepared-token fixture no longer held an operation lease after that caller protocol was removed. The fixture now pauses a real save under the production lexical lease using the existing publication hook; the shutdown guarantee is unchanged. The corrected timeline subset passed252 tests (9 existing opt-in ignored), and the full suite is rerunning. Production `cargo check` passed (`rust-check.log`). The original failure remains in `rust-full.log`.

Independent review additionally found that the retained proposal Reload Disk callback targeted the active document rather than the reviewed one. With terminal save-before-release, that could persist text explicitly being discarded. Owners are replacing it with document-bound canonical reload and a retained-A/active-B composition regression. They are also closing the accepted single workspace presentation-operation contract; readiness is withheld until these corrections pass.

## Backend acceptance

Corrected full Rust run passed746 library tests,23 architecture tests;15 existing opt-in tests ignored (`rust-full-fixed.log`, library118.61s). This includes the actual SQLite defaults/visibility interleaving proof and final fixed scheduler source. Production cargo check passed. A fresh native smoke binary is building from that backend.

First full frontend run passed1121 tests and failed two architecture-fitness assertions (`frontend-full.log`). The chat scanner still required the removed flags-only `machine` field; coordinator replaced this with actual aggregate construction/transition calls and prohibition of parallel mutable data/operation fields. The workspace owner is correcting live-pane permission checks to use the existing capability boundary. Full final frontend run will follow remaining review fixes.

## Browser diagnosis

First26-file serial browser run:25 files passed; Map double-click-to-note first case showed initial Alpha instead of target Beta (`browser-all.log`). Unchanged focused Map rerun3/3 passed. Independent UI owner is collecting route/command/target timing in a second serial full run; no speculative product change or weakened target assertion is authorized by that result.

Second full run exposed a separate motion-fixture assumption: the Related-retarget test samples exactly the first animation frame after replacement and requires strict interior geometry. A newly installed animation may legitimately still be at its starting frame (`currentTime == 0`); the original assertion then treats a retained start as an endpoint snap. Coordinator is changing observation to wait for the replacement animation's first nonzero time, preserving exact start-keyframe continuity, actual interior geometry, replacement identity, active-motion and bounded deadline assertions. This changes when the real animation is sampled, not its production behavior or required smoothness.

Second diagnostic browser run:25 files passed, one animation-cleanup failure before the sampling correction; Map passed3/3 with Beta reached837ms after the first action and426ms after Enter, expected read→finalize→open sequence, no pending target or captured error. Original Map failure was not reproduced or explained; source edits/HMR during earlier integration runs are a confound, not a proven cause. See `map-startup-diagnosis.md`. A final serial all26 run follows strict source freeze with the motion-fixture correction. No Map production/test assertion/timeout change made.

Teardown correction extends the accepted review lifetime across routes: module-scoped document state survives Notepad unmount, so root/workflow review ownership must survive with it. Disposal retires local navigation/UI admissions; remount binds current callbacks to the same root. Durable proposal callbacks use route-independent API, and already-admitted durable completion settles the retained document once. No text snapshot or generic barrier exclusion was added. Real composed flush/remount/in-flight tests passed35 cases in `05-route-lifetime.log` (copied from owner result); independent follow-up review pending.

## Frozen-tree frontend acceptance

- Final full Vitest:145 files,1137 tests passed (`frontend-acceptance.log`,16.86s).
- `pnpm check`: Svelte0 errors/0 warnings and e2e TypeScript passed (`typecheck-acceptance.log`).
- Final frozen-tree browser run:25/26 files passed (`browser-acceptance.log`,3m04s). Map and corrected animation both passed. The cursor file failed its `before` hook because `document.hasFocus() && visibilityState === 'visible'` did not become true; no cursor assertions ran. This is a window-focus prerequisite failure, distinct from the unreproduced earlier Map failure. The unchanged cursor file is rerunning in its own browser session; no focus/geometry assertion is weakened.
- Final independent proposal Standards review closes the teardown/remount P1 and verifies that one admitted durable completion converges without replay. The underlying root/session is retained; no generic save-barrier exclusions or second snapshots were introduced.

The isolated cursor rerun reproduced the same focus prerequisite failure (`browser-cursor-acceptance.log`). Its Chromium setup selected a window handle but performed no focus-producing user interaction before requiring document focus; only the native branch explicitly showed/focused its window. Coordinator will focus the ready editor with a real WebDriver click before the existing focus assertion. Cursor geometry and visibility/focus requirements remain unchanged; this establishes the prerequisite rather than relying on ambient window focus.

Cursor focus correction passed12/12 geometry/selection checks in6s (`browser-cursor-focused.log`); the ready editor is clicked through WebDriver before asserting focus. Together with the other25 passing files on the final frozen-tree run, all26 browser files pass on the final behavior. This is not represented as a single26/26 run; preceding full-run and focused failure logs are retained. No Map code/test change was made. A trailing blank line reported by `git diff --check` was removed from paneViewModelFactory; no behavior changed and diff whitespace check now passes.

Fresh native binary built successfully (`native-build.log`, SHA256945d6ca47e3e009c93dfe9f4feec48c9cf57928e9e8275d6e4a4eb72caf72cc1). The seven-file smoke lane is running serially with isolated fixture roots (`native-smoke.log`).


## Final native acceptance and remaining uncertainty

Initial smoke run passed startup, commands and all timeline cases, then failed the first native Editing Windows input immediately after split (`native-smoke.log`). Added failure-only DOM/editability/focus diagnostics; no input behavior, assertion, timeout or production code changed. Focused diagnostic run passed (`native-editing-diagnostic.log`). Subsequent complete smoke run passed7/7 files and13 cases, with1 opt-in sustained measurement skipped (`native-smoke-acceptance.log`). The first failure is unreproduced and its cause is unproven; do not label it a confirmed readiness bug.

Actual process restart passed (`native-restart.log`, copied `native-restart-result.json`): original process clean-close receipt, post-close mutation rejection, process exit, new PID, recovered pending endpoint and anchor, continued mutation and second clean close. Uses the same pinned SHA256 from the fresh build above and a disposable vault. Both app processes exited before Vite/esbuild emitted EPIPE/callback shutdown noise; runner exit0 and result passed=true. No claim of clean dependency-server stderr is made.

Final E2E TypeScript passed again after adding readable input diagnostics (`e2e-typecheck-final.log`); `git diff --check` passed. Source changes after the last full frontend/Rust runs were E2E prerequisite/sampling/diagnostic fixes, whitespace and documentation only. Independent reviewers closed every confirmed production finding. All scoped acceptance gates are complete; provider/live evaluation and opt-in release/performance measurements remain outside this deterministic gate. No performance claim.

Aggregate source delta:−2,953 lines, including−2,681 frontend production and−183 frontend tests/support; see README and `changes.json` for categories. Frontend executable cases grew20 and Rust library cases grew3 during this phase; these are explicitly not reported as test-count reductions.
