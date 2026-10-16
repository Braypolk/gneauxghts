// Execute only under the root agent's native lease, after its default checkpoint.
// Importing this file is pure: tests cannot open ports, launch apps or touch Git.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, realpathSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createWebDriverRequest, waitUntil, listenerPids } from '../../e2e/support/nativeTransport.mjs';
import { startInteractiveFixture } from './interactive-fixture.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function relocatedPath(path, oldRoot, newRoot) {
  const suffix = relative(oldRoot, path);
  assert(suffix && suffix !== '..' && !suffix.startsWith(`..${sep}`), 'Expected a retained location below the old root');
  return join(newRoot, suffix);
}
export function assertRecoveredEffect(before, after) {
  assert(before && after, 'Retained effect row is missing');
  for (const key of ['id', 'payload_hash', 'note_id', 'target_path', 'intended_hash']) assert.equal(after[key], before[key], `Native accepted ${key} changed`);
  assert(before.proof && !before.receipt, 'Initial Keep must have an uncertain receipt with durable proof');
  assert(after.receipt, 'Explicit Retry Keep did not retain a receipt');
  assert.equal(after.publications, before.publications, 'Retry created a second timeline publication');
  assert.equal(after.publications, 1, 'Expected one canonical publication');
  assert.equal(after.canonicalSha256, before.canonicalSha256, 'Recovery rewrote the published canonical bytes');
  assert.equal(JSON.parse(after.receipt).noteId, before.note_id);
}
const apiImport = "const {chatApi:api}=await import('/src/lib/features/chat/api.ts');";
const nativeImport = "const {invoke}=await import('/node_modules/@tauri-apps/api/core.js');";
export const pendingCheckpointScript = `${apiImport}
const draft=await api.getProposalDraft(arguments[0]);
return api.checkpointProposalDraft(arguments[0],{...draft,markdown:draft.markdown+arguments[1],title:arguments[2]});`;
const ui = `const wait=async(read,label)=>{const end=Date.now()+20000;while(Date.now()<end){const value=await read();if(value)return value;await new Promise(r=>setTimeout(r,40));}throw new Error(label);};const button=(label,root=document)=>Array.from(root.querySelectorAll('button')).find(node=>!node.disabled&&(node.textContent.trim()===label||node.getAttribute('aria-label')===label));const open=async()=>{if(!document.querySelector('[aria-label="Thought partner chat"]'))(await wait(()=>button('Open thought partner'),'chat')).click();await wait(()=>document.querySelector('[aria-label="Thought partner chat"]'),'chat panel');};`;
export const wholeSaveScript = `${apiImport}${ui}
await open();
const before=new Set((await api.listPendingProposals(arguments[0])).map(value=>value.id));
const answer=await wait(()=>document.querySelector('[data-chat-message-id="'+arguments[1]+'"]'),'exact answer Save control');
(await wait(()=>button('Save to note',answer),'normal whole-answer Save')).click();
return wait(async()=> (await api.listPendingProposals(arguments[0])).find(value=>!before.has(value.id)),'UI-staged whole-answer Save proposal');`;
export const reviewScript = `${apiImport}${ui}
const {EditorView}=await import('/node_modules/@codemirror/view/dist/index.js');
const {acquireProbeReview}=await import('/src/lib/prototypes/pi/probeReview.ts');
const id=arguments[0],draft=await api.getProposalDraft(id);
const editor=()=>Array.from(document.querySelectorAll('[data-testid="note-title"]')).some(node=>node.value===draft.title)
  ?Array.from(document.querySelectorAll('[data-testid="note-editor"] .cm-editor')).map(node=>EditorView.findFromDOM(node)).find(view=>view?.state.doc.toString()===draft.markdown):undefined;
await acquireProbeReview({editor,openChat:open,until:wait,
  card:()=>document.querySelector('section[data-proposal-id="'+id+'"]')??undefined,
  openCard:async card=>(await wait(()=>button('Review in editor',card),'Review')).click()});
await open();await wait(()=>document.querySelector('[data-proposal-strip="active"][data-proposal-id="'+id+'"]'),'exact mounted review strip');
return true;`;
export const acknowledgedPendingScript = `${apiImport}${ui}
const {EditorView}=await import('/node_modules/@codemirror/view/dist/index.js');
const {reviewProjection}=await import('/src/lib/features/proposals/reviewExtension.ts');
const {acknowledgedProbeDraft}=await import('/src/lib/prototypes/pi/probeReview.ts');
const id=arguments[0],draft=await api.getProposalDraft(id);
const editor=await wait(()=>Array.from(document.querySelectorAll('[data-testid="note-editor"] .cm-editor')).map(node=>EditorView.findFromDOM(node)).find(view=>view?.state.doc.toString()===draft.markdown&&view.state.field(reviewProjection,false)?.hunks.length),'mounted creation review decisions');
const title=editor.dom.closest('[data-pane-frame]')?.querySelector('[data-testid="note-title"]');
if(!title)throw new Error('Mounted pending review has no corresponding title');
return acknowledgedProbeDraft({draft:()=>api.getProposalDraft(id),until:wait,
  working:()=>({markdown:editor.state.doc.toString(),title:title.value,path:draft.path,decisions:editor.state.field(reviewProjection,false).hunks})});`;
