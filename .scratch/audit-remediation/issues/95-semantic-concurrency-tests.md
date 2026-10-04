# 95-semantic-concurrency-tests

Status: ready-for-agent
Progress: complete
Findings: AA06
Owner: semantic remediation (editor agent)

## Plan

Replace activity gate timing inference with observed wait-state arrival. Remove chat dispatch two-second sleep using release-on-drop and verify inexpensive second IPC before release. Replace permission registration polling with event publication signal. Give context measurement fake server deadline/shutdown with bounded reads. Coordinate file regions with audit_agent and TestSupport owner.

## Validation

Targeted dispatch/permission/context measurement/activity tests; no timing speed claim, bounded outer test deadlines and panic-safe release.

## Outcome

Implemented causal index lock/release plus independent draft IPC completion, pause checkpoint signal, permission event condition variable, and stoppable bounded mock server. All targeted tests passed, loopback test with approved escalation.

Validation evidence: `../semantic.md` and `../semantic-validation/`.
