# 35: editor test seams

Status: ready-for-agent
Progress: complete; root integration and browser validation remain
Findings: ED01 / ED08–09 / FE08–09
Owner: editor audit agent

## Plan

Retain fixed transaction chaining; extract narrow real-state command and runtime-pane test adapters, migrate duplicated command harnesses, move meaningful undo copied-algorithm cases to runtime. Keep forwarding annotations contract tests. Correct forbidden save-rekey narrative and actual undoability claim.

## Validation

Run all migrated command/runtime tests; mutation-sensitivity check removing runtime caret synchronization then restore source.

## Result

Implemented or evidence-backed disposition recorded in [editor remediation](../editor.md). Focused sweep: 44 files / 341 tests pass; parser refinement: 4 files / 33 tests pass. No full suites or commits.
