# Prebuilt read fixtures

Status: ready-for-agent
Progress: Complete; implemented and validated. See ../README.md.

Audit portability and read/write contract separation; generate immutable fixture snapshots and restore private copies before AppState creation. Preserve original read assertions and live history-clear mutation. Keep expensive writer tests live. Validate generator, fixture consumers and full Rust suite; document update command and limitations.
