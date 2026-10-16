// Native-owner execution only. Importing this module opens no app, server or database.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createWebDriverRequest,listenerPids,waitUntil} from '../../e2e/support/nativeTransport.mjs';
import {parseProductScaleArguments,productScaleEnvironment,executeProductScaleBrowser,stopProductScaleChild} from './product-scale-gate.mjs';
import {startSharedFixture,frontendSourceDigest,browserSelect} from './shared-resource-gate.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const writeNew=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
export function assertChurnRequests(requests,expected=3){
  assert.equal(requests.length,expected,'Read/navigation/archive/restart implicitly dispatched inference');
  assert(requests.every(row=>row.case==='short'&&row.completed&&!row.failed),'Actual bounded seed requests must complete');
}
export function assertChurnMetadata(before,after){
  assert.equal(before.coverage,'closed-database-metadata-only');assert.equal(after.coverage,before.coverage);
  assert(before.callerClosed===true&&after.callerClosed===true,'Both app writers must have exited');
  assert.deepEqual(after.documentFamilies,before.documentFamilies,'Read/restart churn changed retained document family/revision counts');
  assert.deepEqual(after.totals,before.totals,'Read/restart churn changed durable lifecycle row counts');
}
export function assertArchiveMetadata(before,after){
  // SQLite's indexed kind is JSON encoded. `latest` retains delta rows until a
  // base checkpoint replaces them; these two explicit Meta commits add deltas.
  const expected=structuredClone(before);
  const presentation=expected.documentFamilies.filter(row=>row.kind===JSON.stringify('gneauxghts.pi.chat-presentation')&&row.family===0);
  assert.equal(presentation.length,1,'Exactly one retained chat-presentation singleton family required');
  assert(Number.isSafeInteger(presentation[0].revisions)&&presentation[0].revisions>=1,'Presentation revision baseline required');
  assert(Number.isSafeInteger(expected.totals.document_revisions)&&expected.totals.document_revisions>=1,'Total revision baseline required');
  presentation[0].revisions+=2;expected.totals.document_revisions+=2;
  assertChurnMetadata(expected,after);
}
export function assertChurnVisibility({visible,retained},ids,archivedId=null){
  assert.equal(new Set(ids).size,ids.length,'Distinct seeded conversations required');
  if(archivedId!==null)assert(ids.includes(archivedId),'Archive target must be a seeded conversation');
  assert.deepEqual(retained.map(row=>row.id).sort(),[...ids].sort(),'Archive must retain every seeded conversation exactly once');
  assert.deepEqual(visible.map(row=>row.id).sort(),ids.filter(id=>id!==archivedId).sort(),'Public active list must hide only the archived conversation');
  for(const row of retained)assert.equal(row.status,row.id===archivedId?'archived':'active','Public retained status must match archive state');
  for(const row of visible)assert.equal(row.status,'active','Public visible conversation must be active');
}

const setup=`
  if(!window.__TAURI_INTERNALS__||!document.querySelector('[data-testid="workspace-pane"]'))throw new Error('Native workspace required');
  const api=(await import('/src/lib/features/chat/api.ts')).chatApi;
  if(!(await window.__TAURI_INTERNALS__.invoke('pi_probe_config')).fixture)throw new Error('Synthetic fixture required');
  window.__resourceApi=api;
  const {atlasVisibility,...defaults}=await api.getSettings();
  await api.setDefaults({...defaults,provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',localBaseUrl:'http://127.0.0.1:1443/local/v1',reasoningEffort:'off',defaultVaultAccess:'none'});
  return true;`;
const capture=`
  const api=window.__resourceApi,ids=arguments[0],chats=[];
  for(const id of ids){const chat=await api.getConversation(id),pending=await api.listPendingProposals(id);
    chats.push({id:chat.id,title:chat.title,messages:chat.messages.map(row=>({id:row.id,content:row.content,status:row.status})),
      pending:await Promise.all(pending.map(async row=>({id:row.id,status:row.status,draft:await api.getProposalDraft(row.id)})))});}
  return chats;`;
const visibility=`
  const api=window.__resourceApi;
  const summarize=rows=>rows.map(({id,status})=>({id,status}));
  return {visible:summarize(await api.listConversations()),retained:summarize(await api.listConversations(true))};`;
