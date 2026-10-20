# Markdown image inventory: implementation and benchmark

Implemented on 2026-10-19 in the existing dirty worktree based on `9d2644f4e4bdfce2f552e81c9d92dbc48a8fda13`. Table removal and all unrelated changes were preserved. Visible-range Markdown formatting and the full-string application callback / immutable-body migration remain separate work.

## Outcome and design

Ordinary edits no longer cold-parse the complete note independently in each pane. At two million characters, the matched runtime diagnostic measured **210.307 → 0.678 ms** for one image-free pane and **412.550 → 0.748 ms** for two. With reference images, ordinary edits measured **212.368 → 12.515 ms** and **421.838 → 13.914 ms** respectively. These are isolated Node dispatch medians, not rendered typing latency.

The original retained diagnostic was reproduced before production edits: 50k characters took 5.278/9.983 ms for one/two panes, 500k took 50.674/100.636 ms, and 2m took 204.139/407.275 ms. The larger matched matrix below then measured the same runtime and editing boundary on image-free, inline-image and reference-image fixtures before and after this fix.

[`imageInventory.ts`](../../src/lib/features/notepad/images/imageInventory.ts) owns derived inventory computation behind the existing image state field:

- It counts `!` characters once using CodeMirror `Text` chunks, then updates the count from inserted/deleted text. Every currently supported image syntax requires `!`, so zero proves the inventory empty without string conversion or parsing. Escapes and literal contexts are deliberately not interpreted by this gate.
- When `!` is present, it passes changed-range-adjusted `TreeFragment`s from its own previous **complete** Lezer tree into the same Markdown/Obsidian parser. Parsing finishes synchronously before extracting inventory. It does not use CodeMirror's potentially partial published syntax tree.
- It retains complete-document reference lookup, Obsidian comment masking and image extraction. Definition changes and literal delimiters can affect distant uses, so extraction still visits the complete parsed document. No viewport filtering or guessed local invalidation is introduced.
- A weak transition cache shares computation when the runtime forwards the same `ChangeSet` to sibling panes. It verifies equal starting `Text` content before sharing: a reusable changeset alone is insufficient. Weak references to starting text/results avoid a strong version chain through history entries. Cache misses remain correct. The no-bang path skips this equality check because sharing an empty inventory would cost more than computing it independently.
- Pane image source/selection/gesture state and lifetimes remain local. Runtime history, document adoption, persistence and callbacks are unchanged. There is no new mutable note owner.

A fast path alone would leave image-containing notes with cold full parses. Reusing complete parser trees plus sharing transitions addresses that demonstrated case without introducing a second custom Markdown state machine. Fine-grained inventory maintenance was deferred: safely invalidating references, escaped syntax, code/HTML and comments across arbitrary edits needs more machinery, while complete extraction preserves the existing behavior directly.

## Method and fixtures

The reusable [`image-inventory.probe.ts`](diagnostics/image-inventory.probe.ts) lives outside routine test discovery. It uses the real `EditorDocumentRuntime`, pane synchronization and `DocumentEditingService.recordUserEdit`, plus clean-buffer checking in the callback. Pane views are state-backed test doubles. Formatting view plugins, Svelte reactive effects, DOM/layout, IPC and persistence are excluded. Root editor language/history remain real.

Environment: macOS arm64, Node 24.2.0, pnpm 12.9.1, Vitest 3.2.6; installed locked CodeMirror state 6.6.0 and Lezer Markdown 1.6.4. This is a local diagnostic run, without allocation profiling or an exclusive-machine latency guarantee.

Every series has **4 warmups and 21 timed operations**, sorted for median (index 10), p95 (index 19) and maximum (index 20). Counts include all 25 operations. Runtime/pane creation and initial inventory construction are outside the timed series. The before and final after matrices ran sequentially with identical probe source and fixtures; wall times were 122.53s and 12.74s. Subsequent tests/builds are not part of those samples.

All fixtures are exactly 50k, 500k or 2m ASCII characters initially. The body repeats `Plain note text with enough ordinary prose to resemble a multiline Markdown note.\n\n` and truncates it around these optional boundaries:

- `none`: no image syntax initially.
- `inline`: `![first](a.png)` at the beginning and `![[a.png]]` at the end.
- `reference`: full, collapsed and shortcut uses at the beginning, `[ref]: a.png` at the end, separated by almost the entire note.

One or two panes share a runtime; two-pane series alternate the editing pane. `ordinary` appends one character, preserving images. `imageOrDefinition` changes the first inline destination or distant reference definition between `a.png` and `b.png`; the `none` fixture instead adds/removes its first image at the end on alternating operations. Selection-only series follow those edits (the initially empty fixture then contains one image); a separate no-bang production-state regression verifies selection-only updates on truly image-free text too.

