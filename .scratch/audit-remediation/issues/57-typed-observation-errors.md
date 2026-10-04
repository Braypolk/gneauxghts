# Preserve typed replay failures

Status: ready-for-agent
Progress: complete
Owner: audit_timeline
Findings: BT-10

## Scope and acceptance

Replace stringifying replay context with HistoryError::with_context and inspect neighboring conversions. Add direct retained replay regression for typed corruption/stale/unavailable; preserve acknowledgment ordering, retained bytes and admission behavior.

## Validation

Run the named owner tests and relevant durability/ordering cases after changes. Record commands and results in ../timeline.md. Root owns full-suite integration. No baseline audit rewrites.

## Outcome

Implemented and reviewed. See [owner outcomes and verification](../timeline.md) for the finding-by-finding disposition, preserved invariants, measurements, and targeted test results.
