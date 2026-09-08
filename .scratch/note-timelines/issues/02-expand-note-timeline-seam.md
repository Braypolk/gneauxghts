# 02: Expand the canonical NoteTimeline seam

**What to build:** A storage-neutral `NoteTimeline` boundary that initially preserves current behavior while establishing one owner for app mutations, external observations, human history reads, current-content provenance, and explicitly granted chat restores.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] Introduce closed, versioned domain types for Note Mutation, Vault Observation, Note Revision and Lifecycle Event identities, parent relationships, results, warnings, and grants.
- [x] Expose narrow mutation, observation, History Mode, current-content, and explicit-agent-restore capabilities without exposing SQL, storage transactions, row ordering, WAL concepts, or storage-format selection.
- [x] Give History Mode, ordinary chat, and explicitly granted restore callers distinct capabilities so unrestricted historical reads cannot be obtained through the ordinary chat interface.
- [x] Implement the boundary as pass-through coordination so existing canonical note behavior and persistence outcomes remain unchanged.
- [x] Preserve the existing authoritative committed-result and post-publication-warning contract at the expanded seam.
- [x] Add seam-level conformance tests and update architecture documentation to identify `NoteTimeline` as the future canonical owner.
- [x] Keep all existing note save, task mutation, proposal, watcher, forgotten-note, and recovery tests green.
