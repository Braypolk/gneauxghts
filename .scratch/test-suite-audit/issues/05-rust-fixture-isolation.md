# Explicit Rust fixtures and process-global test configuration

Status: needs-triage

## Audit sources

reports/backend-persistence-and-timeline.md BP-01/02/09; reports/ui-settings-and-indexing.md UIX-10/11; reports/backend-agent-and-evidence.md AGENT-04

## Problem and intended result

Hundreds of tests serialize on mutable global paths; environment variables are manually changed/restored; some concurrency waits can hang. Initial watcher fixture fix is only the first step.

## Acceptance and replacement coverage

One RAII disposable-vault fixture joins owned background work and restores legacy globals. Prove two independent vaults and their child threads stay isolated before removing locks. Prefer pure config parsers; env smoke tests use panic-safe restoration. Bounded channel receives must pair with release guards so scope joins cannot hang.

## Constraints and handoff

High-risk persistence migration: use existing bound AppStateStorage/RunningVault, preserve ADR 0004 and initialization rollback. Do not simply remove the global lock.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