const seed=`
  const api=window.__resourceApi,ids=[];
  if((await api.listConversations(true)).length)throw new Error('Fresh generated storage required');
  for(let index=0;index<3;index++){
    const chat=await api.createConversation({title:'Synthetic resource churn '+index,provider:'local',model:'pi-native-fixture',reasoningEffort:'off',vaultAccess:'none'});
    ids.push(chat.id);const receipt=await api.sendMessage({conversationId:chat.id,content:'RESOURCE_HELLO'}),deadline=Date.now()+60000;
    while(true){const message=(await api.getConversation(chat.id)).messages.find(row=>row.id===receipt.assistantMessage.id);
      if(message?.status==='completed'){if(message.content!=='Shared synthetic answer.')throw new Error('Seed answer differs');break;}
      if(message&&['error','cancelled'].includes(message.status))throw new Error('Seed did not complete');
      if(Date.now()>deadline)throw new Error('Bounded seed deadline');await new Promise(ok=>setTimeout(ok,50));}
  }
  const first=await api.getConversation(ids[0]);
  const pending=await api.prepareNoteSave(ids[0],first.messages.at(-1).id);
  if(!pending?.id)throw new Error('Durable pending Save review required');
  return {ids,pendingId:pending.id};`;

export async function runResourceChurnGate(options){
  for(const port of [1442,1443,4445])assert.equal(listenerPids(port).length,0,'Native-owner port occupied');
  mkdirSync(options.root,{mode:0o700});const data=join(options.root,'data');mkdirSync(data,{mode:0o700});
  const report={schema:'gneauxghts-resource-churn-v1',status:'running',binarySha256:options.sha256,
    frontendSourceSha256:frontendSourceDigest(options.source),frontendReceiptVerified:false,shutdowns:[],
    limits:['Synthetic compatible protocol only; fixed twenty cycles over three populated product chats.',
      'Actual API callback attach/detach and mounted selection are observed; mounted controller disposal is not.',
      'Upstream private cache/watch/lease counts are unobserved; no whole-runtime resource bound is claimed.',
      'No app retirement/collection policy; archive retains recoverable history. No product GC or physical collection is exercised.',
      'Pending Save review and history survive; this root has no published Keep receipt, whose native recovery proof is separate.',
      'This gate is a bounded correctness/resource-lifetime check, not latency, RSS, scale or performance evidence.']};
  const env=productScaleEnvironment(process.env.PATH,process.env.GNEAUXGHTS_E2E_FOREGROUND);
  const wd=createWebDriverRequest(4445,180000);let app,frontend,fixture,session;
  const execute=(script,args=[])=>executeProductScaleBrowser({wd,sessionId:session.sessionId,script,args});
  const stop=async()=>{
    if(session){try{await wd(`/session/${session.sessionId}`,undefined,'DELETE')}catch{}session=undefined;}
    await stopProductScaleChild(app);
  };
  const launch=async label=>{
    const fd=openSync(join(options.root,`native-${label}.log`),'a',0o600);
    app=spawn(options.binary,['--e2e-app-data-root',data,'--e2e-documents-root',data],{cwd:options.source,env,stdio:['ignore',fd,fd]});closeSync(fd);
    await waitUntil(async()=>{try{return(await wd('/status',undefined,'GET')).ready}catch{return false}},'owned native churn driver',30000);
    session=await wd('/session',{capabilities:{alwaysMatch:{browserName:'tauri'}}});await wd(`/session/${session.sessionId}/timeouts`,{script:180000});
    await waitUntil(async()=>{try{return await execute(setup)}catch(error){report.lastSetupError=String(error).slice(0,1000);return false}},'native churn workspace',60000);
  };
  const portableStop=async label=>{
    const receipt=await execute("return await window.__TAURI_INTERNALS__.invoke('prepare_restart');");
    assert(receipt?.ready&&receipt.timelinePortable,'Portable native shutdown required');
    report.shutdowns.push({label,...receipt});await stop();
    assert(app.exitCode!==null||app.signalCode!==null,'Native owner must have exited before SQLite counts');
    return JSON.parse(execFileSync('python3',['-B','scripts/pi-prototype/closed-churn-counts.py','--database',join(data,'PROTOTYPE-wipe-me/pi.sqlite'),'--closed-process-confirmed','yes'],{cwd:options.source,encoding:'utf8'}));
  };
  try{
    fixture=await startSharedFixture();const fd=openSync(join(options.root,'frontend.log'),'a',0o600);
    frontend=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port','1442','--strictPort'],{cwd:options.source,env,stdio:['ignore',fd,fd],detached:true});closeSync(fd);
    await waitUntil(async signal=>(await fetch('http://127.0.0.1:1442/',{signal})).ok,'owned churn frontend',30000);
    await launch('seed');const seeded=await execute(seed);writeNew(join(options.root,'private-identities.json'),seeded);
    const expected=await execute(capture,[seeded.ids]);writeNew(join(options.root,'private-expected-state.json'),expected);
    assertChurnRequests(fixture.requests);report.before=await portableStop('before-churn');assertChurnRequests(fixture.requests);
    await launch('churn');assert.deepEqual(await execute(capture,[seeded.ids]),expected,'Relaunch changed committed history/pending review');assertChurnRequests(fixture.requests);
    for(const id of seeded.ids)await execute(browserSelect,[id]);await delay(1000);
    report.churn=await execute(`const probe=await import('/src/lib/prototypes/pi/resourceChurnProbe.ts');
      return await probe.runResourceChurnProbe(window.__resourceApi,arguments[0],20,undefined,async function(){${browserSelect}});`,[seeded.ids]);
    assert.deepEqual(await execute(capture,[seeded.ids]),expected,'Read churn changed committed history/pending review');assertChurnRequests(fixture.requests);
    report.afterReadOnly=await portableStop('after-read-only-churn');assertChurnRequests(fixture.requests);assertChurnMetadata(report.before,report.afterReadOnly);
    await launch('archive');assert.deepEqual(await execute(capture,[seeded.ids]),expected,'Read-only restart changed history/pending review');assertChurnRequests(fixture.requests);
    assertChurnVisibility(await execute(visibility),seeded.ids);
    await execute('await window.__resourceApi.archiveConversation(arguments[0],true,1);return true;',[seeded.ids[2]]);
    assertChurnVisibility(await execute(visibility),seeded.ids,seeded.ids[2]);
    assert.deepEqual(await execute(capture,[seeded.ids]),expected,'Archive changed committed history/pending review');assertChurnRequests(fixture.requests);
    await execute('await window.__resourceApi.archiveConversation(arguments[0],false,1);return true;',[seeded.ids[2]]);
    assertChurnVisibility(await execute(visibility),seeded.ids);
    assert.deepEqual(await execute(capture,[seeded.ids]),expected,'Restore changed committed history/pending review');assertChurnRequests(fixture.requests);
    report.after=await portableStop('after-archive-restore');assertChurnRequests(fixture.requests);assertArchiveMetadata(report.afterReadOnly,report.after);
    report.archiveRestore={archivedAndRestored:1,publicVisibilityVerified:true,expectedPresentationRevisionAdditions:2};
    await launch('verify');assert.deepEqual(await execute(capture,[seeded.ids]),expected,'Final restart changed history/pending review');assertChurnRequests(fixture.requests);
    assertChurnVisibility(await execute(visibility),seeded.ids);
    report.afterRestart=await portableStop('after-restart');assertChurnRequests(fixture.requests);assertChurnMetadata(report.after,report.afterRestart);
    assert.equal(hash(readFileSync(options.binary)),options.sha256,'Pinned artifact changed');
    assert.equal(frontendSourceDigest(options.source),report.frontendSourceSha256,'Served source changed');
    report.status='passed-bounded-owned-resources';report.noInferenceDuringChurnOrRestart=true;report.pendingReviewRetained=true;
  }catch(error){report.status='failed';report.error=String(error).slice(0,8000);process.exitCode=1;}
  finally{
    try{await stop()}catch(error){report.status='failed';report.cleanupError=String(error).slice(0,2000);process.exitCode=1;}
    if(frontend){try{process.kill(-frontend.pid,'SIGTERM')}catch{}}
    report.requests=fixture?.requests??[];await fixture?.close();writeNew(join(options.root,'resource-churn-gate.json'),report);
  }
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const report=await runResourceChurnGate(parseProductScaleArguments(process.argv.slice(2)));console.log(JSON.stringify({status:report.status,error:report.error}));}
  catch{console.error('Resource churn gate refused artifacts, ownership or prerequisites');process.exitCode=1;}
}
