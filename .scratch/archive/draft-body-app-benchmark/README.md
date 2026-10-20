# Immutable draft bodies: native app latency

Completed 2026-10-20, following the
[immutable body migration and consumer audit](../immutable-draft-bodies.md).
The migration produces a modest, repeatable latency reduction for very long
prose in the actual macOS app. Giant blockquotes remain slow. No further
production optimization was made during this benchmark.

## Comparison and environment

Baseline is `fd9c0ad1a7672157d3dbd665a039ec49a1e525c7`, which already includes
visible-range formatting, image inventory, headless-root parsing and Markdown
recognizer improvements. Candidate is the current immutable-body migration,
including deferred Related serialization and save captures. This measures the
combined migration, not the independent effect of each part.

Four fresh native invocations ran sequentially: **before, after, after, before**.
Each used disposable app data/vaults, actual native IPC/persistence and the
production Svelte app, editor extensions and split-pane runtime. The native
debug executable and installed dependencies were identical. Baseline source ran
from a temporary Git archive; the caller's source was never swapped. The
temporary checkout and native fixtures were removed on completion.

- macOS WebKit 605.1.15; development frontend, 1200 × 800 window.
- Editor: 16px / 28px Geist; single pane 1022px wide, split panes 583px each.
- Native executable SHA256:
  `35cddfbf1dc0f7155420f38b8bceacddd15dad6a64052552d82295ff472c8780`.
- Full initial parsing, pane/fixture setup and 1.8 seconds of settling precede
  each case. Saving and production scheduling remain enabled during timing.
  Other test/build jobs finished before the first measured input.
- Both variants use exactly the same opt-in harness and spec. Source/dependency
  hashes, environment, retained samples and statistics are in
  [results.json](results.json).

## DOM input to frame

The embedded WebDriver's printable-key handler emits keyboard events but does
not insert text into contenteditable. The probe instead issues a synthetic
keydown followed by WebKit `execCommand('insertText')`. This exercises WebKit
DOM editing, input events, CodeMirror's DOM observer and the application edit
callback. It does not substitute a runtime transaction for this phase.

Timing starts immediately before keydown. The first-frame observation requires
both document models to contain the input and the edited DOM to contain the
inserted sequence; cursor geometry is then checked and a second RAF recorded.
Each character waits for completion before the next is sent. This phase measures
isolated response, not a fixed-rate stream. Each run uses 25 characters, discards
five warmups and retains 20 samples per fixture: **40 pooled per variant**.
P95 is computed from pooled samples, not averaged run percentiles. WebKit timings
are effectively millisecond-granularity here.

These are **input-to-frame proxies**, not physical keyboard-to-screen-photon
latency. RAF precedes paint; OS input delivery and compositor scanout are not
measured. Two RAFs supply an additional frame window, not a paint timestamp.
This is a development-app measurement, not a release-build or iOS guarantee.

Times are median / P95 milliseconds:

| Document | Panes / input source | Before | After |
| --- | --- | ---: | ---: |
| Prose, 500,045 characters | 2 / left | 14 / 15 | 14 / 15 |
| Prose, 2,000,050 characters | 1 | 17 / 20 | 14 / 15 |
| Prose, 2,000,050 characters | 2 / left | 30 / 32 | 27 / 30 |
| Prose, 2,000,050 characters | 2 / right | 29 / 31 | 26 / 28 |
| One code fence, 2,000,032 characters | 2 / left | 14 / 15 | 14 / 15 |
| Nested blockquote, 50,000 lines / 1,250,008 characters | 2 / left | 209 / 313 | 204 / 309 |

Long split-pane prose medians improve about **10%**, or **3 ms**. Direction holds
in each run: left baseline medians 30/30 ms, candidate 27/27 ms; right baseline
29/30 ms, candidate 26/27 ms. Smaller notes and the fence show no measurable
first-frame gain. Fence dispatch improves about 1 ms without changing that median.

Two-frame prose medians are 33 → 30 ms for left-pane input and 31 → 30 ms for
right-pane input. Single-pane two-frame median stays 31 ms despite the earlier
first-frame observation; frame scheduling can absorb work reductions. Giant-quote
two-frame median is 305 → 302 ms. These results do not establish that every
saved millisecond produces an earlier displayed frame.

## Queued typing and backlog

A separate phase queues 35 timers in advance, one every 80 ms (12.5 edits/s).
Each inserts through the production view's dispatch path. This phase uses
programmatic dispatch, not DOM/OS keyboard input. Timer lateness measures backlog
against intended arrival; the next RAF is also measured from intended arrival.
Five warmups are excluded, leaving **60 pooled samples per variant**.

Times in milliseconds; arrows show before → after:

| Document / panes / input | Dispatch median | Backlog P95 | Intended input to frame P95 |
| --- | ---: | ---: | ---: |
| 500k prose / 2 / left | 16 → 16 | 1 → 1 | 20 → 19 |
| 2m prose / 1 | 19 → 16 | 1 → 1 | 23 → 20 |
| 2m prose / 2 / left | 31 → 29 | 1 → 1 | 34 → 32 |
| 2m prose / 2 / right | 31 → 28 | 1 → 1 | 34 → 31 |
| 2m code fence / 2 / left | 15 → 14 | 1 → 1 | 19 → 19 |
| Giant quote / 2 / left | 206 → 202 | 4,621 → 4,478 | 5,906 → 5,788 |

Prose and fence workloads keep up in both variants. The giant quote cannot:
roughly 200 ms of work exceeds the 80 ms arrival interval. Its remaining
multi-second backlog dominates the small gain. Keep the body migration and
preserve the separately parked
[Markdown parsing investigation](../../markdown-parsing-delays/spec.md).

## Correctness and validation

All **24 native cases** passed in four complete invocations with no admitted
focus interruption, exercising 600 DOM character insertions and 840 queued
dispatches. Every phase verifies exact inserted order/text and pane equality
after timing. The sibling has an independent reversed selection and distant
viewport; its selection must map correctly through insertions and its scroll
must remain stable. Input is measured from both split panes.

Focus/visibility are required before and after measurements; blur during a timed
phase rejects the case. No latency thresholds are asserted. An initial driver
setup probe was cancelled before retained results; all four accepted runs use
the corrected DOM-input method.

`pnpm check` passes with zero errors/warnings, including E2E types. All 125 support
tests pass, including CLI/spec rejection before native app launch without
foreground opt-in. Production code is unchanged from the body migration.

## Reproduction

The test app takes foreground focus. Use installed lockfile dependencies and
the pinned native E2E executable; if missing, build it with
`pnpm test:e2e:native:build` first.

```sh
GNEAUXGHTS_E2E_FOREGROUND=1 node scripts/benchmarkDraftBodies.mjs
```

The runner uses isolated baseline source, identical measurement code and the
pinned executable; it restores no files over the working tree. It writes raw
per-run JSON/logs and provenance under `evidence/`. The checked-in `results.json`
consolidates this completed comparison and pools raw samples by fixture/variant;
rerunning does not overwrite that historical consolidation.
`DRAFT_BODY_RUNS=before-1,after-1` shortens a diagnostic run; `DRAFT_BODY_GREP`
narrows cases. Compare all four runs for the recorded sequence.
