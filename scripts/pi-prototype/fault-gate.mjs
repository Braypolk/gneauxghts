// Root/native-lease owner only. Importing for pure tests launches nothing.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createWebDriverRequest, waitUntil, listenerPids } from '../../e2e/support/nativeTransport.mjs';
import { startInteractiveFixture } from './interactive-fixture.mjs';

export const publicationFaults = ['after-intent', 'after-publication', 'after-receipt'];
export function faultEnvironment(parent = {}) {
  assert(!parent.PI_PROTOTYPE_DATA, 'Fault gate allocates fresh synthetic data; unset PI_PROTOTYPE_DATA');
  const env = { ...parent, VITE_PI_PROTOTYPE: 'true', VITE_E2E_NATIVE: 'true',
    PI_PROTOTYPE_INTERACTIVE_GATE: 'true', PI_PROTOTYPE_HTTP_FIXTURE: 'http://127.0.0.1:1443',
    WDIO_EMBEDDED_SERVER: 'true', TAURI_WEBDRIVER_PORT: '4445' };
  for (const key of ['GNEAUXGHTS_E2E_FOREGROUND', 'PI_PROTOTYPE_UI_GATE', 'PI_PROTOTYPE_DIAGNOSTICS',
    'PI_PROTOTYPE_EXPANDED_GATE', 'PI_PROTOTYPE_FOLLOWONS_GATE', 'PI_PROTOTYPE_TRANSCRIPT_GATE',
    'PI_PROTOTYPE_FAULT', 'PI_PROTOTYPE_E2E_CRASH_BOUNDARY', 'PI_PROTOTYPE_E2E_CRASH_SCOPE']) delete env[key];
  return env;
}
export function assertPublicationBoundary(fault, before, after) {
  assert(publicationFaults.includes(fault), 'Unknown publication boundary');
  assert(before && after, 'Native effect evidence missing');
  for (const key of ['id', 'payload_hash', 'note_id', 'target_path', 'intended_hash'])
    assert.equal(after[key], before[key], `Native accepted ${key} changed`);
  assert.equal(before.publications, fault === 'after-intent' ? 0 : 1, 'Initial publication boundary differs');
  if (fault === 'after-intent') assert(!before.proof && !before.receipt && !before.canonicalSha256);
  if (fault === 'after-publication') assert(before.proof && !before.receipt && before.canonicalSha256);
  if (fault === 'after-receipt') assert(!before.proof && before.receipt && before.canonicalSha256);
  assert.equal(after.publications, 1, 'Recovery published more than once');
  assert(after.receipt && after.canonicalSha256 && !after.proof, 'Native canonical receipt did not settle');
  assert.equal(JSON.parse(after.receipt).noteId, before.note_id);
  if (before.canonicalSha256) assert.equal(after.canonicalSha256, before.canonicalSha256, 'Recovery rewrote published canonical bytes');
}
const ui = `const wait=async(read,label)=>{const end=Date.now()+20000;while(Date.now()<end){const value=await read();if(value)return value;await new Promise(r=>setTimeout(r,40));}throw new Error(label);};const button=(label,root=document)=>Array.from(root.querySelectorAll('button')).find(node=>!node.disabled&&(node.textContent.trim()===label||node.getAttribute('aria-label')===label));const open=async()=>{if(!document.querySelector('[aria-label="Thought partner chat"]'))(await wait(()=>button('Open thought partner'),'chat')).click();await wait(()=>document.querySelector('[aria-label="Thought partner chat"]'),'chat panel');};`;
async function bounded(promise, milliseconds, label) {
  const controller = new AbortController();
  try { return await Promise.race([promise, delay(milliseconds, undefined, { signal: controller.signal })
    .then(() => { throw new Error(label); })]); }
  finally { controller.abort(); }
}

