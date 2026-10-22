import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server;
export const config = {
  runner: 'local',
  baseUrl: 'http://127.0.0.1:1447',
  specs: [fileURLToPath(new URL('./render-errors.e2e.js', import.meta.url))],
  maxInstances: 1,
  capabilities: [{
    browserName: 'chrome',
    'goog:chromeOptions': { args: ['--headless=new', '--window-size=1440,1000'] }
  }],
  framework: 'mocha', reporters: ['spec'], logLevel: 'error',
  mochaOpts: { timeout: 60_000 },
  onPrepare: async () => {
    server = await createServer({ configFile: fileURLToPath(new URL('./vite.config.js', import.meta.url)) });
    await server.listen();
  },
  onComplete: async () => { await server?.close(); }
};
