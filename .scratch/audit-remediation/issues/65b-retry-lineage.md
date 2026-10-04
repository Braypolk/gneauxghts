# Preserve original user identity across repeated retries

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: audit_agent
Findings: CHAT-01 independent correctness review

## Plan

Reproduce U1/A1 failed, U2/A2, retry A1 as A3, then retry failed A3 through actual admission and durable context. The command currently selects nearest preceding user, which becomes U2, while A3 retained context belongs to U1. Introduce a ChatService-owned resolver using chat_agent_runs.user_message_id and validate the requested pair at admission. Reject missing durable lineage unless a legacy fallback is demonstrably safe; preserve existing conservative missing-context behavior. Command attachment validation must use the same resolved original user. Add mismatched-pair rollback and repeated-retry regression before final verification.

## Validation

Focused lifecycle/retry and command compilation, followed by root integration. No schema migration; no provider calls.

## Comments

2026-10-03: Independent documents reviewer reproduced the reachable command selection mismatch statically. Plan persisted before source edits.

Independent review extension: checkpoint branching copies failed turns before a completed checkpoint and previously assigned their run to the last preceding user. Copy each durable run's authoritative original user through the source→branch message map, including runs without selected notes/events, and retain original force-web/active context. Missing authoritative identity fails closed; legacy transcript-only messages receive no invented run. Add branch-then-retry assertion to the repeated-retry case.

Red result: actual-admission repeated-retry regression failed on wrong-user pair being accepted (session63868); green implementation pending shared compile.

## Outcome

Implemented durable original-user resolution in the command and same-pair validation in actual admission. The run context now carries original user identity, eliminating content/context divergence. No legacy fallback was added because retry already required durable context. Branching maps authoritative user and retry identities to copied messages, copies context from the exact originating run and retains force-web/active-note context. It copies context-free runs too; transcript-only legacy messages receive no fabricated run.

Regression went red before the fix: actual admission accepted U2 with U1 retry context. After both fixes, cargo test --lib chat::tests completed59passed,0failed,1explicit benchmark ignored. Covers repeated retries across newer turns, wrong-pair rejection without extra rows, missing-run rejection, checkpoint branch followed by retry, and all retained chat/recovery behavior. Source stable for root native build.

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
