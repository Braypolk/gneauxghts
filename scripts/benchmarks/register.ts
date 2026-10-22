import { readFileSync } from 'node:fs';
import type { TestContext } from 'vitest';
import { runOptions } from './workloads.mjs';

interface RunConfiguration {
  paths: Record<string, string>;
  baselinePaths?: Record<string, string>;
}

// The runner preflights this configuration before Vitest starts. Ordinary bench
// runs never read or write evidence.
const config: RunConfiguration | undefined = process.env.GNEAUXGHTS_BENCH_RUN
  ? JSON.parse(readFileSync(process.env.GNEAUXGHTS_BENCH_RUN, 'utf8')) : undefined;

export async function measure(bench: TestContext['bench'], id: string, fn: () => void) {
  if (!config) {
    await bench(id, fn).run(runOptions);
    return;
  }
  const path = config.paths[id];
  if (!path) throw new Error(`Missing artifact path for ${id}`);
  const current = bench('current', { writeResult: path }, fn);
  if (config.baselinePaths) {
    await bench.compare(bench.from('saved baseline (historical)', config.baselinePaths[id]), current, runOptions);
  } else {
    await current.run(runOptions);
  }
}
