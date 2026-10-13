# Dependency patches

## `@codemirror/view@6.43.1`

`enforceCursorAssoc()` corrects the native DOM selection at soft line wraps
from a deferred measurement. It must only write that selection while its editor
owns focus. In macOS WebKit, `Selection.collapse()` otherwise focuses the
contenteditable editor even after the user has focused another input. This made
search immediately close after clicking from a wrapped note at narrow widths.

The patch adds the focus guard at the selection writer in both distributed
module formats. Keep the version-pinned patch until an upstream release guards
this path; rerun `e2e/specs/native/search-focus.spec.ts` before removing it.
That native test uses the mounted editor's wrapping and deferred measurement,
checks repeated editor-to-search focus transfers, and checks focused typing at
the same wrap boundary.
