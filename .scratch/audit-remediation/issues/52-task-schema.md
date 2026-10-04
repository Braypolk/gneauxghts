# Initialize complete bound schema once

Status: ready-for-agent
Progress: complete
Owner: audit_timeline
Findings: BP-03; BT-05

## Scope and acceptance

Move task projection schema into the existing immediate bootstrap transaction before publishing AppStateStorage. Remove per-read/per-reconcile DDL and migration calls. Preserve concurrent initializer/rollback tests including task schema failure; verify initialized read under competing writer. Keep running-vault bound ownership.

## Validation

Run the named owner tests and relevant durability/ordering cases after changes. Record commands and results in ../timeline.md. Root owns full-suite integration. No baseline audit rewrites.

## Outcome

Implemented and reviewed. See [owner outcomes and verification](../timeline.md) for the finding-by-finding disposition, preserved invariants, measurements, and targeted test results.
