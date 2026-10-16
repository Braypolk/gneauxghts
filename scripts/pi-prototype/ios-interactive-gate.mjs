// Actual iOS WKWebView observation; never run as part of the pure test suite.
// Build dispatch remains in run.mjs, preserving its Xcode SDK/runtime workaround.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { waitUntil, listenerPids } from '../../e2e/support/nativeTransport.mjs';
import { startInteractiveFixture } from './interactive-fixture.mjs';
import { assertExpandedPhase, assertInteractiveTransport } from './expanded-report.mjs';
import { verifyFollowonsReceipts } from './followons-fixture.mjs';

const followons = process.env.PI_PROTOTYPE_FOLLOWONS_GATE === 'true';
assert(!process.env.PI_PROTOTYPE_DATA, 'Allocate a fresh synthetic root; unset PI_PROTOTYPE_DATA');
const simulator = process.env.PI_PROTOTYPE_SIMULATOR;
assert(simulator, 'Set PI_PROTOTYPE_SIMULATOR to the explicitly owned, already booted disposable simulator');
assert.equal(listenerPids(1443).length, 0, 'Fixture port 1443 has an unrelated owner; do not terminate it');
const bundle = 'com.braypolkinghorne.gneauxghts.pi-prototype';
const root = mkdtempSync(join(tmpdir(), 'gneauxghts-pi-ios-interactive-'));
const evidencePath = join(root, 'ios-interactive-gate.json');
const run = (command, args, extra = {}) => {
  const result = spawnSync(command, args, { env: { ...process.env, ...extra }, encoding: 'utf8' });
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
const evidence = { gate: 'ios-shared-workspace-fixture', status: 'running', root, app, simulator: selected, bundle,
  executableSha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
  constraints: { xcode: run('xcodebuild', ['-version']), simulatorSdk: run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']),
    runtime: selected.runtime, rustBuild: 'run.mjs exact pi-prototype,tauri/custom-protocol; existing generated Rust script replacement',
    background: 'Preferences foregrounding only; does not establish OS suspension or physical-device pressure',
    originNavigation: 'shared Open in chat fixture synthesizes editor keyboard navigation; touch gesture remains unverified' },
  phases: [], screenshots: [], unobserved: [] };
let fixture, data, first;
const flush = () => writeFileSync(evidencePath, JSON.stringify({ ...evidence, requests: fixture?.requests ?? [] }, null, 2));
try {
  fixture = await startInteractiveFixture(1443, { followons });
  spawnSync('xcrun', ['simctl', 'terminate', simulator, bundle]);
  spawnSync('xcrun', ['simctl', 'uninstall', simulator, bundle]);
  run('xcrun', ['simctl', 'install', simulator, app]);
  data = run('xcrun', ['simctl', 'get_app_container', simulator, bundle, 'data']); evidence.data = data;
  const reportPath = join(data, 'Library/Application Support', bundle, 'PROTOTYPE-wipe-me/ui-report.json');
  const launch = () => run('xcrun', ['simctl', 'launch', simulator, bundle], {
    SIMCTL_CHILD_PI_PROTOTYPE_HTTP_FIXTURE: 'http://127.0.0.1:1443',
    SIMCTL_CHILD_PI_PROTOTYPE_INTERACTIVE_GATE: 'true', SIMCTL_CHILD_PI_PROTOTYPE_EXPANDED_GATE: 'true',
    SIMCTL_CHILD_PI_PROTOTYPE_FOLLOWONS_GATE: String(followons) });
  const phase = (name, prior) => waitUntil(() => {
    try { const report = JSON.parse(readFileSync(reportPath, 'utf8')); return report.gate === 'expanded-native-workspace-fixture'
      && (report.phase === name || (report.phase === 'starting' && report.status === 'failed')) && report.launchId !== prior && ['passed', 'failed'].includes(report.status) && report; } catch { return false; }
  }, `actual normal iOS WKWebView ${name}`, followons ? 600000 : 240000);
  const screenshot = name => { const path = join(root, `${name}.png`); run('xcrun', ['simctl', 'io', simulator, 'screenshot', path]); evidence.screenshots.push(path); };
  launch(); first = assertExpandedPhase(await phase('first'), 'first'); evidence.phases.push(first); flush(); screenshot('first');
  const interruptedCount = fixture.requests.filter(value => value.journey === 'INTERRUPT').length;
  assert.equal(interruptedCount, 1, 'No single active interrupted native request');
  run('xcrun', ['simctl', 'launch', simulator, 'com.apple.Preferences']); await delay(750); launch(); await delay(750);
  assert.equal(JSON.parse(readFileSync(reportPath, 'utf8')).launchId, first.launchId, 'Foreground reran the journey');
  assert.equal(fixture.requests.filter(value => value.journey === 'INTERRUPT').length, interruptedCount, 'Foreground replayed inference');
  evidence.backgroundForeground = { sameLaunch: true, noReplay: true }; screenshot('foreground');
  run('xcrun', ['simctl', 'terminate', simulator, bundle]);
  const beforeRelaunch = fixture.requests.length;
  // Relaunch probe itself performs explicit UI Retry only after verifying the retained partial.
  // Request time is compared with the reported UI retry click, rather than a fixed launch sleep.
  launch(); const restored = assertExpandedPhase(await phase('relaunch', first.launchId), 'relaunch', first.launchId);
  evidence.phases.push(restored); evidence.unobserved = restored.unobserved; screenshot('relaunch');
  const retry = fixture.requests.find(value => value.journey === 'INTERRUPT' && value.attempt === 2);
  const shared = restored.shared.find(value => value.phase === 'relaunch');
  assert(shared.checks.includes('relaunch restores committed history, model and interrupted partial without replay'));
  assert(retry, 'Explicit UI Retry was not observed');
  // The shared relaunch assertion precedes its only provider request. All provider
  // observations before that request must match the terminated process count.
  const beforeRetry = fixture.requests.findIndex(value => value === retry);
  evidence.transport = assertInteractiveTransport(fixture.requests, beforeRelaunch, beforeRetry);
  if (followons) evidence.followons = verifyFollowonsReceipts(fixture.requests, restored.followons);
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
  console.log(JSON.stringify({ status: evidence.status, root, evidence: evidencePath, error: evidence.error }));
}
