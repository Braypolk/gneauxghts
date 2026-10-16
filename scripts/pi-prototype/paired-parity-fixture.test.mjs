import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planParityReply,embeddedObjects,PARITY_ANSWER } from './paired-parity-fixture.mjs';
import { canonicalSnapshot,canonicalIdentityCounts,PARITY_LIMITS } from './paired-parity-gate.mjs';
import { parityBrowserAction } from './paired-parity-browser.mjs';

const names=['read_note','read_notes','find_notes','propose_note','propose_note_change'];
function body(lane,protocol,marker,tools=[],context='') {
  const offered=names.map(name=>({type:'function',function:{name,parameters:{type:'object'}}}));
  if(lane==='old')offered.push({type:'function',function:{name:'final_result',parameters:{type:'object',properties:{segments:{type:'array'}}}}});
  const tail=tools.flatMap(([name,result],index)=>protocol==='compatible'?[{role:'assistant',tool_calls:[{id:String(index),function:{name,arguments:'{}'}}]},{role:'tool',content:JSON.stringify(result)}]:[{type:'function_call',name,call_id:String(index),arguments:'{}'},{type:'function_call_output',call_id:String(index),output:JSON.stringify(result)}]);
  const history=[{role:'system',content:context},{role:'user',content:marker},...tail];
  return protocol==='compatible'?{messages:history,tools:offered}:{input:history,tools:offered.map(item=>({type:'function',...item.function}))};
}
for(const lane of ['old','pi'])for(const protocol of ['compatible','responses']) {
  const plan=(marker,tools=[],context='')=>planParityReply(body(lane,protocol,marker,tools,context),lane,protocol);
  test(`${lane}/${protocol}: selected/current evidence follows actual dialect and issued IDs`,()=>{
    const current=plan('PARITY:READ:note1');assert.equal(current.tool.name,lane==='old'?'read_notes':'read_note');
    assert.deepEqual(JSON.parse(current.tool.arguments),lane==='old'?{purpose:'answer',note_id:'note1'}:{noteId:'note1'});
    assert.throws(()=>plan('PARITY:READ:note1',[[current.tool.name,{items:[{evidenceId:'E1'}]}]]),/actually delivered/);
    const read=[current.tool.name,{items:[{sourceId:'S8',evidenceId:'E1'}]}];
    const answer=plan('PARITY:READ:note1',[read]);const raw=lane==='old'?answer.tool.arguments:answer.text;
    assert.deepEqual(JSON.parse(raw).segments[0].sources,['S8']);
    assert.throws(()=>plan('PARITY:CONTEXT'),/context omitted/);
    const context=lane==='old'?'Adjacent editor hint:\n{"noteId":"note1","selectionRead":{"purpose":"answer","cursor":"exact"}}':'App context:\n[{"kind":"selected_excerpt","read":{"cursor":"exact"}}]';
    assert.deepEqual(JSON.parse(plan('PARITY:CONTEXT',[],context).tool.arguments),{...(lane==='old'?{purpose:'answer'}:{}),cursor:'exact'});
  });
  test(`${lane}/${protocol}: retained discovery never becomes authority until read`,()=>{
    const search=plan('PARITY:HISTORY:note1');assert.equal(search.tool.name,'find_notes');
    const found=['find_notes',{items:[{evidenceId:'current'},{evidenceId:'retained',historical:{changeKind:'removed'}}]}];
    assert.deepEqual(JSON.parse(plan('PARITY:HISTORY:note1',[found]).tool.arguments),{...(lane==='old'?{purpose:'answer'}:{}),evidence_ids:['retained']});
    assert.throws(()=>plan('PARITY:HISTORY:note1',[found,['read_notes',{items:[{evidenceId:'retained'}]}]]),/actually delivered/);
  });
  test(`${lane}/${protocol}: create dialect and strict denied reads`,()=>{
    const create=plan('PARITY:CREATE');assert.equal(create.tool.name,lane==='old'?'propose_note_change':'propose_note');
    assert.equal(JSON.parse(create.tool.arguments).operation,lane==='old'?'create':undefined);
    const readName=lane==='old'?'read_notes':'read_note';
    const denied=plan('PARITY:DENIED:note1',[[readName,{error:'not allowed'}]]);
    assert.match(lane==='old'?denied.tool.arguments:denied.text,/no note facts/);
    assert.throws(()=>plan('PARITY:DENIED:note1',[[readName,{sourceId:'S1'}]]),/Denied note delivered/);
    const hello=plan('PARITY:HELLO');assert.equal(lane==='old'?JSON.parse(hello.tool.arguments).segments[0].text:hello.text,PARITY_ANSWER);
  });
}
test('fixture refuses absent tools, real authorization and unknown scenarios',()=>{
  const request=body('pi','compatible','PARITY:CREATE');request.tools=[];
  assert.throws(()=>planParityReply(request,'pi'),/unavailable/);
  assert.throws(()=>planParityReply(body('pi','compatible','PARITY:HELLO'),'pi','compatible','Bearer actual-secret'),/credentials/);
  assert.throws(()=>planParityReply(body('pi','compatible','unknown'),'pi'),/Unknown synthetic/);
});
test('embedded context scanner handles bracket prose, quotes and nested selectors',()=>{
  const result=embeddedObjects('Untrusted [invalid] prose {"selection":"[x] \\"quote\\"","selectionRead":{"cursor":"canonical"}} trailing');
  assert(result.some(item=>item.cursor==='canonical'));
});
test('browser driver remains serializable and explicitly reports permission capability difference',()=>{
  assert.doesNotThrow(()=>new Function(`return (${parityBrowserAction.toString()})`));
  assert(PARITY_LIMITS.some(value=>value.includes('no request_note_access')));
});
test('canonical snapshots constrain receipts to generated ordinary files and unique managed IDs',()=>{
  const root=mkdtempSync(join(tmpdir(),'pi-parity-unit-'));
  try {
    mkdirSync(join(root,'vault'));const path=join(root,'vault','Plan.md');
    writeFileSync(path,'---\ngneauxghts:\n  id: note1\n  kind: note\n---\n\naccepted');
    const first=canonicalSnapshot([path,path],root);assert.equal(Object.values(first).length,1);
    assert.deepEqual(canonicalIdentityCounts(root,['note1']),{note1:1});
    copyFileSync(path,join(root,'vault','Duplicate.md'));assert.deepEqual(canonicalIdentityCounts(root,['note1']),{note1:2});
    symlinkSync(path,join(root,'alias.md'));assert.throws(()=>canonicalSnapshot([join(root,'alias.md')],root));
    assert.throws(()=>canonicalIdentityCounts(root,['note1']));
    mkdirSync(join(root,'other'));assert.throws(()=>canonicalSnapshot([path],join(root,'other')),/escaped generated/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
