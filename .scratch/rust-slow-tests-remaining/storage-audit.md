# Storage reclamation fixture audit and measurement plan

Status: ready-for-agent
Progress: Read-only source audit complete; measurement plan awaiting coordinator approval. No source edits, builds or runs by this owner.

## Contract and incidental work

Target: `src-tauri/src/services/note_timeline/tests/administration.rs`, `storage_usage_distinguishes_immediate_logical_deletion_from_bounded_reclamation` (currently lines465–524). Read the phase spec, prior `rust-slow-tests/writer-audit.md`, real compaction/usage implementation, and delta codec. Existing fixture performs initial creation plus24 real finalized editor saves, each512 largely repetitive lines (~39KiB). Every line changes; Myers line matching and repeated durable preparation/finalization are setup cost, while zstd compresses the repeated suffix heavily. Neither24 revisions nor512 lines is a compaction-policy threshold.

The subject is real allocation → logical clear → bounded physical reclamation. Retain the real writer/finalizer, auto-vacuum mode2, no physical shrink at logical clear, increased reclaimable bytes, exact first before receipt, each call's32KiB reclaimed-byte ceiling, eventual zero reclaimable bytes, smaller final allocation, one new baseline and one deletion marker. Keep the128-pass failure bound: it already exits at zero, so reducing it saves no successful work. A prebuilt deleted store would bypass the subject. No production changes or durability/verification disabling are proposed.

Important measurement distinction: `HistoryStorageUsage::reclaimable_bytes` includes **both** SQLite freelist pages and WAL bytes reclaimable by checkpointing. Merely asserting this value >32KiB does not prove multiple passes of page reclamation. Measure `PRAGMA page_size`, `page_count`, and `freelist_count`, plus actual main/WAL/SHM bytes, before/after clear and compaction. Require post-clear `page_size * freelist_count >32KiB` in the chosen fixture. Production compact computes page budget from remaining bytes, caps pages per pass, and may spend budget truncating a sufficiently small WAL first; retain this actual behavior.

## Root-owned probe plan

Use temporary instrumentation only in the target test, then remove it. Root alone builds/runs serially against the saved phase baseline.

1. Baseline24×512: time initial fixture/create; all retained saves; pre-clear usage; clear; first compaction; remaining drain; final assertions/teardown. Report compaction pass count and allocated/reclaimable values at retained, logically-deleted, first-after and final. At retained/post-clear/first-after/final also read page geometry and sidecar bytes from the real store. Record exact retained revision count and baseline source after clear. Diagnostics must not manually checkpoint or alter SQLite pragmas, since those would change the measured contract.
2. First smaller candidate: initial creation plus **four** real finalized editor versions, each32KiB of deterministic hexadecimal SHA-256 output, produced locally from512 `(revision, block)` strings and concatenated into a single line. This uses the existing sha2 dependency with no reusable fixture helper, randomness or generic generator. Bodies remain distinct and compress to roughly half their text size; actual database free pages, not that estimate, decide eligibility. One changed body line removes incidental512-line diff work while retaining genuine allocation/writer/finalization behavior.
3. If four versions meet every existing assertion with a clear physical margin and timing improves, optionally measure three versions with the same body. Choose the smallest simple fixed shape that reliably leaves more than32KiB of **free pages**, preferably at least48–64KiB on the current implementation. Do not adaptively grow until passing at runtime; that hides a changing fixture contract. If three is marginal, retain four. If neither yields useful savings or the old physical invariants fail, keep baseline and report evidence.
4. Run the unchanged final oracles plus explicit multi-pass geometry. Root may mutation-check ignoring the32KiB budget: first receipt should reclaim >32KiB and fail. Preserve cleanup and restore pristine source after any mutation/probe.

## Proposed final delta after measurement approval

Only replace the24×512 seed in this one test; keep all existing assertions and operations. Add an explicit post-clear physical freelist-byte guard (test-local read, no production API) and verify a remaining reclaimable balance after first compaction so the first-pass bound is meaningful. Make the already-intended new baseline source explicit alongside existing count1; retain marker count1. Prefer a compact in-test deterministic body construction over a helper/fixture framework. No new regular tests or shared fixture changes.

## Evidence limits

Prior coordinator reported2.20s for the whole test. This audit has no current timing or actual page measurements and makes no speed claim. Baseline and candidate measurement columns remain pending coordinator runs; source changes are not authorized until this plan is accepted.

## Baseline probe handoff

Coordinator approved temporary instrumentation only. Source frozen: original24×512 fixture and every existing assertion retained; snapshot comparison confirms only the target function changed. `REMAINING_PROBE storage` reports setup,24 writes, clear, first compaction and total compaction timings; total pass count; and allocated/reclaimable/page-size/freelist-count at retained, cleared, first-after and final. Compaction elapsed sums actual calls, excluding diagnostic geometry reads. Root owns runs. The timeline owner added the cfg(test) page-geometry helper in history_store.rs; this owner did not edit that file. No candidate fixture has been applied.

## Baseline evidence and candidate decision

Coordinator baseline probe: setup36ms;24 real finalized writes716ms; clear10ms; three compaction passes14ms. Retained allocation356352 bytes, reclaimable32768 bytes,8 free4096-byte pages. After clear:73728 reclaimable bytes and18 free pages. After first32KiB pass:10 free pages; final zero. This proves actual page-budget geometry and identifies retained writes as the dominant measured stage.

Coordinator approved candidate now: replace only the seed with four real finalized versions of32768 hex characters each (512 SHA256 blocks over revision/block identifiers, one line). Keep initial real creation and every original oracle. Add post-clear physical freelist bytes>32768, positive remaining reclaimable bytes after the first pass, and explicit BaselineInitialization source after clear. Temporary probes remain for serial comparison. No production changes; no runtime adaptive growth or dependency addition. Four is provisional until measured; source will freeze for coordinator validation.

## Accepted result and final source freeze

Coordinator candidate measurement passed all old/new assertions: four real writes122ms versus716ms baseline; whole probed target208ms versus796ms baseline (about74% lower in this comparison). Post-clear20 free4096-byte pages =81920 bytes; first pass leaves12 pages =49152 bytes; three total passes reach zero. This has slightly more physical free-page workload than baseline18→10→0, while removing20 incidental publications and512-line diff matching from each body. It is not a weaker single-pass reclamation fixture.

Coordinator accepted four versions; no three-version experiment is needed because measured savings and physical margin are sufficient. Removed every temporary timing/probe from the target. Retained initial real creation, four deterministic32KiB writer/finalizer publications, every original budget/logical-clear/final-size/marker assertion, actual post-clear free pages>32KiB, positive first-after remainder, and explicit BaselineInitialization source. The final revision list is read once for count/source. No new regular test, no production behavior change. The small cfg(test) free-page geometry helper is retained; only its probe comment was changed to describe permanent purpose, coordinated with its owner.

Final target is14 lines longer than phase baseline while executing20 fewer writer/finalizer cycles. Test inventory unchanged. Snapshot inspection confirms no other administration test changed and no probe text remains in this target. No builds/runs performed by this owner; all timings above were reported by the coordinator. Root owns final clean-source compile, focused/full acceptance and any budget mutation verification.