The retained [raw matrix](diagnostics/image-inventory-results.json) includes all timings, tails and counts. These are comparisons of the whole specified dispatch path, not additive component timings.

## Ordinary edits

| Characters | Initial fixture | Panes | Before median / p95 (ms) | After median / p95 (ms) |
| --- | --- | --- | --- | --- |
| 50,000 | none | 1 | 5.183 / 5.694 | 0.127 / 0.216 |
| 50,000 | none | 2 | 10.175 / 11.016 | 0.074 / 0.105 |
| 50,000 | inline | 1 | 5.287 / 5.607 | 0.439 / 0.573 |
| 50,000 | inline | 2 | 10.336 / 10.636 | 0.365 / 0.403 |
| 50,000 | reference | 1 | 5.246 / 5.474 | 0.375 / 0.520 |
| 50,000 | reference | 2 | 10.341 / 10.626 | 0.376 / 0.451 |
| 500,000 | none | 1 | 51.885 / 52.293 | 0.213 / 0.229 |
| 500,000 | none | 2 | 103.431 / 104.746 | 0.212 / 0.241 |
| 500,000 | inline | 1 | 51.945 / 53.213 | 2.481 / 4.683 |
| 500,000 | inline | 2 | 103.305 / 106.708 | 3.134 / 5.696 |
| 500,000 | reference | 1 | 51.981 / 54.894 | 2.516 / 4.870 |
| 500,000 | reference | 2 | 103.539 / 106.013 | 3.032 / 5.543 |
| 2,000,000 | none | 1 | 210.307 / 215.423 | 0.678 / 0.794 |
| 2,000,000 | none | 2 | 412.550 / 417.280 | 0.748 / 0.889 |
| 2,000,000 | inline | 1 | 205.998 / 210.307 | 14.597 / 20.888 |
| 2,000,000 | inline | 2 | 412.941 / 418.780 | 16.541 / 19.507 |
| 2,000,000 | reference | 1 | 212.368 / 219.625 | 12.515 / 15.688 |
| 2,000,000 | reference | 2 | 421.838 / 430.808 | 13.914 / 17.737 |


## Image and definition edits

The `none` series alternates first-image insertion and complete removal. Its median is a cold insertion (11 of the 21 timed operations insert), so the remaining first-marker cost is intentionally visible.

| Characters | Initial fixture | Panes | Before median / p95 (ms) | After median / p95 (ms) |
| --- | --- | --- | --- | --- |
| 50,000 | none | 1 | 5.311 / 7.106 | 5.026 / 6.123 |
| 50,000 | none | 2 | 10.128 / 10.675 | 5.090 / 5.623 |
| 50,000 | inline | 1 | 5.225 / 6.022 | 0.332 / 0.426 |
| 50,000 | inline | 2 | 10.332 / 11.466 | 0.420 / 0.542 |
| 50,000 | reference | 1 | 5.179 / 5.307 | 0.391 / 0.513 |
| 50,000 | reference | 2 | 10.490 / 11.188 | 0.435 / 0.529 |
| 500,000 | none | 1 | 51.243 / 52.400 | 51.699 / 54.035 |
| 500,000 | none | 2 | 103.502 / 104.751 | 52.916 / 54.265 |
| 500,000 | inline | 1 | 51.948 / 53.115 | 2.519 / 6.781 |
| 500,000 | inline | 2 | 103.461 / 106.277 | 3.026 / 5.702 |
| 500,000 | reference | 1 | 51.733 / 52.324 | 2.707 / 4.814 |
| 500,000 | reference | 2 | 103.290 / 104.742 | 2.973 / 5.722 |
| 2,000,000 | none | 1 | 210.331 / 214.040 | 210.370 / 213.881 |
| 2,000,000 | none | 2 | 411.405 / 417.891 | 212.840 / 220.105 |
| 2,000,000 | inline | 1 | 205.403 / 210.536 | 13.226 / 17.065 |
| 2,000,000 | inline | 2 | 420.390 / 427.615 | 16.235 / 19.798 |
| 2,000,000 | reference | 1 | 210.621 / 215.161 | 11.517 / 16.085 |
| 2,000,000 | reference | 2 | 422.679 / 431.213 | 17.147 / 24.193 |

## Counts and known performance limits

| Series, all sizes | Before: one / two panes | After: one / two panes |
| --- | --- | --- |
| Ordinary edit, no bangs: parse calls | 25 / 50 | 0 / 0 |
| Ordinary edit, no bangs: `Text.toString` calls | 50 / 75 | 25 / 25 |
| Existing inline/reference images: parse calls | 25 / 50 cold | 25 / 25 with fragments |
| Existing inline/reference images: `Text.toString` calls | 50 / 75 | 50 / 50 |
| Alternating first-image insertion/removal: parse calls | 25 / 50 | 13 / 13 cold |
| Alternating first-image insertion/removal: `Text.toString` calls | 50 / 75 | 38 / 38 |
| Selection-only: parse / conversion / callback counts | 0 / 0 / 0 | 0 / 0 / 0 |

