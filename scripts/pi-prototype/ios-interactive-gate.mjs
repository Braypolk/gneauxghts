// Actual iOS WKWebView observation; never run as part of the pure test suite.
// Build dispatch remains in run.mjs, preserving its Xcode SDK/runtime workaround.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { waitUntil, listenerPids } from '../../e2e/support/nativeTransport.mjs';
import { startInteractiveFixture } from './interactive-fixture.mjs';
import { prepareIosFixture } from './ios-fixture-config.mjs';
import { assertInteractiveTransport } from './expanded-report.mjs';
import { retainExpandedPhase } from './retain-expanded-phase.mjs';
import { verifyFollowonsReceipts } from './followons-fixture.mjs';
import { verifySupplementalEvidenceReceipts } from './supplemental-evidence-fixture.mjs';
import { verifySupplementalReviewReceipts } from './supplemental-review-fixture.mjs';
import { captureOwnedIosProcess, assertOwnedIosProcess, parseOwnedIosLaunch, parseIosProcess, suspendOwnedIosProcess, createIosSuspensionChallenges } from './ios-process-suspension.mjs';

const followons = process.env.PI_PROTOTYPE_FOLLOWONS_GATE === 'true';
const fixtureConfig = prepareIosFixture(process.env, listenerPids);
const controlPort = fixtureConfig.port + 1;
if (followons) assert.equal(listenerPids(controlPort).length, 0, `Suspension control port ${controlPort} has an unrelated owner; do not terminate it`);
const challenges = createIosSuspensionChallenges();
assert(!process.env.PI_PROTOTYPE_DATA, 'Allocate a fresh synthetic root; unset PI_PROTOTYPE_DATA');
const simulator = process.env.PI_PROTOTYPE_SIMULATOR;
assert(simulator, 'Set PI_PROTOTYPE_SIMULATOR to the explicitly owned, already booted disposable simulator');
const bundle = 'com.braypolkinghorne.gneauxghts.pi-prototype';
const root = mkdtempSync(join(tmpdir(), 'gneauxghts-pi-ios-interactive-'));
const evidencePath = join(root, 'ios-interactive-gate.json');
const run = (command, args, extra = {}, timeout) => {
  const result = spawnSync(command, args, { env: { ...process.env, ...extra }, encoding: 'utf8', timeout });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
};
const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '--json'])).devices;
const selected = Object.entries(devices).flatMap(([runtime, values]) => values.map(device => ({ ...device, runtime }))).find(device => device.udid === simulator);
assert(selected?.isAvailable && selected.state === 'Booted', 'Explicit simulator must already be available and booted');
if (!process.env.PI_PROTOTYPE_IOS_APP) {
  // Root entry must embed /?piExpandedTest=1 while retaining the normal workspace.
  const built = spawnSync(process.execPath, ['scripts/pi-prototype/run.mjs', 'ios'], { stdio: 'inherit', env: { ...process.env,
    PI_PROTOTYPE_DATA: root, PI_PROTOTYPE_DIAGNOSTICS: 'true', PI_PROTOTYPE_EXPANDED_GATE: 'true', PI_PROTOTYPE_FOLLOWONS_GATE: String(followons) } });
  assert.equal(built.status, 0, 'Expanded normal-workspace iOS build failed');
}
const app = resolve(process.env.PI_PROTOTYPE_IOS_APP ?? join(root, 'xcode/Build/Products/debug-iphonesimulator/Gneauxghts Pi Prototype.app'));
assert(existsSync(app), 'Missing isolated simulator app');
const info = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')]));
assert.equal(info.CFBundleIdentifier, bundle, 'Refuse installing another app bundle');
const executable = join(app, info.CFBundleExecutable);
const evidence = { gate: 'ios-shared-workspace-fixture', status: 'running', root, app, simulator: selected, bundle, fixtureUrl: fixtureConfig.url,
  executableSha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
  constraints: { xcode: run('xcodebuild', ['-version']), simulatorSdk: run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']),
    runtime: selected.runtime, rustBuild: 'Executable hash is observed here; exact Cargo features are supplied by the separate compiler receipt. run.mjs retains the generated Rust script replacement.',
    background: 'Preferences foregrounding plus artificial STOP/CONT of the exact owned native app process; WKWebView helpers may continue. Does not establish OS suspension or memory pressure.',
    originNavigation: 'shared Open in chat fixture synthesizes editor keyboard navigation; touch gesture remains unverified' },
  phases: [], screenshots: [], unobserved: [] };
