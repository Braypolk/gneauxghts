import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import type { Capabilities, Options } from '@wdio/types';
import { createNativeFixture } from './support/nativeFixture.mjs';
import { startVite, stopVite } from './support/viteServer';
import { nativeE2EBinary, nativeE2EPorts } from './support/nativeE2EBinary.mjs';
import { admitNativePresentation } from './support/nativePresentation.mjs';

type TestrunnerConfig = Options.Testrunner & Capabilities.WithRequestedTestrunnerCapabilities;

const ports = nativeE2EPorts();
const scaleRun = process.env.GNEAUXGHTS_RELEASE_SCALE_RUN;
const captureLogs = Boolean(scaleRun) || process.env.GNEAUXGHTS_E2E_LOGS === '1';
const optimized = Boolean(scaleRun) || process.env.GNEAUXGHTS_E2E_OPTIMIZED === '1';
const profile = optimized ? 'release' : 'debug';
const { binary: application } = nativeE2EBinary(profile);
if (scaleRun) {
  const marker = JSON.parse(readFileSync(join(scaleRun, 'run.json'), 'utf8'));
  if (marker.kind !== 'gneauxghts-editing-window-v3' || !basename(scaleRun).startsWith('gneauxghts-timeline-run-')) {
    throw new Error('Native scale tests require a disposable fixture clone');
  }
}
const ownedFixture = scaleRun ? null : createNativeFixture();
const fixtureRoot = scaleRun ?? ownedFixture!.root;
const appDataRoot = join(fixtureRoot, scaleRun ? 'data' : 'app-data');
const documentsRoot = join(fixtureRoot, 'documents');
const vaultRoot = scaleRun ? join(fixtureRoot, 'vault') : join(documentsRoot, 'vault');

for (const path of [appDataRoot, documentsRoot, vaultRoot]) mkdirSync(path, { recursive: true });

export const config: TestrunnerConfig = {
  runner: 'local',
  ...(scaleRun ? { outputDir: join(scaleRun, 'logs') } : {}),
  specs: ['./specs/native/**/*.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': { application }
    }
  ] as unknown as TestrunnerConfig['capabilities'],
  services: [[
    fileURLToPath(new URL('./support/nativeTauriService.mjs', import.meta.url)),
    {
      nativeHarness: {
        async prepare(resolvedConfig: TestrunnerConfig) {
          admitNativePresentation(resolvedConfig.specs ?? []);
          nativeE2EBinary(profile, application);
          await startVite(optimized ? 'native-preview' : 'native', ports.dev);
        },
        async cleanup() {
          try { await stopVite(); }
          finally {
            const receipt = join(fixtureRoot, 'restarted-app.pid');
            if (ownedFixture && existsSync(receipt)) {
              const pid = Number(readFileSync(receipt, 'utf8'));
              const command = execFileSync('ps', ['-axo', 'pid=,command='], {encoding: 'utf8'}).split('\n').find(line => Number(line.trim().split(/\s+/)[0]) === pid);
              if (command?.includes(basename(fixtureRoot)) && command.includes('--e2e-vault-root') && command.includes('gneauxghts')) {
                try { process.kill(pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
              }
            }
            ownedFixture?.cleanup();
          }
        }
      },
      driverProvider: 'embedded',
      captureBackendLogs: captureLogs,
      captureFrontendLogs: captureLogs,
      embeddedPort: ports.driver,
      appArgs: [
        '--e2e-app-data-root',
        appDataRoot,
        '--e2e-documents-root',
        documentsRoot,
        '--e2e-vault-root',
        vaultRoot
      ]
    }
  ]],
  framework: 'mocha',
  reporters: ['spec'],
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  mochaOpts: {
    ui: 'bdd', timeout: scaleRun ? 900_000 : 90_000,
    rootHooks: {
      async beforeAll() {
        const { browser } = await import('@wdio/globals');
        await browser.switchToWindow('main');
        await browser.waitUntil(async () => browser.execute(() =>
          typeof window.__TAURI_INTERNALS__?.invoke === 'function'), {
          timeout: 30_000, timeoutMsg: 'Native main webview did not publish its IPC bridge'
        });
      },
      async afterEach() {
        if (process.env.GNEAUXGHTS_E2E_FOREGROUND === '1') return;
        const { browser } = await import('@wdio/globals');
        const focused = await browser.execute(() => window.__TAURI_INTERNALS__!.invoke<boolean>(
          'plugin:window|is_focused', {label: 'main'}));
        assert.equal(focused, false, 'Background native test acquired OS window focus');
      }
    }
  },
  async afterTest(_test, _context, result) {
    if (!result.error) return;
    const { browser } = await import('@wdio/globals');
    console.error('NATIVE_FAILURE_CONTEXT', JSON.stringify(await browser.execute(() => ({
      url: location.href, title: document.title, text: document.body.innerText.slice(-1800),
      hasIpc: Boolean(window.__TAURI_INTERNALS__)
    }))));
  }
};
