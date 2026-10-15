# Prove expanded recovery and actual iOS simulator behavior

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
