import { mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Capabilities, Options } from '@wdio/types';
import { startVite, stopVite } from './support/viteServer';
import { nativeE2EBinary, nativeE2EPorts } from './support/nativeE2EBinary.mjs';

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
const fixtureRoot = scaleRun ?? mkdtempSync(join(tmpdir(), 'gneauxghts-native-e2e-'));
const appDataRoot = join(fixtureRoot, scaleRun ? 'data' : 'app-data');
const documentsRoot = join(fixtureRoot, 'documents');
const vaultRoot = scaleRun ? join(fixtureRoot, 'vault') : join(documentsRoot, 'vault');

for (const path of [appDataRoot, documentsRoot, vaultRoot]) mkdirSync(path, { recursive: true });

function cleanupFixture() {
  if (scaleRun) return; // The fixture runner owns this disposable directory.
  if (
    dirname(fixtureRoot) !== tmpdir() ||
    !basename(fixtureRoot).startsWith('gneauxghts-native-e2e-')
  ) {
    throw new Error(`Refusing to remove unexpected E2E fixture path: ${fixtureRoot}`);
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
}

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
    'tauri',
    {
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
  mochaOpts: { ui: 'bdd', timeout: scaleRun ? 900_000 : 90_000 },
  async onPrepare() {
    nativeE2EBinary(profile, application);
    await startVite(optimized ? 'native-preview' : 'native', ports.dev);
  },
  async onComplete() {
    await stopVite();
    cleanupFixture();
  }
};
