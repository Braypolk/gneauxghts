# 01 — Reduce the first synchronous paragraph parse

Status: needs-triage
Scope: deferred performance investigation

Read [the checkpoint](../spec.md). No implementation is requested by this ticket yet.

## Observed delay

The 50,000-line nested quote forms one 1,249,995-character inline paragraph inside
a 1,250,008-character document. Its first synchronous parse remains expensive after
the shipped marker, dispatch and autolink skips. The latest one-pane native probe
records three first-inline calls with a median of about 85 ms; accepted full-app
edit dispatch is about 111 ms alone and 223 ms split. The 20 ms language-work budget
cannot interrupt one Markdown `advance()`/`finishLeaf()` step.

Latest aggregate Chrome profile self time is 17–19% in `finishLeaf`, 12–18% in
`parseInline`, and about 11% in GFM Autolink. These include background passes and
are candidate locations, not an isolated first-parse attribution.

## Question and possible directions

Separate paragraph collection/string handling, inline recognition/delimiters,
marker merge and tree construction in a fresh synchronous-only profile. Seek
additional exact skips or cheaper operations first. Resumable leaf/inline work or
an off-thread parser is a larger design option requiring explicit coordination
and publication work, not an assumed next implementation.

Arbitrary line splitting changes multiline Markdown semantics. A smaller scheduler
budget alone does not preempt the step. Do not add authored blank lines as a fix.

## Evidence needed before integration

Demonstrate lower synchronous dispatch cost on current main under matched giant
quote and ordinary-note controls. Preserve full syntax/ranges, extension precedence,
Unicode, references, stopped/resumed parsing and embedded mounts. Verify native
WebKit and rapid typing without increasing retained memory or dropping/reordering
input. Record any unsupported cases and compare both one and two panes.

## Evidence

[Current report](../../archive/visible-range-markdown/synchronous-paragraph-optimization.md)
and [earlier paragraph analysis](../../archive/visible-range-markdown/paragraph-inline-optimization.md).
