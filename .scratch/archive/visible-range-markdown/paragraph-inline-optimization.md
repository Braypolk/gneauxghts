# Paragraph and inline parsing follow-up

Completed 2026-10-20 on primary `main`, based on `5a9ea9fd`, after the marker-merge
and history-root corrections. This implements two focused skips and retains a
probe for the remaining repeated paragraph work.

## Safe skips and regression evidence

**Inline recognition:** the Markdown loop previously called every builtin
recognizer at every character. Nine builtin functions have unconditional guards
on their first character. The pinned Markdown patch now compiles ordered ASCII
buckets and one non-ASCII fallback per configured parser. Only those known
function identities are filtered; custom functions, replacements of builtin
names and GFM/custom extensions retain their original calls and relative order.
Disabled recognizers remain disabled. The earlier marker merge is retained.
No paragraph boundaries, delimiter semantics, note bytes or parse scheduling
were changed. No document-sized result cache was added.

A real-parser work regression failed before the change at 397,955 builtin calls
for a 50,000-character nested quote. It now observes 15,996, in both ESM and CJS.
Fourteen frozen pre-change syntax trees cover escapes, entities, code, HTML,
angle links, Unicode emphasis, hard breaks, links/images, multiline quotes,
GFM, optional extensions, disabled syntax and tables. Additional checks cover
custom replacements of builtin names, precedence and nonzero inline offsets.

**Mixed-tree reuse:** the inline-only split-pane profile exposed another cost:
`StructureCursor.hasNode()` sought through the previous tree even when the
candidate was a buffered node. Such nodes return `null` for `TreeCursor.tree`
and cannot match a physical tree by identity. The new pinned `@lezer/common`
patch rejects that comparison before seeking. It does not skip the mixed-language
nesting callback, claim a node was reused, or bypass embedded parsing.

The corresponding real mixed-parser regression failed at 491,972 tree-side
checks for a 50,008-character edit. It now observes 2,113 in both module formats.
Frozen HTML/code mount trees and overlay positions survive incremental edits.
Further coverage resumes a stopped, buffered quote containing HTML/code, then
shifts and edits its content while comparing syntax and mounts against fresh
parses. Across both additions, 44 new support checks pass. Existing opaque-tree,
property, incremental marker and array-work regressions also remain green.

Patch pins:

- `@lezer/markdown@1.6.4`: `c7dd992d6093c1514e09c7155255c7caf5c6279f41b024a97e56d588b862c8cb`.
- `@lezer/common@1.5.2`: `0d8b1547cae8d65b1aa17107785e55a2516545ff13e51dc018a82d8a4ba1be52`.

The common patch applies consistently to the existing language dependencies.
Package versions and build-script policy are unchanged. A frozen install with
`--ignore-scripts --config.strictDepBuilds=false` passes; the latter is a one-off
invocation setting, not a repository policy change.

## Fresh full-app benchmark

Original root-free main, inline-only, and combined variants ran sequentially in
the production Svelte panes, runtime, plugins and typography, with deterministic
browser IPC. Apple M4 Pro, Node 24.2.0, Chrome 155.0.8059.85, 1440×857 CSS viewport.
Each variant passed eight fixtures, five warmups and twenty samples per operation.
Initial parsing/mounting/scrolling and fixture debounce settling are excluded.
Timing workloads, tests and profiles ran separately. These are local sequential
observations, not interleaved A/B results or release guarantees.

All values below are milliseconds for document edits, original → combined.
Two-frame time includes dispatch, forced layout and two animation frames; it does
not establish save completion or completion of all background parsing.

