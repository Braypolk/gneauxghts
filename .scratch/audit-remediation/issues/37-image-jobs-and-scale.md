# 37: image jobs and scale

Status: ready-for-agent
Progress: complete; root integration and browser validation remain
Findings: ED08 / FE12
Owner: editor audit agent

## Plan

Extract view-scoped upload operation coordination only if needed for deterministic async lifecycle tests; cover range changes, partial retry, cancellation and disposal without browser sleeps. Separate algorithm cache invariant from opt-in scale timing and use small configurable loader budget for boundary tests. Preserve source/undo/file retention.

## Validation

Focused image parser/cache/jobs/runtime tests; root owns clipboard/drag/focus/native browser assertions and completion-aware waits.

## Result

Implemented or evidence-backed disposition recorded in [editor remediation](../editor.md). Focused sweep: 44 files / 341 tests pass; parser refinement: 4 files / 33 tests pass. No full suites or commits.
