# Index task matching candidates while preserving identity policy

Status: ready-for-agent
Progress: complete
Owner: audit_timeline
Findings: BP-05 measured follow-up

## Evidence

Production helper diagnostic:100 tasks5,050 key comparisons;1,000 tasks500,500 comparisons. Two debug passes took3.568ms and352.277ms respectively. This justifies replacing the repeated all-task scan, not changing identity matching policy.

## Plan and acceptance

Build borrowed-key candidate maps once per reconciliation for exact task key, normalized text and line. Keep five match priorities (key; text+section+depth; text+section; text; line), nearest line then original order for ties, and used-task exclusion. Keep the old linear matcher as a cfg(test) independent migration oracle, compare deterministic varied/duplicate/adversarial cases and a1,000-task diagnostic. Existing SQL/task ID/date/hidden/completion behavior remains under production tests. No timers as acceptance gates.

## Outcome

Implemented and reviewed; [owner outcomes and verification](../timeline.md) contain exact evidence and limitations.
