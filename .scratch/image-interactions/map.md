# Image interactions

## Notes

User approved implementation of the [recording-derived specification](spec.md). Existing canonical Markdown, shared undo, save and Note Timeline ownership remain in place.

## Decisions-so-far

- [01](issues/01-image-model-and-source-edits.md): resolved. Implemented syntax-aware full-note inventory for wiki, Markdown and local reference images; excluded literal/comment contexts and preserved source spans.
- [02](issues/02-asset-loader-and-pane-local-widgets.md): resolved. Replaced shared/global DOM with view-owned widgets and lifecycle cleanup.
- [03](issues/03-image-selection-and-keyboard-actions.md): resolved. Added conditional rendered-image selection, Enter/source preview, Tab width entry, Space viewer activation, shifted plus/equals/minus, reset, delete, exact-Markdown clipboard copy/cut, and undo/redo through the shared root.
- [04](issues/04-image-resize-gestures.md): resolved. Implemented proportional four-corner preview, available-column clamping, pointer capture, and cancellation on Escape/cancel/lost capture/blur/doc changes/reconfiguration/destruction.
- [05](issues/05-image-viewer.md): resolved. Implemented the native modal dialog through the existing transient owner, including full-note occurrence inventory, missing/retry UI, browse/fit/zoom/pan, focus trapping, and lifetime-checked origin selection/scroll restoration.
- [06](issues/06-import-and-document-lifecycle.md): resolved. Imports retain selected text until all files save, reuse partial successes on retry, and discard completion after job/range/view lifetime changes.
- [07](issues/07-interaction-verification-and-docs.md): resolved. Added browser image/error/delay fixtures, focused image/parser/cache/geometry/runtime tests, ten real browser image journeys, native WebKit import/cut/cancel/persistence coverage, and the 500-image inventory probe.

- [08](issues/08-select-before-opening.md): resolved. First click selects for deletion/editing; clicking the selected image opens its viewer, while Zoom/Space activate directly.

Final [validation](validation.md) records checks, measurements, review fixes and automation limits.

## Fog

No unresolved implementation tickets. External-app raster clipboard input, hardware touch/pen/IME and a long-running large-raster memory soak remain manual validation limits.
