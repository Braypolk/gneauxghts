// Current-format large fixture paint evidence. Run after `node e2e/support/buildNative.mjs --release`.
// This runner owns every native PID it interrupts. WebDriver is only transport.
import assert from 'node:assert/strict';
import { currentScaleFixture } from './currentScaleFixture.mjs';
import { nativeE2EBinary } from './nativeE2EBinary.mjs';
import { exerciseCitations } from './citationScaleInteraction.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

let binary;
const output = mkdtempSync(join(tmpdir(), 'gneauxghts-current-scale-native-'));
const events = [];
const owned = new Set();
let cancelling = false;
let cleanupPromise;
const results = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function record(kind, detail = {}) {
  const event = { at: new Date().toISOString(), kind, ...detail };
  events.push(event);
  writeFileSync(join(output, 'events.json'), JSON.stringify(events, null, 2));
  console.log(JSON.stringify(event));
}
async function until(check, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`Timed out: ${description}; ${last ?? ''}`);
}
async function request(path, body, method = 'POST') {
  const response = await fetch(`http://127.0.0.1:4445${path}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    signal: AbortSignal.timeout(180000)
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result));
  return result.value;
}
function createOwned(executable, args, env, label) {
  assert(!cancelling, "Runner is stopping; no new children may be created");
  const log = join(output, `${label}.log`);
  const fd = openSync(log, 'w');
  const child = spawn(executable, args, { env, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  owned.add(child);
  child.completion = new Promise(resolveCompletion => {
    child.once('error', error => {
      owned.delete(child);
      record('spawn-error', { label, error: String(error) });
      resolveCompletion({ error: String(error) });
    });
    child.once('exit', (code, signal) => {
      owned.delete(child);
      record('exit', { label, pid: child.pid, code, signal });
      resolveCompletion({ code, signal });
    });
  });
  record('spawn', { label, pid: child.pid, executable, args, log });
  return child;
}
async function stop(child, signal = 'SIGKILL') {
  if (child.stopping) return child.stopping;
  child.stopping = stopOwned(child, signal);
  return child.stopping;
}
async function stopOwned(child, signal) {
  assert(owned.has(child), 'Only an owned, still-running child may be interrupted');
  record('interrupt', { pid: child.pid, signal });
  assert(child.kill(signal));
  const exit = await Promise.race([child.completion, delay(10000).then(() => { throw new Error('Owned process failed to exit'); })]);
  if (signal === 'SIGKILL') assert.equal(exit.signal, 'SIGKILL');
  return exit;
}
function listenerPids(port) {
  try { return [...new Set(execFileSync('/usr/sbin/lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean).map(Number))]; }
  catch (error) { if (error.status === 1 && !error.stdout?.length) return []; throw error; }
}
async function connect(child) {
  await until(async () => {
    assert(owned.has(child));
    const listeners = listenerPids(4445);
    if (!listeners.length) return false;
    assert.deepEqual(listeners, [child.pid], 'Embedded listener must belong to the exact owned native child');
    return (await request('/status', undefined, 'GET')).ready;
  }, 'owned embedded WebDriver');
  assert.deepEqual(listenerPids(4445), [child.pid]);
  record('listener-owned', { pid: child.pid, port: 4445 });
  const session = await request('/session', { capabilities: { alwaysMatch: { browserName: 'tauri' } } });
  const sessionId = session.sessionId;
  record('session', { pid: child.pid, sessionId });
  const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args });
  const invoke = async (command, args = {}) => {
    const result = await request(`/session/${sessionId}/execute/async`, {
      script: 'const done = arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(value => done({ok:true,value}), error => done({ok:false,error}));',
      args: [command, args]
    });
    assert(result.ok, `${command}: ${JSON.stringify(result.error)}`);
    return result.value;
  };
  await until(() => execute('return !!window.__TAURI_INTERNALS__ && !!document.querySelector("[data-testid=note-editor]");'), 'native frontend', 120000);
  const vault = await invoke('get_vault_info');
  assert.equal(realpathSync(vault.runningPath), realpathSync(join(child.fixtureRoot, 'vault')), 'Production running vault must be the disposable fixture before any write');
  record('vault-bound', { pid: child.pid, root: vault.runningPath, launcherElapsedMs: performance.now() - child.launchedAt });
  await invoke('plugin:window|show', { label: 'main' });
  await invoke('plugin:window|set_focus', { label: 'main' });
  await until(() => execute('return document.visibilityState === "visible" && document.hasFocus();'), 'genuinely visible, focused webview');
  const visibility = await execute('return {visibility:document.visibilityState,focus:document.hasFocus(),href:location.href};');
  record('visible', { pid: child.pid, ...visibility });
  return { invoke, execute, child, sessionId, asyncExecute: (script,args=[]) => request(`/session/${sessionId}/execute/async`, {script,args}) };
}
function launch(root) {
  const launchedAt = performance.now();
  const child = createOwned(binary, ['--e2e-app-data-root', join(root,'data'),'--e2e-documents-root',join(root,'documents'),'--e2e-vault-root',join(root,'vault')],
    {...process.env,WDIO_EMBEDDED_SERVER:'true',TAURI_WEBDRIVER_PORT:'4445'},'native-scale');
  child.fixtureRoot = root;
  child.launchedAt = launchedAt;
  return child;
}
async function interaction(client, action, revisionId='') {
  await client.invoke('plugin:window|show',{label:'main'});
  await client.invoke('plugin:window|set_focus',{label:'main'});
  await until(()=>client.execute('return document.visibilityState === "visible" && document.hasFocus();'),'visible focused paint surface');
  const result = await client.asyncExecute(`
    const [action,revisionId] = arguments, done=arguments[arguments.length-1];
    let stage='mutation', observer, finished=false;
    const finish=result=>{if(finished)return;finished=true;observer?.disconnect();clearTimeout(timeout);done(result);};
    const timeout=setTimeout(()=>finish({error:action+' stalled at '+stage+'; visibility='+document.visibilityState}),15000);
    const beforeCount=Number(document.querySelector('aside[aria-label="Note timeline"]')?.dataset.historyRecordCount??0);
    const button=action==='entry'?document.querySelector('button[aria-label="Open note history"]'):action==='page'?[...document.querySelectorAll('aside button')].find(b=>b.textContent?.trim()==='Load older history'):document.querySelector('[data-revision-id="'+revisionId+'"]');
    if(!button||button.disabled){finish({error:'Missing enabled '+action});return;}
    const started=performance.now();
    observer=new MutationObserver(()=>{
      const timeline=document.querySelector('aside[aria-label="Note timeline"]');
      const ready=action==='page'?Number(timeline?.dataset.historyRecordCount??0)>beforeCount&&timeline?.getAttribute('aria-busy')==='false':!!document.querySelector('[data-testid="history-mode"] [data-testid="historical-revision-diff"] [data-diff-kind]')&&(action==='entry'||(button.getAttribute('aria-pressed')==='true'&&!button.disabled));
      if(!ready)return;observer.disconnect();stage='paint';
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        const visibility=document.visibilityState,focus=document.hasFocus();
        finish({elapsed:performance.now()-started,visibility,focus,...(visibility!=='visible'||!focus?{error:'Native paint lost visibility or focus'}:{})});
      }));
    });
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});button.click();
  `,[action,revisionId]);
  assert(!result.error,result.error);
  record('paint-surface',{action,revisionId,visibility:result.visibility,focus:result.focus});
  return result.elapsed;
}
async function startup(client,note) {
  // This clone is exclusively for startup/input/save; retained-history paint
  // and citation measurements use different pristine clones.
  const before=await client.execute('return window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState();');
  assert.equal(before.noteId,note.noteId);
  const sentinel=' Issue55 startup input';
  const notePath=join(client.child.fixtureRoot,'vault',note.title+'.md');
  const canonicalBefore=readFileSync(notePath,'utf8');
  const initialReadiness=await client.invoke('get_history_readiness',{noteId:note.noteId});
  await client.execute('return window.__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(0,0);');
  const element=await request(`/session/${client.sessionId}/element`,{using:'css selector',value:'[data-testid="note-editor"] .cm-content'});
  const id=element['element-6066-11e4-a52e-4f735466cecf'];
  assert(id);
  const inputStart=performance.now();
  await request(`/session/${client.sessionId}/element/${id}/value`,{text:sentinel,value:[...sentinel]});
  const typed=await until(()=>client.execute('const s=window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState();return s.editor?.markdown.includes(arguments[0])?s:null;',[sentinel]),'actual native keyboard text');
  assert(typed.editor.markdown.includes(sentinel));
  const frame=await client.asyncExecute('const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(()=>done({at:performance.now(),visibility:document.visibilityState,focus:document.hasFocus(),state:window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState()})));');
  assert.equal(frame.visibility,'visible');assert(frame.focus);assert(frame.state.editor.ownsWebviewFocus);
  record('usable-workspace-actual-input',{launcherElapsedMs:performance.now()-client.child.launchedAt,inputRoundTripMs:performance.now()-inputStart,frontend:frame,initialReadiness});
  // Real editor autosave must publish changed Markdown; reading the owned file
  // observes the authoritative result without another save or history preflight.
  await until(()=>readFileSync(notePath,'utf8').includes(sentinel),'real editor save reaches canonical bytes',120000);
  const canonicalAfter=readFileSync(notePath,'utf8');
  assert.notEqual(canonicalAfter,canonicalBefore);
  await until(()=>client.execute('return window.__GNEAUXGHTS_STARTUP__.marks.some(m=>m.name==="editor-save-ipc-resolved");'),'authoritative save result');
  const saveMarks=await client.execute('return window.__GNEAUXGHTS_STARTUP__.marks.filter(m=>m.name.startsWith("editor-save-ipc"));');
  assert(saveMarks.filter(m=>m.name==='editor-save-ipc-resolved').every(m=>m.detail.noteId===note.noteId&&!m.detail.commitWarning));
  record('editor-save-ipc', {saveMarks});
  record('canonical-editor-save-observed',{launcherElapsedMs:performance.now()-client.child.launchedAt,beforeSha256:sha256(Buffer.from(canonicalBefore)),afterSha256:sha256(Buffer.from(canonicalAfter)),readiness:await client.invoke('get_history_readiness',{noteId:note.noteId})});
  await until(async()=>{const r=await client.invoke('get_history_readiness',{noteId:note.noteId});assert(!['corrupt','unavailable'].includes(r.state));return r.backgroundComplete;},'whole-history background completion',180000);
  const frontend=await client.execute('return window.__GNEAUXGHTS_STARTUP__;');
  writeFileSync(join(output,'startup.json'),JSON.stringify({note,initialReadiness,frontend,launcherElapsedMs:performance.now()-client.child.launchedAt,clockScope:'frontend performance.now relative to frontend timeOrigin; launcher elapsed relative to spawn; never subtract these clocks',canonicalBeforeSha256:sha256(Buffer.from(canonicalBefore)),canonicalAfterSha256:sha256(Buffer.from(canonicalAfter))},null,2));
  results.push({name:'startup_actual_input_save_background',passed:true,frontend});
}
async function cleanup() {
  cancelling=true;
  cleanupPromise??=(async()=>{for(const child of [...owned]){try{await stop(child);}catch(error){failure??=String(error);record('cleanup-failure',{error:String(error)});}}})();
  return cleanupPromise;
}
let failure;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{
  failure=`Runner cancelled by ${signal}`;record('runner-cancelled',{signal});await cleanup();
  writeFileSync(join(output,'results.json'),JSON.stringify({passed:false,failure,results,events},null,2));process.exit(signal==='SIGINT'?130:143);
});
try {
  assert(process.env.GNEAUXGHTS_SCALE_NATIVE_BINARY, 'An explicit pinned native E2E executable is required');
  const admitted=nativeE2EBinary('release', process.env.GNEAUXGHTS_SCALE_NATIVE_BINARY);
  binary=admitted.binary;
  const {root,marker,fixture}=currentScaleFixture(process.argv[2]);
  record('run-start',{output,root,binary,binarySha256:admitted.sha256,buildManifest:admitted.manifest,fixture:marker,notes:fixture.notes.length});
  const lock=execFileSync('ioreg',['-n','Root','-d','1'],{encoding:'utf8'});writeFileSync(join(output,'display-state.log'),lock);
  assert(/IOConsoleLocked"\s*=\s*No/.test(lock)&&!/CGSSessionScreenIsLocked"\s*=\s*Yes/.test(lock),'Unlock display before native paint');
  if(process.env.GNEAUXGHTS_CITATION_SELECTIONS)createOwned('/usr/bin/caffeinate',['-di'],process.env,'citation-display-assertion');
  for(const port of [1430,4445])assert.deepEqual(listenerPids(port),[],`Port ${port} occupied`);
  createOwned(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'preview','--strictPort','--host','127.0.0.1','--port','1430'],process.env,'vite-preview');
  await until(async()=>(await fetch('http://127.0.0.1:1430')).ok,'owned Vite preview');
  mkdirSync(join(root,'documents'),{recursive:true});
  const child=launch(root), client=await connect(child);
  const note=fixture.notes[0];
  assert.equal(fixture.activeNoteId,note.noteId,'Master must persist the hot note as active');
  await until(()=>client.execute('return window.__GNEAUXGHTS_NATIVE_E2E__?.readEditorState()?.noteId === arguments[0] && !!window.__GNEAUXGHTS_NATIVE_E2E__?.readEditorState()?.editor;',[note.noteId]),'restored hot-note editor');
  record('startup-before-history',{launcherElapsedMs:performance.now()-child.launchedAt,frontend:await client.execute('return window.__GNEAUXGHTS_STARTUP__;')});
  if(process.env.GNEAUXGHTS_STARTUP_ONLY==='true') {
    await startup(client,note);
  } else {
  const page=await client.invoke('get_note_history_page',{noteId:note.noteId,cursor:null,limit:30});
  assert.equal(page.records.length,30);
  assert(page.records.every(r=>r.timeKind==='editingWindow'));
  await until(()=>client.execute('return document.querySelector("[data-testid=note-title]")?.value === arguments[0];',[note.title]),'fixture note open');
  if (process.env.GNEAUXGHTS_CITATION_SELECTIONS) {
    const selections=JSON.parse(readFileSync(process.env.GNEAUXGHTS_CITATION_SELECTIONS,'utf8')).filter(row=>row.note_id===note.noteId);
    assert(selections.length>0,'Need identity-bound citation selections for this fixture');
    const samples=await exerciseCitations(client,record,note,selections);
    for(const action of ['entry','older','newer']) {
      const raw_ms=samples.filter(row=>row.action===action).map(row=>row.elapsed),ordered=[...raw_ms].sort((a,b)=>a-b);
      const p95=ordered[Math.ceil(ordered.length*.95)-1];
      const result={name:'citation_'+action,raw_ms,p95_ms:p95,budget_ms:250,passed:p95<250,samples:samples.filter(row=>row.action===action),scope:'actual chat citation binding → History Mode; immutable old target; bounded rows; visible/focused final frames'};
      results.push(result);record('metric',result);
    }
  } else {
  const entries=[],pages=[],diffs=[];
  for(let sample=0;sample<5;sample++) {
    entries.push(await interaction(client,'entry'));
    pages.push(await interaction(client,'page'));
    assert.equal(await client.execute('return document.querySelectorAll("[data-revision-id]").length;'),60);
    const revision=await client.execute('return [...document.querySelectorAll("[data-revision-id]")].find(b=>b.getAttribute("aria-pressed")!=="true").dataset.revisionId;');
    diffs.push(await interaction(client,'diff',revision));
    await client.execute('document.querySelector("button[aria-label=\\"Back to workspace\\"]").click();return true;');
    await until(()=>client.execute('return !document.querySelector("[data-testid=history-mode]");'),'history exit');
    record('sample',{sample,entry:entries.at(-1),page:pages.at(-1),diff:diffs.at(-1),revision});
  }
  for(const [name,raw_ms] of [['entry',entries],['page30',pages],['diff',diffs]]) {
    const ordered=[...raw_ms].sort((a,b)=>a-b),p95=ordered[Math.ceil(ordered.length*.95)-1];
    const result={name,raw_ms,p95_ms:p95,budget_ms:250,passed:p95<250,scope:'64 KiB hot note with 10000 revisions; optimized native Rust + IPC + ready DOM + two animation frames; warm operations'};
    results.push(result);record('metric',result);
  }
  }
  }
  assert(results.every(r=>r.passed),'Current scale native paint budget exceeded');
} catch(error) {failure=String(error.stack??error);record('failure',{error:failure});}
finally {await cleanup();writeFileSync(join(output,'results.json'),JSON.stringify({passed:!failure,failure,results,events},null,2));console.log(`CURRENT_SCALE_NATIVE_EVIDENCE ${output}`);}
process.exitCode=failure?1:0;
