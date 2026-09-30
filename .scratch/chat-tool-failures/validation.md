# Validation

- Read-only production database snapshot: confirmed repeated generic search/read failures, incorrect zero-note summaries, and research `unread_selection`.
- Tool-dispatch regression: recovery messages survive Rig normalization; unknown internal diagnostics remain redacted.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib agent_tools::`: 13 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib agent_runtime::tests`: 11 passed (includes safe error text, distinct note counts, incomplete research/read summaries).
- `cargo test --manifest-path src-tauri/Cargo.toml --test architecture_fitness`: 19 passed.
- No production note/settings/chat writes or new model requests.
- Original local-provider conversation has not been rerun. Old records do not contain the lost reasons; a new run is needed to confirm the remaining call-specific causes. These changes fix the demonstrated feedback and diagnostic defects, not every possible retrieval failure.
