# Navigate directly to old citations with bounded context

Status: ready-for-agent
Depends on: 49

## Acceptance

Open a valid old revision citation directly with bounded surrounding history, without walking every newer page. Keep the target bound to Note Identity and immutable Revision Identity. Use the concrete current store behind NoteTimeline; do not add a generic store interface.

## Checks

Exercise old targets in the current-format large fixtures, missing/stale/ineligible targets, nearby paging, cancellation, and obsolete responses after exit or a newer navigation request. Bound rows, context size, query work, and UI work independently of citation age. Preserve capability scope, citation revalidation, and workspace return behavior.

## Comments

- 2026-09-06: Orchestrator audit passed after independent Standards and Spec review. Review fixes, exact source/build hashes, backend/browser/native evidence and final report consistency were verified.

- 2026-09-06: Ordered history-hardening follow-up; run one fresh implementation agent per issue, with orchestrator audit before the next issue.


## Resolution

Implemented 2026-09-06. History Mode directly seeks the immutable Note/Revision
pair with at most 31 surrounding records through the existing concrete store.
Rebuildable successor indexes preserve explicit lifecycle/revision order;
scoped relative cursors page in both directions without growing the viewport.
Cancellation stops follow-on work after each entry await. Clear/restore leave
anchored paging while preserving the independent citation target and workspace.

[Validation](../../../docs/architecture/citation-context-50-validation.md) and
[raw evidence](../../../docs/architecture/citation-context-50-measurements.json)
record the unchanged current-format 10k/100k masters, 150 context + 200 nearby
backend samples, 66 visible/focused native samples, fixed row/SQL-work bounds,
source/build identities, retained failed harness attempts and cleanup.

Checks passed: 97 frontend/contract/chat-adapter tests; Svelte check;
196 Note Timeline tests (eight ignored); nine history-command tests;
16 architecture checks; delivered-citation browser navigation and workspace
return; both backend scale probes; both native scale probes. Native entry p95
139 ms in both fixtures; nearby p95 33/35 ms and 41/45 ms. No commit created;
canonical triage status remains `ready-for-agent` following orchestrator audit.
