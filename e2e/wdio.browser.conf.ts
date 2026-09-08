import type { Capabilities, Options } from '@wdio/types';
import { startVite, stopVite } from './support/viteServer';

type TestrunnerConfig = Options.Testrunner & Capabilities.WithRequestedTestrunnerCapabilities;

const port = 1421;
const devServerUrl = `http://127.0.0.1:${port}`;

export const config: TestrunnerConfig = {
  runner: 'local',
  baseUrl: devServerUrl,
  specs: ['./specs/browser/**/*.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      // BiDi loses script contexts across startup navigation in the browser harness.
      'wdio:enforceWebDriverClassic': true,
      'wdio:tauriServiceOptions': {
        mode: 'browser',
        devServerUrl
      }
    }
  ] as unknown as TestrunnerConfig['capabilities'],
  services: ['tauri'],
  framework: 'mocha',
  reporters: ['spec'],
  logLevel: 'error',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
  async onPrepare() {
    await startVite('browser', port);
  },
  async onComplete() {
    await stopVite();
  }
};
