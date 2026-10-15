# Native Pi prototype baseline

Recorded 2026-10-15 before ownership edits. Base: `git rev-parse HEAD` recorded
in validation. This worktree copied both complete saved investigation directories
from the original checkout; the original was read only.

## Actual owner and call paths

| Path | Current responsibilities | Prototype hypothesis |
| --- | --- | --- |
| `features/chat/api.ts` → `commands/chat_commands.rs` → `ChatService::admit_request` (`chat/admission.rs`) | Validate context, insert user/placeholder/run/context in one SQLite transaction; publish managed transcript after admission | Replace generic admission with Pi submit; keep context/access policy and project Pi state into the existing UI |
| `chat/runtime.rs` → `AgentRunCoordinator::execute` → `AgentRuntime::run` | App event protocol, model/tool loop, cancellation, partial checkpoints, terminal receipt | Pi owns selected-path execution; native bridge performs exactly one inference, never another loop |
| `chat/store.rs` | Chat tables, atomic terminal outcome, interrupted-request cancellation, run context | Use upstream SqliteStorage schema; no mirrored ChatService session rows |
| `chat/note_proposals.rs` | Origin deduplication, recovery versions, refinement, requested review, canonical commit receipt | Pi document/task owns pending decision/checkpoint; native domain adapter retains intent/receipt and exact target/payload checks |
| `features/proposals/reviewSession.svelte.ts`, `reviewExtension.ts`, `reviewCheckpoints.ts` | One editable document, hunk state, serialized acknowledged checkpoints, retain-on-departure, commit adoption | Reuse live document/editor and review workflow; redirect recovery writes to Pi, do not introduce another editable snapshot |
| `services/note_timeline` | Canonical publication, identity/revision issuance, preparation/recovery, projections | Retain completely; engine replay is not file-publication atomicity |
| `services/evidence`, `chat/citations.rs`, `structured_answer.rs` | Scoped reads, exact issued-source binding, current/revision freshness, final admission | Retain domain policy through extension callbacks; omit old grounded prose from inference/compaction |
| `chat/projection.rs`, `recovery.rs`, `relocation.rs` | Managed Markdown projection, transcript import, vault relocation and conflict proof | Projection only; omission would be an explicit adoption cost, never claimed generic deletion |

The experimental Pi ownership deliberately deviates from accepted ADR 0001.
ADRs 0009/0011, behavior invariants for request completion, interrupted output,
editable review, canonical publication and evidence remain acceptance constraints.
Production architecture documents are not being rewritten as adoption decisions.

## Bridge selection and first gate

Published Durable/AI/Chord 1.3.0, inspected local pinned package types. Durable
SqliteStorage accepts async `exec/run/get/all/transaction/close`. Implement one
native connection lease with transaction identity across IPC, serialize all
unrelated work, reject stale handles, rollback failures distinctly and roll back
abandoned leases. Use the upstream schema without a second generic session DB.
Transactions must not span model or human waits.

Use Pi AI's custom provider interface with native credential lookup and one
streamed HTTP inference. No Rust AgentRuntime invocation beneath Pi. Both Responses
and compatible request shaping must pass synthetic native protocol fixtures.
Bundled Durable extensions are separate from coding-agent extensions.

## Isolation and verification selection

Prototype selection: paired Rust feature `pi-prototype` and frontend build switch
`VITE_PI_PROTOTYPE=true`, distinct bundle identity, disposable vault/data roots.
One task-runner entry point will own fixture creation and build/run commands.
Never open a real vault or migrate old conversations.

First gate: actual desktop WKWebView/Tauri native SQLite open, atomic submission,
committed-state projection, close/reopen, rollback and competing transaction
checks; repeat on actual simulator WKWebView before broad proposal refactoring.
Then both native HTTP fixture protocols, cancellation and interrupted streams.
Review checkpoint/restart/Keep/Discard and crash-after-publication are later gates.

Relevant existing checks: frontend `pnpm check`, proposal orchestration/review
tests, IPC and architecture contracts; backend architecture fitness, proposal
receipt/recovery and evidence tests. Native setup follows `e2e/README.md`,
`e2e/support/buildNative.mjs` and mobile readiness network/Keychain records.
Existing remote-chat results belong to the baseline; they are not Pi acceptance.

Initial simulator inspection under the sandbox could not reach CoreSimulator.
An authorized host-level inspection is in progress; no mobile result claimed.
