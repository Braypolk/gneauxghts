# 90-semantic-retry-scheduling

Status: ready-for-agent
Progress: complete
Findings: UIX08
Owner: semantic remediation (editor agent)

## Plan

Replace worker fixed sleeps with a private deadline/condition-variable wait owned by SemanticWorkQueue. Wake on newer work and quiesce/shutdown, preserve retry counts and pending merge semantics. Factor a wait dependency into the existing owner for virtual-delay tests; do not duplicate worker algorithms. Check snapshot coalescing retirement and retain update/delete/move/rebuild matrix.

## Validation

Retry-bound test asserts chosen delays without wall sleeps; queue wait interruption with causal arrival/release; existing semantic worker/restart tests.

## Outcome

Implemented: queue-owned interruptible waits and injected delay decisions; retry bounds and snapshot publication use virtual waits. New work/shutdown causal wait tests; original merge/quiescence tests retained.

Validation evidence: `../semantic.md` and `../semantic-validation/`.
