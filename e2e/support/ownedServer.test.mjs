import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { startOwnedServer } from './ownedServer.mjs';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}
async function close(server) { await new Promise(resolve => server.close(resolve)); }
async function freePort() { const server = createServer(); const port = await listen(server); await close(server); return port; }
function child(port, body) {
  return { command: process.execPath, args: ['--input-type=module', '-e', `import {createServer} from 'node:http'; createServer((req,res)=>{${body}}).listen(${port}, '127.0.0.1');`], port, timeoutMs: 1000 };
}

test('an unrelated HTTP 200 listener is rejected and left running', async () => {
  const server = createServer((_req, res) => res.end('foreign'));
  const port = await listen(server);
  try {
    await assert.rejects(startOwnedServer(child(port, "res.end('foreign')")), { code: 'EADDRINUSE' });
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'foreign');
  } finally { await close(server); }
});

test('owned server requires identity and teardown is idempotent', async () => {
  const port = await freePort();
  const server = await startOwnedServer(child(port, 'res.end(process.env.GNEAUXGHTS_E2E_SERVER_TOKEN)'));
  await server.stop();
  await server.stop();
  const replacement = createServer();
  await new Promise((resolve, reject) => { replacement.once('error', reject); replacement.listen(port, '127.0.0.1', resolve); });
  await close(replacement);
});

test('early child exit and spawn failure fail promptly', async () => {
  const port = await freePort();
  await assert.rejects(startOwnedServer({ command: process.execPath, args: ['-e', 'process.exit(7)'], port, timeoutMs: 5000 }), /exited \(7\)/);
  await assert.rejects(startOwnedServer({ command: '/no-such-gneauxghts-test-command', args: [], port, timeoutMs: 5000 }), { code: 'ENOENT' });
});

for (const [name, body] of [['hung response', ''], ['wrong identity', "res.end('wrong')"]]) {
  test(`${name} times out and releases the owned port`, async () => {
    const port = await freePort();
    await assert.rejects(startOwnedServer({ ...child(port, body), timeoutMs: 200 }), /Timed out/);
    const replacement = createServer();
    await new Promise((resolve, reject) => { replacement.once('error', reject); replacement.listen(port, '127.0.0.1', resolve); });
    await close(replacement);
  });
}

test('cancellation during readiness stops only the owned server', async () => {
  const port = await freePort();
  const lifetime = new AbortController();
  const pending = startOwnedServer({ ...child(port, ''), abortSignal: lifetime.signal });
  const timer = setTimeout(() => lifetime.abort(), 50);
  try { await assert.rejects(pending, /abort/i); }
  finally { clearTimeout(timer); }
  const replacement = createServer();
  await new Promise((resolve, reject) => { replacement.once('error', reject); replacement.listen(port, '127.0.0.1', resolve); });
  await close(replacement);
});

test('owner stop joins pending admission and forced exit of a TERM-resistant child', { timeout: 7000 }, async () => {
  const { createOwnedServerOwner } = await import('./ownedServer.mjs');
  const port = await freePort();
  const owner = createOwnedServerOwner();
  let ready;
  const listening = new Promise(resolve => { ready = resolve; });
  const admission = owner.start({
    command: process.execPath,
    args: ['-e', `process.on('SIGTERM',()=>{});require('http').createServer(()=>{}).listen(${port},'127.0.0.1',()=>console.log('ready'));`],
    port, timeoutMs: 5000, onOutput: () => ready()
  });
  // Attach the rejection observer before cancellation; no admitted handle exists.
  const cancelled = assert.rejects(admission, /abort/i);
  try {
    await listening;
    await Promise.all([owner.stop(), owner.stop()]);
    await cancelled;
    const replacement = createServer();
    await new Promise((resolve, reject) => { replacement.once('error', reject); replacement.listen(port, '127.0.0.1', resolve); });
    await close(replacement);
  } finally { await owner.stop(); }
});

test('owner preserves unexpected admission errors when cleanup joins', async () => {
  const { createOwnedServerOwner } = await import('./ownedServer.mjs');
  const owner = createOwnedServerOwner();
  await assert.rejects(owner.start({ command: '/no-such-gneauxghts-test-command', args: [], port: await freePort() }), { code: 'ENOENT' });
  await assert.rejects(owner.stop(), { code: 'ENOENT' });
});
