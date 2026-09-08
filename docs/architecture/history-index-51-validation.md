# Unused history index removal — issue 51

Issue 51 removes only `prepared_intents_by_target` from schema-13 history
stores. Fresh stores no longer create it; existing stores drop it after format,
vault identity, generation, store-instance, clean-close watermark and app-local
observation admission. The pending-intent partial index, citation successor
indexes and all other indexes remain. No history records or payloads are deleted.

The admission regression also reproduced an existing header mutation: opening a
current-schema database using DELETE journaling changed its header to WAL before
rejecting a mismatched observed store instance. The journal-mode change now waits
until observation admission. The failing and passing checks are recorded below.
Connection-only foreign-key, synchronization and busy-timeout settings remain
before schema initialization. There is no new startup repack operation.

## Query access audit

Audited SQL in `history_store.rs` and `history_store/editing_windows.rs`, including
finalization, preparation, recovery, health, receipt retirement, clear and purge.
No production predicate seeks by `target_path`, or by the old index prefix
`(target_path, source, result_hash, status)`. Path/hash/source columns still carry
required recovery evidence; removing an index does not remove those columns.

| Operation | Current access path, with or without removed index |
| --- | --- |
| Exact finalization / token lookup | `sqlite_autoindex_prepared_intents_1` on `intent_id` |
| Per-note unresolved-intent guard | `prepared_intents_pending_by_note` seek on `note_id` |
| Pending recovery | Scan only the pending partial index; receipt lookup by intent; temporary ordering B-tree |
| Pending health count | Covering scan of `prepared_intents_pending_by_note` |
| Terminal receipt retirement | Receipt `(note_id, sequence)` index; exact intent and referenced-record indexes |
| Whole-note preparation deletion | Existing table scan by note plus indexed foreign-key references; unchanged |

The six recorded `EXPLAIN QUERY PLAN` comparisons include foreign-key checks for
the DELETE statement. For each old master, a separate phase on its disposable
copy adds the current derived indexes and compares plans with/without the target
index. All six current-access-path plans are identical after removal.

The sealed 10k master predates the pending partial index. A literal DROP-only
experiment on that old schema changes its pending-health count from a full
covering scan of the target index to a table scan. The current pending index
supersedes that path. The 100k master already has the pending index; its six
original plans are unchanged. Both masters predate issue 50's successor indexes.
Adding current indexes is outside the allocation measurements below, so their
costs cannot be confused with issue 51's savings.

## Old-format allocation baseline

Measured 2026-09-06 with Python SQLite 3.51.0. Full fixture seals match before and
after; masters have zero/absent WAL, schema 13, matching identity and a portable
clean-close state. All master database reads use `mode=ro&immutable=1` after seal
and WAL checks. No app process is launched. Database-only byte-for-byte copies
live in script-owned temporary directories and are removed on completion.

The [raw measurements](history-index-51-measurements.json) contain every table and
index's allocated pages, B-tree payload bytes and unused bytes inside its pages,
plus page size/count, freelist, file size, identities, seals and query plans.
Values below are bytes; they describe the old issue-49 fixtures, not a new-format
acceptance result.

| Baseline metric | 10k revisions / 1 note | 100k revisions / 901 notes |
| --- | ---: | ---: |
| Main database file | 61,923,328 | 607,735,808 |
| Allocated table pages, including schema | 39,350,272 | 385,314,816 |
| Allocated index pages | 22,429,696 | 221,614,080 |
| All B-tree payload bytes | 34,913,111 | 481,420,952 |
| Unused bytes **inside allocated B-tree pages** | 25,918,190 | 112,908,359 |
| Freelist bytes (16 × 4096-byte pages) | 65,536 | 65,536 |
| Other allocated pages, outside B-trees/freelist | 77,824 | 741,376 |
| Compressed revision payload column | 537,459 | 5,381,259 |
| Prepared/terminal authored payload column | 0 | 0 |
| Prepared intent rows | 10,064 | 157,664 |
| Average full intent token bytes | 170.45 | 168.70 |
| Removed index allocated pages | 2,486,272 | 39,432,192 |

