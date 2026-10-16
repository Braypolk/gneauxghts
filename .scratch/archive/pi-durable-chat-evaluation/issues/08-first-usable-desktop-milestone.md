# Prove and hand off the first usable desktop evaluation

> Historical specification/issue record; outside the executable backlog. Original triage/dependency lines are a historical snapshot. See [outcome](../outcome.md).

Status: ready-for-agent
Type: task
Milestone: first-usable-desktop
Blocked by: 01, 02, 03, 04, 05, 06, 07

Follow [the spec](../spec.md). Make the app available for hands-on evaluation
before remaining phase work without claiming full parity.

## Work

- Run spec journeys 1–5 through the persistent native desktop workspace/chat/review.
- Run shared observable behavior scenarios against old and Pi builds in separate
  roots; add focused failure/race checks where needed.
- Exercise bounded live local-compatible and hosted Responses journeys: discovery/
  citation, follow-up, reviewed mutation, deterministic Save and Stop/Retry.
  Distinguish fixture passes from live observations.
- Write evaluation-local run instructions, hands-on checklist and validation matrix.
  List temporary research/compaction, attachment/web/transcript gaps and phase
  deferrals explicitly; do not silently change unavailable controls' behavior.

## Acceptance

- One launch opens normal UI against the copied vault/persistent Pi data; all six
  agreed first-milestone workflows pass through actual native boundaries.
- The build excludes the old lifecycle coordinator/model loop and has no mirrored
  generic state. Unavailable tools cannot invoke hidden fallback.
- Restart, concurrent sessions, dirty editor, failed checkpoint and changed source/
  target outcomes are recorded. Save origin navigation works already.
- Record affected frontend/native/architecture checks and default-build regression
  checks. Required live-provider blockers remain explicit and keep this ticket open;
  fixture passes cannot substitute for live use.
- Hand off artifact/command and checklist. Record user feedback separately from
  agent-observed checks; do not invent a user trial or make feedback an implicit
  dependency. Continue independent follow-ons without another implementation
  approval round once implementation is authorized. Final closure is 09–13.

## Comments

### 2026-10-15 — prepared normal-workspace fixture acceptance

Added a separate `interactive-gate` runner, ordinary workspace UI driver and
synthetic compatible/Responses provider contract. The gate uses fresh generated
data only, preserves the diagnostic baseline route, records phase screenshots/
request receipts and checks no inference for Save or automatic network replay on
relaunch. Conversation/review setup is Pi-owned and synthetic notes enter native
NoteTimeline commands; normal sends, permissions, model/session selection,
editor/review actions and whole Save use the retained UI. Explicit repeated-text
append initiation uses public Save parameters and is labeled separately from the
UI-initiated whole-answer journey. See [desktop acceptance](../../../pi-durable-chat-evaluation/desktop-acceptance.md)
for commands, matrix and remaining work.

Preparation is not acceptance: dependencies 01–07 were still undergoing native
integration when this harness was written. No build, native launch, live provider,
private-vault access, user feedback or completed 08 is claimed by the implementation
agent. Pure fixture contract tests pass **12 checks** without opening network
listeners. The root orchestrator owns the native lease and subsequent receipts.

Preparation verification: `pnpm check` passes with **0 errors/0 warnings** plus
E2E TypeScript; the root/runner safety suite passes **3 tests**, including inherited
interactive-fixture refusal for manual evaluation and private-root refusal for the
new gate. The orchestrator's first native attempts found a startup synchronization
bug (WebDriver session before document load) and then selected-context setup in a
single pane. The runner now follows the established ready `tauri` driver protocol,
waits for the actual workspace and preserves frontend/native logs. The driver now
keeps a real editor mounted beside chat via the normal split control before
selecting text; the canonical selected-cursor assertion remains mandatory. These
repairs are preparation, not a passed native gate.

### 2026-10-15 — active Stop receipt and separate failure phase preparation

The orchestrator's subsequent native run reached a real active-stream Stop and
explicit Retry; its first STOP request closed without provider completion. The
next proposal send exposed a stale conversation-read race, owned by lifecycle
integration. This is partial native evidence, not a passed base gate or completed
milestone. The interrupted-process setup now targets its exact new message and
requires streaming status before reporting termination-ready state.

Prepared an optional `failures` phase in `interactiveFailures.ts`, enabled after
the base relaunch with `PI_PROTOTYPE_INTERACTIVE_FAILURES=true`. It checks visible
checkpoint failure/recovery, stale citation refusal, changed-target Keep conflict,
and dirty ordinary editor preservation during passive proposal arrival. Dedicated
synthetic notes isolate these effects from the base kept/saved identities. The
dirty-arrival fixture delays one provider tool reply for 1200 ms while actual
ordinary editing continues; it must observe local bytes differing from canonical
bytes at arrival, or it fails without claiming dirty-buffer protection. Both
protocol planner suites now pass **14 checks**. Native execution of this phase
remains pending; aggregate typecheck currently reports concurrent compaction and
transcript integration errors, with no diagnostics in the prepared driver files.

### 2026-10-15 — integrated implementation and bounded evidence reconciliation

The normal-UI harness, persistent app and handoff checklist are integrated. Matrix **M** records a passed/closed bounded persistent local-live scope; **D** records 14 first-launch and ten relaunch checks passed. These are actual observations beyond the historical preparation comments above.

The complete expanded fixture run **D** still failed its strict parent-summary receipt. Hosted live is explicitly user-deferred; no user feedback is invented or made an implicit dependency. Expanded acceptance remains open. See the [current validation matrix](../../../pi-durable-chat-evaluation/validation-matrix.md) and its remaining gate queue.

### 2026-10-16 — Final acceptance reconciliation

Implementation is integrated and bounded acceptance is complete under the [root semantic acceptance](/private/tmp/pi-v51-root-final-acceptance-20261016.json). Whole [v51 desktop](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-O7czrc/desktop-interactive-gate.json)/[v51 iOS](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-BTSO9O/ios-interactive-gate.json) each passed 178 synthetic requests with first14/relaunch10 and 25 follow-on checks; supplemental evidence/refinement/cancellation passed. [final manual](/private/tmp/pi-v51-manual-acceptance-20261016.json) passed final two-launch local handoff, both normal quits and retained state.

Material limits: Hosted live is user-deferred. Initial xyySVL desktop failure after first14/shared6 is retained; same-source/binary operational retry passed, cause unproved. Agent observations are not invented user feedback.

The original triage/dependency lines above are historical; this record is outside the executable backlog. Default production adoption and migration remain deferred.

See [ticket 08 outcome](../outcome.md#ticket-08) for bounded acceptance and material limits.
