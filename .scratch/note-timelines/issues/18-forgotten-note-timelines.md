# 18: Integrate forgotten notes with Note Timelines

**What to build:** Forgotten notes retain their complete history for the configured recovery period, but that history remains inaccessible until the note is recovered. After recovery, users can inspect and restore versions through the ordinary history flow.

**Blocked by:** 13: Open and navigate History Mode; 17: Restore a complete earlier revision.

**Status:** ready-for-agent

- [x] Record forget and Forgotten-Note Recovery as Lifecycle Events without creating content revisions when authored content is unchanged.
- [x] Retain the complete Note Timeline while the forgotten note remains recoverable under the configured lifecycle policy.
- [x] Do not expose History Mode, timeline inspection, or Version Restore for a note while it is forgotten.
- [x] Exclude forgotten notes from ordinary search, chat activity, and current-content provenance.
- [x] Require Forgotten-Note Recovery before the preserved timeline becomes available through the ordinary History Mode and human or chat Version Restore flows.
- [x] Preserve Note Identity, history, and existing non-overwriting recovery behavior across forget, restart, and recovery.
- [x] Permanently purge the complete timeline when the ordinary forgotten-note lifecycle policy permanently removes the note.
- [x] Add tests for each retention setting, history-access gating while forgotten, ordinary timeline inspection and restoration after recovery, exclusions, expiry, and restart.
