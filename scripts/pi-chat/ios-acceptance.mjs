/** Root-owned finite control/receipt listener. No build, simulator, app or inference lifecycle. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, realpathSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IOS_ACCEPTANCE_BUNDLE = 'com.braypolkinghorne.gneauxghts.pi-acceptance';
export const IOS_ACCEPTANCE_SIMULATOR = 'FBAC4D90-9149-4B49-B40D-EA5B90B7069C';
const MAX_COMMANDS = 160, MAX_COMMAND_BYTES = 16384, MAX_RECEIPT_BYTES = 1048576;
const actions = Object.freeze({
  snapshot: [], diagnostics: ['mode'], configure: ['endpoint', 'model', 'restricted'], 'open-chat': [], 'new-conversation': [],
  'select-conversation': ['conversationId'], send: ['kind', 'fixtureTitle'], 'wait-idle': [],
  'seed-history': ['mode'], 'inspect-context': [],
  stop: [], withdraw: ['index'], 'new-attempt': [], 'read-mode': ['mode'], attach: ['noteId'],
  'remove-attachment': ['index'], reasoning: [], 'tool-details': [], source: [], earlier: [],
  'save-fixture': ['key', 'version', 'noteId', 'finalize'], 'read-fixture': ['noteId', 'authorityId'], 'history-fixture': ['noteId'],
  exclude: ['noteId', 'excluded'], authority: ['authorityId'], 'check-source': ['authorityId', 'sourceId'],
  grant: ['duration', 'review'], prepare: ['operation', 'noteId', 'sourceId'], approve: ['intentId'],
  publish: ['intentId', 'parkAcknowledgement'], reconcile: ['intentId'], task: ['taskId'], challenge: ['nonce']
});
const forbiddenReceiptKeys = new Set(['markdown', 'body', 'content', 'thinking', 'reasoningText', 'headers', 'authorization', 'apiKey', 'token', 'password', 'errorMessage', 'message']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function object(value, label) { assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`); }
function opaque(value, label) { assert(typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value), `Invalid ${label}`); }
function positive(value, label) { assert(Number.isSafeInteger(value) && value > 0, `Invalid ${label}`); }
function boolean(value, label) { assert.equal(typeof value, 'boolean', `Invalid ${label}`); }
function oneOf(value, choices, label) { assert(choices.includes(value), `Invalid ${label}`); }
export function validateIosCommand(value) {
  object(value, 'Command'); assert(Object.keys(value).every(key => ['action', 'args', 'launchId', 'timeoutMillis'].includes(key)), 'Unexpected command field');
  assert(own(actions, value.action), 'Unknown finite acceptance action');
  const args = value.args ?? {}; object(args, 'Arguments');
  assert(Object.keys(args).every(key => actions[value.action].includes(key)), 'Unexpected action argument');
  if (value.launchId !== undefined) opaque(value.launchId, 'launch identity');
  if (value.timeoutMillis !== undefined) assert(Number.isSafeInteger(value.timeoutMillis) && value.timeoutMillis >= 1000 && value.timeoutMillis <= 660000, 'Action timeout outside bounded range');
  for (const key of ['noteId', 'authorityId', 'sourceId', 'intentId', 'nonce']) if (args[key] !== undefined) opaque(args[key], key);
  for (const key of ['conversationId', 'taskId']) if (args[key] !== undefined) positive(args[key], key);
  for (const key of ['restricted', 'finalize', 'excluded', 'review', 'parkAcknowledgement']) if (args[key] !== undefined) boolean(args[key], key);
  if (args.index !== undefined) assert(Number.isSafeInteger(args.index) && args.index >= 0 && args.index < 16, 'Invalid bounded item index');
  switch (value.action) {
    case 'diagnostics': oneOf(args.mode, ['observe', 'reports', 'terminal-notification'], 'fixed diagnostic scenario'); break;
    case 'configure':
      if (args.endpoint !== undefined) assert(args.endpoint === 'http://100.117.20.29:1234/v1' || /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}\/v1$/.test(args.endpoint), 'Provider endpoint outside fixture allowlist');
      if (args.model !== undefined) oneOf(args.model, ['qwen3.8-27b-gsq-rco', 'pi-acceptance-fixture'], 'model'); break;
    case 'send':
      oneOf(args.kind, ['source-free', 'hold', 'read', 'queued-withdraw', 'queued-keep', 'continuation', 'fixture-read', 'fixture-hold', 'fixture-error'], 'prompt kind');
      if (args.kind === 'read') assert(typeof args.fixtureTitle === 'string' && args.fixtureTitle.startsWith('Pi simulator ') && args.fixtureTitle.length <= 160, 'Generated fixture title required'); break;
    case 'seed-history': oneOf(args.mode, ['threshold', 'background'], 'source-free history seed mode'); break;
    case 'read-mode': oneOf(args.mode, ['fullVault', 'attachedNotesOnly'], 'read mode'); break;
    case 'save-fixture': oneOf(args.key, ['lantern', 'other', 'update', 'excluded'], 'fixture key'); if (args.version !== undefined) oneOf(args.version, [1, 2], 'fixture version'); break;
    case 'grant': oneOf(args.duration, ['off', 'temporary', 'always'], 'grant duration'); boolean(args.review, 'review'); break;
    case 'prepare': oneOf(args.operation, ['update'], 'operation'); opaque(args.noteId, 'noteId'); opaque(args.sourceId, 'sourceId'); break;
    case 'select-conversation': positive(args.conversationId, 'conversationId'); break;
    case 'attach': case 'read-fixture': case 'history-fixture': case 'exclude': opaque(args.noteId, 'noteId'); if (value.action === 'exclude') boolean(args.excluded, 'excluded'); break;
    case 'approve': case 'publish': case 'reconcile': opaque(args.intentId, 'intentId'); break;
    case 'check-source': opaque(args.authorityId, 'authorityId'); opaque(args.sourceId, 'sourceId'); break;
    case 'task': positive(args.taskId, 'taskId'); break;
    case 'challenge': opaque(args.nonce, 'nonce'); assert(args.nonce.length >= 16, 'Fresh challenge nonce required'); break;
  }
  return { action: value.action, args, ...(value.timeoutMillis ? { timeoutMillis: value.timeoutMillis } : {}) };
}
export function validateIosReceipt(value) {
  object(value, 'Receipt'); assert(Object.keys(value).every(key => ['launchId', 'sequence', 'runId', 'action', 'kind', 'atMillis', 'evidence'].includes(key)), 'Unexpected receipt field');
  opaque(value.launchId, 'launch identity'); assert(/^[a-f0-9-]{36}$/i.test(value.launchId), 'Invalid WebView launch identity');
  assert(Number.isSafeInteger(value.sequence) && value.sequence >= 0, 'Invalid receipt sequence');
  assert(Number.isSafeInteger(value.atMillis) && value.atMillis > 0, 'Invalid receipt timestamp');
  oneOf(value.kind, ['ready', 'completed', 'failed', 'publication-task-started', 'publication-boundary'], 'receipt kind');
  assert(value.action === 'ready' || own(actions, value.action), 'Invalid receipt action');
  const inspect = (data, depth = 0) => {
    assert(depth <= 16, 'Receipt nesting exceeds bound');
    if (typeof data === 'string') assert(data.length <= 1024, 'Receipt string exceeds bound');
    if (data && typeof data === 'object') for (const [key, child] of Object.entries(data)) {
      assert(!forbiddenReceiptKeys.has(key), 'Receipt contains a body/credential field'); inspect(child, depth + 1);
    }
  };
  inspect(value.evidence); return value;
}

/** These helpers never signal a process. The root must inspect immediately before its own signal. */
export function parseOwnedIosLaunch(output) {
  const match = String(output).trim().match(/^([^\s:]+): ([1-9]\d*)$/);
  assert(match && match[1] === IOS_ACCEPTANCE_BUNDLE, 'Expected exact isolated bundle launch receipt');
  const pid = Number(match[2]); assert(Number.isSafeInteger(pid) && pid > 1 && pid <= 2147483647, 'Invalid owned process PID'); return pid;
}
export function parseIosProcess(output) {
  const match = String(output).trim().match(/^(\d+)\s+(\S+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.+)$/);
  assert(match && Number.isFinite(Date.parse(match[3])), 'Unrecognized process identity');
  return { pid: Number(match[1]), state: match[2], startedAt: match[3], executable: match[4] };
}
export function captureOwnedIosProcess({ launchOutput, installedExecutable, inspect }) {
  const pid = parseOwnedIosLaunch(launchOutput), current = inspect(pid);
  assert(typeof installedExecutable === 'string' && installedExecutable.startsWith('/') && !installedExecutable.includes('\n'), 'Expected installed executable path');
  assert.equal(current.pid, pid); assert.equal(current.executable, installedExecutable);
  assert(Number.isFinite(Date.parse(current.startedAt)), 'Missing process start identity');
  return { bundle: IOS_ACCEPTANCE_BUNDLE, pid, startedAt: current.startedAt, executable: installedExecutable };
}
export function assertOwnedIosProcess(owner, inspect) {
  assert.equal(owner.bundle, IOS_ACCEPTANCE_BUNDLE); assert(Number.isSafeInteger(owner.pid) && owner.pid > 1);
  const current = inspect(owner.pid); assert.equal(current.pid, owner.pid); assert.equal(current.startedAt, owner.startedAt); assert.equal(current.executable, owner.executable); return current;
}

