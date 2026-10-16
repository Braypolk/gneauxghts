// Prepared native-owner driver. Importing performs no launch or port operation.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {existsSync,readFileSync,writeFileSync,mkdirSync,openSync,closeSync,realpathSync,readdirSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {DUMMY_AUTHORIZATION,cleanEnvironment,frontendSourceDigest} from './shared-resource-gate.mjs';
import {stopOwnedParityChild} from './paired-parity-lifecycle.mjs';
import {createWebDriverRequest,listenerPids,waitUntil} from '../../e2e/support/nativeTransport.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const writeNew=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});

export function planProductScaleReply(body,authorization){
  assert(authorization===undefined||authorization===DUMMY_AUTHORIZATION,'Unexpected fixture authorization');
  assert(Array.isArray(body.messages),'Compatible history required');
  const last=body.messages.findLast(row=>row.role==='user');
  const content=typeof last?.content==='string'?last.content:JSON.stringify(last?.content??[]);
  const matches=[...content.matchAll(/PRODUCT_SCALE_INPUT_(\d+)\./g)];
  assert(matches.length===1,'Exactly one synthetic input required');
  const index=Number(matches[0][1]);assert(Number.isInteger(index)&&index>=0&&index<1100,'Bounded synthetic input required');
  if(index>0)assert(body.messages.some(row=>row.role==='assistant'&&JSON.stringify(row.content).includes(`Synthetic product scale reply ${index-1}.`)),'Previous committed answer missing from provider history');
  return {index,text:`Synthetic product scale reply ${index}.`};
}

export function productStorageSnapshot(root){
  const counts={files:0,bytes:0,sqliteBytes:0,walBytes:0,shmBytes:0,markdownFiles:0,markdownBytes:0,otherBytes:0};
  const walk=path=>{const stat=lstatSync(path);assert(!stat.isSymbolicLink(),'Generated storage symlink refused');
    if(stat.isDirectory()){for(const name of readdirSync(path))walk(join(path,name));return}
    assert(stat.isFile(),'Generated special file refused');counts.files++;counts.bytes+=stat.size;
    if(path.endsWith('-wal'))counts.walBytes+=stat.size;else if(path.endsWith('-shm'))counts.shmBytes+=stat.size;
    else if(/\.(db|sqlite|sqlite3)$/.test(path))counts.sqliteBytes+=stat.size;
    else if(path.endsWith('.md')){counts.markdownFiles++;counts.markdownBytes+=stat.size}else counts.otherBytes+=stat.size;
  };walk(root);return {...counts,allocatedBytes:null,checkpointPerformed:false};
}

export function parseProductScaleArguments(argv){
  const keys=['root','source','binary','sha256'],result={};
  for(let index=0;index<argv.length;index+=2){const key=argv[index]?.replace(/^--/,'');assert(keys.includes(key)&&!result[key]&&argv[index+1],'Invalid arguments');result[key]=argv[index+1]}
  assert(keys.every(key=>result[key]),'Explicit fresh root, source, binary and digest required');
  assert(/^[a-f0-9]{64}$/.test(result.sha256),'Invalid binary digest');
  for(const key of ['root','source','binary'])assert(result[key]===resolve(result[key]),'Absolute canonical paths required');
  assert(!existsSync(result.root),'Fresh generated root required');assert(realpathSync(result.source)===result.source,'Canonical source required');
  for(const name of ['.env','.env.local','.env.development','.env.development.local'])assert(!existsSync(join(result.source,name)),'Frontend environment files refused');
  assert(hash(readFileSync(result.binary))===result.sha256,'Pinned binary differs');return result;
}

