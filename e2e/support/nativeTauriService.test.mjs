import assert from 'node:assert/strict';
import { test } from 'node:test';
import TauriWorkerService, { launcher as TauriLauncher } from '@wdio/tauri-service';
import WorkerService, { launcher as NativeLauncher } from './nativeTauriService.mjs';

test('native service retains the worker and awaits server admission before app launch', async t => {
  const events = [];
  let admit;
  const admitted = new Promise(resolve => { admit = resolve; });
  t.mock.method(TauriLauncher.prototype, 'onPrepare', async () => { events.push('launch'); });
  t.mock.method(TauriLauncher.prototype, 'onComplete', async () => { events.push('stop-app'); });
  const service = new NativeLauncher({ nativeHarness: {
    async prepare() { events.push('admission'); await admitted; },
    async cleanup() { events.push('stop-server-and-fixture'); }
  } }, [], {});
  assert.equal(WorkerService, TauriWorkerService);
  const preparing = service.onPrepare({}, []);
  assert.deepEqual(events, ['admission']);
  admit();
  await preparing;
  assert.deepEqual(events, ['admission', 'launch']);
  await Promise.all([service.onComplete(0, {}, []), service.onComplete(0, {}, [])]);
  assert.deepEqual(events, ['admission', 'launch', 'stop-app', 'stop-server-and-fixture']);
});

for (const failingStage of ['admission', 'launch']) {
  test(`${failingStage} failure is fatal and joins app/server/fixture cleanup exactly once`, async t => {
    const events = [];
    const cause = new Error(`${failingStage} rejected`);
    t.mock.method(TauriLauncher.prototype, 'onPrepare', async () => { events.push('launch'); throw cause; });
    t.mock.method(TauriLauncher.prototype, 'onComplete', async () => { events.push('stop-app'); });
    const service = new NativeLauncher({ nativeHarness: {
      async prepare() { events.push('admission'); if (failingStage === 'admission') throw cause; },
      async cleanup() { events.push('stop-server-and-fixture'); }
    } }, [], {});
    await assert.rejects(service.onPrepare({}, []), error => error.name === 'SevereServiceError' && error.cause === cause);
    await service.onComplete(1, {}, []);
    assert.deepEqual(events, ['admission', ...(failingStage === 'launch' ? ['launch'] : []), 'stop-app', 'stop-server-and-fixture']);
  });
}

test('failed app teardown still cleans server/fixture and remains fatal', async t => {
  const events = [];
  const cause = new Error('app teardown rejected');
  t.mock.method(TauriLauncher.prototype, 'onComplete', async () => { events.push('stop-app'); throw cause; });
  const service = new NativeLauncher({ nativeHarness: {
    async prepare() {},
    async cleanup() { events.push('stop-server-and-fixture'); }
  } }, [], {});
  await assert.rejects(service.onComplete(1, {}, []), error => error.name === 'SevereServiceError' && error.cause === cause);
  assert.deepEqual(events, ['stop-app', 'stop-server-and-fixture']);
});
