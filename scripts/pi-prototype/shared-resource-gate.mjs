// Prepared native-owner gate. Importing this module runs no app, process or port.
// CLI execution drives only generated roots and explicitly pinned artifacts.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, realpathSync, mkdirSync, openSync, closeSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createWebDriverRequest, waitUntil, listenerPids } from '../../e2e/support/nativeTransport.mjs';

export const DUMMY_AUTHORIZATION = 'Bearer gneauxghts-resource-fixture-dummy';
export const OLD_SHA256 = '435669a2fe3bd7b3d8baf32bff164c399a3fe68961660291a477ca6a03ce36f3';
const hash = value => createHash('sha256').update(value).digest('hex');
const writeNew = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

export function frontendSourceDigest(source) {
  const result=createHash('sha256');
  const visit=(relative)=>{const path=join(source,relative);if(!existsSync(path))return;
    const stat=lstatSync(path);assert(!stat.isSymbolicLink(),'Frontend input symlink refused');
    if(stat.isDirectory()){for(const name of readdirSync(path).sort())visit(join(relative,name));}
    else {assert(stat.isFile(),'Frontend input special file refused');result.update(JSON.stringify([relative,hash(readFileSync(path))])+'\n');}};
  for(const path of ['src','static','package.json','pnpm-lock.yaml','vite.config.js','vite.config.ts','svelte.config.js','tsconfig.json'])visit(path);
  return result.digest('hex');
}

export function planSharedReply(body, authorization) {
  assert(authorization === undefined || authorization === DUMMY_AUTHORIZATION, 'Unexpected fixture authorization');
  assert(Array.isArray(body.messages), 'Compatible protocol history required');
  const user = body.messages.findLast(message => message.role === 'user');
  const prompt = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content ?? []);
  if (prompt.includes('RESOURCE_FOLLOWUP')) {
    assert(body.messages.slice(0, -1).some(message => message.role === 'assistant' && JSON.stringify(message.content).includes('Shared synthetic answer')), 'Follow-up omitted prior source-free answer');
    return { case: 'followup', text: 'Shared synthetic follow-up.', pause: false };
  }
  if (prompt.includes('RESOURCE_STOP')) return { case: 'cancel', text: 'Shared acknowledged partial.', pause: true };
  if (prompt.includes('RESOURCE_HELLO')) return { case: 'short', text: 'Shared synthetic answer.', pause: false };
  // Local model metadata/title requests are bounded fixture operations, not live
  // inference. Unknown prompts are refused rather than falsely passing a journey.
  throw new Error('Unknown synthetic journey');
}

export function cleanEnvironment(path, lane) {
  // Exact overrides stop debug builds from reading any actual provider key.
  // No inherited secret/configuration variables are copied into children.
  return { PATH: path, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    OPENAI_API_KEY: DUMMY_AUTHORIZATION.slice(7), GNEAUXGHTS_LOCAL_API_KEY: DUMMY_AUTHORIZATION.slice(7),
    VITE_E2E_NATIVE: 'true', WDIO_EMBEDDED_SERVER: 'true', TAURI_WEBDRIVER_PORT: '4445',
    ...(lane === 'pi' ? { VITE_PI_PROTOTYPE: 'true', PI_PROTOTYPE_HTTP_FIXTURE: 'http://127.0.0.1:1443' } : {}) };
}

