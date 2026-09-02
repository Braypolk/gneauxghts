---
status: accepted
---

# Remember observed history generations outside the vault

The app records the greatest history generation it has opened for each Vault Identity in app-local state, even though the manifest and selected history store remain portable and vault-owned. This second observation prevents restoring or replacing both vault-local records at an older or already-consumed generation from silently presenting erased history as a fresh baseline; an explicit reset is the only operation allowed to create a replacement store, and it leaves its operation and generation diagnostic in the same app-local record.

## Consequences

A vault moved to a new installation has no prior local observation and is validated only by its manifest and selected store. On an installation that has already opened the vault, restoring an older backup may require an explicit recovery or reset instead of opening automatically; this trades friction during rollback for honest provenance and makes removal of the selected store fail closed.