async function startProductFixture(){
  const requests=[];let bytes=0;
  const server=createServer(async(req,res)=>{let record;try{
    assert(req.headers.authorization===undefined||req.headers.authorization===DUMMY_AUTHORIZATION,'Unexpected authorization');
    if(req.method==='GET'){assert(req.url?.includes('models'),'Unknown metadata');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'pi-native-fixture',object:'model',max_context_length:8192}]}));return}
    assert(req.method==='POST'&&req.url==='/local/v1/chat/completions','Unknown fixture route');
    assert(requests.length<1100,'Fixture request budget exceeded');
    let raw='';for await(const chunk of req){raw+=chunk;assert(Buffer.byteLength(raw)<=4194304,'Fixture body budget exceeded')}
    const body=JSON.parse(raw),reply=planProductScaleReply(body,req.headers.authorization);
    assert(reply.index===requests.length,'Unexpected replay/duplicate/reordered provider request');
    record={index:reply.index,requestBytes:Buffer.byteLength(raw),frames:0,frameBytes:0,completed:false,failed:false};requests.push(record);bytes+=record.requestBytes;
    assert(bytes<=1073741824,'Aggregate fixture request byte budget exceeded');
    res.on('close',()=>{if(!record.completed)record.failed=true});
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
    const send=value=>{const frame=`data: ${JSON.stringify(value)}\n\n`;record.frames++;record.frameBytes+=Buffer.byteLength(frame);res.write(frame)};
    const chunk=(delta,finish_reason=null)=>({id:`product-scale-${reply.index}`,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]});
    send(chunk({role:'assistant'}));send(chunk({content:reply.text}));send(chunk({},'stop'));
    record.frames++;record.frameBytes+=Buffer.byteLength('data: [DONE]\n\n');record.completed=true;res.end('data: [DONE]\n\n');
  }catch{if(record)record.failed=true;else requests.push({index:requests.length,failed:true,completed:false});if(!res.headersSent)res.writeHead(500);res.end('Synthetic fixture refused')}});
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(1443,'127.0.0.1',ok)});
  return {requests,close:()=>new Promise(ok=>{server.close(ok);server.closeAllConnections()})};
}

const browserSetup=`
  const native=window.__TAURI_INTERNALS__;if(!native||!document.querySelector('[data-testid="workspace-pane"]'))throw new Error('Native workspace required');
  const probe=await import('/src/lib/prototypes/pi/productScaleProbe.ts');
  const api=await probe.nativeProductScaleApi();
  const size=value=>{try{return new TextEncoder().encode(JSON.stringify(value??null)).length}catch{return null}};
  window.__productIpc={calls:0,requestBytes:0,responseBytes:0,failed:0,unknownSizes:0,eventListen:0,eventUnlisten:0,categories:{}};
  if(!window.__productInvoke){window.__productInvoke=native.invoke.bind(native);native.invoke=async(command,args,...rest)=>{const counter=window.__productIpc;counter.calls++;const sent=size(args);if(sent===null)counter.unknownSizes++;else counter.requestBytes+=sent;
    const category=command==='pi_sql'?'sqlite':command.startsWith('pi_provider')?'provider':command.startsWith('plugin:event|')?'event':'domain';counter.categories[category]=(counter.categories[category]??0)+1;
    if(command==='plugin:event|listen')counter.eventListen++;if(command==='plugin:event|unlisten')counter.eventUnlisten++;
    try{const value=await window.__productInvoke(command,args,...rest),received=size(value);if(received===null)counter.unknownSizes++;else counter.responseBytes+=received;return value}catch(error){counter.failed++;throw error}};}
  window.__productApi=api;window.__productProbe=probe;window.__productTransport=(await import('/src/lib/prototypes/pi/nativeProvider.ts')).nativeTransportStats;
  const {atlasVisibility,...defaults}=await api.getSettings();await api.setDefaults({...defaults,provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',localBaseUrl:'http://127.0.0.1:1443/local/v1',reasoningEffort:'off',defaultVaultAccess:'none'});
  return true;`;

// Reloads can invalidate a WebDriver completion after the workspace first mounts.
// Retry only this idempotent setup; no seed or public journey is admitted early.
export async function initializeProductScaleWorkspace({execute,output,phase,timeoutMs=60000,wait=waitUntil}){
  let attempt=0;
  return wait(async()=>{
    attempt++;
    try{assert.equal(await execute(browserSetup),true,'Product browser setup did not acknowledge readiness');return true}
    catch(error){output.lastInitializeError={phase,attempt,error:String(error).slice(0,2000)};return false}
  },phase,timeoutMs);
}

