# 03 — Reduce giant-quote typing backlog and split-pane frame delays

Status: needs-triage
Scope: deferred end-to-end performance investigation

Read [the checkpoint](../spec.md). This tracks the remaining user-visible symptom;
issues 01/02 are possible contributors, not separate savings to add together.

## Observed delay

On the latest optimized native fixture, sender backlog P95 at 5 edits/sec is about
62 ms with one pane and 1,032 ms with two. At 12.5 edits/sec it reaches about
1,017/3,494 ms; next-frame-from-intended-input P95 is about 1,639/4,866 ms.
The latest guard makes only a marginal difference to typing throughput. These
are queued programmatic dispatch/RAF observations, not physical key-to-display
measurements or a general statement about ordinary notes.

Two panes still have independent language states. Shared history-root parsing has
already been removed; do not reintroduce that resolved duplication as a new finding.
The source of each remaining delay must be measured rather than assumed to be
solely parsing, persistence, layout or another pane's work.

## Questions and possible directions

Attribute source dispatch, sibling parsing, background scheduling and layout/paint
under controlled input rates. Determine whether sharing syntax work between panes
can preserve different viewports, selections, configurations and publication
readiness. Any ownership change needs an architecture/invariant review first.
A shared parse is a possible design investigation, not an approved refactor.

## Evidence needed before integration

Compare one/two panes on a fresh matched baseline with queued input at 200 ms and
80 ms, retaining intended send times rather than slowing the sender to match work.
Report dispatch, backlog, completion time and frame tails separately. Verify every
character, ordering, sibling text, independent selection/scroll, undo and readiness.
Include ordinary-note controls and complete the native comparison when focus is
available. Do not claim a large responsiveness gain from one frame-tail sample.

## Evidence

[Latest native timing tables and caveats](../../archive/visible-range-markdown/synchronous-paragraph-optimization.md),
with the retained full-app and synchronous-paragraph diagnostic harnesses.
