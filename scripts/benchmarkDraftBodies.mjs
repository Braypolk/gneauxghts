import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { nativeE2EBinary } from '../e2e/support/nativeE2EBinary.mjs';
import { requireNativeForeground } from '../e2e/support/nativePresentation.mjs';

// An isolated checkout preserves all caller changes. Both variants use exactly
// the same installed dependencies, native executable, harness and spec.
requireNativeForeground('Draft body application benchmark');
const root = process.cwd();
const output = resolve(process.env.DRAFT_BODY_BENCHMARK_DIR ?? '.scratch/archive/draft-body-app-benchmark/evidence');
const baseline = 'fd9c0ad1a7672157d3dbd665a039ec49a1e525c7';
const variants = (process.env.DRAFT_BODY_RUNS ?? 'before-1,after-1,after-2,before-2').split(',');
if (variants.some(variant => !/^(before|after)-[12]$/.test(variant))) throw new Error('Unexpected benchmark variant');
const shared = ['src/lib/e2e/draftBodyLatencyHarness.ts', 'e2e/specs/native/draft-body-latency.spec.ts'];
mkdirSync(output, { recursive: true });
const native = nativeE2EBinary('debug');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (hash(execFileSync('git', ['show', `${baseline}:pnpm-lock.yaml`])) !== hash(readFileSync('pnpm-lock.yaml'))) throw new Error('Baseline and current dependencies differ');
const changed = new Set(execFileSync('git', ['diff', baseline, '--name-only', '--', 'src'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean));
changed.add('src/lib/features/notepad/document/documentBody.ts');
writeFileSync(join(output, 'provenance.json'), JSON.stringify({ baseline, nativeSha256: native.sha256,
  dependenciesSha256: hash(readFileSync(join(root, 'pnpm-lock.yaml'))),
  currentSources: Object.fromEntries([...changed].map(path => [path, hash(readFileSync(join(root, path)))])),
  harness: Object.fromEntries(shared.map(path => [path, hash(readFileSync(join(root, path)))])),
  order: variants }, null, 2));
let child;
let cancelled = false;
const stop = () => { cancelled = true; if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
async function run(command, args, cwd, env, log) {
  if (cancelled) throw new Error('Benchmark cancelled');
  const stream = createWriteStream(log);
  child = spawn(command, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(stream); child.stderr.pipe(stream);
  let code;
  try {
    code = await new Promise((ok, fail) => { child.once('error', fail); child.once('exit', ok); });
  } finally {
    // The native suite runner owns worker/app/Vite cleanup, including failure.
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    child = null; await new Promise(resolve => stream.end(resolve));
  }
  if (code !== 0) throw new Error(`Benchmark exited ${code}; see ${log}`);
}
const checkout = mkdtempSync(join(tmpdir(), 'gneauxghts-draft-baseline-'));
const archive = join(checkout, 'source.tar');
try {
  writeFileSync(archive, execFileSync('git', ['archive', baseline], { cwd: root, maxBuffer: 100 * 1024 * 1024 }));
  execFileSync('tar', ['-xf', archive, '-C', checkout]); rmSync(archive);
  symlinkSync(join(root, 'node_modules'), join(checkout, 'node_modules'));
  for (const path of shared) copyFileSync(join(root, path), join(checkout, path));
  const configPath = join(checkout, 'e2e/wdio.native.conf.ts');
  const config = readFileSync(configPath, 'utf8');
  if (!config.includes('nativeE2EBinary(profile);')) throw new Error('Native config binary seam changed');
  writeFileSync(configPath, config.replace('nativeE2EBinary(profile);', `nativeE2EBinary(profile, ${JSON.stringify(native.binary)});`));
  await run(process.execPath, [join(root, 'node_modules/@sveltejs/kit/svelte-kit.js'), 'sync'], checkout, {}, join(output, 'baseline-sync.log'));
  for (const variant of variants) {
    console.log(`Starting ${variant}; native app takes foreground focus. Evidence: ${output}`);
    const cwd = variant.startsWith('before') ? checkout : root;
    // runNativeSpecs reaps the complete process group, even after interruption.
    const runner = `import {runNativeSpecs} from './e2e/support/nativeSuite.mjs'; process.exitCode=await runNativeSpecs(['e2e/specs/native/draft-body-latency.spec.ts'], {args: file=>[${JSON.stringify(join(root, 'node_modules/@wdio/cli/bin/wdio.js'))},'run','e2e/wdio.native.conf.ts','--spec',file${process.env.DRAFT_BODY_GREP ? `,'--mochaOpts.grep',${JSON.stringify(process.env.DRAFT_BODY_GREP)}` : ''}]});`;
    await run(process.execPath, ['--input-type=module', '-e', runner], cwd, {
      GNEAUXGHTS_E2E_FOREGROUND: '1', DRAFT_BODY_VARIANT: variant,
      DRAFT_BODY_NATIVE_OUTPUT: join(output, `${variant}.json`)
    }, join(output, `${variant}.log`));
    console.log(`Completed ${variant}`);
  }
} finally {
  process.off('SIGTERM', stop); process.off('SIGINT', stop);
  rmSync(checkout, { recursive: true, force: true });
}
