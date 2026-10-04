# Native suite forced cancellation leaves descendants alive

Status: ready-for-agent
Progress: Complete on Unix. Forced reproduction failed before and passed after; 32 support tests and seven native smoke files passed. Independent ownership review passed. Windows behavior remains unchanged.
Priority: P2
Owner: coordinator (execution/fix); audit_ui_semantic (independent review)

## Failure path

`e2e/support/nativeSuite.mjs:20–23` signals only the spawned WDIO launcher PID and forces that PID with SIGKILL after10s. The launcher's service owns the native app and Vite cleanup, so forced termination bypasses those owners. The installed `@wdio/tauri-service/dist/esm/index.js:1606–1614` spawns the app as a non-detached child; `onComplete` stops embedded processes at2698–2710. `e2e/support/nativeTauriService.mjs:onComplete` then invokes harness cleanup; `e2e/wdio.native.conf.ts` delegates to `stopViteServer`, whose server is a separately detached process group. Inherited children do not receive a signal sent only to the launcher's PID. Vite already registers a direct SIGTERM/SIGINT handler independently of service onComplete, so ordinary asynchronous teardown stalling does not establish a Vite leak. The bounded finding is the inherited native-app/worker descendant.

Existing `nativeLifecycle.test.mjs` covers graceful zero exit after TERM, not launcher forced shutdown. An occupied subsequent native/Vite port is a concrete consequence if teardown stalls; no arbitrary port-based kill is acceptable.

## Reproduction and oracle

Run from the repository root:

```sh
node .scratch/pre-merge-validation/reproduce-native-suite-cancellation.mjs
```

This phase-only script invokes the unmodified real `runNativeSpecs`. Its injected launcher ignores TERM and owns two disposable loopback listeners: one normal child (embedded-app shape), one detached child (Vite shape). The launcher retains an independent TERM cleanup hook for its detached listener, matching the relevant Vite signal-lifetime shape. After the existing10s fallback kills the launcher, the script checks whether the native-shaped listener remains reachable, the detached listener has stopped, and an unrelated owned sentinel remains alive. It records PID/port/token evidence and runner exit status as JSON. Exit1 means the leak was reproduced; exit0 means no descendant leaked; exit2 indicates setup or cleanup failure. It does not launch an app/browser or bind configured application ports.

Every child PID is recorded immediately on spawn. Finally first stops the launcher, then terminates only recorded owned descendants and the sentinel (TERM, then bounded KILL fallback), verifying each listener is gone. Temporary files are removed only after this cleanup. A failed readiness assertion still cancels/joins the actual runner and executes cleanup. No slow test is added to the default suite.

## Proposed correction constraints

First capture the failing reproduction. Root then chooses the smallest ownership correction. Preserve fresh sequential spec execution, graceful shutdown opportunity, cancellation exit codes, no next-spec admission, and foreign process safety. An owned Unix launcher process group can cover inherited descendants; retain Vite's existing independent signal cleanup for its detached group. Do not introduce a second registry or generic process scanner without evidence of need. Add fast focused regression coverage if the final API permits a short deterministic deadline; do not add a10s ordinary test simply to exercise the timeout.

## Comments

2026-10-03: Independent pre-merge static review found the gap; root requested the standalone owned-process reproduction before selecting a fix. Full coverage review: `../review-coverage-harness.md`.

## Implemented correction and evidence

Root's `native-cancel-before.log` confirms actual failure: runner returned143 after10001ms, inherited embedded-app PID76669 remained alive and token-reachable, detached Vite was stopped, unrelated sentinel survived, and final cleanup removed all three. The report was narrowed before implementation to this demonstrated inherited-descendant gap.

`nativeSuite.mjs` now starts each Unix launcher in its own process group. Initial cancellation still signals only the launcher PID so WDIO can order graceful cleanup. The existing10s forced fallback targets that exact owned group. After any launcher exit (including early zero) or spawn-wait failure, per-launch finally clears the timer and kills any residual owned group, tolerating ESRCH. It never scans ports/process names. Windows retains detached:false and existing PID-only signal behavior; this change introduces no Windows descendant-cleanup guarantee.

The existing fast graceful-zero cancellation case now creates a TERM-ignoring inherited descendant, waits until its handler is installed, then requires cancellation143, no second spec, and descendant exit. Its finally explicitly cleans that captured PID if run against an old implementation. No new ordinary test or10s delay was added. The standalone forced-deadline script retains separate evidence for the slower branch and foreign sentinel preservation.

Exact two-file change against the pre-merge candidate snapshot: `../native-cancellation-fix.patch`. No source or test execution by implementer; root will run the forced reproduction and support gate. Source frozen for independent review and coordinator execution.
