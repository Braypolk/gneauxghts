import { spawn, type ChildProcess } from 'node:child_process';

let viteProcess: ChildProcess | null = null;

async function waitForUrl(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function startVite(mode: 'browser' | 'native', port: number) {
  if (viteProcess) throw new Error('The E2E Vite server is already running.');
  const envName = mode === 'browser' ? 'VITE_E2E_BROWSER' : 'VITE_E2E_NATIVE';
  viteProcess = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, [envName]: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  viteProcess.stdout?.on('data', (chunk) => process.stdout.write(`[vite:e2e] ${chunk}`));
  viteProcess.stderr?.on('data', (chunk) => process.stderr.write(`[vite:e2e] ${chunk}`));
  await waitForUrl(`http://127.0.0.1:${port}`);
}

export async function stopVite() {
  const processToStop = viteProcess;
  viteProcess = null;
  if (!processToStop || processToStop.killed) return;
  processToStop.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => processToStop.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (!processToStop.killed) processToStop.kill('SIGKILL');
}