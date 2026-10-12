# Cancelled block drags

Status: ready-for-agent
Priority: P1

## Scope

Separate pointercancel cleanup from successful block-drop commit. Define touch drag intent so scrolling or interrupted gestures do not reorder note content.

## Acceptance

A cancelled drag preserves exact Markdown and does not open a formatting menu. A completed drag still works and supports Undo.
