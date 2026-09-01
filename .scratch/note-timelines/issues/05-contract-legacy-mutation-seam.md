# 05: Contract the legacy mutation seam

**What to build:** `NoteTimeline` becomes the only ordinary-note canonical mutation and observation boundary, with the superseded post-commit entry points removed and mechanically prevented from returning.

**Blocked by:** 03: Migrate app-owned note writers to NoteTimeline; 04: Migrate observation and lifecycle callers to NoteTimeline.

**Status:** ready-for-agent

- [ ] Remove the legacy canonical mutation entry points after proving that no production caller depends on them.
- [ ] Keep projection updates and existing post-publication behavior private behind `NoteTimeline` rather than creating optional history hooks around the old coordinator.
- [ ] Add backend architecture-fitness checks that reject direct ordinary-note canonical writers outside the approved boundary.
- [ ] Add checks that prevent SQL, transactions, row identities, WAL state, and storage-format choices from crossing the `NoteTimeline` interface.
- [ ] Demonstrate that editor, task, proposal, watcher, rename, forget, recovery, and reconciliation paths still converge through one owner.
- [ ] Update architecture documentation to remove the superseded ownership description.
- [ ] Keep all existing regression suites green after contraction.
