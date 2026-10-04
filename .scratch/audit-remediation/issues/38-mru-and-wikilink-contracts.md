# 38: mru and wikilink contracts

Status: ready-for-agent
Progress: complete; root integration and browser validation remain
Findings: ED09
Owner: editor audit agent

## Plan

Add actual MRU capacity/seed tests and preserve legacy migration data on failed persistence. Cover wikilink begin/complete/dismiss/selection and runtime insertion through real editor state, stale query/close behavior; keep endpoint routing contracts but remove protocol duplication only with replacement coverage.

## Validation

Capacity >20, migration rejection, deferred autocomplete dismissal/replacement and suggestion insertion; focused MRU/wiki tests.

## Result

Implemented or evidence-backed disposition recorded in [editor remediation](../editor.md). Focused sweep: 44 files / 341 tests pass; parser refinement: 4 files / 33 tests pass. No full suites or commits.
