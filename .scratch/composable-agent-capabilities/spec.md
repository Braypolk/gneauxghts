# Composable agent capabilities

The user supplies an objective. The agent chooses tools, explicit dates, scopes,
and subsequent actions without a workflow picker or application-owned semantic
router. Tool results remain available for further tool calls and synthesis.

## Scope

This records the original capability plan. Later approved decisions in
[evidence contracts](../evidence-contracts/spec.md), ADR 0009 and
[answer evidence](../answer-evidence/spec.md) expand scoped retained-history
access and remove the dedicated source-preview path.

- Replace named date presets and question parsing with explicit half-open date or
  timestamp ranges and optional named timezone, shared by search and research.
- Return activity inventories as bounded intermediate data, never terminal runs.
- Compose exposed tools from application-owned capabilities, independently of
  answer presentation and worker role.
- Allow repeated bounded research operations within shared run limits.
- Fulfill quotation requests through ordinary chat capabilities and show evidence
  with the answer; do not require a dedicated preview tool or mode.
- Preserve permissions, exclusions, clearly scoped retained-history access, freshness,
  shared budgets, cancellation, citation validation, and reviewed proposal writes.

## Acceptance

Deterministic tests cover arbitrary ranges/DST/invalid bounds; activity discovery
followed by evidence reads and unrelated task search; continued model turns after
retrieval; capability restrictions; repeatable bounded research and shared usage.
Existing temporal, citation, guardrail, proposal and architecture checks pass.
Mock tests establish mechanics, not live-model tool-selection quality.