export async function executeProductScaleBrowser({wd,sessionId,script,args=[]}){
  const result=await wd(`/session/${sessionId}/execute/async`,{script:`const done=arguments[arguments.length-1];(async function(){${script}}).apply(null,Array.from(arguments).slice(0,-1)).then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error).slice(0,2000)}));`,args});
  assert(result?.ok,`Product browser operation failed: ${result?.error??'missing acknowledgement'}`);return result.value;
}

export async function stopProductScaleChild(child,signal='SIGTERM',options={}){
  return stopOwnedParityChild(child,{...options,kill:requested=>child.kill(requested==='SIGTERM'?signal:requested)});
}

const browserNavigate=`
  const [identity]=arguments,api=window.__productApi,rows=[];
  const until=async fn=>{const end=performance.now()+60000;while(performance.now()<end){const value=await fn();if(value)return value;await new Promise(ok=>setTimeout(ok,100))}throw new Error('Mounted navigation deadline')};
  const button=label=>Array.from(document.querySelectorAll('button')).find(node=>!node.disabled&&(node.getAttribute('aria-label')===label||node.textContent.trim()===label));
  if(!document.querySelector('[aria-label="Thought partner chat"]'))(await until(()=>button('Open thought partner'))).click();
  await until(()=>document.querySelector('[aria-label="Thought partner chat"]'));
  for(const index of [0,Math.floor(identity.conversations.length/2),identity.conversations.length-1]){
    const title=window.__productProbe.productScaleTitle(index),started=performance.now();
    if(document.querySelector('[aria-label="Chat title"]')?.value!==title){(await until(()=>button('Conversations'))).click();
      (await until(()=>Array.from(document.querySelectorAll('[role="menuitem"]')).find(node=>node.textContent.trim()===title))).click();}
    await until(()=>document.querySelector('[aria-label="Chat title"]')?.value===title);
    if(index===0)for(const turn of [0,Math.floor(identity.submissions/2),identity.submissions-1])await until(()=>document.querySelector('[data-chat-message-id="'+identity.messages[turn*2+1]+'"]')?.textContent?.includes(window.__productProbe.productScaleReply(turn)));
    await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));rows.push({index,millis:performance.now()-started});
  }return {mountedNavigation:rows,pollingUncertaintyMs:100,rendererObservation:'two-animation-frames'};`;

