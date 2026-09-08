// Run after `node e2e/support/buildNative.mjs`. This focused check owns every
// process it stops and binds the app only to one newly-created disposable root.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeE2EBinary } from './nativeE2EBinary.mjs';

const { binary, sha256 } = nativeE2EBinary('debug');
const output = mkdtempSync(join(tmpdir(), 'gneauxghts-restart-lifecycle-'));
const fixture = join(output, 'fixture');
for (const folder of ['app-data', 'documents', 'vault']) mkdirSync(join(fixture, folder), { recursive: true });
writeFileSync(join(fixture, 'owner.txt'), 'ticket-05-disposable-native-check\n');
const events = [];
const owned = new Set();
let failure;

function record(kind, detail = {}) {
  const event = { at: new Date().toISOString(), kind, ...detail };
  events.push(event);
  writeFileSync(join(output, 'events.json'), `${JSON.stringify(events, null, 2)}\n`);
  console.log(JSON.stringify(event));
}

function listenerPids(port) {
  try {
    return [...new Set(execFileSync('/usr/sbin/lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .trim().split(/\s+/).filter(Boolean).map(Number))];
  } catch (error) {
    if (error.status === 1 && !error.stdout?.length) return [];
    throw error;
  }
}

async function until(check, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}: ${last ?? ''}`);
}

async function request(path, body, method = 'POST') {
  const response = await fetch(`http://127.0.0.1:4445${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    signal: AbortSignal.timeout(25000)
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result));
  return result.value;
}

function start(executable, args, env, label) {
  const log = join(output, `${label}.log`);
  const fd = openSync(log, 'w');
  const child = spawn(executable, args, { env, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  owned.add(child);
  child.completion = new Promise(resolveCompletion => {
    child.once('error', error => {
      owned.delete(child);
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

async function stop(child) {
  if (!owned.has(child)) return child.completion;
  record('stop-owned', { pid: child.pid, signal: 'SIGTERM' });
  assert(child.kill('SIGTERM'));
  return Promise.race([
    child.completion,
    delay(10000).then(() => { throw new Error(`Owned process ${child.pid} did not exit`); })
  ]);
}

function launch(label) {
  return start(binary, [
    '--e2e-app-data-root', join(fixture, 'app-data'),
    '--e2e-documents-root', join(fixture, 'documents'),
    '--e2e-vault-root', join(fixture, 'vault')
  ], { ...process.env, WDIO_EMBEDDED_SERVER: 'true', TAURI_WEBDRIVER_PORT: '4445' }, label);
}

async function connect(child) {
  await until(async () => {
    assert(owned.has(child));
    const listeners = listenerPids(4445);
    if (!listeners.length) return false;
    assert.deepEqual(listeners, [child.pid]);
    return (await request('/status', undefined, 'GET')).ready;
  }, 'owned embedded WebDriver');
  const session = await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } });
  const sessionId = session.sessionId;
  const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args });
  const rawInvoke = (command, args = {}) => request(`/session/${sessionId}/execute/async`, {
    script: 'const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({ok:true,value}),error=>done({ok:false,failure:String(error)}));',
    args: [command, args]
  });
  const invoke = async (command, args = {}) => {
    const result = await rawInvoke(command, args);
    assert(result.ok, `${command}: ${result.failure}`);
    return result.value;
  };
  await until(() => execute('return !!window.__TAURI_INTERNALS__'), 'native frontend');
  const vault = await invoke('get_vault_info');
  assert.equal(realpathSync(vault.runningPath), realpathSync(join(fixture, 'vault')));
  record('connected-isolated-vault', { pid: child.pid, sessionId, runningPath: vault.runningPath });
  return { invoke, rawInvoke };
}

async function historyBodies(client, noteId) {
  const page = await client.invoke('get_note_history_page', { noteId, cursor: null, limit: 20 });
  const bodies = [];
  for (const record of page.records.filter(record => record.kind === 'revision')) {
    const revision = await client.invoke('get_note_history_revision', { noteId, revisionId: record.revisionId });
    bodies.push(revision.body);
  }
  return bodies;
}

async function cleanup() {
  for (const child of [...owned]) {
    try {
      await stop(child);
    } catch (error) {
      failure ??= String(error);
    }
  }
}

try {
  for (const port of [1430, 4445]) assert.deepEqual(listenerPids(port), [], `Port ${port} is occupied; refusing to touch its owner`);
  record('run-start', { output, fixture, binary, sha256 });
  start(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--strictPort', '--host', '127.0.0.1', '--port', '1430'],
    { ...process.env, VITE_E2E_NATIVE: 'true' }, 'vite');
  await until(async () => (await fetch('http://127.0.0.1:1430')).ok, 'owned Vite server');

  let app = launch('first-app');
  let client = await connect(app);
  const note = await client.invoke('save_note', { title: 'Restart lifecycle', markdown: 'Anchor', currentPath: null });
  await client.invoke('save_note', { title: note.title, markdown: 'Pending endpoint', currentPath: note.path });
  record('pending-editing-window-seeded', { pid: app.pid, noteId: note.noteId, path: note.path });

  const receipt = await client.invoke('prepare_restart');
  assert.deepEqual(receipt, { status: 'ready', ready: true, timelinePortable: true, canResume: false });
  record('ready-receipt', { pid: app.pid, receipt });
  assert.deepEqual(await client.invoke('prepare_restart'), receipt, 'Repeated preparation must reuse ready state');
  const lateSave = await client.rawInvoke('save_note', { title: note.title, markdown: 'Must not publish', currentPath: note.path });
  assert.equal(lateSave.ok, false, 'Ready state must reject new canonical mutation');
  record('post-ready-mutation-rejected', { pid: app.pid, error: lateSave.failure });

  const firstPid = app.pid;
  await stop(app);
  app = launch('restarted-app');
  assert.notEqual(app.pid, firstPid);
  client = await connect(app);
  const recovered = await historyBodies(client, note.noteId);
  assert.deepEqual(recovered, ['Pending endpoint', 'Anchor']);
  const continued = await client.invoke('save_note', { title: note.title, markdown: 'Continued after restart', currentPath: note.path });
  assert.equal(continued.commitWarning, undefined);
  const secondReceipt = await client.invoke('prepare_restart');
  assert.equal(secondReceipt.ready, true);
  assert.equal(secondReceipt.timelinePortable, true);
  record('new-process-continued-and-closed', { pid: app.pid, recovered, secondReceipt });
  await stop(app);
} catch (error) {
  failure = String(error.stack ?? error);
  record('failure', { error: failure });
} finally {
  await cleanup();
  writeFileSync(join(output, 'result.json'), `${JSON.stringify({ passed: !failure, failure, output, fixture, binary, sha256, events }, null, 2)}\n`);
  console.log(`RESTART_LIFECYCLE_EVIDENCE ${output}`);
}

process.exitCode = failure ? 1 : 0;
