# Test performance

Progress: Complete. Four source/config files changed; net seven lines removed. No test files changed.

## Accepted frontend changes

- Use Vitest's isolated thread pool, retaining its default worker sizing and per-file isolation.
- Keep root EditorState construction private to EditorDocumentRuntime; document resources import their actual factory rather than the broad pane-editor façade. This removes eager pane menus/date-picker imports from document-only call paths. No new modules or interfaces.

## Controlled measurements

All runs on this local machine with installed dependencies, no concurrent coordinator test/build/typecheck work. Aggregate Vitest timing categories overlap workers; only total duration is wall time. Earlier phases' timings are not this baseline.

| Workload | Before | Candidate |
| --- | --- | --- |
| Full frontend, original forks vs isolated threads only | 19.33 / 17.90s | 11.69 / 11.75s |
| Four document/review files, same thread pool | 4.91s | 0.42s |
| Full frontend, both changes | 19.33 / 17.90s | 8.95 / 9.03s |

The frontend run is approximately 52% faster using the means of the two baseline and final runs (18.615s versus 8.99s). This is a local measurement.

143 frontend files and all 1,065 exact case names remain. No assertions removed, test skips added or fixtures mocked out.

## Rust investigation

Full serial baseline: 725 passes, 15 existing ignored, 112.61s. Four dense-history fixtures account for 39.79s in that process. A minimal vault fixture was 3.7ms; generic setup/drop is not the leading measured cost. The same two heavy cases run faster in fresh processes, so suite-context timings cannot be treated as isolated fixture latency.

A two-fixture candidate used normal foreground admission to coalesce intermediate lexical jobs during canonical seeding, then drained before observation. It passed all 725 tests, but the full serial run was 111.56s versus 112.61s baseline: no convincing overall benefit. Both fixture edits were reverted exactly to baseline. The rejected patch and measurements are retained. No Rust performance improvement is claimed. See [investigation](backend-investigation.md), [candidate plan and decision](backend-fixture-followup.md), and [review](review-backend-fixtures.md).

## Evidence and scope

- [Experiment log](experiments.md), raw logs and JSON in this directory.
- [Frontend investigation](frontend-investigation.md), [independent review](review-frontend.md).
- [Saved baseline](baseline.json) is this phase's starting working tree, including earlier uncommitted work. [Exact phase diff](source-changes.patch) excludes prior changes.
- Typechecking passed with zero Svelte errors/warnings and successful E2E TypeScript checking.
- This is local warm-workspace evidence, not a promise about CI, other CPUs or cold installs. Browser/native startup performance was not measured.

## Final validation

- Normal `pnpm test`: 32 support tests and all 1,065 frontend tests pass (143 files); final frontend duration 9.03s.
- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript passes.
- Rust original full serial baseline: 725 passed, 15 existing ignored. Rejected candidate also passed the same inventory. Restored Rust files exactly match baseline and the restored test binary was rebuilt successfully.
- Exact frontend case-name comparison passes; no additions, removals, skips or assertion changes. Independent frontend review passes; dead import noted during review was removed. Final whitespace check passes.
- The first normal-command attempt hit sandbox `listen EPERM` in unchanged localhost support tests. Re-running with local socket access passed; this was not an application failure.
- Browser/native UI suites were not rerun in this phase. Editor behavior is protected by the unchanged full frontend suite; this change preserves exact root extensions/order and review-field append transaction.

Final source patch SHA256: `484de1c04f34a5ec3c55bbab15e44b5c24d065b56f8221eed5716bcdff642754`.
