// Root/native owner invokes explicitly after its current builds and gates finish.
// Importing for pure tests opens no sockets and launches no processes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenerPids, waitUntil } from '../../e2e/support/nativeTransport.mjs';
import { startInteractiveFixture } from './interactive-fixture.mjs';
import { startCrashFixture } from './crash-fixture.mjs';
import { prepareIosFixture } from './ios-fixture-config.mjs';
import { assertPublicationBoundary, publicationFaults } from './fault-gate.mjs';
import { captureOwnedIosProcess, parseIosProcess, ownedIosBundle } from './ios-process-suspension.mjs';

export const iosNativeFaultBoundaries = [...publicationFaults, 'prepared-review', 'transport-completed'];

export function createIosPublicationFaultControl(boundary, scope, { now = Date.now, nonce = randomUUID } = {}) {
  assert(iosNativeFaultBoundaries.includes(boundary), 'Unknown owned iOS publication boundary');
  assert(typeof scope === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(scope), 'Invalid generated iOS publication scope');
  let execute, acknowledgement;
  return {
    config: () => ({ gate: 'owned-ios-publication-fault-control', boundary, scope, ...(execute ? { execute } : {}) }),
    release() { assert(!execute, 'Crash command already issued'); execute = { nonce: nonce(), issuedAt: now() }; assert(execute.nonce.length >= 16, 'Invalid crash nonce'); return execute; },
    acknowledge(value) {
      assert(execute && value?.boundary === boundary && value.scope === scope && value.nonce === execute.nonce && value.issuedAt === execute.issuedAt,
        'Fresh exact owned iOS publication crash command required');
      assert(typeof value.launchId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(value.launchId), 'Invalid owned publication launch identity');
      assert(!acknowledgement, 'Crash command already acknowledged');
      acknowledgement = { ...value, acknowledgedAt: now() }; return acknowledgement;
    },
    receipt: () => acknowledgement,
  };
}

export function assertIosPublicationReports(first, recovered) {
  assert(first?.gate === 'ios-native-publication-fault' && recovered?.gate === first.gate, 'Missing actual iOS publication reports');
  assert(first.phase === 'ready-to-crash' && recovered.phase === 'recovered' && recovered.status === 'passed', 'iOS publication journey did not recover');
  assert(first.launchId !== recovered.launchId && recovered.state.firstLaunchId === first.launchId, 'Recovery reused the original launch');
  if (!publicationFaults.includes(first.state.boundary)) {
    for (const key of ['boundary', 'scope', 'conversationId', 'userContent']) assert.equal(recovered.state[key], first.state[key], `Retained iOS command crash ${key} changed`);
    assert(['error', 'cancelled'].includes(recovered.interrupted?.status), 'Native command crash did not restore retryable interruption');
    assert.equal(recovered.retried?.status, 'completed'); assert.notEqual(recovered.retried.id, recovered.interrupted.id, 'Retry erased the interrupted message');
    if (first.state.boundary === 'prepared-review') {
      assert.equal(recovered.pendingKept?.receipt.status, 'committed'); assert.deepEqual(recovered.pendingKept.receipt, recovered.pendingKept.duplicate);
      assert.equal(recovered.pendingKept.receipt.noteId, recovered.pendingKept.canonical.noteId);
      const kept = recovered.pendingKept;
      assert.deepEqual(kept.settled, kept.plan.acceptedDraft, 'Retried prepared Keep differs from independently predicted accepted version/hunks');
      assert.deepEqual(recovered.preparedPlan, kept.plan, 'Retried prepared Keep lacks retained pre-click mounted plan');
      assert.equal(kept.canonical.markdown, kept.plan.expectedEditorMarkdown, 'Retried prepared publication changed exact expected bytes');
      assert.equal(kept.receipt.committedMarkdown, kept.plan.expectedEditorMarkdown);
      assert.equal(kept.canonical.title, kept.plan.acceptedDraft.title); assert.equal(kept.canonical.path, kept.plan.acceptedDraft.path);
      assert.equal(kept.receipt.applied.path, kept.plan.acceptedDraft.path);
    } else assert.equal(recovered.interrupted.content, `Synthetic terminal partial PI_E2E_CRASH_${first.state.scope}.`);
    return;
  }
  for (const key of ['boundary', 'scope', 'conversationId', 'proposalId', 'reviewId', 'reviewedDraft', 'acceptedDraft', 'expectedEditorMarkdown', 'sourceMessageId', 'sourceContent'])
    assert.deepEqual(recovered.state[key], first.state[key], `Retained iOS publication ${key} changed`);
  assert.deepEqual(recovered.restoredDraft, first.state.acceptedDraft, 'Restart lost exact accepted draft');
  assert.deepEqual(recovered.receipt, recovered.duplicate, 'Duplicate Keep changed canonical receipt');
  assert.equal(recovered.receipt.status, 'committed');
  assert.equal(recovered.canonical.noteId, recovered.receipt.noteId);
  assert.equal(recovered.canonical.markdown, first.state.expectedEditorMarkdown);
}

