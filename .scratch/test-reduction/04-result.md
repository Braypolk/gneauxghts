# Backend test reduction result

Status: ready-for-agent
Progress: Approved implementation complete and source frozen; coordinator combined Cargo verification pending. No production edits or new tests.

## Implemented

Deleted the exact eight library tests and two architecture tests recorded in `04-backend-audit.md` and `04-candidates.json`. Removed only the documented positive implementation snippets and now-unused source reads/imports from retained architecture checks. The named behavioral survivors remain unchanged; assertions were not relocated or folded into other test cases.

Baseline: `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-test-reduction-meo8wffi`, from this phase's `baseline.json`, not Git HEAD.

| File | Before lines | After lines | Delta | Removed tests |
| --- | ---: | ---: | ---: | ---: |
| commands/asset_commands/helper_tests.rs | 129 | 98 | -31 | 2 |
| semantic/activity.rs | 136 | 130 | -6 | 1 |
| semantic/ann_core.rs | 235 | 225 | -10 | 1 |
| semantic/atlas_labels.rs | 1734 | 1692 | -42 | 2 |
| semantic/chunking.rs | 313 | 304 | -9 | 1 |
| semantic/db.rs | 2984 | 2977 | -7 | 1 |
| tests/architecture_fitness.rs | 1092 | 709 | -383 | 2 |
| **Total** | **6623** | **6135** | **-488** | **10** |

All paths are under src-tauri. Library/support test reduction is105 lines; architecture test reduction is383. This includes deleting dead test-only imports/source reads and incidental empty lines, with no production line reduction claimed. The broader architecture savings exceeded the preliminary estimate because the approved detailed list removed more declaration and call-array scaffolding than estimated. It remains the same approved assertion scope.

## Preservation check

A snapshot comparison verified every changed library file's bytes before its cfg(test) module are identical. No production source changed. Every `assert_contains_none` call in each retained architecture test remains identical in content/order; only the two explicitly deleted whole tests lose their obsolete shape bans. The complete restart ordering block is identical. Function-scoped CurrentContent gate participation, scoped AllowedScope selection, history role entry/registration, offthread worker participation, bootstrap foreground/readiness controls, lifecycle ordering/exit veto, coordinator handoff and source-parser fixture checks remain.

The generic clear-during-read retrieval regression is unchanged and remains the surviving owner for the task mirror removed by the timeline agent. Distinct ANN adapter recovery, numerical policies, provider failures, permissions, durable retry/branching/admission/finalization and proposal recovery are untouched.

Evidence: `04-metrics.json` contains exact file line/count deltas; `04-changes.patch` contains this owner's complete snapshot diff. Coordinator was notified that source is frozen. No Cargo build or execution was run here, as requested; the coordinator will compile the combined backend once and own suite acceptance.
