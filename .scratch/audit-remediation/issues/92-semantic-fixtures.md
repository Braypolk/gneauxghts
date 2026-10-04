# 92-semantic-fixtures

Status: ready-for-agent
Progress: complete
Findings: UIX10
Owner: semantic remediation (editor agent)

## Plan

Inspect disposable setup across ANN, note ANN, Atlas labels/db/indexer. Reuse TestDir and one narrow semantic fixture/provider where contracts coincide. Preserve separate chunk/note adapter persistence and last-good-generation tests; do not create a configurable production adapter solely to merge tests. Replace raw Atlas directories with RAII cleanup.

## Validation

Focused ANN/note ANN/core/Atlas tests and compile; report intentionally retained distinct contracts.

## Outcome

Implemented shared on-disk/in-memory schema setup and central RAII directories across semantic/ANN/Atlas/status/database tests. Adapter persistence/generation seeds and distinct provider behaviors retained; a generic provider or adapter hierarchy has no evidenced benefit.

Validation evidence: `../semantic.md` and `../semantic-validation/`.
