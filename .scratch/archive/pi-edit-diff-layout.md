# Pi edit diff layout preference — 2026-10-17

Completed the requested Settings choice between Inline and Side by side for chat
edit reviews. Settings → Appearance → Chat edit diffs is searchable by diff,
inline, side by side, and edit review. Inline is the default, including for
existing installations without a saved choice. Like editor typography, the
choice is device-local localStorage state, loaded when the shared reactive
presentation store initializes.

Inline shows shared text once with removed and added spans together. Both views
derive from the same patch presentation helper, preserve blank-line notices and
escaped text, and retain the exact technical diff disclosure/fallback. Switching
layouts changes presentation only; the retained review and publication flow are
unchanged. Side by side retains the existing responsive comparison.

## Verification

- 258 tests passed across 27 affected frontend files, including inline/side by
  side rendering, addition/deletion reconstruction, preference initialization and
  persistence, and Settings discovery.
- Svelte diagnostics: 0 errors and 0 warnings; E2E TypeScript checks passed.
- Headless browser Settings journey passed: discover the setting through search,
  select each layout, and verify selection after a full page reload.
- Seven actual macOS native editing journeys passed. The pending-review journey
  switches from Inline to Side by side through Settings, returns to the same
  review, restarts the real fixture process, verifies the saved layout and pending
  review, and applies once. Other journeys retain Apply, Discard/Stop, stale-base,
  authority, and edited-source navigation coverage.
- Visually inspected actual native screenshots of the inline review and the
  Settings control. Highlighting and controls remain legible in the split pane.

All acceptance notes and provider responses are disposable fixtures. No native
code changed. Physical-device testing is not claimed. Existing native restart
cleanup warnings did not prevent the embedded driver from completing.

## Separate replacement highlighting correction — 2026-10-18

A two-line edit (`chuck` → `Tim`, `6am` → `8am`) exposed that the readable
highlighter only retained a shared prefix and suffix. It marked the whole middle
as replaced, joining the added first line onto the removed second line in inline
view. Side by side preserved the layout but also highlighted unchanged words.

The presentation helper now compares exact word/whitespace tokens with `diff`
8.0.4 (already used by Pi, now a direct dependency). Shared text and line breaks
between replacements appear once in inline view, and both layouts highlight only
changed words. A bounded comparison falls back to the complete technical patch
when its edit-distance limit is exceeded. Candidate bytes and approval behavior
are unchanged.

Regression coverage stages and renders the reported two replacements in both
layouts with and without a final newline, verifies exact before/after
reconstruction, and checks the large-comparison fallback. A temporary mounted
browser harness passed text and geometry assertions and produced visually
inspected screenshots of both corrected layouts; the harness was removed.
All 349 affected chat/settings tests, frontend/E2E type checks and the production
build passed. Native process acceptance was not rerun for this presentation-only
correction.
