# 02 — Collapse duplicate projection and warning representations

Status: resolved
Depends on: 01
Scope: active Round 1, execution position 2 of 6.
Round 1 order: 01 → 02 → 14 → 03 → 09 → 10; stop and audit after 10.

Read [the spec](../spec.md) and its execution/measurement rules first. Source lines refer to the 2026-09-07 working tree; use named symbols after preceding tickets move them.

## Problem and evidence

`ProjectionPlan`/`ProjectionTiming` in `src-tauri/src/services/note_catalog.rs:40` describe lexical work that is always `Sync`. `plan.task_action` is inspected by shape tests but actual task synchronization derives `TaskProjectionAction` again at `:425`. `ProjectionWork` at `:109` represents real execution outcomes and must remain.

Private `PublicationStage`, `PublicationIssue`, and `CommittedMutationWarning` in `src-tauri/src/services/note_timeline/post_publication.rs:16` duplicated the timeline's stage/issue/warning values (now organized in `services/note_timeline/domain.rs`: `MutationWarningStage`, `NoteTimelineIssue`, and `NoteMutationWarning`). Conversion matches added maintenance without hiding a dependency. See cross-cutting C3–C5.

## Implementation instructions

1. Delete `ProjectionPlan` and `ProjectionTiming`. Execute mandatory lexical work directly; derive task action from the existing `CatalogWriteMode` at its actual execution point.
2. Keep `ProjectionWork`, actual task action policy, generation ordering, deferred retries, and different task/lexical/semantic completion requirements. Do not combine unrelated background queues.
3. Let the private post-publication implementation use the existing timeline stage, issue, and committed warning types. Delete parallel internal enums/structs and one-to-one mapping matches.
4. Preserve the distinction between all diagnostics and the required-consistency warning subset. Keep one classification rule and the IPC redacting serializer; semantic-only failure must not be upgraded into canonical write failure.
5. Rewrite architecture assertions that demand the removed struct layout or literal policy fields (`src-tauri/tests/architecture_fitness.rs:799`) to protect routing/privacy and user-visible projection outcomes.

## Acceptance and validation

- No replacement policy builder or warning DTO layer is introduced.
- Catalog/task state remains synchronous where required, chat exclusions hold, and late projection generations cannot overwrite newer work.
- Existing projection outcome tests (`note_catalog.rs:533` onward), post-publication failure tests, and serialization fixtures retain stage meanings/redaction.
- A committed write with required projection failure still returns a committed warning and is never retried as an unpublished save.
- Remove field-construction tests rendered obsolete; retain the private production/test `PublicationSink` seam used for meaningful failure-order checks.
- Report deleted types/matches and net production/test deltas. This ticket should produce net production deletion.

## Comments

- Planning baseline: 2026-09-07. Append implementation evidence and resolution here; preserve the measured before/after and review follow-ups.

- Scope revision: active in narrowed Round 1. Earlier full-plan numeric execution order is superseded by 01 → 02 → 14 → 03 → 09 → 10.

- 2026-09-07 implementation resolution: deleted `ProjectionTiming` and `ProjectionPlan`, including `for_upsert`/`for_remove` and the three stored policy fields (`lexical`, `tasks`, and `task_action`). `NoteCatalog::upsert` and `remove` now always execute their mandatory lexical work through the existing projection coordinator and derive task participation from `CatalogWriteMode` at that call. `apply_task_projection` still derives the real `TaskProjectionAction` from the resolved document kind. `ProjectionWork`, per-path generation ordering, retry evidence, synchronous task errors, deferred lexical work, and the separate semantic queue are unchanged.
- Warning resolution: deleted private `PublicationStage`, `PublicationIssue`, and `CommittedMutationWarning`. The private post-publication implementation now records `MutationWarningStage`/`NoteTimelineIssue` and returns `NoteMutationWarning` directly. Removed both one-to-one `From` conversions and the warning remap in `NoteMutationResult::from_publication`. The single required-consistency classifier now lives on `MutationWarningStage`; all diagnostics remain on `NoteMutationResult`, only the required subset enters `commitWarning`, and the existing `NoteTimelineIssue`/`NoteMutationWarning` serializers still redact diagnostic paths and causes. `PublicationOutcome` and the production/test `PublicationSink` seam remain because they retain meaningful post-commit outcome construction and failure-order testing.
- Behavioral test replacement: removed the two field-construction policy tests and added an outcome test that proves managed chat upsert/removal changes lexical search while leaving an existing ordinary task projection untouched. Existing projection tests continue to prove identity resolution and late-generation suppression. Architecture fitness now forbids the removed projection/warning representations and protects coordinator routing, deferred lexical routing, task execution, semantic-vs-required stage routing, and post-publication privacy rather than `ProjectionWork` field shape.
- Line accounting from the exact Ticket 02 baseline: production +64/-179, net -115; tests +90/-72, net +18, including embedded Rust tests; tooling +0/-0, net 0. This Comments update is planning evidence and is excluded. Deleted representation state is five types, three `ProjectionPlan` fields, two plan builders, two one-to-one `From` conversions, and the final warning conversion pass. No owner family, durable state dimension, public callback, queue, retry ledger, or top-level save coordination step changed; the representative save ledger remains 7 owners / 26 dimensions / 16 steps (15 for same-path save).
- Baseline method: the orchestrator supplied `/private/tmp/gneaux-round1-ticket02-baseline.tar`; before editing, the agent also copied the five anticipated touched files to `/private/tmp/gneaux-ticket02-agent-preedit-20260907`. The four code/test files matched the supplied archive byte-for-byte before edits. Counts and the final caller audit compare against that independent pre-edit copy with `git diff --no-index`, never HEAD. An attempted targeted Rust format exposed broad pre-existing formatting drift in the shared timeline file; all incidental formatter changes were reverted through `apply_patch` before the implementation was reapplied, preserving unrelated/newer timeline work.
- Validation: `cargo check --manifest-path src-tauri/Cargo.toml` passed. Focused catalog projection tests passed 3/3; post-publication ordering/classification tests 5/5; warning redaction and required-warning/all-diagnostics tests 2/2; committed catalog projection warning and history-finalization recovery tests 2/2. Rust architecture fitness passed 17/17. `pnpm test:timeline:contracts` passed 4/4 TypeScript fixture tests plus the Rust serialized-state fixture. Final production search found none of the five deleted Rust types; the same `CommittedMutationWarning` name intentionally remains only as the stable frontend IPC contract. No implementation concern remains; repository-wide formatting drift is pre-existing and was not rewritten in this ticket.
- Orchestrator audit: no Standards or Spec findings. Baseline-relative review independently verified direct mandatory lexical projection, task gating solely from `CatalogWriteMode` when constructing actual work, task action derivation from document kind, preserved per-path generation and retry coordination, one required-consistency classifier, unchanged redacting serializers, the all-diagnostics versus required-warning split, and absence of the deleted Rust representations outside architecture-fitness prohibitions. No Ticket 02 follow-up is required.
