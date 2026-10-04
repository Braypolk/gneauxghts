# 09 — Own E2E processes and bound renderer instrumentation

Status: ready-for-agent
Type: task
Audit items: EH-04, EH-08, EH-09, EH-10, EH-12

Evidence: [module report](../reports/e2e-harness.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Reject foreign Vite listeners, bound fetch/startup, observe child errors/exits and always clean failed startup. Share narrowly scoped owned child/WebDriver transport and frame sampler. Split mixed journeys with independent seeding and restore monkeypatches in guaranteed cleanup.

## Acceptance and validation

Fake collision/early exit/hung HTTP/already-exited teardown fail within bounds and leave no owned processes. Missing/transient frame targets finish exactly once with descriptive failure. Native listener PID/vault/hash/profile/symlink safety remains. Browser/native geometry responsibilities retained.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.
