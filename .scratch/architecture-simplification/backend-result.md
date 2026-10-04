# Semantic selected-job rewrite — outcome

Status: ready-for-agent
Progress: Implementation complete and source frozen; coordinator combined acceptance gates remain.

Issue03 replaces the worker's drain-all/replay protocol with one claimed work category. Unselected work stays in the existing queue. The explicit recalled-excerpt update that arrives during full-scan embedding therefore remains authoritative; the old implementation demonstrably wrote the older excerpt back over it. Semantic retry requeues only the selected payload through the existing newest-wins merge. Atlas retains per-category batching and its separate retry/backoff policy, while old label retry cannot overwrite a newer request.

Deleted coordination: seven handled flags; whole PendingIndexState drain/copy; deferred explicit/Atlas clones and success reconstruction; duplicated Atlas context construction; two RuntimeState result mailbox fields and write/reread protocol. `run_job` returns JobOutcome directly. The same queue/worker, admission/barrier/quiesce, concrete scan/index/ANN/edge/Atlas algorithms, health/retry budgets and numerical policies remain.

Evidence:

- `03-recall-before.log`: exact real-worker SQLite regression failed before source rewrite (`old excerpt` vs `new excerpt`). Same test passes after.
- `03-label-old-policy.log`: restoring the old unconditional label overwrite to the actual retry boundary fails (`old` vs `new` generation). Fixed source restored automatically; the final clean rebuild contains no mutation.
- `03-indexer-final.log`: **26 passed, 1 existing ignored scale measurement**, zero failures on clean final compiled source. Initial27 included one redundant direct priority mirror test subsequently deleted; final tests add only the two meaningful ordering regressions.
- Adjacent focused filters: health6, chunkANN6, noteANN7, Atlas27, activity3 passed. Existing snapshot/edge-generation, semantic retry exhaustion, pause/resume, quiesce, wake coalescing and panic-marker cleanup all remain active. Architecture23 passed in timeline owner's combined gate; no independent full-suite claim.

Exact checkpoint physical delta (`03-metrics.json`): production-region **-92**, test/support **+96**, net **+4** across indexer.rs and semantic/mod.rs. The count includes all new enum/claim/requeue code. The now test-only queue emptiness helper remains conservatively classified in the production region; reclassification earns no deletion credit. New regression/support lines protect the two concrete ordering defects; this is not a file move or test-count exercise.

Boundary limitation: the label regression exercises actual claim/build-marker/requeue functions with a controlled failing build, not complete Atlas geometry computation. The existing Atlas suite protects geometry/publication separately. The document job retains one clone of its selected payload for retry; unrelated queue payload cloning is gone.
