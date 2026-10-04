# Checkpoint-chain audit and measurement plan

Status: ready-for-agent
Progress: Audit/measurement plan ready for coordinator approval; no source edits, builds or runs by this investigator.

## Present contract and unresolved coverage

`note_timeline/tests/publication.rs::adaptive_checkpoints_are_transparent_across_a_long_revision_chain` builds140 actual prepare/write/mutate/finalize operations, creates a second AppState, asserts140 revisions, then reconstructs0/127/139. It does not assert a checkpoint payload or replay count. `append_revision` in `history_store.rs` checkpoints for missing base,128 replay revisions,256KiB accumulated deltas, delta/full ratio0.65, or measured replay≥50ms. These are OR conditions, so total140 is not evidence of crossing the128 replay threshold. Tiny changing payloads (including the encoded body's changing length header) may cause early ratio checkpoints. Actual generated rows must decide this; do not claim it from intuition.

The test presently exercises broader coordination than its title: per-note readiness and identity/baseline preparation, durable intent capture, actual canonical bytes, history finalization/release, post-publication projections, Editing Window finalization, and subsequent AppState/history reconstruction. The earlier foreground guard experiment was rejected after noisy focused timings and negligible suite gain. Do not repeat it without new evidence.

## Proposed temporary instrumentation (approval required)

Touch only this test in `tests/publication.rs`, and a narrow `#[cfg(test)]` private helper in `history_store.rs` if needed to expose read-only policy rows through its existing bound store. The helper returns each revision's identity, base identity, payload kind, replay_count, accumulated_delta_bytes and stored payload length. It performs one SELECT after the seed and closes its connection; no physical policy changes or fabricated writes. Join rows to the existing ordered Revision list after restart to label checkpoint positions by0-based index. No schema, token or production interface change.

Record with `Instant`, without changing loop/control flow:

- Fixture/AppState construction.
- Per-iteration prepare, canonical `fs::write`, mutate, finalize durations; aggregate totals/max and optionally chunks0–19/20–39/etc to expose chain growth.
- Existing `begin_append_measurement` before seed and `take_append_measurement` after it, aggregating base_reconstruction, delta_encoding, verify_and_compress and any other returned stages. Preserve the existing helper implementation.
- Second AppState construction, revision listing, each of the three reconstructions, and total test wall time.
- After-seed policy query time separately. Print checkpoint indices, max replay_count and accumulated bytes, plus checkpoint/delta counts. No per-save println while timing the loop.

Use a distinctive `checkpoint-probe` prefix and emit one bounded structured summary. Default execution is already root-selected; this is temporary instrumentation, not a new permanent environment toggle or ignored benchmark. Root runs the exact existing filter serially and supplies output. Remove all temporary code after final design evidence, preserving any pre-existing append instrumentation owned by root.

## How results choose the actual redesign

1. **If current fixture never reaches replay128:** correct its oracle before claiming a threshold optimization. A fixed-size body with substantial unchanged context and a small fixed-width revision marker is a candidate. It can keep delta/full ratio well below0.65 and accumulated deltas below256KiB while still changing actual authored bytes on every write. Use129 or130 real revisions only if evidence demonstrates root checkpoint0, deltas through127, checkpoint128 and at least one delta afterward; retain reconstruction immediately before/at/after the checkpoint and true reopen. This is an explicit strengthened threshold design, not silently dropping a140-volume promise. Assert payload geometry and counts; do not disable adaptive timing or lower policy constants. Extremely slow hosts may trigger the measured-time policy; consider that legitimate variability when choosing an oracle rather than falsely labelling it corruption.
2. **If the writer already crosses128 and base reconstruction dominates:** keep the integration workload initially. Timing may point to repeated real verification, but no production shortcut is authorized by this audit. Any reuse needs a separate proof of hash/base/version validity within the same admitted publication.
3. **If app projection/window overhead dominates:** consider moving this one policy-focused scenario to the private storage writer owner, still using real `prepare_publication`/canonical write/`finalize_publication`/receipt release, real commits and an actual reopened Store. Ordinary Editor updates require Editing Window admission; replacing them with `TaskAction` would change the integration case and must be explicit. Existing typed mutation, publication/window and restart tests own that integration, but a concrete surviving-owner mapping is required before migration. Direct calls to `append_revision` with handcrafted SQL records are not acceptable fixture substitutes. Do not skip finalization or durability to improve time.
4. **If unchanged long-chain policy/coordination itself is the measured cost:** retain it and state no safe speedup. Reader fixtures cannot substitute for proving writer checkpoint selection.

Measurement first; a smaller payload or fewer writes is not automatically faster. The current serial observation (~11s) also differed substantially from earlier fresh-process focused timings (~2.46s), so compare the same invocation and distinguish suite context from intrinsic work.

## Approved probe implementation

Coordinator approved the temporary probe. Added stage timings to the unchanged140-write test and one cfg(test) private policy-row reader `remaining_probe_checkpoint_policy`. The summary uses `REMAINING_PROBE`, includes20-revision stage chunks and existing append measurements, and queries policy only after the seed. For the parallel storage investigation, added requested cfg(test) `free_page_geometry_for_test` returning page size/freelist count; the storage owner instruments its own test. Files formatted; scoped diff check passed; source frozen for root compilation. No tests/builds run here.

## Prebuilt precondition alternative (not implemented)

A generated prefix can seed a **precondition** while keeping the actual checkpoint transition live, but the exact boundary matters. Root proposed128 prepared revisions (checkpoint0 +127 consecutive deltas), followed by12 real writes to reach140. That verifies a checkpoint at live index128 and subsequent deltas, but fails to detect an erroneously lowered threshold: a policy threshold64 would still checkpoint the first live replay128, so every asserted live row could pass. The archive would mask the changed policy in its unexecuted prefix.

Recommend instead **127 prepared revisions (checkpoint0 +126 consecutive deltas), followed by13 live writes at indices127–139**. The default test must assert:

- Restored precondition has127 revisions, exactly one checkpoint at0, and deltas with replay_count equal to each index1–126. Validate identities, canonical end bytes, schema, hashes and ancestry normally.
- The first live append127 remains a delta with replay_count127;128 becomes a checkpoint with replay_count0;129–139 are deltas with counts1–11. This catches both prematurely lowered and late/missing replay thresholds without changing production constants.
- Every live operation uses the existing real prepare/canonical-write/mutate/finalize path, with no warning accepted. Complete140 history and reopen/reconstruct0/127/139 still hold; additionally reconstruct128 to cover the checkpoint boundary itself.

The original tiny/growing bodies cannot simply be archived while demanding126 consecutive deltas if measurement shows ratio checkpoints. A fixed-size, stable-context body with a small fixed-width revision marker would need a production-generated prefix and corresponding literal expected bodies for all reader indices. This is a deliberate stronger writer-policy fixture, not identical old bytes. Keep accumulated deltas comfortably below256KiB and delta/full ratio below0.65, and inspect stored geometry from the explicit generator. Do not force policy fields or edit payloads in SQL. Extremely slow-host measured-time checkpointing is still a legitimate competing branch; choose modest body size and record that risk rather than disabling it.

The existing portable archive machinery can restore one-note data safely, but it is currently explicitly scoped/documented for reader fixtures. Extending it must name this narrow checkpoint **precondition** use, bump recipe/geometry appropriately, and keep a separate explicit production generator branch. Loading must not silently rebuild or mark a corrupted prefix as current. Catalog load still runs normally; actual first live publication verifies/reconstructs its persisted base. The immutable archive contains no already-passing target checkpoint128.

Benefits and limits: default work falls from140 to13 live writes, retaining all total-history reconstruction and live threshold boundary behavior. It no longer proves that the current writer builds the earlier126 deltas on every run; the strict precondition is generated/validated offline, while existing publication/codec/lineage tests retain ordinary writer behavior. This coverage tradeoff must be accepted explicitly. At least mutations removing the replay threshold and lowering it to127 should fail the live boundary assertions. Real restart, corruption and receipt suites remain generated live. Measure restore+validation+catalog+13writes+reopen end-to-end, not only the reduced loop. Do not implement until baseline policy/timing evidence and coordinator review agree.

## Measured result and approved implementation decision

Root's `probe-before.log` records83 checkpoints at indices0–82 followed by57 deltas (maximum replay_count57). The old fixture does **not** cross128. Fresh-process total2274ms comprised prepare594ms, mutate719ms, finalize895ms; measured append internals total only30ms. Thus reducing compression/delta arithmetic would miss the actual setup cost. The full serial ~11s remains context-dependent and is not the fresh fixture latency.

Coordinator approved the127-seed +13-real-write design. Add one `CheckpointPrefix` archive with a fixed-size body helper and production-generated states0–126. Both generator and restored fixture must assert exact root checkpoint and delta replay counts1–126. Live test appends127–139 through the existing editor publication/finalization path; asserts127delta,128checkpoint,129–139delta; retains140total, real new AppState, reconstructed states0/127/139 and adds128/129. Keep all durability and actual current-policy decisions intact. The existing `history_store::tests::comparison_rejects_a_checkpoint_with_disconnected_lineage` already creates two real publications with2048 repeated 'a'/'b' bytes and asserts the second is a checkpoint before corrupting ancestry, retaining live small-chain ratio-triggered checkpoint coverage. No additional test needed for the discarded83 incidental checkpoints.

Retain a small cfg(test) policy reader exposing only revision ID, kind and replay count; remove temporary checkpoint timing/layout code. Preserve the storage agent's free-page helper and root-owned append instrumentation. Extend archive documentation to distinguish reader snapshots from the narrow writer precondition. Keep all four existing archive bytes/kinds/recipes unchanged initially, including dense55; root separately approves any dense geometry change. Generator must run explicitly to create the new prefix archive before executing the adapted test. Root owns generation, mutation checks, builds, timings and integration.
