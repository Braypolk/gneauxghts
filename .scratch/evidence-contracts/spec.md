# Evidence contracts for activity and follow-up answers

## Goal

An agent must be able to establish which specific passages changed during an explicit interval, read their context, check current status, and distinguish recorded commitments from inferred next steps. A recently edited note, old backlog, or prior assistant answer must not substitute for passage-level temporal evidence.

## Implementation plan

1. Improve evidence reads: bounded direct reads of known canonical notes; explicit source kind, changed passage versus supporting context, timing evidence, and task status. Keep working copies separately labeled.
2. Provide resumable reads and searches using backend-owned continuation state. Separate retrieval coverage, delivery completeness, and provenance completeness. Preserve permissions, freshness and shared budgets.
3. Provide a general temporal-support check over actually delivered evidence and explicit date bounds; teach the agent to connect activity evidence, current status and inferred recommendations. Do not impose a fixed tool sequence or infer semantic correctness from citation validity.
4. Add regression fixtures covering unchanged old tasks, multiple changed ranges, subsequent completion, partial results, uncertain dates and assistant-transcript contamination. Exercise real evidence/timeline boundaries and the agent runtime; attempt live local-model evaluation if available, with synthetic data only.
5. Update architecture and validation notes with measured results and remaining limitations.

## Historical-content decision

The user explicitly chose to include retained historical text for activity questions, clearly labeled. ADR 0009 records the scoped read-only capability and supersedes that portion of ADR 0003. The implementation includes retained body/property line changes; title/lifecycle events and discarded or cleared history remain outside declared coverage.

## Acceptance

- Matching changed ranges are identifiable independently of unchanged context.
- Known-note canonical reads can be cited and continued without searching for text already identified.
- Continuations preserve selection and options while rechecking authorization and freshness.
- Exhausting a result page never implies exhaustive semantic retrieval or complete historical coverage.
- Temporal-support checks reject undelivered, out-of-range and baseline-only evidence; uncertain support is explicit.
- Prior assistant answers never satisfy primary note evidence requirements.
- Existing proposal review and canonical write ownership remain intact.
