# Evidence session capacity and reusable pagination

Status: ready-for-agent

## Audit sources

reports/backend-agent-and-evidence.md EVIDENCE-01/02/03/04; RETRIEVAL-01

## Problem and intended result

Existing search cursors are rejected at new-search capacity; activity pages rerun full search and grow session storage. One continuation test recreates the session on every page.

## Acceptance and replacement coverage

In one fixture/session, perform 31 empty searches, paginate search 32, and reject new search 33 while allowing its existing cursor. Page inventory in one session and measure search allocations/work. Each resume retains permission/content/provenance checks. Test actual interactive retrieval adapter separately from timeline reads.

## Constraints and handoff

Fix capacity first. Reusing canonical snapshots is only per operation, never across freshness boundaries. Remove obsolete inventory return payloads after caller migration.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
