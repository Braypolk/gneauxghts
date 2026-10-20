# 02 — Avoid repeated paragraph work in background passes

Status: needs-triage
Scope: deferred performance investigation

Read [the checkpoint](../spec.md). The previous cache prototype is not pending integration.

## Observed delay

The same document revision can run its giant paragraph inline parser synchronously
and again during background work. The latest three-edit native probe observes
three synchronous and three background calls per variant within its observation
windows; earlier probes observed two background calls per edit/pane. Counts vary
with scheduling and are not a universal parser contract.

Mixed parsing conservatively reports incomplete progress until its inner work is
finished. Stopping/taking a tree can therefore lead to another paragraph pass even
when a large base leaf has already been processed.

## Question and previous result

Can completed work survive the stop/resume boundary safely, without material cold
cost or memory retention? Investigate lifecycle/progress accounting or bounded
reuse only after reproducing the current call pattern.

Prototype `cfd81dc7` on `codex/paragraph-reuse-prototype` preserved syntax but added
cold cost and about 9.8 MiB per giant paragraph per pane. Chrome gains did not
establish consistent native benefit. Do not merge that prototype unchanged.

A base Markdown position or `tree.length` is not proof that mixed parsing is ready.
Do not publish HTML/code before its embedded parsers complete, or memoize arbitrary
custom callbacks without a valid context/purity contract.

## Evidence needed before integration

Count actual parser/inline calls for identical and edited revisions. Compare
stopped/resumed and fresh trees including mounted inner trees/overlays, configuration
changes, references, shifted offsets and unknown callbacks. Measure cold dispatch,
queued input, background CPU and retained memory in native WebKit. Integration
requires a repeatable user-visible benefit with explicit retention/lifecycle bounds.

## Evidence

[Prototype outcome](../../archive/visible-range-markdown/paragraph-reuse-prototype.md),
[current probe observations](../../archive/visible-range-markdown/synchronous-paragraph-optimization.md)
and retained `src/lib/e2e/markdownParagraphProbe.ts`.
