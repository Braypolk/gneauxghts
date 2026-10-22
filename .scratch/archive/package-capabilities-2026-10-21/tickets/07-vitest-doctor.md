# Measure Vitest worker configuration

Archived execution ticket, 2026-10-21. The original plan and chronological comments below are historical, outside the executable backlog. See the [implementation outcome and verification limits](../../package-capabilities-2026-10-21.md#integration-result).


Historical record: implementation complete; combined acceptance is tracked in the outcome record.
Type: task
Priority: optional, after the benchmark workflow
Depends on: 02 (shared tooling/configuration integration)

## Scope

Use installed Vitest 5's `doctor` command to determine whether this repository benefits from another worker count or pool. This is a bounded measurement task; a supported outcome is retaining the current configuration. Filesystem module caching is already enabled. [CLI documentation](https://vitest.dev/guide/cli#vitest-doctor).

## Implementation plan

1. Pin the checkout/lockfile and record Node, OS, CPU, memory, fixture versions and baseline `vite.config.js` (`threads`, per-file isolation). Run a complete unit baseline, separating elapsed time from support tests and build/check time.
2. Run `pnpm exec vitest doctor` once with no concurrent builds, benchmarks or browser/native work. Retain a compact result report with cold/warm cache distinctions. Inspect installed help before optional flags; bound the overall experiment to twenty minutes using parent-controlled process termination and report incomplete output honestly. Do not invent flags or delete another process's cache. The doctor may locally probe disabled isolation; this is exploratory evidence, not the selected production configuration.
3. Repeat a promising worker-count candidate and baseline in alternating order, at least three runs of each, retaining per-file isolation. Installed 5.0.5 prunes some already-satisfied experiments for the current threads/Node/default-cache setup; do not promise a pool recommendation. Any proposal to disable isolation is a separate decision requiring demonstrated absence of shared module/mock leakage; the doctor's suggestion is not authorization to change test semantics.
4. Change `vite.config.js` only if repeated comparable runs show a useful improvement with the same test set, skips and correctness. Otherwise record the no-change conclusion. Do not add a second browser harness or disable assertions to shorten runs.

## Acceptance and ownership

- Record comparable suite counts, elapsed time and variation; no universal hardware-dependent time gate.
- A selected config passes the full unit suite normally and with a recorded shuffled order; report any difference from existing skips. Check types/build only if configuration changes affect them.
- Existing curated-language resolver, benchmark output and caching behavior remain valid.
- Own only a measurement report and, if justified, `vite.config.js`. Coordinate configuration edits with 02/03; measurements run serially with 02/05 and integration performance checks.

## Comments

Completed the bounded experiment in an exclusive CPU window; see `docs/research/vitest-doctor-2026-10-21.md`. Normal and shuffled (`20261021`) isolated suites each passed all 164 files, with 1,416 passing tests, one unchanged skip and zero failures. Input hashes stayed fixed across the experiment.

Doctor measured the current isolated threads setup at 5.91 s versus five isolated workers at 7.73 s (+31%); disabling isolation failed. It recommended keeping the current configuration. No promising candidate required alternating verification, and no config changes were made. The twenty-minute controller bound was not reached; all owned processes exited normally and the quiet slot was released. Raw ignored evidence includes full unit JSON, doctor output, exact hashes and process elapsed times.
