# 28: Page Missing Note recovery timelines

**What to build:** Users can inspect and recover Missing Notes without the app materializing each note's complete retained history, even when a note has thousands of revisions.

**Blocked by:** 13: Open and navigate History Mode; 19: Recover and expire Missing Notes.

**Status:** ready-for-agent

- [x] Return a bounded first page and continuation state for each requested Missing Note timeline instead of traversing every revision before responding.
- [x] Let recovery UI request subsequent pages incrementally through the same deterministic ordering used by ordinary History Mode.
- [x] Preserve Missing Note metadata, recovery eligibility, revision naming, and Lifecycle Events while pages are loaded.
- [x] Keep cursors stable across restart and reject stale or mismatched continuation state with a stable product error.
- [x] Add command, component, and end-to-end coverage proving a deeply revised Missing Note can be opened and recovered without eager full-history loading.
