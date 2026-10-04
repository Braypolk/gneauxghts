# 14 — Make execution lanes explicit and separate stress from invariants

Status: needs-triage
Type: task
Audit items: EH-02, EH-03, EH-11, EH-14, EH-16, BT-09, AA-11

Evidence: [module report](../reports/e2e-harness.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Manifest deterministic browser/native smoke, model evaluation, process durability and scale; include omitted image/WebKit motion specs with isolated sequential fixture lifetimes. Add bounded quick CI for chosen supported platform. Keep threshold-sized receipt regressions default, move excess volume/observational MiB saves to opt-in. Archive or rebase shadow live protocol after tracing references.

## Acceptance and validation

Enumeration includes every intended test without launching models/native; quick gate stays deterministic; receipt threshold/protected anchors remain covered. Live execution distinct from semantic grading and profile/desktop prerequisites explicit. Preserve historical experiment evidence.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.
