# 17: Restore a complete earlier revision

**What to build:** A user can deliberately replace the complete current user-authored content with an earlier revision while retaining current identity and lifecycle state and appending a new auditable Note Revision.

**Blocked by:** 15: Inspect deterministic historical diffs.

**Status:** ready-for-agent

- [ ] Preview the selected historical body and unmanaged frontmatter as a complete replacement of current user-authored content.
- [ ] Preserve current Note Identity, title and path, creation time, active or forgotten status, and managed metadata semantics while assigning a fresh update time.
- [ ] Bind preview and confirmation to the current authored-content hash and invalidate the operation when current content changes.
- [ ] Require explicit human confirmation in History Mode before committing through the canonical mutation seam.
- [ ] Append a new Version Restore revision and preserve all intervening revisions and Lifecycle Events.
- [ ] Establish a fresh editor undo boundary so ordinary undo cannot cross the restore; reversing it requires another Version Restore.
- [ ] Do not offer partial historical restoration, while continuing to permit ordinary manual copying from read-only history.
- [ ] Add tests for stale previews, concurrent edits, frontmatter, title/path preservation, empty content, restart, reverse restore, and undo isolation.
