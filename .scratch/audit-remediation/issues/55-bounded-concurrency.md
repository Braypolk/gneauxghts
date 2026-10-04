# Bounded lifecycle and watcher test gates

Status: ready-for-agent
Progress: complete
Owner: audit_timeline
Findings: BP-09; BT-08; BB-04

## Scope and acceptance

Use release-on-drop ownership inside thread scopes plus bounded waits. Correct lifecycle joining unwind hang, watcher drain, task-delivery gate and Editing Window scheduler deadlines. Retain real worker/barrier tests and distinguish true negative ordering assertions from idle sleeps.

## Validation

Run the named owner tests and relevant durability/ordering cases after changes. Record commands and results in ../timeline.md. Root owns full-suite integration. No baseline audit rewrites.

## Outcome

Implemented and reviewed. See [owner outcomes and verification](../timeline.md) for the finding-by-finding disposition, preserved invariants, measurements, and targeted test results.
