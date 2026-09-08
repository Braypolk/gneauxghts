# 08 — Put complete proposal commit in the proposal domain

Status: needs-triage
Depends on: 07; fresh triage required
Scope: deferred; excluded from Round 1. Do not implement without a new scope decision after the Round 1 audit.

Read [the spec](../spec.md) and its execution/measurement rules first. Source lines refer to the 2026-09-07 working tree; use named symbols after preceding tickets move them.

## Problem and evidence

`commit_agent_proposal_with_state` (`src-tauri/src/commands/proposal_commands.rs:30`–`:257`) coordinates policy, proposal intent, publication, projection warning and durable status convergence. Ticket 07 removes its low-level publication duties, but command callers should still not assemble proposal lifecycle.

## Implementation instructions

1. Move the complete application operation into the existing proposal domain: `commit(proposal_id, optional_markdown, &ChatService, &NoteTimeline)`. The Tauri command dispatches and maps existing IPC errors/results.
2. Retain `ProposalPreview`, `CreationProposalPreview`, and `AgentProposalCommitPlan` (`src-tauri/src/proposals.rs:66`, `:78`, `:96`), durable `AgentProposalCommitIntent` (`chat.rs:475`), and IPC `CommitNoteReviewResult` (`proposals.rs:87`) where they represent distinct evidence.
3. Proposal domain revalidates current exclusions/access policy and pending status, records intended editor hash before calling complete timeline publication, and converges durable proposal status from the authoritative result/actual-byte recovery.
4. Use ticket 07's closed Update/Create publication operation and existing `NoteMutationResult`; do not expose a prepared token or transform callback to this domain.
5. Delete `ProposalSynchronization`, `synchronize_applied_change`, command-owned `converge_agent_proposal_status`, and the remaining command saga. Keep pure preview/diff code and durable recovery evidence.

## Acceptance and validation

- Revoking access before Keep blocks commit. Base mismatch and create collision have the existing outcomes.
- If canonical bytes committed but status persistence fails, recover status from intended hash/actual bytes; never replay canonical publication because the UI received a warning or status error.
- Retain proposal-before-write and exact history intent ordering. Proposal commit evidence and history receipts recover different facts and must not be merged.
- Evolve behavior tests at `chat.rs:6245`, `:6396`, `:6476`, proposal warning test `proposal_commands.rs:265`, and frontend committed-warning adoption tests.
- Command becomes dispatch/result translation. Merely relocating its body is insufficient: no caller sequences publication phases or status repair. Report removed protocol types and line delta; do not add a new coordinator class.

## Comments

- Planning baseline: 2026-09-07. Append implementation evidence and resolution here; preserve the measured before/after and review follow-ups.

- Scope revision: deferred by the user's narrowed first-round decision. Retained as investigation/design evidence; ready-for-agent status and the original execution order no longer apply.
