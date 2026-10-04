# Remaining writer-test cost audit

Status: ready-for-agent
Progress: Read-only investigation complete. No source edits, tests, builds or timing runs. Coordinator owns current serial measurements. Coordinator current serial timings: long chain11.02s; reclamation2.20s; settled copies1.54s; cancellation1.34s; initialization1.08s. These are coordinator measurements, not runs by this reviewer.

I applied the diagnosing-bugs approach: trace actual operations, distinguish contractual volume from incidental volume, propose bounded experiments rather than assert an unmeasured saving. All five tests depend on the writer or verifier doing real work; none should import a prebuilt passing result.

## 1. Adaptive checkpoints / long chain — keep 140 writes

Owner: `tests/publication.rs:1084–1163`, `history_store.rs:1560–1643`, `history_store/codec.rs:180–244`.

The test performs 140 real private prepare → canonical file write → mutate → Editing Window finalize sequences on one identity. Every body changes and grows. It then constructs another AppState and reconstructs states 0,127,139, asserting 140 retained revisions. This pays history preparation/replay, delta computation and verification, durable publication/window work, catalog/task updates and queued lexical work. Bodies are small; replacing their strings with constants would destroy the changing-history case.

The actual checkpoint policy combines replay length128, accumulated delta bytes256KiB, delta/full ratio0.65 and measured replay50ms. The current test does not inspect which policy fired; 140 revisions alone do not prove a replay-length-triggered checkpoint. No payload-kind or replay-count assertion exists. The small growing bodies and changing encoded authored-length header can make delta/full ratio checkpoint early, so a replay-count128 crossing is **unverified**, not established by the fixture name or total count. A read-only query of generated `payload_kind`/`replay_count` rows would settle which layout this run actually produced. Retain the sequence and threshold-adjacent reconstruction assertions. If improving its oracle separately, observe actual payload kinds/policy before claiming a specific checkpoint boundary, rather than shrinking the sequence.

The earlier foreground/coalescing experiment on this exact test was **reverted**: `.scratch/test-performance/backend-fixture-followup.md` records noisy focused results and whole-suite111.56s vs112.61s. Do not recommend the same unproven change again without new stage evidence. The manual fixture also leaves its first AppState alive when constructing `restarted`; stopping/dropping the first worker before restart would make lifetime explicit, but changes overlap and is not a demonstrated speed improvement. Best next measurement: separate append preparation/finalization/reconstruction and queued projection time; preserve real durability and restart behavior.

## 2. Logical deletion / bounded reclamation — budget geometry matters, not128 iterations

Owner: `tests/administration.rs:465–527`, `administration.rs:1011–1030`, `history_store.rs:3501–3554`.

Initial creation plus24 finalized revisions each generate512 lines (~40KiB body) with every line changed. Besides persistence this intentionally invokes line-delta matching on hundreds of differing lines. After clear, assertions distinguish allocated vs reclaimable space; compaction is capped at32KiB per call. The128-iteration drain is only an upper bound and exits immediately at zero reclaimable bytes; lowering that bound saves no successful-run work. Each actual pass opens/settles the store and measures before/after usage; incremental vacuum removes individual pages subject to the budget.

A smaller seed is a conditional candidate, **not presently validated**: seed only enough real distinct revisions to leave more than one32KiB pass of reclaimable storage after clear. Retain positive increased reclaimable space, exact first before receipt, each pass's budget bound, eventual zero, smaller final allocation, one new baseline revision and one deletion marker. Require measured pre-compaction reclaimable bytes >32KiB so the revised test cannot collapse to a single-pass case. Because zstd compresses the repeated text strongly, raw body size does not establish this threshold; measure actual database/WAL usage on the same SQLite implementation. Keep current24×512 until that bound is established. A prebuilt store would skip the very write→clear allocation behavior being tested.

## 3. Settled publication storage — keep16 identical +8 abandoned for now

Owner: `tests/publication.rs:1471–1551`; helper `test_support.rs:99–117` calls the actual command and finalizes.

Sixteen saves of the same130,000-byte body must create only one revision; eight prepared but abandoned132,000-byte payloads must not remain live. Compaction then asserts allocated-minus-reclaimable <512KiB, clean-closes, opens another AppState and reconstructs the original body. This is a retention-size oracle, not equivalent to checking that prepared rows are empty. Total attempted authored bytes (~3.1MiB) deliberately dwarf the ceiling.

Fewer iterations or smaller bodies may make leaked copies fit beneath512KiB; retaining the same literal size assertion would silently weaken detection. A rigorous reduction needs a sensitivity argument/mutation experiment for both identical and abandoned paths, separately, plus restart reconstruction. No such evidence currently exists. Identical writes already benefit from lexical signature deduplication where signatures match; this is not the55-distinct-note cold-index problem. Keep this fixture generated live and its present counts. Time identical saves, abandoned preparation and compaction separately if it remains significant.

## 4. Interrupted initialization —64 is volume, not a chunk boundary

Owner: `tests/administration.rs:920–1007`, production `administration.rs:289–499`.

Creates64 small managed Markdown files directly; injects failure in the first sorted note. Initializer continues across all candidates, records durable per-note failure/progress, and produces63 baselines. After dropping the first AppState, the second pass retries the failed identity and visits all64 notes. Final checks assert complete progress/counts and exactly one truthful baseline per identity. The name's “interrupted” refers to an injected failure followed by restart; this is not a forced termination halfway through a batch.

Production iterates sorted candidates and persists progress per candidate; no64-item batching threshold appears on this call path. A three-note fixture (one failed, two succeeding before restart) would retain failure persistence, continued processing, retry completion and multi-identity idempotence, with much less baseline/progress I/O. **Tradeoff:** it removes the explicit64-note volume assertion. Earlier phase asked to preserve64, so treat this as an optional scope decision, not already authorized contract-preserving deletion. If scale remains intended, keep64; no app-data/index bypass recommended. Prebuilt baselines would invalidate the failure/retry test.

## 5. Verification cancellation — concrete oracle gap and smallest useful reduction

Owner: `history_store/verification.rs:205–257`, `history_store.rs:3352–3421`.

Creates one revision plus12 finalized updates, then injects cancellation at the fifth callback during `verify_note_snapshot`. Current verification first invokes that callback once per revision while collecting header lineage; it only starts payload replay after enumerating all13 headers. Thus this test presently cancels at header5, **before any payload is verified**, despite its name. This finding is source-proven and reported to root.

A small faithful redesign can retain the actual writer and verifier: create three revisions; establish their count; permit all three header callbacks plus the first replay callback, then cancel on the second replay callback (fifth overall for the current seam). Preserve typed `HistoryError::Unavailable` and exact callback bound. This reaches between payloads while cutting ten save/finalize operations. Explain the phase in the test so future added header callbacks cannot silently move the injection earlier. Stronger verification can use a tiny explicit phase hook or invalid later payload as an oracle, but avoid enlarging production seams for a test-only optimization. Root should mutation-check that removing replay-loop cancellation makes the test fail; a check-count-only test could otherwise pass by cancelling later in lineage/window verification. Do not merely change12→2 while leaving the semantic meaning undocumented.

## Recommended order

1. Correct and reduce the cancellation fixture, verifying the actual replay cancellation boundary.
2. Use current stage timings to assess storage seed minimization with explicit physical-byte thresholds.
3. Decide explicitly whether64-note initialization is a retained scale obligation; only then reduce its count.
4. Keep long-chain and live-copy-retention fixtures intact without new measurement evidence. Do not disable synchronous durability, share mutable AppState, bypass canonical publication, or reuse prebuilt writer outcomes to gain time.
