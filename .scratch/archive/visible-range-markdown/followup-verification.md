# Native verification, full-app measurements and giant-quote profiling

Completed 2026-10-20, America/Denver. This follow-up verifies the viewport-bounded
implementation; it does not change production state ownership or redesign the
parser, image inventory or Markdown callbacks.

## Native macOS / WebKit

The real Tauri debug executable was built with the isolated `e2e-wdio` feature.
Its pinned SHA256 was
`805dd8970f2fb3059ab3bb741b10575a74d6d92a2c5fcb9252b2bd66494a6d7e`.
The embedded driver reported WebKit 605.1.15. Disposable app-data, documents and
vault directories were owned and removed by the existing native harness.

- Seven background checks pass: long fence scrolling and true boundaries;
  nested-quote appearance and selection; conceal/reveal and atomic navigation;
  independent split-pane formatting, selection and scrolling; distant syntax
  changes; incomplete parser publication/readiness; actual Svelte pane remount
  with a restored deep reading position and a deliberately delayed idle parser.
- Twelve foreground checks pass with the user's explicit permission to take
  focus: wrapped text cursor geometry across paragraph/list/quote/heading/task/
  fence contexts; due-date control geometry after editing/navigation; WebKit
  range selection and selection styling over code and plain table Markdown;
  coordinate-based cursor placement after multiple code blocks.
- The initial foreground run passed 11/12. The selection check failed because
  embedded driver 1.3.0's `dispatch_key_event` omits modifier flags for special
  keys. The observed selection was collapsed at 17 instead of spanning 4–17.
  The native test now delivers Shift+Right keyboard events to the real CodeMirror
  handler, then asserts WebKit's native range and the editor model agree. It
  does not set the expected range directly. Chromium still uses WebDriver keys.
  Physical OS keyboard injection is not established by this workaround.

Passing logs: `native-formatting.log`, `native-cursor.log`. The failed diagnostic
is retained as `native-selection-driver-failure.log`. The service emits a
`tauri-driver not found` diagnostic even though this configuration successfully
uses the embedded provider; the reporter and test outcomes establish execution.

```sh
node e2e/support/buildNative.mjs
pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/visible-markdown.spec.ts
# Foreground permission is required before running this command:
GNEAUXGHTS_E2E_FOREGROUND=1 pnpm exec wdio run e2e/wdio.native.conf.ts \
  --spec e2e/specs/browser/editor-cursor.spec.ts
```

## Full-app benchmarks

Both complete runs pass all 18 fixtures: three kinds × three sizes × one/two
panes. Every fixture reports selection and document operations, five warmups
and twenty samples each: 36 result rows per implementation. Raw sorted samples,
P95 and actual pane geometry are in `full-app-before.json` and
`full-app-after.json`. Median is the upper middle sample; P95 is nearest rank.

The real Svelte application, production pane plugins, typography, document
runtime, draft callback and autosave/search/related scheduling remain installed.
Both panes open the same real app note through the normal split control.
Initial content replacement, complete fixture parsing, scroll positioning and
a 1.2-second debounce settling period are outside timing. Edits replace one
character near the first pane's viewport; selection changes affect that pane.
Each timed observation includes synchronous dispatch, forced geometry and two
animation frames, using the same procedure in both variants.

These are sequential headless Chrome 155.0.8059.85 runs on the same Apple M4 Pro
and Node 24.2.0. The viewport is 1440×857 CSS pixels. Production typography is
16px/28px Geist; the first one-pane editor is approximately 1022×759. Visible
range line counts at 50,000 lines are 53 mixed, 69 fence and 37 quote per pane.
Exact dimensions/fonts/counts are retained per fixture in the JSON. CPU/power
governors and OS scheduling were not controlled.

The IPC backend is deterministic browser scaffolding. These measurements
include real synchronous callbacks and observed asynchronous app work within
the two-frame window, but do not measure native file persistence, durable save
completion or native compositor latency. This is a development-mode app
benchmark, not a release-build performance guarantee.

50,000 body lines; all values are median milliseconds, before → after:

| Kind | Panes | Selection dispatch | Edit dispatch | Edit plus two frames |
| --- | ---: | ---: | ---: | ---: |
| Mixed | 1 | 30.9 → 0.9 | 123.6 → 91.9 | 133.3 → 100.0 |
| Mixed | 2 | 31.3 → 1.7 | 242.5 → 181.8 | 250.0 → 184.3 |
| Fence | 1 | 8.2 → 1.6 | 14.8 → 8.8 | 33.3 → 33.4 |
| Fence | 2 | 8.7 → 1.1 | 24.9 → 12.7 | 33.3 → 33.3 |
| Quote | 1 | 48.2 → 2.0 | 843.2 → 798.9 | 1087.7 → 1042.5 |
| Quote | 2 | 47.5 → 1.4 | 1440.8 → 1336.4 | 1688.5 → 1601.0 |

