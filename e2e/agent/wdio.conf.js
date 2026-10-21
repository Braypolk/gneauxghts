import { mkdir } from 'node:fs/promises';
import { baseUrl, createFixtureServer } from './server.mjs';

const server = createFixtureServer();
export const config = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.js'],
  maxInstances: 1,
  baseUrl,
  logLevel: 'warn',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { timeout: 60_000 },
  capabilities: [{
    browserName: 'chrome',
    'goog:chromeOptions': { args: ['--headless=new', '--window-size=1440,1000', '--disable-dev-shm-usage'] }
  }],
  // `session open ./wdio.conf.js` reads capabilities/baseUrl, but does not run
  // these hooks. Interactive use starts agent:serve; replay owns its own server.
  onPrepare: async () => { await server.start(); },
  onComplete: async () => { await server.stop(); },
  afterTest: async function (_test, _context, { passed }) {
    if (!passed) {
      await mkdir('.wdio/failures', { recursive: true });
      await browser.saveScreenshot(`.wdio/failures/${Date.now()}.png`);
    }
  }
};