export const failureDomScript = `const text=(value,limit)=>String(value??'').slice(0,limit);
const controls=root=>Array.from(root.querySelectorAll('button')).slice(0,16).map(node=>({label:text(node.getAttribute('aria-label')||node.textContent.trim(),120),disabled:node.disabled}));
return {href:text(location.href,500),readyState:document.readyState,
  strips:Array.from(document.querySelectorAll('[data-proposal-strip]')).slice(0,8).map(node=>({kind:node.getAttribute('data-proposal-strip'),proposalId:node.getAttribute('data-proposal-id'),text:text(node.textContent,1600),controls:controls(node)})),
  alerts:Array.from(document.querySelectorAll('[role="alert"]')).slice(0,12).map(node=>text(node.textContent,600)),
  titles:Array.from(document.querySelectorAll('[data-testid="note-title"]')).slice(0,8).map(node=>({value:text(node.value,200),readOnly:node.readOnly})),
  actions:Array.from(document.querySelectorAll('button')).filter(node=>/^(Keep All|Keep Remaining|Retry|Discard|Review next|Review in editor|Copy Current|Reload Disk)$/.test(node.textContent.trim())).slice(0,24).map(node=>({label:text(node.textContent.trim(),120),disabled:node.disabled}))};`;

export async function runNativeTranscriptGate() {
  assert(!process.env.PI_PROTOTYPE_DATA, 'Unset PI_PROTOTYPE_DATA; this gate allocates synthetic data only');
  for (const port of [1442, 1443, 4445]) assert.equal(listenerPids(port).length, 0, `Port ${port} has an unrelated owner`);
  // Native RunningVault canonicalizes paths; macOS temp paths may alias /private.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gneauxghts-pi-transcript-')));
  const original = join(root, 'original-data'), relocated = join(root, 'relocated-data'); mkdirSync(original);
  const binary = resolve('src-tauri/target/debug/gneauxghts');
  const reportPath = join(root, 'native-transcript-gate.json');
  const report = { gate: 'native-transcript-relocation', status: 'running', root, binarySha256: sha256(readFileSync(binary)), checks: [], screenshots: [],
    limits: ['Synthetic desktop WKWebView fixture evidence only; live providers and iOS remain unobserved.',
      'Relocation moves the complete generated evaluation data root, including its vault, Pi database and native receipts. Pi composition fixes the vault below that root; standalone Settings vault selection is not established.'] };
  const fixture = await startInteractiveFixture();
  const env = { ...process.env, VITE_PI_PROTOTYPE: 'true', VITE_E2E_NATIVE: 'true', PI_PROTOTYPE_INTERACTIVE_GATE: 'true', PI_PROTOTYPE_HTTP_FIXTURE: 'http://127.0.0.1:1443' };
  for (const key of ['GNEAUXGHTS_E2E_FOREGROUND', 'PI_PROTOTYPE_UI_GATE', 'PI_PROTOTYPE_EXPANDED_GATE', 'PI_PROTOTYPE_FAULT', 'PI_PROTOTYPE_E2E_CRASH_BOUNDARY', 'PI_PROTOTYPE_E2E_CRASH_SCOPE']) delete env[key];
  const frontend = openSync(join(root, 'frontend.log'), 'a');
  const server = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '1442', '--strictPort'], { env, stdio: ['ignore', frontend, frontend], detached: true }); closeSync(frontend);
  const wd = createWebDriverRequest(4445); let app, exited, session;
  const persist = () => writeFileSync(reportPath, JSON.stringify({ ...report, requests: fixture.requests }, null, 2));
  const call = async (script, args = []) => {
    const result = await wd(`/session/${session.sessionId}/execute/async`, { script: `const done=arguments[arguments.length-1];(async()=>{${script}})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));`, args });
    assert(result.ok, result.error); return result.value;
  };
  const launch = async data => {
    const fd = openSync(join(root, `native-${data === original ? 'original' : 'relocated'}.log`), 'a');
    app = spawn(binary, ['--e2e-app-data-root', data, '--e2e-documents-root', data], { env: { ...env, WDIO_EMBEDDED_SERVER: 'true', TAURI_WEBDRIVER_PORT: '4445' }, stdio: ['ignore', fd, fd] }); closeSync(fd); exited = once(app, 'exit');
    await waitUntil(async () => (await wd('/status', undefined, 'GET')).ready, 'owned driver ready', 30000);
    session = await wd('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } });
    await waitUntil(async () => {
      const state = await wd(`/session/${session.sessionId}/execute/sync`, { script: 'return {href:location.href,workspace:!!document.querySelector(\'[data-testid="workspace-pane"]\')}', args: [] });
      return state.workspace && new URL(state.href).pathname === '/';
    }, 'normal workspace', 45000);
  };
  const stop = async () => {
    if (session) { try { await wd(`/session/${session.sessionId}`, undefined, 'DELETE'); } catch {} session = undefined; }
    if (!app || app.exitCode !== null) { app = undefined; return; }
    app.kill('SIGTERM'); await Promise.race([exited, delay(5000)]);
    if (app.exitCode === null) { app.kill('SIGKILL'); await exited; } app = undefined;
  };
  const select = async title => call(`${ui}await open();(await wait(()=>button('Conversations'),'picker')).click();(await wait(()=>Array.from(document.querySelectorAll('button[role="menuitem"]')).find(node=>node.textContent.trim()===arguments[0]),'conversation')).click();await wait(()=>document.querySelector('[aria-label="Chat title"]')?.value===arguments[0],'selected title');return true;`, [title]);
  const send = async (id, content) => {
    const count = (await call(`${apiImport}return api.getConversation(arguments[0]);`, [id])).messages.length;
    await call(`${ui}const composer=await wait(()=>{const value=document.querySelector('textarea[aria-label="Message"]');return value&&!value.disabled&&value;},'composer');composer.focus();composer.value=arguments[0];composer.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:arguments[0]}));(await wait(()=>button('Send message'),'Send')).click();return true;`, [content]);
    const message = await waitUntil(async () => { const value = await call(`${apiImport}return api.getConversation(arguments[0]);`, [id]); return value.messages.length > count && !['pending', 'streaming'].includes(value.messages.at(-1).status) && value.messages.at(-1); }, 'committed assistant', 30000);
    assert.equal(message.status, 'completed', message.errorMessage); return message;
  };
  const conflictVisible = async () => waitUntil(() => call(`return Array.from(document.querySelectorAll('button')).some(node=>node.textContent.trim()==='Restore transcript from chat'&&!node.disabled);`), 'watcher-driven conflict buttons', 15000);
  const conflictAction = async label => call(`${ui}(await wait(()=>button(arguments[0]),'conflict action')).click();await wait(()=>!Array.from(document.querySelectorAll('button')).some(node=>node.textContent.trim()==='Restore transcript from chat'),'conflict settled');return true;`, [label]);
  const wholeSave = async (id, messageId) => call(wholeSaveScript, [id, messageId]);
  const review = async id => call(reviewScript, [id]);
  const keep = async id => call(`${ui}const strip=await wait(()=>document.querySelector('[data-proposal-strip="active"][data-proposal-id="'+arguments[0]+'"]'),'review strip');(await wait(()=>button('Keep All',strip)??button('Keep Remaining',strip)??button('Retry',strip),'Keep or Retry')).click();return true;`, [id]);
  const shot = async name => { const path = join(root, `${name}.png`); writeFileSync(path, Buffer.from(await wd(`/session/${session.sessionId}/screenshot`, undefined, 'GET'), 'base64')); report.screenshots.push(path); };
  const closedSnapshot = (data, phase) => {
    const result = spawnSync('python3', ['-B', 'scripts/pi-prototype/verify-transcript-effects.py', data], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout); const snapshot = JSON.parse(result.stdout); writeFileSync(join(root, `${phase}-native.json`), JSON.stringify(snapshot, null, 2)); return snapshot;
  };
  const cleanStop = async () => { const receipt = await call(`${nativeImport}return invoke('prepare_restart');`); assert(receipt.ready && receipt.timelinePortable, JSON.stringify(receipt)); report.restartReceipt = receipt; await stop(); };
  try {
    await waitUntil(async () => (await fetch('http://127.0.0.1:1442/')).ok, 'owned Vite', 30000); await launch(original);
    const setup = await call(`${apiImport}${nativeImport}if((await api.listConversations()).length)throw new Error('Fresh root required');const source=await invoke('save_note',{title:'Pi transcript orchard',markdown:'The synthetic orchard has seven pear trees.',currentPath:null});await invoke('finalize_note_editing_window',{noteId:source.noteId});return {source,a:await api.createConversation({title:'Pi transcript local',vaultAccess:'full',provider:'local',model:'pi-native-fixture'}),b:await api.createConversation({title:'Pi transcript openai',vaultAccess:'full',provider:'openai',model:'pi-native-fixture'})};`);
    report.setup = setup; const vault = join(original, 'PROTOTYPE-wipe-me/vault');
    await select(setup.a.title); const hello = await send(setup.a.id, 'PI_UI:HELLO');
    const transcript = join(vault, 'Chats/Pi', setup.a.id, 'Origin.md');
    await waitUntil(() => {const bytes=readFileSync(transcript,'utf8');return bytes.includes(hello.content)&&!bytes.includes('Thought partner · pending');}, 'native committed transcript');
    const canonical = readFileSync(transcript, 'utf8'); assert(canonical.includes(`^msg_${hello.id}`));
    const baselineRequests = fixture.requests.length;
    const external = `${canonical}\n\nExternal synthetic author edit preserved 11.\n`; writeFileSync(transcript, external);
    // Do not poll getConversation here: the visible conflict must come from watcher events.
    await conflictVisible(); assert.equal(readFileSync(transcript, 'utf8'), external); await shot('external-edit');
    await conflictAction('Keep edited copy as a note');
    const copies = markdownFiles(vault).filter(path => !relative(vault, path).startsWith(`Chats${sep}`) && readFileSync(path, 'utf8').includes('External synthetic author edit preserved 11.'));
    assert.equal(copies.length, 1, 'Conversion must preserve exactly one ordinary authored copy');
    assert(readFileSync(copies[0], 'utf8').includes('Synthetic hello. Echo phrase. Echo phrase.'));
    assert.equal(readFileSync(transcript, 'utf8'), canonical, 'Conversion did not restore committed transcript');
    unlinkSync(transcript); await conflictVisible(); await conflictAction('Restore transcript from chat');
    assert.equal(readFileSync(transcript, 'utf8'), canonical); assert.equal(fixture.requests.length, baselineRequests, 'Conflict decisions dispatched inference');
    report.checks.push('native committed projection, watcher edit/delete UI, explicit Convert/Restore, preserved ordinary external copy, no inference');
    const cited = await send(setup.a.id, `PI_UI:READ:${setup.source.noteId}`); assert(cited.citations.length);
    await waitUntil(() => { const bytes=readFileSync(transcript,'utf8');return bytes.includes('Synthetic canonical orchard evidence.')&&bytes.includes('[[Pi transcript orchard|'); }, 'relative source display link');
    const saved = await wholeSave(setup.a.id, cited.id);
    await review(saved.id); await keep(saved.id);
    await waitUntil(async () => !(await call(`${apiImport}return api.listPendingProposals(arguments[0]);`, [setup.a.id])).some(value => value.id === saved.id), 'Save native receipt');
    const savedDraft = await call(`${apiImport}return api.getProposalDraft(arguments[0]);`, [saved.id]);
    const savedReceipt = await call(`${apiImport}return api.commitAgentProposal(arguments[0],arguments[1],arguments[2]);`, [saved.id,savedDraft.markdown,savedDraft.version]);
    assert(savedReceipt.applied.path && readFileSync(savedReceipt.applied.path,'utf8').includes(`[[Chats/Pi/${setup.a.id}/Origin#^msg_${cited.id}`)); report.saved = savedReceipt;
    await select(setup.b.title); await send(setup.b.id, 'PI_UI:HELLO'); await send(setup.b.id, 'PI_UI:CREATE');
    const pending = (await call(`${apiImport}return api.listPendingProposals(arguments[0]);`, [setup.b.id]))[0]; assert(pending);
    const stagedPending = await call(pendingCheckpointScript,[pending.id,'\n\nAcknowledged relocation checkpoint.','Relocated pending review']);
    await review(pending.id);
    const pendingDraft = await call(acknowledgedPendingScript,[pending.id]);
    for(const field of ['markdown','title','path'])assert.equal(pendingDraft[field],stagedPending[field],`Mounting changed pending ${field}`);
    assert(pendingDraft.decisions.length,'Mounted creation decisions must be acknowledged before relocation');
    report.pending={id:pending.id,draft:pendingDraft}; await shot('pending-review-before-move');
    // A distinct Save proposal remains accepted but its native acknowledgement is withheld.
    await select(setup.a.title);
    const uncertain=await wholeSave(setup.a.id,hello.id);
    await call(`${apiImport}await api.prototypeFault(arguments[0],'receipt-write');return true;`,[uncertain.id]);
    await review(uncertain.id); await keep(uncertain.id);
    await waitUntil(async()=> (await call(`${apiImport}return api.listPendingProposals(arguments[0]);`,[setup.a.id])).find(value=>value.id===uncertain.id&&value.status==='conflict'),'uncertain Keep acknowledgement');
    const uncertainDraft=await call(`${apiImport}return api.getProposalDraft(arguments[0]);`,[uncertain.id]);
    assert(readFileSync(uncertainDraft.path,'utf8').includes(hello.content)); report.uncertain={id:uncertain.id,draft:uncertainDraft};
    // Preserve a true transcript conflict through the move, separate from review recovery.
    await select(setup.b.title); const conflictPath=join(vault,'Chats/Pi',setup.b.id,'Origin.md');
    await waitUntil(()=>readFileSync(conflictPath,'utf8').includes('PI_UI:CREATE'),'second transcript');
    const retainedConflict=`${readFileSync(conflictPath,'utf8')}\nExternal conflict survives root relocation 11.\n`;writeFileSync(conflictPath,retainedConflict);await conflictVisible();
    const legacy=join(vault,'Chats/legacy-copied/Origin.md');mkdirSync(join(vault,'Chats/legacy-copied'),{recursive:true});writeFileSync(legacy,'# Copied legacy transcript\n\nNo Pi session or authorization is implied.\n');
    report.beforeMove={requests:fixture.requests.length,conversationIds:(await call(`${apiImport}return api.listConversations();`)).map(value=>value.id),conflictSha256:sha256(retainedConflict)};
    await cleanStop(); const before=closedSnapshot(original,'before'); report.beforeNative=before;
    renameSync(original,relocated); await launch(relocated);
    const afterLaunch=await call(`${apiImport}return {list:await api.listConversations(),a:await api.getConversation(arguments[0]),b:await api.getConversation(arguments[1]),pending:await api.getProposalDraft(arguments[2]),uncertain:await api.getProposalDraft(arguments[3])};`,[setup.a.id,setup.b.id,pending.id,uncertain.id]);
    assert.equal(fixture.requests.length,report.beforeMove.requests,'Relocation implicitly dispatched provider work');
    assert.deepEqual(afterLaunch.list.map(value=>value.id).sort(),report.beforeMove.conversationIds.sort(),'Legacy artifact imported or session lost');
    assert.equal(afterLaunch.b.status,'projectionConflict'); assert.equal(afterLaunch.b.projectionConflict,'edited');
    const movedVault=relocatedPath(vault,original,relocated), movedConflict=relocatedPath(conflictPath,original,relocated);
    assert.equal(readFileSync(movedConflict,'utf8'),retainedConflict,'Relocation overwrote external authored bytes');
    assert.deepEqual({...afterLaunch.pending,path:pendingDraft.path},pendingDraft,'Pending acknowledged review changed');
    assert.equal(afterLaunch.pending.path,relocatedPath(pendingDraft.path,original,relocated),'Pending review display location was not rebound');
    await select(setup.b.title);await conflictVisible();await shot('relocated-true-conflict');await conflictAction('Restore transcript from chat');
    await review(pending.id);await shot('relocated-pending-review');
    assert(await call(`return Array.from(document.querySelectorAll('[data-testid="note-title"]')).some(node=>node.value==='Relocated pending review')&&Array.from(document.querySelectorAll('[data-testid="note-editor"] .cm-content')).some(node=>node.textContent.includes('Acknowledged relocation checkpoint.'));`),'Pending acknowledged title/body absent from actual UI');
    await select(setup.a.title);await review(uncertain.id);await keep(uncertain.id);
    await waitUntil(async()=>!(await call(`${apiImport}return api.listPendingProposals(arguments[0]);`,[setup.a.id])).some(value=>value.id===uncertain.id),'explicit Retry Keep reconciles retained effect');
    const recovered=await call(`${apiImport}const draft=await api.getProposalDraft(arguments[0]);return api.commitAgentProposal(arguments[0],draft.markdown,draft.version);`,[uncertain.id]);
    assert.equal(recovered.status,'committed');assert.equal(recovered.applied.path,relocatedPath(uncertainDraft.path,original,relocated));report.recovered=recovered;
    const duplicate=await call(`${apiImport}return api.commitAgentProposal(arguments[0],arguments[1],arguments[2]);`,[uncertain.id,uncertainDraft.markdown,uncertainDraft.version]);assert.deepEqual(duplicate,recovered);
    // Native resolver accepts a retained old location, rejects a merely similar unknown root.
    const mapping=await call(`${nativeImport}const mapped=await invoke('pi_resolve_locations',{paths:[arguments[0]]});let rejected=false;try{await invoke('pi_resolve_locations',{paths:[arguments[1]]});}catch{rejected=true;}return {mapped,rejected};`,[setup.source.path,join(root,'unknown-vault/Source.md')]);
    assert.equal(mapping.mapped[0],relocatedPath(setup.source.path,original,relocated));assert(mapping.rejected);
    const movedOrigin=relocatedPath(transcript,original,relocated);
    assert.equal(await call(`${apiImport}return api.findConversationByProjectionPath(arguments[0]);`,[movedOrigin]),setup.a.id);
    // Use the actual inline citation button after restart, then observe the normal native editor.
    await select(setup.a.title);
    await call(`${ui}(await wait(()=>Array.from(document.querySelectorAll('button[data-slot="inline-citation"]')).find(node=>node.textContent.includes(arguments[0])),'citation')).click();await wait(()=>Array.from(document.querySelectorAll('[data-testid="note-title"]')).some(node=>node.value==='Pi transcript orchard'),'canonical source editor');return true;`,[cited.citations[0].label]);
    assert.equal(fixture.requests.length,report.beforeMove.requests,'Relocation/review/navigation dispatched inference');
    assert.equal(markdownFiles(movedVault).filter(path=>readFileSync(path,'utf8').includes('External synthetic author edit preserved 11.')).length,1);
    report.checks.push('full generated root relocation preserves sessions, source navigation, origin lookup, true transcript conflict and pending acknowledged review', 'explicit UI Retry Keep and duplicate API Keep reconcile one retained canonical effect without inference', 'native mapping binds known old root only; copied legacy artifact remains inert');
    await shot('recovered-source-navigation');await cleanStop();const after=closedSnapshot(relocated,'after');report.afterNative=after;
    const key=`${uncertain.id}:${uncertainDraft.version}`;assertRecoveredEffect(before.effects.find(value=>value.id===key),after.effects.find(value=>value.id===key));
    assert.equal(before.vaultId,after.vaultId);assert.equal(before.owner,after.owner);assert.equal(after.locations.length,2);
    assert(!fixture.requests.some(value=>value.error),'Fixture contract failure');report.status='passed';
  }catch(error){
    report.status='failed';report.error=String(error);process.exitCode=1;persist();
    if(session){
      const diagnosticWd=createWebDriverRequest(4445,3000);
      try{report.failureDOM=await diagnosticWd(`/session/${session.sessionId}/execute/sync`,{script:failureDomScript,args:[]});}
      catch(diagnosticError){report.failureDOMError=String(diagnosticError);}
      try{const path=join(root,'failure.png');writeFileSync(path,Buffer.from(await diagnosticWd(`/session/${session.sessionId}/screenshot`,undefined,'GET'),'base64'));report.screenshots.push(path);}
      catch(screenshotError){report.failureScreenshotError=String(screenshotError);}
    }
  }
  finally{persist();await stop();try{process.kill(-server.pid,'SIGTERM');}catch{}await fixture.close();console.log(JSON.stringify({status:report.status,root,evidence:reportPath,error:report.error}));}
  return report;
}
function markdownFiles(root) { return readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()&&!entry.name.startsWith('.')?markdownFiles(join(root,entry.name)):entry.isFile()&&entry.name.endsWith('.md')?[join(root,entry.name)]:[]); }
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) await runNativeTranscriptGate();
