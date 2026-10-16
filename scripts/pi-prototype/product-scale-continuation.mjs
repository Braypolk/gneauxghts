// Diagnostic continuation only. Importing performs no native, port or file work.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {existsSync,readFileSync,writeFileSync,mkdirSync,cpSync,chmodSync,lstatSync,readdirSync,realpathSync,openSync,closeSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {DUMMY_AUTHORIZATION,cleanEnvironment,frontendSourceDigest} from './shared-resource-gate.mjs';
import {executeProductScaleBrowser,initializeProductScaleWorkspace,productStorageSnapshot,stopProductScaleChild,verifyProductScaleRequests} from './product-scale-gate.mjs';
import {createWebDriverRequest,listenerPids,waitUntil} from '../../e2e/support/nativeTransport.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const writeNew=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const within=(parent,path)=>{const tail=relative(parent,path);return tail===''||(!tail.startsWith('..')&&!isAbsolute(tail))};

export function closedScaleTreeManifest(root){
  const entries=[];
  const visit=path=>{
    const stat=lstatSync(path);assert(!stat.isSymbolicLink(),'Generated input symlink refused');
    const entry={path:relative(root,path),mode:stat.mode&0o777};
    if(stat.isDirectory()){entries.push({...entry,type:'directory'});for(const name of readdirSync(path).sort())visit(join(path,name))}
    else{assert(stat.isFile(),'Generated input special file refused');entries.push({...entry,type:'file',bytes:stat.size,sha256:hash(readFileSync(path))})}
  };
  visit(root);return {entries,sha256:hash(JSON.stringify(entries))};
}

export function parseScaleContinuationArguments(argv){
  const keys=['origin-root','root','source','binary','sha256','closed-process-confirmed'],options={};
  for(let index=0;index<argv.length;index+=2){const key=argv[index]?.replace(/^--/,'');assert(keys.includes(key)&&!Object.hasOwn(options,key)&&argv[index+1],'Invalid continuation arguments');options[key]=argv[index+1]}
  assert(keys.every(key=>options[key]),'Explicit generated origin, fresh output, source, binary, digest and owner closure confirmation required');
  assert.equal(options['closed-process-confirmed'],'yes','Native owner must explicitly confirm the original process is closed');
  return options;
}

