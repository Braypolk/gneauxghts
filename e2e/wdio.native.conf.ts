import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Options } from '@wdio/types';
import { startVite, stopVite } from './support/viteServer';

const binaryName = process.platform === 'win32' ? 'gneauxghts.exe' : 'gneauxghts';
const application = resolve('src-tauri', 'target', 'debug', binaryName);
const fixtureRoot = mkdtempSync(join(tmpdir(), 'gneauxghts-native-e2e-'));
const appDataRoot = join(fixtureRoot, 'app-data');
const documentsRoot = join(fixtureRoot, 'documents');
const vaultRoot = join(documentsRoot, 'vault');

for (const path of [appDataRoot, documentsRoot, vaultRoot]) mkdirSync(path, { recursive: true });

function cleanupFixture() {
  if (
    dirname(fixtureRoot) !== tmpdir() ||
    !basename(fixtureRoot).startsWith('gneauxghts-native-e2e-')
  ) {
    throw new Error(`Refusing to remove unexpected E2E fixture path: ${fixtureRoot}`);
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
}

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./specs/native/**/*.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': { application }
    }
  ] as unknown as Options.Testrunner['capabilities'],
  services: [[
    'tauri',
    {
      driverProvider: 'embedded',
      embeddedPort: 4445,
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
  mochaOpts: { ui: 'bdd', timeout: 90_000 },
  async onPrepare() {
    if (!existsSync(application)) {
      throw new Error(`Native E2E binary is missing: ${application}`);
    }
    await startVite('native', 1420);
  },
  async onComplete() {
    await stopVite();
    cleanupFixture();
  }
};
