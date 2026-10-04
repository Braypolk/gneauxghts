import type { Capabilities, Options } from '@wdio/types';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startVite, stopVite } from './support/viteServer';

type TestrunnerConfig = Options.Testrunner & Capabilities.WithRequestedTestrunnerCapabilities;

const port = Number(process.env.GNEAUXGHTS_E2E_BROWSER_PORT ?? 1421);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid browser E2E port');
const devServerUrl = `http://127.0.0.1:${port}`;

export const config: TestrunnerConfig = {
  runner: 'local',
  baseUrl: devServerUrl,
  specs: ['./specs/browser/**/*.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      // Keep routine runs off the desktop; opt in to a visible browser for debugging.
      'goog:chromeOptions': {
        args: [
          '--window-size=1440,1000',
          ...(process.env.GNEAUXGHTS_E2E_HEADED === '1' ? [] : ['--headless=new'])
        ]
      },
      // BiDi loses script contexts across startup navigation in the browser harness.
      'wdio:enforceWebDriverClassic': true,
      'wdio:tauriServiceOptions': {
        mode: 'browser',
        devServerUrl
      }
    }
  ] as unknown as TestrunnerConfig['capabilities'],
  services: [['tauri', {
    mode: 'browser', devServerUrl,
    devServer: async () => {
      await startVite('browser', port);
      return { url: devServerUrl, close: stopVite };
    }
  }]],
  framework: 'mocha',
  reporters: ['spec'],
  logLevel: 'error',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
  async afterTest(_test, _context, result) {
    if (!result.error) return;
    const { browser } = await import('@wdio/globals');
    const output = await mkdtemp(join(tmpdir(), 'gneauxghts-browser-failure-'));
    await browser.saveScreenshot(join(output, 'screen.png'));
    console.error('BROWSER_FAILURE_SCREENSHOT', join(output, 'screen.png'));
    console.error('BROWSER_FAILURE_CONTEXT', JSON.stringify(await browser.execute(() => ({
      text: document.body.innerText.slice(-1800),
      invocations: window.__GNEAUXGHTS_E2E__?.invocations.slice(-20).map(({ command, args }) => ({ command, argumentKeys: Object.keys(args) }))
    }))));
  },
  async onComplete() {
    await stopVite();
  }
};
