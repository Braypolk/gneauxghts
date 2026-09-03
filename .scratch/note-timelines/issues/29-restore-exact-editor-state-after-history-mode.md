# 29: Restore exact editor state after History Mode

**What to build:** Leaving History Mode returns the user to the exact editor state they had before entering it, including their text selection as well as pane, focus, and scroll state.

**Blocked by:** 13: Open and navigate History Mode.

**Status:** ready-for-agent

- [ ] Capture the complete editor selection, including anchor and head direction, when History Mode opens.
- [ ] Restore selection, scroll position, focus target, and active pane without changing current note content or undo history.
- [ ] Preserve the entry snapshot while revision pages, diffs, names, or lifecycle state refresh in an open History Mode session.
- [ ] Restore safely when the original selection is no longer valid, using a deterministic bounded fallback.
- [ ] Add component and browser end-to-end assertions for collapsed cursors, ranged selections, reversed selections, scrolling, refresh while open, and exit.
