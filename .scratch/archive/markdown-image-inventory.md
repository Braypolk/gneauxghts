# Markdown image inventory performance fix

Completed 2026-10-19. This implementation preserves the dirty starting worktree, including table removal, and is independent of visible-range Markdown formatting and the deferred full-string callback / immutable-body migration.

The existing image state now uses a derived inventory module that updates a conservative `!` count from changed text, skips conversion/parsing when zero, reuses its own complete Lezer tree through changed fragments when needed, and shares identical forwarded edits across panes after checking equal starting content. Full-document reference/comment/image extraction remains authoritative for positions, layout and viewer navigation. Pane selections, scroll, source state and interaction lifetimes remain independent; runtime/history/document/persistence owners are unchanged.

## Evidence

See [implementation, full matrix and reproduction](../../docs/research/gneauxghts-image-inventory.md), [raw results](../../docs/research/diagnostics/image-inventory-results.json), and [reusable diagnostic](../../docs/research/diagnostics/image-inventory.probe.ts).

At 2m characters, matched ordinary-edit medians changed as follows (Node runtime + real editing service, excluding DOM/layout):

| Fixture | One pane, before → after | Two panes, before → after |
| --- | --- | --- |
| Image-free | 210.307 → 0.678 ms | 412.550 → 0.748 ms |
| Inline/wiki images | 205.998 → 14.597 ms | 412.941 → 16.541 ms |
| Reference images | 212.368 → 12.515 ms | 421.838 → 13.914 ms |

No-bang edits cause zero inventory parses/conversions. Image-containing edits use one incremental parse and one inventory conversion per document dispatch, including two panes. The application callback still converts once, outside this scope. Initial first-`!` insertion remains a cold parse; full extraction, equality, structural invalidation and cold mounts can remain document-size-dependent. Selection-only updates perform no parsing/conversion/notification. These measurements are not rendered typing-latency claims.

Known performance limits: first-`!` cold parsing and full inventory extraction remain document-size-dependent. Their measured costs and other remaining work are detailed in the benchmark report.

## Correctness and checks

- Complete inventory parity and explicit expected assets for inline/wiki/full/collapsed/shortcut images, distant definitions in both orders, definition mutations/removal/renaming/duplicates, unresolved resolution, escapes, code/HTML/Obsidian comments (including distant hidden definitions), supported block forms, shifts/multi-changes, first/last syntax transitions, identical content, and 250 deterministic syntax/context edits.
- Real shared-runtime edits from either pane: one parse, shared derived inventory, independent selection/scroll/lifetime and actual shared undo/redo. Empty-text fast path and changeset reuse against unequal documents are covered.
- New mounted Chrome split-inventory journey passes: different viewports, distant definitions updated from either pane, full inventory compared to a cold parse, independent passive selection/scroll, widgets in both panes and offscreen gallery occurrences.
- Existing image interaction browser suite: 11 pass; 1 unrelated failure at `image-interactions.spec.ts:319`, the search-query preview containment/geometry assertion. The same grepped journey was rerun with **only the original imageState.ts and imageEmbedParser.ts restored**, and failed at the identical assertion (expected true, received false). Implementation files were restored automatically afterward. The existing search UI changes were preserved; this task does not fix that separate failure.
- `pnpm test`: 59 support tests plus 1,353 frontend tests / 154 files pass, with temporary benchmark copies removed. After adding one final distant-comment regression, the focused image-state suite passes all 16 cases (the full run already included its other 15).
- `pnpm check`: zero Svelte errors/warnings and E2E TypeScript passes.
- `pnpm build`: production build passes.
- Repository Python checks: 16 pass (`python3 -W error::ResourceWarning -m unittest discover -s scripts/tests -p 'test_*.py' -v`).
- `git diff --check`: passes.
- Subsequent correctness review: 64 image/runtime tests plus 1,200 additional multi-range edits across larger split-pane documents pass against fresh full parses. Browser/native journeys were not rerun during that review.

No Rust implementation changed in this slice; Rust/native/iOS suites were not run. Browser correctness was mounted, while the performance numbers remain isolated Node dispatch measurements. No allocation profile was collected. Benchmark instrumentation lives outside routine discovery and restores prototype patches in `finally` blocks; temporary copies were removed.
