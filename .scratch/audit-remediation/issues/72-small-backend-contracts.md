# Dates, asset allocation and event contracts

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: root

## Scope

BP06/CC05: reject nonexistent calendar dates keeping exact UTC grammar. UIX12: trace asset dispatch and verify overlap before mutation. BB05: distinguish codec fixture presence from actual dispatch; strengthen exact encoding and consequential event routing where feasible.

## Verification and acceptance

Literal leap/calendar vectors; concurrent allocation only if reachable; command/event/codec focused tests.

## Outcome

Implementation and focused validation are recorded in [root report](../root.md). Independent review and integrated native validation remain in progress; discovered follow-ups have separate child issues.

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
