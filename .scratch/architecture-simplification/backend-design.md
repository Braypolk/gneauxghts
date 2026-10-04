# Backend design: claim one semantic job instead of reconstructing the whole queue

Status: needs-triage
Progress: Read-only design audit complete; awaiting coordinator approval before source changes.
Owner: audit_agent

## Recommendation

Rewrite the private semantic worker's job selection/completion protocol in `src-tauri/src/semantic/indexer.rs`. Keep its single queue, worker, public SemanticState API, concrete indexing operations and existing numerical policies. The queue should hand the worker exactly one selected job; work not selected stays queued. Return each job's `JobOutcome` directly to completion scheduling instead of communicating it through mutable runtime-status fields.

This replaces a specific mechanism rather than rearranging the 3,000-line file. Today's worker removes all pending work to execute just one priority branch, clones the removed batch, tracks seven handled flags, then reconstructs the unrelated work it removed. The reconstruction is both duplicate ownership and a source of ordering bugs. A selected-job protocol eliminates it.

Estimated production reduction: roughly **120–200 net lines** including the private job enum, claim/requeue implementation and outcome return changes. This is an estimate, not a quota. The more important deletion is the whole-batch drain/defer/reconstruct protocol and runtime-result mailbox. Do not force additional ANN/Chat rewrites to inflate this result.

## Evidence and present ownership

Inspected `semantic/indexer.rs` work admission, drain loop, retry merge, run_job, batch mutations and worker tests; `semantic/mod.rs` update/recall/rebuild producers and RuntimeState; both ANN adapters/core; chat admission/store/runtime and agent runtime seams. Read ARCHITECTURE.md, behavior-invariants.md (semantic last-good/retry and chat contracts), ADR0001, ADR0003 and ADR0009, and codebase-design.

The worker already has the right *external* owner: `SemanticWorkQueue` gates admission, coalesces wakes, joins active work, handles restart and interrupts delays. `process_pending_jobs_with_wait` is the problematic internal protocol:

- indexer.rs:448–486 takes **all** PendingIndexState, clones it for retry, clones explicit document maps a second time around bulk work, clones both Atlas maps, and computes seven handled booleans.
- indexer.rs:496–848 chooses just one of rebuild, full scan, document mutations, automatic ANN rebuild, edges, snapshot, structural Atlas, labels.
- indexer.rs:853–980 reconstructs unselected requests from clones using handled flags, adds downstream work, and reads `last_job_scanned_count`/`last_job_edges_dirtied` from RuntimeState.
- indexer.rs:1043–1100 already contains a careful newer-wins retry merge, including move chains and newer full rebuild supersession. It should remain the single failure merge policy rather than compete with successful deferred-work replay.
- indexer.rs:1162–1268 `run_job` already receives a JobOutcome, writes two fields into RuntimeState, then discards the outcome and returns bool. Only the scheduling loop reads those two fields (`semantic/mod.rs`:194–195,213–214); they are not IPC fields or UI state.

### Concrete stale-work interleavings

These are code-supported possible interleavings; not yet reproduced by a new executable fixture in this read-only phase.

1. A full scan and old explicit ChatRecall update are present together (allowed by `queue_chat_recall_inner`, mod.rs:525–580). Worker takes the entire batch and clones the explicit update. During scan, a newer recall set for the same conversation is queued. On successful scan, indexer.rs:873–878 uses `next.note_updates.extend(updates)`, letting the **old** deferred value replace the newer one. The failure path's newer-wins merge does not run. Since an ordinary filesystem scan cannot reconstruct ChatRecall from its projection, retaining the newest explicit record matters. Claiming only the scan leaves old/new recall coalescing in the existing queue owner, eliminating the replay race.
2. During a failed Atlas label build, a newer request for the same key may arrive. indexer.rs:833 currently uses `state.atlas_label_requests.insert(key, request.clone())`, replacing it with the failed older request. Structural Atlas uses max epoch and generic retry merge already lets newer label requests win. Unified selected-job requeue must preserve the newer entry for both kinds.