export async function runFaultGate() {
  const env = faultEnvironment(process.env);
  for (const port of [1442, 1443, 4445]) assert.equal(listenerPids(port).length, 0, `Port ${port} has an unrelated owner`);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gneauxghts-pi-faults-')));
  const binary = resolve('src-tauri/target/debug/gneauxghts');
  const path = join(root, 'fault-gate.json');
  const evidence = { gate: 'native-publication-crash-workspace', status: 'running', root,
    binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), evidence: [],
    limits: ['Existing normal workspace with public Pi API staging/checkpoint and real review/Keep controls; no replacement UI.',
      'Restored Retry Keep uses the public API for the pinned accepted version; first Keep and proposal review use normal UI.',
      'Synthetic desktop providers only; no live provider or iOS observation is claimed.'] };
  let fixture, server, app, exited, session, current;
  const wd = createWebDriverRequest(4445);
  const persist = () => writeFileSync(path, JSON.stringify({ ...evidence, requests: fixture?.requests ?? [] }, null, 2));
  const call = async (script, args = []) => {
    const value = await wd(`/session/${session.sessionId}/execute/async`, {
      script: `const done=arguments[arguments.length-1];(async()=>{${script}})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));`, args,
    });
    assert(value.ok, value.error); return value.value;
  };
  const screenshot = async name => {
    const image = join(current.root, `${name}.png`);
    writeFileSync(image, Buffer.from(await wd(`/session/${session.sessionId}/screenshot`, undefined, 'GET'), 'base64'));
    current.screenshots.push(image);
  };
  const stop = async () => {
    if (session) { try { await wd(`/session/${session.sessionId}`, undefined, 'DELETE'); } catch {} session = undefined; }
    if (!app) return;
    if (app.exitCode === null && app.signalCode === null) {
      app.kill('SIGTERM'); await bounded(exited, 5000, 'native graceful stop deadline').catch(() => {});
      if (app.exitCode === null && app.signalCode === null) { app.kill('SIGKILL'); await bounded(exited, 5000, 'native forced stop deadline'); }
    }
    app = undefined;
    await waitUntil(() => !listenerPids(4445).length, 'owned driver release', 5000);
  };
  const launch = async data => {
    const log = openSync(join(data, 'native.log'), 'a');
    app = spawn(binary, ['--e2e-app-data-root', data, '--e2e-documents-root', data], { env, stdio: ['ignore', log, log] });
    closeSync(log); exited = once(app, 'exit');
    await waitUntil(async () => (await wd('/status', undefined, 'GET')).ready, 'owned native driver ready', 30000);
    session = await wd('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } });
    await waitUntil(async () => {
      const loaded = await wd(`/session/${session.sessionId}/execute/sync`, {
        script: `return {href:location.href,readyState:document.readyState,workspace:!!document.querySelector('[data-testid="workspace-pane"]')}`, args: [],
      });
      current.loaded = loaded;
      if (loaded.href?.includes('/pi-prototype')) throw new Error('Rebuild with normal-root Pi configuration; diagnostic entry is forbidden');
      return new URL(loaded.href).pathname === '/' && loaded.workspace && loaded.readyState !== 'loading';
    }, 'normal native workspace loaded', 45000);
    persist();
  };
  const relaunch = async data => {
    await waitUntil(() => !listenerPids(4445).length, 'crashed owned driver release', 5000);
    await launch(data);
  };
  const api = "const {chatApi:api}=await import('/src/lib/features/chat/api.ts');";
  try {
    fixture = await startInteractiveFixture(1443, { followons: false });
    const log = openSync(join(root, 'frontend.log'), 'a');
    server = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '1442', '--strictPort'], { env, stdio: ['ignore', log, log], detached: true }); closeSync(log);
    persist();
    await waitUntil(async signal => (await fetch('http://127.0.0.1:1442/', { signal })).ok, 'owned Vite workspace', 30000);
    const select = async title => call(`${ui}await open();(await wait(()=>button('Conversations'),'picker')).click();(await wait(()=>Array.from(document.querySelectorAll('button[role="menuitem"]')).find(node=>node.textContent.trim()===arguments[0]),'conversation')).click();await wait(()=>document.querySelector('[aria-label="Chat title"]')?.value===arguments[0],'selected title');return true;`, [title]);
    const send = async content => call(`${ui}const composer=await wait(()=>{const value=document.querySelector('textarea[aria-label="Message"]');return value&&!value.disabled&&value;},'composer');composer.focus();composer.value=arguments[0];composer.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:arguments[0]}));(await wait(()=>button('Send message'),'Send')).click();return true;`, [content]);
    const terminal = async id => waitUntil(async () => {
      const conversation = await call(`${api}return api.getConversation(arguments[0]);`, [id]);
      const answer = conversation.messages.at(-1);
      assert(!['error','cancelled'].includes(answer?.status), answer?.errorMessage);
      return answer?.role === 'assistant' && answer.status === 'completed' && answer;
    }, 'committed assistant result', 30000);
    const review = async id => call(`${ui}if(document.querySelector('[data-proposal-strip="active"][data-proposal-id="'+arguments[0]+'"]'))return true;await open();const card=await wait(()=>document.querySelector('section[data-proposal-id="'+arguments[0]+'"]'),'proposal card');(await wait(()=>button('Review in editor',card),'Review')).click();await wait(()=>document.querySelector('[data-proposal-strip="active"][data-proposal-id="'+arguments[0]+'"]'),'review strip');return true;`, [id]);
    const clickKeep = async id => {
      await call(`${ui}const strip=await wait(()=>document.querySelector('[data-proposal-strip="active"][data-proposal-id="'+arguments[0]+'"]'),'review strip');await wait(()=>button('Keep All',strip)??button('Keep Remaining',strip),'enabled Keep');return true;`, [id]);
      const result = await wd(`/session/${session.sessionId}/execute/sync`, {
        script: `const strip=document.querySelector('[data-proposal-strip="active"][data-proposal-id="'+arguments[0]+'"]');const action=strip&&Array.from(strip.querySelectorAll('button')).find(node=>!node.disabled&&['Keep All','Keep Remaining'].includes(node.textContent.trim()));if(!action)throw new Error('Normal Keep control missing');action.click();return true;`, args: [id],
      }); assert.equal(result, true);
    };
    const create = async title => call(`${api}return api.createConversation({title:arguments[0],vaultAccess:'full',provider:'local',model:'pi-native-fixture'});`, [title]);
    const effect = (data, id) => {
      const read = spawnSync('python3', ['-B', 'scripts/pi-prototype/publication-fault-proof.py', data, id], { encoding: 'utf8' });
      assert.equal(read.status, 0, read.stderr || read.stdout); return JSON.parse(read.stdout);
    };
    for (const fault of publicationFaults) {
      const data = join(root, fault); mkdirSync(data);
      current = { fault, root: data, status: 'running', screenshots: [] }; evidence.evidence.push(current);
      await launch(data);
      const title = `Publication ${fault}`, conversation = await create(title); await select(title);
      await send('PI_UI:CREATE'); current.source = await terminal(conversation.id);
      const pending = await call(`${api}return api.listPendingProposals(arguments[0]);`, [conversation.id]);
      assert.equal(pending.length, 1, 'Exactly one model-created proposal required'); const proposal = pending[0];
      current.proposalId = proposal.id; current.conversationId = conversation.id;
      const body = 'Edited checkpoint retained through restart.';
      current.checkpoint = await call(`${api}const draft=await api.getProposalDraft(arguments[0]);return api.checkpointProposalDraft(arguments[0],{...draft,markdown:arguments[1],title:'Edited Pi title'});`, [proposal.id, body]);
      assert.equal(current.checkpoint.markdown, body);
      await review(proposal.id); await call(`${api}await api.prototypeFault(arguments[0],arguments[1]);return true;`, [proposal.id, fault]);
      await screenshot('before-fault'); current.requestsBeforeCrash = fixture.requests.length;
      await clickKeep(proposal.id).catch(error => { current.clickTransportError = String(error); });
      const [code, signal] = await bounded(exited, 20000, `${fault} failed to terminate native app`);
      assert(signal || (code !== null && code !== 0), 'Publication fault did not crash');
      Object.assign(current, { code, signal }); app = undefined; session = undefined;
      current.before = effect(data, proposal.id); persist();
      await relaunch(data);
      assert.equal(fixture.requests.length, current.requestsBeforeCrash, 'Relaunch dispatched inference');
      const restored = await call(`${api}return {draft:await api.getProposalDraft(arguments[0]),conversation:await api.getConversation(arguments[1])};`, [proposal.id, conversation.id]);
      assert.equal(restored.draft.markdown, body); assert.equal(restored.draft.title, 'Edited Pi title');
      const source = restored.conversation.messages.find(message=>message.id===current.source.id);
      assert.equal(source?.content, current.source.content, 'Original assistant source changed');
      assert.equal(source?.status, 'completed', 'Original source terminal outcome changed');
      current.restoredVersion = restored.draft.version;
      await select(title);
      // The retained accepted hunk decisions may leave no unresolved UI hunks.
      // Explicit public Retry Keep joins the immutable accepted native effect.
      const receipt = await call(`${api}const draft=await api.getProposalDraft(arguments[0]);const first=await api.commitAgentProposal(arguments[0],draft.markdown,draft.version);const duplicate=await api.commitAgentProposal(arguments[0],draft.markdown,draft.version);if(first.status!=='committed'||duplicate.noteId!==first.noteId)throw new Error('Duplicate Keep differs');return first;`, [proposal.id]);
      await waitUntil(async () => !(await call(`${api}return api.listPendingProposals(arguments[0]);`, [conversation.id])).some(value=>value.id===proposal.id), 'explicit restored Keep receipt', 30000);
      assert.equal(fixture.requests.length, current.requestsBeforeCrash, 'Keep or duplicate Keep dispatched inference');
      current.second = { ui: { keepId: proposal.id, keepNoteId: receipt.noteId, keepPath: receipt.applied.path } };
      assert(readFileSync(receipt.applied.path, 'utf8').includes(body));
      await screenshot('recovered'); await stop();
      current.after = effect(data, proposal.id); assertPublicationBoundary(fault, current.before, current.after);
      current.status = 'passed'; persist();
    }
    const data = join(root, 'during-model'); mkdirSync(data);
    current = { fault: 'during-model', root: data, status: 'running', screenshots: [] }; evidence.evidence.push(current);
    await launch(data); const title = 'Interrupted explicit Retry', conversation = await create(title); await select(title);
    await send('PI_UI:INTERRUPT');
    const matches = () => fixture.requests.filter(record => record.journey === 'INTERRUPT');
    await waitUntil(() => matches().length === 1 && matches()[0].firstTextAt, 'in-flight partial native response', 10000);
    const interrupted = await waitUntil(async () => {
      const value = await call(`${api}return api.getConversation(arguments[0]);`, [conversation.id]);
      const answer = value.messages.at(-1); return answer?.role==='assistant' && answer.content.includes('Acknowledged partial fixture text.') && answer;
    }, 'Pi acknowledged partial before kill', 15000);
    assert.equal(interrupted.status, 'streaming', 'During-model crash requires active Pi projection');
    assert(!matches()[0].completed && !matches()[0].closed, 'Fixture completed before process loss');
    current.killedDuringActiveTransport = { firstTextAt: matches()[0].firstTextAt, killedAt: Date.now(), completed: matches()[0].completed };
    app.kill('SIGKILL'); await bounded(exited, 5000, 'during-model termination deadline'); app = undefined; session = undefined;
    await relaunch(data); assert.equal(matches().length, 1, 'Relaunch silently resumed inference');
    assert(matches()[0].closed && !matches()[0].completed, 'Killed transport completed instead of closing during inference');
    const prior = await call(`${api}return api.getConversation(arguments[0]);`, [conversation.id]);
    const restored = prior.messages.find(message=>message.id===interrupted.id);
    assert(restored && ['error','cancelled'].includes(restored.status), 'Interrupted outcome not exposed');
    assert(restored.content.includes('Acknowledged partial fixture text.'), 'Acknowledged partial was lost');
    assert.equal(matches().length, 1, 'Reading restored conversation dispatched inference');
    await select(title); await screenshot('interrupted-restored');
    await call(`${ui}const message=await wait(()=>document.querySelector('[data-chat-message-id="'+arguments[0]+'"]'),'interrupted turn');(await wait(()=>button('Retry',message),'exact Retry')).click();return true;`, [interrupted.id]);
    const answer = await terminal(conversation.id); assert.notEqual(answer.id, interrupted.id); assert.equal(answer.content, 'Retried fixture complete.');
    assert.equal(matches().length, 2, 'Explicit Retry must make exactly one fresh request');
    const user = record => (record.body.messages ?? record.body.input).findLast(message => message.role === 'user');
    assert.deepEqual(user(matches()[1]), user(matches()[0]), 'Retry changed admitted user input/context');
    assert.equal(matches()[1].model, matches()[0].model, 'Retry changed admitted model');
    Object.assign(current, { interruptedStatus: restored.status, retriedStatus: answer.status, nativeRequests: matches().length, exactUserAndModel: true });
    await screenshot('explicit-retry'); await stop(); current.status = 'passed'; persist();
    assert(!fixture.requests.some(record=>record.error), 'Synthetic fixture contract failed');
    const verified = spawnSync('python3', ['-B', 'scripts/pi-prototype/verify-effects.py', root], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr || verified.stdout || 'Native single-publication proof failed');
    // The read-only verifier enriches each publication case with its exact proof.
    evidence.evidence = JSON.parse(readFileSync(path, 'utf8')).evidence;
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed'; evidence.error = String(error); process.exitCode = 1;
    if (current) { current.status = 'failed'; current.error = String(error); }
    if (session && current) await screenshot('failure').catch(() => {});
  } finally {
    persist(); await stop().catch(error => { evidence.cleanupError = String(error); evidence.status = 'failed'; process.exitCode = 1; });
    if (server) {
      const closed = once(server, 'exit');
      try { process.kill(-server.pid, 'SIGTERM'); await bounded(closed, 5000, 'frontend stop deadline'); }
      catch { try { process.kill(-server.pid, 'SIGKILL'); } catch {} }
    }
    if (fixture) await bounded(fixture.close(), 5000, 'fixture close deadline').catch(error => { evidence.cleanupError = String(error); evidence.status = 'failed'; process.exitCode = 1; });
    persist(); console.log(JSON.stringify({ status: evidence.status, root, evidence: path, error: evidence.error }));
  }
  return evidence;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runFaultGate();
