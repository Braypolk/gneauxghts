# 14: Group revisions into Editing Sessions

**What to build:** Long timelines become readable through expandable Editing Sessions and deterministic summaries while every underlying Note Revision remains individually available.

**Blocked by:** 13: Open and navigate History Mode.

**Status:** ready-for-agent

- [ ] Group consecutive revisions with the same Mutation Source when each is less than five minutes from the previous revision.
- [ ] Break an Editing Session on a source change, exactly five minutes of inactivity, a Lifecycle Event, or a Version Restore.
- [ ] Keep session membership derived and rebuildable without changing revision count, identity, parent relationships, or stored content.
- [ ] Generate deterministic revision summaries from authored-content line and character counts, Mutation Source, and timestamps.
- [ ] Generate distinct deterministic Lifecycle Event summaries for title, path, and lifecycle changes without AI interpretation.
- [ ] Allow users to expand a session and inspect every retained revision.
- [ ] Add boundary tests at four minutes fifty-nine seconds, exactly five minutes, and beyond five minutes plus source, lifecycle, and restore boundaries.
- [ ] Add component tests for timeline ordering, summaries, collapsed sessions, expansion, and live arrival of new revisions.
