---
status: accepted
---

# Treat SQLite as the first Note Timeline store

SQLite is the durable Note Timeline storage implementation because it provides transactional preparation, integrity constraints, efficient reconstruction, and a fast path to validating the canonical mutation seam. This decision does not commit to SQLite as the permanent portable history format. If live file sync is added later, immutable independently addressable history records remain a candidate source of truth; that store is not implemented today.

## Consequences

The `NoteTimeline` interface remains storage-neutral and exposes only closed domain types. Revisions and Lifecycle Events use globally unique opaque identities, explicit predecessor or parent references, versioned payloads independent of table layout, and verified content hashes. SQL, row identities, transaction handles, WAL policy, and storage-format selection stay local to the SQLite implementation; rebuildable projections do not become SQLite-only truth.

[ADR 0007](0007-retain-editor-history-at-editing-window-boundaries.md) adds replaceable private pending windows. Only finalized window records receive public Revision Identities; point publications reserve theirs before canonical publication for Version Restore. Pending state and publication recovery evidence must settle before portable close and be preserved by any future migration. Finalized identities remain stable.

No polymorphic `HistoryStore` interface will be introduced while SQLite is the only implementation. SQLite knowledge will instead remain local inside `NoteTimeline`; a shared storage interface will be extracted from the real needs of SQLite and the later immutable-record implementation when both exist.

Any future store migration must demonstrate identical domain identities and reconstructed content hashes, run behind a mutation barrier, verify the candidate store completely, and atomically change the vault manifest's history format and generation. Interruption must leave the old store selected; long-lived dual writes are rejected. These are requirements for a future migration, not an existing immutable-object exporter or a current implementation task.

The SQLite phase supports clean-close sequential portability, not live copying of an open history database. A later storage-evolution milestone may support third-party live file sync with one logical writer by making immutable vault records authoritative and SQLite a rebuildable projection. Concurrent multi-device editing and merging divergent Note Timelines remain a separate, out-of-scope consistency problem.
