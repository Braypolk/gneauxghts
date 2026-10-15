import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createWebDriverRequest, waitUntil } from '../../e2e/support/nativeTransport.mjs';
import { startFixture } from './fixture.mjs';

const root = process.env.PI_PROTOTYPE_DATA ?? mkdtempSync(join(tmpdir(), 'gneauxghts-pi-gate-'));
const binary = resolve('src-tauri/target/debug/gneauxghts');
const fixture = await startFixture();
const server = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '1442', '--strictPort'], {
  env: { ...process.env, VITE_PI_PROTOTYPE: 'true' }, stdio: 'ignore', detached: true
});
let app;
const reportPath = join(root, 'PROTOTYPE-wipe-me/probe.json');
const launch = () => spawn(binary, ['--e2e-app-data-root', root, '--e2e-documents-root', root], { stdio: 'ignore',
  env: {...process.env, PI_PROTOTYPE_HTTP_FIXTURE:'http://127.0.0.1:1443'} });
const result = async () => waitUntil(() => {
  try { const value = JSON.parse(readFileSync(reportPath, 'utf8')); return value.status && value; } catch { return false; }
}, 'native Pi diagnostic', 45_000);
try {
  await waitUntil(async () => (await fetch('http://127.0.0.1:1442/pi-prototype')).ok, 'owned Vite', 20_000);
  app = launch();
  const first = await result(); assert.equal(first.status, 'passed');
  const wd = createWebDriverRequest(4445);
  const session = await wd('/session', { capabilities: { alwaysMatch: { browserName: 'wry' } } });
  const mounted = await wd(`/session/${session.sessionId}/execute/sync`, {
    script: 'return {url:location.href,text:document.body.innerText}', args: []
  });
  assert.match(mounted.text, /Pi close\/reopen document and receipt/);
  await wd(`/session/${session.sessionId}`, undefined, 'DELETE');
  app.kill('SIGKILL'); await once(app, 'exit'); app = undefined;
  unlinkSync(reportPath);
  await delay(300);
  app = launch();
  const second = await result(); assert.equal(second.status, 'passed');
  assert(second.checks.includes('prior process submission receipt restored'));
  assert.notEqual(first.submissionId, second.submissionId);
  const evidence = { binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), first, second, mounted, requests:fixture.requests };
  writeFileSync(join(root, 'desktop-gate.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: 'passed', root, evidence: join(root, 'desktop-gate.json') }));
} finally {
  if (app) { app.kill('SIGTERM'); await once(app, 'exit'); }
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  await fixture.close();
}
