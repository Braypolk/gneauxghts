# Prove expanded recovery and actual iOS simulator behavior

> Historical specification/issue record; outside the executable backlog. Original triage/dependency lines are a historical snapshot. See [outcome](../outcome.md).

Status: ready-for-agent
Type: task
Milestone: phase-complete
Blocked by: 09, 10, 11

Follow [the spec](../spec.md). Previous desktop publication faults and simulator
relaunch passed separately; they do not establish this expanded matrix.

## Work

- Run shared journeys on actual desktop/iOS WKWebViews through native SQLite,
  transport, editor and NoteTimeline. Use separate persistent app/vault and both
  protocols; record SDK/runtime/build constraints.
- Inject interruption before staged tool outcome, at pending review, after native
  intent/publication/receipt and before Pi terminal persistence.
- Cover rollback/COMMIT failure, disk-full or equivalent native storage failure,
  lease expiry/disconnect, partial stream, cancellation and stale owners.
- Exercise background/foreground and termination/relaunch with ordinary edits,
  review and interrupted inference. Test achievable simulator pressure/suspension
  behavior without claiming physical-device guarantees.

## Acceptance

- Both platforms pass essential chat/context/citation/Save/review/research flows,
  supported follow-ons and both protocols. Observe a bounded iOS live journey per
  protocol when existing endpoints are reachable; blocked required live checks
  remain explicitly incomplete.
- Each publication boundary converges to one effect, stable Note Identity and
  receipt, or explicit retained conflict/failure. Duplicate Keep/stale callbacks
  cannot add effects after restart.
- Storage failure cannot announce uncommitted state as durable. Live text is
  retained where available and failed handoff stays blocked.
- Interrupted inference produces no implicit launch requests; explicit Retry starts
  the intended continuation. Suspended/expired leases cannot commit later.
- Record revisions/commands and pass/fail/blocked results. Complete unaffected gates
  if externally blocked; physical iPhone/radio/distribution remain unverified.

## Starting points

`scripts/pi-prototype/desktop-gate.mjs`, `ios-gate.mjs`, `fault-gate.mjs`,
`verify-effects.py`, native facades and existing background/review harnesses.
Preserve default background automation; hands-on launch is an explicit workflow.

## Comments

### 2026-10-15 — integrated implementation and bounded evidence reconciliation

Fault/crash/storage/iOS drivers and suspension/local-live preparations are integrated. Matrix **F/C** records four passed native cases each, **D** five passed native-storage checks, and **I** a passed watcher slice. The whole expanded desktop and iOS transcript runs remain failed at their documented boundaries.

Final desktop/iOS expanded and transcript checks remain open. Prepared artificial suspension, local-iOS-live and owned churn have not executed. Hosted live is explicitly user-deferred; simulator evidence does not establish physical touch/device/radio or real OS-pressure guarantees. See the [current validation matrix](../../../pi-durable-chat-evaluation/validation-matrix.md).

### 2026-10-16 — Final acceptance reconciliation

Implementation is integrated and bounded acceptance is complete under the [root semantic acceptance](/private/tmp/pi-v51-root-final-acceptance-20261016.json). [v51 iOS](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-BTSO9O/ios-interactive-gate.json) passed ordinary edits/exact version-10 review/partial state after STOP/CONT and held lease expiry with zero rejected durable rows. [v51 desktop](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-O7czrc/desktop-interactive-gate.json)/[v51 iOS](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-BTSO9O/ios-interactive-gate.json) passed all five SQL checks; [five iOS boundaries](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-publication-yw2Vaa/ios-publication-fault-gate.json) passed after-intent/publication/receipt, prepared-review and transport-completed with explicit Retry/no replay/one effect.

Material limits: Actual WKWebView and native SQLite fixture proof is bounded; STOP is artificial, page quota SQLITE_FULL is not host-disk exhaustion. Hosted live user-deferred; physical devices/touch/radio/distribution/real OS pressure unverified.

The original triage/dependency lines above are historical; this record is outside the executable backlog. Default production adoption and migration remain deferred.

See [ticket 12 outcome](../outcome.md#ticket-12) for bounded acceptance and material limits.
