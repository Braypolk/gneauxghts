# Smooth zoom and prevent browser selection/popups

Status: ready-for-human
Type: task

## Request

Zooming farther out gets choppy or hangs. Dragging and double-clicking highlight
the screen gray. Filename tooltips are unnecessary.

## Cause and correction

- Every camera change rebuilt filename objects and rewrote each SVG text's
  screen position, size, stroke and fade, including fully transparent names.
  Filenames now remain in world coordinates under the shared map transform,
  with one shared fade. Notes/names remain mounted, spacing stays fixed, and
  font size still scales linearly with zoom. Repeated zoom at the limit is a no-op.
- The map allowed native mouse selection on SVG role buttons and lacked
  WebKit-specific descendant selection/tap-highlight suppression. Mouse
  pointerdown now suppresses selection, retains keyboard focus explicitly, and
  allows dragging from dots/names. Touch taps still use deferred pointer capture.
  The reader remains outside the nonselectable map surface.
- Removed native SVG title tooltips and the duplicate hover preview. Hover still
  emphasizes dots and connections; clicked notes use the floating reader.
- The read-only lab's index.html injection did not run under SvelteKit, causing
  restarted previews to show browser fixture notes. Its launcher now prepends
  the explicit command adapter to the fixture module before installation.

## Evidence and validation

Same temporary browser diagnostic, 2,000 notes, 45 zoom-out wheel frames:

| Metric | Before | After |
| --- | ---: | ---: |
| SVG attribute mutations | 156,013 | 52,013 |
| Elapsed | 1,754 ms | 979 ms |
| Median frame interval | 16.8 ms | 16.7 ms |
| 95th percentile interval | 98.7 ms | 35.9 ms |
| Worst interval | 213.2 ms | 45.1 ms |

These are browser diagnostic timings, not a native performance guarantee.
Temporary instrumentation was removed. Thirteen main-map browser regressions
pass, including tooltip absence, label drag without selection or reader opening,
double-click, keyboard focus/navigation, passive search, live data and touch
pinch. Type checking reports zero errors/warnings. Production build passes.
