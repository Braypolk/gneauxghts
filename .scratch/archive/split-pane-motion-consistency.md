# Split pane motion consistency

Completed: 2026-10-12

Opening split options or a previous location from chat felt slower and less
fluid than other splits. Mounted frame sampling distinguished three causes:

- Ordinary wide splits used a 220ms CSS curve while chat edges used the existing
  380ms dock clock, and chat-to-options could select the input pinch curve.
- Current/previous choices first created an editor, then resolved the choice in
  a second command. Duplicating chat restarted presentation; the final sampled
  operation lasted roughly 92–95ms.
- Flex sizing crossed the dock's width caps while pane bounds were moving. The
  dock could reverse by 15–35px, including when its input mode stayed unchanged.

`notepadWorkspaceSession.splitWorkspace(choice)` now resolves the destination
kind before completing pane creation, then shares the picker's location
application. Chat mounts directly as chat and preserves its conversation/context
without allocating a placeholder editor. Previous-chat admission is evaluated
while membership is creating. Capacity checks and correlated navigation remain
with their existing owners, and destination focus waits for presentation.

`paneLayoutMotion` owns the same entry/departure curve for every kind and width,
using the existing dock clock and easing. Membership/kind changes distinguish
layout entry from retained compact focus exchange. The coordinator temporarily
interpolates the dock's measured flex bounds and row clearance alongside pane
bounds, then releases all effects through its existing cancellation path.
Accompanying dock morphs project world-space endpoints on that same clock.
Explicit input switches retain their existing pinch pacing.

The new browser matrix exercises options, current location, previous location,
and new chat from editor, plus options/current/previous from chat, at 1440px and
390px. It checks the actual pane animation duration and curve, monotonic dock
edges, matching input/material bounds, stable entering content, and retained
chat drafts. Command-owner regressions cover direct current/previous chat entry
without a second editor or draft.

The pre-existing frame helper collected only 80ms after settling but checked the
final 100ms as settled geometry. At 2400px, that included the shared curve's
last moving frame (1.046875px from the destination). It now retains 120ms of
settled samples; geometry tolerances remain unchanged.

Validation: 92 affected browser tests pass across dock, compact rail, pane
animation, chat animation, Related, navigation, and the 14-case entry matrix.
The pane suite was rerun after correcting the settled-sample window. All 153
affected orchestration/choice/dock/architecture unit tests pass. Svelte checks
report zero errors or warnings; E2E TypeScript and diff whitespace checks pass.
Native Mac and physical iOS execution were not run.