export async function runProductScaleGate(options){
  for(const port of [1442,1443,4445])assert.equal(listenerPids(port).length,0,'Native-owner port occupied');
  mkdirSync(options.root,{mode:0o700});const dataRoot=join(options.root,'data');mkdirSync(dataRoot,{mode:0o700});
  const report={schema:'gneauxghts-product-scale-gate-v1',status:'running',productParity:false,verdict:'unproven-pending-acceptance',
    binarySha256:options.sha256,frontendSourceSha256:frontendSourceDigest(options.source),frontendReceiptVerified:false,
    limits:['1005 conversations and 1005 inputs in one conversation; 2010 public history messages. Other conversations empty.',
      'Fixture compatible loopback only; fixture capacity bypasses compaction. No live provider/context-capacity acceptance.',
      'Aggregate public lists/history have no cursor API; mounted DOM may render all messages. No latency or memory bound is claimed.',
      'Native IPC counters begin after workspace; observer/API reads add IPC. Provider SSE frames and native chunks have different meanings.',
      'App RSS only at 250ms; renderer/helper/all-process RSS unknown. Private listener/watch/retirement/collection totals unknown.',
      'Public archive/unarchive retains data; storage snapshots do not checkpoint SQLite. Current-document scans run only after closing product owner.',
      'Per request <=4MiB; aggregate <=1GiB; <=1100 requests; 60s terminal/operation deadline; 2h seed deadline. Exceeding any budget fails, never truncates.'],
    rendererRssBytes:null,allProcessRssBytes:null,progress:[],storage:[],phases:[]};
  let fixture,frontend,app,session,timer,pinnedStart,rssPeak=0,rssSamples=0,rssFailed=0,browserEpoch=0;
  const wd=createWebDriverRequest(4445,120000),env=cleanEnvironment(process.env.PATH,'pi');
  const execute=(script,args=[])=>executeProductScaleBrowser({wd,sessionId:session.sessionId,script,args});
  const snapshot=label=>report.storage.push({label,atMs:performance.now(),...productStorageSnapshot(dataRoot)});
  const setup=async phase=>{await initializeProductScaleWorkspace({execute,output:report,phase});browserEpoch++};
  const browserCounters=async label=>report.phases.push({label,browserEpoch,atMs:performance.now(),ipcCoverage:'observed-invoke-boundary-after-workspace',...await execute('return {ipc:window.__productIpc,transport:{...window.__productTransport}};')});
  const stop=async signal=>{clearInterval(timer);timer=undefined;
    if(session){try{await wd(`/session/${session.sessionId}`,undefined,'DELETE')}catch{}session=undefined}
    await stopProductScaleChild(app,signal)};
  const launch=async label=>{const fd=openSync(join(options.root,`native-${label}.log`),'a',0o600);
    app=spawn(options.binary,['--e2e-app-data-root',dataRoot,'--e2e-documents-root',dataRoot],{cwd:options.source,env,stdio:['ignore',fd,fd]});closeSync(fd);pinnedStart=undefined;
    timer=setInterval(()=>{try{const fields=execFileSync('/bin/ps',['-p',String(app.pid),'-o','pid=,rss=,lstart='],{encoding:'ascii',env:{LC_ALL:'C'},timeout:2000}).trim().split(/\s+/);
      assert(Number(fields[0])===app.pid&&/^\d+$/.test(fields[1]),'Bad numeric PID sample');const start=hash(fields.slice(2).join(' '));pinnedStart??=start;assert(start===pinnedStart,'PID reuse');rssPeak=Math.max(rssPeak,Number(fields[1])*1024);rssSamples++}catch{rssFailed++}},250);
    await waitUntil(async()=>{try{return(await wd('/status',undefined,'GET')).ready}catch{return false}},'owned product native driver',30000);
    session=await wd('/session',{capabilities:{alwaysMatch:{browserName:'tauri'}}});await wd(`/session/${session.sessionId}/timeouts`,{script:120000});
    await setup(`${label} product browser setup`);
  };
  try{
    fixture=await startProductFixture();const fd=openSync(join(options.root,'frontend.log'),'a',0o600);
    frontend=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port','1442','--strictPort'],{cwd:options.source,env,stdio:['ignore',fd,fd],detached:true});closeSync(fd);
    await waitUntil(async signal=>(await fetch('http://127.0.0.1:1442/',{signal})).ok,'owned product frontend',30000);
    await launch('initial');
    assert.equal(await execute('return (await window.__productApi.listConversations(true)).length;'),0,'Fresh product store required');
    snapshot('empty');await browserCounters('empty');
    report.closedStoreEmpty=await execute('return await window.__productProbe.countClosedProductStore();');snapshot('closed-empty');
    // Closing the owner is terminal for that webview's ChatApi. A normal reload
    // creates its next owner before seeding; no second live Harness is opened.
    await wd(`/session/${session.sessionId}/execute/sync`,{script:'location.reload();return true',args:[]});
    await setup('fresh product owner browser setup');
    // Seed outside a long WebDriver command so the native owner can poll numeric
    // progress, record storage growth and retain a bounded operation deadline.
    await execute(`window.__productState={status:'running',progress:{phase:'start',conversations:0,submissions:0,probeListeners:0}};
      window.__productProbe.seedProductScale(window.__productApi,1005,1005,value=>window.__productState.progress=value).then(result=>{window.__productState.result=result;window.__productState.status='done'},error=>{window.__productState.error=String(error).slice(0,2000);window.__productState.status='failed'});return true;`);
    const deadline=performance.now()+7200000;let state;
    while(performance.now()<deadline){state=await execute('return {status:window.__productState.status,progress:window.__productState.progress,error:window.__productState.error};');
      if(state.status!=='running')break;report.progress.push({atMs:performance.now(),...state.progress});snapshot('seed-progress');await delay(5000)}
    report.lastSeedState=state;assert.equal(state?.status,'done',`Product scale seed failed or exceeded deadline: ${state?.error??state?.status}`);
    const seeded=await execute('return window.__productState.result;');
    writeNew(join(options.root,'private-product-identities.json'),seeded.identity);report.seed={...seeded,identity:undefined};snapshot('seeded');await browserCounters('seeded');
    assert.equal(fixture.requests.length,1005,'Provider count differs from submitted inputs');assert(fixture.requests.every(row=>row.completed&&!row.failed),'Fixture request failed');
    // Reload the ordinary mounted controller so it discovers API-created Meta.
    await wd(`/session/${session.sessionId}/execute/sync`,{script:'location.reload();return true',args:[]});
    await setup('reloaded product browser setup');
    report.beforeRestart=await execute('return await window.__productProbe.verifyProductScale(window.__productApi,arguments[0]);',[seeded.identity]);
    report.beforeRestartUi=await execute(browserNavigate,[seeded.identity]);await browserCounters('before-archive');snapshot('before-archive');
    report.archive=await execute('return await window.__productProbe.checkProductArchive(window.__productApi,arguments[0]);',[seeded.identity]);snapshot('after-archive');await browserCounters('after-archive');
    report.closedStoreBefore=await execute('return await window.__productProbe.countClosedProductStore();');snapshot('closed-before-restart');await browserCounters('closed-before-restart');
    assert.equal(report.closedStoreBefore.metaDocuments,1005,'Native product Meta count differs');assert.equal(report.closedStoreBefore.inputSubmissions,1005,'Native product submission count differs');
    report.currentDocumentGrowth=report.closedStoreBefore.currentDocuments-report.closedStoreEmpty.currentDocuments;
    const requestsBefore=fixture.requests.length;assert.equal(requestsBefore,1005,'Read/navigation/archive implicitly dispatched provider work');await stop('SIGKILL');await launch('restart');
    report.afterRestart=await execute('return await window.__productProbe.verifyProductScale(window.__productApi,arguments[0]);',[seeded.identity]);
    report.afterRestartUi=await execute(browserNavigate,[seeded.identity]);await delay(1000);assert.equal(fixture.requests.length,requestsBefore,'Restart implicitly replayed provider work');
    report.noImplicitProviderReplay=true;await browserCounters('after-restart');snapshot('after-restart');
    report.closedStoreAfter=await execute('return await window.__productProbe.countClosedProductStore();');snapshot('closed-after-restart');await browserCounters('closed-after-restart');
    assert.equal(report.closedStoreAfter.metaDocuments,1005,'Restart product Meta count differs');assert.equal(report.closedStoreAfter.inputSubmissions,1005,'Restart native submission count differs');
    assert.equal(fixture.requests.length,1005,'Final product verification dispatched provider work');assert(fixture.requests.every(row=>row.completed&&!row.failed),'Late fixture failure');
    assert.equal(hash(readFileSync(options.binary)),options.sha256,'Measured binary changed');assert.equal(frontendSourceDigest(options.source),report.frontendSourceSha256,'Served frontend changed');
    report.status='passed-bounded-product-scale-fixture';
  }catch(error){report.status='failed';report.error=String(error).slice(0,8000);process.exitCode=1}
  finally{try{await stop('SIGTERM')}catch(error){report.status='failed';report.cleanupError=String(error).slice(0,2000);process.exitCode=1}if(frontend){try{process.kill(-frontend.pid,'SIGTERM')}catch{}}
    report.providerRequests=fixture?.requests??[];if(fixture)await fixture.close();snapshot(app&&app.exitCode===null&&app.signalCode===null?'process-exit-unconfirmed':'process-closed');
    report.appRss={observedPeakBytes:rssSamples?rssPeak:null,samples:rssSamples,failedSamples:rssFailed,coverage:'app-only',cadenceMs:250};
    writeNew(join(options.root,'product-scale-gate.json'),report);
  }return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const report=await runProductScaleGate(parseProductScaleArguments(process.argv.slice(2)));console.log(JSON.stringify({status:report.status,productParity:report.productParity,verdict:report.verdict}))}
  catch{console.error('Product scale gate refused artifacts, ownership or prerequisites');process.exitCode=1}
}