Do not add broad new asynchronous infrastructure to reproduce these. Add/extend narrowly controlled real-queue worker regression cases after approval; retain all existing failure, pause, shutdown and generation-alignment coverage.

## Proposed private interface and flow

One private enum, used only inside the current worker, names the selected operation:

- Rebuild
- FullScan { force }
- Documents(SemanticDocumentBatch)
- RebuildAnn
- RefreshEdges
- PublishSnapshot
- StructuralAtlas(existing request map)
- AtlasLabels(existing request map)

A `PendingIndexState::claim_next()` method (or equivalent private function under the existing queue mutex) removes only the selected flag/payload in the existing priority order. It leaves unrelated flags/maps and live building markers in place. A full rebuild may consume an already-pending full-scan flag it subsumes; it must not erase requests arriving after claim. Snapshot still precedes edges when both pending, matching the existing `edge_refresh && !snapshot_publish` rule. Structural/label claim may take their existing whole category map to preserve current per-drain processing order; no new general-purpose priority scheduler is needed.

The selected enum replaces every handled boolean. Its match dispatch invokes the existing concrete job bodies. Extracting those bodies into small private functions is acceptable only when it shortens repeated context argument plumbing; moving them alone is not the change being proposed.

`run_job` returns `Option<JobOutcome>` or `Result<JobOutcome, ...>` after its existing DB job receipt and debug/status handling. The success completion match uses that value directly. Remove the RuntimeState mailbox fields and the extra lock/read/write. Preserve the distinction between scanned_count and edges_dirtied.

On success, enqueue only *new dependencies* of the completed job: document/scan work -> ANN or snapshot when needed, dirty edges, affected Atlas visibility variants; rebuild/publish -> edge generation refresh; edges -> clear edges_stale. Unselected pending work needs no restoration. Keep revision/health behavior stable unless a specific existing no-op/deferred branch is deliberately tested and approved for change; this rewrite is not permission to quietly change revision semantics.

On failure, return only the selected job's work to the queue using the existing newer-wins merge policy. Conversion into PendingIndexState for `merge_retry_batch` is acceptable if short and private; do not add a generic Job trait, boxed closures, separate queue, second retry owner, or policy factory. Atlas retry attempts/backoff stay distinct from semantic bounded retries, as they are today. Label requeue must not replace a newer request; structural requests retain max epoch.

Keep concrete mutation inputs borrowed through execution where practical, avoiding whole-state clones. If a document batch must remain owned across failure, a clone of that selected batch alone is defensible; cloning unrelated Atlas/document maps is not. A production net reduction must include any new enum/claim/requeue code and be measured before acceptance.

## Exact deletion / replacement map

| Current mechanism | Remove or replace | Retained owner |
| --- | --- | --- |
| Whole `mem::take(PendingIndexState)` at448–460 | Claim just one enum variant | Same mutex / SemanticWorkQueue |
| `retry_batch`, `deferred_explicit_updates`, both deferred Atlas map clones at461–476 | Selected job is retry identity; unrelated work stays pending | claim/requeue |
| `handled_documents`, `handled_automatic_rebuild`, `handled_edges`, `handled_snapshot`, `handled_atlas`, `handled_structural_atlas`, `handled_label_atlas` | Match the selected job kind | private job enum |
| Successful deferred document replay at867–881 | Delete entirely | Existing producer coalescing retains newest update |
| Successful deferred Atlas restoration at883–892 and unhandled flag restoration at919–932 | Delete entirely | Unclaimed requests never leave queue |
| Two runtime result fields plus default values in mod.rs | Delete | Direct returned JobOutcome |
| Writing outcome into runtime at1197–1201 and rereading at862–865 | Delete | run_job return |
| Repeated construction of same AtlasWorkerContext for structural/label branches | Construct once through the existing worker context when either variant executes | Same Atlas publication owner |
| Failed label unconditional insert | Requeue only if no newer entry (existing newer-wins rule) | Same queue merge policy |

