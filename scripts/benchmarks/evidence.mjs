import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { workloads } from './workloads.mjs';

export function containedPath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Paths must be repository-relative');
  root = realpathSync(root);
  const target = path.resolve(root, relative);
  if (target === root || !target.startsWith(root + path.sep)) throw new Error('Path escapes repository');
  let cursor = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, part);
    // Refuse even inward symlinks: an evidence path must have one stable owner.
    let stat;
    try { stat = lstatSync(cursor); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat?.isSymbolicLink()) throw new Error('Symlinks are not allowed in evidence paths');
  }
  return target;
}

function packageInfo(require, name) {
  let directory = path.dirname(require.resolve(name));
  while (true) {
    const file = path.join(directory, 'package.json');
    if (existsSync(file)) {
      const json = JSON.parse(readFileSync(file, 'utf8'));
      if (json.name === name) return { version: json.version, directory };
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Cannot resolve ${name} version`);
    directory = parent;
  }
}

export function metadata(root, label) {
  if (typeof label !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(label)) throw new Error('Provide --label using 1–64 letters, numbers, dots, underscores or hyphens (no personal information)');
  const require = createRequire(path.join(root, 'package.json'));
  const vitest = packageInfo(require, 'vitest');
  const tinybench = packageInfo(createRequire(path.join(vitest.directory, 'package.json')), 'tinybench');
  const editor = Object.fromEntries(['@codemirror/commands', '@codemirror/lang-markdown', '@codemirror/language', '@codemirror/search', '@codemirror/state', '@codemirror/view', '@lezer/common', '@lezer/highlight'].map(name => [name, packageInfo(require, name).version]));
  const markdown = packageInfo(createRequire(path.join(packageInfo(require, '@codemirror/lang-markdown').directory, 'package.json')), '@lezer/markdown');
  editor['@lezer/markdown'] = markdown.version;
  const cpus = os.cpus();
  return {
    schemaVersion: 1,
    family: 'node-microbenchmark',
    capturedAt: new Date().toISOString(),
    source: {
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
    },
    engine: { node: process.versions.node, v8: process.versions.v8, vitest: vitest.version, tinybench: tinybench.version },
    execution: { pool: 'threads', isolate: true, fileParallelism: false, retainSamples: false, provider: 'vitest-default', timer: 'performance.now' },
    machine: { label, platform: os.platform(), architecture: os.arch(), release: os.release(), cpu: cpus[0]?.model ?? 'unknown', logicalCpus: cpus.length },
    dependencies: editor,
    lockfileSha256: createHash('sha256').update(readFileSync(path.join(root, 'pnpm-lock.yaml'))).digest('hex'),
    workloads,
  };
}

const requiredStats = ['mean', 'min', 'max', 'sd', 'moe', 'rme', 'p50', 'p75', 'p99', 'p995', 'p999', 'samplesCount'];
export function validateStatistics(result) {
  for (const name of ['latency', 'throughput']) {
    const stats = result?.[name];
    if (!stats || requiredStats.some(key => typeof stats[key] !== 'number' || !Number.isFinite(stats[key]) || stats[key] < 0)
      || !Number.isInteger(stats.samplesCount) || stats.samplesCount <= 0 || stats.mean <= 0
      || stats.min > stats.max) throw new Error(`Invalid ${name} statistics`);
    for (const value of Object.values(stats)) {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Nonfinite ${name} statistic`);
    }
    if (stats.samples !== undefined && (!Array.isArray(stats.samples) || stats.samples.length !== stats.samplesCount || stats.samples.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0))) throw new Error(`Invalid ${name} samples`);
  }
  if (!Number.isFinite(result.period) || result.period <= 0 || !Number.isFinite(result.totalTime) || result.totalTime <= 0) throw new Error('Invalid benchmark duration');
  return result;
}

