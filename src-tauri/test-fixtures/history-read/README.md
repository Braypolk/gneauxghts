# Portable history test fixtures

Four immutable archives replace repeated setup in three history/evidence reader tests. A fifth supplies the precondition immediately before a checkpoint boundary that the test exercises with real live writes. All contain real Markdown notes and a portable NoteTimeline store generated through production save/finalize/clean-close paths. Corruption, recovery, publication and other writer tests continue to construct their histories live.

| Archive | Scenario notes | Total notes | Revisions | Lifecycle events |
| --- | ---: | ---: | ---: | ---: |
| `inventory-sparse.json.zst` | 55 | 56 | 56 | 56 |
| `inventory-dense.json.zst` | 20 | 21 | 21 | 21 |
| `nine-dense.json.zst` | 9 | 10 | 118 | 10 |
| `revision-context.json.zst` | 1 | 1 | 80 | 8 |
| `checkpoint-prefix.json.zst` | 1 | 1 | 127 | 1 |

The inventory archives include the original excluded `Window` note. Dense inventory keeps the original repeated body content across twenty scenario notes; this exceeds the real inventory byte budget and requires a continuation. Sparse inventory still crosses the 50-row budget with 55 scenario notes. Nine-dense keeps twelve finalized edits per scenario note and the original injected Editing Window clock. Revision-context keeps all eighty revisions and seven interleaved renames.

## Regeneration

From the repository root, explicitly run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --offline --lib services::note_timeline::test_fixtures::regenerate_history_read_fixtures -- --exact --ignored --nocapture --test-threads=1
```

This ignored test writes all five archives directly into this directory. Generation is deliberately excluded from normal test runs. After regeneration, run the three consuming reader tests and the checkpoint-chain test, then review the archive changes. Existing fixtures fail clearly when absent, stale or malformed; normal tests never silently rebuild them.

The generator lives in `src-tauri/src/services/note_timeline/tests/fixtures.rs`. It uses real canonical saves, finalization and public clean close, drains/stops projection work, and drops AppState before export. Only Markdown, `.gneauxghts/vault.json` and the checkpointed `.gneauxghts/history.sqlite3` are archived. App-local observations, projections, SQLite sidecars and user data are excluded.

## Format and isolation

Each file is a zstd-compressed JSON object containing recipe/schema versions, scenario kind, expected geometry, scenario note IDs, and a map of allowlisted relative files to bytes and SHA-256 digests. Inventory-dense uses recipe version 2; the other four kinds use version 1. All require history schema 14. Update the generator/recipe and regenerate when the recipe or required schema changes; do not patch stored rows to simulate new writer behavior.

A disposable export copy replaces only `timeline_heads.current_path`, `lifecycle_events.path` and `lifecycle_events.previous_path` with paths beneath `/gneauxghts-history-read-fixture`. Synthetic paths use slash separators across platforms. SQLite compaction removes obsolete path bytes before export. Identities, Markdown, payloads, hashes, times, provenance and lineage remain the production-generated values. Fresh regeneration can therefore produce different IDs/timestamps and archive bytes while preserving the recipe.

The loader validates versions, file names, digests, settled-state constraints and exact geometry. It restores bytes into a fresh TestVault before AppState construction, rebases the same path columns only in that writable copy, closes SQLite handles, then runs production catalog prewarming and the existing batch lexical synchronizer. A foreground guard defers queued projections until the batch completes; the loader releases it and drains the real queue before returning, preserving task and generation bookkeeping without committing the lexical index once per note. The checked-in archive is never opened as a writable database. The loader returns only scenario IDs, excluding Window. Existing reader assertions still validate query budgets, paging, detail content and scope behavior.

## Checkpoint-boundary precondition

`checkpoint-prefix` contains a root checkpoint and 126 consecutive deltas. Generator and loader assert that exact policy layout and reconstruct the first/last prefix states. A fixed-size body with a three-digit revision marker and stable context keeps ordinary deltas small; the generator does not edit policy fields, disable durability, or synthesize revisions.

`adaptive_checkpoints_are_transparent_across_a_long_revision_chain` then performs thirteen real editor publications at indices 127–139. It requires a delta at 127, a checkpoint at 128, then deltas 129–139, preserving 140 total revisions. The old runtime is cleanly closed and its projection worker joined before a new AppState reconstructs states 0/127/128/129/139. Starting live writes at 127 is intentional: seeding through 127 would hide an incorrectly lowered checkpoint threshold.

This fixture does not contain the target checkpoint 128. It avoids rebuilding unrelated earlier history on each run while testing the policy transition with the current writer. Generation still constructs the full prefix through production writers; loader validation rejects stale/malformed layout rather than manufacturing a passing state. Existing small-chain ratio-checkpoint and corruption tests retain their live inputs. Any recipe change must preserve both sides of the live boundary and be validated against prematurely lowered and missing checkpoint policy mutations.
