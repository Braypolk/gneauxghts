import test from 'node:test';
import assert from 'node:assert/strict';
import {assertChurnRequests,assertChurnMetadata} from './resource-churn-gate.mjs';

test('requires exact successful seed requests and rejects unsolicited restart inference',()=>{
  const requests=Array.from({length:3},()=>({case:'short',completed:true,failed:false}));
  assertChurnRequests(requests);
  assert.throws(()=>assertChurnRequests([...requests,requests[0]]),/implicitly/);
  assert.throws(()=>assertChurnRequests([{...requests[0],failed:true},...requests.slice(1)]),/must complete/);
});
test('closed metadata counts distinguish family growth, revision growth and unchanged retained data',()=>{
  const before={coverage:'closed-database-metadata-only',callerClosed:true,documentFamilies:[{kind:'evidence-run',family:1,current:3,retired:0,revisions:5}],totals:{documents:3}};
  assertChurnMetadata(before,structuredClone(before));
  assert.throws(()=>assertChurnMetadata(before,{...before,callerClosed:false}),/writers/);
  assert.throws(()=>assertChurnMetadata(before,{...before,documentFamilies:[{...before.documentFamilies[0],revisions:6}]}),/family\/revision/);
  assert.throws(()=>assertChurnMetadata(before,{...before,totals:{documents:4}}),/lifecycle/);
});
