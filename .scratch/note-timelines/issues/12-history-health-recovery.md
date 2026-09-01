# 12: Expose history health and recovery controls

**What to build:** Users can see whether note history is healthy, initializing, reclaimable, unavailable, or corrupt and can recover operation without losing readable Markdown or dirty editor work.

**Blocked by:** 08: Record external revisions and Lifecycle Events; 09: Initialize existing vaults with Baseline Revisions; 10: Implement clear, purge, and deletion boundaries.

**Status:** ready-for-agent

- [ ] Expose per-note health and usage plus vault-wide initialization progress, integrity state, allocated storage, and reclaimable storage through typed contracts.
- [ ] Present actionable healthy, initializing, degraded, unavailable, corrupt, warning, and reset states without exposing private SQLite details as domain concepts.
- [ ] Keep current Markdown readable and dirty editor buffers intact when the history store is unavailable or corrupt.
- [ ] Block app-owned canonical mutations when their durable history intent cannot be prepared and retain an explicit retry path.
- [ ] Preserve the authoritative committed result with a visible warning when failure occurs after Markdown publication.
- [ ] Support a confirmed corrupt-history reset that makes current note states new Baseline Revisions and removes affected historical content, labels, and citations.
- [ ] Retain a reset diagnostic outside the replacement timelines without retaining deleted prose.
- [ ] Add behavior and component tests for each health state, retry, backup guidance, reset, warning adoption, and restart.
