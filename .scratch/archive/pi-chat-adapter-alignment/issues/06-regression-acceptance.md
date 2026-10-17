# 06 — Accept adapter alignment across desktop and iOS simulator

Status: ready-for-agent
Execution: implemented and accepted
Type: task
Blocked by: 01, 02, 03, 04, 05

## Scope

Validate the combined [spec](../spec.md) against the production shared composition.
This ticket records integration and preserved guarantees, not new parity features.
Use disposable generated vaults and synthetic publication fixtures; do not operate
on the user's original vault. No live hosted key or physical device is required.

## Validation

- Run current type/build checks and relevant frontend/native/architecture suites,
  including provider, citation-provider, compaction-authority, view, configuration,
  storage, native authority and publication behavior. Resolve failures introduced
  by this effort; identify unrelated failures with reproducible evidence.
- Exercise desktop local chat with streamed text/reasoning, a real note read/citation,
  rapid conversation switching during generation, Stop/queued withdrawal, terminal
  failure/new attempt, history paging across compaction and reopen recovery.
- Inject safe runtime reports and a terminal Harness failure. Verify understandable
  bounded diagnostics, no false stuck/thinking claims and no raw canary disclosure.
- Exercise native restriction/revocation during dispatch, streaming and delayed
  terminal admission, including compaction. Retired identity cannot deliver fresh
  output or resume work after reopen; narrowing creates a fresh context.
- Preserve task-only synthetic create/update acceptance: independent write grants
  and default review, exact payload approval, dirty/conflicted target rejection,
  lost-ack reconciliation without another effect, committed-warning success and
  canonical editor adoption. No mutation tool or review product UI is added.
- Verify refresh/restart joins native effects/transport and Pi storage release;
  an observer's cancellation is never accepted as proof of durable quiescence.
- Build and run a bounded iOS simulator regression using the same production
  adapters: streaming, switch/cancel observation, safe diagnostic presentation,
  Stop and reopen. Desktop fault/publication coverage plus existing shared native
  suites remain required; simulator results do not claim physical-device acceptance.
- Hosted Responses behavior is covered by controlled protocol fixtures, including
  request options, streaming and errors. Keep live hosted acceptance explicitly deferred.

## Completion evidence

- Record the dependency/package pin, relevant commands/results, selected sanitized
  evidence and platform/provider limits. Reconcile all six ticket outcomes with
  actual acceptance; do not label an unrun required check passed.
- Compare startup discovery and list-read counts on matched fixtures. Summarize
  removed plumbing, retained native guarantees and any compatibility adapter still
  justified. Do not claim lower total storage/latency without matched measurements.
- Update authoritative architecture text only where implementation changed, retain
  ADR 0012 ownership and tracker conventions, and consolidate completed outcomes
  under `.scratch/archive/`. Preserve evidence for unresolved failures.

## Comments

### 2026-10-16 — Integration started

The same-worktree orchestrator has implemented dependencies 01, 03 and 04 and
assigned fresh-context agents to 02 and 05. Current type checking passes; the broad
frontend regression passes 144 files / 1,138 tests. A temporary matched startup
fixture run against the pre-effort runtime confirms five model-configuration calls
before alignment versus three after alignment, with all five valid bindings
restored before scheduling in both cases. Temporary comparison sources were removed.
Independent Standards and Spec reviews are in progress. Desktop and simulator
acceptance remains pending; the isolated simulator is booted and a fresh finite
authenticated loopback controller and synthetic provider fixture are running.

### 2026-10-16 — Accepted

All five implementation dependencies are accepted. Final current-source checks:
type checking (zero errors/warnings), ordinary production build, frontend
**1,159 tests / 145 files**, support **32 tests**, native library **709 passed /
19 pre-existing ignored**, and simulator controller **8 tests**. The native E2E
binary was rebuilt with `e2e-wdio`; five sequential isolated desktop gates pass:
ordinary native chat **10**, publication **6**, standard compaction **2**, adapter
diagnostics **2**, and actual local-model chat/read/citation **2** (**22 total**).
The public hosted Responses parser/options/errors are controlled-fixture evidence;
no live hosted credential was required.

The signed simulator bundle uses the same production adapters. Its bounded
programmatic checks pass for live text/reasoning (including collapsed/expanded
reasoning), diagnostic canaries and hostile getters during generation, two
independent running chats with switch/Stop, native read/citation, synthetic terminal
presentation and actual different-process reopen. Reopen retains identical
transcript hashes/sources, resets ephemeral diagnostics and dispatches no inference.
The native/simulator terminal notification is explicitly a presentation fixture;
the actual failed Harness/storage behavior is separately exercised by
`runtimeDiagnostics.test.ts`. No physical-device, touch/keyboard, live hosted,
simulator live-model, or general resource-performance claim is made.

The initial simulator probe incorrectly inspected persisted entries for live
tokens; it was corrected to record safe live text/reasoning counts. A subsequent
reopen setup omitted opening the chat pane, hit its finite deadline, and was
replaced by a fresh launch with explicit `open-chat`. Neither is product-failure
evidence. The final scenario and reopen assertions passed. Test-only markers and
the fresh control token are absent from the final ordinary bundle.

Independent Standards and Spec reviews have no remaining actionable findings. The
observed acquisition-error canary leak was corrected and covered before acceptance.
Measured startup discovery is **5→3** calls with all five valid bindings restored;
list fixture results are recorded in 05. The selected-model resolved-handle adapter
and native final option enforcement remain justified on Pi/AI/Chord **1.3.0**.
No total storage or latency improvement is claimed. Current architecture and
behavior invariants describe only verified changes. Desktop test apps, the owned
simulator app/device, and controller/provider listeners were closed; the pre-existing
Fresh Chat desktop app was preserved. Completed records are consolidated in the
archive outcome, outside the executable backlog.
