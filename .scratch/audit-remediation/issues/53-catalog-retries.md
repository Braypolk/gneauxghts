# Pending-only projection retries

Status: ready-for-agent
Progress: complete
Owner: audit_timeline
Findings: BP-07; BT-04/06

## Scope and acceptance

Remove catalog test manual second projection. Add pending work membership separate from retained generation state; avoid all-history retry scans while retaining stale-job rejection. Measure settled/churn entries and document whether watermark retirement is justified; no unsafe tombstone eviction.

## Validation

Run the named owner tests and relevant durability/ordering cases after changes. Record commands and results in ../timeline.md. Root owns full-suite integration. No baseline audit rewrites.

## Outcome

Implemented and reviewed. See [owner outcomes and verification](../timeline.md) for the finding-by-finding disposition, preserved invariants, measurements, and targeted test results.
