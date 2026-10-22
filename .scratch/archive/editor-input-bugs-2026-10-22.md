# Editor input and task layout fixes — 2026-10-22

Completed three reported bugs through the existing owners.

- **Previous-note typing:** a mounted editor kept native editing focus while its
  DOM was hidden and rebound. In foreground WebKit, the restored logical cursor
  and DOM focus were correct, yet native text insertion returned false. Releasing
  outgoing focus before hiding/swapping fixes this; workspace presentation still
  owns destination focus and supersession. The native regression failed before
  that change and passed afterward, checking exact inserted text at saved cursors
  across Cmd+L, the previous-note button and another return. It belongs to the
  explicitly authorized foreground suite; keydown-only driver actions cannot
  establish contenteditable insertion, so it uses WebKit's native execCommand
  path without refocusing the editor.
- **Task date plus wrapping:** the transparent inline button still consumed width
  and could wrap onto its own line. It now floats beside the final text fragment
  using its absolute inline static position, without contributing width or line
  height. Coarse pointers retain a labeled 44px target. The browser regression
  checks short and wrapped tasks at five widths, placement beside the final
  character, equal task height with/without the action, picker interaction and
  emulated touch layout. At the reproducing 440px width,
  the task height changed from 59.8px to 31.8px.
- **Task date undo/redo scroll:** adding a date through the plus left the old
  editor selection elsewhere in the note. Shared history correctly restored that
  selection on undo and requested scrolling, producing a 1,004px jump in the
  long-note reproduction. Picker invocation now establishes its task position
  before Apply, matching existing deadline editing. No scrolling is suppressed.
  The command regression failed for old cursors both before and after the task;
  the browser reproduction failed through the real picker and keyboard undo.
  Regression coverage repeats three undo/redo cycles at the 440px wrapping edge
  with exact text, task-local selection and unchanged scroll assertions.
- **Image drops:** only paste was handled, so CodeMirror's default file drop
  imported SVG source as text and failed to insert binary image embeds. Drops now
  use the existing view-owned upload jobs at pointer coordinates. Browser checks
  cover multiple files, unrelated selected text, one undo, partial retry,
  navigation cancellation and unchanged ordinary text dragging. Native WebKit
  checks cover exact asset bytes, note persistence, undo and the existing paste /
  resize / viewer / reopen journey. DOM DataTransfer payloads are constructed;
  physical Finder drag delivery is outside this automated evidence.

Validation: 1,418 frontend tests and 143 support tests passed (one existing frontend
skip); production build passed; combined browser regression replay passed five
checks; native image journeys passed two checks and foreground previous-note
regression passed one. Svelte and E2E type checks passed.
After the date-history correction, all 17 focused task-date/shared-runtime tests,
the two browser history cases (three undo/redo cycles each), the task layout
replay, and Svelte/E2E type checks passed.
All owned browser sessions and fixture servers were closed. Temporary native
diagnostic code was removed; maintained regressions remain under e2e/.
