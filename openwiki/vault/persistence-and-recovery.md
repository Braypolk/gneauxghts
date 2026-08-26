---
type: storage architecture
title: Vault persistence and recovery
description: Canonical Markdown vault data, portable sidecar stores, filesystem mutations, watcher behavior, and bounded integrity guarantees.
tags: [vault, persistence, filesystem, integrity]
---
# Vault persistence and recovery

The active vault root is the notes root. Ordinary notes are recursive `.md` files with managed frontmatter carrying stable identity, timestamps, document kind, and some chat projection fields (`src-tauri/src/note.rs`). Markdown remains canonical content; databases and indexes support state and retrieval.

```text
<vault>/
  ordinary-note.md
  assets/
  .forgotten/
  .gneauxghts/
    vault.json
    app-state.sqlite3
    semantic.sqlite3
    ai.sqlite3
    cache/
```

`state/config.rs` is the sole vault-path abstraction. `ensure_vault_scaffold` creates `.gneauxghts`, cache, `cache/lexical`, `cache/graph`, and a versioned `vault.json`. The manifest preserves opaque `vault_id` and creation time while updating app/schema version and last-touch time. It is portable with the vault. `set_vault_directory` scaffolds a selected vault but requires restart: globals, database handles, and watcher bind during startup.

## Stores, ownership, and lifecycle

| Store | Owner | Canonical/rebuildable boundary |
| --- | --- | --- |
| Markdown + managed frontmatter | `note.rs`, `state/persistence.rs` | canonical note bytes |
| `app-state.sqlite3` | `state/persistence.rs`, task projection | portable UI/session/recents, presentation state, forgotten metadata, derived task rows |
| `semantic.sqlite3` + cache | `semantic/db.rs`, `semantic/*` | DB semantic rows authoritative for semantic layer; HNSW/atlas generations disposable accelerators |
| `ai.sqlite3` | `chat.rs` | portable conversations, policies, runs, attachments, sources, proposals; not provider credentials |
| keyring | `secrets.rs` | machine-local provider keys, outside vault |

`app-state.sqlite3` schema includes singleton session, ordered recents/note order, hidden/collapsed sets, forgotten metadata, activity, and task projection. Full writes use SQLite transactions; note switches use a narrow transaction for last-opened/recents. Semantic and chat schema initialization/migrations are owned by their subsystems, documented in [search and atlas](../search/semantic-and-atlas.md) and [thought partner](../ai/thought-partner.md).

## Save and rename path

`save_note` → `commands/note_persistence.rs::persist_note_session_with_outcome` validates a current path under vault and outside `.forgotten`, serializes file mutations, normalizes escaped wikilinks, rejects managed chat projections, preserves/generates managed identity, derives a sanitized filename (stem capped at 80 chars with collision suffixes), and keeps the existing parent folder. `state/persistence.rs` atomically publishes note content by writing a same-directory temporary file, `sync_all`, then rename.

After bytes exist, `PostCommitNoteMutationService::apply_canonical_file` rereads the committed file (using a catalog snapshot only as a degraded fallback) and then `apply_committed_mutation` updates catalog/projection, queues semantic update/move, increments revision, and emits events. Canonical reread, catalog, task, semantic, or previous-path removal failures mark the affected path dirty for later reconciliation; they do not replace canonical bytes or blindly retry the user save. A required post-commit projection failure returns saved authoritative data with `commitWarning`, so callers distinguish committed Markdown from degraded derived state. The file write and all SQLite/index/event work are not a single cross-store transaction. Focused tests include `required_and_derived_failures_remain_distinguishable_after_commit`, canonical-read failure with fallback snapshot, and committed projection failure.

## Forget, restore, assets, and watcher

`forget_note` only accepts normal vault paths and retention 1, 7, or 30 days. It moves a prepared Markdown file to collision-safe `.forgotten`, clears session/recents, adds forgotten metadata, removes catalog entry, and queues semantic deletion. Restore validates `.forgotten` containment, chooses original or unique root-level path, clears trash timestamp, rewrites, upserts catalog, reindexes, then removes forgotten metadata. Permanent delete and startup expiry cleanup remove selected/expired items.

Pasted image IPC (`commands/asset_commands.rs`) owns image storage/read seam; image embedding code is frontend-side under `features/notepad/images`.

`vault_watcher.rs` recursively watches Markdown creates, data/rename/other content modifications, and removes; it filters `.forgotten` and metadata-only events. Create/update paths reparse/reindex ordinary eligible Markdown; a genuine delete removes indexed state; chat projection changes take a separate projection-conflict path. An unreadable/in-flight file is treated as not ready rather than deleted, so a later watcher event or reconciliation can retry. Semantic-ineligible Markdown does not enter semantic work. A 300ms quiet debounce, capped at 2s continuous activity, batches updates. App persistence registers expected final content hash and expected old-path absence around writes/renames; suppression lasts 2.5s only when observed outcome matches, so a racing external write/recreation is processed. Hash pairing recognizes identical-content remove/present pairs as a semantic move rather than delete plus re-embedding. Dirty post-commit paths are drained by watcher/index reconciliation: `flush_dirty_batch` debounces and batches events, `IndexState::apply_dirty_paths` and `collect_dirty_updates` compare current filesystem signatures and skip unchanged inputs, then rebuild catalog/task/index projections from current disk bytes. This repairs recoverable derived state without rewriting the source file; canonical-read failures remain visibly degraded until a later successful read. A detached reconciliation rescan starts around 15s under activity and backs off toward 300s; errors are logged/contained off foreground request paths and a later cadence retries missed OS events.

At startup `lib.rs` scaffolds before DB/cache access, initializes semantic then `AppState`/`ChatService`, reconciles chat recall, and only afterward spawns watcher mount, expired-forgotten cleanup and lightweight notes-index prewarm. Each background task logs its own failure rather than failing initial window setup. On iPhone builds semantic state is disabled with an explicit reason; desktop creates the local runtime-backed semantic state. Vault selection/startup configuration is platform-aware in `state/config.rs`.

## Integrity claims and limits

Supported: path traversal rejection for ordinary current paths; stable ID supports external rename lookup; atomic replacement plus file `sync_all`; canonical-first commit warnings; watcher does not silently overwrite dirty frontend edits because [document workspace](../notepad/document-workspace.md) conflicts suspend autosave.

Not established: encryption at rest (stores are plaintext Markdown/JSON/SQLite); parent-directory fsync or power-loss durability of rename; cross-store atomicity; rollback after forget/restore rename followed by later failure; symlink-safe containment (observed checks are lexical `starts_with`); real watcher integration through OS events. Do not promote these as guarantees.

## Tests and validation

Focused Rust evidence includes `commands.rs` session/path and external-rename resolution tests; `commands/note_persistence.rs::committed_projection_failure_still_returns_authoritative_new_note_path`; `services/note_mutation.rs::required_and_derived_failures_remain_distinguishable_after_commit` and move handling tests; `vault_watcher.rs` metadata filtering, lifecycle classification, expected-save suppression/racing rewrite, and adaptive interval tests; `state/task_projection.rs` stable IDs; and `services/task_mutation.rs` mutation tests. Not observed: real ordinary forget→restore E2E, crash-injection around moves, directory fsync, symlink containment, and end-to-end watcher reconciliation. Run `cargo test --manifest-path src-tauri/Cargo.toml`; for UI save/conflicts use relevant `pnpm test` document suites.