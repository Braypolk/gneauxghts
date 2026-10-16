import test from 'node:test';
import assert from 'node:assert/strict';
import {assertChurnRequests,assertChurnMetadata,assertArchiveMetadata,assertChurnVisibility} from './resource-churn-gate.mjs';

const metadata=()=>({coverage:'closed-database-metadata-only',callerClosed:true,
  documentFamilies:[
    {kind:'"gneauxghts.pi.chat-presentation"',family:0,current:3,retired:0,revisions:3},
    {kind:'"gneauxghts.pi.evidence-run"',family:1,current:3,retired:0,revisions:3}],
  totals:{conversations:3,entries:9,tasks:4,submissions:3,documents:6,document_revisions:6}});
const archivedMetadata=()=>{const after=metadata();after.documentFamilies[0].revisions+=2;after.totals.document_revisions+=2;return after;};

test('requires exact successful seed requests and rejects unsolicited restart inference',()=>{
  const requests=Array.from({length:3},()=>({case:'short',completed:true,failed:false}));
  assertChurnRequests(requests);
  assert.throws(()=>assertChurnRequests([...requests,requests[0]]),/implicitly/);
  assert.throws(()=>assertChurnRequests([{...requests[0],failed:true},...requests.slice(1)]),/must complete/);
});
test('closed metadata counts distinguish family growth, revision growth and unchanged retained data',()=>{
  const before=metadata();
  assertChurnMetadata(before,structuredClone(before));
  assert.throws(()=>assertChurnMetadata(before,{...before,documentFamilies:[{...before.documentFamilies[0],revisions:6}]}),/family\/revision/);
  assert.throws(()=>assertChurnMetadata(before,{...before,totals:{...before.totals,documents:7}}),/lifecycle/);
  assert.throws(()=>assertChurnMetadata(before,archivedMetadata()),/family\/revision/,'Read-only stage cannot consume archive allowance');
});
test('archive accounting permits exactly two revisions in the encoded presentation singleton family',()=>{
  const before=metadata(),after=archivedMetadata();
  assertArchiveMetadata(before,after);
  assert.deepEqual(before,metadata(),'Assertion must not mutate baseline');
  assert.deepEqual(after,archivedMetadata(),'Assertion must not mutate observed counts');
  for(const revisions of [2,3,4,6]){
    const wrong=archivedMetadata();wrong.documentFamilies[0].revisions=revisions;wrong.totals.document_revisions=revisions+3;
    assert.throws(()=>assertArchiveMetadata(before,wrong),/family\/revision/);
  }
  const wrongTotal=archivedMetadata();wrongTotal.totals.document_revisions++;
  assert.throws(()=>assertArchiveMetadata(before,wrongTotal),/lifecycle/);
});
test('archive accounting rejects wrong kinds, wrong family, extra revisions and missing presentation baseline',()=>{
  const wrongKind=archivedMetadata();wrongKind.documentFamilies[0].revisions-=2;wrongKind.documentFamilies[1].revisions+=2;
  assert.throws(()=>assertArchiveMetadata(metadata(),wrongKind),/family\/revision/);
  const extra=archivedMetadata();extra.documentFamilies[1].revisions++;
  assert.throws(()=>assertArchiveMetadata(metadata(),extra),/family\/revision/);
  for(const kind of ['gneauxghts.pi.chat-presentation','"gneauxghts.pi.evidence-run"']){
    const before=metadata();before.documentFamilies[0].kind=kind;
    assert.throws(()=>assertArchiveMetadata(before,archivedMetadata()),/singleton family/);
  }
  const wrongFamily=metadata();wrongFamily.documentFamilies[0].family=1;
  assert.throws(()=>assertArchiveMetadata(wrongFamily,archivedMetadata()),/singleton family/);
  const duplicate=metadata();duplicate.documentFamilies.push({...duplicate.documentFamilies[0]});
  assert.throws(()=>assertArchiveMetadata(duplicate,archivedMetadata()),/singleton family/);
});
test('archive accounting rejects new durable lifecycle rows, new families and retirement',()=>{
  for(const table of ['conversations','entries','tasks','submissions','documents']){
    const after=archivedMetadata();after.totals[table]++;
    assert.throws(()=>assertArchiveMetadata(metadata(),after),/lifecycle/,table);
  }
  const newFamily=archivedMetadata();newFamily.documentFamilies.push({kind:'"unexpected"',family:0,current:1,retired:0,revisions:1});
  assert.throws(()=>assertArchiveMetadata(metadata(),newFamily),/family\/revision/);
  for(const index of [0,1]){
    const retired=archivedMetadata();retired.documentFamilies[index].current--;retired.documentFamilies[index].retired++;
    assert.throws(()=>assertArchiveMetadata(metadata(),retired),/family\/revision/);
  }
});
test('every metadata checkpoint requires literal closed-writer confirmation and matching closed coverage',()=>{
  for(const assertion of [assertChurnMetadata,assertArchiveMetadata]){
    for(const side of ['before','after'])for(const callerClosed of [false,undefined,'true',1]){
      const before=metadata(),after=assertion===assertArchiveMetadata?archivedMetadata():metadata();
      (side==='before'?before:after).callerClosed=callerClosed;
      assert.throws(()=>assertion(before,after),/writers/);
    }
    for(const side of ['before','after']){
      const before=metadata(),after=assertion===assertArchiveMetadata?archivedMetadata():metadata();
      (side==='before'?before:after).coverage='live-database';
      assert.throws(()=>assertion(before,after));
    }
  }
});
test('public archive visibility hides only the target while retaining and restoring all three chats',()=>{
  const ids=['pi-1','pi-2','pi-3'],active=ids.map(id=>({id,status:'active'}));
  assertChurnVisibility({visible:active,retained:active},ids);
  const retained=active.map(row=>({...row,status:row.id==='pi-3'?'archived':'active'})),visible=active.slice(0,2);
  assertChurnVisibility({visible,retained},ids,'pi-3');
  assertChurnVisibility({visible:active,retained:active},ids);
  assert.throws(()=>assertChurnVisibility({visible:active,retained},ids,'pi-3'),/active list/);
  assert.throws(()=>assertChurnVisibility({visible:active.slice(1),retained},ids,'pi-3'),/active list/);
  assert.throws(()=>assertChurnVisibility({visible,retained:active},ids,'pi-3'),/status/);
  assert.throws(()=>assertChurnVisibility({visible,retained:retained.slice(0,2)},ids,'pi-3'),/retain/);
  assert.throws(()=>assertChurnVisibility({visible,retained:[...retained,retained[0]]},ids,'pi-3'),/retain/);
  assert.throws(()=>assertChurnVisibility({visible,retained},ids),/active list/,'Restore must repopulate active list');
});
