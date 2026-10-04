import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const inheritedRoot = 'GNEAUXGHTS_NATIVE_E2E_FIXTURE';

/** WDIO workers reload the config; only the launcher allocates/removes its fixture. */
export function createNativeFixture() {
  const worker = Boolean(process.env.WDIO_WORKER_ID);
  const root = worker ? process.env[inheritedRoot] : mkdtempSync(join(tmpdir(), 'gneauxghts-native-e2e-'));
  if (!root || dirname(root) !== tmpdir() || !basename(root).startsWith('gneauxghts-native-e2e-')) {
    throw new Error('Native E2E worker requires its launcher-owned disposable fixture');
  }
  // An inherited path must already exist; workers must never create a substitute.
  if (worker && realpathSync(root) !== join(realpathSync(tmpdir()), basename(root))) {
    throw new Error('Native E2E worker fixture must be the canonical launcher directory');
  }
  if (!worker) {
    for (const path of ['app-data', 'documents', 'documents/vault']) mkdirSync(join(root, path), { recursive: true });
    process.env[inheritedRoot] = root;
  }
  return {
    root,
    cleanup() {
      if (worker) return;
      rmSync(root, { recursive: true, force: true });
      if (process.env[inheritedRoot] === root) delete process.env[inheritedRoot];
    }
  };
}