export async function startSharedFixture() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const startMs = performance.now();
    let record;
    try {
      assert(req.headers.authorization === undefined || req.headers.authorization === DUMMY_AUTHORIZATION, 'Unexpected fixture authorization');
      if (req.method === 'GET') {
        assert(req.url?.includes('models'), 'Unknown fixture metadata route');
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ object: 'list', data: [{ id: 'pi-native-fixture', object: 'model', type: 'llm', max_context_length: 8192 }] }));
      }
      assert(req.method === 'POST' && req.url === '/local/v1/chat/completions', 'Unknown fixture route');
      let raw = ''; for await (const chunk of req) { raw += chunk; assert(Buffer.byteLength(raw) <= 262144, 'Fixture request too large'); }
      const body = JSON.parse(raw), reply = planSharedReply(body, req.headers.authorization);
      record = { index: requests.length, case: reply.case, startMs, endMs: null,
        requestBytes: Buffer.byteLength(raw), frames: 0, frameBytes: 0, completed: false, failed: false };
      requests.push(record);
      res.on('close', () => { record.endMs ??= performance.now(); });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = value => {
        const frame = `data: ${JSON.stringify(value)}\n\n`;
        record.frames++; record.frameBytes += Buffer.byteLength(frame); res.write(frame);
      };
      const chunk = (delta, finish_reason = null) => ({ id: `shared-${record.index}`, object: 'chat.completion.chunk',
        created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] });
      send(chunk({ role: 'assistant' })); await delay(20);
      if (res.destroyed) return;
      send(chunk({ content: reply.text }));
      if (reply.pause) await new Promise(done => {const timer=setTimeout(done,30000);res.once('close',()=>{clearTimeout(timer);done()})});
      if (res.destroyed) return;
      await delay(20); send(chunk({}, 'stop'));
      record.frames++; record.frameBytes += Buffer.byteLength('data: [DONE]\n\n');
      record.completed = true; record.endMs = performance.now(); res.end('data: [DONE]\n\n');
    } catch {
      if (record) record.failed = true;
      else requests.push({ index: requests.length, case: 'refused', startMs, endMs: performance.now(), failed: true });
      if (!res.headersSent) res.writeHead(500);
      res.end('Synthetic fixture refused');
    }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(1443, '127.0.0.1', ok); });
  return { requests, close: () => new Promise(ok => { server.close(ok); server.closeAllConnections(); }) };
}

export function parseArguments(argv) {
  const required = ['root', 'old-source', 'pi-source', 'old-binary', 'pi-binary', 'pi-sha256'];
  const allowed = [...required,'first','old-sha256'];
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    assert(allowed.includes(key) && !options[key] && argv[index + 1], 'Invalid gate arguments');
    options[key] = argv[index + 1];
  }
  assert(required.every(key => options[key]), 'Explicit roots, sources, binaries and Pi digest required');
  assert(options.first===undefined||['old','pi'].includes(options.first),'Invalid alternating lane order');
  assert(/^[a-f0-9]{64}$/.test(options['pi-sha256']), 'Invalid Pi binary digest');
  options['old-sha256'] ??= OLD_SHA256;
  assert(/^[a-f0-9]{64}$/.test(options['old-sha256']), 'Invalid old binary digest');
  for (const key of required.filter(key => key !== 'pi-sha256')) assert(options[key] === resolve(options[key]), 'Canonical absolute paths required');
  assert(!existsSync(options.root), 'Fresh generated output root required');
  assert(hash(readFileSync(options['old-binary'])) === options['old-sha256'], 'Pinned old artifact differs');
  assert(hash(readFileSync(options['pi-binary'])) === options['pi-sha256'], 'Pinned Pi artifact differs');
  for (const key of ['old-source', 'pi-source']) {
    assert(realpathSync(options[key]) === options[key], 'Canonical source path required');
    for(const name of ['.env','.env.local','.env.development','.env.development.local'])assert(!existsSync(join(options[key],name)),'Vite environment-file source refused; use a sealed source snapshot without secrets');
  }
  return options;
}

const browserSetup = `
  window.__resourceApi=(await import('/src/lib/features/chat/api.ts')).chatApi;
  const native=window.__TAURI_INTERNALS__;
  if(!native || !document.querySelector('[data-testid="workspace-pane"]'))throw new Error('Native workspace required');
  if(!window.__resourceInvoke){window.__resourceInvoke=native.invoke.bind(native);native.invoke=async(command,args,...rest)=>{
    const atMs=performance.now();const size=value=>{try{return new TextEncoder().encode(JSON.stringify(value??null)).length}catch{return null}};
    const row={kind:'ipc',atMs,category:command==='pi_sql'?'sqlite':command.startsWith('pi_provider')?'provider':'domain',requestBytes:size(args),responseBytes:null};
    window.__resourceIpc?.push(row);const result=await window.__resourceInvoke(command,args,...rest);row.responseBytes=size(result);return result;
  };}
  window.__resourceIpc=[];
  const api=window.__resourceApi;const {atlasVisibility,...defaults}=await api.getSettings();
  await api.setDefaults({...defaults,provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',
    localBaseUrl:'http://127.0.0.1:1443/local/v1',reasoningEffort:'off',defaultVaultAccess:'none'});
  return true;`;

