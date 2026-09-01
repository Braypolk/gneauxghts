# 04: Migrate observation and lifecycle callers to NoteTimeline

**What to build:** External filesystem states and non-content note transitions enter through typed `NoteTimeline` observations and lifecycle operations without changing current watcher, conflict, forget, or recovery behavior.

**Blocked by:** 02: Expand the canonical NoteTimeline seam.

**Status:** ready-for-agent

- [ ] Route watcher and background-reconciliation observations through the typed observation capability.
- [ ] Route rename and move, forget and Forgotten-Note Recovery, external disappearance, reappearance, and permanent lifecycle deletion through typed operations.
- [ ] Preserve operation-aware suppression so only an app-owned operation's exact declared filesystem outcome is ignored.
- [ ] Preserve dirty-document conflict behavior, including both the local working content and external snapshot or deletion.
- [ ] Preserve existing non-overwriting recovery and navigation safety while the seam remains pass-through.
- [ ] Add conformance tests covering duplicate watcher events, moves, deletions, failed app operations, and reconciliation entry.
- [ ] Keep the migration additive until all canonical callers have moved and architecture enforcement can safely contract the old seam.
