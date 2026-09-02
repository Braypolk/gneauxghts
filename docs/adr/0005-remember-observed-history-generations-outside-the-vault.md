---
status: accepted
---

# Remember observed history generations outside the vault

The app records the greatest history generation it has opened for each Vault Identity in app-local state, even though the manifest and selected history store remain portable and vault-owned. For SQLite it also remembers the selected store-instance identity and greatest clean-close watermark. These observations prevent restoring or replacing vault-local records at an older or already-consumed generation, replacing a store within one generation, or rolling back to an older internally valid clean copy from silently presenting erased history as current; an explicit reset is the only operation allowed to create a replacement store, and it leaves its operation and generation diagnostic in the same app-local record.

## Consequences

A vault moved to a new installation has no prior local observation and is validated by its manifest plus a store marked portable by clean close. An open SQLite store is recoverable only on an installation whose app-local observation matches its instance and generation; this supports ordinary restart/WAL recovery without treating arbitrary live copies as backups. On an installation that has already opened the vault, restoring an older backup may require an explicit recovery or reset instead of opening automatically; this trades friction during rollback for honest provenance and makes removal or replacement of the selected store fail closed.

Stores created before instance and clean-close metadata existed cannot prove their continuity from format and generation alone. They therefore remain closed until the user explicitly trusts that legacy store for a one-time migration; the migration immediately records a new instance identity and clears the authorization. A merely matching pre-upgrade observation is not enough to authorize migration.
