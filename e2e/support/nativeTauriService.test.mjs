import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { launcher as NativeLauncher } from './nativeTauriService.mjs';
import { admitNativePresentation } from './nativePresentation.mjs';

async function freePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
const fakeApp = `require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:{ready:true}}));}).listen(Number(process.env.TAURI_WEBDRIVER_PORT),'127.0.0.1');`;
function options(port, nativeHarness, app = fakeApp) {
  return { embeddedPort: port, appArgs: ['-e', app], nativeHarness, startTimeout: 5000 };
}
const capabilities = () => [{ browserName: 'tauri', 'tauri:options': { application: process.execPath } }];

test('resolved foreground spec is rejected before spawning an app', async () => {
  let cleaned = 0;
  const service = new NativeLauncher(options(await freePort(), {
    async prepare(config) { admitNativePresentation(config.specs, {}); },
    async cleanup() { cleaned++; }
  }));
  await assert.rejects(service.onPrepare({ specs: ['search-focus.spec.ts'] }, capabilities()),
    error => error.name === 'SevereServiceError' && /requires actual OS focus/.test(error.cause.message));
  assert.equal(service.child, undefined);
  assert.equal(cleaned, 1);
});

test('admission precedes launch and concurrent cleanup joins the owned app before fixture cleanup', async () => {
  const port = await freePort();
  let admit;
  const admitted = new Promise(resolve => { admit = resolve; });
  let cleaned = 0;
  const service = new NativeLauncher(options(port, {
    async prepare() { await admitted; },
    async cleanup() {
      await assert.rejects(fetch(`http://127.0.0.1:${port}/status`));
      cleaned++;
    }
  }));
  const caps = capabilities();
  const preparing = service.onPrepare({}, caps);
  try {
    assert.equal(service.child, undefined);
    admit(); await preparing;
    assert.equal(caps[0].port, port);
    assert.equal(caps[0]['wdio:enforceWebDriverClassic'], true);
    assert.equal(caps[0]['tauri:options'], undefined);
    assert.equal((await fetch(`http://127.0.0.1:${port}/status`)).status, 200);
  } finally { await Promise.all([service.onComplete(), service.onComplete()]); }
  assert.equal(cleaned, 1);
});

test('occupied driver port rejects without terminating its owner', async () => {
  const other = createServer();
  await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
  let cleaned = false;
  const service = new NativeLauncher(options(other.address().port, {
    async prepare() {}, async cleanup() { cleaned = true; }
  }));
  try {
    await assert.rejects(service.onPrepare({}, capabilities()), /EADDRINUSE/);
    assert.equal(service.child, undefined);
    assert.equal(other.listening, true);
    assert.equal(cleaned, true);
  } finally { await new Promise(resolve => other.close(resolve)); }
});

test('an app that exits before readiness is fatal and cleans the fixture exactly once', async () => {
  let cleaned = 0;
  const service = new NativeLauncher(options(await freePort(), {
    async prepare() {}, async cleanup() { cleaned++; }
  }, 'process.exit(7)'));
  await assert.rejects(service.onPrepare({}, capabilities()), /Native app exited \(7\)/);
  await service.onComplete();
  assert.equal(cleaned, 1);
});

test('cancellation during preparation cannot launch a late app', async () => {
  let admit;
  const admitted = new Promise(resolve => { admit = resolve; });
  let cleaned = 0;
  const service = new NativeLauncher(options(await freePort(), {
    async prepare() { await admitted; }, async cleanup() { cleaned++; }
  }));
  const preparing = service.onPrepare({}, capabilities());
  const stopping = service.onComplete();
  admit();
  await assert.rejects(preparing, /cancelled/);
  await stopping;
  assert.equal(service.child, undefined);
  assert.equal(cleaned, 1);
});

test('fixture cleanup failures remain fatal', async () => {
  const cause = new Error('fixture teardown rejected');
  const service = new NativeLauncher({ nativeHarness: { async cleanup() { throw cause; } } });
  await assert.rejects(service.onComplete(), error => error.name === 'SevereServiceError' && error.cause === cause);
});

test('a logfile open failure still joins the app and cleans its fixture', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'native-log-failure-'));
  mkdirSync(join(outputDir, 'native-app.log'));
  let cleaned = 0;
  const service = new NativeLauncher(options(await freePort(), {
    async prepare() {}, async cleanup() {
      assert(service.child.exitCode !== null || service.child.signalCode !== null);
      cleaned++;
    }
  }));
  try {
    await assert.rejects(service.onPrepare({ outputDir }, capabilities()), { name: 'SevereServiceError' });
    assert.equal(service.logFailure.code, 'EISDIR');
    assert.equal(cleaned, 1);
  } finally { rmSync(outputDir, { recursive: true, force: true }); }
});

