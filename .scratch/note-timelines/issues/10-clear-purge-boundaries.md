# 10: Implement clear, purge, and deletion boundaries

**What to build:** Users and lifecycle policies can make retained history immediately inaccessible at note or vault scope without retaining deleted prose or confusing physical compaction with logical deletion.

**Blocked by:** 07: Capture and reconstruct durable Note Revisions; 09: Initialize existing vaults with Baseline Revisions.

**Status:** ready-for-agent

- [x] Clear one note's history atomically and establish its current canonical authored state as a new Baseline Revision with unknown earlier provenance.
- [x] Clear vault history for active notes and establish independent new baselines without changing canonical Markdown.
- [x] Permanently purge a note's complete Note Timeline, including revisions, Lifecycle Events, labels, citations, and rebuildable projections.
- [x] Record minimal versioned storage-neutral deletion markers containing scope, operation identity, and timing or generation evidence but no deleted prose.
- [x] Make cleared or purged content unreadable immediately even if SQLite pages remain physically allocated until bounded background compaction.
- [x] Report allocated and reclaimable storage accurately before and after compaction.
- [x] Reject individual revision deletion while allowing a Named Revision label to be removed independently later.
- [x] Add tests for interruption, restart, repeated operations, baseline truthfulness, marker export, and proof that purged content cannot be reconstructed.