After-change quote edit dispatch P95 is 833.1 ms with one pane and 1345.7 ms with
two. Bounded decorations improve selection work substantially; giant-quote
editing remains slow. The original isolated mounted measurements exclude other
pane plugins, so their lower edit timings are not contradictory.

```sh
GNEAUXGHTS_E2E_BROWSER_PORT=1423 node scripts/benchmarkMarkdown.mjs before full-app
GNEAUXGHTS_E2E_BROWSER_PORT=1423 node scripts/benchmarkMarkdown.mjs after full-app
```

The baseline runner uses the exact original five source files and restores
current source in `finally`. Run sequentially without source edits or competing
builds/tests. The `all` option retains its original pure-plus-mounted meaning;
`full-app` is a separate opt-in lane.

## Giant-quote CPU profiles and focused experiment

Chrome's CPU profiler sampled the current real app at a requested 1 ms interval.
Each profile captures fifteen document edits after fixture preparation, including
five warmups; its adjacent measurement JSON reports the remaining ten samples.
Profiling adds overhead, so the unprofiled table above is the latency evidence.
The complete stacks include synchronous dispatch and background work observed
through two frames. Vite dependency URLs/line numbers in the profile refer to
transformed modules, not original TypeScript source lines.

| Sampled stack/function | One pane | Two panes |
| --- | ---: | ---: |
| Lezer common `advance`, inclusive | 92.11% | 90.83% |
| Markdown `injectMarks`, self | 50.06% | 52.03% |
| `parseImageEmbeds`, inclusive | 28.02% | 37.33% |
| `buildMarkdownDecorations`, inclusive | 0.01% | 0.02% |
| Runtime `#notifyMarkdownChange`, inclusive | 0.09% | 0.05% |

Percentages use all sampled time, including idle/native/GC observations.
Inclusive rows overlap and must not be added. Total sampled time was 14.41 s
and 26.72 s. The CPU profile is statistical attribution, not exact per-method
instrumentation; sub-millisecond presentation work may receive few samples.

The dominant stack is Markdown parsing, particularly `finishLeaf` →
`injectMarks`, which merges quote markers into inline elements using repeated
array splices in installed `@lezer/markdown` 1.6.4. The image inventory calls
`parseImageEmbeds(doc.toString())` for changed documents, and that function
performs an independent complete parser pass even for this image-free fixture
(`imageState.ts`, `imageEmbedParser.ts`). Live root/pane language parsing is
additional work. The Markdown callback/materialization path remains unchanged,
but its sampled share is small in these particular quote profiles.

A direct Node grammar experiment isolated the paragraph/inline shape, without
editor state, custom extensions, DOM, image inventory or callbacks. Two warmups
and five complete parses per fixture; medians in ms:

| Body lines | Original two-level quote with bold | Same length, emphasis replaced by spaces | Quote paragraph break every 25 lines |
| ---: | ---: | ---: | ---: |
| 1,000 | 3.45 | 2.43 | 2.75 |
| 10,000 | 33.87 | 25.23 | 24.05 |
| 50,000 | 439.54 | 123.71 | 120.40 |

The third fixture preserves all original text lines and adds an empty quoted
line every 25 lines. This is a diagnostic grammar variation, not a proposed
change to user notes. Combined with the CPU stacks, it implicates the giant
paragraph's quote-marker/inline merge rather than decoration count as the main
remaining latency. Reducing duplicate full parses and investigating the parser
merge are evidence-backed next optimization targets; no such redesign was
implemented in this verification task.

Raw profiles: `quote-cpu-1.cpuprofile`, `quote-cpu-2.cpuprofile`; their adjacent
`*-measurements.json` files retain profiled observations. Aggregation is in
`quote-cpu-summary.json`; direct-parser samples are in `parser-ablation.json`.

```sh
GNEAUXGHTS_E2E_BROWSER_PORT=1423 \
  MARKDOWN_PROFILE_PREFIX=.scratch/archive/visible-range-markdown/quote-cpu \
  pnpm exec wdio run e2e/wdio.browser.conf.ts --spec e2e/specs/browser/markdown-quote-profile.spec.ts
node scripts/summarizeMarkdownProfile.mjs \
  .scratch/archive/visible-range-markdown/quote-cpu-1.cpuprofile \
  .scratch/archive/visible-range-markdown/quote-cpu-2.cpuprofile \
  > .scratch/archive/visible-range-markdown/quote-cpu-summary.json
node scripts/profileMarkdownParser.mjs > .scratch/archive/visible-range-markdown/parser-ablation.json
```

## Final checks and limits

- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript passes.
- Repeated Chrome formatting/readiness/cursor regressions: all 23 pass.
- Native: all 19 distinct checks pass after the demonstrated driver correction.
- Full-app benchmark: 18 baseline + 18 current fixtures pass.
- CPU profiling: both one/two-pane fixtures pass.
- Prior 1,345 Vitest and 59 support tests remain the implementation gate; this
  follow-up changes diagnostic harnesses/test input delivery, not product code.

Native performance, release-mode performance, iOS, physical OS keyboard input,
and save-completion latency are not established by these measurements.
