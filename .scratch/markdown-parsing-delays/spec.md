# Markdown parsing delays: parked follow-ups

Recorded 2026-10-20. Status: deferred; no implementation is underway.
Production checkpoint: main `4d3d1d5e`.

## Current state

The completed work is integrated on main:

| Commit | Change |
| --- | --- |
| `7e9532e4` | Merge quote/list markers without repeated array insertion. |
| `5a9ea9fd` | Remove the unused Markdown parser from the shared history root. |
| `11ec15cc` | Skip impossible builtin inline recognizers and fruitless buffered-tree identity searches. |
| `4d3d1d5e` | Replace GFM autolink word-boundary regex checks with equivalent ASCII comparisons. |

Latest verification: 125 support checks, 1,364 frontend tests and type checks pass;
one opt-in benchmark is skipped. Eight full-app Chrome fixtures and 48 native
WebKit syntax/mount comparisons pass. Accepted native giant-quote dispatch
observations are 115 → 111 ms with one pane and 237 → 223 ms with two. These are
local paired observations; focus interruptions prevented a complete native A/B/A.
Rapid typing in the giant paragraph still accumulates substantial delay.
See the [full current outcome](../archive/visible-range-markdown/synchronous-paragraph-optimization.md)
for samples, methods, limits and local evidence locations. Historical measurements
from separate optimization stages must not be added together as a current benchmark.

The bounded paragraph-result reuse prototype remains off main, preserved at
`cfd81dc7` on `codex/paragraph-reuse-prototype`. It passed syntax checks but added
cold cost and about 9.8 MiB retained per giant paragraph per pane; native latency
benefit was inconsistent. It is evidence for a rejected integration, not an
unfinished merge. [Prototype decision](../archive/visible-range-markdown/paragraph-reuse-prototype.md).

## Potential future issues

All tickets are `needs-triage`, deliberately parked. Numbers are references, not
an authorized implementation sequence or a commitment to a specific design.

| Ticket | Remaining concern |
| --- | --- |
| [01 — First synchronous paragraph parse](issues/01-first-synchronous-paragraph-parse.md) | One enormous leaf still blocks dispatch beyond the scheduler budget. |
| [02 — Repeated background paragraph parsing](issues/02-repeated-background-paragraph-parsing.md) | The same revision can repeat completed inline work. |
| [03 — Split-pane typing and frame delays](issues/03-split-pane-typing-and-frame-delays.md) | End-to-end backlog remains severe under queued input. |
| [04 — Native comparison reliability](issues/04-native-benchmark-focus-stability.md) | Focus interruptions prevent reliable return baselines; a validation/tooling gap. |

## Resume criteria

Start with fresh triage and the linked evidence, then reproduce on the current
main with matching fixtures and an available desktop. Distinguish synchronous
work, background work, sender backlog and paint proxies. Define the expected
user-visible improvement before selecting an approach; no universal timing SLA
has been adopted. Review architecture/invariants before changing parser ownership,
coordination or publication. Preserve Markdown semantics, embedded-language
completion, every typed character, shared undo and independent pane selection/scroll.

## Cleanup checkpoint

Regression tests, opt-in diagnostics, the original-recognizer oracle and selected
raw evidence are retained. Disposable patch staging, generator scripts and duplicate
/tmp outputs from the latest pass are removed after checking the retained copies.
The benchmark ports 1423/1430/4445 were clear at cleanup. The prototype branch is
preserved. Unrelated research files and other working trees are untouched.
No additional timing runs were performed for this documentation/cleanup pass.
