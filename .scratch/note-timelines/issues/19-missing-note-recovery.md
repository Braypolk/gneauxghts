# 19: Recover and expire Missing Notes

**What to build:** An externally deleted note becomes a recoverable Missing Note whose timeline, deadline, reattachment, recovery, and purge behavior follow the user's existing forgotten-note lifecycle policy.

**Blocked by:** 08: Record external revisions and Lifecycle Events; 10: Implement clear, purge, and deletion boundaries; 18: Integrate forgotten notes with Note Timelines.

**Status:** ready-for-agent

- [ ] Record external disappearance as a Missing Note Lifecycle Event without treating it as a forgotten note or a content revision.
- [ ] Capture the user's current forgotten-note retention setting when the Missing transition occurs and persist the resulting deadline so later settings changes do not move it.
- [ ] Exclude Missing Notes from ordinary search, chat activity, and current-content provenance while exposing their timelines in recovery UI.
- [ ] Recover at the last known path when free; otherwise choose a unique nearby path without overwriting existing content and record the new path Lifecycle Event.
- [ ] Require Missing Note recovery before human or chat Version Restore.
- [ ] Reattach a reappearing file only when Note Identity and path continuity prove it is the missing note; ingest unrelated path reuse as a separate note.
- [ ] At expiry, permanently purge the note and complete Note Timeline through the same lifecycle purge semantics used for forgotten notes.
- [ ] Add tests for every retention setting, later preference changes, safe recovery, occupied paths, reappearance, path reuse, expiry, purge, and restart.
