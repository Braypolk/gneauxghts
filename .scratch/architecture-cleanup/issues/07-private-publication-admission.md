# 07 — Give all ordinary-note writers the same private admission path

Status: needs-triage
Depends on: None; fresh triage required
Scope: deferred; excluded from Round 1. Do not implement without a new scope decision after the Round 1 audit.

Read [the spec](../spec.md) and its execution/measurement rules first. Source lines refer to the 2026-09-07 working tree; use named symbols after preceding tickets move them.

## Problem and evidence

Save already verifies outside file ownership, drops its preflight lease, then rechecks under ownership (`src-tauri/src/services/note_timeline/publication.rs`, `NoteTimeline::save_note`). Restore acquires the file owner before `HistoryModeAccess::prepare_access` (`src-tauri/src/services/note_timeline/history_mode.rs`), which may await readiness. Proposal does likewise (`commands/proposal_commands.rs:103`); closed-note tasks enter file ownership before sink preparation (`services/task_mutation.rs:192`, `:118`). A cold/replaced target can hold the global file owner while waiting. This is a source-confirmed ordering hazard, not a measured latency incident.

## Implementation instructions

1. Extract the proven save admission algorithm privately inside NoteTimeline: recover/verify target outside owner; release preflight lease; acquire file owner and fresh lease; enter replay exclusion; re-resolve identity/proof/scope/pending evidence; release and retry outside ownership if admission changed.
2. Keep closed typed save/restore/proposal/task operations. No public preflight lease, caller-owned prepare/finalize pair, callback transform protocol, generic writer trait, or new actor. A small private target enum may share admission, but source-specific rules stay in concrete operations.
3. Migrate Version Restore while preserving its role-limited capability and `(revisionId, expectedCurrentAuthoredHash)` contract. Under ownership, recheck authored hash; durably prepare selected restore origin and exact reconstructed bytes before publication; return the prepared result Revision Identity.
4. Add complete typed timeline proposal publication: Update carries NoteIdentity/path/expected base hash/Markdown; Create carries path/title/Markdown. Return Conflict or existing `NoteMutationResult`. Timeline owns hash/collision check, exact intent, publication, abandonment/finalization and warnings. Ticket 08 moves remaining proposal-domain lifecycle out of commands.
5. Give closed-note tasks one concrete timeline publication accepting narrowed task target evidence and `TaskMutationKind`. Keep record lookup and the pure matching/ambiguity policy in task domain; evaluate that policy against freshly read canonical bytes and run existing pure `transform_task_document` under timeline ownership. Never transform using a position accepted before ownership. Dirty-open-note preparation stays unchanged.
6. Delete `TaskMutationSink`, `AppStateTaskMutationSink`, `TaskSynchronization` and split `commit_loaded_task` after migration. Narrow low-level publication helpers to private visibility once callers are gone. Preserve the existing complete save boundary.

## Acceptance and validation

- A blocked proof for target A does not prevent a ready target B save. Exercise restore, proposal, and task entry points through deterministic barriers; changing scope/proof between preflight and lock retries safely.
- No deadlock with clean close, store replacement, observation replay, or released pending intent. Cold work cannot wait on verification while retaining the file owner.
- Hash conflict/task ambiguity publishes no bytes. Preserve exact frontmatter/line endings, task source, restore origin, create collisions, copy identity repair, and committed-warning semantics.
- Keep separate durable prepare-before-write proof and post-publication recovery tests; do not replace them with tests merely expecting helper call order.
- Delete duplicated admission/protocol code; retain distinct operation policy. Report interface and coordination reductions even if private implementation needs comparable lines.

## Comments

- Planning baseline: 2026-09-07. Append implementation evidence and resolution here; preserve the measured before/after and review follow-ups.

- Scope revision: deferred by the user's narrowed first-round decision. Retained as investigation/design evidence; ready-for-agent status and the original execution order no longer apply.
