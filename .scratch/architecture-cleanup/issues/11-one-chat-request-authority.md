# 11 — Use one interactive request authority and correlated receipt adoption

Status: needs-triage
Depends on: None structurally; reconcile with 05 if it is implemented; fresh triage required
Scope: deferred; excluded from Round 1. Do not implement without a new scope decision after the Round 1 audit.

Read [the spec](../spec.md) and its execution/measurement rules first. Source lines refer to the 2026-09-07 working tree; use named symbols after preceding tickets move them.

## Problem and evidence

Frontend activity is mutable in controller `machine.request`, `conversation.activeRequestId`, and `TauriChatApi.#activeRequests` (`src/lib/features/chat/api.ts:319`). Late send receipts mutate activity/message placeholders after terminal events can already have completed the request (`controller.svelte.ts:1081`, `:1109`; API receipt `:470` versus terminal `:609`). This source-confirmed ordering hazard needs a deterministic behavior reproduction.

## Chosen boundary and implementation

1. The existing controller request machine is the sole interactive request authority for its admitted conversation. Derive `activeRequestId` in view snapshots instead of storing another mutable field.
2. API transports events and authoritative backend receipts/conversation data; delete API-local inferred active-request map and normalization policy.
3. Enrich ChatService's existing request→cancellation-token registry (`chat.rs:519`) with conversation/message/run correlation metadata; those fields are not currently present and request ID is not a durable run column. Expose a read-only live snapshot on conversation load. Preserve task-completion tracking introduced by ticket 05 even after interactive activity ends. Do not add a second frontend global request registry or durable request schema just for this view.
4. Choose at most one admitted interactive run per conversation. Atomically reserve admission in the existing live owner before persisting a new user/message/run attempt; a second pane's concurrent send receives a correlated already-active outcome without another durable attempt. The second pane may display the existing run, but its attempted send is unaccepted: preserve its unsent text, attachments and selected context. `ChatComposer.submit` currently clears those when `controller.send` returns true (`ChatComposer.svelte:333`), so keep that result distinction explicit. Release failed reservations. Retire snapshot-visible interactive activity before terminal event delivery, while retaining task handles until all completion/title work has settled. Merely removing a registry entry after emitting terminal is too late for a pane that opens between the two.
5. Define snapshot/event reconciliation explicitly: attach listeners before load; correlate load/send/retry operations; ignore snapshots/receipts superseded by terminal events for the same request, and ignore stale events for a newer request. Retain bounded terminal/correlation evidence for outstanding loads, not an unbounded history map. A late receipt must not replace a completed message with a pending placeholder.
6. Route send/retry/open/terminal/permission handling through accepted transitions. Gate permission decisions on the exact admitted request/message/run/permission identities.
7. Delete mutable activity writes, map mutations and synthetic `#normalizeConversation` lookup once reopen behavior uses the backend snapshot.

## Acceptance and validation

- Test terminal-before-receipt, event-before-receipt, terminal-during-conversation-load, load begun after terminal emission but before worker cleanup, two-pane concurrent send, stale terminal after a new send, retry receipt, reopening from a second pane, and disposal with pending permission.
- Evolve `controller.test.ts:328`, `:364`, `:618`, `:691` and API/IPC fixtures. Make schedules deterministic with controlled promises. Assert the rejected concurrent-send composer retains its text, attachments and selected context while the existing run remains visible.
- Keep durable run status, terminal message history, backend cancellation token and transient permission grant as distinct facts. A run may finish before a proposal is reviewed.
- Interactive activity storage drops from three representations to one; backend snapshot is a read view, not a new owner. Report exact removed fields/transitions and added correlation evidence; fix races without introducing a second parallel state machine.

## Comments

- Planning baseline: 2026-09-07. Append implementation evidence and resolution here; preserve the measured before/after and review follow-ups.

- Scope revision: deferred by the user's narrowed first-round decision. Retained as investigation/design evidence; ready-for-agent status and the original execution order no longer apply.
