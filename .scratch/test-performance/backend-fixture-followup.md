# Four dominant Rust fixtures: bounded follow-up

Status: ready-for-agent
Progress: Coordinator approved the two-fixture experiment; test-only source edits complete and frozen, awaiting coordinator measurements.
Owner: audit_timeline

## Measured starting point

Coordinator serial profile (`rust-serial-baseline.json`): 112.61s, 725 passes and15 existing ignored. Approximate observed test intervals: inventory-budget pagination14.70s, adaptive checkpoints11.03s, nine dense notes7.20s, revision-context paging6.86s. Together these are about35% of the serial run. The setup-only foreground-guard case is cheap, superseding general fixture construction as the leading optimization target. These measurements were supplied by the coordinator; this investigator ran no tests.

The subsequent coordinator fresh-process focused baseline for the two proposed cases is **7.37s total** (nine dense4.91s, long chain2.46s), substantially below their18.23s sum in the full serial profile. Treat the latter as suite-context attribution, not isolated operation latency. Warmup, process history, resource contention or accumulated background work remain competing explanations; a leak is not established. Compare identical focused invocation order for this experiment and retain full-suite acceptance to test whether benefits survive process history.

## Proposed experiment: defer repeated lexical seed projections through the real foreground owner

Apply only to these existing tests after approval:

1. `src-tauri/src/services/note_timeline/tests/publication.rs::adaptive_checkpoints_are_transparent_across_a_long_revision_chain`.
2. `src-tauri/src/services/note_timeline/editing_window_capture/tests/query_inventory.rs::query_inventory_nine_dense_notes_do_not_spend_model_evidence`.

Exact change sequence for each:

1. After its AppState/Fixture exists, acquire `let seed_foreground = state.foreground_guard()` (using `f.state` for inventory) immediately before the outer seed loop.
2. Leave every seed iteration, source value, Markdown payload, canonical publication, editing-window finalization and assertion unchanged. Retain140 revisions, nine notes and12 further publications per note. No direct database rows, alternate save replica, reduced thresholds, ignored tests or shared fixture.
3. Immediately after the seed loop, `drop(seed_foreground)`.
4. Call `state.background_index_queue.wait_until_idle_for_test()` (or `f.state...`) before creating the restarted AppState or performing inventory queries/assertions. This existing condition-variable helper waits for actual queued projections; it does not sleep a guessed duration. Its existing5s timeout stays unchanged.
5. No new helper, production edit or configuration switch is necessary. The guard is RAII, so unwinding releases it; existing fixture/queue destruction remains intact.

Why this is a legitimate setup optimization: normal publication immediately updates canonical Markdown, durable history, catalog and task projection. `post_publication.rs:96–136` queues lexical work separately. `BackgroundIndexQueue` already postpones that derived work while a foreground owner is active and coalesces queued updates for the same path. The fixture builds many intermediate revisions but only queries the completed result; it never asserts lexical visibility of each intermediate seed. Holding one real foreground admission across construction lets ordinary coalescing operate without replacing any persistence path. Releasing and draining before observation proves the same final projection work actually finishes and avoids moving cost beyond the timing interval.

Expected mechanism, not a guaranteed saving: the140-revision single path can collapse to its final pending lexical generation; the nine-note fixture can collapse each note's12 intermediate updates to its last one. Initial fixture publication may already have started one real projection, which must still complete. Final task rows and every retained history revision continue to be produced normally. A current projection holds the same per-path coordinator used by synchronous task updates, so reducing lexical interleaving may reduce both commit work and lock competition.

Risks to check: final projection idleness must be observed after releasing the guard; a helper call while retaining it would wait until timeout. Do not reuse this pattern in tests of per-save lexical visibility, background wake/coalescing, foreground fairness or publication/observation races. A25ms foreground backoff remainder may be added once at release; measure net result rather than assuming improvement. Production checkpoint policy includes a measured replay-cost input, so exact physical checkpoint placement is intentionally adaptive; no assertion is weakened to force a timing win.

## Why the other two fixtures stay unchanged

- `query_inventory_continues_across_budgets_without_duplicates_or_scope_bypass`:55 distinct notes in each of sparse and dense branches. Production limits are50 display rows and256,000 charged inventory bytes (`services/evidence/inventory.rs:5–6`). Same-path coalescing cannot eliminate distinct-note writes. Preserve both thresholds, continuation reuse, complete union, no duplicates, scope rejection and stale-history cursor behavior. Reducing dense note count may still cross the byte limit, but would be a scale/fixture redesign; this experiment does not do it.
- `revision_context_seeks_and_pages_explicit_lineage_with_scoped_stale_cursors`:80 revisions plus interleaved renames create records on both sides of a31-record context window; current tests assert center offset15, older/newer continuation, backtracking, typed cursor scope, missing anchor, indexed successor plans and clear invalidation. Each title rename changes the path, reducing simple same-path coalescing opportunity. Leave the counts and assertions intact. It is not established as an avoidable-cost fixture solely because its seed is large.

## Checkpoint coverage caution

The long-chain test's body changes a single substantive line and grows with each revision. Production checkpoint policy (`history_store.rs:1609`) considers delta/full ratio, accumulated bytes and measured replay cost as well as128 revisions. Therefore140 revisions and reconstruction at indices0/127/139 do not, by themselves, prove the replay-count threshold fired. Do not shrink it to a shorter chain or claim preserved128-boundary coverage from a count alone. This performance experiment retains its full existing sequence; improving the checkpoint-specific oracle is a separate correctness investigation, not a reason to weaken this test.

## Validation and acceptance

Coordinator captures focused before timings for the exact two names, then approves source edits if desired. Run the same binary filters after one combined compile, preserve test counts/assertions, and repeat the before/after workload enough to distinguish scheduler noise. Include final projection drain in measured wall time. Keep the change only if both tests pass and the combined repeated measurement shows a useful improvement. Coordinator owns full acceptance afterward. Record a negative experiment if no benefit; do not stack unmeasured fixture reductions on top.

## Experiment implementation

After coordinator approval, added exactly five lines to each selected test: two comment lines explaining foreground admission, guard acquisition before the seed loop, explicit guard release after it, and the existing idle-queue wait. All140 revisions,9×12 additional revisions, note data, assertions and their order remain unchanged. No production changes. Scoped `git diff --check` passed. Source freeze was reported to the coordinator; this investigator ran no tests or builds. Measurements and acceptance/reversion remain pending.

## Final coordinator decision

Experiment implemented and reviewed, then reverted. Full serial suite was 111.56s versus 112.61s baseline; focused results varied. No convincing whole-suite improvement justified the added setup scheduling. Both test files restored byte-for-byte to this phase baseline. Candidate diff retained in rejected-rust-fixture-experiment.patch. No Rust change remains.
