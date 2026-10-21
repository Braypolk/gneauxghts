import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual self-contained WebDriver callback in a fake renderer.
// This tests its lifetime behavior without a visible window or native process.
function rendererCallback(file, variable, globals) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === variable) {
      const call = ts.isAwaitExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (call && ts.isCallExpression(call) && call.expression.getText(tree) === 'browser.execute') callback = call.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert(callback, `Missing renderer callback ${variable}`);
  const javascript = ts.transpileModule(`const callback = ${callback.getText(tree)}; callback;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  return vm.runInNewContext(javascript, globals);
}

function fakeRenderer() {
  const timers = new Map(), frames = new Map(), completed = [];
  let sequence = 0;
  let mutations;
  const textarea = { value: '', focus() {}, dispatchEvent() {}, firstElementChild: {} };
  const timeline = { dataset: { historyRecordCount: '2' }, getAttribute: () => 'false' };
  const button = { disabled: false, click() {}, getAttribute: () => 'true' };
  const globals = {
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = ++sequence; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    performance: { now: () => 10 },
    InputEvent: class {},
    MutationObserver: class { constructor(fn) { mutations = fn; } observe() {} disconnect() {} },
    document: {
      visibilityState: 'visible', hasFocus: () => true,
      body: { innerText: '' },
      querySelector(selector) { return selector.includes('textarea') || selector.includes('.cm-content') ? textarea : selector.includes('aside') ? timeline : button; },
      querySelectorAll() { return [button]; },
      createRange: () => ({ selectNodeContents() {} }), execCommand: () => true
    },
    window: { __windowFrames: { gaps: [], events: [] }, getSelection: () => ({ removeAllRanges() {}, addRange() {} }) }
  };
  return {
    globals, timers, frames, completed, textarea,
    done: value => completed.push(value),
    mutate: () => mutations(),
    timer(ms) {
      const entry = [...timers].find(([, value]) => value.ms === ms);
      assert(entry, `Expected deadline ${ms}`);
      timers.delete(entry[0]); entry[1].fn();
    },
    frame() {
      const entry = frames.entries().next().value;
      assert(entry, 'Expected an outstanding animation frame');
      frames.delete(entry[0]); entry[1](10);
    }
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Editing Window input timeout cancels paint and ignores a late frame callback', async () => {
  const renderer = fakeRenderer();
  const callback = rendererCallback('../specs/native/editing-windows.spec.ts', 'inputResult', renderer.globals);
  const result = callback(1).then(renderer.done);
  const late = [...renderer.frames.values()][0];
  renderer.timer(5000);
  assert.equal(renderer.frames.size, 0);
  late(10);
  await result;
  assert.equal(renderer.frames.size, 0);
  assert.equal(renderer.completed.length, 1);
  assert.match(renderer.completed[0].error, /input frame timeout/);
});

test('timeline paint deadline cancels the nested frame and settles once', async () => {
  const renderer = fakeRenderer();
  const callback = rendererCallback('./timelineNativeMetrics.ts', 'result', renderer.globals);
  const result = callback('entry', '').then(renderer.done);
  renderer.mutate();
  renderer.frame();
  const late = [...renderer.frames.values()][0];
  renderer.timer(15000);
  assert.equal(renderer.frames.size, 0);
  late(10);
  await result;
  assert.equal(renderer.completed.length, 1);
  assert.match(renderer.completed[0].error, /stalled at paint/);
});
