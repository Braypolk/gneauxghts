# Chat work index

The earlier implemented milestones are complete. Editor date integration is complete;
its [historical record](../archive/completed-work.md#chat-date-context) retains the
outcome and verification limits. Start with
[worker validation](worker-validation.md) for the latest live results and
[pre-commit cleanup](cleanup.md) for the final review and targeted correction.
The earlier [native chat validation](validation.md) establishes composer,
citation navigation, cross-note follow-ups and parent fallback.

## Open follow-ups

- [06: request latency](issues/06-live-repeat-latency.md): measure provider,
  polling and repeated history-validation costs separately.
- [07: citation entailment](issues/07-citation-entailment.md): verify that cited
  passages support the associated claims; resolving a citation alone is not
  sufficient.

All other issues in this folder are resolved. Their original problem statements
and proposed steps are retained with their answers as implementation history.

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
