# Add rendered image selection and keyboard editing actions

Status: resolved
Type: task
Depends on: 01, 02

## Scope

Implement pane-local rendered/source interaction state and the key/action table in [the specification](../spec.md). Arrow navigation selects a whole rendered image; Enter/source controls expose source with preview, and Tab targets the size. Add growth/shrink/reset, embed delete, exact-Markdown copy/cut, and viewer-open intent. Keep regular typing and multi-range/text selection semantics.

The contextual toolbar derives from the interaction field. Suppress the text selection menu for exact image selections and coordinate image surfaces with the existing transient owner. Conditional Tab must win over the current highest-priority indentation binding without changing ordinary indentation.

## Main files

- Private interaction state/extension/commands under `images/`.
- `editor/editorExtensions.ts`, `editor/editorShortcuts.ts`, `editor/selectionMenu.ts`, `editor/cursorExtension.ts`
- `pane/paneTransientUiState.ts`, `pane/paneTransientUiController.svelte.ts`

## Acceptance

- Arrow, Shift-arrow, Enter, Tab, Space, `+`, `=`, `-`, `0`, Escape, delete, copy/cut, undo/redo follow the specification.
- Clipboard failure never deletes an embed; no action deletes asset bytes.
- Read-only, IME composition, modified shortcuts, text inputs, and mixed selections receive no image mutation.
- Shared runtime remains the only content undo owner; image changes broadcast while pane selection remains local.
- Browser tests verify actual focus, toolbar/caret state, event precedence, and source-plus-preview behavior.

## Comments

Key-size increments and minimum width use proposed defaults, to be tuned through visual validation.

## Answer

Added conditional rendered-image selection, Enter/source preview, Tab width entry, Space viewer activation, shifted plus/equals/minus, reset, delete, exact-Markdown clipboard copy/cut, and undo/redo through the shared root. Copy/Cut events cover native menu commands as well as shortcut handling. Whole-image selection suppresses the text menu; read-only/composition/multiple-selection guards preserve native editor behavior.

Evidence: [implementation validation](../validation.md).
