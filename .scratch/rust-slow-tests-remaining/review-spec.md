# Independent Spec review — remaining three targets

Status: final source/archive Spec review complete; no actionable findings. Coordinator combined acceptance pending.
Reviewer: audit_ui_semantic (not author of this phase).

Baseline is the Rust-package-root snapshot in `baseline.json`, `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-remaining-tests-baseline-nyoc_iyr`, not HEAD. Read `spec.md`, all three audit/measurement maps and child plans; compared phase source changes and inspected existing loader/export, checkpoint policy, compaction and reader assertions. No source edits/builds/tests run by reviewer.

## Spec assessment

- **Inventory:** approved dense20/sparse55 cardinality change preserves real256000-byte ceiling and charged-byte bound, first-page byte-versus-row stop reason, nonempty progress, one retained search, per-page currentness, denied scope changes, no duplicates, exact union of allowed identities, multiple pages and history-clear invalidation. The added dense first-page `<50` assertion makes the distinct byte boundary explicit. Generator retains an excluded Window note; consumer must use the actual20-note archive, not truncate a55-note fixture. Actual regenerated-archive boundary behavior remains root validation, because IDs affect ordering.
- **Checkpoint:** the approved prefix ends at index126, with127 revisions, one root checkpoint and126 deltas. Both loader and generator assert this layout and reconstruct endpoints. The ordinary test performs13 real prepare/canonical-write/mutate/finalize operations at127–139, rejecting warnings;127 must remain a delta,128 must become a checkpoint, and129–139 must become deltas. Thus the archived prefix cannot hide an early127 or missing128 checkpoint decision. It closes the original timeline and joins projections before new AppState construction; total140 revisions and original reconstruction positions0/127/139 remain, with128/129 added. No target checkpoint128 is generated in the precondition. This is the explicitly accepted coverage tradeoff: routine runs stop rebuilding the earlier127 real publications, while generator uses current production writers and ordinary writer/fault/restart tests remain live. Actual50ms adaptive timing is unchanged and may legitimately interrupt this exact policy geometry on severely loaded hosts; record empirical results rather than claiming timing independence.
- **Storage:** four distinct deterministic32KiB bodies still execute real canonical writes and finalization. Existing auto-vacuum, logical-clear allocation retention, increased reclaimability, first receipt equality,32KiB per-pass reclaimed-byte limit, bounded eventual zero, final allocation shrink, revision count1 and deletion marker1 oracles remain. New physical `page_size * freelist_count >32768` proves more than one page-budget worth of free database pages independently of WAL bytes; positive remaining reclamation after the first pass prevents a vacuous one-pass case. BaselineInitialization source is strengthened. Root's candidate log shows20 free4096-byte pages after clear and12 remaining after first pass, with three actual passes; that is candidate evidence, not a substituted production result.

## Fixture validity and scope

Existing archive owner validates version/schema/kind/geometry, allowlisted file paths and SHA256, SQLite quick/foreign-key checks, settled receipt/window/deletion state and managed identity. Loader restores a writable copy and invokes normal catalog/lexical admission; no silent regeneration or pre-marking of corrupted bases occurs. Only portable path columns are rebased in the disposable copy. New checkpoint policy helper reads stored IDs/kinds/counts and cannot manufacture passing revisions. Per-kind recipe2 for dense avoids forcing unrelated recipes to change. Other archive bytes must remain at baseline as agreed.

No production caching, altered checkpoint constants, skipped verification/fsync, fabricated outcome row, reduced corruption/paging test inventory or unrequested rewrite was found. Final frozen-source review confirms temporary probe timing/output removal, unchanged production constants/algorithms, and only the five planned Rust test/helper files plus fixture README and two archives in scope. Formatting does not change assertions.


## Final artifact and acceptance evidence

Independently decompressed all five actual archives and checked every declared file SHA256. Opened disposable SQLite copies read-only/immutable for metadata inspection (no runtime/build/test execution and no artifact modification). All five quick checks report `ok`. `review-spec-archives.json` records details:

- Dense recipe2:20 scenario IDs,21 total notes/revisions/lifecycle events and23 archived files, retaining excluded Window.
- Checkpoint recipe1:127 revision rows; exactly one root checkpoint with replay_count0 and deltas1–126. Maximum accumulated delta bytes6691, comfortably below256KiB. It contains no target128 checkpoint.
- Sparse55, nine-dense and revision-context compressed bytes match the saved baseline exactly.

Root's `focused-final.log` records all three actual final-fixture consumers passing (3/3,5.54s test execution;15.14s compilation reported separately). This verifies the regenerated dense archive crosses the real byte bound under the retained assertion, not merely the earlier55-note subset experiment. Root also reports/records the late129 mutation failing the exact live128 checkpoint assertion; the production128 constant is now restored and independently observed. Early-threshold mutation and full acceptance remain root evidence to finalize, not reviewer-run claims.

The final phase diff is `review-spec.patch` and exact source/artifact hashes are `review-spec-hashes.json`. Snapshot capture initially overlapped the coordinator's explicitly temporary129 mutation; the final diff was regenerated only after128 restoration. That mutation is absent from the retained review scope. No unresolved Spec finding blocks integration.
