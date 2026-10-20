# Removing parsing from the shared history root

Completed 2026-10-20 on primary `main`, based on `7e9532e4` with the marker-merge
patch installed. This follows the [parser investigation](../../../docs/research/markdown-giant-quote-parsing.md).

## Cause and change

Every editor document had a private headless CodeMirror state with the entire
Markdown editing extension bundle, in addition to each pane's language state.
The root's consumers only read text, record authored changes and manage shared
history; none consumes its syntax tree or invokes its keyboard handlers.
`documentRoot()` now installs only history and image-resize history grouping.
Authored edits, root publication, shared undo/redo, recovery and committed-content
adoption keep their existing owners and paths. Actual pane language support,
commands, view plugins and syntax consumers remain installed.

Three new regressions observe real Markdown parser starts, without replacing
parsing or exposing the private root. Before the correction, root lifecycle
operations started seven parses; a shared edit started two parses for one pane
and three for two panes. Afterward the headless lifecycle starts none, and the
small syntax-changing edit, undo and redo each parse only the attached panes.
The tests assert document outcomes and restored/removed emphasis in every pane.
The lifecycle case includes transient recovery, committed adoption/history
clearing, controller detachment and a recreated root.

This removes one unnecessary parser. It does not share the remaining pane
parsers. CodeMirror's language state retains a mutable parse context, including
its viewport, partial parse, fragments, skipped ranges and scheduled work.
Sharing that state between independently scrolled panes would couple their
parsing/publication. Sharing immutable completed trees would need a separate,
configuration- and document-revision-aware design; this change does not introduce
such a cache or patch CodeMirror's language state.

## Fresh full-app comparison

Both variants ran sequentially in the production Svelte application, runtime,
plugins and typography using deterministic browser IPC. Baseline is the original
root on `7e9532e4`; the after run removes the root extensions. Both retain the
same marker-merge patch. Each run passed all eight fixtures (six 1,000-line
controls and the 50,000-line giant quote with one/two panes), recording selection
and document operations. Apple M4 Pro, Node 24.2.0, Chrome 155.0.8059.85,
1440×857 CSS viewport; five warmups and twenty samples per operation. Initial
parsing/mounting/scrolling and fixture debounce settling are excluded. No tests,
builds or profiles ran concurrently. These are separate local runs, not an
interleaved A/B test or release-performance guarantee.

All table values are milliseconds for document edits. Two-frame timing includes
synchronous dispatch, forced layout and two animation frames; it neither measures
save completion nor proves all background parsing has finished.

| Fixture | Panes | Dispatch median, before → after | Dispatch P95, before → after | Two-frame median, before → after |
| --- | ---: | ---: | ---: | ---: |
| mixed, 1,000 lines | 1 | 3.4 → 4.2 | 5.9 → 5.4 | 33.4 → 33.4 |
| mixed, 1,000 lines | 2 | 4.4 → 4.8 | 7.7 → 7.0 | 33.3 → 33.4 |
| fence, 1,000 lines | 1 | 3.7 → 3.3 | 4.6 → 4.0 | 33.3 → 33.4 |
| fence, 1,000 lines | 2 | 2.3 → 2.5 | 4.3 → 4.3 | 33.4 → 33.4 |
| quote, 1,000 lines | 1 | 9.2 → 7.0 | 9.6 → 8.1 | 33.3 → 33.3 |
| quote, 1,000 lines | 2 | 12.2 → 9.6 | 12.5 → 10.1 | 33.4 → 33.4 |
| quote, 50,000 lines | 1 | 237.8 → 119.1 | 247.0 → 130.4 | 353.3 → 236.4 |
| quote, 50,000 lines | 2 | 360.9 → 244.9 | 372.2 → 258.9 | 480.8 → 366.4 |

Giant-quote dispatch medians improve 49.9% and 32.1%. Small mixed/fence controls
vary by less than one millisecond, with frame medians around 33 ms; those samples
do not establish a universal small-note speedup. Every sorted sample remains in
`full-app-after-root-parser-baseline.json` and
`full-app-after-without-root-parser.json` (generated local evidence).

Reproduce the baseline before applying this change, then use suffix
`-without-root-parser` after applying it:

```sh
GNEAUXGHTS_E2E_BROWSER_PORT=1423 \
  MARKDOWN_BENCHMARK_SUFFIX=-root-parser-baseline \
  MARKDOWN_BENCHMARK_GREP='(mixed|fence|quote) 1000 lines|quote 50000 lines' \
  node scripts/benchmarkMarkdown.mjs after full-app
```

The benchmark's `after` argument uses the caller's current source; it does not
reconstruct the original root. Do not use the older viewport `before` variant
as a baseline for this comparison.

## Remaining paragraph cost

