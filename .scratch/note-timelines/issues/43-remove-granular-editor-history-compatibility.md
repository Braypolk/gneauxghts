# Remove granular Editor history compatibility

Status: ready-for-agent

## Request

The user requested removal of previously stored Individual revisions and will rebuild the databases for the new versions. This deliberately supersedes issues 36–42's promise to retain compatibility with granular Editor history. Do not delete user databases.

## Scope

- Support only newly created schema 13 history stores. Reject every earlier schema and preexisting files without complete metadata before schema writes; expose the existing confirmed Settings history reset, which advances the generation and builds truthful current-Markdown baselines.
- Remove old schema migrations, trust-and-migrate command/authorization, old Editor writer policy switches, and Editing Session grouping storage projection, DTO, component, and test fixtures.
- Keep each Editing Window selectable as one net diff. Preserve standalone creation/baseline/task/proposal/restore/external points and separate lifecycle events. Editor content published with rename/move is an explicit lifecycle boundary, not an ordinary autosave.
- Reject ordinary Editor point revisions even if an old store is relabeled with the current schema. Preserve mutation preparation, capture warnings, receipt safety, recovery, and portability checks.
- Run current window policy in tests and disposable fixture tooling. Preserve existing release reports and measurement evidence as historical records.

## Resolution

Implemented and reviewed. The final full Rust, frontend, architecture, fixture, Svelte, browser, and available native functional gates pass. Current schema-13/v2 fixture generation and backend latency/storage/reopen diagnostics pass. The two formerly pending visible native gates passed in [issue 47](47-complete-pending-native-acceptance.md) on 2026-09-06 after an optimized rebuild of the completed issue-46 baseline. Actual interrupted-process relaunch and larger retained-history scale remain separate follow-ups.

See [current-format validation](../../../docs/architecture/editing-window-current-format-validation.md) and its [exact measurements and log hashes](../../../docs/architecture/editing-window-current-format-measurements.json). The report records all failed attempts, the embedded-driver reconnection limitation, review fixes, and the two completed native commands with their issue-47 evidence. Historical issue 42 and earlier release evidence remain unchanged.

## Comments

- 2026-09-05: Deliberately supersedes old-store preservation promises in issues 36–42. No user database deletion or migration performed.
- 2026-09-05: Correctness: 529 Rust unit +16 architecture, 797 frontend, 6 Python, 11 browser, and 8 native functional journeys passed. Svelte check has no errors/warnings.
- 2026-09-05: Current fixture contains 95 revisions/92 windows/287 receipts, no pending windows or unresolved intents. Backend 1 MiB page/diff and reconstruction/restore-preview budgets passed.
- 2026-09-05: Console lock is confirmed. Native responsiveness refused hidden measurements; optimized fixture paint remains pending. User unlock is the only remaining validation dependency.

- 2026-09-06: Issue 47 completed both visible native gates on an unlocked display. Autosave/deadline functional assertions passed with diagnostic timings; all six fixture entry/page/diff p95 values were below 250 ms. See [native acceptance](../../../docs/architecture/editing-window-native-acceptance-47-validation.md). The dated locked-display comment above records the original failed attempt.
