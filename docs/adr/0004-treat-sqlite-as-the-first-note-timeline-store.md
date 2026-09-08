---
status: accepted
---

# Treat SQLite as the first Note Timeline store

SQLite will be the first durable Note Timeline storage implementation because it provides transactional preparation, integrity constraints, efficient reconstruction, and a fast path to validating the canonical mutation seam. It is not the permanent portable history format: active vaults are expected eventually to support live file sync, for which immutable independently addressable history records are a better likely source of truth than a mutable SQLite database and WAL.

## Consequences

The `NoteTimeline` interface remains storage-neutral and exposes only closed domain types. Revisions and Lifecycle Events use globally unique opaque identities, explicit predecessor or parent references, versioned payloads independent of table layout, and verified content hashes. SQL, row identities, transaction handles, WAL policy, and storage-format selection stay local to the SQLite implementation; rebuildable projections do not become SQLite-only truth.

[ADR 0007](0007-retain-editor-history-at-editing-window-boundaries.md) adds replaceable private pending windows. Only finalized window records receive public Revision Identities; point publications reserve theirs before canonical publication for Version Restore. Pending state and publication recovery evidence must survive migration and settle before portable close. Finalized identities and existing export guarantees remain unchanged.

No polymorphic `HistoryStore` interface will be introduced while SQLite is the only implementation. SQLite knowledge will instead remain local inside `NoteTimeline`; a shared storage interface will be extracted from the real needs of SQLite and the later immutable-record implementation when both exist.

The Phase 1 storage spike must prove an export shape by converting representative SQLite histories into immutable-object fixtures and reconstructing identical domain identities and content hashes. A future migration will run behind a mutation barrier, verify the candidate store completely, and atomically change the vault manifest's history format and generation; interruption leaves the old SQLite store selected, and long-lived dual writes are rejected.

The SQLite phase supports clean-close sequential portability, not live copying of an open history database. A later storage-evolution milestone may support third-party live file sync with one logical writer by making immutable vault records authoritative and SQLite a rebuildable projection. Concurrent multi-device editing and merging divergent Note Timelines remain a separate, out-of-scope consistency problem.
