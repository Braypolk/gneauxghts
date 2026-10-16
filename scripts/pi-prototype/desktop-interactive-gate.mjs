// Normal workspace fixture acceptance. Build/launch is intentionally separate
// from implementation tests. This script always allocates fresh synthetic data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createWebDriverRequest, waitUntil, listenerPids } from '../../e2e/support/nativeTransport.mjs';
import { startInteractiveFixture } from './interactive-fixture.mjs';
import { assertExpandedPhase } from './expanded-report.mjs';
import { verifyFollowonsReceipts } from './followons-fixture.mjs';

const followons = process.env.PI_PROTOTYPE_FOLLOWONS_GATE === 'true';
if (process.env.PI_PROTOTYPE_DATA) throw new Error('Interactive gate always allocates a fresh generated root; unset PI_PROTOTYPE_DATA');
for (const port of [1442, 1443, 4445]) assert.equal(listenerPids(port).length, 0, `Port ${port} has an unrelated owner; do not terminate it`);
const root = mkdtempSync(join(tmpdir(), 'gneauxghts-pi-interactive-'));
const binary = resolve('src-tauri/target/debug/gneauxghts');
assert(existsSync(binary), 'Build the isolated Pi/e2e binary through pnpm pi:prototype interactive-gate');
const evidencePath = join(root, 'desktop-interactive-gate.json');
const evidence = { gate: followons ? 'expanded-native-workspace-fixture' : 'first-usable-desktop-fixture', status: 'running', root,
  binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), phases: [], screenshots: [],
  limits: ['Synthetic provider observations only; live local/Responses acceptance remains required.', 'Old/Pi shared-scenario comparison remains required.', 'Explicit append is initiated through the public Pi API and reviewed/kept in the ordinary editor.'] };
