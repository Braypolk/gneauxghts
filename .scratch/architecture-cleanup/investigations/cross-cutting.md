# Cross-cutting findings

Read-only source investigation, 2026-09-07, after note-timeline consolidation 56–58. These are adjacent to the four requested workflows. No execution/performance claims are inferred from source size.

## C1. One semantic pause decision is written into three places

Evidence: `src-tauri/src/semantic/activity.rs:3` stores `ActivityState.manually_paused`; `semantic/mod.rs:179` stores `RuntimeState.indexing_paused`; `semantic/indexer.rs:252` stores worker-local `paused`. `SemanticState.pause_indexing` at `semantic/mod.rs:851` changes the gate, changes runtime status/health, then sends `WorkerSignal::SetPaused`; the worker changes its own flag and writes the runtime flag again at `indexer.rs:256`. Resume repeats the protocol at `semantic/mod.rs:865`. Status reads the runtime copy at `semantic/mod.rs:1153`, while long jobs consult the gate at `indexer.rs:427` and `:491`.

This is confirmed duplicated authority over a single manual-pause decision: three mutable booleans and an asynchronously delivered control message, plus derived health presentation. It is distinct from retry exhaustion, queued work, and whether a job is currently running. No production incident was reproduced.

Recommended: retain `BackgroundWorkGate` as the sole manual-pause owner. Worker admission and inner-job checkpoints read it. `SemanticStatus.indexing_paused` and paused health are derived at snapshot time. Remove `RuntimeState.indexing_paused`, worker-local `paused`, and `WorkerSignal::SetPaused`/`SemanticWorkQueue.set_paused`. Keep the existing wake queue: consuming a wake must clear its coalescing flag even while paused, and resume must guarantee another wake for work accumulated during pause. Do not add another scheduler. Surface gate mutation failure before presenting changed status.

Validation: pause during an inner checkpoint, enqueue while paused, resume once and drain pending work, rapid pause/resume ordering, and retry-exhausted state surviving resume. Keep ANN rebuild freshness, manual pause and retry exhaustion as independently meaningful facts. Test via semantic queue/gate behavior; delete tests of eliminated mirror fields only after equivalent outcomes are covered.

Alternative rejected: one giant SemanticRuntimeState mutex for queues, ANN, health and pause. It increases contention and merges unrelated lifetimes.

## C2. Foreground activity has a dead semantic notification chain

`BackgroundWorkGate.report_activity`, `begin_foreground`, `end_foreground` are empty at `semantic/activity.rs:24–31`. `SemanticState` wraps them at `semantic/mod.rs:885–901`. `ForegroundGuard` stores an `Arc<SemanticState>` only to forward begin/end notifications (`index.rs:92–108`). A `report_user_activity` IPC is still registered (`lib.rs:332`, implementation `commands.rs:689`); the watcher also calls it (`vault_watcher.rs:430`). Repository search found no frontend caller of that command.

Delete the no-op methods, forwarding methods, unused IPC registration/function, watcher notification, and `ForegroundGuard.semantic` dependency. Preserve `ForegroundActivity.in_flight` and its guard: the catalog background queue actually uses them (`background_index_queue.rs:160`), as do prewarm/reconciliation. A no-op semantic branch does not make the actual foreground gate redundant.

This is a definite deletion, with zero product state removed. Existing foreground nesting/backoff tests in `index.rs` must continue passing. No new tests that simply assert deleted functions are absent are needed.

## C3. Catalog projection policy is represented twice

`ProjectionPlan` (`services/note_catalog.rs:40`) contains `lexical`, `tasks`, and `task_action`. All production constructors set lexical to Synchronous (`:46–76`); both production callers still branch on that constant (`:370`, `:395`). `plan.task_action` is only read by policy-shape tests (`:498–529`); the real task writer calculates `task_projection_action(note.document_kind)` again (`:425–445`). The actual projection coordinator already takes `ProjectionWork` and tracks latest generation plus outstanding lexical/task work (`:109–157`, `:178`).

Delete `ProjectionPlan` and `ProjectionTiming`; derive whether tasks participate directly from the two-value `CatalogWriteMode`. Keep `TaskProjectionAction` where actual note-kind policy is applied, and retain `ProjectionWork` only for real timing/error-surfacing distinctions. `NoteCatalog.upsert/remove` should call the existing projection coordinator directly with that concrete policy.

Retain per-path generation ordering, pending retry evidence, synchronous task read-your-write guarantees and chat task exclusion. Do not combine semantic jobs with lexical/task jobs just because both use queues. Remove the two tests that merely construct the eliminated plan after actual catalog/projection outcome tests cover ordinary notes, managed chat, removal, retry, and stale work.

## C4. Publication warnings cross duplicate internal representations

`services/note_timeline/post_publication.rs:16` defined `PublicationStage`; the corresponding `MutationWarningStage` (plus TaskViewRefresh), `NoteTimelineIssue`, and `NoteMutationWarning` are now organized in `services/note_timeline/domain.rs:152`, `:182`, and `:207`. The duplicate conversions described here were removed by Ticket 02.

Use the existing timeline-owned stage/issue/warning representation inside its private post-publication module. Remove the internal duplicate enum/issue/warning and identity conversions. Keep one public serializer that redacts diagnostic causes and one required-consistency classifier; semantic-only degradation must remain diagnostic while required history/catalog/task degradation remains a commitWarning. Retain all diagnostics versus required-warning subset as distinct *views*; do not collapse their semantics or expose backend error text. `PublicationOutcome` can remain private if it still earns its different source-neutral construction role.

The private `PublicationSink` has a real production and test implementation. Its methods enable failure-order tests; it is not flagged merely because production has one adapter. Keep it unless full boundary tests make it unnecessary in the same change.

## C5. Some architecture tests prescribe internal implementation

`src/lib/architectureFitness.test.ts:154–172` asserts the exact complete field list of NoteDraftState. `src-tauri/tests/architecture_fitness.rs:799–851` asserts concrete internal projection names, booleans, whitespace-sensitive call text and prepared-intent fields. These go beyond a public-owner restriction and make legitimate redesign require test maintenance.

Update these assertions alongside the owner changes they currently constrain. Retain import/write-route prohibitions, capability privacy and stable IPC fixtures. For each removed internal shape assertion, identify the actual invariant and keep or add a focused outcome test. Do not create a new source parser framework solely to preserve those checks. Pure reducer transition tests that protect event semantics remain useful; unit tests are not automatically disposable because they inspect state.

## Candidates intentionally not promoted into implementation work

- `paneNavigationTransitionPipeline.ts:51` exposes a callback-heavy nine-phase protocol. It has genuine shared departure serialization and stale-operation checks (`:95`, `:141`), and `noteCommandController.ts:576` consumes operation identity. Migrating the document owner/adoption may make some callbacks unnecessary. Inventory the surviving call sites after those changes; do not replace it preemptively with another generic navigation engine.
- `BackgroundIndexQueue` duplicates path/generation payloads held by `CatalogProjectionRetries` and maintains queue positions on dequeue (`background_index_queue.rs:51`, `:170`). Queue position and retry state have different lifetimes; there is no demonstrated correctness defect. A simpler path-keyed queue is an optional later measurement-backed change, not required for this plan.
- `SessionSnapshot` repeats working/saved fields at the transport adapter. A successful IPC snapshot has equal working and saved content, but external synchronization and unsaved sessions have meaningful baseline differences. Narrowing this DTO belongs with committed-result adoption; never remove the document's saved baseline.
