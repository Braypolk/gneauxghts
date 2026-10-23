# Formatting mechanics follow-up

Implemented 2026-10-22. This extends the earlier caret-formatting pass without
adding a second editor state owner or changing note persistence.

## Reproduced and fixed

- The real Code toolbar wrapped ``a `tick` here`` with a single backtick pair,
  producing two separate code spans and leaving the middle plain. Existing
  multi-backtick spans also lost only one tick when toggled. Formatting now chooses
  a delimiter longer than every contained backtick run, pads boundary backticks or
  significant boundary spaces according to Markdown's code-span rule, and toggles
  the complete delimiter/padding while mapping the selection or caret. Tests check
  the actual parser produces one complete InlineCode node and round-trips the
  source content.
- An empty strikethrough pair (`~~~~`) rendered as fenced-code chrome, including
  following prose. The decorator now leaves that exact active typing position
  plain, as the existing empty-bold rule does. Leaving the caret restores ordinary
  Markdown code-fence presentation; no source characters are rewritten.
- CodeMirror's `composing` flag remains false during composition start until the
  first DOM text change. A mounted composition-start/shortcut reproduction changed
  the word anyway. Inline-format commands now also honor the public
  `compositionStarted` flag, covering that initial phase.
- Fresh browser replay exposed selected toolbar format/toggle actions merging
  with preceding paste and each other, so Undo could remove the whole pasted note.
  Every explicit inline-format action now defaults to one isolated shared history
  step. The existing explicit opt-out remains available. Selected bold/code tests
  exercise paste, format, toggle and three separate Undo steps through the real
  shared EditorDocumentRuntime and a sibling pane.

## Verified behavior retained

The earlier word-interior/word-edge policy and compatible nested bold/italic
markers remain intact. Actual pointer clicks at both concealed bold text edges
insert inside the expected markers. Existing Enter behavior continues a task list
once and exits its next empty item once. The reduced-motion toolbar stays usable
with zero action-transition duration. No animation curve, global motion policy,
canonical note write or shared-Undo owner was replaced.

## Validation and limits

`pnpm exec vitest run` against inlineFormatting, markdown, enterKey, selectionMenu,
undoSelection and blockMoveUndo: 116 tests passed across six files.

Interactive verification used the repository WDIO loop with a unique
`formatting-followup` session and port 1437. The session was traced, the corrected
toolbar screenshot was visually inspected, and the exported scenario was reduced
to independent tests in `e2e/agent/specs/formatting-mechanics.e2e.js` before fresh
replay. Browser assertions combine actual pointer/toolbar input and canonical
editor reads; inactive panes deliberately conceal Markdown markers, so visual
style checks complement source checks.

Fresh replay of `formatting-mechanics.e2e.js`: five scenarios passed. The owned
interactive browser and server were closed; replay stopped its own fixture server.

These browser fixtures exercise the mounted frontend with simulated IPC; they
do not verify Tauri persistence or publication. Composition events exercise the
guard transition, not a complete OS IME keyboard or physical mobile-device session.
Logical shortcut events avoid this host's keyboard-layout remapping. The session
reports the repository's known unsupported fixture publication-owner command;
this pass does not suppress that warning or claim publication coverage.
