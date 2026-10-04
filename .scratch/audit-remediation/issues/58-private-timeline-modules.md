# Private history codec and test locality

Status: ready-for-agent
Progress: complete
Owner: audit_timeline
Findings: BP-10; BT-11/12

## Scope and acceptance

Extract private authored codec and colocated exact/in-memory tests where dependencies remain small; preserve SQL transaction order and storage-neutral external seam. Organize large window tests around explicit subjects without changing intentional save/finalize semantics. Coordinate architecture source scanner with root.

## Validation

Run the named owner tests and relevant durability/ordering cases after changes. Record commands and results in ../timeline.md. Root owns full-suite integration. No baseline audit rewrites.

## Outcome

Implemented and reviewed. See [owner outcomes and verification](../timeline.md) for the finding-by-finding disposition, preserved invariants, measurements, and targeted test results.
