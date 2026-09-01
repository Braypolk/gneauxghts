# 16: Name revisions and manage retained history

**What to build:** Users can mark important revisions and deliberately clear or purge retained history from the interfaces where they understand its scope and storage effect.

**Blocked by:** 10: Implement clear, purge, and deletion boundaries; 13: Open and navigate History Mode.

**Status:** ready-for-agent

- [ ] Add, edit, and remove a durable user-supplied label attached to a Note Revision without duplicating revision content.
- [ ] Allow duplicate labels and continue using opaque revision identity for all references and citations.
- [ ] Expose confirmed clear-note history in History Mode and establish the current state as a new honest Baseline Revision.
- [ ] Expose confirmed vault-wide clear in Settings and establish baselines for active notes.
- [ ] Expose confirmed permanent note purge in the applicable lifecycle interface and explain that the complete Note Timeline is removed.
- [ ] Show allocated and reclaimable storage after logical deletion while bounded compaction proceeds.
- [ ] Do not expose individual revision deletion or a history-disable setting.
- [ ] Add persistence, component, and end-to-end tests for labels, duplicate names, label removal, clear, purge, restart, and compaction reporting.