const browserSelect = `
  const [id]=arguments;const api=window.__resourceApi;
  const pause=()=>new Promise(ok=>setTimeout(ok,50));
  const until=async fn=>{const end=performance.now()+30000;while(performance.now()<end){const value=await fn();if(value)return value;await pause()}throw new Error('UI deadline')};
  const button=label=>Array.from(document.querySelectorAll('button')).find(node=>!node.disabled&&(node.getAttribute('aria-label')===label||node.textContent.trim()===label));
  if(!document.querySelector('[aria-label="Thought partner chat"]'))(await until(()=>button('Open thought partner'))).click();
  await until(()=>document.querySelector('[aria-label="Thought partner chat"]'));
  const chat=await api.getConversation(id);
  if(document.querySelector('[aria-label="Chat title"]')?.value!==chat.title){
    (await until(()=>button('Conversations'))).click();
    (await until(()=>Array.from(document.querySelectorAll('[role="menuitem"]')).find(node=>node.textContent.trim()===chat.title))).click();
  }
  await until(()=>document.querySelector('[aria-label="Chat title"]')?.value===chat.title);
  await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));return true;`;

const browserSend = `
  const [id,prompt,cancel]=arguments,api=window.__resourceApi;
  const pause=()=>new Promise(ok=>setTimeout(ok,50));
  const until=async fn=>{const end=performance.now()+45000;while(performance.now()<end){const value=await fn();if(value)return value;await pause()}throw new Error('Scenario deadline')};
  const before=(await api.getConversation(id)).messages.length;
  const button=label=>Array.from(document.querySelectorAll('button')).find(node=>!node.disabled&&(node.getAttribute('aria-label')===label||node.textContent.trim()===label));
  const field=await until(()=>{const value=document.querySelector('textarea[aria-label="Message"]');return value&&!value.disabled&&value});
  field.focus();field.value=prompt;field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:prompt}));
  window.__resourceIpc=[];const events=[{kind:'send',atMs:performance.now()}];(await until(()=>button('Send message'))).click();
  const admitted=await until(async()=>{const chat=await api.getConversation(id);return chat.messages.length>before&&chat.messages.at(-1)});
  await until(()=>document.querySelector('[data-chat-message-id="'+admitted.id+'"]')?.textContent?.includes(cancel?'Shared acknowledged partial.':prompt.includes('FOLLOWUP')?'Shared synthetic follow-up.':'Shared synthetic answer.'));
  await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));events.push({kind:'first_visible',atMs:performance.now()});
  if(cancel){events.push({kind:'cancel_request',atMs:performance.now()});(await until(()=>button('Stop response'))).click()}
  const terminal=await until(async()=>{const chat=await api.getConversation(id);const message=chat.messages.find(row=>row.id===admitted.id);return message&&!['pending','streaming'].includes(message.status)&&!chat.activeRequestId&&message});
  if(!cancel&&terminal.status!=='completed')throw new Error('Scenario did not complete');
  if(cancel&&terminal.status==='completed')throw new Error('Stop announced completion');
  await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));events.push({kind:cancel?'cancel_settled':'terminal',atMs:performance.now()});
  const ipc=window.__resourceIpc.slice();window.__resourceIpc=[];
  return {events,ipc,terminalStatus:terminal.status,messageCount:(await api.getConversation(id)).messages.length};`;

