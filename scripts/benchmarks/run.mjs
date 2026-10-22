import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCompatible, containedPath, loadEvidence, metadata, summarize, validateReporter, validateStatistics } from './evidence.mjs';
import { workloads } from './workloads.mjs';

export function parseArguments(args) {
  const [mode, ...rest] = args;
  const options = { mode };
  if (!['capture', 'compare'].includes(mode)) throw new Error('Expected capture or compare');
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    if (!['--out', '--label', '--baseline'].includes(key) || !rest[index + 1] || Object.hasOwn(options, key.slice(2))) throw new Error(`Invalid argument ${key}`);
    options[key.slice(2)] = rest[index + 1];
  }
  if (!options.out || !options.label || (mode === 'compare' && !options.baseline) || (mode === 'capture' && options.baseline)) throw new Error('Usage: capture --out <new-repo-relative-dir> --label <machine> | compare --baseline <repo-relative-dir> --out <new-repo-relative-dir> --label <machine>');
  return options;
}

function runVitest(root, configFile, reporterFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'bench', '--run', '--no-file-parallelism', '--reporter=default', '--reporter=json', `--outputFile.json=${reporterFile}`], { cwd: root, env: { ...process.env, GNEAUXGHTS_BENCH_RUN: configFile }, stdio: 'inherit' });
    const interrupt = signal => child.kill(signal);
    const onInterrupt = () => interrupt('SIGINT');
    const onTerminate = () => interrupt('SIGTERM');
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
      if (code === 0) resolve();
      else reject(new Error(`Vitest benchmark failed (${signal ?? code}); evidence remains incomplete`));
    });
  });
}

// Exported to exercise failure/incomplete publication with a deterministic child
// substitute, without timing a fake workload or changing the production engine.
export async function executeRun(root, options, { run = runVitest, describe = metadata } = {}) {
  const out = containedPath(root, options.out);
  if (existsSync(out)) throw new Error('Output directory already exists; choose a new path');
  const current = describe(root, options.label);
  const baseline = options.mode === 'compare' ? loadEvidence(root, options.baseline, current) : undefined;
  mkdirSync(path.dirname(out), { recursive: true });
  containedPath(root, options.out);
  // Reserve the final directory exclusively, including against simultaneous
  // invocations choosing the same output name.
  mkdirSync(out);
  const paths = Object.fromEntries(workloads.map(({ id }) => [id, path.join(options.out, `${id}.json`)]));
  const baselinePaths = baseline && Object.fromEntries(baseline.manifest.results.map(({ id, path: file }) => [id, path.join(options.baseline, file)]));
  writeFileSync(path.join(out, 'incomplete.json'), JSON.stringify({ ...current, complete: false }, null, 2) + '\n');
  const configFile = path.join(out, 'run.json');
  writeFileSync(configFile, JSON.stringify({ paths, baselinePaths }, null, 2) + '\n');
  const reporterFile = path.join(out, 'reporter.json');
  await run(root, configFile, reporterFile);
  const reporter = JSON.parse(readFileSync(reporterFile, 'utf8'));
  validateReporter(reporter);
  // Vitest includes absolute file paths; portable evidence uses a neutral root.
  writeFileSync(reporterFile, JSON.stringify(reporter, null, 2).replaceAll(root, '<repo>') + '\n');
  const artifacts = new Map(workloads.map(({ id }) => [id, validateStatistics(JSON.parse(readFileSync(containedPath(root, paths[id]), 'utf8')))]));
  const manifest = { ...current, complete: true, reporter: 'reporter.json', results: workloads.map(({ id }) => ({ id, passed: true, path: `${id}.json` })) };
  assertCompatible(manifest, current);
  if (baseline) {
    const comparison = summarize(baseline.manifest, current, baseline.artifacts, artifacts);
    writeFileSync(path.join(out, 'comparison.json'), JSON.stringify(comparison.json, null, 2) + '\n');
    writeFileSync(path.join(out, 'comparison.md'), comparison.markdown);
    process.stdout.write(comparison.markdown);
  }
  writeFileSync(path.join(out, 'manifest.pending.json'), JSON.stringify(manifest, null, 2) + '\n');
  renameSync(path.join(out, 'manifest.pending.json'), path.join(out, 'manifest.json'));
  rmSync(path.join(out, 'incomplete.json'));
  process.stdout.write(`\nComplete benchmark evidence: ${options.out}/manifest.json\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  try {
    await executeRun(root, parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Benchmark run failed');
    process.exitCode = 1;
  }
}
