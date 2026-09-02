---
status: accepted
---

# Own note timelines at the canonical mutation seam

Gneauxghts will treat a note's timeline as durable vault knowledge and place a deep `NoteTimeline` module around ordinary-note canonical mutation coordination. App-owned changes must durably prepare their timeline intent before Markdown publication, then finalize history and synchronize projections after publication; external changes enter through observation and reconciliation. Current Markdown remains the canonical current note, while the vault-owned history store selected by the vault manifest owns reconstructable historical states. SQLite is the first implementation, not part of the module's interface or a permanent portable-format commitment; see ADR 0004.

The module will expose a small mutation and observation interface plus role-limited handles for History Mode, Current-Content Provenance, and explicitly requested agent Version Restore proposals. Its implementation will store verified UTF-8 deltas between adaptive compressed checkpoints, use closed versioned domain types rather than a generic event platform, and hide reconstruction, provenance, identity repair, recovery, and storage policy from callers. Title and path changes are lifecycle state, not revision content, and therefore remain outside revision diffs.

## Consequences

The former standalone post-commit mutation service was too late to guarantee history preparation and has been removed as a caller-visible seam. Its projection and warning coordination is private inside `NoteTimeline` rather than wrapped with optional history hooks. When durable capture is added, app-owned writes fail before publication if history cannot be prepared; degradation after publication returns the authoritative committed result and reconciles without replaying the write. Initial development deliberately remains fail-closed so seam failures cannot hide as successful unversioned saves; the production availability policy must be reviewed from observed failures before release.

The initial SQLite history store supports sequential single-writer use. A clean close or app-owned move reaches a mutation barrier, settles recoverable intent state, checkpoints and truncates the WAL, and closes database connections before reporting the vault portable. Copying the live main database is not a supported backup, and the initial implementation does not add a SQLite-specific live-snapshot workflow. The manifest and store record vault identity, history format, and generation so replacement, migration, or a mismatched copy is reconciled explicitly. Live file sync is deferred to a later immutable-record implementation; simultaneous writers and concurrent multi-device history merging remain outside this decision.
