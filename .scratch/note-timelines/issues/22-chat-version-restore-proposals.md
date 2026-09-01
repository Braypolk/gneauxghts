# 22: Propose explicit chat-requested Version Restores

**What to build:** When the user's current message explicitly requests a complete earlier note version, chat can inspect only that granted history and create a durable whole-note restore proposal for review without directly changing the note.

**Blocked by:** 17: Restore a complete earlier revision; 21: Answer chat activity questions with Revision Citations.

**Status:** ready-for-agent

- [ ] Create an app-owned, current-turn Explicit Restore Grant only for a conservative direct request to restore or bring back a complete earlier revision.
- [ ] Bind the grant to the requesting turn, Note Identity, selected revision, and complete-restore operation; the model cannot mint, broaden, retain, or transfer it.
- [ ] Deny grants for ambiguous, partial-section, model-originated, stale-turn, or cross-note requests and explain that only complete Version Restore is supported.
- [ ] Give the granted chat path only the historical content required to construct the complete authored replacement.
- [ ] Create a durable proposal through the existing proposal domain and never commit the Version Restore directly.
- [ ] Ensure proposal review shows the complete replacement and acceptance later commits through the ordinary canonical mutation seam as a Version Restore revision.
- [ ] Preserve proposal recovery, status convergence, open-document baseline behavior, and local dirty edits.
- [ ] Add intent-parsing, capability-isolation, proposal orchestration, recovery, review, rejection, acceptance, and end-to-end tests.
