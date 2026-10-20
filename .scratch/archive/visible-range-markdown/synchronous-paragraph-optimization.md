# First synchronous paragraph parse: autolink boundary guard

Completed 2026-10-20 on primary main, starting at `71c77cdf`. Retain the focused
GFM autolink guard optimization. It removes demonstrated per-character regex work
without changing the grammar or adding retention. Native measurements suggest a
small dispatch gain; interrupted return baselines prevent a complete A/B/A claim.
Rapid typing in a giant paragraph remains slow.

## Diagnosis and change

Fresh profiles of fifteen edits in the real application, one/two panes, show GFM
Autolink recognition at **14.90%/16.16% self time**. At every inline position it
previously evaluated `/\w/.test(cx.text[pos - 1])` to reject positions following a
word character. That non-Unicode regex recognizes exactly ASCII letters, digits
and underscore. The pinned `@lezer/markdown@1.6.4` patch now uses `charCodeAt` and
those exact ranges. At the first position `charCodeAt(-1)` returns NaN, preserving
the previous boundary behavior. URL/email recognition, callback order, custom
recognizers, paragraph boundaries and mixed-language completion are unchanged.

Both ESM and CommonJS are patched. The lockfile patch hash is
`b2e4456e82d2ba29cf20be1709d17a84225845366de14d8e430fc76ed902ea5b`.
The previous inline dispatch, marker merge and common-tree reuse patches remain.
No dependency version changed. A frozen offline install passes with
`--ignore-scripts --config.strictDepBuilds=false`; patch-commit initially reported
unapproved unrelated dependency build scripts, which were not authorized or run.

The final profiles show Autolink at **11.00%/11.20% self time**. `finishLeaf`
remains 17.17%/18.94%, and `parseInline` 11.84%/18.32%. These profiles include
background work; scheduling and totals differ. Percentages are diagnostic, not
latency ratios or measurements of only the first synchronous parse.

In the accepted one-pane native instrumented probe, three first synchronous
inline parses have median **88 → 85 ms**. Each variant observed three synchronous
and three background inline calls across three edits, with 1.2 seconds of waiting
per edit. This small instrumented sample confirms where work happens; it is
separate from latency samples. Repeated parsing still exists, and the paragraph
step still exceeds the language scheduler's budget.

## Correctness

- The real-parser work regression fails before the change at **41,994**
  single-character word-regex checks for 2,000 quote lines, then passes at **zero**
  in ESM and CommonJS. It also asserts all 2,000 emphasis nodes survive.
- Both module formats compare actual syntax against the unchanged upstream
  Autolink implementation for URLs, email, mailto/xmpp, punctuation trimming,
  invalid domains, Unicode, escaped delimiters and bracket contexts. Every one
  of the 65,536 UTF-16 preceding characters is compared at a nonzero inline offset.
  The reference preserves the upstream MIT notice and is diagnostic/test-only.
- Native WebKit passes **48** app-dialect tree comparisons: six documents,
  four edited/shifted versions, cold stopped/resumed and independent full parsing,
  against the original recognizer. Signatures include all node names/ranges and
  recursively mounted HTML/code trees and overlays. The comparisons visit 19,304
  mounts including repeated comparisons. Fixtures contain real autolinks, custom
  Obsidian syntax, reference links, lists and multiline paragraphs.
- Each accepted native timing phase then verifies **100,000 quote markers and
  50,000 emphasis spans per pane**, syntax-changing edits and sibling selection,
  scroll and text synchronization. Queued typing asserts every inserted character
  is present, ordered and equal in all panes.

## Native macOS/WebKit measurements

Real production panes and IPC in disposable native vaults, WebKit 605.1.15,
Apple M4 Pro, 1200×800 window, 16px/28px Geist. The unchanged admitted E2E binary
has SHA256 `35cddfbf1dc0f7155420f38b8bceacddd15dad6a64052552d82295ff472c8780`.
The fixture is 50,000 nested quote lines with bold text (1,250,008 document units).
Every metric uses five warmups and twenty retained samples, with no time gate.

The opt-in harness substitutes only the unchanged GFM Autolink callback in the
existing parser/buckets for the baseline, then restores it in finally. The
candidate uses the installed patch. All other parser callbacks, pane states,
scheduling and application plugins remain real. Initial fixture parse and focus
admission are outside timing. This is an in-process recognizer comparison,
not an independent installed-package A/B build comparison.

Accepted giant-edit observations, milliseconds, baseline → optimized:

| Panes | Dispatch median | Dispatch P95 | Dispatch + two frames median |
| --- | ---: | ---: | ---: |
| 1 | 115 → 111 | 130 → 114 | 133 → 120 |
| 2 | 237 → 223 | 258 → 231 | 447 → 244 |

Observed median dispatch reductions are **3.5% and 5.9%**. The large split-frame
change is sensitive to background scheduling and is not established as a
repeatable effect of this small guard. No consistent frame-tail guarantee follows.

