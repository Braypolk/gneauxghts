# Bounded paragraph reuse prototype

Completed 2026-10-20. Baseline: primary `main` at `11ec15cc`, including the root,
marker-merge, inline-dispatch and mixed-tree lookup fixes.

**Decision: keep this implementation off main.** Reuse demonstrably removes
repeated inline recognition and helps some Chrome workloads, but this bounded
experiment did not establish a consistent native WebKit latency improvement.
It adds synchronous bookkeeping and retains about 9.8 MiB per giant paragraph
per pane. Selective reuse remains a promising follow-up, with production
admission, disposal and cold-cost work required before integration.

The throwaway implementation and executable experiments are preserved on
`codex/paragraph-reuse-prototype` at `cfd81dc7`. Main retains this decision and evidence
summary. No production parser, completion position, pane ownership or note
persistence behavior changes as a result of this prototype.

## Question and implementation

Can completed inline results be reused across background parses of the same
paragraph and document revision, without publishing embedded syntax early?

An explicitly imported diagnostic temporarily wraps the actual Markdown
`parseInline` method. Only the configured parsers of the mounted production
panes are admitted. A hit requires the same parser instance, identical
CodeMirror `Text` revision object, exact inline text and exact offset. The
registered inline callback identities must remain unchanged. Unknown parser
configurations and calls outside an active CodeMirror parse context bypass it.
The app's present inline callbacks were inspected; this is not a generic purity
contract for arbitrary extensions.

It caches the resolved inline elements before quote/list marker injection.
Block scanning, marker injection, mixed parsing, language scheduling and all
completion checks still run. It neither edits `parsedPos` nor treats tree length
as completed embedded parsing. Cache restoration occurs in `finally`.

Bounds, shared by the installed diagnostic:

- At most four entries, 3,000,000 retained inline UTF-16 code units and 400,000
  element nodes. Oldest entries are evicted to admit a result.
- Only inline sections of at least 16,384 code units and documents no larger
  than 2,000,000 code units qualify.
- Encountering a different eligible revision evicts the previous revision for
  that parser. Opaque custom tree payloads and over-budget results bypass reuse.
- Explicit clear/restore releases entries. Character/node counts are retention
  bounds, not a fixed byte allocation limit. This throwaway controller is not
  wired to production pane disposal; a bypass after changing to a short note
  can leave an older bounded entry until clear/eviction. Integration must address
  that lifecycle, rather than copying the prototype's global wrapper.

## Correctness and deterministic work

Chrome and native WebKit each pass 48 full tree comparisons: six document
shapes, four versions each, cold/stopped-resumed and independent warm parses,
compared with a fresh uncached configuration. Signatures include every syntax
node name/range plus embedded mounted trees and overlay ranges. HTML's lazy
language is loaded before these comparisons. Fixtures include nested quotes,
lists, reference links, offset shifts, inserted fences/HTML, Unicode, emphasis,
strikethrough, comments, highlights, wikilinks and wiki images.

Cached elements and child arrays are frozen during correctness checks, so
mutation by real consumers would fail. An unknown custom observer executes all
40,000 expected calls across two parses. Missing-context calls bypass the cache.
Capacity evictions, a result exceeding 400,000 nodes, and a document exceeding
two million code units are exercised. These are selected correctness evidence,
not proof that future arbitrary callbacks are pure.

Full-app measurements additionally verify all 100,000 quote markers and 50,000
emphasis spans in each giant-quote pane, syntax changes from either pane, and
sibling selection/scroll preservation. Queued typing verifies the exact inserted
string and identical final text in both panes, followed by complete syntax checks.

The separate three-edit work probe observes one cold full-paragraph inline parse
per pane per edit, then two background hits. Each section has 1,249,995 characters.
Background hit calls take about 0.4–0.7 ms in this instrumented Chrome run. The
cache records three misses for one pane and six for two panes; extra hits occur
when ensuring the final full tree. It avoids repeated inline recognition;
paragraph/block reconstruction is still present. Instrumented durations are not
included in the latency tables.

## Chrome measurements

Real Svelte app, production runtime/plugins/typography, deterministic browser
IPC; Apple M4 Pro, Node 24.2.0, Chrome 155.0.8059.85, 1440×857 CSS viewport.
Fixture creation, initial complete parsing, mounting and debounce settling are
outside timing. Latency runs, memory/GC probes and regression suites run
sequentially. Every latency case resets the browser workspace.

