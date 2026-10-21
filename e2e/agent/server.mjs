import { fileURLToPath } from 'node:url';
import { createOwnedServerOwner } from '../support/ownedServer.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const port = Number(process.env.GNEAUXGHTS_AGENT_PORT ?? 1423);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('GNEAUXGHTS_AGENT_PORT must be an integer from 1024 to 65535');
}
export const baseUrl = `http://127.0.0.1:${port}`;

// Share the native/browser harness's nonce admission and process-group cleanup.
// A caller owns this lifetime, including cancellation while Vite is starting.
export function createFixtureServer() {
  const owner = createOwnedServerOwner();
  return {
    start: () => owner.start({
      command: process.execPath,
      args: [fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url)),
        '--strictPort', '--host', '127.0.0.1', '--port', String(port)],
      cwd: root,
      port,
      env: { VITE_E2E_BROWSER: 'true' },
      onOutput: chunk => process.stdout.write(`[vite:agent] ${chunk}`)
    }),
    stop: () => owner.stop()
  };
}