export function prepareScaleContinuation(options){
  assert.equal(options['closed-process-confirmed'],'yes','Native owner closure confirmation required');
  for(const key of ['origin-root','source','binary'])assert(options[key]===resolve(options[key])&&realpathSync(options[key])===options[key],'Canonical input paths required');
  assert(options.root===resolve(options.root)&&!existsSync(options.root),'Fresh absolute continuation output required');
  assert.equal(realpathSync(dirname(options.root)),dirname(options.root),'Canonical existing output parent required');
  assert(/^pi-product-scale-[A-Za-z0-9-]+$/.test(options['origin-root'].split('/').at(-1))&&options['origin-root'].startsWith('/private/tmp/'),'Only a generated product scale origin is accepted');
  assert(!within(options['origin-root'],options.root)&&!within(options.source,options.root),'Output cannot overlap immutable inputs');
  assert(/^[a-f0-9]{64}$/.test(options.sha256)&&hash(readFileSync(options.binary))===options.sha256,'Pinned continuation binary differs');
  for(const name of ['.env','.env.local','.env.development','.env.development.local'])assert(!existsSync(join(options.source,name)),'Frontend environment files refused');
  const receiptPath=join(options['origin-root'],'product-scale-gate.json'),identityPath=join(options['origin-root'],'private-product-identities.json');
  for(const path of [receiptPath,identityPath])assert(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink(),'Regular original receipts required');
  const receiptBytes=readFileSync(receiptPath),identityBytes=readFileSync(identityPath),receipt=JSON.parse(receiptBytes),identity=JSON.parse(identityBytes);
  assert.equal(receipt.schema,'gneauxghts-product-scale-gate-v1','Original product scale schema required');assert.equal(receipt.status,'failed','Successful or unfinished originals cannot be continued');
  assert.equal(receipt.binarySha256,options.sha256,'Continuation must use the original pinned artifact');
  const sourceSha256=frontendSourceDigest(options.source);assert.equal(receipt.frontendSourceSha256,sourceSha256,'Continuation source differs from original served source');
  assert.equal(receipt.lastSeedState?.status,'done','Actual original seed must have completed');
  for(const proof of [receipt.seed?.verified,receipt.beforeRestart])assert(proof?.conversations===1005&&proof.submissions===1005&&proof.messages===2010&&proof.allHistoryPositionsVerified===true&&proof.allMetaIdentitiesVerified===true,'Original exact public seed and pre-navigation verification required');
  assert.equal(receipt.seed.probeListenersAfter,0,'Original probe listeners must be detached');
  assert(!receipt.beforeRestartUi&&!receipt.archive&&!receipt.afterRestart,'Only a failure during the first mounted navigation can be continued');
  assert(/(?:timed?\s*out|timeout|deadline)/i.test(receipt.error??''),'Actual bounded mounted navigation failure required');
  assert(!receipt.cleanupError,'Original native cleanup must have succeeded');
  assert(identity.conversations?.length===1005&&identity.conversations.every(id=>typeof id==='string'&&id)&&new Set(identity.conversations).size===1005&&identity.messages?.length===2010&&identity.messages.every(id=>typeof id==='string'&&id)&&new Set(identity.messages).size===2010&&identity.submissions===1005,'Exact private original identities required');
  const accounting=verifyProductScaleRequests(receipt.providerRequests);assert.deepEqual(accounting,receipt.providerAccounting,'Original provider accounting must be complete');
  const originalDataRoot=join(options['origin-root'],'data'),manifest=closedScaleTreeManifest(originalDataRoot),closed=receipt.storage?.at(-1);
  assert.equal(closed?.label,'process-closed','Original receipt must confirm process closure');
  const {label,atMs,...closedStorage}=closed;assert.deepEqual(productStorageSnapshot(originalDataRoot),closedStorage,'Closed original storage changed since receipt');
  mkdirSync(options.root,{mode:0o700});const dataRoot=join(options.root,'data');cpSync(originalDataRoot,dataRoot,{recursive:true,errorOnExist:true,force:false,preserveTimestamps:true});
  for(const entry of manifest.entries)chmodSync(join(dataRoot,entry.path),entry.mode);
  assert.deepEqual(closedScaleTreeManifest(dataRoot),manifest,'Generated copy must preserve every input byte and mode');
  assert.deepEqual(closedScaleTreeManifest(originalDataRoot),manifest,'Original generated data changed during copy');
  writeFileSync(join(options.root,'origin-product-scale-gate.json'),receiptBytes,{flag:'wx',mode:0o600});
  writeFileSync(join(options.root,'private-origin-identities.json'),identityBytes,{flag:'wx',mode:0o600});
  const inputs={originRoot:options['origin-root'],originalStatus:receipt.status,receiptSha256:hash(receiptBytes),identitySha256:hash(identityBytes),sourceSha256,binarySha256:options.sha256,storageManifestSha256:manifest.sha256,
    nativeOwnerConfirmedClosed:true,receiptConfirmedClosed:true,providerAccounting:accounting};
  writeNew(join(options.root,'private-origin-storage-manifest.json'),manifest);writeNew(join(options.root,'continuation-inputs.json'),inputs);
  return {identity,inputs,manifest,originalDataRoot,dataRoot,receiptPath,identityPath};
}

export function strictContinuationFixtureReply(method,url,authorization){
  assert(authorization===undefined||authorization===DUMMY_AUTHORIZATION,'Unexpected continuation fixture authorization');
  assert.equal(method,'GET','Every new provider inference POST is forbidden in a continuation');
  assert.equal(url,'/local/v1/models','Only exact local model metadata is permitted');
  return {data:[{id:'pi-native-fixture',object:'model',max_context_length:8192}]};
}

async function startReadOnlyFixture(){
  const requests=[];
  const server=createServer((req,res)=>{
    const row={method:req.method,path:req.url,refused:false};requests.push(row);
    try{const reply=strictContinuationFixtureReply(req.method,req.url,req.headers.authorization);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(reply))}
    catch(error){row.refused=true;row.reason=String(error).slice(0,700);res.writeHead(500);res.end('Continuation inference refused')}
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(1443,'127.0.0.1',ok)});
  return {requests,close:()=>new Promise(ok=>{server.close(ok);server.closeAllConnections()})};
}

