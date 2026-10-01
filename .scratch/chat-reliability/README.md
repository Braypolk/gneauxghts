# Chat work index

The earlier implemented milestones are complete. Editor date integration is complete; see its
[validation](../chat-date-context/validation.md) for the latest date/deadline
checks. Start with
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

| Milestone | Spec | Validation |
| --- | --- | --- |
| Composable capabilities | [Spec](../composable-agent-capabilities/spec.md) | [Historical validation](../composable-agent-capabilities/validation.md) |
| Scoped history and read contracts | [Spec](../evidence-contracts/spec.md) | [Historical validation](../evidence-contracts/validation.md) |
| Evidence displayed with answers | [Spec](../answer-evidence/spec.md) | [Validation](../answer-evidence/validation.md) |
| Tool feedback and useful activity | [Spec](../chat-tool-failures/spec.md) | [Validation](../chat-tool-failures/validation.md) |
| Reliability and bounded research | [Spec](spec.md) | [Worker validation](worker-validation.md) |
| Editor date conventions and deadlines | [Spec](../chat-date-context/spec.md) | [Validation](../chat-date-context/validation.md) |

## Local artifacts

Raw synthetic answers, event reports and screenshots are grouped in `artifacts/`
and excluded from Git. They include failed/intermediate runs needed to understand
the open follow-ups, so they have not been deleted. Markdown reports point to
their local paths; a fresh clone uses the native specs to regenerate them.
Set `GNEAUX_LIVE_OUTPUT` inside this directory for subsequent runs.
