# 03: Migrate app-owned note writers to NoteTimeline

**What to build:** Every app-owned ordinary-note content mutation travels through the expanded `NoteTimeline` boundary with a typed, trustworthy Mutation Source while retaining current user-visible save behavior.

**Blocked by:** 02: Expand the canonical NoteTimeline seam.

**Status:** ready-for-agent

- [ ] Route editor persistence and new-note creation through typed Editor and Note Creation mutations.
- [ ] Route task-driven canonical changes through typed Task Action mutations, including the existing dirty-open-note path that edits the working document before ordinary persistence.
- [ ] Route accepted chat proposals through typed Accepted Chat Proposal mutations while preserving durable proposal-status convergence.
- [ ] Prevent callers from supplying arbitrary source strings or bypassing the authoritative committed-result contract.
- [ ] Preserve operation-aware self-save expectations, read-your-write task consistency, open-document baseline adoption, local dirty edits, and commit warnings.
- [ ] Add conformance tests showing each migrated caller reaches the same boundary and retains its existing external behavior.
- [ ] Keep migration additive so the legacy internal coordinator can remain temporarily available until all caller batches are complete.
