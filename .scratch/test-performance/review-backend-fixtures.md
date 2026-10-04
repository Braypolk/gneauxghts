# Backend fixture performance review

Status: complete
Progress: Independent read-only Standards/correctness and Spec review completed with the code-review skill. No tests, builds, measurements, or source edits performed by reviewer.

## Scope

Reviewed only the added five lines in each of:

- `src-tauri/src/services/note_timeline/tests/publication.rs`: `adaptive_checkpoints_are_transparent_across_a_long_revision_chain`.
- `src-tauri/src/services/note_timeline/editing_window_capture/tests/query_inventory.rs`: `query_inventory_nine_dense_notes_do_not_spend_model_evidence`.

Compared latest `source-changes.patch` with the performance phase's saved baseline (`baseline.json`), using `spec.md` and `backend-fixture-followup.md` as acceptance sources. Read actual foreground admission, background queue, synchronous post-publication coordination, generation-ordered projection coordinator, fixture construction/destruction, and both full test bodies. Earlier changes are outside scope.

## Recommendation

**Retain on correctness grounds. No actionable Standards, correctness, or Spec defect found.** Performance acceptance remains the coordinator's measured decision; this review does not claim a speedup.

The changes do not bypass canonical persistence, retained history, required catalog/task projection, or any scheduling contract these two tests assert:

1. Every existing seed call and finalization remains unchanged: 140 long-chain revisions and nine notes with twelve additional publications each. The guard only increments `ForegroundActivity.in_flight` (`index.rs:96–109`); it does not change the timeline writer, prepare/finalize path, mutation result, or storage. The unchanged synchronous post-publication path updates `notes_index`, then invokes `ProjectionWork::timeline_tasks()` before enqueueing lexical work (`post_publication.rs:96–136`). Canonical bytes/history/task work still occur on every iteration.
2. The queue implements real, existing same-path coalescing. While foreground activity is held, `run_worker` leaves pending jobs in the queue (`background_index_queue.rs:230–250`), allowing `push` to replace an older pending generation for that path. It does not cancel an already-executing projection. The shared generation-ordered projection coordinator prevents older work from regressing newer state. No direct database seeding, alternate save implementation, disabled worker, or mock replaces production behavior.
3. Both guards are explicitly dropped **before** `wait_until_idle_for_test`, and that wait occurs before either the restarted AppState or inventory query. The helper uses the worker's condition-variable idle notification with its existing five-second failure bound. `enqueue` clears the idle flag; the single worker marks idle only on the next empty-queue pass after applying its previous job. Thus it cannot report an already-running seed projection as complete merely because the pending deque is empty. No later seed is submitted after the wait.
4. Neither target test asserts intermediate lexical visibility, wake latency, fairness, or interleaving. Long-chain assertions concern retained history reconstruction after restart; dense-inventory assertions concern complete bounded inventory and independence from the exhausted model-evidence budget. Those assertions and data remain identical. The separate existing `background_queue_yields_to_foreground_then_drains` test still asserts lexical absence during admission and presence after release/drain, and foreground RAII/nesting coverage remains unchanged.
5. The added admission is scoped to each existing fixture and releases on unwinding. Inventory fixture destruction still stops/joins rebuildable projection work before resetting its notes-root override. The long-chain case now drains before creating its restart state, which avoids leaving seed projection work concurrent with the restart observation. Neither change affects test isolation or global fixture-lock ownership.

## Limits and cautions

- Queue idleness proves queued projection attempts finished; it is **not** a new assertion that every projection succeeded. The worker logs projection failures and the retry coordinator retains failed work. The report should not equate this helper with a successful lexical-index integrity assertion. These tests did not previously own that contract, so this is not a regression introduced by the patch.
- The long-chain test still exercises adaptive checkpoint reconstruction with its original body sequence and 140 revisions. It does not prove that the count-based checkpoint threshold, rather than another adaptive criterion, caused a particular checkpoint. The plan already acknowledges that pre-existing oracle limit; the new fixture scheduling does not justify a stronger coverage claim.
- Holding foreground activity intentionally changes intermediate background scheduling during seed construction. That is appropriate for these final-result fixtures, but would be inappropriate to copy into tests whose subject is per-publication lexical visibility or background scheduling itself.
- Full-suite and repeated timing evidence belong to the coordinator. No recommendation is based on unverified speed or an assumption that fewer worker jobs necessarily reduce total wall time.