Queued typing schedules all 25 input timers in advance, measures dispatch,
sender backlog relative to intended time and the next RAF relative to intended
input. These are programmatic dispatch/RAF proxies, not physical key-to-display
measurements. Values below are milliseconds:

| Panes | Edits/sec | Dispatch median, before → after | Backlog P95, before → after | Next-frame delay P95, before → after |
| --- | ---: | ---: | ---: | ---: |
| 1 | 5 | 113 → 112 | 74 → 62 | 187 → 174 |
| 1 | 12.5 | 115 → 111 | 1,105 → 1,017 | 1,741 → 1,639 |
| 2 | 5 | 225 → 222 | 1,132 → 1,032 | 2,191 → 1,864 |
| 2 | 12.5 | 225 → 223 | 3,515 → 3,494 | 4,882 → 4,866 |

The split typing baseline follows the candidate in the accepted sequence; the
one-pane baseline precedes it. Completion time at split 5 edits/sec is essentially
unchanged (6,191 → 6,209 ms); split 12.5 edits/sec is 5,922 → 5,906 ms. These sparse
pairs support a modest work reduction, not a robust rapid-typing improvement.
Both pane counts remain unable to keep up with 12.5 edits/sec in this giant leaf.

### Focus interruptions and limits

The first combined attempt stalled before completing a timing case and was
cancelled through its owned runner. The harness now admits focus before fixture
frames and bounds fixture setup. Subsequent runs retain pre/post visible/focused
assertions and never reacquire focus inside timed work. Independent shorter
phases preserve a valid metric when another phase is interrupted. Non-focus
failures stop the invocation to avoid pending async work contaminating another
case. Failure payloads avoid the reserved outer `error` field and consequent
WebDriver script retries.

One combined retry accepts the one-pane baseline and candidate, then rejects four
later cases for focus loss/timeout; the timeout's following fixture mismatch is
also excluded. A fresh one-pane return attempt loses focus. The shorter split
run accepts six metrics (two giant, four typing), rejects two first-baseline typing
phases and the return giant phase for focus loss. The final fresh return-giant
attempt rejects both pane counts for focus loss. The surrounding foreground app
was observed as Zen during diagnosis. None of these failures is used as evidence
of parser speed or correctness failure; their raw logs are retained. A complete,
uninterrupted A/B/A was **not obtained**. Accepted cases have passing assertions,
but no final all-green native benchmark invocation is claimed.

## Other validation

- `pnpm test`: **125 support checks and 1,364 frontend tests pass**, one existing
  opt-in benchmark skipped. Focused parser checks (new and earlier regressions)
  pass 48 tests in both module formats.
- `pnpm check`: zero errors/warnings, including E2E types. The final native
  failure-handling edit also passes `pnpm check:e2e`.
- Both after-change CPU-profile cases pass. Eight full-app Chrome benchmark
  fixtures pass, measuring selection and document operations with five warmups
  and twenty retained samples. Post-change document observations:

| Fixture | Panes | Dispatch median | Dispatch P95 | Two-frame median |
| --- | ---: | ---: | ---: | ---: |
| mixed 1,000 | 1 / 2 | 3.3 / 3.4 | 5.7 / 3.8 | 33.3 / 33.3 |
| fence 1,000 | 1 / 2 | 3.2 / 1.8 | 3.8 / 2.1 | 33.4 / 33.4 |
| quote 1,000 | 1 / 2 | 3.5 / 6.8 | 4.2 / 7.4 | 33.3 / 33.4 |
| quote 50,000 | 1 / 2 | 72.2 / 141.3 | 78.0 / 150.0 | 90.0 / 213.4 |

These Chrome values are post-change controls, not a matched before/after claim.
No Rust, persistence-owner, CSS, native binary or pane-ownership changes were made.
The browser/native appearance and physical caret suites were not rerun for this
character guard; full syntax and mount parity are the relevant correctness checks.

## Reproduce and evidence

```sh
node --test e2e/support/markdownAutolink.test.mjs
GNEAUXGHTS_E2E_FOREGROUND=1 \
MARKDOWN_SYNCHRONOUS_NATIVE_OUTPUT=/tmp/synchronous-native.json \
node --input-type=module -e 'import{runNativeSpecs}from"./e2e/support/nativeSuite.mjs";process.exitCode=await runNativeSpecs(["e2e/specs/native/markdown-synchronous-paragraph.spec.ts"]);'
```

Run timing, profiling and checks sequentially on an available desktop. The native
spec has independent `giant`, `rapid200` and `rapid80` cases and requests A/B/A.
Selected raw logs, JSON, the instrumented one-pane comparison, CPU profiles and
check results remain locally under `evidence/synchronous-paragraph/` beside this
report. `full-app-after-synchronous-guard.json` retains Chrome samples. Generated
evidence is ignored; the report, reference oracle and diagnostic sources are kept
in Git. The earlier paragraph-result cache remains off main.
