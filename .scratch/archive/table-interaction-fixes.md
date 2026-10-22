# Table interaction fixes — 2026-10-22

Follow-up to [workspace improvements](workspace-improvements.md), based on the
user's two screen recordings. Corrected rendered-table cursor mapping, restored
inline selection formatting and stable edit geometry, and restricted image
selection to the importer's supported formats.

## Findings and changes

- External vertical margins were absent from CodeMirror's measured widget
  border box. Across several tables, the cumulative error misplaced clicks and
  caused Up movement to skip earlier text. An outer block now owns the vertical
  spacing as padding, which participates in height measurement. A four-table
  fixture verifies exact pointer-to-line mapping beyond line 100 and local Up
  movement through surrounding prose.
- Native cell inputs contributed their intrinsic widths to automatic table
  layout. Inputs now overlay the in-flow rendered preview, preserving column
  widths and row heights when entering/leaving edit mode at wide and narrow
  window widths. Authored content can still naturally resize a column.
- Native input selections now project validated canonical offsets and an anchor
  into the existing selection-menu controller/transient owner. The shared inline
  commands preserve cell focus and selection; native actions isolate their
  shared-history transaction so Undo does not remove a preceding table paste.
  Source mode retains the ordinary block-capable popup. One Escape dismisses the
  native popup and exits the cell. Retired cells cannot publish late input,
  composition or navigation events. Teardown/blur notifications are deferred
  outside reactive snapshot reads and identity-checked against newer targets.
- Desktop image selection uses a filtered native dialog with AVIF, BMP, GIF,
  JPEG, PNG, SVG and WebP extensions. The read-only command accepts no renderer
  paths and returns selected bytes to the existing upload owner. Mobile/browser
  inputs declare the same MIME/extension allowlist and validate both before
  import. Mobile retains the WebView input because native providers may broaden
  image filters or return content URIs rather than readable paths.

Existing document ownership, canonical Markdown, shared Undo and upload lifetime
rules remain authoritative. Architecture/invariant docs reflect the new seams.
Parallel correctness reviews found an iOS-only builder incompatibility, corrected
with desktop-gated dialog parenting and verified by an iOS simulator compile.

## Verification

- Full suite: 143 support tests and 1,476 frontend tests passed; one existing
  frontend test remains skipped. Type checks passed with no Svelte errors or
  warnings; production build passed.
- Focused native asset helper tests: 11 passed. The iOS simulator library
  `cargo check` passed with five unrelated existing warnings.
- Fresh maintained browser replay passed all 17 cases covering table geometry/navigation, formatting,
  focus, Undo/Redo, source and pane teardown, retired DOM, existing table editing,
  image selection and file drops. Existing source-selection/formatting-load
  regressions also pass (7 cases).
- Required named WDIO sessions retained traces and inspected screenshots, with
  exported/curated regressions and fresh replay. Final popup screenshot:
  `e2e/agent/.wdio/session/table-popup-final/screenshots/2026-10-22T16-25-19-423Z.png`.
  Owned sessions/servers were closed. Another chat's fixture on port 1423 was
  left alone; fresh replay used port 1429.

The browser fixture uses simulated IPC and does not access user notes. Tests
exercise real FileList/change events and verify native filter/read helpers;
the real OS modal was not manually operated. Native asset storage remains the
existing upload path. A physical WebDriver KeyB becomes logical `t` under the
host's keyboard layout, so the shortcut regression sends the intended logical
KeyboardEvent to the actual focused cell; actual toolbar clicks are also covered.

The combined replay logged one existing ResizeObserver undelivered-notification
diagnostic during a pane transition. The identical diagnostic was present in
the earlier discovery replay at 09:41, before these popup changes, and in the
ordinary source-formatting suite. No responsible observer was established in a
bounded follow-up; it was not suppressed. No reactive-state mutation errors
remain in the table regression, including native popup teardown/navigation.