Two separate baseline/reuse/reuse/baseline sequences run one and two panes.
Each giant-edit case records 20 samples after five warmups. The ranges below
span the four baseline and four reuse runs per pane count across those sequences;
they are ranges of run medians, not pooled samples or confidence intervals.
Two-frame observations include dispatch and forced layout plus two animation
frames; they do not prove all background parsing or persistence has completed.

| Panes | Giant dispatch median, baseline → reuse | Two-frame median, baseline → reuse |
| ---: | ---: | ---: |
| 1 | 87.7–89.7 → 93.2–95.6 ms | 178.0–181.1 → 113.9–114.7 ms |
| 2 | 176.7–178.9 → 186.1–192.1 ms | 269.0–271.1 → 201.4–211.7 ms |

Thus isolated giant-edit frame observations improve consistently in Chrome,
while synchronous dispatch becomes slower. The prototype counts element nodes
on cold misses to enforce its node retention budget; that is additional work
on the keystroke path. This experiment does not isolate how much of the cold
cost comes from counting versus other bookkeeping.

Typing queues all 25 timers in advance, discarding the first five samples.
Each inserts one character through the actual application dispatch path. Sender
lateness is measured against intended input times, so backlog is observable.
The next-frame measure is an animation-frame proxy, not physical keyboard or
screen-photon latency. Five edits/second and a 12.5-edits/second stress case
are measured independently.

| Rate | Panes | P95 input backlog, baseline → reuse | P95 intended-input-to-next-frame, baseline → reuse |
| --- | ---: | ---: | ---: |
| 5/s | 1 | 1.1 → 2.0 ms | 93.2–93.4 → 104.9–107.4 ms |
| 5/s | 2 | 334.6–346.2 → 19.0–23.7 ms | 519.2–520.7 → 215.0–215.5 ms |
| 12.5/s | 1 | 452.7–476.3 → 455.3–471.8 ms | 554.0–567.2 → 569.4–599.5 ms |
| 12.5/s | 2 | 2482.6–2505.9 → 2544.4–2556.0 ms | 2676.0–2685.7 → 2732.8–2743.8 ms |

The strongest improvement is split-pane typing at five edits/second. There is
no improvement at the higher rate, where synchronous work alone exceeds the
arrival interval. One-pane typing gets slightly slower in these observations.

## Memory

A separate Chrome run holds the fully parsed live editor state and cached
results, invokes CDP garbage collection, records heap usage, clears/restores the
cache, then collects and records again. One paired observation per pane count:

| Panes | Held characters | Held element nodes | Heap reclaimed after release |
| ---: | ---: | ---: | ---: |
| 1 | 1,249,995 | 150,000 | 9.77 MiB |
| 2 | 2,499,990 | 300,000 | 19.55 MiB |

This approximates the extra retained heap under this fixture; it is not peak
RSS, an exhaustive leak test or a byte guarantee. Released counters are zero.
Small, fast paragraphs would often finish without repeated background work;
caching them merely because they exceed the prototype's length threshold is
not justified by these giant-quote results.

## Native macOS/WebKit

Runs use actual native IPC, disposable data/vaults, current frontend dependencies
and the hash-admitted unchanged E2E executable
`35cddfbf1dc0f7155420f38b8bceacddd15dad6a64052552d82295ff472c8780`.
WebKit 605.1.15; 1200×800 CSS window, 16px/28px Geist, 702px editor height,
583px split-pane width. Five warmups and 20 recorded giant-edit samples;
25 queued insertions at 200 ms intervals, first five discarded.

The final split-pane baseline/reuse/baseline invocation passes all three cases,
including pre/post actual focus/visibility and complete giant/syntax/typing
checks. Its native correctness preflight also passes the 48 comparisons above.

| Split-pane run | Giant dispatch median | Two-frame median | Typing P95 backlog | Typing P95 next-frame delay |
| --- | ---: | ---: | ---: | ---: |
| Baseline A | 216 ms | 419 ms | 1207 ms | 2240 ms |
| Reuse | 220 ms | 257 ms | 1056 ms | 2000 ms |
| Baseline B | 215 ms | 234 ms | 809 ms | 1500 ms |

