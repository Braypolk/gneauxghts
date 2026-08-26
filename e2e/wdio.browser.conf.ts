import type { Options } from '@wdio/types';
import { startVite, stopVite } from './support/viteServer';

const port = 1421;
const devServerUrl = `http://127.0.0.1:${port}`;

export const config: Options.Testrunner = {
  runner: 'local',
  baseUrl: devServerUrl,
  specs: ['./specs/browser/**/*.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'wdio:tauriServiceOptions': {
        mode: 'browser',
        devServerUrl
      }
    }
  ] as unknown as Options.Testrunner['capabilities'],
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
