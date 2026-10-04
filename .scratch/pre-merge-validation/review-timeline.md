# Integrated timeline, evidence, and catalog review

Status: complete — no actionable findings identified in the reviewed scope.

## Baseline and method

Reviewed the accumulated working-tree changes against `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`, including untracked Rust modules and fixture support, rather than only the last performance patch. This is a static Standards and Spec review, not a test execution report. No source edits, builds, tests, or artifact regeneration were performed. Existing review reports supplied navigation and deletion maps; conclusions below were checked against current source and baseline diffs.

Read the code-review skill, pre-merge spec, audit-remediation spec, architecture-simplification spec, ARCHITECTURE, applicable behavior invariants, Editing Window capture contract, and ADRs 0002–0009. Reviewed changed production paths in NoteTimeline publication/domain/history mode/observation/lifecycle/runtime/history store, evidence search/read/inventory, note catalog, retrieval, task mutation/projection, and the persistence/proposal callers that cross the new owner. Inspected the new codec, selected-context tests, fixture generator/loader, and their module declarations. Reviewed meaningful changed hunks throughout this scope; sampled unchanged neighboring implementation and retained test bodies rather than claiming every line of the entire test suite was reread.

## Standards assessment

No actionable standards finding.

- `note_timeline/publication.rs:83` now owns complete authored publication admission. Target readiness and replay work occur before acquiring file mutation ownership, then identity/path/pending-replay conditions are checked again under ownership. The operation lifetime covers authoritative read, transform, durable preparation, write, and finalization. Prepared publication types no longer expose an independent production caller protocol; remaining direct preparation entry points are private/test-only.
- Task changes and accepted proposals use this owner instead of maintaining separate write/finalize sequences. The task transform reads authoritative content inside admission (`publication.rs:231`), while proposal base-hash validation remains in that same protected transform. Restore uses the same lifetime without losing selected revision/origin checks.
- `history_store/codec.rs` separates private byte encoding and delta mechanics without introducing a second transaction owner or changing the retained storage format. Schema binding and SQLite publication transaction ownership remain in the store.
- Catalog retry work uses a pending-path set independently of retained generation watermarks (`note_catalog.rs:126,197`). The per-path generation lock spans applying/registering retry state; stale jobs cannot erase newer pending work. Retry snapshots drop the pending-map lock before taking path locks. Retaining settled watermarks remains necessary to reject late older jobs.
- Test-only policy/free-page helpers and fixture code remain behind test compilation. The physical fixture module is in a tests directory, preserving architecture scanner treatment without weakening production ownership rules.

## Spec and correctness assessment

No actionable correctness or missing-contract finding.

1. **Publication consistency and failures.** `publish_authored` (`publication.rs:304`) prepares before writing, treats known failure/conflict as abandonment, and preserves recovery evidence when rename rollback is indeterminate. Committed bytes use warning results instead of inviting a second write. Existing atomic publication is reused; `atomic_create_note` (`state/persistence.rs:484`) publishes a fully written adjacent temporary file with a no-replace hard link. Creation validates parent scope and checks leaf occupancy, so outward/dangling symlinks remain conflicts, and the atomic operation still handles late occupancy races.
2. **Recovery and close.** Runtime recovery mutex ordering remains the shared production owner. Typed observation errors now retain classification through contextual wrapping. Startup recovery and released capture recovery do not discard pending evidence after retryable failure. The real recovery-lock regression covers both reader-first and writer-first contention; clean-close coverage blocks a real admitted save rather than depending on a removed token-owned lease.
3. **Evidence freshness.** Canonical snapshots are operation-local and share parsed bytes only within one operation. They do not replace delivery eligibility/proof checks. Search continuations still validate retained candidates, direct reads validate current canonical state, and inventory pagination retains one search/grouping while revalidating delivered rows and respecting the shared response budget. The snapshot regression explicitly changes canonical content between operations. The compatibility picker now pages passages to produce distinct allowed notes, while retaining its outer CurrentContent mutation-generation delivery gate and metadata-date filtering.
4. **Scope and corruption.** No schema migration/fallback was introduced. Restore, observation, scoped verification, and current-content evidence continue through typed history errors and the runtime corruption gate. The bound-context tests deliberately reuse identity/path in a second vault, so original-vault confinement is not inferred from unique fixture IDs. Private raw tokens remain used by durability tests to exercise malformed, stale, and interrupted states; public ownership simplification did not delete those boundaries.

## Cumulative test/fixture coverage check

The reductions have explicit surviving owners; they do not substitute prebuilt state for the failure or writer action under test.

| Reduced/reused setup | Retained independent behavior owner |
| --- | --- |
| Constructor/getter/receipt echo and fabricated warning/error tests | Durable mutation-source contract, real unreadable authoritative Markdown and warning aggregation, actual scoped command failures and serialization/redaction |
| Generic fabricated task delivery result | Retained `retrieval_scope_and_clear_invalidation_are_applied_at_delivery`; actual task transform reads changed authoritative content after admission |
| Repeated inventory/context history generation | Real production-generated immutable archives; ordinary tests still execute paging, byte limits, exclusion, provenance/context reconstruction, and freshness assertions |
| 140 tiny-body checkpoint writes | Prefix contains only root checkpoint plus deltas 1–126; 13 live prepare/write/mutate/finalize operations assert delta 127, checkpoint 128, and subsequent deltas, then clean close/join/reopen and reconstruct 0/127/128/129/139 |
| Larger reclamation seed | Four live finalized saves still produce more than one 32 KiB pass of real free pages; logical deletion, bounded physical work, eventual shrink, baseline/deletion marker assertions remain |
| Large cancellation history | Three real revisions with a deliberately corrupt later payload distinguish uncancelled Corrupt from cancellation during replay returning Unavailable |
| Higher receipt volume | Exact retention boundary assertions around 63/64/65/66 plus protected receipt/restart behavior remain; adaptive ratio checkpoint coverage also remains independently of the replay-count fixture |

Publication tests retain preparation failure, failed write/abandonment, committed-warning recovery, authoritative-read failure, retained identity conflict, source routing, in-flight recovery serialization, exact restore lineage, no-overwrite creation, and restart reconstruction. Observation/lifecycle tests retain external edits, rename, missing/reattachment, interruption, and newer external bytes after pending capture. The selected-context module is wired into the test tree, not an orphan extraction.

`tests/fixtures.rs` validates kind/recipe/schema, per-file digests, file allowlist, identities/counts, settled/portable metadata, and absence of unresolved records before runtime admission. Only cloned canonical Markdown, manifest, and history main database are restored. Path relocation edits known settled path columns, normalizes archive separators, and closes/checkpoints the disposable database before admission. The generator uses production saves/finalization and clean close; it neither synthesizes history rows nor lowers durability/policy settings. Catalog preparation uses normal prewarm/projection work. The checkpoint archive establishes a precondition only; checkpoint 128 is not baked into the fixture.

## Integration requirements and limits

The clean candidate must include the currently untracked `history_store/codec.rs`, `editing_window_capture/tests/selected_context.rs`, `tests/fixtures.rs`, fixture README, and all five `history-read/*.json.zst` archives. Their inclusion is part of the reviewed implementation, not optional test data.

This review does not independently prove platform filesystem semantics or runtime scheduling: root owns clean compilation, full-suite execution, native acceptance, and mutation/timing evidence. I inspected loader/generator validation and consumer oracles, but did not regenerate or independently decompress all archive payloads in this pass. The ignored release-scale/native responsiveness gates remain separate from default unit coverage. No broad claim of exhaustive test-body coverage or independent performance measurement is made.
