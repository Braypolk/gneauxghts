# Initialize task schema once and simplify projection reconciliation

Status: needs-triage

## Audit sources

reports/backend-persistence-and-timeline.md BP-03/05

## Problem and intended result

Task reads/reconciliation repeatedly acquire write reservations and run schema DDL despite bound storage initialization. Task identity matching has repeated full scans.

## Acceptance and replacement coverage

Move complete app/task schema initialization into the existing transactional binding operation. Retain concurrent initializer and rollback tests. Prove an ordinary task read does not issue DDL or acquire migration write reservation. Measure comparison counts before indexing matching candidates; preserve duplicate task identity/tie behavior.

## Constraints and handoff

Building each TaskRecord once is a bounded initial cleanup; schema ownership changes need a separate reviewed change and fixtures updated with it.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
