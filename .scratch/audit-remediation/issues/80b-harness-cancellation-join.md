# Join native harness cancellation and cleanup

Status: ready-for-agent
Progress: complete
Owner: audit_timeline

## Evidence and scope

Independent review found the three native runners and Vite wrapper await only an admitted server handle. Cancellation while admission is pending can exit before its TERM/KILL teardown completes. `ownedServer.stop` also returns immediately after SIGKILL without joining child exit. Two runner stop races retain 10-second timers. Native suite lacks a cancellation latch, so a signal followed by a graceful zero exit can start another spec. Native config creates a fixture on every config import, including worker imports; only launcher onComplete cleans up.

## Plan before edits

1. Retain admission in a shared owned-server lifetime, abort then join pending admission and idempotent stop; distinguish expected abort reason from unexpected failure. Await child termination with a bounded post-KILL join.
2. Use this owner in Vite wrapper and all three runners; record unexpected cleanup failures; prevent exit before join. Cancel successful native-stop timeout races.
3. Latch native suite cancellation, preventing another spec after graceful signal exit; cover with a fake executable child.
4. Confirm WDIO worker config import and replace per-import fixture allocation with launcher-created, inherited disposable fixture ownership. Only creator removes it.
5. Add focused child-process regressions, run support tests and E2E typecheck. Preserve exact process ownership, nonce admission, fatal launcher service admission, pinned binaries, and scale-fixture ownership.

## Validation

Pending. Sandbox denied loopback bind (EPERM) for first standalone review reproduction; rerun tests with required local-network execution permission.

## Outcome

Implemented all five planned repairs and regression coverage; see `../harness-review.md`. Full support tests 24/24 passed (~2.7s), E2E TypeScript check and changed runner syntax checks passed, scoped diff whitespace check passed. Worker config reimport confirmed against installed WDIO source. Pending-admission TERM-resistant process test establishes actual forced-exit join and immediate port reuse; suite cancellation test establishes no second spec after graceful zero exit. Root owns native smoke acceptance. Source freeze sent; no commits.
