---
status: accepted
---

# Treat SQLite as the first Note Timeline store

SQLite will be the first durable Note Timeline storage implementation because it provides transactional preparation, integrity constraints, efficient reconstruction, and a fast path to validating the canonical mutation seam. It is not the permanent portable history format: active vaults are expected eventually to support live file sync, for which immutable independently addressable history records are a better likely source of truth than a mutable SQLite database and WAL.

## Consequences

The `NoteTimeline` interface remains storage-neutral and exposes only closed domain types. Revisions and Lifecycle Events use globally unique opaque identities, explicit predecessor or parent references, versioned payloads independent of table layout, and verified content hashes. SQL, row identities, transaction handles, WAL policy, and storage-format selection stay local to the SQLite implementation; rebuildable projections do not become SQLite-only truth.

[ADR 0007](0007-retain-editor-history-at-editing-window-boundaries.md) adds replaceable private pending windows. Only finalized window records receive public Revision Identities; point publications reserve theirs before canonical publication for Version Restore. Pending state and publication recovery evidence must survive migration and settle before portable close. Finalized identities and existing export guarantees remain unchanged.

No polymorphic `HistoryStore` interface will be introduced while SQLite is the only implementation. SQLite knowledge will instead remain local inside `NoteTimeline`; a shared storage interface will be extracted from the real needs of SQLite and the later immutable-record implementation when both exist.

The storage spike demonstrated reconstruction of identical domain identities and
content hashes from the SQLite representation. That result validates the current
storage boundary without making the experimental export fixture or its measurements
part of the architecture.

The current schema uses compact nonce receipt keys, retains detailed preparation
data only while recovery needs it, and stores exact terminal outcomes separately.
Only fresh schema 14 stores are admitted. Older or incomplete stores require the
explicit reset path; there is no migration, trust-old-store command, or long-lived
dual write. Derived indexes may be removed only after store identity, format,
generation, and observation admission succeeds.

The SQLite phase supports clean-close sequential portability, not live copying of
an open history database. A future storage change must run behind the mutation
barrier, verify its candidate completely, and switch the manifest atomically. Live
file sync and concurrent multi-device history merging remain separate decisions.
