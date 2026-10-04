import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export const identityPath = '/__gneauxghts_e2e_identity';

async function requireFreePort(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
}

/** Own only the child/process group created here. A response must echo its nonce. */
export async function startOwnedServer({ command, args, port, env = {}, cwd = process.cwd(), timeoutMs = 30_000, onOutput, abortSignal = /** @type {AbortSignal | undefined} */ (undefined) }) {
  abortSignal?.throwIfAborted();
  await requireFreePort(port);
  abortSignal?.throwIfAborted();
  const token = randomUUID();
  const child = spawn(command, args, {
    cwd, env: { ...process.env, ...env, GNEAUXGHTS_E2E_SERVER_TOKEN: token },
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']
  });
  let failure;
  let exited = false;
  let stopPromise;
  let resolveExit;
  const exit = new Promise((resolve) => { resolveExit = resolve; });
  child.once('error', (error) => { failure = error; exited = true; resolveExit(); });
  child.once('exit', (code, signal) => {
    failure = new Error(`Owned server exited (${signal ?? code}) before readiness`);
    exited = true;
    resolveExit();
  });
  child.stdout?.on('data', (data) => onOutput?.(data));
  child.stderr?.on('data', (data) => onOutput?.(data));
  function signal(name) {
    if (!child.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, name);
      else if (!exited) child.kill(name);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  function stop() {
    stopPromise ??= stopOwned();
    return stopPromise;
  }
  async function stopOwned() {
    abortSignal?.removeEventListener('abort', onAbort);
    signal('SIGTERM');
    const timer = new AbortController();
    await Promise.race([exit, delay(2_000, undefined, { signal: timer.signal }).catch(() => {})]);
    timer.abort();
    // The launcher may have exited while its children still own the port.
    signal('SIGKILL');
    const killedTimer = new AbortController();
    try {
      await Promise.race([exit, delay(2_000, undefined, { signal: killedTimer.signal }).then(() => {
        throw new Error('Owned server failed to exit after SIGKILL');
      })]);
    } finally { killedTimer.abort(); }
  }
  function onAbort() { void stop(); }
  abortSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    abortSignal?.throwIfAborted();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      abortSignal?.throwIfAborted();
      if (failure) throw failure;
      try {
        const response = await fetch(`http://127.0.0.1:${port}${identityPath}`, {
          signal: AbortSignal.timeout(Math.max(1, Math.min(500, deadline - Date.now())))
        });
        const identity = await response.text();
        if (response.ok && identity === token && !failure) {
          abortSignal?.throwIfAborted();
          return { stop, pid: child.pid };
        }
      } catch { /* Admission remains pending until this owned server responds. */ }
      abortSignal?.throwIfAborted();
      if (failure) throw failure;
      await delay(Math.min(50, Math.max(0, deadline - Date.now())));
    }
    throw new Error(`Timed out admitting owned server on port ${port}`);
  } catch (error) {
    await stop();
    throw error;
  }
}

/** A lifetime includes admission: stop never abandons a child still starting. */
export function createOwnedServerOwner() {
  const lifetime = new AbortController();
  let admission;
  let stopping;
  return {
    start(options) {
      if (admission || lifetime.signal.aborted) throw new Error('Owned server lifetime already started or stopped');
      admission = startOwnedServer({ ...options, abortSignal: lifetime.signal });
      return admission;
    },
    stop() {
      lifetime.abort();
      stopping ??= (async () => {
        let server;
        try { server = await admission; }
        catch (error) {
          if (error !== lifetime.signal.reason) throw error;
        }
        await server?.stop();
      })();
      return stopping;
    }
  };
}
