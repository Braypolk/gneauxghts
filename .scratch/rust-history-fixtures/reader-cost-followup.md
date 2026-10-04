# Remaining reader cost: catalog and inventory validation

Status: ready-for-agent
Progress: Read-only follow-up complete. No builds, tests, source edits or timing runs by this reviewer. Root owns measurements and any experiment.

The measured three-reader change (21.52s original → 18.35s initial fixture run) does not yet identify the residual cost. Two confirmed code paths merit separate timing; neither justifies removing assertions or freshness checks.

## Cold catalog preparation

`index.rs:379–417` cold `ensure_interactive_index` calls the synchronous full refresh. `index.rs:533–551` collects all mutations but `note_catalog.rs:241–261` applies them individually. Each new note reaches `lexical.rs:143–160` `upsert_note`, which invokes a Tantivy writer commit and reader reload (`lexical.rs:452–454`). Thus each inventory fixture builds 56 lexical commits, plus 56 task reconciliation attempts, despite `apply_batch` terminology. AppState construction (`index.rs:170–207`) itself constructs an empty catalog, fresh RAM lexical index, runtime/storage and worker; it does not populate that catalog.

`prewarm_notes_index` (`index.rs:694–731`) is a real production cold-start path, but simply replacing ensure with prewarm and draining still executes the same per-note projection work via `background_index_queue.rs:275–286`. Skipping the drain would shift work beyond setup and could discard it at teardown, not demonstrate equivalent preparation.

If root's catalog timing proves dominant, a bounded **fixture-only** experiment can use existing APIs: acquire foreground guard; prewarm the ordinary catalog; run `lexical.sync_with_notes_index` against its entries; release the catalog lock and foreground guard; drain queued projection work. The existing synchronizer (`lexical.rs:79–140`, documented for tests/emergency reconciliation) builds all entries and commits once. Queued jobs still run through the projection coordinator and reconcile tasks; lexical signatures then match, so individual upserts return without another commit. This preserves final projection readiness without new production APIs, synthetic indexed data, or omitted work. Keep only if measured gain is material and all original reader assertions pass. Do not interpret this as a proposed production scheduler rewrite.

## Inventory's intentional repeated proof work

The expensive budget test has one retained search per sparse/dense scenario, not a fresh search on every page (`query_inventory.rs:156–160` asserts this). Each continuation calls `search_inner`, computes the scoped fingerprint, and validates every retained candidate (`evidence.rs:354–399`). The inventory then validates each row it is about to deliver (`inventory.rs:258`), and the test's `is_current` assertion validates all admitted citations plus scope fingerprint (`evidence.rs:1115–1149`). Denied-scope continuation checks and history-clear invalidation are additional distinct oracles. They should remain unchanged.

`validate_citation` (`evidence.rs:1425–1505`) performs canonical reads/hash/range validation, CurrentContent eligibility and revision-proof validation, and a final canonical reread. `fingerprint` is comparatively modest metadata/catalog work (`evidence.rs:211–235`), not a full body replay. Dense bodies can amplify canonical parsing and retained proof checks across pages. The initial search already shares canonical snapshots within its operation (`CanonicalSnapshot`, `snapshot_for`); another cross-page cache would require fresh correctness work around edits, history clearing and scope changes. That is outside this fixture optimization, and no safe test-only omission is proposed.

Useful root timing split: archive decode; file extraction/rebase/validation; AppState construction; catalog+drain; first inventory page; subsequent inventory pages; explicit is_current calls; teardown. A catalog-only batch preparation experiment can be assessed independently of query costs. If query verification dominates, preserve it and report the smaller fixture gain rather than weakening the suite.
