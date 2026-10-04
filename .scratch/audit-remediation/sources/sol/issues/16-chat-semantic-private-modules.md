# 16 — Split private chat and Atlas responsibilities and consolidate explicit policy

Status: needs-triage
Type: task
Audit items: AA-12, AA-14

Evidence: [module report](../reports/agent-app.md); [combined review](../review.md). Locations refer to baseline cb4d4c0; inspect current code before implementing.

## Work

Move ChatService storage/projection/attachments/context/configuration and Atlas publication/graph/query internals mechanically first; compare test IDs. Decide model-catalog source and tiny-vector/clamping cosine semantics before sharing code. Retain one runtime/semantic work owner and distinct ANN schemas.

## Acceptance and validation

No visibility expansion or second state owner; migration/recovery/grant/privacy/quiescence/geometry fixture outcomes unchanged. Catalog availability/current/custom model rules shared across languages; vector zero/tiny/nonfinite/mismatch behavior deliberate. Large fixtures moved only after bounded invariant coverage.

Read ARCHITECTURE.md, applicable behavior invariants and ADRs before changing ownership, writes, persistence, state coordination or runtime seams. Port meaningful regression coverage before removing old tests. Record actual checks, limits and any proposal rejected by evidence; no raw test-count target.
