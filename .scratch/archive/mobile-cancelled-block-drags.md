# Cancelled block drags

Reproduced the defect through the mounted editor: touch `pointercancel` moved the first paragraph after the third. The same test now preserves exact Markdown, hides previews and ignores a later pointerup.

The block-handle plugin separates cancellation from successful pointerup. Matching cancellation/capture loss, window blur, hidden visibility, document changes and teardown clear gesture state/listeners without moving content or opening formatting. Only the active pointer may finish the gesture. Touch dragging belongs to the explicit move handle (`touch-action: none`); surrounding content keeps native scrolling/selection. Completed taps still open formatting, and completed mouse/touch drops still support Undo.

Document-change cancellation schedules geometry measurement rather than reading layout during CodeMirror's update. A mounted regression verifies the new edit survives and the handle plugin remains installed.

Validation: nine mounted drag tests pass, plus two existing editor geometry/Markdown checks, four control-sizing checks and three block-extent unit tests. Svelte/E2E type checks pass. These tests dispatch synthetic pointer events in Chrome; real iOS touch scrolling, implicit capture and system interruptions still require simulator/physical-device validation through the release gate.
