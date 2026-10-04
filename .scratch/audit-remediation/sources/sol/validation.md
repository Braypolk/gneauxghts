# Audit and cleanup validation

Baseline: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`. Final verification: 2026-10-03, America/Denver. No commit, PR or deployment was requested or created.

## Audit sequence and limits

The initial six module reports and combined review were saved and reviewed before the first application/test edit. The review approved a bounded implementation tranche. Final inventory reconciliation then exposed omitted detailed inspections; dated coverage supplements explicitly record those added inspections and findings without pretending they preceded the cleanup. No code from the newly identified supplemental findings was changed. Reports distinguish confirmed defects, weak evidence, design judgments and unmeasured performance hypotheses. Static declarations and production-inclusive Rust line counts are not executed coverage.

An independent agent reviewed the combined cleanup diff and traced stale-response generations, collapsed related-panel reads, exact conflict identity recovery, error parsing, and test replacement/deletion. No actionable correctness/standards finding remained. The primary reviewer also inspected production diffs and confirmed the intended ownership boundaries remain in place. Supplemental overlapping-proposal and legacy-wrapper recommendations received separate independent source review.

## Implemented findings

| Audit items | Result | Evidence retained |
| --- | --- | --- |
| FE-01/02 | Search replacement/empty input and related reset/scope/collapse retire prior asynchronous work immediately; debounce/highlight behavior retained | Deferred success/error regressions and fake timer scheduling; full frontend pass |
| FD-01 | Editor replacement or rollback rejection returns the matching conflict to retryable state and rethrows the original diagnostic; newer conflict remains untouched | Initial, stale rollback, changed-revision rollback and superseding-conflict cases; agent observed three failures before fix |
| FD-07 | Removed literal duplicate assertions and disconnected spy; notOpen behavior checks real document/registry identity | Existing service/controller suites and full frontend pass |
| CC-03 | Closed history error vocabulary uses own-property membership | Inherited keys failed before fix; malformed values and existing error identity pass |
| CC-02 | Removed the second whole-project TypeScript program; kept structural architecture tests and required compiler gate | Full compiler gate; fitness suite now 12 tests, focused run about 31 ms instead of the old single 2.34-second assertion |
| EH-01/13/15 | Ordinary test command includes eight existing support checks; removed obsolete empty-stream expectation; clarified historical integration wording; SQLite contexts close after transaction | Eight harness cases; E2E type check; Python warning-strict suite |
| BT-01/04/07 | Guarded six identified canonical fault consumers; catalog test relies on production projection; removed no-fault duplicate masquerading as derived-failure test | Affected Rust suites pass; genuine semantic failure and finalization/task warning tests preserved |

BT-01 isolation is only partially addressed: shared globals, override restoration, workers and additional unguarded readers still need the RAII fixture work in ticket 10. Broad fitness replacement, browser fixture rewrite, large modules and the supplemental production findings remain open. No native/live-model result is inferred from removal of an obsolete assertion.

## Executed checks

| Check | Baseline | After cleanup |
| --- | --- | --- |
| Frontend Vitest | 141 files, 1,007 passed, zero failed/skipped | `pnpm test --reporter=json --outputFile=.scratch/test-suite-audit/vitest-final.json`: 141 files, 1,030 passed, zero failed/skipped |
| Cheap Node harness | Eight passed independently; separate artifact probe also passed | Eight passed as part of `pnpm test` (about 39 ms harness duration) |
| Svelte + E2E TypeScript | Zero Svelte errors/warnings; E2E tsc passed | `pnpm check`: same passing result |
| Python fixture | Eight passed | `python3 -W error::ResourceWarning -m unittest discover -s scripts/tests -p 'test_*.py' -v`: eight passed |
| Rust full ordinary gate | Local binding allowed: 711 library tests passed, 16 ignored; 19 architecture tests passed | No production Rust changed. Recompiled and ran affected state (15), task mutation (11), catalog (3), post-publication warning (5) tests: all 34 passed |
| Rust formatting | Full baseline formatting was not normalized | Changed three Rust files pass `rustfmt --check --edition 2021 --config skip_children=true`; whole-project `cargo fmt -- --check` fails only in five untouched baseline files |
| Patch whitespace | Clean starting tree | `git diff --check` passes |

Rust sandbox execution first produced 710 passes and one localhost `TcpListener::bind` permission failure. The focused retry and complete ordinary suite passed with localhost binding allowed. The sandbox failure is not an application defect. Sixteen ignored Rust acceptance/scale fixtures were not run. The obsolete no-fault test removal lowers the compiled Rust library inventory from 727 to 726; it does not remove genuine postcommit-failure coverage.

Whole-project formatting differences are in untouched `commands.rs`, `commands/asset_commands.rs`, `commands/search_commands.rs`, `services/note_timeline/history_mode.rs`, and `tags.rs`. Each was checked against Git and remains unchanged; see [format log](rust-format-full.log). They are a separate mechanical cleanup candidate, not a new formatting regression.

## Measurements and artifacts

- [Baseline Vitest JSON](vitest-baseline.json): about 42.64 seconds from start through final test completion. [Final JSON](vitest-final.json): about 16.85 seconds. Startup caches and concurrent host workloads differ, so this is not an attributable speedup benchmark.
- [Final frontend/harness log](frontend-final.log), [type checks](check-final.log), [Python](python-final.log).
- [Complete Rust baseline](rust-tests-unrestricted.log), [state](rust-cleanup-verification.log), [task](rust-task-cleanup.log), [catalog](rust-catalog-cleanup.log), [warnings](rust-warning-preservation.log).
- [Malformed error regression before fix](history-error-regression.log), [contracts/fitness focused verification](contracts-fitness-verification.log).
- [Static inventory](inventory.json) and per-module report inventories preserve the baseline scope. Runtime parameterization explains frontend count differences.

Browser/native UI journeys, live providers, optimized scale fixtures, deliberate process-crash matrices and power-loss behavior were not executed. Recommendations affecting those boundaries specify their required replacement evidence in individual tickets. No blanket test deletion or entire-app rewrite was performed.
