# Editor benchmark comparisons

`pnpm bench` runs the existing two files and six Node workloads with inline timing tables. It writes no evidence. These microbenchmarks measure decoration rebuilding, code-context calculation/cache lookup, image inventory construction and selection transactions. Native typing, focus, paint and frame latency need their own foreground app measurements under [UI verification](../agents/ui-verification.md).

Use a quiet machine and run one benchmark process at a time. Pause builds, browser suites, native measurements and other timing experiments. Capture/comparison serialize benchmark files through `--no-file-parallelism`, retaining the configured threads pool and per-file isolation; ordinary `pnpm bench` keeps its current invocation. A baseline is a saved measurement of the implementation that ran at capture time; comparison does not check out or rerun that implementation.

```sh
pnpm bench:capture --out .scratch/package-capabilities/evidence/benchmarks/baseline-01 --label local-arm64
pnpm bench:compare --baseline .scratch/package-capabilities/evidence/benchmarks/baseline-01 --out .scratch/package-capabilities/evidence/benchmarks/compare-01 --label local-arm64
```

Choose a short, nonpersonal machine label and reuse it only on that machine. Both commands require a new repository-relative output directory; even an empty existing directory is refused. Absolute paths, traversal outside the repository and symlinks in an evidence path are refused. There is no overwrite or force option. The ignored evidence subtree above is the intended location; commit the tool and concise conclusions, rather than local raw baselines.

Capture writes one raw Vitest result per workload, a JSON reporter result and a versioned `manifest.json`. Comparison additionally writes `comparison.md` and `comparison.json`, while leaving the baseline untouched. The tables compare mean latency, relative margin of error, sample count and p99; raw artifacts retain the engine's other statistics. Tinybench does not provide p95. A positive latency percentage means slower. The default engine does not retain individual samples; `samplesCount` and uncertainty statistics remain available.

Each workload checks observable output before measurement and consumes timed results. The two pane workload still performs two decoration rebuilds; fresh code-context work still creates a document on each iteration; cached work explicitly warms the shared document; image selection still makes 500 selection transactions. Run limits remain 150 milliseconds and 10 iterations, with Tinybench's existing warmup defaults recorded explicitly as 250 milliseconds/16 iterations.

The runner publishes the complete manifest atomically after all six tests and artifacts validate. A failed or interrupted run leaves `incomplete.json`, which cannot be loaded as a baseline. Missing files, failed/partial tests, duplicate workload IDs, malformed or nonfinite statistics and nonpositive sample counts are refused before comparison begins. A successful run removes the incomplete marker.

Compatibility requires schema/family, all six workload descriptors and fixture hashes, operation/setup/warmup options, Node/V8, Vitest/Tinybench and machine label/CPU/OS/architecture to match exactly. Changing any of these means deliberately capturing a fresh baseline. Never import Vitest 4/Tinybench measurements into this schema. CodeMirror/Lezer versions, source commit/dirty state and lockfile may differ, because measuring a candidate dependency or application change is an intended use. Their provenance is recorded and displayed. A dirty checkout is allowed and clearly disclosed. Reports omit the workspace root, hostname, usernames and fixture contents.

Repeat a comparison at least three times into distinct directories before interpreting a difference. Compare its size with the observed variability and uncertainty. A repeated slowdown merits investigation; there is no fixed duration limit, required speedup or cross-machine CI gate. These six operations are different workloads and must never be used as interchangeable references.

Run the support contract checks with:

```sh
node --test scripts/tests/benchmarkEvidence.test.mjs
```

The schema and validation live in `scripts/benchmarks/evidence.mjs`; stable workload definitions and synthetic fixtures live in `scripts/benchmarks/workloads.mjs`. Bump a workload's version when changing its operation or setup, even if its fixture stays unchanged.

[Initial tooling validation](../research/editor-benchmark-comparisons-2026-10-21.md) includes three same-machine comparisons and their observed variability. Vitest can warn about module export getter overhead, particularly for very short cached operations; preserve such warnings and treat those measurements as including harness overhead.
