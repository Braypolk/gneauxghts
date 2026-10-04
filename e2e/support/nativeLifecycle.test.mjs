import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { runNativeSpecs } from './nativeSuite.mjs';
import { createNativeFixture } from './nativeFixture.mjs';

test('suite cancellation stops after a graceful zero child exit and removes inherited descendants', { timeout: 5000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'gneauxghts-suite-cancel-'));
  const ready = join(root, 'started');
  const descendantPid = join(root, 'descendant-pid');
  const descendantReady = join(root, 'descendant-ready');
  const unix = process.platform !== 'win32';
  const descendantCode = `
    process.on('SIGTERM', () => {});
    require('fs').writeFileSync(${JSON.stringify(descendantReady)}, 'ready');
    setInterval(() => {}, 1000);
  `;
  const childCode = file => `
    process.on('SIGTERM', () => process.exit(0));
    if (${unix}) {
      const descendant = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendantCode)}], { stdio: 'ignore' });
      require('fs').writeFileSync(${JSON.stringify(descendantPid)}, String(descendant.pid));
    }
    require('fs').appendFileSync(${JSON.stringify(ready)}, ${JSON.stringify(file)});
    setInterval(() => {}, 1000);
  `;
  const running = runNativeSpecs(['first', 'second'], { args: file => ['-e', childCode(file)] });
  let cancelled = false;
  function alive(pid) {
    try { process.kill(pid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  }
  try {
    const deadline = Date.now() + 2000;
    while ((!existsSync(ready) || (unix && !existsSync(descendantReady))) && Date.now() < deadline) await delay(10);
    assert(existsSync(ready), 'Launcher installed signal handler before cancellation');
    if (unix) assert(existsSync(descendantReady), 'Descendant installed its TERM-ignoring handler');
    cancelled = true;
    process.emit('SIGTERM');
    assert.equal(await running, 143);
    assert.equal(readFileSync(ready, 'utf8'), 'first');
    if (unix) {
      const pid = Number(readFileSync(descendantPid, 'utf8'));
      const deadline = Date.now() + 1000;
      while (alive(pid) && Date.now() < deadline) await delay(10);
      assert.equal(alive(pid), false, 'Zero launcher exit must not orphan its TERM-ignoring descendant');
    }
  } finally {
    if (!cancelled) process.emit('SIGTERM');
    await running;
    // Preserve test isolation if this regression fails against an old runner.
    if (existsSync(descendantPid)) {
      const pid = Number(readFileSync(descendantPid, 'utf8'));
      try { process.kill(pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('WDIO worker reuses the launcher fixture and cannot remove it', () => {
  const fixture = createNativeFixture();
  try {
    const workerRoot = execFileSync(process.execPath, ['--input-type=module', '-e', `import {createNativeFixture} from ${JSON.stringify(new URL('./nativeFixture.mjs', import.meta.url).href)}; const fixture=createNativeFixture();fixture.cleanup();console.log(fixture.root);`], {
      encoding: 'utf8', env: { ...process.env, WDIO_WORKER_ID: '0-0' }
    }).trim();
    assert.equal(workerRoot, fixture.root);
    assert(existsSync(join(fixture.root, 'documents/vault')));
  } finally { fixture.cleanup(); }
  assert(!existsSync(fixture.root));
});

test('worker rejects an inherited fixture symlink without removing its target', () => {
  const fixture = createNativeFixture();
  const alias = `${fixture.root}-alias`;
  try {
    symlinkSync(fixture.root, alias);
    assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', `import {createNativeFixture} from ${JSON.stringify(new URL('./nativeFixture.mjs', import.meta.url).href)};createNativeFixture();`], {
      encoding: 'utf8', stdio: 'pipe', env: { ...process.env, WDIO_WORKER_ID: '0-0', GNEAUXGHTS_NATIVE_E2E_FIXTURE: alias }
    }), /canonical launcher directory/);
    assert(existsSync(join(fixture.root, 'documents/vault')));
  } finally { unlinkSync(alias); fixture.cleanup(); }
});