The reuse result lies between the two baseline frame/backlog observations.
Baseline scheduling varied substantially; this single native A/B/A does not
establish a reliable latency gain. It also does not prove that reuse can never
help WebKit. The first synchronous paragraph parse in each pane remains.

Earlier native attempts lost focus and were rejected. The first invocation was
cancelled after repeated focus-invalid cases; its timings are excluded. A short
one-pane retry rejected its baseline but accepted its reuse case (116 ms dispatch,
134 ms two-frame median); that unmatched result is not a speedup comparison.
Focus is admitted after fixture preparation, with a bounded settling wait outside
timing; timing never reacquires it. Failure evidence remains alongside accepted
results. No focus assertion was weakened to obtain a pass.

## Outcome and follow-up

Do not merge the prototype's global wrapper. If pursuing reuse, first admit it
only for demonstrated repeated expensive work, preserve an explicit contract for
the owned parser's callbacks, release on revision/configuration/disposal changes,
and reduce or move retention bookkeeping off synchronous input. Then rerun
matched native typing and frame measurements before adding a production cache.

An alternative is retaining completed paragraph work closer to the parser's own
partial-parse lifecycle. That may avoid storing a second long-lived element graph,
but must preserve mixed-language completion and partial publication. No scheduler,
completion-position shortcut or arbitrary paragraph splitting was implemented.

The native input path and first paragraph parse are the next performance target;
background reuse alone does not establish the required native responsiveness.

## Reproduction and evidence

Check out `codex/paragraph-reuse-prototype` to run these opt-in diagnostics:

```sh
GNEAUXGHTS_E2E_BROWSER_PORT=1423 \
  PARAGRAPH_REUSE_OUTPUT=.scratch/paragraph-reuse-prototype/evidence/browser-abba.json \
  pnpm exec wdio run e2e/wdio.browser.conf.ts \
  --spec e2e/specs/browser/paragraph-reuse-prototype.spec.ts
# Repeat with PARAGRAPH_REUSE_INTERVAL=200 and a separate output filename.
GNEAUXGHTS_E2E_BROWSER_PORT=1423 \
  PARAGRAPH_REUSE_MEMORY_OUTPUT=.scratch/paragraph-reuse-prototype/evidence/memory-work.json \
  pnpm exec wdio run e2e/wdio.browser.conf.ts \
  --spec e2e/specs/browser/paragraph-reuse-memory-prototype.spec.ts
GNEAUXGHTS_E2E_FOREGROUND=1 \
  PARAGRAPH_REUSE_NATIVE_OUTPUT=.scratch/paragraph-reuse-prototype/evidence/native-webkit-2.json \
  pnpm exec wdio run e2e/wdio.native.conf.ts \
  --spec e2e/specs/native/paragraph-reuse-prototype.spec.ts --mochaOpts.grep '2 panes'
```

Create the ignored evidence directory first on a clean checkout. Native runs
require the isolated built/admitted E2E artifact and an available authorized
foreground desktop. The native spec's foreground admission prevents accidental
unapproved focus. All sources are diagnostics; the normal app never imports them.

Retained local evidence includes `browser-abba.json`, `browser-abba-200ms.json`,
`correctness-final.json`, `memory-work.json`, `native-webkit-1.json`,
`native-webkit-2.json` and matching logs under
`.scratch/paragraph-reuse-prototype/evidence/`. Earlier intermediate correctness
attempts are not final evidence (one initially lacked inline HTML in its fixture;
the fixture was corrected). Broad browser, Rust/backend, live-provider and iOS
acceptance were not rerun or claimed for this diagnostic-only prototype.

Completed gates on the prototype branch:

- `pnpm check`: zero errors/warnings; final `pnpm check:e2e` passes after native
  specification changes.
- `pnpm test`: 121 support checks and 1,364 frontend tests pass, with the existing
  single opt-in benchmark skipped.
- Both complete Chrome timing sequences pass all nine cases each. Final separate
  correctness plus memory/work runs pass all three cases.
- Native 48-comparison preflights pass; the final split-pane invocation passes
  all three baseline/reuse/baseline timing-and-correctness cases. One unmatched
  solo reuse case passes; failed focus attempts remain explicitly excluded.
- `git diff --check` passes and experiment ports 1423, 1430 and 4445 are released.
