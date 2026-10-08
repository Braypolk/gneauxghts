# Zoom over empty map space on desktop

Status: ready-for-human
Type: task

## Request

Desktop zoom works when hovering a cloud but not over the gaps between clouds.

## Correction

The wheel listener was attached to the SVG, whose visible hit surfaces consisted
of graph geometry. The leading cause is native WebKit wheel-event hit testing
over unpainted SVG space. Listen directly on the full HTML `.plot` with
`passive: false`, and add a transparent, viewport-sized SVG background with
`pointer-events="all"`. Keep the background outside the camera transform, behind
all graph geometry. Remove the SVG wheel listener so events are handled once;
remove the HTML listener on unmount. Reader/search remain outside `.plot`.

## Evidence and verification

- Fourteen browser map regressions pass. Added real browser wheel actions over
  the background, asserting scale decreases/increases and no note is selected.
- A temporary native WebKit fixture exercised the production map at empty-space
  coordinates. The event targeted the background rectangle, reached `.plot`,
  and was prevented; zoom worked both ways. The native driver's wheel action
  dispatches a DOM `WheelEvent`, so this verifies WebKit event routing rather
  than reproducing physical trackpad dispatch. The same diagnostic could zoom
  before the correction, consistent with the synthetic/native distinction.
- Native setup needed route initialization to settle before publishing fixture
  data. One parallel native run did not advance the zoom RAF within three
  seconds; the focused diagnostic passed on rerun and confirmed target/handler
  delivery. No production timing behavior was changed for the harness.
- Type checking reports zero errors and warnings. Temporary native fixture and
  event instrumentation were removed; the browser regression is retained.

Physical scrolling in the user's desktop window remains the final confirmation
of the reported native-only symptom.
