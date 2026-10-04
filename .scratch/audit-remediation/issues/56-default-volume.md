# Right-size default receipt volume

Status: ready-for-agent
Progress: complete
Owner: audit_timeline
Findings: BP-08; BT-09

## Scope and acceptance

Measure default store receipt test, reduce 300 captures to safely over 64 retry receipts plus protected references, keep exact stale/hash/seal/integrity assertions. Preserve 140 revisions crossing128 and ignored12x300 release geometry. No claimed speedup without measurement.

## Validation

Run the named owner tests and relevant durability/ordering cases after changes. Record commands and results in ../timeline.md. Root owns full-suite integration. No baseline audit rewrites.

## Outcome

Implemented and reviewed. See [owner outcomes and verification](../timeline.md) for the finding-by-finding disposition, preserved invariants, measurements, and targeted test results.
