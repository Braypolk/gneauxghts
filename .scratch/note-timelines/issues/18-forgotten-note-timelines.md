# 18: Integrate forgotten notes with Note Timelines

**What to build:** Forgotten notes retain inspectable history for their configured recovery period while staying outside ordinary current-note experiences and requiring explicit recovery before content restoration.

**Blocked by:** 13: Open and navigate History Mode; 17: Restore a complete earlier revision.

**Status:** ready-for-agent

- [ ] Record forget and Forgotten-Note Recovery as Lifecycle Events without creating content revisions when authored content is unchanged.
- [ ] Retain the complete Note Timeline while the forgotten note remains recoverable under the configured lifecycle policy.
- [ ] Allow users to inspect a forgotten note's timeline from the existing recovery interface through read-only History Mode.
- [ ] Exclude forgotten notes from ordinary search, chat activity, and current-content provenance.
- [ ] Require Forgotten-Note Recovery before a human or chat Version Restore can be initiated.
- [ ] Preserve Note Identity, history, and existing non-overwriting recovery behavior across forget, restart, and recovery.
- [ ] Permanently purge the complete timeline when the ordinary forgotten-note lifecycle policy permanently removes the note.
- [ ] Add tests for each retention setting, timeline inspection, exclusions, restore gating, recovery, expiry, and restart.
