# Preserve and compare compatible editor benchmark results

Archived execution ticket, 2026-10-21. The original plan and chronological comments below are historical, outside the executable backlog. See the [implementation outcome and verification limits](../../package-capabilities-2026-10-21.md#integration-result).


Historical record: implementation complete; combined acceptance is tracked in the outcome record.
Type: task

## Problem and scope

The Vitest 5 migration made the six current workloads executable; it did not make historical measurements comparable or preserve results for later work. Add explicit capture and comparison commands with compatibility checks and readable evidence. Keep `pnpm bench` as the existing quick timing-table command. This is a Node microbenchmark tool, with no automatic claim about native typing, focus, paint or frame latency.

References: [capability research](../../../../docs/research/upgraded-package-capabilities-2026-10-21.md), [frontend research](../../../../docs/research/upgraded-frontend-capabilities-2026-10-21.md), [Vitest benchmark API](https://vitest.dev/guide/benchmarking). API details below were checked against installed Vitest **5.0.5** declarations and implementation. Do not reuse Vitest 4/Tinybench baselines.

## Current owners and implementation boundary

- `src/lib/features/notepad/markdown/markdownDecorations.bench.ts`: 500-section fixture; one/two-pane decoration rebuilds, fresh code-context calculation and cached code-context lookup.
- `src/lib/features/notepad/images/imageInventory.bench.ts`: 500-image fixture; initial inventory and 500 selection updates.
- `package.json`: `bench` is `vitest bench --run --reporter=default`; regular unit tests exclude benchmark files.
- `vite.config.js`: Node, threads and per-file isolation; keep these settings unchanged for this issue.
- Native measurement owners remain `e2e/specs/native/markdown-marker-merge.spec.ts`, `markdown-synchronous-paragraph.spec.ts`, `search-focus.spec.ts` and their harnesses. Their fixtures/results are a different measurement family.

Own only the two benchmark files, new benchmark support under `scripts/benchmarks/`, new Node support tests under `scripts/tests/`, and `docs/development/benchmark-comparisons.md`. The integrator owns additive `package.json` script edits if other work is touching that manifest. No application runtime, dependency, lockfile, native harness or Vite configuration changes.

## Design decisions

1. Add `scripts/benchmarks/run.mjs` with `capture --out <repo-relative-dir>` and `compare --baseline <repo-relative-dir> --out <repo-relative-dir>`. Add `bench:capture` / `bench:compare` package scripts invoking those modes. Use Node built-ins and a structured `spawn` argument array; no shell-string construction or new package. Forward a documented `--label <local-machine-label>` as required metadata. Reject an existing/nonempty output directory and every path escaping the repository (including symlink escapes). Capture never overwrites a baseline. Default no output path: print usage and exit nonzero.
2. Give each workload a stable ID and explicit `workloadVersion`. Extract only shared benchmark registration/fixture-descriptor plumbing needed by both files; no production algorithm changes. Preserve the six workload operations and initial 150 ms / 10 iteration run options. Support full six-workload runs first; omit filters/partial capture to keep completeness meaningful.
3. In normal `pnpm bench`, use current `.run(...)` without artifacts or saved baseline requirements. In capture mode, use the real overload `bench(name, { writeResult: path }, fn).run(options)`. The runner supplies a run-local manifest/path under the repository, read by benchmark helper code. Each registration writes a distinct raw artifact. Vitest stores `latency`, `throughput`, `period`, `totalTime`; metadata belongs in a separate versioned manifest, not invented fields inside its baseline schema.
4. In compare mode, preflight the baseline, then invoke `await bench.compare(bench.from('baseline', baselinePath), bench('current', { writeResult: currentPath }, fn), options)` for each workload. Saved measurements are historical data, not a rerun of the old implementation. The resulting table must label that distinction. Use Vitest's JSON reporter alongside the default reporter when collecting machine-readable test/benchmark groups; keep inline timing tables visible. Do not create a custom benchmark provider or duplicate Tinybench's statistics engine.
5. Check observable correctness before timing, using deterministic summaries of actual outputs (decoration counts/ranges, code ranges, image count and final selection), and consume timed results through a module-local sink. Avoid expensive correctness assertions/serialization inside the timed function. Do not compare the two-pane workload with a one-pane baseline or a cached lookup with a fresh calculation. Do not create a deliberately slow fake reference just to claim a speedup.
6. Manifest schema v1 records: capture timestamp; git HEAD plus dirty flag; Node/V8; Vitest and resolved Tinybench version; platform/architecture, OS release, CPU model, logical CPU count, machine label; workload ID/version, fixture SHA-256 and UTF-16 length/count descriptors, warm/cold/setup semantics, time/iteration options; relevant CodeMirror/Lezer package versions and lockfile hash; measurement family `node-microbenchmark`; completed workload/result paths. Keep absolute workspace paths, hostname, usernames and note contents out of portable reports. Dirty source is permitted but must be disclosed, since the current upgrade is uncommitted.
7. Compatibility is a decision before comparisons: require supported manifest schema, exact six workload IDs/versions, fixture hashes, operation/setup/warmup options, Node/V8, Vitest/Tinybench, measurement family, machine label, CPU model, platform/architecture and OS release. Require valid finite numeric statistics, positive sample counts and all six passed outputs. Missing/malformed/partial/incompatible evidence fails with a clear reason before starting measurements. Do not offer a force flag that presents incompatible output as comparable. CodeMirror/Lezer versions, application code/commit and lockfile may differ deliberately: record and display those deltas, because evaluating those changes is a purpose of the tool.
8. Produce `manifest.json`, six raw Vitest artifacts, reporter JSON and `comparison.md`/JSON with baseline/current means, uncertainty/sample data, p95/p99 where provided, and percentage deltas. Clearly show baseline age and whether source was dirty. Results are observational; no fixed absolute duration limit or unconditional cross-machine CI speed gate. A consistent repeated slowdown is an investigation trigger, not proof of a cause. Do not use `toBeFasterThan` as a default pass/fail assertion against historical measurements; reserve relative assertions for future same-run, semantically equivalent references with a deliberately chosen delta.
9. Write a complete manifest atomically only after successful validation of all six results. An interrupted/failed run leaves explicitly incomplete evidence that cannot become a baseline. Keep generated run data under an ignored `.scratch/package-capabilities/evidence/benchmarks/` subtree; commit the tool/schema/selected report conclusion, not machine-specific raw baselines by default.

## Implementation sequence

1. Implement versioned manifest validation/path containment and summary generation as small reusable Node functions with meaningful fixture tests.
2. Add the runner and shared workload descriptor/registration helper; adapt both benchmark files without changing production code or workload semantics.
3. Verify normal `pnpm bench` still discovers two files/six workloads and prints timings without writing artifacts. Add package scripts through integrator.
4. Capture a local baseline, compare a fresh current run against it on the same quiet machine, then repeat the comparison twice. Document noise, not a manufactured improvement. A source change is unnecessary to validate saving/loading.
5. Record the workflow, compatibility/refusal rules, intentionally refreshed baseline policy and native distinction in the developer document. Link selected evidence from the issue's completion comment.

## Verification and acceptance

- Node helper tests cover compatible metadata, changed runtime/fixture/engine/machine refusal, permissible dependency/source changes, malformed/NaN/missing statistics, duplicate/missing workloads, path/symlink traversal, existing output, failed child and incomplete capture. Test the real contract rather than snapshotting implementation strings.
- `pnpm bench` preserves all six workloads and regular `vitest run` still excludes them. `pnpm check` passes for shared TypeScript helpers if added.
- Capture produces complete, validated evidence; compare loads all six through actual `bench.from`, writes current results separately and prints a readable report. No artifact is overwritten and no comparison silently mixes incompatible runs.
- Three same-machine comparisons expose observed variability. No universal milliseconds or mandatory speedup is asserted. Tests are green on naturally noisy runs.
- Documentation says that changing fixture/workload/measurement engine requires a fresh baseline; changing candidate production code/dependencies does not inherently invalidate the measurement contract.
- No native performance acceptance is claimed for this tooling-only change. When a future app/parser optimization is evaluated, pair it with actual foreground native focus and large-document measurements under `docs/agents/ui-verification.md`. Existing native pane-motion baseline failure remains a separate issue.

## Dependencies and parallelism

Independent of connection errors, search excerpts, image-delivery experimentation and Kit error presentation. Can implement concurrently with the inspector documentation. Serialize the tiny `package.json` script integration; avoid overlapping changes to `vite.config.js` with a future doctor/config experiment. This issue establishes a comparison tool, not a dependency for starting native image measurements.

## Comments

Planning only on 2026-10-21. No measurements, tests or implementation were run during planning.

Implementation in progress on 2026-10-21: added `scripts/benchmarks/{run,evidence,workloads}.mjs` and the shared `register.ts`, adapted the existing two benchmark files without production algorithm changes, and documented the workflow in [benchmark comparisons](../../../../docs/development/benchmark-comparisons.md). The integrator owns the two additive package scripts. Nine focused Node contract tests pass, covering compatibility, statistics, provenance deltas, path/symlink containment, incomplete/failed child runs and atomic publication. Timing verification is intentionally waiting for a quiet machine while the other chat measures native image behavior; no saved baseline or timing conclusion is claimed yet.

Completed implementation verification later on 2026-10-21: the integrator added `bench:capture`/`bench:compare`. In an exclusive quiet CPU window, ordinary `pnpm bench` passed two files/six workloads, then actual capture and three comparisons each published six complete passed artifacts. Comparisons used saved results through real `bench.from`, with separate current `writeResult` paths and successful JSON reporter validation. [Selected measurements and limitations](../../../../docs/research/editor-benchmark-comparisons-2026-10-21.md) record means, repeat medians/ranges, counts, uncertainty and module-runner getter warnings. No production optimization or native latency claim is made; this deliberately unchanged candidate exposed variability. Ignored raw runs are `evidence/benchmarks/{capture-01,compare-01,compare-02,compare-03}`. The quiet CPU slot was released before the doctor's experiment.
