# 13: Open and navigate History Mode

**What to build:** A user can enter a global read-only History Mode for a note, browse its paged timeline, and return to the exact workspace state they left without turning history into another editable pane.

**Blocked by:** 11: Make cleanly closed vaults portable; 12: Expose history health and recovery controls.

**Status:** ready-for-agent

- [x] Add a dedicated global `HistoryModeSession` state machine alongside the normal workspace rather than a pane kind, pane transient, or editable document runtime.
- [x] Flush pending autosave before entry and refuse to enter with a clear error if that save cannot complete.
- [x] Display paged Note Revisions and Lifecycle Events for the selected Note Identity using role-limited History Mode access.
- [x] Preserve and restore active panes, note context, editor selection, scroll, focus, and other owned workspace state on exit.
- [x] Keep the selected historical revision pinned if new revisions arrive while History Mode is open.
- [x] Prevent History Mode from modifying canonical content, Note Draft State, editor resources, pane membership, or workspace ownership.
- [x] Handle note lifecycle changes or unavailable history while open through explicit state-machine transitions.
- [x] Add state-machine, component, architecture-fitness, and end-to-end tests for successful entry, failed autosave, paging, pinning, exit, and restart-safe workspace behavior.
