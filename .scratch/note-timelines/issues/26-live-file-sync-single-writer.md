# 26: Support live file sync with one logical writer

**What to build:** A vault's immutable Note Timeline records can be transported by third-party file synchronization while Gneauxghts is open, provided only one logical writer is active, without promising divergent-history merging.

**Blocked by:** 25: Migrate verified histories to the immutable store.

**Status:** ready-for-agent

- [ ] Treat immutable vault records as authoritative and any SQLite index or projection as rebuildable local state.
- [ ] Ingest complete newly synchronized immutable records idempotently and detect incomplete, corrupt, conflicting, or out-of-order transfers before exposing them.
- [ ] Preserve Note Revision, Lifecycle Event, deletion, label, citation, and provenance identities across synchronization and projection rebuild.
- [ ] Enforce or visibly diagnose the one-logical-writer consistency rule rather than silently accepting simultaneous writers.
- [ ] Reconcile manifest and generation changes without losing current Markdown readability or replaying canonical note writes.
- [ ] Keep concurrent editing, automatic merging of divergent Note Timelines, and collaborative attribution explicitly unsupported.
- [ ] Add multi-folder synchronization simulations for delayed delivery, duplicate delivery, interruption, rollback, deletion markers, projection loss, restart, and attempted second-writer use.
- [ ] Keep all Phase 1 through Phase 4 behavior and access-control suites green against the immutable implementation.