B-tree payload includes SQLite row/index representations, not just authored
revision bytes. Allocated B-tree pages also contain headers, cell pointers and
other overhead. In-page unused space is not the freelist and is not promised
reclaimable space. Other allocated pages account for database structures outside
`dbstat` B-trees (including incremental-vacuum pointer maps).

| Large 100k table | Allocation | B-tree payload | In-page unused |
| --- | ---: | ---: | ---: |
| `prepared_intents` | 136,265,728 | 93,740,072 | 40,867,888 |
| `window_publications` | 90,640,384 | 69,854,344 | 19,322,883 |
| `publication_receipts` | 73,990,144 | 54,292,510 | 18,296,893 |
| `revisions` | 54,722,560 | 50,375,025 | 3,439,335 |

## Controlled DROP and repack results

| Operation / measurement | 10k | 100k |
| --- | ---: | ---: |
| DROP + checkpoint: main file bytes | 61,923,328 | 607,735,808 |
| DROP + checkpoint: freelist bytes | 2,551,808 | 39,497,728 |
| DROP + checkpoint: allocated index bytes | 19,943,424 | 182,181,888 |
| DROP + checkpoint elapsed, one sample | 2.43 ms | 17.79 ms |
| Subsequent VACUUM + checkpoint: main file bytes | 36,175,872 | 485,175,296 |
| Subsequent VACUUM + checkpoint: freelist bytes | 0 | 0 |
| Subsequent VACUUM + checkpoint: in-page unused bytes | 2,462,886 | 24,218,920 |
| VACUUM + checkpoint elapsed, one sample | 110.48 ms | 3,234.47 ms |

DROP makes precisely the removed index's allocated pages available to SQLite
for reuse; it does not immediately shrink either database file. Full VACUUM on
the owned copies also consolidates unrelated table/index pages. Its total
25,747,456-byte / 122,560,512-byte reductions therefore are **not** index-only
savings or promised normal-startup behavior. Compressed revision payload totals
remain identical. Each copy passes full SQLite integrity and foreign-key checks
after the measured operations. Timings are single samples with warm OS caches,
not startup latency or production performance acceptance.

## Reproduction and validation

Run from the repository root; output must be a new path outside either master:

```sh
python3 scripts/history_index_baseline.py \
  --master /tmp/gneauxghts-current-scale-v1-10k-issue49 \
  --master /tmp/gneauxghts-current-scale-v1-100k-issue49 \
  --repack --output /tmp/issue51-allocation-reproduction.json
```

- `cargo test --manifest-path src-tauri/Cargo.toml --lib history_store::tests:: -- --nocapture`: 11 passed. Initial WAL-mode rejection coverage; log `/tmp/issue51-history-store-tests.log`.
- Red regression: `cargo test --manifest-path src-tauri/Cargo.toml --lib rejected_store_preserves_unused_index_and_durable_bytes -- --nocapture` failed on the observed-instance case after strengthening its fixture to DELETE journaling. The main-file bytes differed before index maintenance. Log `/tmp/issue51-rejection-delete-before.log`.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib services::note_timeline:: -- --nocapture`: 198 passed, 8 explicitly ignored scale/benchmark tests. Final log `/tmp/issue51-timeline-final-tests.log`. Covers fresh/current index cleanup, all 11 rejection cases, mandatory preparation, exact finalization, pending/orphan admission, interrupted publication/window/observation/deletion recovery, clear/reset/purge, history reconstruction, restoration and citation behavior.
- `cargo test --manifest-path src-tauri/Cargo.toml --test architecture_fitness -- --nocapture`: 16 passed; final log `/tmp/issue51-architecture-final-tests.log`.
- Allocation run: `/tmp/issue51-allocation-final.log`. An initial run stopped after discovering the 10k old-only covering-scan difference; preserved as `/tmp/issue51-allocation.log`. The successful run records this difference and separates the current derived-index comparison.

The two new storage tests ensure fresh stores omit the index, admitted old
current stores lose only that index, reopening is idempotent, and rejected
schema/metadata/vault/format/generation/instance/observation/watermark/live-copy
cases preserve main-file and observation bytes with no retained WAL. Historical
issue-49/50 masters and reports are unchanged. No native/UI claim, fresh 100k
generation, schema redesign, background verification policy change or user
database reset is part of issue 51.
