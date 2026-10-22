import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertCompatible, containedPath, loadEvidence, summarize, validateStatistics } from '../benchmarks/evidence.mjs';
import { executeRun, parseArguments } from '../benchmarks/run.mjs';
import { workloads } from '../benchmarks/workloads.mjs';

const stats = () => ({ mean: 2, min: 1, max: 3, sd: 1, moe: 0.1, rme: 5, p50: 2, p75: 3, p99: 3, p995: 3, p999: 3, samplesCount: 2, samples: [1, 3] });
const result = () => ({ latency: stats(), throughput: stats(), period: 2, totalTime: 100 });
const current = () => ({ schemaVersion: 1, family: 'node-microbenchmark', capturedAt: '2026-10-21T10:00:00.000Z', source: { head: 'abc', dirty: true }, engine: { node: '24', v8: '1', vitest: '5', tinybench: '6' }, machine: { label: 'fixture', platform: 'darwin', architecture: 'arm64', release: '25', cpu: 'fixture', logicalCpus: 8 }, dependencies: { '@codemirror/view': '6' }, lockfileSha256: 'fixture', workloads });
const baseline = () => ({ ...current(), complete: true, reporter: 'reporter.json', results: workloads.map(({ id }) => ({ id, path: `${id}.json`, passed: true })) });
function workspace(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gneauxghts-bench-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function saveBaseline(root, manifest = baseline()) {
  mkdirSync(path.join(root, 'baseline'));
  writeFileSync(path.join(root, 'baseline/manifest.json'), JSON.stringify(manifest));
  writeFileSync(path.join(root, 'baseline/reporter.json'), JSON.stringify({ success: true, numPassedTests: 6, numTotalTests: 6, numFailedTests: 0, numPendingTests: 0 }));
  for (const { id } of workloads) writeFileSync(path.join(root, `baseline/${id}.json`), JSON.stringify(result()));
}

test('compatible contract permits candidate source/dependency changes and discloses deltas', () => {
  const before = baseline(), after = current();
  after.source.head = 'def';
  after.dependencies['@codemirror/view'] = '7';
  after.lockfileSha256 = 'changed';
  assert.doesNotThrow(() => assertCompatible(before, after));
  const raw = new Map(workloads.map(({ id }) => [id, result()]));
  const report = summarize(before, after, raw, raw);
  assert.equal(report.json.rows.length, 6);
  assert.equal(report.json.rows[0].deltaPercent, 0);
  assert.match(report.markdown, /historical data/);
  assert.match(report.markdown, /changed/);
});

test('runtime, fixture, options, engine and machine changes refuse comparison', () => {
  for (const mutate of [
    value => { value.engine.node = '25'; }, value => { value.engine.v8 = '2'; },
    value => { value.engine.vitest = '6'; }, value => { value.engine.tinybench = '7'; },
    value => { value.machine.label = 'other'; }, value => { value.machine.cpu = 'other'; },
    value => { value.machine.release = '26'; }, value => { value.machine.logicalCpus = 16; },
    value => { value.workloads[0].fixture.sha256 = 'changed'; },
    value => { value.workloads[0].runOptions.time++; },
    value => { value.workloads[0].workloadVersion++; },
    value => { value.family = 'native'; }, value => { value.schemaVersion++; },
  ]) {
    const changed = structuredClone(baseline());
    mutate(changed);
    assert.throws(() => assertCompatible(changed, current()), /[Ii]ncompatible|unsupported/);
  }
});

test('partial, missing, duplicate and failed workload manifests are unusable', () => {
  for (const mutate of [
    value => { value.complete = false; }, value => { value.results.pop(); },
    value => { value.results[1] = value.results[0]; }, value => { value.results[0].passed = false; },
    value => { delete value.results; }, value => { value.capturedAt = 'bad'; },
    value => { value.results[1].path = value.results[0].path; },
  ]) {
    const changed = structuredClone(baseline()); mutate(changed);
    assert.throws(() => assertCompatible(changed, current()));
  }
});

test('statistics require finite numbers, positive integer samples and durations', () => {
  assert.doesNotThrow(() => validateStatistics(result()));
  for (const mutate of [
    value => { value.latency.mean = NaN; }, value => { value.latency.mean = null; },
    value => { value.throughput.rme = Infinity; }, value => { delete value.latency.p99; },
    value => { value.latency.samplesCount = 0; }, value => { value.latency.samplesCount = 1.5; },
    value => { value.latency.samples = [1, NaN]; }, value => { value.totalTime = -1; },
    value => { value.latency.samplesCount = 5; },
  ]) {
    const changed = result(); mutate(changed);
    assert.throws(() => validateStatistics(changed));
  }
});

test('paths reject traversal, absolute paths, root and symlinks', t => {
  const root = workspace(t);
  mkdirSync(path.join(root, 'inside'));
  symlinkSync(os.tmpdir(), path.join(root, 'outside-link'));
  symlinkSync(path.join(root, 'inside'), path.join(root, 'inside-link'));
  symlinkSync(path.join(root, 'not-created'), path.join(root, 'dangling-link'));
  for (const relative of ['../out', '/tmp/out', '.', 'inside/../../out', 'outside-link/out', 'inside-link/out', 'dangling-link/out']) assert.throws(() => containedPath(root, relative));
  assert.equal(containedPath(root, 'inside/new/results'), path.join(root, 'inside/new/results'));
});

test('preflight checks all six baseline artifact payloads and paths before running', async t => {
  const root = workspace(t); saveBaseline(root);
  assert.equal(loadEvidence(root, 'baseline', current()).artifacts.size, 6);
  writeFileSync(path.join(root, `baseline/${workloads[0].id}.json`), '{}');
  let ran = false;
  await assert.rejects(executeRun(root, { mode: 'compare', baseline: 'baseline', out: 'new', label: 'fixture' }, { describe: current, run: async () => { ran = true; } }));
  assert.equal(ran, false);
  assert.equal(existsSync(path.join(root, 'new')), false);
});

test('existing output and failed/interrupted children cannot overwrite or publish a baseline', async t => {
  const root = workspace(t);
  mkdirSync(path.join(root, 'existing'));
  await assert.rejects(executeRun(root, { mode: 'capture', out: 'existing' }, { describe: current }), /already exists/);
  await assert.rejects(executeRun(root, { mode: 'capture', out: 'failed' }, { describe: current, run: async () => { throw new Error('child failed'); } }), /child failed/);
  assert.equal(existsSync(path.join(root, 'failed/manifest.json')), false);
  assert.equal(JSON.parse(readFileSync(path.join(root, 'failed/incomplete.json'))).complete, false);
});

test('missing reporter results refuse publication; complete runs atomically publish portable evidence', async t => {
  const root = workspace(t);
  const finish = async (_root, config, reporter) => {
    const { paths } = JSON.parse(readFileSync(config, 'utf8'));
    for (const file of Object.values(paths)) writeFileSync(path.join(root, file), JSON.stringify(result()));
    writeFileSync(reporter, JSON.stringify({ success: true, numPassedTests: 6, numTotalTests: 6, numFailedTests: 0, numPendingTests: 0, file: path.join(root, 'test.ts') }));
  };
  await assert.rejects(executeRun(root, { mode: 'capture', out: 'partial' }, { describe: current, run: async (_root, _config, reporter) => { writeFileSync(reporter, JSON.stringify({ success: true, numPassedTests: 5 })); } }), /six passed/);
  assert.equal(existsSync(path.join(root, 'partial/manifest.json')), false);
  await executeRun(root, { mode: 'capture', out: 'complete' }, { describe: current, run: finish });
  assert.equal(loadEvidence(root, 'complete', current()).manifest.complete, true);
  assert.equal(readFileSync(path.join(root, 'complete/reporter.json'), 'utf8').includes(root), false);
  assert.equal(existsSync(path.join(root, 'complete/incomplete.json')), false);
});

test('CLI requires explicit fresh output, label and compare baseline', () => {
  assert.deepEqual(parseArguments(['capture', '--out', 'new', '--label', 'fixture']), { mode: 'capture', out: 'new', label: 'fixture' });
  for (const args of [[], ['capture'], ['compare', '--out', 'new', '--label', 'fixture'], ['capture', '--out', 'a', '--out', 'b', '--label', 'fixture'], ['capture', '--force', 'yes']]) assert.throws(() => parseArguments(args));
});