| Fixture, body lines | Panes | Dispatch median | Dispatch P95 | Two-frame median |
| --- | ---: | ---: | ---: | ---: |
| mixed, 1,000 | 1 | 4.6 → 3.1 | 5.9 → 5.1 | 33.4 → 33.3 |
| mixed, 1,000 | 2 | 4.6 → 5.8 | 8.2 → 6.2 | 33.3 → 33.4 |
| fence, 1,000 | 1 | 3.3 → 3.8 | 4.1 → 4.5 | 33.3 → 33.3 |
| fence, 1,000 | 2 | 3.1 → 2.5 | 4.7 → 4.1 | 33.4 → 33.3 |
| quote, 1,000 | 1 | 6.8 → 6.2 | 7.6 → 7.4 | 33.4 → 33.3 |
| quote, 1,000 | 2 | 9.5 → 7.3 | 9.9 → 7.8 | 33.3 → 33.4 |
| quote, 50,000 | 1 | 119.2 → 83.9 | 131.3 → 84.6 | 238.5 → 167.8 |
| quote, 50,000 | 2 | 246.0 → 172.2 | 252.0 → 179.3 | 367.8 → 259.6 |

Giant-quote dispatch improves **29.6% with one pane and 30.0% with two**. Final
two-frame P95 is 171.6/274.7 ms versus 241.8/378.7 ms originally. Mixed/fence
controls vary by −1.5 to +1.2 ms; their frame medians remain around 33 ms. These
single runs do not establish universal small-note speedups or regression bounds.

The inline-only intermediate variant recorded giant dispatch medians of
84.4/168.9 ms and two-frame medians of 170.0/257.1 ms. Its split two-frame P95
was 724.9 ms. The mixed-tree guard removes demonstrated wasted work and a profile
hotspot; its added benefit is not a further median-dispatch improvement. Sparse
frame tails depend on background scheduling, so the intermediate P95 change is
not a guarantee about worst-case latency.

An isolated Node prototype gave a quote fresh-parse median of 105.7 → 68.1 ms.
That diagnosis excluded app/custom extensions, history, layout and persistence;
the full-app table is the evidence for application latency.

## Remaining repeated work

The retained opt-in probe wraps actual Markdown parser starts, advances and
inline calls in `try/finally`, after preparing real application panes. For three
separate giant-quote edits, followed by 1.2 seconds of background work each, it
observed **one synchronous and two background full-paragraph inline parses per
pane** before the changes. The final combined variant still shows that pattern.
Each inline section is 1,249,995 characters. This is observed behavior for this
fixture and observation window, not a universal parser-start count.

The mixed parser reports `parsedPos = 0` until its base pass finishes. After one
large Markdown step exceeds the work deadline, language `takeTree()` stops the
mixed parse at that reported position. The resulting tree can contain the whole
paragraph while the language context's completed length remains zero. Later
viewport and parse-ahead work reconstruct the paragraph. The logs retain stops,
fragments, completed lengths, phase and inline counts.

