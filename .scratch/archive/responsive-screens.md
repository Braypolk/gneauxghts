# Responsive screens — completed work

All 23 recorded issues received implementations, covering constrained overlays,
short-window scrolling, header and navigation clearance, readable task rows,
retained compact pane rails and accessible task-group ordering.

Compact panes remain mounted while one opaque title rail reveals or hides
stationary content. Opening, switching and closing share the pane presentation
coordinator and dock timing, preserving drafts, selection, scroll and undo.
Related geometry, title handoff and header blur follow those same transitions.
Task-group menus reuse the persisted drag-order operation and preserve filtered
groups, focus and admitted task updates.

Permanent regressions remain in the browser suite; optional
[capture scripts](../responsive-screens/README.md) generate fresh images.
Superseded screenshots and intermediate measurements were pruned. The
[follow-up code audit](responsive-cleanup-2026-10-10.md) records the shared clock
sampling cleanup, stale task-read correction and its focused validation.

The original broad pass plus focused reruns verified the affected files; it was
not a second complete-suite run. Narrow viewport checks used desktop Chromium,
not real mobile keyboards, safe areas or native WebKit. Current behavioral
contracts live in `ARCHITECTURE.md` and `docs/architecture/behavior-invariants.md`.