let fixture, data, first, controlServer;
const flush = () => writeFileSync(evidencePath, JSON.stringify({ ...evidence, requests: fixture?.requests ?? [] }, null, 2));
try {
  if (followons) {
  controlServer = createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type');
    response.setHeader('cache-control', 'no-store');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    try {
      assert(!request.headers.authorization, 'Suspension control must not receive credentials');
      const url = new URL(request.url, `http://127.0.0.1:${controlPort}`);
      let value;
      if (request.method === 'GET' && url.pathname === '/pi-suspension/discover') value = challenges.discover(url.searchParams.get('launchId'));
      else if (request.method === 'GET' && url.pathname === '/pi-suspension/command') value = challenges.read(url.searchParams.get('stage'), url.searchParams.get('launchId'));
      else if (request.method === 'POST' && url.pathname === '/pi-suspension/ack') {
        let body = ''; for await (const chunk of request) { body += chunk; assert(body.length <= 4096, 'Suspension acknowledgement exceeds bound'); }
        value = challenges.acknowledge(JSON.parse(body));
      } else throw new Error('Unexpected suspension control route');
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(value));
    } catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: String(error) })); }
  });
  await new Promise((resolve, reject) => { controlServer.once('error', reject); controlServer.listen(controlPort, '127.0.0.1', resolve); });
  }
  fixture = await startInteractiveFixture(fixtureConfig.port, { followons });
  spawnSync('xcrun', ['simctl', 'terminate', simulator, bundle]);
  spawnSync('xcrun', ['simctl', 'uninstall', simulator, bundle]);
  run('xcrun', ['simctl', 'install', simulator, app]);
  data = run('xcrun', ['simctl', 'get_app_container', simulator, bundle, 'data']); evidence.data = data;
  const installedApp = run('xcrun', ['simctl', 'get_app_container', simulator, bundle, 'app']);
  const installedExecutable = join(installedApp, info.CFBundleExecutable);
  const inspect = pid => parseIosProcess(run('/bin/ps', ['-ww', '-p', String(pid), '-o', 'pid=,stat=,lstart=,comm='], { LC_ALL: 'C' }, 2000));
  const reportPath = join(data, 'Library/Application Support', bundle, 'PROTOTYPE-wipe-me/ui-report.json');
  const launch = () => run('xcrun', ['simctl', 'launch', simulator, bundle], {
    ...fixtureConfig.launchEnv,
    SIMCTL_CHILD_PI_PROTOTYPE_INTERACTIVE_GATE: 'true', SIMCTL_CHILD_PI_PROTOTYPE_EXPANDED_GATE: 'true',
    SIMCTL_CHILD_PI_PROTOTYPE_FOLLOWONS_GATE: String(followons) });
  const phase = (name, prior) => waitUntil(() => {
    try { const report = JSON.parse(readFileSync(reportPath, 'utf8')); return report.gate === 'expanded-native-workspace-fixture'
      && (report.phase === name || (report.phase === 'starting' && report.status === 'failed')) && report.launchId !== prior && ['passed', 'failed'].includes(report.status) && report; } catch { return false; }
  }, `actual normal iOS WKWebView ${name}`, followons ? 600000 : 240000);
  const screenshot = name => { const path = join(root, `${name}.png`); run('xcrun', ['simctl', 'io', simulator, 'screenshot', path]); evidence.screenshots.push(path); };
  const suspensionPhase = statuses => waitUntil(() => {
    try {
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      assert(report.status !== 'failed', report.error ?? 'Supplemental iOS suspension probe failed');
      return report.launchId === first.launchId && statuses.includes(report.supplementalSuspension?.status) && report.supplementalSuspension;
    } catch (error) { if (error instanceof assert.AssertionError) throw error; return false; }
  }, `fresh iOS suspension ${statuses.join('/')}`, 60000);
  const owner = captureOwnedIosProcess({ launchOutput: launch(), bundle, installedExecutable, inspect });
  evidence.ownedLaunch = owner; flush();
  first = await retainExpandedPhase({ report: await phase('first'), phase: 'first', evidence, flush, screenshot });
  if (followons) { evidence.supplementalSuspensionBaseline = await suspensionPhase(['ready']); flush(); }
  const interruptedCount = fixture.requests.filter(value => value.journey === 'INTERRUPT').length;
  assert.equal(interruptedCount, 1, 'No single active interrupted native request');
  const beforeSuspensionRequests = fixture.requests.length;
  run('xcrun', ['simctl', 'launch', simulator, 'com.apple.Preferences']); await delay(750);
  evidence.nativeProcessSuspension = {}; flush();
  await suspendOwnedIosProcess({ owner, inspect, wait: delay, receipt: evidence.nativeProcessSuspension,
    signal: (pid, signal) => run('/bin/kill', [`-${signal}`, String(pid)], {}, 2000) });
  await waitUntil(() => !assertOwnedIosProcess(owner, inspect).state.includes('T'), 'owned native process continues after STOP', 2000);
  assert.equal(parseOwnedIosLaunch(launch()), owner.pid, 'Foreground replaced the owned app process'); await delay(750);
  assertOwnedIosProcess(owner, inspect);
  if (followons) {
  const foregroundCommand = challenges.issue('foreground', first.launchId);
  const foreground = await suspensionPhase(['foreground-passed', 'lease-ready', 'passed']);
  assert.equal(foreground.foregroundCommand.nonce, foregroundCommand.nonce, 'Foreground report did not acknowledge the post-CONT challenge');
  assert(foreground.freshReadAt >= foregroundCommand.issuedAt, 'UI snapshot predates foreground challenge');
  assert(challenges.receipt('foreground'), 'Fresh UI request acknowledgement was not observed by the owned control server');
  evidence.foregroundUi = foreground;
  assert.equal(fixture.requests.length, beforeSuspensionRequests, 'Suspension/foreground dispatched an extra provider request');
  assert.equal(fixture.requests.filter(value => value.journey === 'INTERRUPT').length, interruptedCount, 'Foreground replayed inference');
  evidence.backgroundForeground = { sameLaunch: true, sameNativeProcessIdentity: true, noReplay: true, staticRetainedPhase: false,
    freshPostContinueUiRead: true, durablePartialAndReviewVerifiedByFollowingRelaunch: false }; flush(); screenshot('foreground');
  const leaseReady = await suspensionPhase(['lease-ready']);
  assert(leaseReady.armed.owner > 0 && leaseReady.armed.transaction > 0 && leaseReady.armed.uncommittedRows === 1, 'No actual uncommitted native transaction is armed');
  evidence.nativeLeaseSuspension = {}; flush();
  const leaseStopRequestedAt = Date.now();
  const armedToStopMs = leaseStopRequestedAt - leaseReady.armed.armedAt;
  assert(armedToStopMs >= 0 && armedToStopMs <= 5000, 'Native lease must still be active with five seconds of its ten-second TTL remaining before STOP');
  evidence.nativeLeaseSuspension.armedToStopMs = armedToStopMs;
  await suspendOwnedIosProcess({ owner, inspect, wait: delay, receipt: evidence.nativeLeaseSuspension,
    signal: (pid, signal) => run('/bin/kill', [`-${signal}`, String(pid)], {}, 2000) });
  await waitUntil(() => !assertOwnedIosProcess(owner, inspect).state.includes('T'), 'owned native lease process continues after STOP', 2000);
  assert.equal(parseOwnedIosLaunch(launch()), owner.pid, 'Lease foreground replaced the owned app process');
  const leaseCommand = challenges.issue('lease-continue', first.launchId);
  const suspension = await suspensionPhase(['passed']);
  assert.equal(suspension.leaseCommand.nonce, leaseCommand.nonce, 'Suspended transaction did not acknowledge the fresh post-CONT challenge');
  assert(challenges.receipt('lease-continue'), 'Fresh lease challenge acknowledgement was not observed');
  assert.equal(suspension.lease.rejectedDurableRows, 0); assert.equal(suspension.lease.freshOwnerRows, 1);
  assert(suspension.lease.armedAt <= leaseStopRequestedAt && suspension.lease.rejectedAt >= leaseCommand.issuedAt,
    'Native transaction did not span the owned STOP-to-CONT interval');
  evidence.nativeLeaseSuspension.stopRequestedAtMillis = leaseStopRequestedAt;
  evidence.supplementalSuspension = suspension;
  assert.equal(fixture.requests.length, beforeSuspensionRequests, 'Suspension lease/foreground dispatched an extra provider request');
  flush();
  } else {
    const retainedFirst = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.deepEqual(retainedFirst, first, 'Static acknowledged first-phase report changed across suspension');
    assert.equal(fixture.requests.length, beforeSuspensionRequests, 'Suspension/foreground dispatched an extra provider request');
    evidence.backgroundForeground = { sameLaunch: true, sameNativeProcessIdentity: true, noReplay: true, staticRetainedPhase: true,
      freshPostContinueUiRead: false, durablePartialAndReviewVerifiedByFollowingRelaunch: false };
    flush(); screenshot('foreground');
  }
  run('xcrun', ['simctl', 'terminate', simulator, bundle]);
  const beforeRelaunch = fixture.requests.length;
  // Relaunch probe itself performs explicit UI Retry only after verifying the retained partial.
  // Request time is compared with the reported UI retry click, rather than a fixed launch sleep.
  launch(); const restored = await retainExpandedPhase({ report: await phase('relaunch', first.launchId), phase: 'relaunch', priorLaunchId: first.launchId, evidence, flush, screenshot });
  evidence.unobserved = restored.unobserved;
  const retry = fixture.requests.find(value => value.journey === 'INTERRUPT' && value.attempt === 2);
  const shared = restored.shared.find(value => value.phase === 'relaunch');
  if (followons) {
    assert.equal(restored.supplementalSuspensionRelaunch?.status, 'passed', 'Following relaunch lacks exact supplemental state verification');
    assert.equal(restored.supplementalSuspensionRelaunch.priorLaunchId, first.launchId, 'Following relaunch verified a different suspension baseline');
  }
  assert(shared.checks.includes('relaunch restores committed history, model and interrupted partial without replay'));
  assert(shared.checks.includes('relaunch edited review Keep and Discard; duplicate Keep returns canonical receipt'));
  evidence.backgroundForeground.durablePartialAndReviewVerifiedByFollowingRelaunch = true;
  assert(retry, 'Explicit UI Retry was not observed');
  // The shared relaunch assertion precedes its only provider request. All provider
  // observations before that request must match the terminated process count.
  const beforeRetry = fixture.requests.findIndex(value => value === retry);
  evidence.transport = assertInteractiveTransport(fixture.requests, beforeRelaunch, beforeRetry);
  if (followons) {
  evidence.followons = verifyFollowonsReceipts(fixture.requests, restored.followons);
  evidence.supplementalEvidence = verifySupplementalEvidenceReceipts(fixture.requests, restored.supplementalEvidence);
  const reviewState = first.shared.find(value => value.phase === 'first')?.receipts.supplementalReview;
  assert(reviewState && restored.supplementalSuspensionRelaunch, 'Exact first/relaunch supplemental review evidence is missing');
  evidence.supplementalReview = verifySupplementalReviewReceipts(fixture.requests, reviewState);
  assert.equal(evidence.supplementalReview.requestCount, 3, 'Supplemental refinement requires exactly read, refine and final native requests');
  const restoredReview = restored.shared.find(value => value.phase === 'relaunch')?.receipts.supplementalReviewRestored;
  assert.equal(restoredReview?.reviewId, reviewState.reviewId, 'Relaunch restored another pending review');
  assert.deepEqual(restoredReview?.draft, reviewState.retainedDraft, 'Relaunch changed the exact supplemental acknowledged version/body/title/location/hunks');
  const refinementRequests = fixture.requests.filter(record => record.journey === 'SUPPLEMENTAL_REVIEW_REFINE');
  assert.equal(refinementRequests.length, 3, 'Unexpected supplemental refinement provider work');
  assert(refinementRequests.every(record => record.completed) && refinementRequests[0].tool === 'read_note_proposal'
    && refinementRequests[1].tool === 'refine_note_proposal' && refinementRequests[2].tool === null, 'Supplemental refinement native request chain differs');
  }
  // Stop the app before taking consistent read-only snapshots and canonical bytes.
  run('xcrun', ['simctl', 'terminate', simulator, bundle]);
  const nativeRoot = join(data, 'Library/Application Support', bundle, 'PROTOTYPE-wipe-me');
  evidence.nativeRoot = nativeRoot; flush();
  run('python3', ['-B', 'scripts/pi-prototype/verify-workspace-effects.py', evidencePath, nativeRoot]);
  evidence.publicationProof = JSON.parse(readFileSync(evidencePath, 'utf8')).publicationProof;
  evidence.retainedPublicationDatabase = join(root, 'retained-native');
  evidence.status = 'passed'; evidence.ticket12Status = 'incomplete: shared iOS fixture observed; expanded/live matrix remains required';
} catch (error) { evidence.status = 'failed'; evidence.error = String(error); process.exitCode = 1; }
finally {
  if (data) spawnSync('xcrun', ['simctl', 'terminate', simulator, bundle]);
  flush(); await fixture?.close();
  if (controlServer?.listening) await new Promise(resolve => { controlServer.close(resolve); controlServer.closeAllConnections(); });
  console.log(JSON.stringify({ status: evidence.status, root, evidence: evidencePath, error: evidence.error }));
}
