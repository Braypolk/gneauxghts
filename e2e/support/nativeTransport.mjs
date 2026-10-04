import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export function listenerPids(port) {
  try {
    return [...new Set(execFileSync('/usr/sbin/lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .trim().split(/\s+/).filter(Boolean).map(Number))];
  } catch (error) {
    if (error.status === 1 && !error.stdout?.length) return [];
    throw error;
  }
}

// Callbacks receive a deadline signal so a stalled request cannot outlive the wait.
export async function waitUntil(check, description, timeoutMs = 30_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const timer = new AbortController();
    try {
      const value = await Promise.race([
        check(AbortSignal.timeout(remaining)),
        delay(remaining, undefined, { signal: timer.signal }).then(() => { throw new Error('check exceeded deadline'); })
      ]);
      if (value) return value;
    } catch (error) { last = error; }
    finally { timer.abort(); }
    await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Timed out waiting for ${description}: ${last ?? ''}`);
}

export function createWebDriverRequest(port, timeoutMs = 25_000) {
  return async (path, body, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const result = await response.json();
    if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result));
    return result.value;
  };
}
