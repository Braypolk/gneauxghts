# Structured chat streaming on Rig 0.44

Final follow-up: the three evidence fixture failures below are
[resolved](issues/10-existing-evidence-regression-failures.md). The full backend
suite now passes **861 tests, 0 failures, 27 ignored** with loopback binding
permitted for its local HTTP fixture. Earlier run counts remain checkpoint records.

Implemented 2026-10-11. This promotes the readable answer shape; the compact
format remains experimental following the [0.41 comparison](structured-answer-streaming/completion/README.md).

Chat on tool-capable providers now uses `segments: [{ text, sources }]` through
Rig's non-executable result formatter. Each actual completion dispatch resets a
run-local stream adapter. Only that formatter's argument fragments enter the
chat draft decoder; executable arguments and formatter commentary do not.
Drafts are literal decoded text, never Markdown, citations, raw JSON, checkpoints
or durable event history. Final validation checks the closed shape and exact
issued, delivered, currently allowed source IDs. The app constructs Markdown
links, saves the terminal answer and its selected sources atomically, then emits
sources and completion. Local models without tool support retain plain streaming.

Cancellation, schema/source rejection, interrupted runs and failed terminal
storage leave no provisional answer text or sources in the durable message.
Retry replaces drafts by dispatch attempt; the frontend also checks request and
message identity and sequence, including events preceding the send/retry receipt.

An observed Rig 0.44 distinction matters: malformed JSON receives the engine's
bounded output retry; syntactically valid JSON may violate the supplied schema.
The app's independent validator rejects those violations without spending an
extra automatic call. The user can retry the resulting failed message.

## Validation

- 15 focused Rust tests pass, including real Rig stream → app draft delivery →
  SQLite terminal/reload, malformed-result retry replacement, mid-stream
  cancellation, failed terminal storage, schema violation, and real registered
  note reads followed by canonical mutation or exclusion before finalization.
  Executable read arguments never enter the captured formatter stream.
- 181 chat frontend tests pass, covering literal/escaped drafts, no draft links,
  source-backed final Markdown, lists/tables/quotations, dispatch/sequence rejection,
  wrong run/chat identity, late terminal events, and drafts before send/retry receipts.
  Final citation numbering follows selected-source display order.
- The full frontend run passes 1,191 tests plus 33 support checks; the final
  source-backed Markdown test was then added and passed in the focused chat run.
- Svelte/TypeScript check: zero errors/warnings. Architecture fitness: 21 pass. Python support: 16 pass.
- Full Rust run: 853 pass, 27 ignored, the same three independently reproduced
  [existing evidence regressions](issues/10-existing-evidence-regression-failures.md)
  fail. Three final focused tests were added afterward; all 15 focused checks pass.

Logs are local ignored artifacts under `artifacts/structured-streaming-2026-10-11/`.
Tests use a synthetic provider stream with the production runner, tools, stores
and frontend components. This pass made no paid model calls and did not launch
the desktop app. A live provider/native UI quality comparison remains separate.
Source identity validation does not prove semantic citation entailment; issue 07
remains open. Existing navigation still revalidates a source changed after save.

## Owners

- Runtime formatter isolation: `src-tauri/src/agent_runtime/result_stream.rs`.
- Draft/checkpoint ownership: `src-tauri/src/chat/answer_stream.rs`.
- Prefix decoding and final validation/rendering: `src-tauri/src/chat/structured_answer.rs`.
- Chat orchestration: `src-tauri/src/chat/runtime.rs`.
- UI identity/ordering: `src/lib/features/chat/machines/controllerMachine.ts`.
- Literal rendering: `src/lib/features/chat/ui/ChatMessage.svelte`.

Authoritative rules are in `ARCHITECTURE.md` and
`docs/architecture/behavior-invariants.md`.

## Audit fixes, 2026-10-11

The audit found two integration regressions, both reproduced before correction:

- Forced OpenAI web search kept a raw `tool_choice=web_search` on every
  completion. It overrode the result formatter, including explicit final-result
  selection after Rig's Responses serialization. The app-owned dispatch hook
  now retains the mandatory search selection only for the initial completion;
  subsequent requests and output retries can gather or finish normally. Flex,
  reasoning settings and optional web-tool availability remain intact.
- Structured editing acknowledgements selected no passage citations, losing the
  working note's identity when earlier answer prose was omitted. Successful
  finalization now retains working-note IDs as internal navigation metadata in
  `chat_messages.note_reference_ids_json`, separate from citation sources. They
  commit atomically with the answer and run receipt, copy into branches, and
  resolve through the existing fresh permission/identity checks and history
  bounds. They contain no working-copy text and do not grant read or citation
  authority.

Regression coverage exercises the production dispatch and finalizer/store paths:
captured completion requests replayed through the actual Responses serializer;
real edit reads followed by structured acknowledgement, editor switch, SQLite
reload, branch, compaction and exclusion; terminal failure rollback and retry;
and the public message contract's omission of internal navigation IDs.
No paid provider calls or native UI runs were used for these fixes.

Validation after the audit fixes:

- Both new regressions failed before correction and pass afterward, including
  reload, branch, compaction and exclusion assertions. The expanded terminal
  rollback/retry check passes as well.
- Full Rust library run: 857 passed, 27 ignored, four failures. Three are the
  previously recorded evidence regressions in issue 10. The remaining capacity
  probe test failed because the sandbox denied its loopback listener; rerunning
  that exact test outside the sandbox passes (1/1). No new code failure remains
  in this pass.
- Chat frontend and IPC contracts: 185 passed. Backend architecture fitness:
  21 passed. Svelte/TypeScript and e2e type checks pass with no warnings.
- `git diff --check` is clean. Logs for this pass are
  `/tmp/gneaux-audit-fixes-{rust,frontend,architecture,check}.log` and
  `/tmp/gneaux-audit-fixes-capacity-probe-unsandboxed.log`.