/** Synchronous admission after body parsing; timers only record host observation deadlines. */
export function createIosCommandGate(state, flush, { now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let timer;
  const clear = () => { if (timer !== undefined) cancel(timer); timer = undefined; };
  const interrupt = input => {
    object(input, 'Interruption');
    assert(Object.keys(input).every(key => ['sequence', 'launchId', 'reason'].includes(key)), 'Unexpected interruption field');
    const active = state.active;
    assert(active && input.sequence === active.sequence && input.launchId === active.launchId, 'Only the exact active action can be marked interrupted');
    oneOf(input.reason, ['process-termination', 'simulator-shutdown', 'controller-deadline'], 'external interruption reason');
    clear();
    state.interruptions.push({ sequence: active.sequence, launchId: active.launchId, action: active.action, phase: active.phase,
      reason: input.reason, atMillis: now(), underlyingProductMayContinue: true });
    if (!state.blockedLaunchIds.includes(active.launchId)) state.blockedLaunchIds.push(active.launchId);
    state.active = undefined; flush(); return { interrupted: true, sequence: active.sequence };
  };
  return {
    admit(input) {
      const command = validateIosCommand(input);
      // No await may separate these checks from reservation: overlapping slow bodies cannot overwrite active.
      assert(!state.active, 'Wait for the active command receipt'); assert(state.sequence < MAX_COMMANDS, 'Finite command budget exhausted');
      const launchId = input.launchId ?? state.currentLaunchId;
      assert(launchId && state.launches.includes(launchId), 'Choose an observed instrumented launch');
      assert(!state.blockedLaunchIds.includes(launchId), 'Interrupted WebView launch must be replaced before another command');
      const issuedAtMillis = now(), timeoutMillis = command.timeoutMillis ?? 30000;
      const value = { ...command, timeoutMillis, launchId, runId: state.runId, sequence: ++state.sequence, issuedAtMillis,
        deadlineAtMillis: issuedAtMillis + timeoutMillis, phase: 'running' };
      state.commands.push(value); state.active = value;
      timer = schedule(() => {
        if (state.active === value) interrupt({ sequence: value.sequence, launchId, reason: 'controller-deadline' });
      }, timeoutMillis);
      flush(); return value;
    },
    interrupt,
    receipt(receipt) {
      const active = state.active;
      assert(active && receipt.sequence === active.sequence && receipt.launchId === active.launchId && receipt.runId === state.runId && receipt.action === active.action, 'Stale or foreign action receipt');
      if (receipt.kind === 'publication-boundary') {
        // Native commit is observed; the Pi task still awaits WebView acknowledgement and exact external interruption.
        active.phase = 'awaiting-external-interruption';
      } else if (receipt.kind === 'failed' && receipt.evidence?.code === 'acceptance_phase_deadline') {
        interrupt({ sequence: active.sequence, launchId: active.launchId, reason: 'controller-deadline' });
      } else if (['completed', 'failed'].includes(receipt.kind)) { clear(); state.active = undefined; }
    },
    close: clear
  };
}

/** Inert when imported. CLI startup is explicit; it never launches or terminates anything. */
export async function startIosAcceptanceControl({ port, token, output, runId, lifetimeMillis = 5400000 }) {
  assert(Number.isSafeInteger(port) && port >= 1024 && port <= 65535, 'Explicit unprivileged port required');
  assert(/^[a-f0-9]{64}$/.test(token), 'A fresh 32-byte hexadecimal control token is required');
  assert(/^[a-zA-Z0-9-]{8,64}$/.test(runId), 'Explicit generated run identity required');
  assert(Number.isSafeInteger(lifetimeMillis) && lifetimeMillis >= 60000 && lifetimeMillis <= 5400000, 'Invalid bounded listener lifetime');
  const destination = resolve(output); assert(destination.startsWith('/private/tmp/') || destination.startsWith('/tmp/'), 'Receipt output must be an explicitly owned temporary directory');
  mkdirSync(destination, { recursive: true }); const directory = realpathSync(destination);
  assert(directory.startsWith('/private/tmp/'), 'Receipt directory must resolve inside /private/tmp');
  assert.equal(readdirSync(directory).length, 0, 'New control session requires an empty output directory');
  const state = { gate: 'ordinary-pi-ios-simulator', runId, bundle: IOS_ACCEPTANCE_BUNDLE, simulator: IOS_ACCEPTANCE_SIMULATOR,
    startedAtMillis: Date.now(), currentLaunchId: undefined, sequence: 0, active: undefined, launches: [], blockedLaunchIds: [], commands: [], receipts: [], interruptions: [],
    limits: ['Programmatic DOM actions are not touch or keyboard evidence.', 'Simulator observations do not prove physical-device memory, suspension, signing or performance.'] };
  const flush = () => writeFileSync(join(directory, 'ios-acceptance.json'), JSON.stringify(state, null, 2) + '\n');
  const gate = createIosCommandGate(state, flush);
  const authorized = request => {
    const provided = request.headers['x-pi-acceptance-token']; return typeof provided === 'string' && /^[a-f0-9]{64}$/.test(provided) && timingSafeEqual(Buffer.from(provided), Buffer.from(token));
  };
  const read = async (request, maximum) => { const chunks = []; let bytes = 0; for await (const chunk of request) { bytes += chunk.length; assert(bytes <= maximum, 'Request exceeds bounded size'); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); };
  const origins = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']);
  const server = createServer(async (request, response) => {
    const requestOrigin = request.headers.origin;
    if (requestOrigin && !origins.has(requestOrigin)) { response.writeHead(403).end(); return; }
    if (requestOrigin) { response.setHeader('access-control-allow-origin', requestOrigin); response.setHeader('vary', 'origin'); }
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-pi-acceptance-token', 'access-control-max-age': '60' }).end(); return; }
    if (!authorized(request)) { response.writeHead(403).end(); return; }
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const json = (status, value) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value)); };
    try {
      if (request.method === 'GET' && url.pathname === '/status' && !url.search) { json(200, state); return; }
      if (request.method === 'GET' && url.pathname === '/command') {
        assert([...url.searchParams.keys()].every(key => key === 'launchId') && url.searchParams.size === 1, 'Unexpected command query');
        const command = state.active;
        if (command && command.launchId === url.searchParams.get('launchId')) json(200, command);
        else response.writeHead(204, { 'cache-control': 'no-store' }).end(); return;
      }
      if (request.method === 'POST' && url.pathname === '/driver/command' && !url.search) {
        const input = await read(request, MAX_COMMAND_BYTES), value = gate.admit(input);
        // The command payload is synthetic and finite; report no credential or provider body.
        json(202, value); return;
      }
      if (request.method === 'POST' && url.pathname === '/driver/interrupt' && !url.search) {
        const input = await read(request, MAX_COMMAND_BYTES); json(200, gate.interrupt(input)); return;
      }
      if (request.method === 'POST' && url.pathname === '/receipt' && !url.search) {
        const receipt = validateIosReceipt(await read(request, MAX_RECEIPT_BYTES));
        assert(state.receipts.length < 640, 'Receipt budget exhausted');
        if (receipt.sequence === 0) {
          assert(receipt.action === 'ready' && ['ready', 'failed'].includes(receipt.kind), 'Invalid startup receipt');
          assert(state.launches.length < 32 && !state.launches.includes(receipt.launchId), 'Repeated or excessive startup receipt'); state.launches.push(receipt.launchId); state.currentLaunchId = receipt.launchId;
        } else {
          const active = state.active; assert(active && receipt.sequence === active.sequence && receipt.launchId === active.launchId && receipt.runId === runId && receipt.action === active.action, 'Stale or foreign action receipt');
          assert(!state.receipts.some(value => value.launchId === receipt.launchId && value.sequence === receipt.sequence && value.kind === receipt.kind), 'Duplicate phase receipt');
          gate.receipt(receipt);
        }
        state.receipts.push(receipt); flush(); json(200, { accepted: true, sequence: receipt.sequence }); return;
      }
      response.writeHead(404).end();
    } catch { json(400, { code: 'invalid_or_stale_acceptance_request' }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); }); flush();
  let closing;
  const close = () => closing ??= new Promise(resolveClose => { clearTimeout(deadline); gate.close(); server.closeAllConnections(); server.close(() => { state.closedAtMillis = Date.now(); flush(); resolveClose(); }); });
  const deadline = setTimeout(() => { void close(); }, lifetimeMillis);
  return { origin: `http://127.0.0.1:${port}`, state, evidencePath: join(directory, 'ios-acceptance.json'), close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); assert(args.length === 8 && args[0] === '--port' && args[2] === '--output' && args[4] === '--run-id' && args[6] === '--token-env',
    'Usage: node scripts/pi-chat/ios-acceptance.mjs --port PORT --output EMPTY_TMP_DIR --run-id ID --token-env VARIABLE_NAME');
  assert(/^[A-Z][A-Z0-9_]{2,80}$/.test(args[7]) && !['HOME', 'CODEX_HOME'].includes(args[7]), 'Use a task-specific token environment variable');
  const control = await startIosAcceptanceControl({ port: Number(args[1]), output: args[3], runId: args[5], token: process.env[args[7]] ?? '' });
  console.log(JSON.stringify({ origin: control.origin, runId: control.state.runId, evidence: control.evidencePath, bundle: IOS_ACCEPTANCE_BUNDLE, simulator: IOS_ACCEPTANCE_SIMULATOR }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void control.close(); });
}
