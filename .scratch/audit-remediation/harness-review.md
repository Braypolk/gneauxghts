# Independent native harness correctness review

Scope: ownedServer.mjs, viteServer.ts, nativeTransport.mjs, nativeSuite.mjs, both WDIO configurations, processRelaunch/currentScaleNative/restartLifecycle runners, and helper tests. Review focuses process ownership, cancellation, deadlines and cleanup. Exact owned PID/process-group checks and nonce admission prevent accepting or killing an unrelated port owner. Direct Node Vite launch removes the previous pnpm launcher layer.

## Findings

- **P1: pending admission is not joined before runner exit.** processRelaunch cleanup (318–335), currentScaleNative cleanup (175–185), restartLifecycle cleanup (124–142), and viteServer stop (30–37) await only a resolved handle. During startOwnedServer readiness this is undefined; abort starts asynchronous TERM/KILL, while signal handler can immediately process.exit. Retain and join admission before exit. Confirmed call-path; root approved repair under 80b.
- **P2: stop resolves before forced child exit.** ownedServer.mjs:57–60 waits only before SIGKILL; when TERM is ignored, a returned stop does not establish child termination or port release. Join exit after force kill with bounded error reporting.
- **P2: native suite does not latch cancellation.** nativeSuite.mjs:21–26 forwards a signal but checks only child exit code. A graceful zero exit starts the next spec after cancellation. Latch cancellation and return the appropriate signal status.
- **P2: config import allocates worker fixtures without cleanup.** wdio.native.conf.ts:22–27 allocates on each process import, while launcher-only onComplete:91–94 owns cleanup. Verify WDIO import path and share the launcher fixture through inherited state, with creator-only removal.
- **P2: successful native stops retain deadline timers.** processRelaunch.mjs:65 and currentScaleNative.mjs:67 race child completion against a referenced 10s timer without cancelling it. Each completed kill keeps the runner event loop alive until timeout. Cancel the losing timer.

## Coverage and limits

Read the complete lifecycle/transport/ownership helpers, tests, configurations and runner spawn/connect/stop/cleanup paths; sampled scenario bodies for connections between ownership and mutations. No native UI acceptance launched during this review. Initial disposable loopback reproduction was blocked by sandbox EPERM; no child was created. Repairs and regression outcomes will be appended after implementation.

## Repair and verification (80b)

All five findings above are implemented, with root authorization after the initial review report:

- `ownedServer.mjs:createOwnedServerOwner` owns the admission promise from creation, aborts then joins admission and teardown, suppresses only its exact cancellation reason, and preserves other errors. The lower-level stop waits for the direct child's exit after SIGKILL with a bounded deadline. Successful admission rechecks cancellation. `viteServer.ts` and all three native runners use the owner; signal exits follow the join. Unexpected cleanup failures are reported in runner evidence.
- `nativeSuite.mjs:runNativeSpecs` latches SIGINT/SIGTERM, forwards it only to the owned child, escalates after a bounded grace period, clears the escalation timer on exit, and refuses subsequent specs even when the interrupted child exits zero.
- `nativeFixture.mjs` allocates only in the WDIO launcher. Workers inherit its existing canonical disposable root, reject symlink substitution, and cannot remove it. Configuration cleanup runs in `finally` even if Vite cleanup fails, and fatal onPrepare admission failure explicitly cleans up before throwing `SevereServiceError`. Caller-owned scale fixtures retain their existing ownership.
- Both native stop races cancel their losing timeout timers.

The worker-import finding was confirmed against installed WDIO 9.30.1: `@wdio/runner/build/index.js` constructs and initializes ConfigParser per worker (654–658); `@wdio/local-runner/build/index.js` inherits process.env and adds WDIO_WORKER_ID (256–258). Thus this is an actual allocation leak, not a theoretical import pattern.

Validation: `node --test e2e/support/*.test.mjs` **24/24 passed**, ~2.7s. This includes an actual child ignoring TERM during readiness, concurrent owner stop calls, force-kill join followed immediately by binding the same port, preservation of unexpected spawn errors, suite cancellation after an actual child exits zero, worker fixture reuse/creator-only cleanup, and worker symlink rejection without target deletion. Existing occupied-port, wrong-identity, child-failure, hung-response, transport-deadline, fixture-containment and binary-admission tests pass. `pnpm check:e2e`, syntax checks for all changed .mjs runners, and scoped `git diff --check` passed. Tests used ephemeral local ports with approved local-network execution; no native application or user vault was launched by this review.

The shared transport retains its explicit request deadline, while waitUntil separately bounds its caller. Current runner readiness callbacks do not forward waitUntil's optional signal into requests; a timed-out readiness request can remain in flight until transport timeout or owned-app cleanup. No subsequent write is driven by those discarded readiness results; cleanup terminates the exact owned app. This is not counted as an additional correctness finding for the reviewed call paths, and the transport was not changed.

Native UI acceptance remains root-owned. Source freeze was sent before root smoke execution; this review does not claim real native SIGINT/UI acceptance. No commits were created.

## Native acceptance follow-up: ordered service lifetime (80c)

Root native acceptance found the app lifecycle spec passing (3 cases), followed by timeline startup stuck at about:blank with no IPC bridge after 30s. Installed WDIO invokes distinct launcher onPrepare hooks concurrently via Promise.all. The prior custom admission service and Tauri service therefore raced; source-array order did not serialize them. Separately, config.onComplete runs before service onComplete, so prior config cleanup could delete the fixture while the app remained live. These are actionable integration findings missed by the helper-only checks above.

Implemented a single absolute-path `nativeTauriService.mjs` service module. It exports the unchanged Tauri worker service and a launcher subclass that awaits admission before inherited app preparation. Its idempotent completion awaits inherited app teardown before stopping Vite and deleting the creator fixture. Failed preparation joins the same cleanup; preparation/cleanup errors retain fatal SevereServiceError behavior. The premature config completion hook was removed. IPC readiness moved to Mocha rootHooks.beforeAll because WDIO's ordinary before hook does not reliably fail the suite on rejection.

Four focused adapter tests pass: deferred admission forbids app launch until resolved; worker export identity is retained; failed admission never launches and joins cleanup; failed partial app launch cleans up once; failed app teardown still runs server/fixture cleanup and propagates a fatal error. E2E TypeScript and adapter syntax checks pass. Source frozen and handed to root for native rerun; no native acceptance success is claimed here.

After 80c, the complete cheap support suite passed **28/28**, ~2.7s; scoped diff whitespace check passed.


## Native history acceptance follow-up (80d)

After startup ordering was repaired, smoke3 reached the real app and exposed three native-spec synchronization defects. Two restore actions clicked while the selected diff request still disabled the button; missing-note pagination mistook the temporary loading label for page completion. The spec now waits for completed selected revision/diff state and a clickable Restore action, and paging awaits appended records plus idle state. Production behavior and all existing history assertions are unchanged. Root owns the subsequent native acceptance run.

The final Rust run's catalog failure was a stale consumer assertion after issue98 restricted ordinary lexical search to Note documents. Updated the test to use actual cross-kind evidence_matches with the catalog identity, asserting the exact managed-chat passage and its removal, plus Note-only exclusion and preserved task projection. Focused test1/1 passed; E2E types and scoped diff check passed. See issue80d for exact command/evidence.