Fresh Chrome CPU profiles sampled fifteen edits per pane count, including five
warmups, at a requested 1 ms interval. Profiled timing is excluded from the table.
Language parsing remains 86.37%/87.67% of all sampled time (inclusive, one/two
panes). `parseInline` self time is 24.68%/25.69%, `finishLeaf` 18.55%/18.40%, and
GFM Autolink parsing 12.54%/12.31%. `injectMarks` remains small at 0.30%/0.34%
self time. Inclusive rows overlap and must not be added together.

The remaining giant paragraph is still collected and parsed synchronously by a
parser step. CodeMirror checks its work budget between steps; reducing that
budget cannot interrupt the inline work. This fix does not establish one parse
start per giant-paragraph edit: pane background/partial parsing can also perform
work. A focused next investigation should count and locate those advances before
choosing immutable tree reuse, inline-parser work reduction or resumable parsing.
Changing paragraph boundaries in authored Markdown is not a proposed remedy.

Profiles and summaries remain locally as `quote-without-root-parser-cpu-*` and
`without-root-parser-cpu-summary.json`.

## Native macOS/WebKit and correctness

All 22 checks pass in four separate fresh native invocations: 12 caret/selection,
7 visible-Markdown/remount, 2 giant-quote and 1 native image lifecycle. The latter
imports a clipboard file, resizes, opens the viewer, persists/reopens, and covers
cut/undo. Giant quotes verify 100,000 marker spans and 50,000 emphasis spans in
every pane, syntax changes and restored syntax, and independent sibling selection
and scrolling synchronously and after frames.

Each native run used real IPC, disposable app data/vaults and the authorized
foreground lane. The unchanged native executable was reused after artifact
admission (SHA256
`35cddfbf1dc0f7155420f38b8bceacddd15dad6a64052552d82295ff472c8780`),
with the current frontend served by Vite. WebKit 605.1.15, 1200×800 CSS window,
16px/28px Geist; editor height 702px, width 1022px alone or 583px split. Five
warmups and ten recorded edits; no timing threshold.

| Panes | Dispatch median | Dispatch P95 | Two-frame median | Two-frame P95 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 95 ms | 98 ms | 109 ms | 203 ms |
| 2 | 188 ms | 196 ms | 209 ms | 818 ms |

No fresh native baseline was collected for this change. Native and Chrome use
different geometry, persistence and sampling; these are post-change observations,
not an engine comparison. The large split-pane frame tail remains unresolved.
Existing embedded-driver limitations for physical modified-key/click injection
remain as documented in the marker-merge record.

```sh
pnpm check
pnpm test
GNEAUXGHTS_E2E_BROWSER_PORT=1423 pnpm exec wdio run e2e/wdio.browser.conf.ts \
  --spec e2e/specs/browser/visible-markdown.spec.ts \
  --spec e2e/specs/browser/editor-formatting-load.spec.ts \
  --spec e2e/specs/browser/editor-cursor.spec.ts \
  --spec e2e/specs/browser/image-inventory-split.spec.ts \
  --spec e2e/specs/browser/image-interactions.spec.ts
GNEAUXGHTS_E2E_FOREGROUND=1 \
  MARKDOWN_NATIVE_OUTPUT=.scratch/archive/visible-range-markdown/without-root-parser-native.json \
  node --input-type=module -e 'import {runNativeSpecs} from "./e2e/support/nativeSuite.mjs"; process.exitCode=await runNativeSpecs(["e2e/specs/browser/editor-cursor.spec.ts","e2e/specs/native/visible-markdown.spec.ts","e2e/specs/native/markdown-marker-merge.spec.ts","e2e/specs/native/image-interactions.spec.ts"]);'
```

- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript passes.
- `pnpm test`: all 77 support and 1,364 frontend tests pass; one opt-in benchmark
  skipped. Focused shared-root, undo/selection, image-command and publication
  regressions also pass (35 tests).
- Browser correctness: 35 pass, one existing failure. The temporary search-image
  preview escapes its bar at 420×900 (`image-interactions.spec.ts:319`). A fresh
  single-case control restoring the original root also fails the identical
  assertion. The optimized root was restored in `finally`. This matches the
  previously recorded [image-inventory limitation](../markdown-image-inventory.md).
  Other image shared-history/resize/typing/delete/cut checks pass. The failing
  assertion was not weakened and the unrelated search layout was not changed.
- Native: all 22 pass; eight full-app benchmark and two CPU-profile fixtures pass.
- No Rust source changed; Rust/backend/live-provider gates were not rerun.
- `git diff --check` passes. Selected logs remain as `root-parser-*.log` and
  `without-root-parser-*.log` beside the generated measurements; generated
  evidence is local, while this report and reproducible tests are tracked.
