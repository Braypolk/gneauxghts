# 91-semantic-work-oracle

Status: ready-for-agent
Progress: complete
Findings: UIX09
Owner: semantic remediation (editor agent)

## Plan

Inspect real inventory/embedding loading path. Introduce per-connection or owner-scoped test observability for the full-corpus loaders, avoiding process-global counters. Replace the 20k ordinary fixture with a small boundary case whose assertions observe forbidden work; retain the original scale distribution as explicitly ignored opt-in test. Rename claims to exactly what is observed.

## Validation

Small/scale wrapper share one behavioral test; counters or SQLite query observations prove scope of embedding/inventory reads; focused note batch tests.

## Outcome

Implemented: SQLite progress-handler instruction counts compare 32 and320 chunks for production single-recall indexing, with <=100 instruction growth budget.20k version is explicit opt-in and passed. Name claims SQL work/no rebuild only.

Validation evidence: `../semantic.md` and `../semantic-validation/`.
