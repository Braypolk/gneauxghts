# 27: Repair revision continuity after history reset

**What to build:** Resetting unavailable or corrupt history re-establishes a usable revision timeline for every recoverable note, including forgotten notes, so later recovery always returns a note with selectable, diffable, and restorable content.

**Blocked by:** 12: Expose history health and recovery controls; 18: Integrate forgotten notes with Note Timelines; 19: Recover and expire Missing Notes.

**Status:** ready-for-agent

- [x] Include recoverable forgotten-note content when rebuilding history without reintroducing forgotten notes into ordinary current-note surfaces.
- [x] Establish a content-bearing revision head before recording recovery Lifecycle Events for a note whose rebuilt timeline has no head.
- [x] Preserve stable Note Identity, last-known path, retention deadline, and forgotten or Missing lifecycle state across reset and restart.
- [x] Prevent a partially rebuilt timeline from becoming available when baselining or recovery fails.
- [x] Add integration coverage for corruption detection, history reset, forgotten-note discovery, recovery, revision selection, diff, Version Restore preparation, and restart.
