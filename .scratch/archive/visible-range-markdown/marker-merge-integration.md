# Marker-merge integration and verification

Completed 2026-10-20 on primary `main`, based on `9aad697f`.

## Change and regression signal

Pinned `@lezer/markdown@1.6.4` through pnpm's existing dependency-patch mechanism.
Both distributed module formats append merged siblings rather than repeatedly
inserting quote/list markers into the remaining inline-element array. Existing
nesting conditions and recursion are retained. No Markdown dialect, paragraph
boundary, document ownership or parser scheduling change is included.

Before the patch, the new deterministic regression counted 3,998,000 shifted
array elements for a 2,000-line nested quote with emphasis, failing in both ESM
and CommonJS. The sixteen syntax/property/incremental checks already passed.
After the patch all eighteen pass. Frozen expected trees came from unmodified
1.6.4; coverage includes multiline emphasis, links, code, lists/tasks, images,
lazy continuation, opaque trees and per-node properties. The work bound avoids a
machine-dependent timing assertion.

Large multiline inline containers can still repeatedly copy nested child arrays.
One giant paragraph is still a synchronous parser step, and root/pane language
states still repeat parsing. This patch removes the measured sibling-insertion
hotspot; it does not establish linear time for every Markdown shape.

## Full application, Chrome

The existing 50,000-line nested quote with bold text ran through production
Svelte panes, runtime, plugins and typography with deterministic browser IPC.
Five warmups and twenty recorded edits per operation; fixture preparation and
debounce settling excluded. Apple M4 Pro, Node 24.2.0, Chrome 155.0.8059.85,
1440 by 857 CSS viewport. Tests, builds and profiles ran sequentially.

The baseline is the earlier actual-main run in
`full-app-after-main-image-inventory.json`, not the temporary parser-alias copy.
These are separate local runs of the same workload, not an interleaved A/B test.

| Panes | Dispatch median, stock → patched | Reduction | Patched P95 | Dispatch + two frames, stock → patched |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 518.3 → 236.3 ms | 54.4% | 248.9 ms | 772.5 → 357.1 ms |
| 2 | 763.5 → 364.8 ms | 52.2% | 373.4 ms | 1016.1 → 486.7 ms |

The six 1,000-line mixed/fence/quote controls recorded edit medians of
3.4–12.3 ms and two-frame medians of 33.3–33.4 ms. Giant-quote selection medians
were 2.2/1.8 ms. There is no fresh stock control for the small-note measurements,
so they establish observed latency rather than a quantified regression margin.
All eight benchmark fixtures passed; sixteen operation rows retain all samples
in `full-app-after-marker-merge.json`.

New profiles sampled fifteen edits per pane count at a requested 1 ms interval,
including five warmups. `injectMarks` self time is 0.20%/0.22%, compared with
49.71%/56.72% in the earlier main profiles. Language parsing remains
88.64%/89.64% inclusive; `parseInline` is 23.41%/27.34% self, `finishLeaf`
19.17%/18.87%, and GFM Autolink parsing 12.68%/13.10%. Percentages use all sampled
time; inclusive rows overlap. Profiled timing is excluded from the latency table.

## Native macOS WebKit

A freshly built, separately identified E2E debug executable used a disposable
app-data directory and vault with real native IPC. Pinned SHA256:
`35cddfbf1dc0f7155420f38b8bceacddd15dad6a64052552d82295ff472c8780`.
The authorized foreground lane was used for real frames, focus and selection.

All twenty-one checks passed: twelve cursor/range-selection journeys, seven
visible-Markdown/remount checks, and two new full-app giant-quote cases. The new
cases validate 100,000 quote-marker spans and 50,000 emphasis spans in every pane,
remove/restore emphasis from the source pane, and preserve the sibling selection
and viewport both synchronously and after frames. The one-pane source and both
positions of a split source are exercised by the edits and timing operations.

The final giant-quote rerun explicitly checks visible document focus before and
after timing. Five warmups and ten recorded edits; WebKit 605.1.15,
1200 by 800 CSS window, 16px/28px Geist. Actual pane widths were 1022px alone and
583px in a split, with a 702px editor height.

| Panes | Dispatch median | Dispatch P95 | Dispatch + two frames median | Two-frame P95 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 187 ms | 196 ms | 200 ms | 287 ms |
| 2 | 278 ms | 285 ms | 805 ms | 847 ms |

No stock native baseline was collected. These native and development-Chrome
observations have different engines, geometry, persistence and sample counts;
they must not be used as an engine speed comparison or release-performance claim.
The two-pane native frame samples have a substantial tail despite faster dispatch.
Giant-quote typing can still stall.

An initial background attempt timed out on `fence-scroll` while waiting for frames
and was cancelled. Its partial observations are excluded. The complete foreground
run passed all twenty-one checks, and the two giant cases passed again after
foreground admission and post-frame sibling assertions were added. The new test
now rejects before native launch unless `GNEAUXGHTS_E2E_FOREGROUND=1` is explicit.
Background paint/frame verification is not claimed.

The embedded driver cannot faithfully inject modified special keys or single
click detail. The existing cursor suite delivers those events through the real
CodeMirror handlers and asserts WebKit's resulting DOM selection/geometry; it
does not establish physical OS keyboard/mouse injection for those operations.

## Completed checks

- Frozen install with scripts disabled and a one-off `strictDepBuilds=false`:
  passed without changing repository build policy or running dependency scripts.
- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript passes, including the
  final native/harness edits.
- `pnpm test`: 77 support checks and 1,361 frontend tests pass; one opt-in benchmark
  skipped. Final `pnpm test:support` rerun: all 77 pass.
- Browser correctness: all 24 checks pass across visible Markdown, formatting
  readiness, cursor/range selection, and split-pane image inventory. The actual
  main image check passes; the temporary-copy timeout remains historical research.
- Native WebKit: 21 distinct checks pass, plus the final two-case focused rerun.
- Eight unprofiled application benchmark fixtures and two CPU-profile fixtures:
  pass, with complete sample files retained locally.
- Diagnostic source syntax and `git diff --check`: pass.

No Rust production behavior changed; the native artifact was rebuilt, but the
unrelated complete Rust/backend/live-provider gate was not rerun for this patch.

## Reproduce

Run sequentially from the main checkout after installing the frozen lockfile:

```sh
node --test e2e/support/markdownParserPatch.test.mjs
pnpm check
pnpm test
node e2e/support/buildNative.mjs
GNEAUXGHTS_E2E_FOREGROUND=1 pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/browser/editor-cursor.spec.ts --spec e2e/specs/native/visible-markdown.spec.ts --spec e2e/specs/native/markdown-marker-merge.spec.ts
GNEAUXGHTS_E2E_BROWSER_PORT=1423 MARKDOWN_BENCHMARK_SUFFIX=-marker-merge MARKDOWN_BENCHMARK_GREP='(mixed|fence|quote) 1000 lines|quote 50000 lines' node scripts/benchmarkMarkdown.mjs after full-app
GNEAUXGHTS_E2E_BROWSER_PORT=1423 MARKDOWN_PROFILE_PREFIX=.scratch/archive/visible-range-markdown/quote-marker-merge-cpu pnpm exec wdio run e2e/wdio.browser.conf.ts --spec e2e/specs/browser/markdown-quote-profile.spec.ts
```

Raw JSON, profiles and selected verification logs stay local and ignored in this
folder. [The investigation](../../../docs/research/markdown-giant-quote-parsing.md)
records upstream findings and explicitly historical prototype evidence.
