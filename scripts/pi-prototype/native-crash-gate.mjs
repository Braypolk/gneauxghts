// Root/native-lease owner only. Requires a freshly built normal-workspace
// pi-prototype,e2e-wdio binary. Never accepts a private evaluation data root.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createWebDriverRequest, waitUntil, listenerPids } from '../../e2e/support/nativeTransport.mjs';
import { startCrashFixture } from './crash-fixture.mjs';

if (process.env.PI_PROTOTYPE_DATA) throw new Error('Native crash gate requires a fresh generated root; unset PI_PROTOTYPE_DATA');
for (const port of [1442, 1443, 4445]) assert.equal(listenerPids(port).length, 0, `Port ${port} has an unrelated owner`);
const root = mkdtempSync(join(tmpdir(), 'gneauxghts-pi-native-crashes-'));
const binary = resolve('src-tauri/target/debug/gneauxghts');
const evidencePath = join(root, 'native-crash-gate.json');
const evidence = { gate: 'native-command-transport-crashes', status: 'running', root, binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), cases: [],
  limits: ['Generated synthetic desktop evidence only; no iOS or live provider observation is claimed.', 'Transport boundary withholds terminal events before Pi terminal commit; no failed Pi COMMIT is inferred.'] };
const fixture = await startCrashFixture();
const env = { ...process.env, VITE_PI_PROTOTYPE: 'true', VITE_E2E_NATIVE: 'true', PI_PROTOTYPE_INTERACTIVE_GATE: 'true', PI_PROTOTYPE_HTTP_FIXTURE: 'http://127.0.0.1:1443' };
for (const key of ['GNEAUXGHTS_E2E_FOREGROUND', 'PI_PROTOTYPE_UI_GATE', 'PI_PROTOTYPE_EXPANDED_GATE', 'PI_PROTOTYPE_FAULT', 'PI_PROTOTYPE_E2E_CRASH_BOUNDARY', 'PI_PROTOTYPE_E2E_CRASH_SCOPE']) delete env[key];
const fd = openSync(join(root, 'frontend.log'), 'a');
const server = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '1442', '--strictPort'], { env, stdio: ['ignore', fd, fd], detached: true }); closeSync(fd);
const wd = createWebDriverRequest(4445);
let app, exited, session;
const persist = () => writeFileSync(evidencePath, JSON.stringify({ ...evidence, requests: fixture.requests }, null, 2));
const call = async (script, args = []) => {
  const result = await wd(`/session/${session.sessionId}/execute/async`, { script: `const done=arguments[arguments.length-1];(async()=>{${script}})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));`, args });
  assert(result.ok, result.error); return result.value;
};
const screenshot = async path => writeFileSync(path, Buffer.from(await wd(`/session/${session.sessionId}/screenshot`, undefined, 'GET'), 'base64'));
const launch = async (data, crash = {}) => {
  const log = openSync(join(data, 'native.log'), 'a');
  app = spawn(binary, ['--e2e-app-data-root', data, '--e2e-documents-root', data], { env: { ...env, ...crash, WDIO_EMBEDDED_SERVER: 'true', TAURI_WEBDRIVER_PORT: '4445' }, stdio: ['ignore', log, log] }); closeSync(log);
  exited = once(app, 'exit');
  await waitUntil(async () => (await wd('/status', undefined, 'GET')).ready, 'owned native driver ready', 30000);
  session = await wd('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } });
  await waitUntil(async () => {
    const state = await wd(`/session/${session.sessionId}/execute/sync`, { script: "return {href:location.href,workspace:!!document.querySelector('[data-testid=\"workspace-pane\"]')}", args: [] });
    return state.workspace && new URL(state.href).pathname === '/';
  }, 'normal workspace loaded', 45000);
};
const stop = async () => {
  if (session) { try { await wd(`/session/${session.sessionId}`, undefined, 'DELETE'); } catch {} session = undefined; }
  if (!app || app.exitCode !== null) { app = undefined; return; }
  app.kill('SIGTERM'); await Promise.race([exited, delay(5000)]);
  if (app.exitCode === null) { app.kill('SIGKILL'); await exited; } app = undefined;
};
const apiImport = "const {chatApi:api}=await import('/src/lib/features/chat/api.ts');";
const uiHelpers = `const wait=async(read,label)=>{const end=Date.now()+30000;while(Date.now()<end){const value=read();if(value)return value;await new Promise(r=>setTimeout(r,40));}throw new Error(label);};const button=(label,root=document)=>Array.from(root.querySelectorAll('button')).find(node=>!node.disabled&&(node.textContent.trim()===label||node.getAttribute('aria-label')===label));const open=async()=>{if(!document.querySelector('[aria-label="Thought partner chat"]'))(await wait(()=>button('Open thought partner'),'chat')).click();await wait(()=>document.querySelector('[aria-label="Thought partner chat"]'),'chat panel');};`;
const select = async (conversationId, title) => call(`${uiHelpers}await open();(await wait(()=>button('Conversations'),'picker')).click();(await wait(()=>Array.from(document.querySelectorAll('button[role="menuitem"]')).find(node=>node.textContent.trim()===arguments[1]),'conversation')).click();await wait(()=>document.querySelector('[aria-label="Chat title"]')?.value===arguments[1],'selected title');return true;`, [conversationId, title]);
const countScope = scope => fixture.requests.filter(record => record.scope === scope).length;
try {
  await waitUntil(async () => (await fetch('http://127.0.0.1:1442/')).ok, 'owned Vite', 30000);
  for (const boundary of ['prepared-review', 'transport-completed']) for (const provider of ['local', 'openai']) {
    const scope = randomUUID(), data = join(root, `${boundary}-${provider}`); mkdirSync(data);
    const item = { boundary, provider, scope, root: data, status: 'running', screenshots: [] }; evidence.cases.push(item); persist();
    await launch(data, { PI_PROTOTYPE_E2E_CRASH_BOUNDARY: boundary, PI_PROTOTYPE_E2E_CRASH_SCOPE: scope });
    const title = `Crash ${boundary} ${provider}`;
    const conversation = await call(`${apiImport}if((await api.listConversations()).length)throw new Error('Fresh root required');return api.createConversation({title:arguments[0],vaultAccess:'none',provider:arguments[1],model:'pi-native-fixture'});`, [title, provider]);
    item.conversationId = conversation.id; await select(conversation.id, title);
    const content = `${boundary === 'prepared-review' ? 'PI_CRASH_REVIEW' : 'PI_CRASH_TERMINAL'} PI_E2E_CRASH_${scope}`;
    await call(`${uiHelpers}const composer=await wait(()=>document.querySelector('textarea[aria-label="Message"]'),'composer');composer.focus();composer.value=arguments[0];composer.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:arguments[0]}));(await wait(()=>button('Send message'),'Send')).click();return true;`, [content]);
    await waitUntil(() => countScope(scope) === 1, 'one admitted fixture request', 30000);
    if (boundary === 'transport-completed') {
      await waitUntil(async () => (await call('return document.body.innerText;', [])).includes(`Synthetic terminal partial PI_E2E_CRASH_${scope}.`), 'visible acknowledged partial before native completion', 20000);
      item.partialVisibleAt = Date.now(); const image = join(data, 'partial.png'); await screenshot(image); item.screenshots.push(image);
      // Let Pi persist the observed ordinary partial checkpoint before EOF.
      await waitUntil(async () => (await call(`${apiImport}return (await api.getConversation(arguments[0])).messages.at(-1)?.content;`, [conversation.id]))?.includes(scope), 'Pi partial checkpoint before completion', 10000);
      fixture.release(scope);
    }
    const [code, signal] = await Promise.race([exited, delay(30000).then(() => { throw new Error('Scoped native boundary did not crash'); })]);
    assert.equal(code, 86, `Unexpected process exit ${code}/${signal}`); app = undefined; session = undefined;
    item.crash = JSON.parse(readFileSync(join(data, `PROTOTYPE-wipe-me/e2e-crash-${boundary}.json`), 'utf8'));
    assert.equal(item.crash.scope, scope); assert.equal(item.crash.boundary, boundary);
    assert.equal(boundary === 'prepared-review' ? item.crash.detail.toolReplyDelivered : item.crash.detail.terminalDelivered, false);
    const beforeRelaunch = countScope(scope); await launch(data); await delay(1000);
    assert.equal(countScope(scope), beforeRelaunch, 'Relaunch implicitly replayed provider work');
    const prior = await call(`${apiImport}return {conversation:await api.getConversation(arguments[0]),pending:await api.listPendingProposals(arguments[0])};`, [conversation.id]);
    assert.equal(countScope(scope), beforeRelaunch, 'Reading restored state dispatched provider work');
    const interrupted = prior.conversation.messages.at(-1);
    assert(['error', 'cancelled'].includes(interrupted.status), `Interrupted turn is ${interrupted.status}`);
    assert.equal(prior.pending.length, 0, 'Prepared tool reply became a durable proposal before delivery');
    assert.equal(prior.conversation.messages.find(message => message.role === 'user').content, content, 'Original admitted input changed');
    if (boundary === 'transport-completed') assert(interrupted.content.includes(scope), 'Durable partial disappeared after completion-boundary crash');
    item.restored = { messageId: interrupted.id, status: interrupted.status, content: interrupted.content, pending: prior.pending.length, requests: beforeRelaunch };
    await select(conversation.id, title);
    await call(`${uiHelpers}const message=await wait(()=>document.querySelector('[data-chat-message-id="'+arguments[0]+'"]'),'interrupted turn');(await wait(()=>button('Retry',message),'exact Retry')).click();return true;`, [interrupted.id]);
    const after = await waitUntil(async () => {
      const value = await call(`${apiImport}return api.getConversation(arguments[0]);`, [conversation.id]);
      const message = value.messages.at(-1); if (message?.id !== interrupted.id && message?.status === 'completed') return value;
      if (message?.id !== interrupted.id && ['error', 'cancelled'].includes(message?.status)) throw new Error(`Retry failed: ${message.errorMessage}`);
    }, 'explicit UI Retry terminal result', 30000);
    assert.equal(after.messages.at(-1).content, boundary === 'prepared-review' ? 'Synthetic crash review staging completed.' : `Synthetic terminal partial PI_E2E_CRASH_${scope}.`);
    const scoped = fixture.requests.filter(record => record.scope === scope);
    assert.equal(scoped.length, boundary === 'prepared-review' ? 3 : 2, 'Retry duplicated or omitted an inference/tool continuation');
    const firstUser = crashUser(scoped[0]); const retryUser = crashUser(scoped[1]);
    assert.deepEqual(retryUser, firstUser, 'Retry changed original provider input/context'); assert.equal(scoped[1].model, scoped[0].model, 'Retry changed admitted model');
    item.retry = { messageId: after.messages.at(-1).id, status: after.messages.at(-1).status, requests: scoped.length, exactUserAndModel: true };
    if (boundary === 'prepared-review') {
      const pending = await call(`${apiImport}return api.listPendingProposals(arguments[0]);`, [conversation.id]); assert.equal(pending.length, 1, 'Retry did not stage exactly one proposal');
      const proposal = pending[0];
      await call(`${uiHelpers}const card=await wait(()=>document.querySelector('section[data-proposal-id="'+arguments[0]+'"]'),'proposal');(await wait(()=>button('Review in editor',card),'Review')).click();const strip=await wait(()=>document.querySelector('[data-proposal-strip="active"][data-proposal-id="'+arguments[0]+'"]'),'review strip');(await wait(()=>button('Keep All',strip),'Keep')).click();return true;`, [proposal.id]);
      await waitUntil(async () => !(await call(`${apiImport}return api.listPendingProposals(arguments[0]);`, [conversation.id])).length, 'normal Keep native receipt', 30000);
      item.kept = await call(`${apiImport}const draft=await api.getProposalDraft(arguments[0]);const first=await api.commitAgentProposal(arguments[0],draft.markdown,draft.version);const duplicate=await api.commitAgentProposal(arguments[0],draft.markdown,draft.version);if(first.status!=='committed'||duplicate.noteId!==first.noteId)throw new Error('Duplicate Keep differs');return {proposalId:arguments[0],...first};`, [proposal.id]);
    }
    const image = join(data, 'recovered.png'); await screenshot(image); item.screenshots.push(image);
    await stop(); item.status = 'passed'; persist();
  }
  const proof = spawnSync('python3', ['-B', 'scripts/pi-prototype/verify-native-crashes.py', evidencePath], { encoding: 'utf8' });
  assert.equal(proof.status, 0, proof.stderr || proof.stdout); evidence.singlePublicationProof = JSON.parse(proof.stdout);
  assert(!fixture.requests.some(record => record.error), 'Synthetic fixture contract failed'); evidence.status = 'passed';
} catch (error) { evidence.status = 'failed'; evidence.error = String(error); process.exitCode = 1; }
finally { persist(); await stop(); try { process.kill(-server.pid, 'SIGTERM'); } catch {} await fixture.close(); console.log(JSON.stringify({ status: evidence.status, root, evidence: evidencePath, error: evidence.error })); }

function crashUser(record) { return (record.body.messages ?? record.body.input).findLast(message => message.role === 'user'); }
