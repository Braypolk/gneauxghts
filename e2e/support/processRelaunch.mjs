// Run after `node e2e/support/buildNative.mjs --release`.
// This runner owns every native PID it interrupts. WebDriver is only transport.
import assert from 'node:assert/strict';
import { nativeE2EBinary } from './nativeE2EBinary.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const admittedBinary = nativeE2EBinary('release');
const { binary } = admittedBinary;
const output = mkdtempSync(join(tmpdir(), 'gneauxghts-process-evidence-'));
const events = [];
const owned = new Set();
let cancelling = false;
let cleanupPromise;
const results = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function record(kind, detail = {}) {
  const event = { at: new Date().toISOString(), kind, ...detail };
  events.push(event);
  writeFileSync(join(output, 'events.json'), JSON.stringify(events, null, 2));
  console.log(JSON.stringify(event));
}
async function until(check, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`Timed out: ${description}; ${last ?? ''}`);
}
async function request(path, body, method = 'POST') {
  const response = await fetch(`http://127.0.0.1:4445${path}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    signal: AbortSignal.timeout(25000)
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result));
  return result.value;
}
function createOwned(executable, args, env, label) {
  assert(!cancelling, "Runner is stopping; no new children may be created");
  const log = join(output, `${label}.log`);
  const fd = openSync(log, 'w');
  const child = spawn(executable, args, { env, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  owned.add(child);
  child.completion = new Promise(resolveCompletion => {
    child.once('error', error => {
      owned.delete(child);
      record('spawn-error', { label, error: String(error) });
      resolveCompletion({ error: String(error) });
    });
    child.once('exit', (code, signal) => {
      owned.delete(child);
      record('exit', { label, pid: child.pid, code, signal });
      resolveCompletion({ code, signal });
    });
  });
  record('spawn', { label, pid: child.pid, executable, args, log });
  return child;
}
async function stop(child, signal = 'SIGKILL') {
  if (child.stopping) return child.stopping;
  child.stopping = stopOwned(child, signal);
  return child.stopping;
}
async function stopOwned(child, signal) {
  assert(owned.has(child), 'Only an owned, still-running child may be interrupted');
  record('interrupt', { pid: child.pid, signal });
  assert(child.kill(signal));
  const exit = await Promise.race([child.completion, delay(10000).then(() => { throw new Error('Owned process failed to exit'); })]);
  if (signal === 'SIGKILL') assert.equal(exit.signal, 'SIGKILL');
  return exit;
}
function listenerPids(port) {
  try { return [...new Set(execFileSync('/usr/sbin/lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean).map(Number))]; }
  catch (error) { if (error.status === 1 && !error.stdout?.length) return []; throw error; }
}
async function connect(child) {
  await until(async () => {
    assert(owned.has(child));
    const listeners = listenerPids(4445);
    if (!listeners.length) return false;
    assert.deepEqual(listeners, [child.pid], 'Embedded listener must belong to the exact owned native child');
    return (await request('/status', undefined, 'GET')).ready;
  }, 'owned embedded WebDriver');
  assert.deepEqual(listenerPids(4445), [child.pid]);
  record('listener-owned', { pid: child.pid, port: 4445 });
  const session = await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } });
  const sessionId = session.sessionId;
  record('session', { pid: child.pid, sessionId });
  const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args });
  const invoke = async (command, args = {}) => {
    const result = await request(`/session/${sessionId}/execute/async`, {
      script: 'const done = arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(value => done({ok:true,value}), error => done({ok:false,error}));',
      args: [command, args]
    });
    assert(result.ok, `${command}: ${JSON.stringify(result.error)}`);
    return result.value;
  };
  await until(() => execute('return !!window.__TAURI_INTERNALS__ && !!document.querySelector("[data-testid=note-editor]");'), 'native frontend');
  const vault = await invoke('get_vault_info');
  assert.equal(realpathSync(vault.runningPath), realpathSync(join(child.fixtureRoot, 'vault')), 'Production running vault must be the disposable fixture before any write');
  record('vault-bound', { pid: child.pid, root: vault.runningPath });
  await invoke('plugin:window|show', { label: 'main' });
  await invoke('plugin:window|set_focus', { label: 'main' });
  await until(() => execute('return document.visibilityState === "visible" && document.hasFocus();'), 'genuinely visible, focused webview');
  const visibility = await execute('return {visibility:document.visibilityState,focus:document.hasFocus(),href:location.href};');
  record('visible', { pid: child.pid, ...visibility });
  return { invoke, execute, child };
}
function launch(root, label) {
  const child = createOwned(binary, ['--e2e-app-data-root', join(root, 'app-data'), '--e2e-documents-root', join(root, 'documents'), '--e2e-vault-root', join(root, 'vault')],
    { ...process.env, WDIO_EMBEDDED_SERVER: 'true', TAURI_WEBDRIVER_PORT: '4445', GNEAUXGHTS_PROCESS_FAULT_ROOT: root }, label);
  child.fixtureRoot = root;
  return child;
}
function arm(root, point) {
  if (existsSync(join(root, 'ack.json'))) unlinkSync(join(root, 'ack.json'));
  const control = { point, token: randomUUID() };
  writeFileSync(join(root, 'fault.json.tmp'), JSON.stringify(control));
  renameSync(join(root, 'fault.json.tmp'), join(root, 'fault.json'));
  record('arm', { root, ...control });
  return control;
}
function disarm(root) { if (existsSync(join(root, 'fault.json'))) unlinkSync(join(root, 'fault.json')); }
async function acknowledged(root, child, control) {
  const ack = await until(() => JSON.parse(readFileSync(join(root, 'ack.json'), 'utf8')), control.point);
  assert.equal(ack.pid, child.pid);
  assert.equal(ack.token, control.token);
  assert.equal(ack.point, control.point);
  assert.equal(resolve(ack.fixture), realpathSync(root));
  assert(owned.has(child));
  record('acknowledged', ack);
  return ack;
}
function snapshot(root, child, label) {
  // Never open SQLite between death and native recovery. This call requires
  // the original parked process, or a connected fresh process after domain reads.
  assert(owned.has(child));
  const value = JSON.parse(execFileSync('python3', ['e2e/support/relaunchSnapshot.py', root, join(output, `${label}-raw`)], { encoding: 'utf8' }));
  writeFileSync(join(output, `${label}.json`), JSON.stringify(value, null, 2));
  assert.equal(value.integrity[0].integrity_check, 'ok');
  assert.deepEqual(value.foreignKeys, []);
  return value;
}
function assertSettled(value) {
  assert.equal(value.intents.length, 0, 'Completed preparation is removed');
  assert.equal(value.windowPreparations.length, 0);
  assert.equal(value.windows.length, 0);
  assert.equal(value.observations.length, 0);
  assert(value.intents.every(row => row.payloadBytes === 0), 'Terminal authored payloads retired');
  assert(value.receipts.every(row => row.live === 0), 'Restart releases dead-process receipt leases');
  for (const revision of value.revisions.filter(row => row.intent_id)) {
    assert(value.receipts.some(row => row.intent_id === revision.intent_id), 'Retained revision keeps its receipt');
  }
  assert.equal(new Set(value.evidence.map(row => row.window_id)).size, value.evidence.length);
}
async function history(client, note) {
  const page = await client.invoke('get_note_history_page', { noteId: note.noteId, cursor: null, limit: 100 });
  const revisions = page.records.filter(row => row.kind === 'revision');
  const contents = [];
  for (const revision of revisions) {
    const full = await client.invoke('get_note_history_revision', { noteId: note.noteId, revisionId: revision.revisionId });
    contents.push({ id: revision.revisionId, source: revision.source, timeKind: revision.timeKind, full });
  }
  return contents;
}
const matrix = [
  { name: 'prepared-before-publication', point: 'publication-prepared', expected: ['Anchor'] },
  { name: 'published-before-capture', point: 'canonical-published', expected: ['Endpoint B', 'Anchor'] },
  { name: 'captured-pending-window', point: 'publication-captured', expected: ['Endpoint B', 'Anchor'] },
  { name: 'interrupted-publication-recovery', point: 'canonical-published', recovery: true, expected: ['Endpoint B', 'Anchor'] },
  { name: 'committed-window-sealing', point: 'window-sealed', expected: ['Endpoint B', 'Anchor'] },
  { name: 'retained-external-before-newer-disk', point: 'observation-retained', external: true, expected: ['External D', 'External C', 'Endpoint B', 'Anchor'] }
];

async function runCase(test) {
  const root = mkdtempSync(join(tmpdir(), 'gneauxghts-process-relaunch-'));
  writeFileSync(join(root, 'owner.txt'), 'issue48-disposable\n');
  for (const folder of ['app-data', 'documents', 'vault']) mkdirSync(join(root, folder));
  record('case-start', { name: test.name, root });
  let child = launch(root, `${test.name}-first`);
  let client = await connect(child);
  const note = await client.invoke('save_note', { title: `Relaunch ${test.name}`, markdown: 'Anchor', currentPath: null });
  assert.equal(note.commitWarning, undefined);
  const anchorBytes = readFileSync(note.path);
  const anchorHistory = await history(client, note);
  assert.equal(anchorHistory.length, 1);
  if (test.point === 'window-sealed' || test.external) {
    await client.invoke('save_note', { title: note.title, markdown: 'Endpoint B', currentPath: note.path });
  }
  const control = arm(root, test.point);
  // Fire without waiting for its result: the native handler deliberately parks.
  let operation;
  if (test.external) {
    const bytes = readFileSync(note.path, 'utf8').replace('Endpoint B', 'External C');
    writeFileSync(note.path, bytes);
    operation = client.invoke('e2e_flush_vault_watcher_path', { path: note.path }).catch(error => ({ interrupted: String(error) }));
  } else {
    operation = client.invoke(test.point === 'window-sealed' ? 'finalize_note_editing_window' : 'save_note',
      test.point === 'window-sealed' ? { noteId: note.noteId } : { title: note.title, markdown: 'Endpoint B', currentPath: note.path }).catch(error => ({ interrupted: String(error) }));
  }
  const ack = await acknowledged(root, child, control);
  const before = snapshot(root, child, `${test.name}-at-fault`);
  const bytesAtFault = readFileSync(note.path);
  if (test.point === 'publication-prepared') assert.deepEqual(bytesAtFault, anchorBytes);
  else assert(bytesAtFault.includes(test.external ? 'External C' : 'Endpoint B'));
  assert.equal(before.intents.filter(row => row.status === 'prepared').length, ['publication-prepared', 'canonical-published'].includes(test.point) ? 1 : 0);
  const interruptedIntent = before.intents.find(row => row.status === 'prepared');
  const endpointIntentId = before.windows[0]?.endpoint_intent_id;
  const endpointReceipt = before.receipts.find(row => row.intent_id === endpointIntentId);
  assert.equal(before.windows.length, ['publication-captured', 'observation-retained'].includes(test.point) ? 1 : 0);
  assert.equal(before.windowPreparations.length, before.intents.length, 'Only unresolved window preparation survives');
  if (test.external) assert(before.observations.some(row => row.canonical_markdown.includes('External C')));
  if (test.point === 'window-sealed') assert.equal(before.evidence.length, 1);
  const oldPid = child.pid;
  await stop(child);
  record('interrupted-command', { name: test.name, result: await operation });
  disarm(root);
  let expectedBytes = bytesAtFault;
  if (test.external) {
    expectedBytes = Buffer.from(bytesAtFault.toString().replace('External C', 'External D'));
    writeFileSync(note.path, expectedBytes);
    record('newer-external-bytes', { root, sha256: sha256(expectedBytes) });
  }
  if (test.recovery) {
    const recoveryControl = arm(root, 'recovery-publication-captured');
    child = launch(root, `${test.name}-interrupted-recovery`);
    assert.notEqual(child.pid, oldPid);
    // Startup reconciliation reaches this point without any driver reconnection.
    await acknowledged(root, child, recoveryControl);
    await stop(child);
    disarm(root);
  }
  child = launch(root, `${test.name}-relaunch`);
  assert.notEqual(child.pid, oldPid);
  client = await connect(child);
  await client.invoke('retry_history_recovery');
  if (test.external) await client.invoke('e2e_flush_vault_watcher_path', { path: note.path });
  const recovered = await history(client, note);
  writeFileSync(join(output, `${test.name}-history.json`), JSON.stringify(recovered, null, 2));
  assert.equal(recovered.length, test.expected.length);
  // Full bodies are obtained through production revision reconstruction, never SQL payload decoding.
  assert.deepEqual(recovered.map(row => row.full.body), test.expected);
  assert.equal(recovered.at(-1).id, anchorHistory[0].id);
  if (test.point === 'window-sealed') assert.equal(recovered[0].id, before.evidence[0].revision_id);
  assert.deepEqual(readFileSync(note.path), expectedBytes, 'Recovery never republishes canonical Markdown');
  const opened = await client.invoke('open_note', { noteId: note.noteId, path: null });
  assert.equal(opened.markdown, test.expected[0]);
  const after = snapshot(root, child, `${test.name}-after-recovery`);
  assertSettled(after);
  if (interruptedIntent) assert.equal(after.receipts.find(row => row.intent_id === interruptedIntent.intent_id)?.status, test.point === 'publication-prepared' ? 'abandoned' : 'finalized');
  if (endpointReceipt) assert.equal(after.receipts.find(row => row.intent_id === endpointIntentId)?.outcome, endpointReceipt.outcome, 'Recovered endpoint preserves its original receipt outcome');
  assert.equal(after.evidence.length, test.point === 'publication-prepared' ? 0 : 1);
  await client.invoke('retry_history_recovery');
  assert.deepEqual(await history(client, note), recovered, 'Repeated recovery preserves exact immutable identities/content/order');

  if (test.point === 'publication-captured') {
    // Exercise receipt retirement while retaining the crash-recovered revision.
    for (let index = 0; index < 70; index++) await client.invoke('save_note', { title: note.title, markdown: 'Endpoint B', currentPath: note.path });
    const retired = snapshot(root, child, `${test.name}-retirement`);
    assertSettled(retired);
    assert.equal(retired.receipts.find(row => row.intent_id === endpointIntentId)?.outcome, endpointReceipt.outcome, 'Compaction preserves referenced endpoint receipt outcome');
    assert(retired.scopes[0].retired_through > 0);
    const referenced = new Set(retired.revisions.map(row => row.intent_id));
    assert(retired.receipts.filter(row => !referenced.has(row.intent_id)).length <= 64);
    assert.deepEqual(await history(client, note), recovered);
  }
  const continued = await client.invoke('save_note', { title: note.title, markdown: 'Continued after relaunch', currentPath: note.path });
  assert.equal(continued.commitWarning, undefined);
  await client.invoke('finalize_note_editing_window', { noteId: note.noteId });
  const finalHistory = await history(client, note);
  assert.deepEqual(finalHistory.slice(1), recovered);
  assert.equal(finalHistory[0].full.body, 'Continued after relaunch');
  const finalBytes = readFileSync(note.path);
  const secondPid = child.pid;
  await stop(child);
  child = launch(root, `${test.name}-verify-again`);
  assert.notEqual(child.pid, secondPid);
  client = await connect(child);
  assert.deepEqual(await history(client, note), finalHistory, 'Another actual restart does not duplicate finalized history');
  assert.deepEqual(readFileSync(note.path), finalBytes);
  assertSettled(snapshot(root, child, `${test.name}-final`));
  await stop(child);
  const result = { name: test.name, passed: true, root, acknowledgement: ack, canonicalAtFaultSha256: sha256(bytesAtFault), recoveredCanonicalSha256: sha256(expectedBytes), recovered, finalHistory };
  results.push(result);
  record('case-pass', { name: test.name });
}

async function runBackgroundInterruption() {
  const root=mkdtempSync(join(tmpdir(),'gneauxghts-process-relaunch-'));
  writeFileSync(join(root,'owner.txt'),'issue48-disposable\n');
  for(const folder of ['app-data','documents','vault'])mkdirSync(join(root,folder));
  let child=launch(root,'background-seed'),client=await connect(child);
  const note=await client.invoke('save_note',{title:'Background interrupted',markdown:'Anchor',currentPath:null});
  await client.invoke('save_note',{title:note.title,markdown:'Endpoint B',currentPath:note.path});
  await client.invoke('finalize_note_editing_window',{noteId:note.noteId});
  const retained=await history(client,note),bytes=readFileSync(note.path);
  await stop(child);
  const control=arm(root,'background-note-verification');
  child=launch(root,'background-parked');
  const ack=await acknowledged(root,child,control);
  client=await connect(child);
  const readiness=await client.invoke('get_history_readiness',{noteId:note.noteId});
  assert.equal(readiness.backgroundComplete,false);
  // The parked unrelated worker owns no canonical mutation lock. Foreground
  // target verification and a distinct publication still complete normally.
  const saved=await client.invoke('save_note',{title:note.title,markdown:'Saved while background parked',currentPath:note.path});
  assert.equal(saved.commitWarning,undefined);
  assert(readFileSync(note.path,'utf8').includes('Saved while background parked'));
  const ready=await client.invoke('get_history_readiness',{noteId:note.noteId});
  assert.equal(ready.state,'ready');assert.equal(ready.backgroundComplete,false);
  snapshot(root,child,'background-before-interruption');
  await stop(child);disarm(root);
  child=launch(root,'background-recovered');client=await connect(child);
  const after=await history(client,note);
  assert.deepEqual(after.slice(1),retained);
  assert.equal(after[0].full.body,'Saved while background parked');
  assert.notDeepEqual(readFileSync(note.path),bytes);
  await until(async()=>{const r=await client.invoke('get_history_readiness',{noteId:note.noteId});return r.backgroundComplete;},'restarted background completes');
  assertSettled(snapshot(root,child,'background-final'));
  await stop(child);
  results.push({name:'background-verification-interruption',passed:true,root,ack,readiness,ready,retained,after,limit:'E2E park deliberately ignores cancellation; tests owned SIGKILL/restart, not normal cancellation latency'});
  record('case-pass',{name:'background-verification-interruption'});
}

async function cleanup() {
  cancelling = true;
  cleanupPromise ??= (async () => {
    for (const child of [...owned]) {
      try { await stop(child); } catch (error) { record('cleanup-failure', { pid: child.pid, error: String(error) }); failure ??= String(error); }
    }
  })();
  return cleanupPromise;
}
let failure;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  failure = `Runner cancelled by ${signal}`;
  record('runner-cancelled', { signal });
  await cleanup();
  writeFileSync(join(output, 'results.json'), JSON.stringify({ passed: false, failure, results, events }, null, 2));
  process.exit(signal === 'SIGINT' ? 130 : 143);
});
try {
  record('run-start', { output, binary, binaryAdmission: admittedBinary, binarySha256: sha256(readFileSync(binary)), argv: process.argv, platform: process.platform });
  const lock = execFileSync('ioreg', ['-n', 'Root', '-d', '1'], { encoding: 'utf8' });
  writeFileSync(join(output, 'display-state.log'), lock);
  assert(/IOConsoleLocked"\s*=\s*No/.test(lock) && !/CGSSessionScreenIsLocked"\s*=\s*Yes/.test(lock), 'Unlock the display before running native acceptance');
  for (const port of [1430, 4445]) assert.deepEqual(listenerPids(port), [], `Port ${port} is occupied; refusing to touch its owner`);
  createOwned(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--strictPort', '--host', '127.0.0.1', '--port', '1430'], process.env, 'vite-preview');
  await until(async () => (await fetch('http://127.0.0.1:1430')).ok, 'owned Vite preview');
  for (const test of matrix) await runCase(test);
  await runBackgroundInterruption();
} catch (error) {
  failure = String(error.stack ?? error);
  record('failure', { error: failure });
} finally {
  await cleanup();
  writeFileSync(join(output, 'results.json'), JSON.stringify({ passed: !failure, failure, results, events }, null, 2));
  console.log(`PROCESS_RELAUNCH_EVIDENCE ${output}`);
}
process.exitCode = failure ? 1 : 0;
