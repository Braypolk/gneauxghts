import TauriWorkerService, { launcher as TauriLauncher } from '@wdio/tauri-service';

// A path-based service retains both WDIO lifecycle halves. Separate launcher
// services cannot order startup: WDIO runs their onPrepare hooks concurrently.
export default TauriWorkerService;
export class launcher extends TauriLauncher {
  constructor({ nativeHarness, ...options }, capabilities, config) {
    super(options, capabilities, config);
    this.nativeHarness = nativeHarness;
  }

  async onPrepare(config, capabilities) {
    try {
      await this.nativeHarness.prepare();
      await super.onPrepare(config, capabilities);
    } catch (cause) {
      let failureCause = cause;
      try { await this.onComplete(1, config, capabilities); }
      catch (cleanupError) {
        failureCause = new AggregateError([cause, cleanupError], 'Native preparation and cleanup failed');
      }
      const failure = new Error('Native E2E preparation failed', { cause: failureCause });
      failure.name = 'SevereServiceError';
      throw failure;
    }
  }

  onComplete(exitCode, config, capabilities) {
    this.completion ??= (async () => {
      try {
        try { await super.onComplete(exitCode, config, capabilities); }
        finally { await this.nativeHarness.cleanup(); }
      } catch (cause) {
        const failure = new Error('Native E2E cleanup failed', { cause });
        failure.name = 'SevereServiceError';
        throw failure;
      }
    })();
    return this.completion;
  }
}
