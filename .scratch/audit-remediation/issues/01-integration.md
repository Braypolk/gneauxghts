# Reconcile existing audit fixes

Status: ready-for-agent
Progress: complete
Owner: root

## Scope

Six overlapping paths require hunk reconciliation. Import Sol Python closure and obsolete streaming corrections; keep one test:support command wired into ordinary test. Preserve both regressions and all initial local fixes.

## Verification and acceptance

Inspect diff before transfer. Run Node support, Python ResourceWarning-strict, frontend and types after integration.

## Outcome

Reconciled both audit workstreams without overwriting overlapping regressions. Node support is invoked exactly once, Python SQLite fixtures close connections with ResourceWarning-strict tests, obsolete empty-stream native assertion is removed while evidence assertions remain. Frontend, types, Node and Python gates passed; latest combined verification is recorded in ../validation.md.