export async function runSharedResourceGate(options) {
  for (const port of [1430, 1442, 1443, 4445]) assert.equal(listenerPids(port).length, 0, 'Required port has another owner');
  mkdirSync(options.root, { recursive: false, mode: 0o700 });
  const fixture = await startSharedFixture();
  const report = { schema: 'gneauxghts-shared-resource-gate-v1', status: 'running', lanes: [],
    limits: ['Prepared core compatible-fixture gate; no live/Responses/scale/source/review/Save acceptance.',
      'Renderer/helper RSS unknown; app RSS sampled only. Startup invoke coverage incomplete.',
      'UI detection polls at 50ms then waits two frames; provider/renderer clock calibration has recorded round-trip uncertainty.',
      'Observer getConversation calls contribute to IPC/latency; no performance win/adoption verdict.'], verdict: 'unproven-pending-acceptance' };
  try {
    for (const lane of (options.first==='pi'?['pi','old']:['old','pi'])) {
      const source = options[`${lane}-source`], binary = options[`${lane}-binary`], laneRoot = join(options.root, lane);
      mkdirSync(laneRoot, { mode: 0o700 });
      const dataRoot = join(laneRoot, 'data');mkdirSync(dataRoot, { mode: 0o700 });
      const env = cleanEnvironment(process.env.PATH, lane), port = lane === 'old' ? 1430 : 1442;
      const output = { lane, binarySha256: hash(readFileSync(binary)), status: 'running', journeys: [],
        frontendSourceSha256: frontendSourceDigest(source), lockfileSha256: hash(readFileSync(join(source,'pnpm-lock.yaml'))),
        frontendReceiptVerified: false, rendererRssBytes: null, allProcessRssBytes: null,
        startupIpcCoverage: 'unknown', protocol: 'compatible', provider: 'fixture', profile: 'debug' };
      report.lanes.push(output);
      let app, server, session, timer, rss = [], pinnedStart;
      const wd = createWebDriverRequest(4445, 60000);
      const execute = async (script, args = []) => {
        const result = await wd(`/session/${session.sessionId}/execute/async`, {script:
          `const done=arguments[arguments.length-1];(async function(){${script}}).apply(null,Array.from(arguments).slice(0,-1)).then(value=>done({ok:true,value}),()=>done({ok:false}));`,args});
        assert(result.ok, 'Owned browser scenario failed');return result.value;
      };
      const sampleApp = () => {
        try {
          const raw = execFileSync('/bin/ps', ['-p', String(app.pid), '-o', 'pid=,rss=,lstart='], { encoding: 'ascii', env: { LC_ALL: 'C' }, timeout: 2000 }).trim().split(/\s+/);
          assert(Number(raw[0]) === app.pid && /^\d+$/.test(raw[1]), 'Process sample invalid');
          const start = hash(raw.slice(2).join(' '));pinnedStart ??= start;assert(start === pinnedStart, 'Owned PID reused');
          rss.push({kind:'rss',atMs:performance.now(),bytes:Number(raw[1])*1024});
        } catch { output.processSamplingIncomplete = true; }
      };
      const launch = async () => {
        const log = openSync(join(laneRoot, `native-${output.journeys.length}.log`), 'a', 0o600);
        const start = performance.now();app=spawn(binary,['--e2e-app-data-root',dataRoot,'--e2e-documents-root',dataRoot],{cwd:source,env,stdio:['ignore',log,log]});closeSync(log);
        rss=[];pinnedStart=undefined;sampleApp();timer=setInterval(sampleApp,100);
        await waitUntil(async()=>{try{return(await wd('/status',undefined,'GET')).ready}catch{return false}},'owned native driver',30000);
        session=await wd('/session',{capabilities:{alwaysMatch:{browserName:'tauri'}}});
        await wd(`/session/${session.sessionId}/timeouts`,{script:60000});
        await waitUntil(async()=>{try{return await execute(`if(!document.querySelector('[data-testid="workspace-pane"]'))return false;await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));return true;`)}catch{return false}},'usable workspace',45000,100);
        const end = performance.now();
        output.journeys.push({scenario:'startup',cache:'cold-process',startupKind:output.journeys.length?'restart':'initial',osCache:'uncontrolled',events:[{kind:'launch',atMs:0},{kind:'workspace_visible',atMs:end-start},...rss.filter(row=>row.atMs>=start&&row.atMs<=end).map(row=>({...row,atMs:row.atMs-start}))].sort((a,b)=>a.atMs-b.atMs),ipcCoverage:'unknown',providerCoverage:'unknown',pollingUncertaintyMs:100});
        await execute(browserSetup);
      };
      const stop = async signal => {
        clearInterval(timer);timer=undefined;
        if(session){try{await wd(`/session/${session.sessionId}`,undefined,'DELETE')}catch{}session=undefined}
        if(app&&app.exitCode===null){app.kill(signal);await Promise.race([new Promise(ok=>app.once('exit',ok)),delay(5000)]);if(app.exitCode===null)app.kill('SIGKILL')}
      };
      try {
        const fd=openSync(join(laneRoot,'frontend.log'),'a',0o600);
        server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:source,env,stdio:['ignore',fd,fd],detached:true});closeSync(fd);
        await waitUntil(async signal=>(await fetch(`http://127.0.0.1:${port}/`,{signal})).ok,'owned frontend',30000);
        await launch();
        const id=await execute(`return(await window.__resourceApi.createConversation({title:'Shared resource conversation',provider:'local',model:'pi-native-fixture',reasoningEffort:'off',vaultAccess:'none'})).id;`);
        // Reload refreshes the normal controller after API-only synthetic setup.
        await wd(`/session/${session.sessionId}/execute/sync`,{script:'location.reload();return true',args:[]});
        await waitUntil(async()=>{try{return await execute(browserSetup)}catch{return false}},'normal reloaded workspace',30000);
        await execute(browserSelect,[id]);
        for(const [scenario,prompt,cancel] of [['short','RESOURCE_HELLO',false],['followup','RESOURCE_FOLLOWUP',false],['cancel','RESOURCE_STOP',true]]){
          const firstRequest=fixture.requests.length;
          const before=performance.now(),renderer=await execute('return performance.now();'),after=performance.now();
          const rendererZero=(before+after)/2-renderer;
          const result=await execute(browserSend,[id,prompt,cancel]);
          if(cancel)await waitUntil(()=>fixture.requests.slice(firstRequest).every(row=>row.endMs!==null),'cancelled transport settlement',5000);
          const events=[...result.events,...result.ipc].map(row=>({...row,atMs:row.atMs+rendererZero}));
          const bounds=result.events.map(row=>row.atMs+rendererZero),start=bounds[0],end=bounds.at(-1);
          const requests=fixture.requests.slice(firstRequest);
          const serverComplete=requests.length>0&&requests.every(row=>!row.failed&&row.endMs!==null&&row.startMs>=start&&row.endMs<=end);
          for(const row of requests){if(row.startMs>=start)events.push({kind:'provider_start',atMs:row.startMs,dispatch:row.index});if(row.endMs!==null&&row.endMs>=start)events.push({kind:'provider_end',atMs:row.endMs,dispatch:row.index})}
          events.push(...rss.filter(row=>row.atMs>=start&&row.atMs<=end));
          output.journeys.push({scenario,cache:'warm-process',events:events.map(row=>({...row,atMs:row.atMs-start})).sort((a,b)=>a.atMs-b.atMs),ipcCoverage:'complete',providerCoverage:'partial',serverIntervalCoverage:serverComplete?'complete':'partial',
            terminalStatus:result.terminalStatus,messageCount:result.messageCount,clockCalibrationUncertaintyMs:(after-before)/2,pollingUncertaintyMs:50,
            providerFrames:requests.reduce((sum,row)=>sum+(row.frames??0),0),providerFrameBytes:requests.reduce((sum,row)=>sum+(row.frameBytes??0),0)});
        }
        const beforeRestart=fixture.requests.length;await stop('SIGKILL');await launch();await delay(1000);
        assert.equal(fixture.requests.length,beforeRestart,'Restart silently replayed inference');
        await execute(browserSelect,[id]);
        output.restart={noImplicitRequests:true,messageCount:await execute('return(await window.__resourceApi.getConversation(arguments[0])).messages.length;',[id])};
        assert.equal(output.restart.messageCount,6,'Committed history did not survive restart');
        output.status='passed-core-fixture';
      } finally {
        await stop('SIGTERM');if(server){try{process.kill(-server.pid,'SIGTERM')}catch{}}
      }
      assert.equal(hash(readFileSync(binary)),output.binarySha256,'Measured binary changed');
      assert.equal(frontendSourceDigest(source),output.frontendSourceSha256,'Served frontend changed during capture');
    }
    assert(!fixture.requests.some(row=>row.failed),'Fixture refused a request');report.status='passed-core-fixture';
  } catch {
    report.status='failed';process.exitCode=1;
  } finally {
    report.providerRequests=fixture.requests;await fixture.close();writeNew(join(options.root,'shared-resource-gate.json'),report);
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const report=await runSharedResourceGate(parseArguments(process.argv.slice(2)));console.log(JSON.stringify({status:report.status,verdict:report.verdict})); }
  catch { console.error('Shared resource gate refused (invalid artifacts, ownership or prerequisites)');process.exitCode=1; }
}
