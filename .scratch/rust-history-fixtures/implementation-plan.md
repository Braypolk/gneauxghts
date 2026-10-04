# Immutable reader fixture implementation

Status: ready-for-agent
Progress: Loader/generator and TestVault initializer implemented and frozen for coordinator compilation. Coordinator owns generation, runtime fixes, measurements and consumers; README completed. Validation results pending.
Owner: audit_timeline

## Exact source scope

- New `src-tauri/src/services/note_timeline/tests/fixtures.rs`, declared only under `cfg(test)` in `note_timeline.rs`.
- Small `TestVault::with_notes(label, initializer)` constructor; existing `new` delegates with no-op initialization. Initializer runs after isolated paths are configured and before AppState exists.
- New `src-tauri/test-fixtures/history-read/README.md`; explicit generator writes four versioned compressed archives there. No consumer edits or new regular tests in this assignment.

## API and implementation order

1. Implement fixed `HistoryFixture::{InventorySparse,InventoryDense,NineDense,RevisionContext}` and `load(kind) -> (TestVault, Vec<String>)`.
2. Archive zstd-compressed serde JSON with fixed recipe/schema metadata, original IDs/relative current paths and counts, allowlisted Markdown/manifest/main database bytes and SHA256 digests. No dependency additions or generic archive framework.
3. Explicit ignored `regenerate_history_read_fixtures` uses original canonical seed loops: excluded Window creation for inventories;55 sparse/dense notes; nine notes with12 further saved/finalized edits and original injected Editing Window wall-clock provider;80 context revisions with original rename cadence. Preserve canonical publication/finalization. No SQL history synthesis.
4. Drain projections, public clean close, stop projection worker and drop AppState before export. Require portable schema14, no WAL payload, no pending/missing/failed state. Normalize only heads/lifecycle path columns to a fixed synthetic root in a disposable export copy; no user temp paths in archive. Keep IDs, hashes, payloads and times unchanged.
5. Loader validates archive kind/version/file digests/geometry, extracts into TestVault initializer, rebases approved path columns to the disposable root, closes SQLite handles, then builds AppState normally and runs `ensure_interactive_index`. No automatic regeneration/cache fallback. Return known scenario IDs; Window remains present but excluded from that vector.
6. Document explicit generator command, trusted fixed fixture scope and regeneration requirements. Static diff/reference check only; report source freeze to root. Root compiles and runs ignored generator and real reader tests, which retain their original assertions.

## Guardrails

No production changes, durability pragmas disabled, hardlinked writable master, IDs/time/hash rewriting, schema migration or admission bypass. The fixture is a current-schema settled reader artifact; corruption, restart, receipt and checkpoint-generation tests remain live. Geometry validation must reject pending state and preserve interleaved context Lifecycle Events. Test-only restore path/schema knowledge stays private inside NoteTimeline.
