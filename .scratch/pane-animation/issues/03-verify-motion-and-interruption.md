# 03 — Verify pane motion and decide whether deeper work is needed

Status: resolved
Implementation: complete (2026-09-22)
Depends on: 02

Read [the spec](../spec.md). This ticket validates the initial fix and records whether deferred investigation is warranted.

## Browser regression

Add a focused pane-animation browser spec using the real workspace and deterministic backend. Sample geometry across actual transitions instead of asserting CSS strings alone. Cover:

- One-to-two opening and closing left or right; note/note and note/chat layouts.
- Widths below the solo cap, at the original 1440 px baseline, and wide enough to exercise the split cap.
- Related collapsed and expanded; verify ordinary Related toggle motion still works afterward.
- Reduced motion, rapid close/reopen, resize during motion, and cleanup after interruption.
- Surviving editor identity, selection, scroll, focus, and valid pane membership after completion.

Use deterministic controller tests for failed/stale close and completion cleanup where necessary. Avoid brittle exact frame-count assertions: require intermediate geometry, expected direction with rounding tolerance, stable endpoints, and no second jump after cleanup.

## Checks and evidence

Run `pnpm check`, the affected pane/workspace controller tests, architecture fitness if coordination wiring changes, and the new focused browser spec plus existing document/pane browser coverage. Run a targeted native check through the isolated Tauri E2E fixture for actual WebKit motion; do not exercise the user's live vault. If native verification is unavailable, explicitly record that limitation rather than equating Chrome timing with native smoothness.

Repeat the original measured scenario before/after under matching conditions, with evidence buffered outside active Vite writes. Record viewport, fixture, renderer, reduced-motion preference, frame gaps, long tasks where supported, pane geometry, and final cleanup. Do not introduce a universal performance SLA from the original single baseline.

## Completion decision

If the first pass looks continuous in the tested browser/native scenarios, stop. If roughness persists, capture its exact reproduction and distinguish text rewrapping from dropped frames. Document a bounded next investigation into native layout/paint, CodeMirror measurements, complex note content, or fixed-width clipped/translated text. Do not implement that deferred rendering strategy as part of this ticket.

## Comments

- Planned 2026-09-22. The user requested the animation fixes first and deeper evaluation only if needed.

## Implementation evidence

Completed in the current working tree. See [validation results](../validation.md).
The final view uses Web Animations for coordinated motion; component-scoped
pane CSS defines the resting/collapsed layouts rather than a second CSS transition.
