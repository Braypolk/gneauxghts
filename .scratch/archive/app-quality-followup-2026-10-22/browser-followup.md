# Browser failure follow-up

Two failures from the combined browser pass were reproduced with the repository
WDIO session loop (`quality-resize-diagnosis`, isolated port 1440).

## Compact search resize warnings

The 1440→390 viewport change produced 16 `ResizeObserver loop completed with
undelivered notifications` errors over approximately 450 ms. It settled afterward;
this was repeated feedback during the transition, not an endless loop.
Temporary preload instrumentation identified `MorphingContainers.measureContent`:
the measured search content height changes containing dock geometry during the
same observer delivery. Deferring only this owner's publication to an animation
frame changed the same controlled reproduction from 16 errors to zero.

The production owner now coalesces that measurement into one frame and cancels
the frame on destruction. Initial measurement and geometry calculation remain
unchanged. The compact retrieval-cue browser regression captures resize errors
through finite CSS transition settlement and verifies none occur.

## File-drop Retry obstruction

The existing image-drop regression failed at the actual Retry pointer click.
An unrelated authored selection remained selected after the drop, so its Code
toolbar button covered Retry's center. `elementFromPoint` confirmed the covering
Code icon before the fix and the Retry button afterward. This was not a keyboard
layout failure.

A file drop now places its caret at the resolved drop pointer before starting
the existing upload job. This retires the unrelated selection toolbar without
changing source text or the upload's shared Undo transaction. The regression
still tests an initially selected authored range, unchanged source on failure,
an actual Retry click, and retrying only the failed file; it additionally checks
the collapsed selection and absent toolbar.

## Verification and cleanup

- 31 affected image-upload, image-picker and selection-menu unit tests passed.
- `pnpm check` passed with zero Svelte errors/warnings and E2E TypeScript checks.
- Fresh replay: image-drop (4 scenarios) and retrieval-cues (3 scenarios), both
  spec files passed. Replay log contains zero ResizeObserver errors.
- Actual Retry pointer verification passed in the diagnostic session. Screenshot
  was inspected. Temporary preload wrappers were confined to that session.
- Named session closed; owned fixture server exited; clean replay stopped its
  own server. Temporary probe files and raw session artifacts were removed.

Fixture limitations remain the documented unsupported editor-publication owner
command and favicon requests. Expected injected search failure is part of Retry
coverage. No native persistence claim follows from this browser verification.
