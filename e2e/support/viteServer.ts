import { resolve } from 'node:path';
import { createOwnedServerOwner } from './ownedServer.mjs';

let owner: ReturnType<typeof createOwnedServerOwner> | null = null;
function cancelServer() { void stopVite().catch(error => console.error('E2E Vite cleanup failed', error)); }

export async function startVite(mode: 'browser' | 'native' | 'native-preview', port: number) {
  if (owner) throw new Error('The E2E Vite server is already running.');
  const starting = createOwnedServerOwner();
  owner = starting;
  process.once('SIGINT', cancelServer);
  process.once('SIGTERM', cancelServer);
  try {
    const envName = mode === 'browser' ? 'VITE_E2E_BROWSER' : 'VITE_E2E_NATIVE';
    await starting.start({
      command: process.execPath,
      args: [resolve('node_modules/vite/bin/vite.js'), ...(mode === 'native-preview' ? ['preview'] : []), '--strictPort', '--host', '127.0.0.1', '--port', String(port)],
      port, env: { [envName]: 'true' },
      onOutput: (chunk: Buffer) => process.stdout.write(`[vite:e2e] ${chunk}`)
    });
  } catch (error) {
    if (owner === starting) {
      owner = null;
      process.removeListener('SIGINT', cancelServer);
      process.removeListener('SIGTERM', cancelServer);
    }
    throw error;
  }
}

export async function stopVite() {
  const stopping = owner;
  if (!stopping) return;
  try { await stopping.stop(); }
  finally {
    if (owner === stopping) {
      owner = null;
      process.removeListener('SIGINT', cancelServer);
      process.removeListener('SIGTERM', cancelServer);
    }
  }
}
