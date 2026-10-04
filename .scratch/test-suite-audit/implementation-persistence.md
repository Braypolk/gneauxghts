# Persistence audit implementation

Implemented after the full audit review gate, 2026-10-02. Baseline audit reports remain unchanged.

## Changes

- BP-01: The watcher catalog-hash fallback test now initializes separate disposable app-data and vault directories before constructing AppState. Its note path belongs to that vault. A local drop guard clears the notes override on ordinary return or unwinding; it drops after AppState and before fixture directories. No production watcher behavior changed.
- BP-04: The task mutation dispatch test now compares literal expected Markdown for Toggle, Delete, and SetDueDate instead of invoking the same implementation functions as its expected oracle. Removed the duplicate `derived_failure_does_not_turn_a_committed_write_into_an_error` test, which injected no failure and repeated the covered successful-write path. Genuine publication failure, committed warning, one-write, hash, ambiguity, and preparation coverage remains.
- BP-05: Task reconciliation constructs one TaskRecord, passes it by reference to SQLite upsert, then moves it into the returned records. This removes duplicate field initialization and string clones. Matching, transaction, schema, and identity policies are unchanged.

## Validation

Formatted only the three edited Rust files with `rustfmt --edition 2021 --config skip_children=true` and reviewed their diffs.

All focused commands passed:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --offline --lib vault_watcher::tests::rename_matching_uses_catalog_hash_when_semantic_indexing_is_unavailable -- --exact
# 1 passed; executed alone in a fresh test process, 0.03 seconds test runtime.

cargo test --manifest-path src-tauri/Cargo.toml --offline --lib services::task_mutation::tests
# 11 passed, 0.05 seconds test runtime.

cargo test --manifest-path src-tauri/Cargo.toml --offline --lib state::task_projection::tests
# 5 passed, 0.03 seconds test runtime.
```

No full Cargo suite run by this implementation agent; the parent owns combined validation. The focused watcher run uses the normal test process environment, with the corrected fixture providing explicit disposable configuration. No suite speedup is inferred from these single runs. Larger schema, context ownership, retry-work, and timestamp follow-ups remain outside this patch.
