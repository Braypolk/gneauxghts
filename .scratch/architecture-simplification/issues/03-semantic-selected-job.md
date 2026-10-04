# 03 — Claim only the semantic work selected for execution

Status: ready-for-agent
Progress: Implemented and focused validation complete; clean final rebuild and indexer26 pass/1 ignored after mutation restoration. Coordinator owns combined acceptance gates.
Owner: audit_agent
Scope: semantic/indexer.rs, semantic/mod.rs and their private tests only.

## Approved design

See ../backend-design.md. Replace whole-PendingIndexState drain/retry clone/deferred replay and seven handled flags with one private selected-job value. Unselected work stays in the same queue. run_job returns its existing JobOutcome directly, deleting last_job_scanned_count/last_job_edges_dirtied from RuntimeState. Preserve existing concrete workers, provider/ANN policies and SemanticWorkQueue admission/wake/active/barrier ownership.

## Exact deletion targets

- process_pending_jobs_with_wait whole-state mem::take and retry/deferred document/Atlas map clones.
- handled_documents, handled_automatic_rebuild, handled_edges, handled_snapshot, handled_atlas, handled_structural_atlas, handled_label_atlas.
- success-side reconstruction of unselected maps and flags, including stale explicit replay after full scan.
- runtime mailbox fields/defaults and run_job write / scheduler reread.
- duplicate AtlasWorkerContext construction when practical without adding a wrapper layer.
- unconditional old label request reinsert on failure; preserve live newer request.

## Replacement and invariants

Private selected operation follows existing priority: rebuild (subsumes preexisting full scan), full scan, explicit mutations, automatic ANN rebuild, snapshot-before-edges when both set, edges, structural Atlas, labels. Claim under existing mutex removes only its work. Selected work alone requeues through existing newer-wins merge on failure. Rebuild/scan leaves explicit recall queued; newer arrivals coalesce normally. Downstream scheduling adds only consequences of completed work. Preserve revision updates, Atlas building markers/supersession, visibility variants, separate semantic/Atlas backoffs, retry exhaustion/manual retry, stop/pause delays and generation alignment. No new worker framework or public API.

## Regression and validation sequence

1. Before implementation add bounded regression to existing real worker fixture: full scan with old queued explicit ChatRecall; enqueue newer same-conversation recall during controlled embedding call; verify SQLite contains newest excerpt after drain. Avoid sleeps; provider callback controls interleaving. Old implementation must fail or evidence must force plan revision.
2. Before implementation add/extend queue retry case with different old/new AtlasLabelRequest same key and show actual retry path preserves newer request. Prefer extracted private shared label requeue operation used by real worker, no parallel model. If direct failing old behavior requires exact standalone queue operation, record limitation and keep actual caller covered by existing worker tests.
3. Implement selected-job claim/execute/complete, direct outcome and newer-wins requeue. Keep current tests rather than recreate parallel fixture suite.
4. Coordinate Cargo with timeline owner. Run semantic indexer/mod, ANN, Atlas focused checks and architecture fitness; coordinator owns combined gates. Capture exact production/test delta including enum/claim/requeue. Reject mere file movement or net support growth without removal of old ownership protocol.

## Acceptance

Both stale ordering contracts retained; existing retry/backoff/pause/quiesce and snapshot-edge alignment pass. No changed IPC status fields or numerical policies. Persist result/measurement and remaining limits; no commits.

## Implementation evidence

- Baseline real-worker regression failed with SQLite `old excerpt` instead of `new excerpt`; see `../03-recall-before.log`. Provider callback deterministically queues the newer recall while full-scan embedding is active. The same test passes after the rewrite.
- A claim takes one work category, including the existing coalesced document batch or all queued Atlas requests of one kind. Atlas batching intentionally preserves per-round fairness/backoff: selecting one arbitrary HashMap key could starve other visibility requests behind repeated failures.
- `SelectedJob::requeue` delegates to existing newest-wins merge. Label regression runs the real building-marker guard around a failing build, queues a newer label identity inside that build, then exercises the same requeue method the worker calls. It is a queue/build-boundary test, not a complete Atlas geometry build.
- All unselected work stays in place. Seven handled flags, whole-queue clone/drain, deferred explicit/Atlas replay, and two runtime mailbox fields are gone. `run_job` returns its outcome directly. Document execution clones only its selected mutation payload to retain retry identity; unrelated queue payloads are never cloned.
- Focused current checks: indexer 27 pass/1 existing ignored measurement; health 6; chunk ANN 6; note ANN 7; Atlas 27; activity 3. No failures. Logs `../03-*.log`.
- Exact checkpoint delta: production-region -92 LOC (indexer -88, semantic/mod -4), regression/support +96, net +4. Newly unused `is_empty` is test-only; counts conservatively retain its source in the production region rather than claiming reclassification as deletion. This is a protocol deletion, not a file split or helper relocation. The two added cases protect exposed correctness defects; no duplicate priority mirror test was retained.

- Label old-policy mutation proved sensitivity: replacing only selected-label retry with the former unconditional map overwrite fails with `old` structural generation instead of `new`. See `../03-label-old-policy.log`. Fixed source restored automatically in `finally`; no mutation remains. This is mutation evidence, not a claim that the complete old Atlas worker was executed in that test.
- Architecture fitness 23 passed in timeline owner's combined build. Final clean lib rebuild shared with timeline owner is required after mutation; previous good binary results cover the same semantic behavior except the harmless test-only helper annotation.

Final clean combined library compilation passed without warnings (timeline owner, 20.07s). Reviewer/owner reran all retained indexer cases on that rebuilt binary: 26 passed, one existing scale measurement ignored, zero failures; `../03-indexer-final.log`. Source frozen.

Count reconciliation: first focused indexer run included a temporary direct priority-mirror test (27 passing). That test was removed as redundant with the real snapshot/edge fixture before source freeze; final clean binary has 26 passing indexer cases plus one ignored scale measurement. Only the two ordering regressions remain added.


## Coordinator acceptance

Progress: Complete. Independent review findings closed; combined frontend/Rust/typechecks, all browser files, seven-file native smoke and actual process restart verified. See ../validation.md for exact counts, failed-run history and remaining test-environment uncertainty.
