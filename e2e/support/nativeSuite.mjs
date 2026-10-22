import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { foregroundNativeSpecs, requireNativeForeground } from './nativePresentation.mjs';

// Keep deterministic UI contracts separate from provider and measurement opt-ins.
export const nativeSuites = {
  smoke: ['app-lifecycle', 'command-events', 'image-interactions', 'asset-protocol', 'image-loading', 'piChatNative', 'piConnectionErrors', 'piChatPublication', 'piChatEditing', 'piChatCreation', 'piChatCompaction', 'piChatAdapters'],
  foreground: [...foregroundNativeSpecs],
  measurement: ['editing-windows'],
  live: ['piChatLocal', 'piChatLocalTools'],
  hosted: ['piChatHosted'],
  subscription: ['piChatSubscription']
};

export async function runNativeSpecs(files, {
  command = process.execPath,
  args = file => [resolve('node_modules/@wdio/cli/bin/wdio.js'), 'run', 'e2e/wdio.native.conf.ts', '--spec', file],
  env = process.env
} = {}) {
  let cancelled;
  let child;
  let killTimer;
  // Unix gives each launcher a group whose inherited workers/native app remain
  // ours even if the launcher exits first. Windows retains PID-only behavior.
  const ownsProcessGroup = process.platform !== 'win32';
  const killRemainingGroup = () => {
    if (!ownsProcessGroup || !child?.pid) return;
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const forward = signal => {
    cancelled ??= signal;
    child?.kill(signal);
    killTimer ??= setTimeout(() => {
      if (ownsProcessGroup) killRemainingGroup();
      else child?.kill('SIGKILL');
    }, 10_000);
  };
  const term = () => forward('SIGTERM'), interrupt = () => forward('SIGINT');
  process.once('SIGTERM', term); process.once('SIGINT', interrupt);
  try {
    for (const file of files) {
      if (cancelled) break;
      child = spawn(command, args(file), { stdio: 'inherit', env, detached: ownsProcessGroup });
      let code;
      try {
        code = await new Promise((ok, fail) => {
          child.once('error', fail);
          child.once('exit', (code, signal) => ok(code ?? (signal ? 1 : 0)));
        });
      } finally {
        clearTimeout(killTimer);
        killTimer = undefined;
        // onComplete normally stops these. Reap survivors even after a zero
        // launcher exit; clearing the cancellation timer must not orphan them.
        killRemainingGroup();
        child = undefined;
      }
      if (cancelled) break;
      if (code) return code;
    }
    return cancelled === 'SIGINT' ? 130 : cancelled ? 143 : 0;
  } finally {
    clearTimeout(killTimer);
    process.off('SIGTERM', term); process.off('SIGINT', interrupt);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lane = process.argv[2] ?? 'smoke';
  if (!Object.hasOwn(nativeSuites, lane)) throw new Error(`Unknown native test lane: ${lane}`);
  if (!process.argv.includes('--list') && ['foreground', 'measurement'].includes(lane)) requireNativeForeground(`Native ${lane} lane`);
  const files = nativeSuites[lane].map(name => `e2e/specs/native/${name}.spec.ts`);
  if (process.argv.includes('--list')) console.log(files.join('\n'));
  else process.exitCode = await runNativeSpecs(files, {
    env: { ...process.env, ...(lane === 'measurement' ? { GNEAUXGHTS_E2E_SUSTAINED_MEASUREMENT: '1' } : {}) }
  });
}
