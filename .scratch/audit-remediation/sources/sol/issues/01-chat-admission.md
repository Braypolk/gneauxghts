# 01 — Repair send receipt and event/listener admission

Status: ready-for-agent
Type: task
Audit items: AA-01, AA-02

Evidence: [module report](../reports/agent-app.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Use a deferred send receipt to deliver started/delta/evidence/terminal before receipt; preserve advanced messages and machine request ownership. Make listener acquisition join one in-flight attempt, clean partial failure, and use sets of subscriptions in the fake.

## Acceptance and validation

Deferred receipt before/after terminal retains exact content, evidence, parts and status; concurrent initialization awaits complete listeners; failure/retry/dispose releases every acquired subscription exactly once. Run controller, API, event and machine suites.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.
