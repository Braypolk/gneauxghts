# Native suite cancellation correction review

Progress: Complete — no actionable finding in the frozen source correction. Coordinator execution remains the acceptance gate.

## Scope and evidence

Independently reviewed issue `03-native-suite-cancellation.md`, `native-cancel-before.log`, the phase reproduction script, frozen `e2e/support/nativeSuite.mjs` and `nativeLifecycle.test.mjs`, and the related native-service cleanup composition. Applied the repository code-review skill's Standards and Spec axes. No source changes, builds, process launches, tests, or reproductions were performed by this reviewer.

The coordinator's before log demonstrates the original bounded defect: the runner returned 143 after its 10-second forced launcher shutdown, while the inherited app-shaped listener remained alive/reachable. The separately detached Vite-shaped listener had stopped through its independent handler, and the unrelated sentinel survived. This establishes inherited descendant leakage; it does not establish failure of Vite's existing independent signal cleanup.

## Findings

- **Correctness/Spec:** No remaining actionable finding in the inspected correction.
- **Standards:** No demonstrated maintenance-cost smell or documented-standard violation. The correction adds a local owned-process-group boundary, not a process scanner, port killer, second registry, or generalized lifecycle framework.

## Verified source behavior

- `nativeSuite.mjs:20–26,41`: only Unix launchers are detached into a fresh process group. Group cleanup addresses `-child.pid` from the process this invocation spawned; missing/spawn-failed PIDs are not signaled. `ESRCH` is accepted as already cleaned up. No name/port matching or unrelated group discovery is introduced.
- `nativeSuite.mjs:28–34`: initial SIGTERM/SIGINT still reaches only the launcher PID. WDIO retains its graceful cleanup opportunity and Vite can execute its existing independent handler. After the unchanged 10-second allowance, fallback targets the owned Unix launcher group, including inherited native/worker descendants.
- `nativeSuite.mjs:43–55`: the per-launch `finally` kills residual inherited group members even when the leader exits gracefully with zero status. It resets the timer before retiring that launcher's identity. This closes the second orphan path where clearing the old timeout on leader exit previously abandoned a surviving descendant.
- `nativeSuite.mjs:39–40,56–62`: cancellation still prevents the next spec, preserves 130/143 exit semantics, and removes signal listeners/timers. Non-cancelled failed specs still return their failure; successful specs remain sequential.
- Windows remains `detached: false` with PID-only fallback. The source makes no expanded Windows descendant-cleanup guarantee.

## Regression contract

The existing graceful-zero regression now creates a real inherited descendant that explicitly ignores TERM. Readiness waits for both handlers before cancellation, then asserts runner 143, only the first spec admitted, and descendant disappearance. It retains a bounded readiness/exit wait and a recorded-PID fallback cleanup if the assertion fails against the old runner. This tests the graceful-leader exit branch without adding a 10-second ordinary test.

The coordinator's phase reproduction exercises the separate forced-timeout branch and retains the unrelated sentinel oracle. Both checks are needed: a forced-only proof would miss residual children after a successful leader exit, while the fast ordinary regression cannot prove timeout fallback itself.

## Acceptance limits

Source review supports the correction. The coordinator must record the post-fix forced reproduction and ordinary support-test results before closing issue03. This review does not claim those runs passed, nor does it claim cleanup of a descendant that deliberately escapes the owned Unix group. Vite is intentionally separate and continues to rely on its existing independent owner. No platform beyond the coordinator's execution environment is claimed validated.
