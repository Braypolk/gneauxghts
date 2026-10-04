# 32: task mutation contracts

Status: ready-for-agent
Progress: complete; root integration and browser validation remain
Findings: FE06
Owner: editor audit agent

## Plan

Consolidate toggle/delete/due orchestration with explicit operation differences; strengthen warning/error/cleanup assertions. Cover prepare target/hash mismatch, conflict arriving during prepare, retry exhaustion, replacement attribution cancellation and save failure. Ensure timer cleanup survives failed assertions.

## Validation

Parameterized canonical/dirty/warning/failure tests and open-document task handler focused suite.

## Result

Implemented or evidence-backed disposition recorded in [editor remediation](../editor.md). Focused sweep: 44 files / 341 tests pass; parser refinement: 4 files / 33 tests pass. No full suites or commits.
