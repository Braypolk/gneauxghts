# 12 — Separate note-level retrieval and optimize validated passage work

Status: needs-triage
Type: task
Audit items: AA-05, AA-09, AA-10

Evidence: [module report](../reports/agent-app.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Define picker unique-note limit and deterministic representative passage with bounded continuation; keep agent passages unchanged. Instrument repeated canonical IO/hash and release index lock before IO; request-local snapshots only. Add deterministic hybrid composition with controlled existing semantic adapters.

## Acceptance and validation

Many passages from A do not crowd eligible B from a two-note picker; exclusion/date/clear rules preserved. Canonical edit between preparation/admission invalidates snapshot. Hybrid semantic-only, widening, stale/failed provider and lexical fallback have exact range/coverage assertions. Task-date passage metadata covers UTF-8 clipping, 16/17-item boundary, successful fields and no-items/null.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.

## Audit reconciliation and implementation status

See the editor task-date supplement for portable metadata cases and issue 18 for backend search kind/limit and command composition; shared cross-language authored-date fixtures are intentional coverage.
