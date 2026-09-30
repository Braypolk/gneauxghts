# Date functionality validation

Initial implementation validated September 29, 2026 (America/Denver). See the integration record below for the latest state.

## Automated checks

- `pnpm check`: Svelte diagnostics report zero errors/warnings; browser-test TypeScript also passes.
- `pnpm test`: 133 files, 960 tests pass. Includes fixed locale/timezone insertion, Gregorian validation, shared Rust/TypeScript annotation fixtures, DST and midnight/resume scheduling, date filter composition, dirty-document payloads, isolated undo/redo, concurrent-document rejection, and nested task independence.
- `pnpm build`: production static build passes.
- `pnpm exec wdio run e2e/wdio.browser.conf.ts --spec e2e/specs/browser/dates.spec.ts`: all four Chrome journeys pass. Covers ordinary date/time chip editing, typed values and calendar selection, due cancellation/shortcuts/removal, undo, master-list date/completion filters, inline surroundings, block commands, dismissal, and code/URL exclusions.
- Rust library suite: 668 passed, 15 intentionally ignored, one unrelated localhost-listener test denied by the filesystem/network sandbox. That test (`capacity_probe_backs_off_unknown_but_refreshes_success_and_model_changes`) passes on its permitted rerun outside the sandbox; there are no unresolved test failures.
- `cargo test --manifest-path src-tauri/Cargo.toml --test architecture_fitness`: all 19 pass. New deadline mutations retain the canonical task-service and timeline boundaries.
- Focused Rust checks cover portable deadline transformation, real Markdown task markers, exact/ambiguous targeting, CRLF/trailing-newline preservation, prepared/canonical mutation agreement, serde payloads, and stable task identity through deadline edits/reorder/external refresh/moves.
- `git diff --check`: passes.

## Limits

Native macOS/Tauri UI journeys were not run; UI interaction was checked in the browser harness, with Rust backend tests separately. Ordinary date/time chips recognize strict text in the current locale's insertion format; changing locale may leave earlier text as plain editable Markdown. Task deadlines are explicit date-only annotations. No automatic authored creation dates, reminders, recurrence, or due times were added.

See [the specification](spec.md) and [user guide](../../docs/features/dates.md).

## Pre-merge cleanup review — September 30, 2026

Baseline: `HEAD` at `ef6fed5`; comparison: `git diff HEAD`, with untracked date implementation/tests/docs read separately. Independent Standards and Spec reviews found preservation and integration defects; their follow-up reviews verified the fixes. No remaining actionable finding or broad-refactor requirement.

Corrections preserve hardbreak spaces, nested/escaped/code-covered reference and inline-link labels, and continued code/link spans. Adding a deadline within unfinished protected text fails visibly. Additional fixes retain editable `h24` midnight time chips, toggle every projected task marker without rewriting its prefix, and close the task-list picker on route unmount. Twenty-three shared parser fixtures cover the complete frontend/backend contract.

Post-cleanup checks: 961 frontend tests pass; four Chrome date journeys pass; type checks and production build pass. Focused Rust checks pass for all five date tests, 14 index tests, 12 task-service tests, five task-projection tests, and 19 architecture checks. `git diff --check` passes. Native macOS/Tauri UI remains untested. Changes are ready for merge review and remain unmerged in this worktree.

## Main integration — September 30, 2026

The user authorized merging to main. Feature commit `0466937` was integrated with main at `25454e6`. The sole conflict was the services module list; both `task_dates` and `tool_outcome` entries are retained. Architecture/invariant documentation merged with both features intact.

The combined tree passes `pnpm check`, 965 frontend tests across 134 files, `pnpm build`, all four Chrome date journeys, 36 focused Rust library tests, and all 19 backend architecture checks. A browser run interrupted by concurrent build-generated Vite reloads was repeated after the build completed and passed. Native Tauri UI remains outside this validation. No remote push was requested.