test('final backend output is flushed before fixture cleanup', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'native-log-flush-'));
  const tail = 'final native evidence\n';
  const app = `${fakeApp} process.on('SIGTERM', () => process.stdout.write('x'.repeat(262144) + ${JSON.stringify(tail)}, () => process.exit(0)));`;
  const service = new NativeLauncher(options(await freePort(), {
    async prepare() {}, async cleanup() {
      assert.equal(readFileSync(join(outputDir, 'native-app.log'), 'utf8'), 'x'.repeat(262144) + tail);
    }
  }, app));
  try {
    await service.onPrepare({ outputDir }, capabilities());
    await service.onComplete();
  } finally { rmSync(outputDir, { recursive: true, force: true }); }
});

test('a restarted app releases inherited output before log and fixture cleanup', { timeout: 10_000 }, async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'native-restart-flush-'));
  const receipt = join(outputDir, 'restart.pid');
  const tail = 'restarted app stopped\n';
  const replacement = `process.on('SIGTERM', () => process.stdout.write(${JSON.stringify(tail)}, () => process.exit(0))); setInterval(() => {}, 1000); console.log('replacement ready');`;
  const app = `${fakeApp} process.on('SIGUSR1', () => {
    const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(replacement)}], { stdio: ['ignore', process.stdout, process.stderr] });
    require('node:fs').writeFileSync(${JSON.stringify(receipt)}, String(child.pid));
    child.unref(); process.exit(0);
  });`;
  let stopped = 0, cleaned = 0;
  const service = new NativeLauncher(options(await freePort(), {
    async prepare() {},
    async stopRestartedApp() {
      stopped++;
      process.kill(Number(readFileSync(receipt, 'utf8')), 'SIGTERM');
    },
    async cleanup() {
      assert(readFileSync(join(outputDir, 'native-app.log'), 'utf8').endsWith(tail));
      cleaned++;
    }
  }, app));
  try {
    await service.onPrepare({ outputDir }, capabilities());
    service.child.kill('SIGUSR1');
    await service.exit;
    const deadline = Date.now() + 2000;
    while (!readFileSync(join(outputDir, 'native-app.log'), 'utf8').includes('replacement ready')) {
      assert(Date.now() < deadline, 'Replacement did not become ready');
      await delay(20);
    }
    let timer;
    try {
      await Promise.race([service.onComplete(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Cleanup waited on inherited pipes before stopping the restarted app')), 2000);
      })]);
    } finally { clearTimeout(timer); }
    assert.equal(stopped, 1);
    assert.equal(cleaned, 1);
  } finally {
    try { process.kill(Number(readFileSync(receipt, 'utf8')), 'SIGTERM'); } catch { /* Already stopped. */ }
    await service.onComplete();
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('a runner that exits in its own signal handler leaves neither app nor dev server', { timeout: 10_000 }, async () => {
  const appPort = await freePort(), devPort = await freePort();
  const script = `
    import { launcher } from ${JSON.stringify(new URL('./nativeTauriService.mjs', import.meta.url).href)};
    import { startOwnedServer } from ${JSON.stringify(new URL('./ownedServer.mjs', import.meta.url).href)};
    process.once('SIGINT', () => process.exit(0));
    let dev;
    const service = new launcher({ embeddedPort: ${appPort}, appArgs: ['-e', ${JSON.stringify(fakeApp)}], nativeHarness: {
      async prepare() {
        dev = await startOwnedServer({ command: process.execPath, args: ['-e',
          "require('http').createServer((req,res)=>res.end(process.env.GNEAUXGHTS_E2E_SERVER_TOKEN)).listen(${devPort},'127.0.0.1')"], port: ${devPort} });
      },
      async cleanup() { await dev.stop(); }
    }});
    await service.onPrepare({}, [{browserName:'tauri', 'tauri:options':{application:process.execPath}}]);
    console.log('ready');
  `;
  const runner = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => runner.once('close', resolve));
  try {
    await new Promise((resolve, reject) => {
      runner.once('error', reject);
      runner.once('exit', () => reject(new Error('Runner exited before readiness')));
      runner.stdout.on('data', data => { if (String(data).includes('ready')) resolve(); });
    });
    runner.kill('SIGINT');
    await closed;
    for (const port of [appPort, devPort]) {
      const deadline = Date.now() + 2000;
      while (true) {
        try { await fetch(`http://127.0.0.1:${port}/status`); }
        catch { break; }
        assert(Date.now() < deadline, `Runner orphaned the listener on ${port}`);
        await delay(25);
      }
    }
  } finally { runner.kill('SIGTERM'); await closed; }
});
