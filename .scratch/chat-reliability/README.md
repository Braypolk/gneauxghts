# Chat work index

The earlier implemented milestones are complete. Editor date integration is complete;
its [historical record](../archive/completed-work.md#chat-date-context) retains the
outcome and verification limits. Start with the
[structured streaming integration](structured-streaming-integration.md) and
[final cleanup record](../archive/completed-work.md#final-chat-cleanup-2026-10-11)
for the current implementation and verification. Earlier
[worker validation](worker-validation.md) and [pre-commit cleanup](cleanup.md)
record the preceding live results and corrections.
The earlier [native chat validation](validation.md) establishes composer,
citation navigation, cross-note follow-ups and parent fallback.

## Open follow-ups

- [06: request latency](issues/06-live-repeat-latency.md): the [current native sample](latency-probe/README.md)
  is 97–98% provider/transport time; tools and IPC polls take milliseconds.
  The original timeout was not reproduced. Preserve diagnostics if it recurs;
  long-history scaling remains unmeasured.
- [07: citation entailment](issues/07-citation-entailment.md): verify that cited
  passages support the associated claims; resolving a citation alone is not
  sufficient. The [offline baseline](citation-entailment/validation.md) now has
  13 fixed cases, a manual claim rubric and trace-bound historical reviews;
  the [current-model pass](citation-entailment/current-validation.md) completed
  all 13 cases with two citation failures. The subsequent
  [reference experiment](citation-entailment/production-reference-validation.md)
  confirmed raw omissions with faithful rendering. A short reminder did not
  improve reliably; instructions remain unchanged. The subsequent
  [native reproduction](citation-entailment/native-validation.md) captured a
  malformed marker and [excerpt-only scope failure](../chat-context-selection/issues/09-selection-only-answer-scope.md).
  The [structured-answer prototype](structured-answer-prototype/README.md) then
  compared six paired answers: explicit associations resolve the observed table
  citation gap, with additional tokens and a streaming limitation. The follow-up
  [streaming/compact prototype](structured-answer-streaming/README.md) decodes real
  formatter deltas before final validation. The [completed comparison](structured-answer-streaming/completion/README.md)
  rejects compact formatting despite its input-token savings. Readable structured
  streaming is now [integrated on Rig 0.44](structured-streaming-integration.md),
  with automated publication, cancellation, retry and citation checks passing.
  Next: a fresh live provider/native UI comparison and claim-support evaluation;
  precise selected-range behavior remains a separate open issue.

The [resolved issue outcomes](../archive/chat-reliability-resolved-issues.md)
consolidate completed tickets; their validation reports and raw evidence remain
available. They are implementation history, not an additional work queue.

2026-10-14: [False evidence-change rejection corrected](../archive/chat-evidence-freshness.md).
Unrelated legacy identity assignment, timestamp-only updates and overlapping
internal operations no longer invalidate unchanged evidence. Actual bytes,
identity, access and retained-proof checks remain enforced.

## Earlier completed milestones

| Milestone | Record |
| --- | --- |
| Composable capabilities | [Historical outcome](../archive/completed-work.md#composable-agent-capabilities) |
| Scoped history and read contracts | [Historical outcome](../archive/completed-work.md#evidence-contracts) |
| Evidence displayed with answers | [Historical outcome](../archive/completed-work.md#answer-evidence) |
| Tool feedback and useful activity | [Historical outcome](../archive/completed-work.md#chat-tool-failures) |
| Reliability and bounded research | [Spec](spec.md), [worker validation](worker-validation.md) |
| Editor date conventions and deadlines | [Historical outcome](../archive/completed-work.md#chat-date-context) |

## Local artifacts

Raw synthetic answers, event reports and screenshots are grouped in `artifacts/`
and excluded from Git. They include failed/intermediate runs needed to understand
the open follow-ups, so they have not been deleted. Markdown reports point to
their local paths; a fresh clone uses the native specs to regenerate them.
Set `GNEAUX_LIVE_OUTPUT` inside this directory for subsequent runs.
The citation evaluation retains selected synthetic answer/source snapshots in
tracked JSON so its rubric and accounting remain usable without the ignored
original traces. Strict origin verification still requires those local traces.


2026-10-11: [Rig 0.41 streaming comparison completed](structured-answer-streaming/completion/README.md).
Compact saves 6.46% input tokens but fails source validation in two of four
answers. Both formats still fail excerpt-only attribution. Keep compact out of
production. Readable streaming was subsequently integrated; live native quality
and selected-range scope remain follow-ups.

[Three existing evidence test failures](../archive/chat-reliability-resolved-issues.md#10-investigate-three-existing-evidence-regression-failures)
were independently reproduced on Rig 0.41 during the 0.44 migration and are now
resolved as fixture assumptions about pagination and shared budgets. Production
limits are unchanged; the full backend suite passes. See the
[completion record](../archive/completed-work.md#evidence-regression-fixtures).
This is separate from the compact-format decision.


2026-10-11: [Structured streaming integrated on Rig 0.44](structured-streaming-integration.md).
Readable answer segments now stream as literal drafts and become Markdown only
after app validation and durable terminal storage. Cancellation/retry/late events,
stale sources and final rendering pass automated checks. Live provider/native UI
quality comparison and semantic citation entailment remain follow-ups.
