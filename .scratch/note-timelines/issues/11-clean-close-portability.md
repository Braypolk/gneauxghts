# 11: Make cleanly closed vaults portable

**What to build:** A vault can be cleanly closed, switched, or moved with a self-consistent SQLite history store, while unsafe live copies and mismatched store generations are detected rather than silently accepted.

**Blocked by:** 08: Record external revisions and Lifecycle Events; 09: Initialize existing vaults with Baseline Revisions; 10: Implement clear, purge, and deletion boundaries.

**Status:** ready-for-agent

- [x] Stop admitting new timeline mutations before clean close, vault switch, or app-owned move and settle or durably leave recoverable every prepared intent.
- [x] Checkpoint and truncate the WAL, close all history connections, and report portability only after the mutation barrier succeeds.
- [x] Surface barrier, checkpoint, or close failures and never report the vault as safely portable after a failed close.
- [x] Treat the main database, nonempty WAL, and ephemeral SHM correctly while connections are open, without relying on SHM as backup data.
- [x] On open, compare vault identity, history format, and generation between manifest, store metadata, and last observed state.
- [x] Route replacement, rollback, mismatch, or an inconsistent copied store into explicit reconciliation or recovery rather than silent acceptance.
- [x] Reopen a cleanly copied vault and reconstruct identical domain identities and content hashes.
- [x] Add lifecycle tests for WAL recovery, clean close, app restart, vault switching, failed close, generation mismatch, and an unsupported live main-file-only copy.
