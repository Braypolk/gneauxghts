# Giant quotes after integration with main

Verified 2026-10-20 (America/Denver) on local main commit
`7f200721f519177421043adf6a2e3f2215336928`.

The viewport formatting implementation was committed directly on top of
`f2544c33` (Avoid full Markdown image reparses on ordinary edits). Main's image
inventory implementation was retained unchanged. Unrelated research documents
were not staged. The original working tree remains preserved.

## Same full-app quote workload

Repeated the existing 50,000-line two-level quote with inline bold, using one or
two real Svelte application panes. The comparison is against the prior
viewport-bounded implementation **before** main's image-inventory fix, recorded
in `full-app-after.json`; it is not the earlier full-document-decorator baseline.

Both runs use the same production pane plugins and typography, root/pane runtime,
selection/edit locations, 1440×857 CSS viewport, five warmups and twenty samples
per operation. Initial full parsing, mounting, scrolling and fixture debounce
settling remain outside timing. The same Apple M4 Pro, Node 24.2.0, Chrome
155.0.8059.85, CodeMirror view 6.43.1 and Lezer Markdown 1.6.4 were used. No other
tests/builds ran during the benchmark or CPU profiles.

Median milliseconds; old viewport worktree → combined main:

| Panes | Edit dispatch | Reduction | Edit plus two frames | Main dispatch P95 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 798.9 → 518.3 | 35.1% | 1042.5 → 772.5 | 525.1 |
| 2 | 1336.4 → 763.5 | 42.9% | 1601.0 → 1016.1 | 780.2 |

Selection-only medians were 2.0 → 0.7 ms with one pane and 1.4 → 2.0 ms with two;
both still observe approximately 33.3 ms for the two-frame window. These small
selection changes do not establish a material selection regression or an image
inventory benefit for selection. The improvement of interest is edit latency.

The backend remains deterministic browser IPC, and these are local development
Chrome measurements. They do not measure native WebKit latency, durable saves or
release-mode performance. Even with the improvement, giant-quote edits remain
slow enough to stall typing.

## CPU attribution on combined main

Two new Chrome profiles sampled fifteen edits each at a requested 1 ms interval,
including five warmups. Profiling adds overhead; use the unprofiled table for
latency. Percentages below use all sampled time; inclusive rows overlap.

| Function/stack | One pane | Two panes |
| --- | ---: | ---: |
| Live language parsing, inclusive `work` | 93.23% | 92.08% |
| Markdown `injectMarks`, self | 49.71% | 56.72% |
| Markdown decoration builder, inclusive | 0.04% | 0.01% |
| Runtime Markdown callback, inclusive | 0.10% | 0.08% |

Neither profile contains a sampled `parseImageEmbeds` or
`parseImageEmbedDocument` frame. This agrees with main's conservative zero-!
path, whose zero-parser-call behavior is covered by the image-inventory tests.
Previously image extraction's complete parse occupied 28–37% of sampled time.
The live root/pane parser still processes the giant quote paragraph, with
`injectMarks` remaining its largest self-time hotspot. Bounding presentation and
removing image reparses have not eliminated that parser cost.

Generated raw evidence remains local (ignored by this folder's .gitignore):

- `full-app-after-main-image-inventory.json`: four rows and all sorted samples.
- `quote-main-cpu-1.cpuprofile`, `quote-main-cpu-2.cpuprofile`: complete stacks.
- Adjacent `*-measurements.json` files: profiled observations and pane geometry.
- `quote-main-cpu-summary.json`: reproducible stack aggregation.

Reproduce from main, sequentially without competing tests or builds:

```sh
GNEAUXGHTS_E2E_BROWSER_PORT=1423 \
  MARKDOWN_BENCHMARK_SUFFIX=-main-image-inventory \
  MARKDOWN_BENCHMARK_GREP='quote 50000 lines' \
  node scripts/benchmarkMarkdown.mjs after full-app
GNEAUXGHTS_E2E_BROWSER_PORT=1423 \
  MARKDOWN_PROFILE_PREFIX=.scratch/archive/visible-range-markdown/quote-main-cpu \
  pnpm exec wdio run e2e/wdio.browser.conf.ts --spec e2e/specs/browser/markdown-quote-profile.spec.ts
node scripts/summarizeMarkdownProfile.mjs \
  .scratch/archive/visible-range-markdown/quote-main-cpu-1.cpuprofile \
  .scratch/archive/visible-range-markdown/quote-main-cpu-2.cpuprofile \
  > .scratch/archive/visible-range-markdown/quote-main-cpu-summary.json
```

## Combined-main validation

- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript passes.
- `pnpm test`: 59 support tests and 1,361 frontend tests pass; the opt-in pure
  benchmark is skipped in the normal suite.
- Browser: 24 checks pass across visible Markdown, app formatting/readiness,
  cursor/native range geometry, and split-pane image inventory.
- Giant-quote benchmark: both one/two-pane fixtures pass, four operation rows.
- CPU profiling: both one/two-pane fixtures pass.
- `git diff --check`: passes.

Native tests were not rerun after this integration. The earlier 19 native checks
remain historical verification of the preceding viewport worktree; this follow-up
establishes correctness and latency of the combined app in Chrome.