export function assertCompatible(baseline, current) {
  if (baseline?.schemaVersion !== 1 || baseline.complete !== true || baseline.family !== 'node-microbenchmark') throw new Error('Baseline is incomplete or uses an unsupported schema/measurement family');
  if (!Number.isFinite(Date.parse(baseline.capturedAt)) || typeof baseline.source?.head !== 'string' || typeof baseline.source?.dirty !== 'boolean') throw new Error('Invalid baseline provenance');
  for (const key of ['schemaVersion', 'family', 'engine', 'execution', 'machine', 'workloads']) {
    if (!isDeepStrictEqual(baseline[key], current[key])) throw new Error(`Incompatible baseline ${key}; capture a fresh baseline`);
  }
  if (!baseline.dependencies || typeof baseline.lockfileSha256 !== 'string') throw new Error('Missing baseline dependency provenance');
  const ids = baseline.results?.map(result => result.id);
  if (!ids || new Set(ids).size !== workloads.length || ids.length !== workloads.length || workloads.some(workload => !ids.includes(workload.id))) throw new Error('Baseline must contain exactly six unique workloads');
  for (const result of baseline.results) if (result.passed !== true || typeof result.path !== 'string') throw new Error('Missing passed workload result');
  if (new Set(baseline.results.map(result => result.path)).size !== workloads.length || baseline.reporter !== 'reporter.json') throw new Error('Missing or duplicate result/reporter paths');
}

export function validateReporter(reporter) {
  if (reporter?.success !== true || reporter.numPassedTests !== workloads.length || reporter.numTotalTests !== workloads.length || reporter.numFailedTests !== 0 || reporter.numPendingTests !== 0) throw new Error('Reporter does not contain all six passed workloads; evidence remains incomplete');
}

export function loadEvidence(root, directory, current) {
  const absolute = containedPath(root, directory);
  const manifest = JSON.parse(readFileSync(containedPath(root, path.join(directory, 'manifest.json')), 'utf8'));
  assertCompatible(manifest, current);
  validateReporter(JSON.parse(readFileSync(containedPath(root, path.join(directory, manifest.reporter)), 'utf8')));
  const artifacts = new Map();
  for (const result of manifest.results) {
    if (path.isAbsolute(result.path) || result.path.includes('..')) throw new Error('Invalid baseline result path');
    const file = containedPath(root, path.join(directory, result.path));
    if (!file.startsWith(absolute + path.sep)) throw new Error('Result escapes baseline directory');
    artifacts.set(result.id, validateStatistics(JSON.parse(readFileSync(file, 'utf8'))));
  }
  return { manifest, artifacts };
}

export function summarize(baseline, current, oldResults, newResults) {
  const rows = workloads.map(({ id }) => {
    const before = oldResults.get(id), after = newResults.get(id);
    return { id, baseline: before.latency, current: after.latency, deltaPercent: (after.latency.mean / before.latency.mean - 1) * 100 };
  });
  const provenance = { baselineCapturedAt: baseline.capturedAt, baselineAgeHours: Math.max(0, (Date.parse(current.capturedAt) - Date.parse(baseline.capturedAt)) / 3_600_000), baselineSource: baseline.source, currentSource: current.source, baselineDependencies: baseline.dependencies, currentDependencies: current.dependencies, baselineLockfileSha256: baseline.lockfileSha256, currentLockfileSha256: current.lockfileSha256 };
  const markdown = `# Saved baseline compared with current measurements\n\nThe baseline is historical data; its code was not rerun. Positive latency deltas mean slower. Node microbenchmarks do not measure native input or frame latency.\n\nBaseline captured ${baseline.capturedAt} (${provenance.baselineAgeHours.toFixed(2)} hours old). Source ${baseline.source.head}, dirty: ${baseline.source.dirty}. Current source ${current.source.head}, dirty: ${current.source.dirty}.\n\n| Workload | Baseline mean ms (RME %, n) | Current mean ms (RME %, n) | Delta % | Baseline / current p99 ms |\n| --- | ---: | ---: | ---: | ---: |\n${rows.map(row => `| ${row.id} | ${row.baseline.mean.toPrecision(5)} (${row.baseline.rme.toFixed(2)}, ${row.baseline.samplesCount}) | ${row.current.mean.toPrecision(5)} (${row.current.rme.toFixed(2)}, ${row.current.samplesCount}) | ${row.deltaPercent.toFixed(2)} | ${row.baseline.p99.toPrecision(5)} / ${row.current.p99.toPrecision(5)} |`).join('\n')}\n\nTinybench does not supply p95. Full uncertainty, available percentiles and sample data are retained in comparison.json and the raw artifacts. Repeated differences are an investigation trigger, with no automatic speed gate.\n\nDependency/source provenance (differences are allowed):\n\n\`\`\`json\n${JSON.stringify(provenance, null, 2)}\n\`\`\`\n`;
  return { json: { schemaVersion: 1, family: current.family, ...provenance, rows }, markdown };
}
