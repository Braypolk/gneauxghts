import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the callback actually sent to WebDriver. Only renderer/runtime
// dependencies are controlled; the observer's scheduling and cleanup stay real.
function install(renderer) {
  const source = readFileSync(new URL('./piChatAcceptance.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('piChatAcceptance.ts', source, ts.ScriptTarget.Latest, true);
  const owner = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'observePi');
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'browser.execute') callback = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  assert(owner); visit(owner); assert(callback);
  const javascript = ts.transpileModule(`(${callback.getText(tree)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  return vm.runInNewContext(javascript, renderer.globals)();
}

const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function renderer() {
  let mutation, commit, reads = 0, nativeStops = 0, watchStops = 0, watchCalls = 0;
  const queued = [], watches = new Map();
  const view = { docs: {}, entries: [] };
  const conversation = async id => ({ async watch() {
    watchCalls++;
    const watch = { value: view, start(callback) { watch.deliver = callback; }, async stop() { watchStops++; } };
    watches.set(id, watch); return watch;
  } });
  const harness = { conversation, subscribeCommits(callback) { commit = callback; return () => { commit = undefined; }; } };
  const host = {};
  const bridge = id => ({
    piNativeInvokeProbe: async () => ({ installPiNativeInvokeProbe: () => ({ stop() { nativeStops++; } }) }),
    piChat: async () => ({ harness }), piContext: async () => ({}),
    readPiChatState() {
      reads++;
      assert.equal(host.__GNEAUXGHTS_NATIVE_E2E__, this, 'Read a retired workspace bridge');
      return [{ conversationId: id }];
    }
  });
  host.__GNEAUXGHTS_NATIVE_E2E__ = bridge(1);
  const globals = {
    window: host, performance: { now: () => 10 }, queueMicrotask: callback => queued.push(callback),
    document: { body: {}, querySelector: () => null },
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} disconnect() { mutation = undefined; } }
  };
  return {
    globals, host, harness, watches, view,
    stats: () => host.__PI_CHAT_ACCEPTANCE__,
    counts: () => ({ reads, nativeStops, watchStops, watchCalls }),
    mutate: () => mutation?.(), commit: () => commit?.(),
    flush: () => { while (queued.length) queued.shift()(); },
    mount(id) { host.__GNEAUXGHTS_NATIVE_E2E__ = bridge(id); },
    unmount() { delete host.__GNEAUXGHTS_NATIVE_E2E__; }
  };
}

test('Pi observer skips unmounted workspaces and follows the replacement bridge', async () => {
  const page = renderer(); assert.equal(await install(page), null); await settle();
  assert.equal(page.stats().conversations[1].observations, 1);
  page.unmount();
  const reads = page.counts().reads;
  page.mutate(); page.commit(); page.flush();
  assert.equal(page.counts().reads, reads, 'Navigation must not read retired component state');
  page.mount(2); page.mutate(); await settle();
  assert.equal(page.stats().conversations[2].observations, 1, 'Replacement workspace must be observed');
  assert.equal(page.stats().observerErrors, 0);
  page.stats().stop();
});

test('stopping Pi observation retires queued attaches and late watch deliveries', async () => {
  const page = renderer(); await install(page); await settle();
  page.commit();
  const lateDelivery = page.watches.get(1).deliver;
  const before = page.counts();
  page.stats().stop(); page.stats().stop(); page.flush(); await lateDelivery(page.view);
  assert.equal(page.counts().reads, before.reads, 'Queued commits must not read after stop');
  assert.equal(page.stats().conversations[1].observations, 1, 'Stopped observations must stay frozen');
  assert.equal(page.counts().watchStops, 1); assert.equal(page.counts().nativeStops, 1);
});

test('Pi observation closes a watch that finishes opening after stop', async () => {
  const page = renderer(), opening = deferred();
  page.harness.conversation = async () => ({ watch: () => opening.promise });
  await install(page); await settle(); page.stats().stop();
  let stops = 0;
  opening.resolve({ get value() { assert.fail('Retired watch value must not be read'); }, start() { assert.fail('Retired watch must not start'); }, async stop() { stops++; } });
  await settle(); assert.equal(stops, 1);
  assert.equal(Object.keys(page.stats().conversations).length, 0);
});

test('Pi observer reports synchronous callback failures without leaking raw errors', async () => {
  const page = renderer(); await install(page); await settle();
  page.host.__GNEAUXGHTS_NATIVE_E2E__.readPiChatState = () => { throw new Error('PRIVATE_OBSERVER_DETAIL'); };
  page.mutate(); page.commit(); page.flush();
  assert.equal(page.stats().observerErrors, 2);
  assert(!JSON.stringify(page.stats()).includes('PRIVATE_OBSERVER_DETAIL'));
  page.stats().stop();
});
