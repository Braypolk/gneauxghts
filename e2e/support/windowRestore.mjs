// Run with the native Vite server on 127.0.0.1:1430 and an unlocked macOS display.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeE2EBinary } from './nativeE2EBinary.mjs';

if (process.platform !== 'darwin') throw new Error('Window visibility probe requires macOS');
const { binary } = nativeE2EBinary('debug');
const response = await fetch('http://127.0.0.1:1430', { signal: AbortSignal.timeout(3000) });
if (!response.ok) throw new Error('Native Vite server is unavailable');
const root = mkdtempSync(join(tmpdir(), 'gneauxghts-window-restore-'));
try {
  const result = spawnSync('swift', [
    '-module-cache-path', join(root, 'swift-cache'),
    'e2e/support/windowRestore.swift', binary, root
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
