# Frontend coordination seams and sequence-test oracles

Status: needs-triage

## Audit sources

reports/frontend-coordination.md

## Problem and intended result

Use the coordination report to replace mocked policy/call-through tests with owner-level outcomes, strengthen sequence-test rejection assertions, and review proposal review composition.

## Acceptance and replacement coverage

Enumerated legal commands must fail the test when they unexpectedly throw; illegal transitions have explicit preconditions and expected rejection. Real proposal adapter plus review extension owns review replacement assertions. Preserve dirty-conflict departure, shared document identity, undo reset, and History Mode return ordering.

## Constraints and handoff

Keep inexpensive exhaustive state sequences; baseline execution was 165/182 ms, not a demonstrated performance problem. Consolidate fixtures before considering module merges.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
