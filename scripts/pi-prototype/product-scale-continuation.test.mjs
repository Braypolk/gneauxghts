import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {closedScaleTreeManifest,parseScaleContinuationArguments,prepareScaleContinuation,strictContinuationFixtureReply,observeScaleContinuationFrames,scaleContinuationNavigationScript,runScaleContinuationJourneys} from './product-scale-continuation.mjs';
import {productStorageSnapshot,verifyProductScaleRequests} from './product-scale-gate.mjs';
import {frontendSourceDigest,DUMMY_AUTHORIZATION} from './shared-resource-gate.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');

function inputFixture(callback){
  const parent=mkdtempSync('/private/tmp/pi-scale-continuation-tests-'),origin=join(parent,'pi-product-scale-generated-fixture'),source=join(parent,'source'),binary=join(parent,'binary'),root=join(parent,'output');
  try{
    for(const path of [origin,join(origin,'data'),source,join(source,'src')])mkdirSync(path,{mode:0o700});
    writeFileSync(binary,'synthetic pinned artifact');writeFileSync(join(source,'src','main.ts'),'// synthetic source');
    writeFileSync(join(origin,'data','pi.sqlite'),'synthetic closed SQLite bytes');writeFileSync(join(origin,'data','pi.sqlite-wal'),'synthetic WAL bytes');
    const identity={conversations:Array.from({length:1005},(_,index)=>`c${index}`),messages:Array.from({length:2010},(_,index)=>`m${index}`),submissions:1005};
    const proof={conversations:1005,submissions:1005,messages:2010,allHistoryPositionsVerified:true,allMetaIdentitiesVerified:true};
    const requests=Array.from({length:1005},(_,index)=>({kind:'answer',index,completed:true,failed:false}));
    const receipt={schema:'gneauxghts-product-scale-gate-v1',status:'failed',binarySha256:hash(readFileSync(binary)),frontendSourceSha256:frontendSourceDigest(source),lastSeedState:{status:'done'},seed:{verified:proof,probeListenersAfter:0},beforeRestart:proof,
      providerRequests:requests,providerAccounting:verifyProductScaleRequests(requests),error:'Error: script timeout during first mounted navigation',storage:[{label:'process-closed',atMs:1,...productStorageSnapshot(join(origin,'data'))}]};
    const persist=()=>{writeFileSync(join(origin,'product-scale-gate.json'),JSON.stringify(receipt));writeFileSync(join(origin,'private-product-identities.json'),JSON.stringify(identity))};persist();
    return callback({parent,origin,source,binary,root,identity,receipt,persist,options:{'origin-root':origin,root,source,binary,sha256:receipt.binarySha256,'closed-process-confirmed':'yes'}});
  }finally{rmSync(parent,{recursive:true,force:true})}
}
test('closed generated copy preserves every byte/mode and hashes immutable original receipts',()=>inputFixture(({origin,root,options})=>{
  const before=closedScaleTreeManifest(join(origin,'data')),prepared=prepareScaleContinuation(options);
  assert.deepEqual(closedScaleTreeManifest(prepared.dataRoot),before);assert.deepEqual(closedScaleTreeManifest(join(origin,'data')),before);
  assert.equal(prepared.inputs.receiptSha256,hash(readFileSync(join(origin,'product-scale-gate.json'))));
  assert.equal(prepared.inputs.storageManifestSha256,before.sha256);assert.equal(prepared.inputs.originalStatus,'failed');
  writeFileSync(join(root,'data','pi.sqlite'),'new copied fixture changes');assert.deepEqual(closedScaleTreeManifest(join(origin,'data')),before);
}));
test('incomplete seed, successful original, absent closure, identity loss and refused provider cannot be continued',()=>{
  for(const corrupt of [
    value=>{value.receipt.lastSeedState.status='failed'},value=>{value.receipt.status='passed-bounded-product-scale-fixture'},
    value=>{value.receipt.storage[0].label='process-exit-unconfirmed'},value=>{value.identity.messages[1004]=value.identity.messages[1003]},
    value=>{value.receipt.providerRequests[165].failed=true},value=>{value.receipt.beforeRestart.allHistoryPositionsVerified=false},
    value=>{value.receipt.beforeRestartUi={mountedNavigation:[]}},value=>{value.receipt.error='Some unrelated seed error'}
  ])inputFixture(value=>{corrupt(value);value.persist();assert.throws(()=>prepareScaleContinuation(value.options));assert.equal(existsSync(value.root),false)});
});
test('native owner closure acknowledgement, pinned source and unchanged closed bytes are mandatory',()=>{
  inputFixture(({options})=>assert.throws(()=>prepareScaleContinuation({...options,'closed-process-confirmed':'no'}),/closure confirmation/));
  inputFixture(({options,source,root})=>{writeFileSync(join(source,'src','main.ts'),'changed source');assert.throws(()=>prepareScaleContinuation(options),/source differs/);assert.equal(existsSync(root),false)});
  inputFixture(({options,origin,root})=>{writeFileSync(join(origin,'data','pi.sqlite-wal'),'changed WAL');assert.throws(()=>prepareScaleContinuation(options),/storage changed/);assert.equal(existsSync(root),false)});
  inputFixture(({options,origin,root})=>{symlinkSync('/private/tmp',join(origin,'data','escape'));assert.throws(()=>prepareScaleContinuation(options),/symlink/);assert.equal(existsSync(root),false)});
  assert.throws(()=>parseScaleContinuationArguments([]));
});
test('strict metadata-only fixture refuses every inference POST, foreign route and credential',()=>{
  for(const authorization of [undefined,DUMMY_AUTHORIZATION])assert.equal(strictContinuationFixtureReply('GET','/local/v1/models',authorization).data[0].id,'pi-native-fixture');
  for(const route of ['/local/v1/chat/completions','/local/v1/models'])assert.throws(()=>strictContinuationFixtureReply('POST',route),/Every new provider inference POST/);
  assert.throws(()=>strictContinuationFixtureReply('GET','/foreign/models'),/exact local model metadata/);
  assert.throws(()=>strictContinuationFixtureReply('GET','/local/v1/models','Bearer forbidden'),/authorization/);
});
test('continuation ordering preserves exact public verifies, actual navigation, archive and closed-owner restart',async()=>{
  const steps=[];let closed=false;
  const journeys=await runScaleContinuationJourneys({execute:async action=>{assert(!closed);steps.push(action);if(action==='close'){closed=true;return {metaDocuments:1005,inputSubmissions:1005}}return {actual:action}},
    navigate:async()=>{assert(!closed);steps.push('navigate');return {frames:2}},stop:async()=>{assert(closed);steps.push('stop')},launch:async()=>{assert(closed);steps.push('launch');closed=false},assertNoInference:()=>{}});
  assert.deepEqual(steps,['verify','navigate','archive','close','stop','launch','verify','navigate','close']);assert.equal(journeys.closedAfter.inputSubmissions,1005);
});
test('unexpected provider work stops continuation before archive or restart',async()=>{
  const steps=[];let posts=0;
  await assert.rejects(runScaleContinuationJourneys({execute:async action=>{steps.push(action);return {}},navigate:async()=>{steps.push('navigate');posts++},stop:async()=>steps.push('stop'),launch:async()=>steps.push('launch'),assertNoInference:()=>assert.equal(posts,0,'No new inference allowed')}),/No new inference/);
  assert.deepEqual(steps,['verify','navigate']);
});
test('two actual frame callbacks are required and missing frame has a real bounded deadline',async()=>{
  const callbacks=[];let settled=false;
  const pending=observeScaleContinuationFrames({frame:callback=>callbacks.push(callback),timeoutMs:1000}).then(value=>{settled=true;return value});
  assert.equal(callbacks.length,1);assert.equal(settled,false);callbacks.shift()();await Promise.resolve();assert.equal(callbacks.length,1);assert.equal(settled,false);
  callbacks.shift()();assert.equal((await pending).frames,2);
  await assert.rejects(observeScaleContinuationFrames({frame:()=>{},timeoutMs:5}),/two-frame observation deadline/);
});
test('real navigation script visits all three titles and original message destinations using actual frame callbacks',async()=>{
  const identity={conversations:Array.from({length:1005},(_,index)=>`c${index}`),messages:Array.from({length:2010},(_,index)=>`m${index}`),submissions:1005};
  let selected='Synthetic product scale 0000',frames=0;const visited=[],messageIds=[];
  const title=index=>`Synthetic product scale ${String(index).padStart(4,'0')}`,reply=index=>`Synthetic product scale reply ${index}.`;
  const document={querySelector:selector=>{
    if(selector==='[aria-label="Thought partner chat"]')return {};
    if(selector==='[aria-label="Chat title"]')return {value:selected};
    const id=selector.match(/^\[data-chat-message-id="(m\d+)"\]$/)?.[1];if(id){messageIds.push(id);return {textContent:reply((Number(id.slice(1))-1)/2)}}return null;
  },querySelectorAll:selector=>selector==='button'?[{disabled:false,getAttribute:()=>null,textContent:'Conversations',click:()=>{}}]:selector==='[role="menuitem"]'?[0,502,1004].map(index=>({textContent:title(index),click:()=>{selected=title(index);visited.push(index)}})):[]};
  const window={__productApi:{},__productProbe:{productScaleTitle:title,productScaleReply:reply}};
  const result=await new Function('window','document','requestAnimationFrame',`return (async function(){${scaleContinuationNavigationScript()}}).call(null,${JSON.stringify(identity)})`)(window,document,callback=>{frames++;queueMicrotask(callback)});
  assert.deepEqual(result.mountedNavigation.map(row=>row.index),[0,502,1004]);assert.deepEqual(visited,[502,1004]);assert.deepEqual(messageIds,['m1','m1005','m2009']);assert.equal(frames,6);
  assert.doesNotMatch(scaleContinuationNavigationScript(),/seedProductScale|sendMessage|createConversation/);
});
