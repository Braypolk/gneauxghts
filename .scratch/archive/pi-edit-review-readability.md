# Readable Pi note edit review — 2026-10-17

Completed the presentation change prompted by the raw patch review screenshot.
The default review now shows plain-text Before/After blocks, changed-word
highlighting, and separately numbered changes. It uses the surrounding card's
width to choose columns or stacked blocks. Unchanged context, file/hunk headers
and technical newline markers are absent from the main view. Additions, removals,
blank lines and changed property/Markdown lines remain reviewable. Spacing-only
changes get an explicit notice.

The original exact patch remains under collapsed “Show technical diff”. If the
patch cannot be completely interpreted, the original patch is shown directly.
All note content is escaped text. This UI projection does not change the stored
review schema, candidate, approval hash, native policy, publication or recovery.

## Verification

- **243 tests passed** across 25 affected chat/frontend architecture files.
- Eight review tests cover the reported screenshot, word highlighting,
  separated hunks, added/deleted paragraphs, blank lines, changed property and
  patch-like Markdown, HTML escaping, malformed/truncated fallback, disabled
  controls and otherwise invisible final-line-break changes.
- **Six actual macOS native editing journeys passed**, including Apply,
  Discard/Stop, changed canonical base, independent write permission/direct mode,
  grant scope, and the same pending review across a real process restart.
  Native acceptance now checks both Before/After text and absence of metadata
  and patch headers in the primary review. All notes are disposable fixtures.
- Svelte diagnostics: **0 errors, 0 warnings**; E2E TypeScript checks passed.
- Visually inspected the real macOS review screenshot in a narrow split pane:
  text wraps, highlights are legible, the comparison stacks, technical details
  start collapsed, and decision controls remain visible.

No native code changed. Physical-device testing is not claimed. Existing native
restart cleanup warnings did not prevent the embedded driver from completing.
