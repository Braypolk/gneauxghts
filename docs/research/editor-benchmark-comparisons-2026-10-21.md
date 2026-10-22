# Editor benchmark comparison tooling validation

Validated on 2026-10-21 local time (capture timestamp `2026-10-22T00:05:31.391Z`). This checks saving/loading compatible observations of the same candidate implementation; it is not a before/after optimization experiment.

Environment: Apple M4 Pro, 12 logical CPUs, macOS/Darwin 25.6.0 arm64, machine label `local-arm64`, Node 24.2.0/V8 13.6.233.10-node.17, Vitest 5.0.5/Tinybench 6.2.2. Source was dirty at commit `84fea1a4cda5f04c8056c87ec567b3e0f4c59a71`. Lockfile SHA-256 was `87173fd65dbc73506aef9fbba026053ef94727588cb659cd2eddbff46ae026aa`. Resolved editor versions, fixtures, options and provenance are included in every manifest.

The integrator reserved an exclusive CPU timing window after native image/search measurements finished. No other build, browser/native suite or performance experiment ran concurrently. Ordinary `pnpm bench` passed two files/six workloads. One capture and three independent comparisons passed all six workloads, using actual Vitest `writeResult` artifacts and historical `bench.from` inputs. Capture/comparison ran benchmark files sequentially, with the existing threads pool and isolation.

| Workload | Saved baseline mean ms | Median of three current means ms | Range of three current means ms | Delta range against saved baseline |
| --- | ---: | ---: | ---: | ---: |
| One pane decoration rebuild | 2.31366 | 2.38892 | 2.30887–2.52407 | −0.21% to +9.09% |
| Two pane decoration rebuilds | 4.84974 | 4.65877 | 4.57687–4.88745 | −5.63% to +0.78% |
| Fresh document code context | 2.71964 | 2.72341 | 2.62708–2.76888 | −3.40% to +1.81% |
| Shared cached code context | 0.00004113 | 0.00004003 | 0.00003822–0.00004120 | −7.06% to +0.19% |
| Initial image inventory | 10.00228 | 10.16029 | 10.02868–10.41594 | +0.26% to +4.14% |
| 500 image selection updates | 95.39432 | 91.95238 | 90.34625–92.72000 | −5.29% to −2.80% |

Sample counts across baseline/current runs were 60–66 (one pane), 31–33 (two panes), 55–58 (fresh code context), 3,640,547–3,924,617 (cached context), 15 (image inventory), and 10 (selection updates). Relative margins of error ranged from 0.20% to 5.90%. Each individual comparison preserves mean/uncertainty/sample counts and available percentiles, including p99. Tinybench does not supply p95 or individual sample arrays with its default `retainSamples: false`.

Vitest warned that cached code-context lookup and internal image-selection calls accessed module export getters frequently. The current tool records measurements through Vitest's module runner; especially the very short cached lookup includes harness/export-access/timer overhead. Its displayed duration is not an independent estimate of a production cache lookup. No warning was suppressed and no production module was changed to alter these observations.

The unchanged candidate exhibits variation, including a +9.09% one-pane observation and lower image-selection means on repeat runs. These results validate the workflow and illustrate noise/warmup sensitivity; they do not establish an application speedup or regression. No native typing, focus or frame latency conclusion follows from this Node-only experiment.

The nine Node support tests passed, including compatible contracts, refused runtime/fixture/engine/machine changes, allowed source/dependency changes, malformed statistics, missing/duplicate workloads, traversal/symlink refusal, existing output refusal, failed/partial runs and atomic completion. Real capture/comparison artifacts each contain six unique passed workload paths plus the JSON reporter. Portable reporter paths replace the workspace root with `<repo>`. Complete manifests publish only after validation; incomplete evidence cannot be reused.

Local raw evidence is intentionally ignored under `.scratch/package-capabilities/evidence/benchmarks/`: `capture-01` and `compare-01` through `compare-03`. Commands and baseline refresh policy are documented in [benchmark comparisons](../development/benchmark-comparisons.md). Preserve selected conclusions in Git; capture fresh local evidence if these ignored files are unavailable or the measurement contract changes.