That conservative position also protects embedded languages. Returning the base
parser's progress as though mixed parsing had completed could publish code/HTML
before its inner parses ran. The [Lezer partial-parse contract](https://lezer.codemirror.net/docs/ref/#common.PartialParse)
explicitly allows multi-pass progress to remain behind and stopped trees to
contain nodes beyond the stop. The remaining behavior should not be corrected
by simply substituting the base progress or accepting tree length as readiness.

Final CPU profiles sample fifteen edits per pane count, including five warmups,
at a requested 1 ms interval. Profiled timing is excluded from the benchmark table.
Language work remains 79.34%/86.08% inclusive (one/two panes); `finishLeaf` self
is 18.54%/18.87%, `parseInline` 15.24%/19.17%, and GFM Autolink 12.79%/12.82%.
`injectMarks` stays small at 0.51%/0.35% inclusive. Mixed `startInner` is now
0.64%/0.96% inclusive, versus 45.14% for the inline-only split profile. Inclusive
rows overlap; totals and scheduling differ across runs, so percentages alone are
not latency improvements.

The next candidate is preserving or conservatively reusing completed paragraph
inline work across those same-revision background passes. A cache would need
explicit purity/configuration/context guarantees and bounded retention; a
progress fix must preserve embedded-language completion and partial-tree
publication. Neither is implemented here. Arbitrary line splitting changes
multiline Markdown semantics, and a smaller scheduler budget cannot interrupt
one synchronous paragraph step. Pane parsing, selection and viewport ownership
remain independent.

## Native macOS/WebKit

All 22 final checks pass: 12 cursor/selection, 7 formatting/remount, 2 full giant
quote and 1 image lifecycle. Native giant checks validate 100,000 quote markers
and 50,000 emphasis spans in every pane, syntax-changing edits, and sibling
selection/scroll both synchronously and after frames. The image journey covers
clipboard import, resize, viewer, persistence/reopen and cut/undo.

Runs use real native IPC, disposable data/vaults and the previously authorized
foreground lane. The unchanged E2E executable is hash-admitted on each launch:
`35cddfbf1dc0f7155420f38b8bceacddd15dad6a64052552d82295ff472c8780`.
The frontend/dependencies are current. WebKit 605.1.15, 1200×800 CSS window,
16px/28px Geist, 702px editor height; widths 1022px alone and 583px split. Five
warmups and ten recorded edits, with no latency threshold.

Initial quote attempts lost window focus during fixture preparation, including
a diagnostic attempt with the editor active but `document.hasFocus() == false`.
Those attempts are rejected and excluded. The final native spec admits OS window
and source-editor focus after fixture/split setup and awaits one frame, all
outside timing. Pre/post visibility and focus assertions remain; it never
reacquires focus during the timed loop. The final two quote cases and image
journey pass in fresh native invocations, alongside the nineteen earlier final
cursor/formatting checks. Logs retain failed attempts and final acceptance.

All native table values are post-change milliseconds:

| Panes | Dispatch median | Dispatch P95 | Two-frame median | Two-frame P95 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 65 | 72 | 83 | 150 |
| 2 | 122 | 125 | 134 | 249 |

No fresh original native baseline was collected. The intermediate inline-only
native run (65/123 ms dispatch medians, split two-frame P95 662 ms) preceded the
final focus admission, so it is not a controlled quantitative comparison.
Native and Chrome also differ in engine, geometry, persistence and samples.
The final split frame tail remains substantial despite faster dispatch. Existing
embedded-driver limits on physical modified-key/click injection still apply.

## Reproduction and completed gates

For the original benchmark, use a checkout of `5a9ea9fd` and suffix
`-paragraph-baseline`; the command's `after` argument uses the current checkout.
The final comparison uses the combined source/dependency patches:

```sh
GNEAUXGHTS_E2E_BROWSER_PORT=1423 \
  MARKDOWN_BENCHMARK_SUFFIX=-inline-and-mixed-reuse \
  MARKDOWN_BENCHMARK_GREP='(mixed|fence|quote) 1000 lines|quote 50000 lines' \
  node scripts/benchmarkMarkdown.mjs after full-app
pnpm check
pnpm test
GNEAUXGHTS_E2E_BROWSER_PORT=1423 \
  MARKDOWN_PARAGRAPH_OUTPUT=.scratch/archive/visible-range-markdown/paragraph-steps-combined \
  pnpm exec wdio run e2e/wdio.browser.conf.ts \
  --spec e2e/specs/browser/markdown-paragraph-probe.spec.ts
```

- Full `pnpm check`: zero Svelte errors/warnings and E2E TypeScript passes. Final
  `pnpm check:e2e` rerun covers the post-fixture foreground admission.
- Full `pnpm test`: 121 support and 1,364 frontend tests pass; one opt-in benchmark
  skipped. Both module formats exercise the two new deterministic work bounds.
- Final browser run: all 24 targeted correctness checks pass (visible Markdown,
  formatting readiness, caret/range selection, split image inventory); both CPU
  profile and both paragraph-probe cases pass (six files, 28 cases total).
- All eight final benchmark fixtures pass; 22 distinct final native checks pass.
  The broader browser suite and its previously recorded search-preview layout
  failure were outside these runs; no Rust/backend/live-provider or iOS gate
  was rerun or claimed.
- Frozen installation and `git diff --check` pass. Generated benchmark JSON,
  raw CPU profiles, diagnostic JSON and selected logs remain local alongside
  this report. Reproducible diagnostics, frozen fixtures and regressions are
  tracked. The three unrelated research files were left untouched.
