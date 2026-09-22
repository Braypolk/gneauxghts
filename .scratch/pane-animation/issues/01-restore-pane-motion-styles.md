# 01 — Restore pane motion styles at the rendered element

Status: resolved
Implementation: complete (2026-09-22)
Depends on: None

Read [the spec](../spec.md) and [findings](../validation.md#causes-and-corrections).

## Change

Move `.notepad-pane` and `.notepad-pane--collapsing` rules from `Notepad.svelte` to `NotepadPane.svelte`, where the root element is rendered. Make their relationship to the existing dynamic view-model classes explicit so Svelte scopes them to that element. Keep the active border inside `NotepadPane.svelte` so it follows the live pane bounds. Preserve the shared duration, easing, and reduced-motion tokens in `src/app.css`.

This step establishes working styles; the coordinated entrance and complete geometry fix belong to ticket 02. Avoid introducing a separate opening implementation that 02 would immediately replace.

## Verification

Through the rendered application, assert that the pane has the intended nonzero transition under ordinary motion and the closing pane visibly changes width/opacity before removal. A source-text or view-model class assertion alone would miss the original scope bug. Use the retained browser regression from ticket 03 to verify the close path.

## Comments

- Planned 2026-09-22. No application code changed during planning.

## Implementation evidence

Completed in the current working tree. See [validation results](../validation.md).
The final view uses Web Animations for coordinated motion; component-scoped
pane CSS defines the resting/collapsed layouts rather than a second CSS transition.