Content-changing series still invoke the application callback 25 times. No-bang edits now have only its one full-string conversion per dispatch; the callback migration is outside this fix. Selection medians are 0.001–0.002 ms both before and after (see raw tails); they have no content notification.

This is deliberately not constant-time image processing. Remaining costs include:

- One initial chunk scan per distinct `Text`, and scanning replaced/deleted/inserted text. Large replacements remain proportional to replacement size. Initial image-containing pane construction can still cold-parse more than once because panes start with distinct text objects; measured dispatch sharing does not claim shared cold mounts.
- The first `!` in a previously bang-free note needs a cold complete parse. Removing the last `!` discards its tree, so repeated removal/reinsertion repeats that cost. Even ordinary exclamation punctuation takes the conservative parser path; `!` absence is sufficient, not necessary, for image absence.
- Image-containing edits still construct a full string for extraction and traverse the complete tree for definitions, literal ranges and images. Comment masking scans the body and retains the existing literal/comment range checks. Large numbers of comments/literals/images can add further cost; this probe has few images.
- Incremental parsing can invalidate most or all of the document after structural edits such as an opening fence. A giant single paragraph may also have much less reusable structure than these multiline fixtures. The full completeness guarantee takes priority over a fixed latency budget.
- Sharing validates the old document with `Text.eq`, which can inspect document-size-dependent content across distinct pane trees. Widget rebuilding, root editor parsing and DOM/layout remain outside this diagnostic.

No native typing-latency, allocation or memory-improvement claim is made.

## Correctness and validation

The production-state regressions compare each incremental result with a fresh full parse, alongside explicit expected images and destinations. They cover inline/wiki images; full/collapsed/shortcut references; definitions before and after uses across ~65k characters; definition changes, removal, renaming, duplicates and normalization; unresolved-to-resolved uses; offscreen code fences, inline code, HTML and Obsidian comments; comments hiding definitions or uses; escapes; indented code; list/quote/inline/plain-pipe forms supported by the current parser; position shifts; multiple changes; first/last image-syntax transitions; identical replacement content; 250 deterministic syntax/context mutations; and applying one ChangeSet to different documents. Existing backend inventory fixtures still pass, preserving intentional syntax limitations.

A real-runtime two-pane regression edits from both panes, checks one image parse per forwarded edit and shared inventory identity, verifies independent selection/scroll and lifetime, and exercises actual shared undo/redo with explicit destinations. Empty-note edits and selections cause no image parsing/string conversion.

The mounted Chrome journey uses different viewports across a ~50k-character note, updates distant references from either pane, compares full inventories to a cold parse in both panes, checks passive selection/scroll, renders widgets in both panes and opens a four-occurrence gallery including offscreen images. Fixture setup waits for measured image heights and keeps a scrollable tail so geometry clamping is not confused with runtime scroll preservation. Production scroll behavior was not changed.

Validation results are recorded in the completion record, including any unrelated browser failure and its baseline comparison. This is browser correctness validation, not a timed rendered-typing benchmark. No native desktop or iOS run was performed for this frontend-only change.

The subsequent correctness review passed 64 image/runtime tests and 1,200 additional multi-range edits across larger split-pane documents, all matching fresh full parses. Browser/native journeys were not rerun during that review.

## Reproduction

From the repository root:

```sh
cp docs/research/diagnostics/image-inventory.probe.ts src/lib/features/notepad/editor/imageInventoryDiagnostic.temporary.test.ts
pnpm exec vitest run src/lib/features/notepad/editor/imageInventoryDiagnostic.temporary.test.ts
rm src/lib/features/notepad/editor/imageInventoryDiagnostic.temporary.test.ts
pnpm exec vitest run src/lib/features/notepad/images
GNEAUXGHTS_E2E_BROWSER_PORT=1437 pnpm exec wdio run e2e/wdio.browser.conf.ts --spec e2e/specs/browser/image-inventory-split.spec.ts --spec e2e/specs/browser/image-interactions.spec.ts
```

For the baseline comparison, temporarily restore only `images/imageState.ts` and `images/imageEmbedParser.ts` from starting revision `9d2644f4e4bdfce2f552e81c9d92dbc48a8fda13`, run the same copied probe, then restore the implementation. Preserve every other working-tree change and do not run a live browser while swapping files. Instrumentation restores prototypes in `finally` blocks; remove temporary test copies before routine tests.
