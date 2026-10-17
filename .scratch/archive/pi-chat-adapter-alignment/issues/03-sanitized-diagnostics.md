# 03 — Surface sanitized Pi diagnostics without retaining raw errors

Status: ready-for-agent
Type: task
Blocked by: none
Execution: implemented — focused checks passed; integrated desktop/simulator acceptance belongs to ticket 06

## Problem and scope

`Harness.open` currently supplies a no-op `onReport`, hiding extension/runtime
diagnostics. Integrate Pi's reporting and closed/watch failure outcomes through a
small safe diagnostic adapter and existing chat failure presentation. Read the
[spec](../spec.md), especially its diagnostic and execution-ownership boundaries.

Primary code: `src/lib/features/chat/pi/runtime.ts`, `nativeProvider.ts`,
`src/lib/features/chat/ui/piConversationView.ts`, `ChatPanel.svelte` and mounted
Activity/error components. Inspect the installed `onReport` and `harness.closed`
contracts rather than assuming every report has an associated conversation.

## Work

- Normalize recognized Pi/native categories to an allowlisted code, severity/stage
  and curated message. Include only demonstrably safe typed identifiers when needed;
  unknown errors receive a fixed useful fallback. Never interpolate raw `message`,
  `cause`, stack, serialized objects or provider text into diagnostics.
- Connect `onReport` and actual terminal Harness/watch failures. Keep diagnostics
  bounded and ephemeral, with a non-throwing sink; do not write another durable
  event ledger or alter Pi recovery, retry classification or task settlement.
- Show actionable failures through the existing chat error/Activity presentation.
  Keep reports without verified conversation identity at runtime scope; do not
  assign them to whichever conversation happens to be selected. Coalesce repeated
  reports so rerenders do not create duplicate notices or flood Activity.
- Retain upstream failures' real meaning: an observational report does not declare
  generation failed or stuck. A failed Harness visibly requires reopening through
  the existing supported lifecycle; diagnostics must not silently resubmit work or
  reopen an owner that has begun irreversible shutdown.
- Keep detailed ordinary tool failures on their existing safe domain-result path;
  this ticket does not replace tool results with generic runtime reports.

## Acceptance and validation

- Inject a reported extension failure, terminal storage/Harness failure, unknown
  error and repeated report; verify safe presentation, scoping and lifecycle cleanup.
- Adversarial errors carry canaries in nested causes, strings, stacks, provider
  bodies, prompts/reasoning, note titles/content, credentials, headers, URLs and paths.
  None appears in displayed diagnostics, console/log output or retained records.
- Reporting cannot throw into Pi, cause an extra inference/publication, change
  recovery classification, survive Running Vault disposal incorrectly, or update
  a disposed view. Distinct real failures remain distinguishable by curated codes.
- Sanitizer and mounted/runtime behavioral tests pass; existing provider error,
  view, native authority and restart checks remain valid. Record the diagnostic
  shape and its privacy boundary in the outcome/current architecture as appropriate.

## Comments

### 2026-10-16 implementation and focused evidence

- `pi/diagnostics.ts` owns an ephemeral sink capped at 12 notices, coalescing a
  repeated code/scope with a count capped at 999. Records contain only curated
  code/severity/stage/message, count and an optional verified numeric conversation
  identity supplied by the observer caller. Raw values are never retained,
  stringified, logged or traversed; accessors and throwing proxy inspection are
  contained. Subscriber throws/rejections cannot escape reporting.
- `runtime.ts` connects `onReport` as an unscoped observational warning and uses
  the actual `harness.closed` result to establish terminal runtime failure.
  Explicit close clears and seals reports, then disposes subscribers. Diagnostics
  perform no retry, submission, inference, publication or reopen operation.
- Both selected conversation/title watch failures use the safe sink, guarded by
  the disposable selection lifetime. Expected cancellation produces no notice.
  The view derives runtime availability from the sink and guards admission after
  failure; ChatPanel disables corresponding actions while retaining the transcript,
  conversation picker and editable unsent draft. Runtime failure guidance directs
  the user to restart the app; observational reports leave admission available.
- `PiRuntimeDiagnostics` renders curated runtime notices separately from verified
  conversation notices, coalesces repeated reports and supports dismissal only
  while the runtime is open. Detailed ordinary tool results keep their existing
  domain path.
- Focused command:
  `pnpm exec vitest run src/lib/features/chat/pi/diagnostics.test.ts src/lib/features/chat/pi/runtimeDiagnostics.test.ts src/lib/features/chat/ui/PiRuntimeDiagnostics.svelte.test.ts src/lib/features/chat/ChatPanel.diagnostics.svelte.test.ts src/lib/features/chat/ui/piConversationView.test.ts`
  passed **28 tests in 5 files**. Evidence includes an actual throwing generation
  extension hook that completes its original single inference, a real Harness
  storage failure, bounded/coalesced reports, adversarial getters/proxies and
  nested sensitive canaries, late failure presentation, scope filtering, cleanup,
  and report-only versus terminal-failure admission controls.
- These checks use synthetic in-memory Pi fixtures and server-rendered components;
  they do not claim native desktop/simulator acceptance, external publication,
  provider connectivity or physical-device coverage. Ticket 06 owns integration.

### 2026-10-16 — Integrated acceptance

Accepted by ticket 06; see [the verified outcome](../outcome.md). This historical
record is outside the executable backlog. Native guarantees and stated platform
limits remain as recorded there.