Job bodies for DB scan, note batch, HNSW/edge repair, snapshots and Atlas publication remain concrete and preserve their current algorithms. No new file boundary is required.

## Invariant map and acceptance

| Required invariant | Design constraint / existing verification owner |
| --- | --- |
| One semantic worker queue, quiesce before restart, late admission rejected | Do not replace SemanticWorkQueue, leases, Wake/Barrier/Shutdown or accepting/active state. Keep semantic_quiescence and shutdown-delay tests. |
| Pause releases wake coalescing; one resume drains pending work | Leave handle_wake and manual checkpoints; retained paused_wakes test must pass. |
| Automatic semantic retries bounded; newer work never overwritten | Keep retry budget/backoff; preserve failed_batch_merge/newer_rebuild tests. Add successful-bulk/newer-recall regression to close exposed gap. |
| Last good index remains queryable after failure | No ANN load/install/publication algorithm changes. Retain existing chunk/note ANN failed rebuild tests. |
| Note ANN generation published before matching edges/Atlas provenance | Keep snapshot-before-edge ordering, current generation handoff and snapshot_publication_keeps_edge_generation_aligned_for_atlas. |
| Atlas structural and label supersession/panic markers remain correct | Preserve stage checkpoints, building marker cleanup and supersession behavior; requeue newer label request rather than overwriting it. |
| Chat recall uses explicit immutable excerpts, not full transcript Markdown | Keep PendingSemanticDocument distinction and preparation code; bulk job cannot consume its unselected explicit queue entry. |
| Numerical/dimensional/domain policies remain distinct | No similarity, ANN ef64/96, identity validation, note/chunk delta thresholds or Atlas geometry changes. |
| App-owned agent runtime and durable chat acceptance/terminal lifecycle | No chat/runtime/permission/persistence changes in selected proposal. ADR0001/0003/0009 unchanged. |

After approval, persist a scoped implementation issue, reproduce the successful-bulk stale replay and label retry ordering with controlled queue interleavings, implement claim/execute/complete, run retained semantic worker/mod/ANN/Atlas focused checks and architecture gate. Root owns full combined gates. Record production delta and removed coordination concepts separately from test additions. Reject an implementation that merely splits the600-line function or replaces seven booleans with seven independent wrapper objects.

## Alternatives considered

1. **Keep drain-all, move job bodies into functions.** Low risk, but whole-queue cloning, seven flags and stale reconstruction remain. Reject as primary architecture simplification.
2. **Replace the worker with a general task graph / generic policy scheduler.** Could encode dependencies centrally, but introduces a new language and migration across all producers; much more surface than the actual fixed eight-category policy requires. Reject.
3. **Unify chunk/note ANN into a generic adapter engine.** Significant repeated generation/status code remains, but common file persistence/capacity mechanics already live in ann_core. Chunk/note search, exact reranking, manifests, identities, delta bounds and error handling differ. A broad generic engine would likely replace duplicate code with policy plumbing rather than reduce burden. Not recommended for this phase.
4. **Remove NoteANN's path mirror and graph reload during metadata refresh.** `NotePathInventory.by_path` is written but never read; by_label duplicates SQLite path hydration. `persist_current` reloads graph/vector files just to install a new manifest. Potential bounded follow-up, but removing all path guards needs careful stable-label/current-row proof and preserves fewer concepts than fixing scheduler ownership. Do not combine it with selected rewrite.
5. **Rewrite ChatService terminal/admission coordination.** Current separate admission/terminal transactions protect real atomicity, retries and branch lineage; intermediate runtime/provider layers carry distinct policy. No comparably strong removable production protocol found in this pass. Timeline owner is separately auditing canonical note/proposal publication; avoid parallel edits there.
