# Image interaction implementation validation

Date: 2026-10-02. Scope: the accepted [specification](spec.md), implemented in the existing working tree. Unrelated concurrent work was preserved.

## Implemented journey

- Wiki embeds, inline Markdown images, and local explicit/collapsed/shortcut references form one document-order inventory. Code, escaped embeds, HTML/comments, and cross-paragraph Obsidian comments are excluded.
- Whole-image selection, conditional source/width entry, retained source preview, keyboard size/reset, embed delete, and exact-Markdown clipboard copy/cut use the normal editor transaction path. Shift selection, composition, read-only state, multiple selections, and unrelated shortcuts keep native editor behavior.
- Four proportional corner handles preview locally, capture the pointer, commit once, and cancel on Escape, cancellation/lost capture, blur, content changes, reconfiguration or destruction. Unchanged widths create no content transaction. Repeated keyboard resizing uses the document's existing undo root with isolated burst boundaries.
- Document resources coalesce asset reads and retain bounded bytes (128 entries / 24 MiB of data-URL text). Widgets, gestures, source state, and DOM remain local to each pane. Fingerprints refresh changed assets; Retry bypasses cached data. Canonical filesystem containment rejects traversal and symlink escape.
- The modal viewer owns focus through the transient UI union, includes offscreen/duplicate occurrences, supports browsing/fit/zoom/two-axis pan, and returns to a still-live originating editor selection/scroll position. Viewer interactions do not write Markdown.
- Clipboard imports retain selected text until all saves succeed, reuse partial successes on Retry, and reject retired-view or changed-range completion. Embed deletion/cut/undo retain asset files. Persistence continues through the existing NoteDraftState, shared editor runtime, save queue, and Note Timeline path.

## Checks

Final verification passed. After the full suites, the clipboard/layout refinements were rechecked with 68 focused unit tests, the complete browser image suite, a clean type check, and a fresh native build/journey.

| Check | Result |
| --- | --- |
| `pnpm check` | 0 Svelte errors/warnings; E2E TypeScript passed |
| `pnpm exec vitest run` | 140 files, 1,003 tests passed |
| `pnpm build` | Production SvelteKit/static build passed; existing large-chunk advisory remains |
| `cargo test --offline --manifest-path src-tauri/Cargo.toml` | 711 unit tests + 19 architecture checks passed; 16 existing tests ignored |
| Browser image journeys | 10 passed on Chrome 154.0.8037.98 / macOS |
| Browser cursor and selection-menu regressions | 12 cursor + 2 selection-menu tests passed |
| `node e2e/support/buildNative.mjs` | Native debug build passed |
| Native image journey | Import, resize, modal return, cancellation, cut/undo, asset retention, persisted reopening passed on WebKit 605.1.15 / macOS |
| `git diff --check` | Passed |

The first full Rust run had 710 passing tests and one sandbox-denied localhost TCP listener. The listener test passed with local networking permitted. The final full run used that permission and passed. This was an environment restriction, not a changed test expectation.

## Measurements and inspection

A reproducible Vitest probe builds a 192,890-character note with 500 images, then applies 500 pane selection updates. One focused run measured 29.08 ms for initial state/inventory creation and 98.47 ms total for all selection updates (about 0.20 ms/update). Selection changes reuse the same parsed inventory. Content changes currently parse the new document once; incremental Lezer fragments are a possible optimization if typing profiles justify them.

Cache tests prove concurrent read coalescing, fingerprint refresh, root separation, retry after failure, disposal during pending work, 128-entry eviction, and exclusion of a 25 MiB data-URL result from retention. Visual screenshots were inspected; a block-preview alignment issue was fixed and a browser geometry assertion now verifies alignment with source text. Browser checks verify both sibling widgets remain connected and retain their DOM across resize; either pane can undo the shared authored change. No streaming asset protocol was introduced because these measurements do not establish a need.

Review fixes cover shifted `+`, reference-preserving Tab/reset, identical-width no-ops, burst undo boundaries, pointer capture/lost capture, comments spanning blank lines, escaped and percent-decoded historical references, and retained previews while a newly typed destination is temporarily invalid. A follow-up independent review verified all original findings were corrected. Clipboard event support also covers native Copy/Cut commands and browser keyboard layouts that deliver those events without the expected shortcut key event.

## Evidence and limits

Browser fixtures use actual SVG image bytes with mocked IPC, including delayed/error imports and below-fold images. Native tests use a disposable vault, actual Rust image commands/files, the WebKit editor/viewer, OS clipboard writes for cut, and an app/session reopen. The native harness emits driver-detection and mock-store cleanup advisories, but its embedded WebKit session runs all assertions and exits successfully. Import input is constructed as a WebKit `ClipboardEvent` containing a `File`; an external application placing a raster on the macOS clipboard was not automated. Driver pointer input exercises WebKit listeners; hardware touch, pen, and IME composition remain manual checks. Guard tests cover composition/read-only rejection.

The byte budget describes retained data-URL text, not decoded GPU memory. Selection reuse and bounded cache retention were measured/tested; a long-running OS memory soak with many large raster files was not performed. Historical binary bytes remain unversioned, as specified. Native fullscreen, wheel/pinch, and gallery wraparound remain outside the accepted scope.

Logs and visual snapshots from verification are in `/private/tmp/image-*.log` and `/tmp/gneauxghts-image-*.png`; they are disposable evidence, not project dependencies.

## Follow-up: select before opening

User corrected the click default: first image-body click selects the embed for deletion/editing, and clicking the selected image again opens the viewer. Clicking another image selects that occurrence first. Zoom and Space continue opening directly. The regression covers selection/focus, Delete/undo, subsequent activation, switching occurrences, and unchanged authored Markdown after browsing.

`pnpm exec wdio run e2e/wdio.browser.conf.ts --spec e2e/specs/browser/image-interactions.spec.ts` passed all 11 journeys in 31 seconds on Chrome 154. `pnpm check` passed with 0 errors; three CSS compatibility warnings originate in the existing Atlas prototype files. `git diff --check` passed. Follow-up logs: `/private/tmp/image-select-click-browser.log` and `/private/tmp/image-select-click-check.log`.