const fixture = await startInteractiveFixture(1443, { followons });
const env = { ...process.env, VITE_PI_PROTOTYPE: 'true', VITE_E2E_NATIVE: 'true', PI_PROTOTYPE_INTERACTIVE_GATE: 'true', PI_PROTOTYPE_HTTP_FIXTURE: 'http://127.0.0.1:1443' };
delete env.GNEAUXGHTS_E2E_FOREGROUND;
delete env.PI_PROTOTYPE_UI_GATE;
delete env.PI_PROTOTYPE_FAULT;
if (followons) { env.PI_PROTOTYPE_EXPANDED_GATE = 'true'; env.PI_PROTOTYPE_FOLLOWONS_GATE = 'true'; }
else { delete env.PI_PROTOTYPE_EXPANDED_GATE; delete env.PI_PROTOTYPE_FOLLOWONS_GATE; }
const frontendLog = join(root, 'frontend.log'), nativeLog = join(root, 'native.log');
evidence.logs = { frontend: frontendLog, native: nativeLog };
const frontendFd = openSync(frontendLog, 'a');
const server = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '1442', '--strictPort'], { env, stdio: ['ignore', frontendFd, frontendFd], detached: true });
closeSync(frontendFd);
let app, session;
const wd = createWebDriverRequest(4445);
const launch = async () => {
  const nativeFd = openSync(nativeLog, 'a');
  app = spawn(binary, ['--e2e-app-data-root', root, '--e2e-documents-root', root], {
    env: { ...env, WDIO_EMBEDDED_SERVER: 'true', TAURI_WEBDRIVER_PORT: '4445' }, stdio: ['ignore', nativeFd, nativeFd]
  });
  closeSync(nativeFd);
  await waitUntil(async () => (await wd('/status', undefined, 'GET')).ready, 'owned ready native WebDriver', 30000);
  session = await wd('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } });
  // Driver availability precedes Wry document load. Admit fixture work only
  // after the normal workspace mounted in the app's existing webview.
  evidence.launchState = await waitUntil(async () => {
    const state = await wd(`/session/${session.sessionId}/execute/sync`, { script: "return {href:location.href,readyState:document.readyState,workspace:!!document.querySelector('[data-testid=\"workspace-pane\"]')}", args: [] });
    evidence.lastPageState = state;
    return state.workspace && state.readyState !== 'loading' && state;
  }, 'loaded native workspace after driver creation', 45000);
};
const stopApp = async signal => {
  if (!app || app.exitCode !== null) { app = undefined; return; }
  const stopped = once(app, 'exit'); app.kill(signal);
  await Promise.race([stopped, delay(5000)]);
  if (app.exitCode === null) { app.kill('SIGKILL'); await Promise.race([stopped, delay(5000)]); }
  app = undefined;
};
const screenshot = async name => {
  const path = join(root, `${name}.png`);
  writeFileSync(path, Buffer.from(await wd(`/session/${session.sessionId}/screenshot`, undefined, 'GET'), 'base64'));
  evidence.screenshots.push(path);
};
const phase = async (name, priorLaunchId) => {
  const beforeNavigation = await wd(`/session/${session.sessionId}/execute/sync`, { script: 'return {href:location.href,readyState:document.readyState}', args: [] });
  evidence.navigation = [...(evidence.navigation ?? []), { phase: name, before: beforeNavigation }];
  const query = followons ? 'piExpandedTest=1' : `piInteractiveTest=${name}`;
  await wd(`/session/${session.sessionId}/execute/sync`, { script: `location.href='http://127.0.0.1:1442/?${query}';return true`, args: [] });
  const result = await waitUntil(() => {
    try { const report = JSON.parse(readFileSync(join(root, 'PROTOTYPE-wipe-me/ui-report.json'), 'utf8')); return report.gate === evidence.gate && (report.phase === name || (report.phase === 'starting' && report.status === 'failed')) && (!priorLaunchId || report.launchId !== priorLaunchId) && ['passed', 'failed'].includes(report.status) && report; }
    catch { return false; }
  }, `normal UI ${name} journey`, followons ? 600000 : 180000);
  evidence.phases.push(result); await screenshot(name); writeFileSync(evidencePath, JSON.stringify({ ...evidence, requests: fixture.requests }, null, 2));
  assert.equal(result.status, 'passed', JSON.stringify(result));
  if (followons) assertExpandedPhase(result, name, priorLaunchId);
  return result;
};
try {
  await waitUntil(async signal => (await fetch('http://127.0.0.1:1442/', { signal })).ok, 'owned Vite', 20000);
  await launch();
  if (!followons) await phase('seed');
  const first = await phase('first');
  const stop = fixture.requests.find(request => request.journey === 'STOP' && request.attempt === 1);
  assert(stop && stop.closed && !stop.completed && stop.firstTextAt <= stop.closedAt, 'Stop must cancel an active native provider stream before completion');
  evidence.activeStop = { firstTextAt: stop.firstTextAt, closedAt: stop.closedAt, completed: stop.completed, pauseStartedAt: stop.pauseStartedAt, pauseFinishedAt: stop.pauseFinishedAt };
  await wd(`/session/${session.sessionId}`, undefined, 'DELETE'); session = undefined;
  await stopApp('SIGKILL'); await delay(300);
  const beforeRelaunch = fixture.requests.length;
  await launch(); await delay(1000);
  assert.equal(fixture.requests.length, beforeRelaunch, 'Relaunch silently dispatched provider work before explicit Retry');
  const relaunched = await phase('relaunch', followons ? first.launchId : undefined);
  evidence.noReplay = { beforeRelaunch, beforeExplicitRetry: beforeRelaunch };
  assert(fixture.requests.some(request => request.path === '/local/v1/chat/completions'), 'Local-compatible protocol not exercised');
  assert(fixture.requests.some(request => request.path === '/openai/v1/responses'), 'Responses protocol not exercised');
  assert(fixture.requests.some(request => request.model === 'pi-native-fixture-b'), 'Model switch did not reach native provider');
  assert(!fixture.requests.some(request => request.error), 'Fixture request contract failed');
  const receipts = followons ? relaunched.shared.find(value => value.phase === 'relaunch').receipts : relaunched.receipts;
  const saves = receipts['public deterministic repeated-selection append uses retained UI review and exact target'];
  assert.deepEqual(saves.before, saves.after, 'Save inference counters changed');
  if (followons) {
    evidence.followons = verifyFollowonsReceipts(fixture.requests, relaunched.followons);
    evidence.storageFaults = relaunched.storageFaults;
    evidence.unobserved = relaunched.unobserved;
  }
  if (!followons && process.env.PI_PROTOTYPE_INTERACTIVE_FAILURES === 'true') await phase('failures');
  if (!followons && process.env.PI_PROTOTYPE_INTERACTIVE_FAILURES === 'true') {
    const storage = await wd(`/session/${session.sessionId}/execute/async`, {script: "const done=arguments[arguments.length-1];import('/src/lib/prototypes/pi/nativeStorageFaultProbe.ts').then(({runNativeStorageFaultProbe})=>runNativeStorageFaultProbe({phase:'last-after-ui',generatedSyntheticRoot:true})).then(report=>done({ok:true,report}),error=>done({ok:false,error:String(error)}));",args:[]});
    assert(storage.ok, JSON.stringify(storage)); evidence.storageFaults=storage.report;
  }
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.error = String(error);
  if (session) { try { await screenshot('failure'); } catch {} }
  process.exitCode = 1;
} finally {
  evidence.requests = fixture.requests;
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  if (session) { try { await wd(`/session/${session.sessionId}`, undefined, 'DELETE'); } catch {} }
  await stopApp('SIGTERM');
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  await fixture.close();
  console.log(JSON.stringify({ status: evidence.status, root, evidence: evidencePath, error: evidence.error }));
}
