# Owned Vite and process lifecycle

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: root

## Scope

H5/EH04/12. Admission requires own server identity; bound fetches, reject child failure, clean up failed preparation, tolerate already exited groups. Consolidate repeated transport only where ownership remains explicit.

## Verification and acceptance

Temporary child/HTTP tests: occupied port, early exit, hung response, success, failed preparation and cleanup. Never kill unrelated processes.

## Outcome

Implementation and focused validation are recorded in [root report](../root.md). Independent review and integrated native validation remain in progress; discovered follow-ups have separate child issues.

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
