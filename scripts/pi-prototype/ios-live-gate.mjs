// Prepared driver: only the native/build owner executes this against its explicitly
// owned simulator. This module is inert when imported by focused contract tests.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenerPids, waitUntil } from '../../e2e/support/nativeTransport.mjs';

export const LIVE = Object.freeze({ upstream: 'http://100.117.20.29:1234/v1', model: 'qwen3.8-27b-gsq-rco', endpoint: 'http://127.0.0.1:1444/v1', port: 1444, requestBytes: 1_048_576, responseBytes: 16_777_216, requestMs: 120000, maxPosts: 12 });
export function liveProxyRoute(method, path, body, posts) {
  assert(!path.includes('?') && !path.includes('#'), 'Unexpected live proxy query');
  if (method === 'GET' && ['/v1/models', '/api/v1/models'].includes(path)) {
    assert.equal(body.length, 0, 'Metadata GET body rejected'); return { path, inference: false };
  }
  assert.equal(method, 'POST', 'Only model metadata and inference are allowed');
  assert.equal(path, '/v1/chat/completions', 'Unexpected inference path');
  assert(body.length > 0 && body.length <= LIVE.requestBytes, 'Live request exceeds bounded size');
  assert(posts < LIVE.maxPosts, 'Live inference request budget exhausted');
  const parsed = JSON.parse(body.toString('utf8'));
  assert.equal(parsed.model, LIVE.model, 'Live proxy model allowlist mismatch');
  assert.equal(parsed.stream, true, 'Only real streaming inference is allowed');
  return { path, inference: true, model: parsed.model };
}
/** Pass-through only: never fabricates model output or persists bodies/headers. */
export async function startLiveLocalProxy() {
  const requests = [], sockets = new Set(), upstream = new URL(LIVE.upstream);
  let posts = 0;
  const server = createServer((req, res) => {
    const chunks = []; let bytes = 0, rejected = false;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > LIVE.requestBytes) { rejected = true; res.writeHead(413).end(); req.destroy(); }
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      let route;
      try { route = liveProxyRoute(req.method, req.url, Buffer.concat(chunks), posts); }
      catch { requests.push({ method: req.method, path: 'outside-live-allowlist', rejected: true }); res.writeHead(400).end('Rejected live gate request'); return; }
      if (route.inference) posts++;
      const observation = { method: req.method, path: route.path, model: route.model, inference: route.inference, bytes, atMillis: Date.now(), responseBytes: 0 };
      requests.push(observation);
      const outgoing = httpRequest({ hostname: upstream.hostname, port: upstream.port, path: route.path, method: req.method,
        // Deliberately omit Authorization, cookies and all incoming headers.
        headers: { 'content-type': 'application/json', accept: route.inference ? 'text/event-stream' : 'application/json', 'content-length': bytes } }, incoming => {
        observation.upstreamStatus = incoming.statusCode;
        res.writeHead(incoming.statusCode, { 'content-type': incoming.headers['content-type'] ?? 'application/octet-stream' });
        incoming.on('data', chunk => {
          observation.responseBytes += chunk.length;
          if (observation.responseBytes > LIVE.responseBytes) { observation.failure = 'response-byte-budget'; outgoing.destroy(); res.destroy(); }
        });
        incoming.on('end', () => { observation.completed = true; observation.durationMs = Date.now() - observation.atMillis; clearTimeout(deadline); });
        incoming.on('error', () => { observation.failure = 'upstream-stream'; clearTimeout(deadline); res.destroy(); });
        incoming.pipe(res);
      });
      const deadline = setTimeout(() => { observation.failure = 'request-deadline'; outgoing.destroy(); res.destroy(); }, LIVE.requestMs);
      outgoing.on('error', () => { observation.failure ??= 'upstream-connection'; clearTimeout(deadline); if (!res.headersSent) res.writeHead(502).end('Live local upstream failed'); else res.destroy(); });
      res.on('close', () => { if (!observation.completed) { observation.failure ??= 'client-disconnected'; outgoing.destroy(); } clearTimeout(deadline); });
      outgoing.end(Buffer.concat(chunks));
    });
  });
  server.requestTimeout = 15000;
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(LIVE.port, '127.0.0.1', resolve); });
  return { requests, postCount: () => posts, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
export function assertIosLiveReport(report, phase, previousLaunch) {
  assert.equal(report?.gate, 'ios-local-live'); assert.notEqual(report.status, 'failed', report.error);
  assert.equal(report.phase, phase); if (previousLaunch) assert.notEqual(report.launchId, previousLaunch, 'Probe did not receive a fresh WKWebView launch');
  assert.deepEqual(report.receipts?.routing, { upstream: LIVE.upstream, endpoint: LIVE.endpoint, model: LIVE.model });
  return report;
}
export function assertLiveNoReplay(before, after, reason) { assert.equal(after, before, `${reason} dispatched inference without normal Send`); }
export function assertLivePublicationEvidence(receipt, reviewed) {
  assert.equal(receipt.proposalId, reviewed.proposalId); assert.equal(receipt.reviewId, reviewed.reviewId);
  assert.equal(receipt.version, reviewed.draftVersion, 'Keep version differs from independently acknowledged review');
  assert.equal(receipt.path, reviewed.reviewedPath); assert.equal(receipt.expectedSha256, reviewed.reviewedSha256, 'Pre-Keep reviewed content changed across launch');
  assert.deepEqual(receipt.canonical, { noteId: receipt.noteId, title: reviewed.reviewedTitle, path: reviewed.reviewedPath, editorSha256: reviewed.reviewedSha256 }, 'Canonical read_note projection differs from independently acknowledged review');
}
export function assertLiveEffect(snapshot, receipt, reviewed, vault) {
  assertLivePublicationEvidence(receipt, reviewed);
  assert.equal(snapshot.effects.length, 1, 'Expected exactly one synthetic Save/Keep native effect');
  const effect = snapshot.effects[0];
  assert.equal(effect.id, `${receipt.proposalId}:${receipt.version}`); assert.equal(effect.note_id, receipt.noteId);
  assert.equal(effect.publications, 1, 'Duplicate Keep added a publication');
  assert(effect.receipt && effect.proof === null, 'Keep must have a settled receipt with no unresolved publication proof');
  for (const key of ['payload_hash', 'intended_hash', 'canonicalSha256']) assert.match(effect[key], /^[a-f0-9]{64}$/, `Missing native ${key}`);
  const nativeReceipt = JSON.parse(effect.receipt);
  assert.equal(nativeReceipt.status, 'committed'); assert.equal(nativeReceipt.noteId, receipt.noteId); assert.equal(nativeReceipt.applied?.path, receipt.path);
  assert.equal(effect.target_path, receipt.path);
  assert.equal(createHash('sha256').update(nativeReceipt.committedMarkdown).digest('hex'), reviewed.reviewedSha256, 'Native receipt differs from independently acknowledged review');
  assert(isAbsolute(reviewed.reviewedPath), 'Reviewed canonical target must be absolute');
  const canonicalRelativePath = relative(vault, reviewed.reviewedPath);
  assert(canonicalRelativePath && !isAbsolute(canonicalRelativePath) && canonicalRelativePath !== '..' && !canonicalRelativePath.startsWith(`..${sep}`), 'Reviewed canonical target escaped owned vault');
  assert.equal(effect.canonicalRelativePath, canonicalRelativePath, 'Closed unique Note Identity does not occupy the reviewed target');
  return effect;
}
export async function runIosLiveGate() {
  assert(!process.env.PI_PROTOTYPE_DATA, 'Fresh generated simulator container only; unset PI_PROTOTYPE_DATA');
  assert(!process.env.PI_PROTOTYPE_HTTP_FIXTURE && !process.env.SIMCTL_CHILD_PI_PROTOTYPE_HTTP_FIXTURE, 'Live gate must not use synthetic transport');
  const simulator = process.env.PI_PROTOTYPE_SIMULATOR, appPath = process.env.PI_PROTOTYPE_IOS_APP;
  assert(simulator && appPath, 'Set explicitly owned disposable simulator and prebuilt live-query PI_PROTOTYPE_IOS_APP');
  assert.equal(listenerPids(LIVE.port).length, 0, 'Live proxy port has an unrelated owner');
  const bundle = 'com.braypolkinghorne.gneauxghts.pi-prototype', app = resolve(appPath);
  const run = (command, args, extra = {}) => { const result = spawnSync(command, args, { env: { ...process.env, ...extra }, encoding: 'utf8', timeout: 120000 }); assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim(); };
  const info = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')])); assert.equal(info.CFBundleIdentifier, bundle);
  const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '--json'])).devices;
  const selected = Object.entries(devices).flatMap(([runtime, values]) => values.map(value => ({ ...value, runtime }))).find(value => value.udid === simulator);
  assert(selected?.isAvailable && selected.state === 'Booted', 'Explicit simulator must already be available and booted');
  assert.notEqual(spawnSync('xcrun', ['simctl', 'get_app_container', simulator, bundle, 'data'], { encoding: 'utf8' }).status, 0, 'Requires absent prototype bundle; retain prior evaluation data before running');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gneauxghts-pi-ios-live-'))), evidencePath = join(root, 'ios-live-gate.json');
  const report = { gate: 'ios-real-local-provider', status: 'running', root, bundle, simulator: selected, app,
    executableSha256: createHash('sha256').update(readFileSync(join(app, info.CFBundleExecutable))).digest('hex'), routing: LIVE, phases: [], screenshots: [],
    constraints: { xcode: run('xcodebuild', ['-version']), sdk: run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']), runtime: selected.runtime },
    limits: ['Hosted live protocol deferred.', 'Preferences foregrounding observes native background notification and same-process return; OS suspension, pressure and physical-device guarantees remain unverified.', 'Normal WKWebView controls receive programmatic events; no physical touch acceptance is claimed.'] };
  let proxy, installed = false, data;
  const flush = () => writeFileSync(evidencePath, JSON.stringify({ ...report, requests: proxy?.requests ?? [] }, null, 2));
  const terminate = () => { if (installed) spawnSync('xcrun', ['simctl', 'terminate', simulator, bundle], { encoding: 'utf8', timeout: 30000 }); };
  const screenshot = name => { const path = join(root, `${name}.png`); run('xcrun', ['simctl', 'io', simulator, 'screenshot', path]); report.screenshots.push(path); };
  try {
    proxy = await startLiveLocalProxy();
    run('xcrun', ['simctl', 'install', simulator, app]); installed = true;
    data = realpathSync(run('xcrun', ['simctl', 'get_app_container', simulator, bundle, 'data'])); report.data = data;
    const native = join(data, 'Library/Application Support', bundle, 'PROTOTYPE-wipe-me'), vault = join(data, 'Documents/PROTOTYPE-wipe-me');
    const reportPath = join(native, 'ui-report.json');
    const launch = () => run('xcrun', ['simctl', 'launch', simulator, bundle], { SIMCTL_CHILD_PI_PROTOTYPE_INTERACTIVE_GATE: 'true' });
    const phase = async (name, previous) => assertIosLiveReport(await waitUntil(() => {
      try { const value = JSON.parse(readFileSync(reportPath, 'utf8')); return value.gate === 'ios-local-live' && value.launchId !== previous && (value.status === 'failed' || value.phase === name) && value; }
      catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
    }, `actual iOS live WKWebView ${name}`, 540000), name, previous);
    // Inspection occurs only after termination. The helper copies closed WAL
    // sets and opens the copies read-only, preserving original app databases.
    const snapshot = name => { const value = JSON.parse(run('python3', ['-B', 'scripts/pi-prototype/verify-ios-transcript-effects.py', native, vault])); writeFileSync(join(root, `${name}-native.json`), JSON.stringify(value, null, 2)); return value; };
    launch(); const pending = await phase('awaiting-background'); report.phases.push(pending); screenshot('live-pending-review'); flush();
    const posts = proxy.postCount(); assert(posts >= 2 && posts <= LIVE.maxPosts, 'Both live normal Sends were not observed');
    assert(Number.isSafeInteger(pending.receipts.noInferenceAfterMillis), 'Missing post-answer inference boundary');
    assert(!proxy.requests.some(value => value.inference && value.atMillis >= pending.receipts.noInferenceAfterMillis), 'Citation navigation or normal Save dispatched inference');
    run('xcrun', ['simctl', 'launch', simulator, 'com.apple.Preferences']);
    const background = await phase('ready-to-relaunch'); report.phases.push(background);
    launch(); await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal(JSON.parse(readFileSync(reportPath, 'utf8')).launchId, pending.launchId, 'Foreground restarted the live probe');
    assertLiveNoReplay(posts, proxy.postCount(), 'Background/foreground'); screenshot('live-foreground'); terminate();
    launch(); const kept = await phase('kept-ready-to-relaunch', pending.launchId); report.phases.push(kept);
    assertLiveNoReplay(posts, proxy.postCount(), 'Pending-review relaunch and normal Save/Keep'); screenshot('live-kept-note'); terminate();
    const reviewed = pending.receipts['awaiting-background'];
    const before = snapshot('kept'), receipt = kept.receipts['kept-ready-to-relaunch']; const firstEffect = assertLiveEffect(before, receipt, reviewed, vault);
    launch(); const complete = await phase('complete', kept.launchId); report.phases.push(complete); assert.equal(complete.status, 'passed');
    assertLiveNoReplay(posts, proxy.postCount(), 'Committed relaunch, duplicate receipt and citation navigation'); screenshot('live-restored-source'); terminate();
    assert.deepEqual(complete.receipts.complete.canonical, receipt.canonical, 'Restored canonical read_note projection changed');
    assert.equal(complete.receipts.complete.reviewId, reviewed.reviewId);
    const after = snapshot('restored'); const restored = assertLiveEffect(after, receipt, reviewed, vault);
    assert.deepEqual(restored, firstEffect, 'Native identity, bytes, receipt or publication count changed after restart'); assert.equal(after.vaultId, before.vaultId);
    assert(!proxy.requests.some(value => value.rejected || value.failure || (value.inference && (value.upstreamStatus !== 200 || !value.completed))), 'Observed live provider failure cannot pass');
    report.native = { before, after }; report.transport = { normalSends: 2, inferencePosts: posts, noReplay: true }; report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = String(error).slice(0, 2000); process.exitCode = 1; }
  finally { terminate(); flush(); await proxy?.close(); console.log(JSON.stringify({ status: report.status, root, evidence: evidencePath, error: report.error })); }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runIosLiveGate();
