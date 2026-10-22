# Image loading layout — 2026-10-21

Image widgets now reserve authored dimensions or a previously observed intrinsic
size while their versioned asset URL resolves and the image loads. A new unsized
asset reserves a 320px-wide, 16:9 frame until its natural size is available; its
first load can therefore change layout. Loading shows a skeleton with an
accessible busy/status state and respects reduced motion.

Document resources retain at most 128 intrinsic-size hints, keyed by vault,
asset name and resolved URL version. Disposal clears them. Each pane continues
to own its DOM, layout and gestures. Loading does not author dimensions or dirty
Markdown. Resize handles require a loaded, selected, writable image; retry and
error states remain available. Hidden loading images keep their intrinsic
viewport so WebKit does not derive SVG natural dimensions from the placeholder.

## Verification

Verified together with the remaining patched CodeMirror/Lezer upgrade against
`7c11ad70`. Independent Standards and Spec reviews found no actionable issues.

- Unit regressions cover vault isolation, URL-version invalidation, bounded LRU
  retention, invalid dimensions and disposal. The complete frontend suite passes
  **1,418 tests**, with one existing skip; **139 support checks** also pass.
- The exported `e2e/agent/specs/image-skeleton.e2e.js` replay passes. It holds URL
  resolution, asserts the loading frame and busy state, then checks following
  text stays in place for authored 240×120 dimensions and a cached natural
  400×200 size. Both exported agent tests pass.
- Browser image interactions (12 cases) and inventory/split (1 case) pass,
  alongside cursor, search and dock regressions: **68 cases across five specs**.
- A freshly rebuilt disposable native app passes image import/resize/viewer/
  reopen persistence (1 case), production asset admission/version/cache behavior
  (3 cases), and large raster/many-image/large-note delivery (3 cases). Visible
  Markdown (7), foreground wrapped-cursor focus (2), and 50,000-line quote editing
  in one/two panes (2) also pass: **18 cases across six native specs**.
- Frozen install, typechecks and production build pass. The production build
  retains the existing large-chunk advisory.
- Both benchmark files and all six workloads pass. Vitest's module export-getter
  overhead warnings limit interpretation of these isolated timings; no image
  performance improvement is claimed from them.

The full browser/native suites were not rerun for this final integration pass.
At this verification point the pre-existing native pane-motion width assertion
was still open and was not reported as passing. It reproduced with both editor
dependency graphs; the [later resolution](../../.scratch/archive/native-pane-motion-admission.md)
corrects a pre-admission assertion error and passes the unchanged native journey.
Native image-loading observations here establish behavior, not foreground
latency guarantees. The [editor upgrade report](codemirror-lezer-upgrade-2026-10-21.md)
retains the matched large-document performance evidence and its limits.
