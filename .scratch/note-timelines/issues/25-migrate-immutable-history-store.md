# 25: Migrate verified histories to the immutable store

**What to build:** A vault can move from the SQLite history implementation to the selected immutable store without changing timeline meaning, losing deletion boundaries, or exposing partially migrated history.

**Blocked by:** 10: Implement clear, purge, and deletion boundaries; 11: Make cleanly closed vaults portable; 24: Spike the immutable portable history format.

**Status:** ready-for-agent

- [ ] Introduce the real shared persistence interface justified by the two concrete storage implementations while keeping the public `NoteTimeline` interface unchanged.
- [ ] Enter a mutation barrier and open a consistent view of the manifest-selected SQLite store before export.
- [ ] Export every retained revision, checkpoint, Lifecycle Event, Named Revision, deletion marker, and required domain identity without relying on database row order.
- [ ] Reconstruct and integrity-check every retained revision from the candidate immutable store before selection.
- [ ] Atomically switch the vault manifest's history format and generation only after complete verification.
- [ ] Ensure interruption before selection leaves SQLite authoritative, while interruption after selection reopens and verifies the immutable store deterministically.
- [ ] Retain the old SQLite store read-only until the selected immutable store has reopened and passed integrity verification, then retire it without indefinite dual writes.
- [ ] Add migration, rollback, interruption, clear/purge, projection-rebuild, identity, and content-hash equivalence tests.