export async function runIosPublicationFaultGate() {
  assert(!process.env.PI_PROTOTYPE_DATA, 'Publication fault gate allocates a fresh synthetic root; unset PI_PROTOTYPE_DATA');
  const simulator = process.env.PI_PROTOTYPE_SIMULATOR, app = resolve(process.env.PI_PROTOTYPE_IOS_APP ?? '');
  assert(simulator && process.env.PI_PROTOTYPE_IOS_APP && existsSync(app), 'Set the explicitly owned booted simulator and existing isolated expanded iOS diagnostic app');
  const fixtureConfig = prepareIosFixture(process.env, listenerPids), controlPort = fixtureConfig.port + 1;
  assert.equal(listenerPids(controlPort).length, 0, 'Publication control port has an unrelated owner; do not terminate it');
  const root = mkdtempSync(join(tmpdir(), 'gneauxghts-pi-ios-publication-')), evidencePath = join(root, 'ios-publication-fault-gate.json');
  const run = (command, args, env = {}, timeout) => {
    const result = spawnSync(command, args, { env: { ...process.env, ...env }, encoding: 'utf8', timeout });
    assert.equal(result.status, 0, `${command} failed: ${result.stderr}\n${result.stdout}`); return result.stdout.trim();
  };
  const info = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')]));
  assert.equal(info.CFBundleIdentifier, ownedIosBundle, 'Refuse installing another app bundle');
  const all = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '--json'])).devices;
  const selected = Object.entries(all).flatMap(([runtime, values]) => values.map(value => ({ ...value, runtime }))).find(value => value.udid === simulator);
  assert(selected?.isAvailable && selected.state === 'Booted', 'Explicit owned simulator must be available and already booted');
  const evidence = { gate: 'ios-native-publication-and-command-crashes', status: 'running', root, simulator: selected, app, fixtureUrl: fixtureConfig.url,
    executableSha256: createHash('sha256').update(readFileSync(join(app, info.CFBundleExecutable))).digest('hex'), cases: [],
    limits: ['Synthetic local-compatible publication faults on actual iOS WKWebView; no platform/protocol full cross-product is claimed.',
      'First Keep uses normal UI; explicit recovery Keep and duplicate Keep use the public API for already accepted hunks.',
      'Prepared-review and transport-completed require a diagnostic app built with PI_PROTOTYPE_IOS_CRASH_FIXTURES=true (e2e-chat-fixture); an older app fails these required cases.',
      'Physical-device, OS pressure, radio, live-provider and distribution behavior remain unverified.'] };
  let control, server, fixture, data; const retainedRequests = [];
  const flush = () => writeFileSync(evidencePath, JSON.stringify({ ...evidence, requests: [...retainedRequests, ...(fixture?.requests ?? [])] }, null, 2));
  try {
    server = createServer(async (request, response) => {
      response.setHeader('access-control-allow-origin', '*'); response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      response.setHeader('access-control-allow-headers', 'content-type'); response.setHeader('cache-control', 'no-store');
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      try {
        assert(control && !request.headers.authorization, 'Owned publication control is unavailable or received credentials');
        const url = new URL(request.url, `http://127.0.0.1:${controlPort}`); let result;
        if (request.method === 'GET' && url.pathname === '/pi-ios-publication/config') result = control.config();
        else if (request.method === 'POST' && url.pathname === '/pi-ios-publication/ack') {
          let body = ''; for await (const part of request) { body += part; assert(body.length <= 4096, 'Crash acknowledgement exceeds bound'); }
          result = control.acknowledge(JSON.parse(body));
        } else throw new Error('Unexpected publication control route');
        response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(result));
      } catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: String(error) })); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(controlPort, '127.0.0.1', resolve); });
    for (const boundary of iosNativeFaultBoundaries) {
      if (fixture) { await fixture.close(); retainedRequests.push(...fixture.requests); fixture = undefined; }
      const commandCrash = !publicationFaults.includes(boundary);
      fixture = commandCrash ? await startCrashFixture(fixtureConfig.port) : await startInteractiveFixture(fixtureConfig.port, { followons: false });
      const scope = randomUUID(); control = createIosPublicationFaultControl(boundary, scope);
      const item = { boundary, scope, status: 'running', screenshots: [] }; evidence.cases.push(item); flush();
      spawnSync('xcrun', ['simctl', 'terminate', simulator, ownedIosBundle]);
      spawnSync('xcrun', ['simctl', 'uninstall', simulator, ownedIosBundle]);
      run('xcrun', ['simctl', 'install', simulator, app]);
      data = run('xcrun', ['simctl', 'get_app_container', simulator, ownedIosBundle, 'data']);
      const installed = run('xcrun', ['simctl', 'get_app_container', simulator, ownedIosBundle, 'app']);
      const storage = join(data, 'Library/Application Support', ownedIosBundle), nativeRoot = join(storage, 'PROTOTYPE-wipe-me'), vault = join(data, 'Documents/PROTOTYPE-wipe-me'), reportPath = join(nativeRoot, 'ui-report.json');
      item.data = data; item.nativeRoot = nativeRoot; item.vault = vault;
      const inspect = pid => parseIosProcess(run('/bin/ps', ['-ww', '-p', String(pid), '-o', 'pid=,stat=,lstart=,comm='], { LC_ALL: 'C' }, 2000));
      const launch = (armCrash = false) => captureOwnedIosProcess({ bundle: ownedIosBundle, installedExecutable: join(installed, info.CFBundleExecutable), inspect,
        launchOutput: run('xcrun', ['simctl', 'launch', simulator, ownedIosBundle], { ...fixtureConfig.launchEnv,
          SIMCTL_CHILD_PI_PROTOTYPE_INTERACTIVE_GATE: 'true', SIMCTL_CHILD_PI_PROTOTYPE_EXPANDED_GATE: 'true', SIMCTL_CHILD_PI_PROTOTYPE_FOLLOWONS_GATE: 'false',
          SIMCTL_CHILD_PI_PROTOTYPE_IOS_PUBLICATION_FAULT_GATE: 'true',
          SIMCTL_CHILD_PI_PROTOTYPE_E2E_CRASH_BOUNDARY: armCrash ? boundary : '', SIMCTL_CHILD_PI_PROTOTYPE_E2E_CRASH_SCOPE: armCrash ? scope : '' }) });
      const phase = (name, prior) => waitUntil(() => {
        try {
          const report = JSON.parse(readFileSync(reportPath, 'utf8'));
          if (report.gate !== 'ios-native-publication-fault' || report.scope !== scope || report.launchId === prior) return false;
          assert(report.status !== 'failed', report.error ?? 'iOS publication probe failed'); return report.phase === name && report;
        } catch (error) { if (error instanceof assert.AssertionError) throw error; return false; }
      }, `actual iOS ${boundary} ${name}`, 120000);
      const snapshot = proposalId => JSON.parse(run('python3', ['-B', 'scripts/pi-prototype/publication-fault-proof.py', storage, proposalId, '--ios-vault', vault]));
      const screenshot = label => { const path = join(root, `${boundary}-${label}.png`); run('xcrun', ['simctl', 'io', simulator, 'screenshot', path]); item.screenshots.push(path); };
      item.requestsBeforeFirst = fixture.requests.length; item.owner = launch(commandCrash);
      item.first = await phase('ready-to-crash'); screenshot('before-crash'); item.requestsBeforeCrash = fixture.requests.length; flush();
      assert.equal(item.requestsBeforeCrash - item.requestsBeforeFirst, commandCrash ? 0 : 2, 'Unexpected provider work before the first native crash command');
      item.command = control.release(); flush();
      if (boundary === 'transport-completed') {
        item.partialReady = await phase('partial-ready');
        assert.equal(fixture.requests.length, 1, 'Terminal crash barrier requires one admitted provider request');
        assert.equal(item.partialReady.partial.content, `Synthetic terminal partial PI_E2E_CRASH_${scope}.`);
        fixture.release(scope); flush();
      }
      await waitUntil(() => {
        const result = spawnSync('/bin/ps', ['-ww', '-p', String(item.owner.pid), '-o', 'pid=,stat=,lstart=,comm='], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8', timeout: 2000 });
        if (result.status === 1 && !result.stdout.trim()) return true;
        assert.equal(result.status, 0, 'Cannot inspect exact owned crashing iOS process');
        const current = parseIosProcess(result.stdout);
        assert.equal(current.startedAt, item.owner.startedAt, 'Owned crash PID was reused'); assert.equal(current.executable, item.owner.executable, 'Owned crash executable changed');
        return false;
      }, `exact owned native ${boundary} crash`, 30000);
      item.acknowledgement = control.receipt(); assert.equal(item.acknowledgement?.launchId, item.first.launchId, 'Crash command was not acknowledged by the first UI launch');
      if (commandCrash) {
        item.nativeCrash = JSON.parse(readFileSync(join(nativeRoot, `e2e-crash-${boundary}.json`), 'utf8'));
        assert.equal(item.nativeCrash.pid, item.owner.pid); assert.equal(item.nativeCrash.boundary, boundary); assert.equal(item.nativeCrash.scope, scope);
        assert.equal(boundary === 'prepared-review' ? item.nativeCrash.detail.toolReplyDelivered : item.nativeCrash.detail.terminalDelivered, false);
        item.requestsBeforeRelaunch = fixture.requests.length; assert.equal(item.requestsBeforeRelaunch, 1, 'Native command crash did not admit exactly one provider request');
      } else item.before = snapshot(item.first.state.proposalId);
      flush();
      item.relaunchOwner = launch(); assert.notEqual(item.relaunchOwner.pid, item.owner.pid, 'Publication recovery did not relaunch the native app');
      item.recovered = await phase('recovered', item.first.launchId); assertIosPublicationReports(item.first, item.recovered);
      if (commandCrash) {
        assert.equal(fixture.requests.length, boundary === 'prepared-review' ? 3 : 2, 'Native command crash requires exactly the explicit Retry and expected tool continuation');
        const user = record => (record.body.messages ?? record.body.input).findLast(value => value.role === 'user');
        assert.deepEqual(user(fixture.requests[0]), user(fixture.requests[1]), 'Explicit native-crash Retry changed original admitted provider input');
        assert.equal(fixture.requests[0].model, fixture.requests[1].model, 'Explicit native-crash Retry changed admitted model');
      } else assert.equal(fixture.requests.length, item.requestsBeforeCrash, 'Crash relaunch, recovery Keep or duplicate Keep replayed inference');
      screenshot('recovered'); run('xcrun', ['simctl', 'terminate', simulator, ownedIosBundle]);
      if (boundary !== 'transport-completed') {
      item.after = snapshot(commandCrash ? item.recovered.pendingKept.proposalId : item.first.state.proposalId);
      if (!commandCrash) assertPublicationBoundary(boundary, item.before, item.after);
      else assert(item.after.receipt && item.after.publications === 1 && item.after.canonicalSha256, 'Retried prepared tool outcome lacks exactly one durable publication');
      const notes = readdirSync(vault, { recursive: true, withFileTypes: true }).filter(value => value.isFile() && value.name.endsWith('.md'));
      const identityLine = `  id: ${item.after.note_id}`;
      const canonicalFiles = notes.filter(value => readFileSync(join(value.parentPath ?? value.path, value.name), 'utf8').split('\n').includes(identityLine));
      assert.equal(canonicalFiles.length, 1, 'Publication recovery duplicated canonical Note Identity');
      item.singlePublicationProof = { effectRows: 1, canonicalFilesWithIdentity: canonicalFiles.length, noteTimelinePublicationReceipts: item.after.publications };
      }
      item.retainedNative = join(root, boundary, 'PROTOTYPE-wipe-me'); mkdirSync(join(root, boundary), { recursive: true }); cpSync(nativeRoot, item.retainedNative, { recursive: true });
      item.retainedVault = join(root, boundary, 'vault'); cpSync(vault, item.retainedVault, { recursive: true });
      item.status = 'passed'; flush();
    }
    assert(![...retainedRequests, ...fixture.requests].some(value => value.error), 'Synthetic publication fixture failed'); evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); process.exitCode = 1; }
  finally {
    if (data) spawnSync('xcrun', ['simctl', 'terminate', simulator, ownedIosBundle]);
    flush(); await fixture?.close();
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    console.log(JSON.stringify({ status: evidence.status, root, evidence: evidencePath, error: evidence.error }));
  }
  return evidence;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runIosPublicationFaultGate();