// One shared deadline includes actual frame observation, so background rendering
// cannot leave an unbounded browser promise. The native operation also has 120s.
export async function observeScaleContinuationFrames({frame,now=()=>performance.now(),timeoutMs=60000}){
  let timer;
  const started=now();
  try{return await Promise.race([new Promise(ok=>frame(()=>frame(()=>ok({frames:2,millis:now()-started})))),new Promise((_,fail)=>{timer=setTimeout(()=>fail(new Error('Mounted two-frame observation deadline')),timeoutMs)})])}
  finally{clearTimeout(timer)}
}

export function scaleContinuationNavigationScript(){return `
  const identity=arguments[0],rows=[],deadline=performance.now()+60000;
  const until=async fn=>{while(performance.now()<deadline){const value=await fn();if(value)return value;await new Promise(ok=>setTimeout(ok,100))}throw new Error('Mounted continuation navigation deadline')};
  const button=label=>Array.from(document.querySelectorAll('button')).find(node=>!node.disabled&&(node.getAttribute('aria-label')===label||node.textContent.trim()===label));
  if(!document.querySelector('[aria-label="Thought partner chat"]'))(await until(()=>button('Open thought partner'))).click();
  await until(()=>document.querySelector('[aria-label="Thought partner chat"]'));
  for(const index of [0,Math.floor(identity.conversations.length/2),identity.conversations.length-1]){
    const title=window.__productProbe.productScaleTitle(index),started=performance.now();
    if(document.querySelector('[aria-label="Chat title"]')?.value!==title){(await until(()=>button('Conversations'))).click();(await until(()=>Array.from(document.querySelectorAll('[role="menuitem"]')).find(node=>node.textContent.trim()===title))).click()}
    await until(()=>document.querySelector('[aria-label="Chat title"]')?.value===title);
    if(index===0)for(const turn of [0,Math.floor(identity.submissions/2),identity.submissions-1])await until(()=>document.querySelector('[data-chat-message-id="'+identity.messages[turn*2+1]+'"]')?.textContent?.includes(window.__productProbe.productScaleReply(turn)));
    const observed=await (${observeScaleContinuationFrames.toString()})({frame:callback=>requestAnimationFrame(callback),timeoutMs:Math.max(1,deadline-performance.now())});rows.push({index,millis:performance.now()-started,observedFrames:observed.frames});
  }return {mountedNavigation:rows,pollingUncertaintyMs:100,rendererObservation:'two-actual-animation-frames',innerDeadlineMs:60000};`}

export async function runScaleContinuationJourneys({execute,navigate,stop,launch,assertNoInference}){
  const before=await execute('verify');assertNoInference();
  const beforeUi=await navigate();assertNoInference();
  const archive=await execute('archive');assertNoInference();
  const closedBefore=await execute('close');assert.equal(closedBefore.metaDocuments,1005);assert.equal(closedBefore.inputSubmissions,1005);assertNoInference();
  await stop();await launch();assertNoInference();
  const after=await execute('verify'),afterUi=await navigate();assertNoInference();
  const closedAfter=await execute('close');assert.equal(closedAfter.metaDocuments,1005);assert.equal(closedAfter.inputSubmissions,1005);assertNoInference();
  return {before,beforeUi,archive,closedBefore,after,afterUi,closedAfter};
}

