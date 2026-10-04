# 31: task lifetime projections

Status: ready-for-agent
Progress: complete; root integration and browser validation remain
Findings: ED02 / FE04–05
Owner: editor audit agent

## Plan

Own each task-screen initialization lifetime; stop late subscription attachment, handle bootstrap failure, retire pending loads. Correlate group/mutation projections with filter/hidden view and per-note generation, prevent older full load/patch races, guard reorder rollback. Durable mutations must never be replayed because UI projection became obsolete.

## Validation

Deferred bootstrap/disposal/reentry, load/group/mutation response order, filter changes, concurrent reorder failure.

## Result

Implemented or evidence-backed disposition recorded in [editor remediation](../editor.md). Focused sweep: 44 files / 341 tests pass; parser refinement: 4 files / 33 tests pass. No full suites or commits.
