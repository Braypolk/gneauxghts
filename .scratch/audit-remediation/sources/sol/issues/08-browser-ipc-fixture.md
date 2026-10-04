# 08 — Replace permissive browser IPC fixture with explicit owned behavior

Status: ready-for-agent
Type: task
Audit items: EH-05, EH-06, EH-07

Evidence: [module report](../reports/e2e-harness.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Factory-own/reset fixture state, explicit command registry, channel subscriptions/emit and controlled deferred settlement. Save by admitted path/identity, reject unknown notes/commands except documented no-ops. Retire unused large-diff branch only after tracing external consumers.

## Acceptance and validation

Held save A plus read B never mutates B; unknown target/command fails descriptively; unlisten works; stale external/chat/proposal journey crosses actual frontend owners. Do not reimplement Rust history/evidence algorithms.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.