export async function runScaleContinuation(options){
  for(const port of [1442,1443,4445])assert.equal(listenerPids(port).length,0,'Native owner ports must be free');
  const prepared=prepareScaleContinuation(options),report={schema:'gneauxghts-product-scale-continuation-v1',status:'running',originalRunPassed:false,productParity:false,verdict:'unproven-pending-acceptance',
    inputs:prepared.inputs,scope:'Linked foreground diagnostic continuation of copied closed generated fixture; no original gate pass and no IPC resource acceptance',providerPostCount:0};
  const env={...cleanEnvironment(process.env.PATH,'pi'),GNEAUXGHTS_E2E_FOREGROUND:'1'},wd=createWebDriverRequest(4445,120000);
  let fixture,frontend,app,session;
  const execute=(script,args=[])=>executeProductScaleBrowser({wd,sessionId:session.sessionId,script,args});
  const stop=async(signal='SIGTERM')=>{if(session){try{await wd(`/session/${session.sessionId}`,undefined,'DELETE')}catch{}session=undefined}await stopProductScaleChild(app,signal)};
  const launch=async()=>{
    const fd=openSync(join(options.root,'native-continuation.log'),'a',0o600);app=spawn(options.binary,['--e2e-app-data-root',prepared.dataRoot,'--e2e-documents-root',prepared.dataRoot],{cwd:options.source,env,stdio:['ignore',fd,fd]});closeSync(fd);
    await waitUntil(async()=>{try{return(await wd('/status',undefined,'GET')).ready}catch{return false}},'owned continuation driver',30000);
    session=await wd('/session',{capabilities:{alwaysMatch:{browserName:'tauri'}}});await wd(`/session/${session.sessionId}/timeouts`,{script:120000});
    await initializeProductScaleWorkspace({execute,output:report,phase:'continuation product workspace'});
  };
  const assertNoInference=()=>assert(fixture.requests.every(row=>row.method==='GET'&&!row.refused),'Continuation dispatched unexpected inference or refused metadata');
  try{
    fixture=await startReadOnlyFixture();const fd=openSync(join(options.root,'frontend.log'),'a',0o600);frontend=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port','1442','--strictPort'],{cwd:options.source,env,stdio:['ignore',fd,fd],detached:true});closeSync(fd);
    await waitUntil(async signal=>(await fetch('http://127.0.0.1:1442/',{signal})).ok,'owned continuation frontend',30000);await launch();
    report.journeys=await runScaleContinuationJourneys({execute:action=>execute(action==='verify'?'return await window.__productProbe.verifyProductScale(window.__productApi,arguments[0]);':action==='archive'?'return await window.__productProbe.checkProductArchive(window.__productApi,arguments[0]);':'return await window.__productProbe.countClosedProductStore();',[prepared.identity]),
      navigate:()=>execute(scaleContinuationNavigationScript(),[prepared.identity]),stop:()=>stop('SIGKILL'),launch,assertNoInference});
    await delay(1000);assertNoInference();report.noNewProviderInference=true;report.status='passed-linked-diagnostic-continuation';
  }catch(error){report.status='failed-linked-diagnostic-continuation';report.error=String(error).slice(0,8000);process.exitCode=1}
  finally{
    try{await stop()}catch(error){report.status='failed-linked-diagnostic-continuation';report.cleanupError=String(error).slice(0,2000);process.exitCode=1}
    if(frontend){try{process.kill(-frontend.pid,'SIGTERM')}catch{}}
    if(fixture)await fixture.close();report.providerRequests=fixture?.requests??[];report.providerPostCount=report.providerRequests.filter(row=>row.method==='POST').length;
    try{if(fixture)assertNoInference()}catch(error){report.status='failed-linked-diagnostic-continuation';report.inferenceError=String(error).slice(0,2000);report.noNewProviderInference=false;process.exitCode=1}
    try{
      assert.equal(hash(readFileSync(prepared.receiptPath)),prepared.inputs.receiptSha256,'Original receipt changed');assert.equal(hash(readFileSync(prepared.identityPath)),prepared.inputs.identitySha256,'Original identities changed');
      assert.deepEqual(closedScaleTreeManifest(prepared.originalDataRoot),prepared.manifest,'Original generated fixture changed');assert.equal(frontendSourceDigest(options.source),prepared.inputs.sourceSha256,'Served source changed');assert.equal(hash(readFileSync(options.binary)),options.sha256,'Pinned artifact changed');report.originalInputsUnchanged=true;
    }catch(error){report.status='failed-linked-diagnostic-continuation';report.integrityError=String(error).slice(0,2000);process.exitCode=1}
    report.processClosed=!app||app.exitCode!==null||app.signalCode!==null;
    report.closedCopy=report.processClosed?productStorageSnapshot(prepared.dataRoot):null;writeNew(join(options.root,'product-scale-continuation.json'),report);
  }
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const report=await runScaleContinuation(parseScaleContinuationArguments(process.argv.slice(2)));console.log(JSON.stringify({status:report.status,originalRunPassed:false,productParity:false}))}
  catch(error){console.error(`Product scale continuation refused: ${String(error).slice(0,1000)}`);process.exitCode=1}
}
