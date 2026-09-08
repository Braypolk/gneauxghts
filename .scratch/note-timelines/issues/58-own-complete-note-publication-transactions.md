# Own complete note publication transactions

Status: ready-for-agent

Depends on: 57

## Outcome

Implement [the consolidation plan](../architecture-consolidation-plan.md) by removing caller-assembled publication protocols. Ordinary editor/task saves should invoke one concrete operation owned by NoteTimeline and existing canonical persistence, which performs preparation, file publication, abandonment/finalization and returns authoritative results. Remove the generic persist_note_with_preparation callback protocol if its only production caller can be replaced by that concrete owner. Preserve no-op draft, title/path, identity, source, pending-window and committed-warning behavior.

Forgotten-note callers should request complete forget/recover/purge operations without assembling metadata staging, rollback and publication callbacks. Deepen the existing owner rather than add a lifecycle framework. Keep ChatService ownership of chat content. Consolidate shared note-move protocol and delete obsolete flags, duplicate validation and test-only generic entry points when complete operation tests replace them. Moving lines between files without reducing caller obligations or duplicate machinery is insufficient.

## Acceptance

Preserve exact selected lifecycle-instance checks (including restore/reforget path reuse), current source-byte validation, destination collision handling, targeted conditional metadata updates, indeterminate recovery metadata, committed-warning semantics and mandatory history preparation. Verification stays outside file ownership where it may wait on another check. No SQLite lock spans file/history work. Existing behavioral save/lifecycle/concurrency/recovery tests survive the owner change or are replaced with equally strong boundary tests; no deletion to force green. Run full backend/frontend plus contracts/architecture checks once the series is stable. Report net production/test/tooling counts and final ownership review. Historical reports and issue55 work remain intact; native/scale work stays paused until this series is accepted.

## Design findings

- `persist_note_with_preparation` has one production caller. A concrete `NoteTimeline` save can return `Option<NoteMutationResult>`; command code maps it through the existing authoritative session conversion. Avoid a new DTO or public plan/publish protocol. Keep source distinction and stable candidate identity through any admission retry.
- The empty-new-draft branch in `persist_note_locked` necessarily gets `None` from `resolve_target_path`; its later rename/write code is unreachable. Preserve the no-op directly.
- A caller currently can hold the global file owner while `prepare_history_capture` joins target verification. Add a boundary regression: pause verification of A, start saving A, then save already-ready B; B must finish before A is released. Preflight target verification outside the owner and revalidate inside it; if identity/proof changed, release the owner before retrying. Keep this inside the complete operation.
- Preserve close lock order during that split: close owns the file mutex before draining operation leases. A preflight read lease must be dropped before waiting for the file owner, with a new operation lease acquired inside file ownership, as existing baseline initialization does. Holding the preflight lease while waiting for that mutex introduces a close deadlock. The recheck must reject closing/replaced state before publication.
- Forgotten lifecycle publication has two production command callers; its private under-boundary helper also serves Missing Note recovery. Keep that create-only behavior. Private callbacks for genuinely different filesystem publication are acceptable; the command should not assemble the consistency protocol.
- Purge should derive its target from the selected persisted record instead of accepting both that record and a redundant `NoteLifecycleOperation`. Exact record comparison is required; adding a new durable selection token/schema to hide the existing record is unnecessary.
- Recovery's local vector index/removal loop does not write aggregate state; iterate selected snapshots and let the complete operation update its conditional row. Remove duplicate chat-row cleanup. Indeterminate metadata retention is real behavior, not a dead flag: consume that outcome inside its owner.
- `PreparedRevisionPublication` remains used by separate task/proposal transaction paths; do not delete those unrelated guarantees or expand this into a complete proposal/task-service rewrite.

## Resolution

Implemented the complete ordinary save and forgotten-note lifecycle boundary.
`NoteTimeline.save_note` owns readiness admission, canonical identity and metadata
enrichment, durable preparation, publication, abandonment/recovery release, and
finalization. The command maps the authoritative mutation directly to an optional
session. Removed `persist_note_with_preparation`, its three callbacks and optional
prepared context, the duplicated source/result assembly, `PersistNoteOutcome`,
and the low-level empty-draft/optional-target protocol. Prepared publications
remain available for the distinct proposal and task transaction owners.

Save verification runs outside file ownership. The preflight lease is dropped
before waiting for the file owner; the new lease, nonblocking runtime proof check,
and bounded pending-work query guard publication under the existing replay owner.
Changed admission retries outside. Each enrichment uses the original authored
input and rereads current disk metadata; only a fallback Note Identity survives
retries. A known failed rename/write restores the original path and keeps the edit
unsaved. If rollback fails, the operation returns an error and releases its retained
intent through existing capture recovery, permitting retry without a restart.

Complete forget/recover/purge operations hide selected-row staging, conditional
rollback, source-byte and collision checks, expected moves, finalization and
bookkeeping warnings. The generic lifecycle entry point is deleted; its private
under-boundary helper still serves create-only Missing Note recovery. All trailing
metadata work remains inside the file owner and operation lease. ChatService
continues to own chat content. Local vector-removal bookkeeping and duplicate chat
row cleanup are removed. Forgotten metadata uses the selected app-state database,
so lifecycle operations also check selected-vault binding after admission.

Seven generic lifecycle test invocations now cross complete operations. Focused
regressions cover a waiting save versus a ready note, late observed content,
close between preflight and ownership, current disk properties, and failed/indeterminate
rename saves. Focused validation and final series counts are recorded by the root
acceptance audit against `after57.tgz`; native and scale work remain paused.

## Comments

Root acceptance, 2026-09-07: complete. Independent Standards/design and Spec/correctness reviews are clear after correction of stale preflight properties, failed-rename recovery release, scoped corruption handling and trailing lifecycle bookkeeping ownership. Full final checks: 578 Rust library tests and 17 architecture tests passed (9 opt-in tests ignored); 835 frontend tests passed; production Rust and Svelte checks clean. Issue 58 net: production Rust +6, tests -22, all Rust -16, tooling unchanged. See [the final consolidation audit](../architecture-consolidation-review.md) for scope, evidence and the series total. Native/scale acceptance remains issue 55.
