# Vitest 5 doctor measurement

Outcome: retain the current `threads` configuration with per-file isolation and default worker count. The measured smaller worker pool was slower, and disabling isolation broke tests. No configuration change was made.

## Starting configuration

The repository uses Vitest 5.0.5 with `pool: 'threads'`, `environment: 'node'`, `include: ['src/**/*.test.ts']` and per-file isolation enabled by default. Filesystem module caching is already enabled by Vitest's default. The curated CodeMirror language-data resolver remains active. Support tests, browser/native tests, typechecking and builds are separate from the unit suite and its elapsed time.

Preparation host: Apple M4 Pro, 12 reported logical CPUs / available parallelism 12, 24 GiB RAM, ARM64, macOS 26.6.2 (25G83), Darwin 25.6.0. Node v24.2.0, V8 13.6.233.10-node.17. Git HEAD during preparation: `84fea1a4cda5f04c8056c87ec567b3e0f4c59a71`, with concurrent capability/image work in the dirty checkout. Exact source/configuration/lockfile hashes will be captured again at the start of the exclusive window rather than treating HEAD as the whole candidate.

Preparation SHA-256: `vite.config.js` = `c8386f56fa266c64ad477882a4c8df733dfaa478fe71325da5ad98cb680fb5a9`; `pnpm-lock.yaml` = `87173fd65dbc73506aef9fbba026053ef94727588cb659cd2eddbff46ae026aa`. These identify preparation only; source edits are still being integrated.

## Installed doctor behavior and experiment rules

Checked `pnpm exec vitest doctor --help` and the installed `vitest/dist/chunks/doctor.BK86Cncq.js`, against the [official CLI documentation](https://vitest.dev/guide/cli#vitest-doctor). Help exposes the common CLI options, including `--maxWorkers`, `--isolate`, `--pool` and `--sequence`; there is no separate doctor-duration flag. We impose a parent-controlled twenty-minute process bound instead.

The installed doctor prunes threads, VM pools and filesystem-cache alternatives for this repository: it already uses threads, its Node environment has no VM setup benefit, and filesystem caching is enabled. Its remaining configuration experiment disables isolation temporarily. That experiment is discovery only: production isolation will remain enabled regardless of a speed recommendation. The doctor also probes worker counts by halving the resolved worker count. If it chooses a shared-state candidate first, those worker probes inherit that candidate; they do not establish an isolated worker-count improvement.

Doctor uses its first baseline to warm caches, then takes the minimum of repeated baselines and each candidate. It validates any successful shared-state candidate with two shuffled file-order runs. Minimum timings alone will not justify a repository configuration change. A promising isolated worker count must then pass at least three alternating baseline/candidate runs with equivalent suite/skip counts and a shuffled verification run. If performance gain does not clearly exceed observed variation, retain the current configuration.

No cache directories will be deleted. The preparation and prior unit checks mean subsequent measurements must be described as existing/warm cache, not a pristine cold start. Tests/builds/benchmarks/browser or native performance runs must not overlap the exclusive measurement window.

## Results

Ran in the integrating task's exclusive CPU window on October 21, 2026 (UTC 2026-10-22 00:06:37–00:07:48). Benchmark, browser/native performance and other agent test/build processes were idle. A controller owned each detached process group, imposed a twenty-minute overall bound, and checked source/configuration/fixture/lockfile hashes after each command. All processes finished normally; the bound never fired. Existing caches were retained, so these are warm/existing-cache measurements.

The source snapshot covered `src/`, `src-tauri/test-fixtures/`, `vite.config.js`, `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml`. Its digest stayed `442ea31101067ca05dbc1e3e6bd531cc9f669a7764bcae646116884f830ffccb` throughout all three commands. HEAD and the configuration/lock hashes stayed as recorded above; `package.json` was `d0833827d92ee34de884293490f2ad29bc40f59d2b3a2ca23384d8e775d650e5`. This identifies the integrated dirty checkout rather than claiming that HEAD alone contains the tested work.

| Run | Correctness | Elapsed |
| --- | --- | --- |
| Complete unit baseline, JSON reporter | 164 files passed; 1,416 tests passed, 1 skipped, zero failures | 6.556 s process wall time |
| `pnpm exec vitest doctor` | Completed; recommendation: keep current configuration | 47.112 s total process wall time |
| Complete isolated unit suite with file shuffle, seed `20261021` | Same 164 files, 1,416 passes and one skip, zero failures | 7.187 s process wall time |

The single skip in both complete runs is the pre-existing `measures pure decoration rebuilds` case in `markdownPerformance.test.ts`. JSON's 363 suite nodes include describe groups; the actual file count is 164. Support tests and build/check time are excluded.

Doctor's internal results were:

| Configuration | Doctor-reported result |
| --- | --- |
| Current threads, per-file isolation | 5.91 s minimum of three runs |
| `isolate: false` | Failed |
| Isolated threads with `maxWorkers: 5` | 7.73 s minimum of three runs, 31% slower |

The non-isolated run exposed shared-state/mock interference; the retained excerpt shows a wikilink IPC test reaching real Tauri invocation and failing with `window is not defined`. It is incompatible with the current suite and supplies no basis for changing isolation. Because that candidate failed, the worker probe used the isolated baseline. Five workers also regressed, so doctor stopped its descending search and recommended the existing configuration.

No promising isolated worker candidate remained, so no alternating six-run candidate experiment or configuration edit was warranted. Doctor reports minima rather than individual timings, which limits claims about variation; the separately shuffled baseline changes execution order and is a correctness check, not an identical-order timing repeat. There is no claimed speedup or universal timing threshold.

Reproduction commands:

```sh
pnpm exec vitest run --reporter=json --outputFile=<evidence>/baseline.json
pnpm exec vitest doctor
pnpm exec vitest run --sequence.shuffle.files --sequence.seed=20261021 --reporter=json --outputFile=<evidence>/shuffle-20261021.json
```

Raw ignored evidence and the bounded controller are in `.scratch/package-capabilities/evidence/vitest-doctor/`: `experiment.json` contains all input-file hashes and process timings; the baseline/shuffle JSON files contain individual test outcomes; `doctor.log` contains the complete doctor output. Configuration and curated-language resolver are unchanged.
