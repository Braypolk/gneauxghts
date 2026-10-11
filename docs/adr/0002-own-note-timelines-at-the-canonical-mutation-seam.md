---
status: accepted
---

# Own note timelines at the canonical mutation seam

Gneauxghts treats a note's timeline as durable vault knowledge. `NoteTimeline` owns ordinary-note canonical mutation coordination. App-owned changes must durably prepare their timeline intent before Markdown publication, then durably capture history and synchronize projections after publication; external changes enter through observation and reconciliation. Current Markdown remains the canonical current note, while the vault-owned history store selected by the vault manifest owns reconstructable historical states. SQLite is the first implementation, not part of the module's interface or a permanent portable-format commitment; see ADR 0004.

The module exposes mutation and observation operations plus role-limited handles for History Mode, Current-Content Provenance, and scoped activity history under ADR 0009. Its implementation stores verified UTF-8 deltas between adaptive compressed checkpoints, uses closed versioned domain types rather than a generic event platform, and hides reconstruction, provenance, identity repair, recovery, and storage policy from callers. Title and path changes are lifecycle state, not revision content, and therefore remain outside revision diffs.

[ADR 0007](0007-retain-editor-history-at-editing-window-boundaries.md) supersedes the original immediate-per-commit revision granularity: ordinary Editor publications enter durable pending windows before immutable finalization. This preserves the mutation owner and mandatory preparation. The proposed agent Version Restore capability remains deferred; no chat restore grant is implemented.

## Consequences

The former standalone post-commit mutation service was too late to guarantee history preparation and has been removed as a caller-visible seam. Its projection and warning coordination is private inside `NoteTimeline` rather than wrapped with optional history hooks. App-owned writes fail before publication if history cannot be prepared; degradation after publication returns the authoritative committed result and reconciles without replaying the write. Initial development deliberately remained fail-closed so seam failures could not hide as successful unversioned saves. [ADR 0006](0006-keep-history-preparation-mandatory-in-production.md) records the production decision after review of observed development failures.

The SQLite history store supports sequential single-writer use. Clean close on restart or exit reaches a mutation barrier, settles recoverable intent state, checkpoints and truncates the WAL, and closes database connections before reporting the vault portable. Staging a Next-launch Vault Selection does not close the Running Vault. Copying the live main database is not a supported backup, and the implementation does not add a SQLite-specific live-snapshot workflow. The manifest and store record vault identity, history format, and generation so replacement, migration, or a mismatched copy is reconciled explicitly. Live file sync remains a future storage-evolution concern; simultaneous writers and concurrent multi-device history merging remain outside this decision.
