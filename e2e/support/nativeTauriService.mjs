import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { finished } from 'node:stream/promises';
import { listenerPids } from './nativeTransport.mjs';

// The embedded plugin speaks W3C directly; no service-side execution/mocking
// overrides are needed. Keep all native lifetime ownership in the launcher.
export default class NativeWorkerService {}
export class launcher {
  constructor(options) { this.options = options; }

  async onPrepare(config, capabilities) {
    this.cancel = () => { void this.onComplete().catch(error => console.error(error)); };
    process.once('SIGINT', this.cancel);
    process.once('SIGTERM', this.cancel);
    this.preparing = this.prepare(config, capabilities);
    try { await this.preparing; }
    catch (cause) {
      try { await this.onComplete(); }
      catch (cleanupError) { cause = new AggregateError([cause, cleanupError], 'Native preparation and cleanup failed'); }
      const failure = new Error(`Native E2E preparation failed: ${cause.message}`, { cause });
      failure.name = 'SevereServiceError';
      throw failure;
    }
  }

  async prepare(config, capabilities) {
    const { nativeHarness, embeddedPort: port, appArgs = [] } = this.options;
    await nativeHarness.prepare(config, capabilities);
    if (this.stopping) throw new Error('Native launch cancelled during preparation');
    assert.equal(capabilities.length, 1, 'The native harness owns one app per invocation');
    const cap = capabilities[0];
    const application = cap['tauri:options']?.application;
    assert(application, 'A pinned native E2E application is required');
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    if (this.stopping) throw new Error('Native launch cancelled before spawn');
    this.child = spawn(application, appArgs, {
      env: { ...process.env, TAURI_WEBDRIVER_PORT: String(port), WDIO_EMBEDDED_SERVER: 'true' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    // WDIO may call process.exit from its own signal handler before asynchronous
    // onComplete handlers run. Never leave this invocation's app behind.
    this.emergencyStop = () => { if (!this.failure) this.child.kill('SIGKILL'); };
    process.once('exit', this.emergencyStop);
    this.exit = new Promise(resolve => {
      this.child.once('error', error => { this.failure = error; resolve(); });
      this.child.once('exit', (code, signal) => { this.failure = new Error(`Native app exited (${signal ?? code})`); resolve(); });
    });
    this.closed = new Promise(resolve => this.child.once('close', resolve));
    if (config.outputDir) {
      mkdirSync(config.outputDir, { recursive: true });
      this.log = createWriteStream(join(config.outputDir, 'native-app.log'), { flags: 'a' });
      this.log.on('error', error => {
        this.logFailure = error;
        void this.onComplete().catch(failure => console.error(failure));
      });
      // Observe errors immediately, including an asynchronous open failure.
      this.logClosed = finished(this.log).then(() => undefined, error => error);
    }
    for (const stream of [this.child.stdout, this.child.stderr]) stream.on('data', data => {
      if (this.log && !this.log.destroyed) this.log.write(data);
      if (this.options.captureBackendLogs) process.stdout.write(`[native] ${data}`);
    });
    const deadline = Date.now() + (this.options.startTimeout ?? 60_000);
    while (Date.now() < deadline) {
      if (this.stopping) throw new Error('Native launch cancelled during admission');
      if (this.failure) throw this.failure;
      if (this.logFailure) throw this.logFailure;
      // On macOS verify the listener belongs to this exact child, not a process
      // racing for the port between our reservation and the app's bind.
      const listeners = process.platform === 'darwin' ? listenerPids(port) : [this.child.pid];
      const owned = listeners.length === 1 && listeners[0] === this.child.pid;
      if (owned) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(500) });
          if (response.ok && (await response.json()).value?.ready && !this.failure && !this.stopping && !this.logFailure) {
            Object.assign(cap, { hostname: '127.0.0.1', port, path: '/', 'wdio:enforceWebDriverClassic': true });
            // The app is already running; the driver only needs a session.
            delete cap['tauri:options'];
            return;
          }
        } catch { /* The owned child may still be starting its server. */ }
      }
      await delay(100);
    }
    throw new Error(`Native WebDriver did not become ready on port ${port}`);
  }

  onComplete() {
    this.stopping = true;
    this.completion ??= (async () => {
      // Cancellation can arrive while preparation is still awaiting Vite.
      try { await this.preparing; } catch { /* Preserve the original admission error. */ }
      try {
        if (this.child && !this.failure) {
          this.child.kill('SIGTERM');
          let timer;
          try {
            await Promise.race([this.exit, new Promise(resolve => { timer = setTimeout(resolve, 3000); })]);
          } finally { clearTimeout(timer); }
          if (!this.failure) { this.child.kill('SIGKILL'); await this.exit; }
        }
        // A process restart inherits these pipes. Stop the fixture-owned
        // replacement before joining them, while keeping logs and data alive.
        await this.options.nativeHarness.stopRestartedApp?.();
        // 'exit' precedes the final stdout/stderr data and stream closure.
        await this.closed;
      } finally {
        try {
          try {
            if (this.log) {
              if (!this.log.destroyed) this.log.end();
              const error = await this.logClosed;
              if (error) throw error;
            }
          } finally { await this.options.nativeHarness.cleanup(); }
        } finally {
          if (this.cancel) {
            process.removeListener('SIGINT', this.cancel);
            process.removeListener('SIGTERM', this.cancel);
          }
          if (this.emergencyStop) process.removeListener('exit', this.emergencyStop);
        }
      }
    })().catch(cause => {
      const failure = new Error('Native E2E cleanup failed', { cause });
      failure.name = 'SevereServiceError';
      throw failure;
    });
    return this.completion;
  }
}
