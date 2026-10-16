import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Harness, MemoryStorage, createRegistry, UsageDoc, type ConversationId } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Evidence, notesExtension } from './notesExtension';
import { parseResearchSelection, researchExtensions, ResearchWorker } from './research';
import { researchUsage, missingResearchUsage, emptyUsageCounters, usageCounters, addUsageCounters, CompactionState } from './compactionState';
import { compactionExtension } from './compaction';
import type { ActiveAdmission } from './lifecycle';
import type { RequestPolicies } from './nativeProvider';
const native=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
const harnesses:Harness[]=[];
const source={kind:'passage',noteId:'n1',title:'One',excerpt:'selected primary text',passage:{id:'passage-1',noteId:'n1',revisions:[]}};
beforeEach(()=>{let active=false;const read=new Set<string>();native.invoke.mockReset();native.invoke.mockImplementation(async(command,args)=>{
  if(command==='pi_begin_research'){if(active)throw new Error('Another research worker is active');active=true;return {scope:{note_ids:['n1']},referenceInstant:'now',discoveryHints:[]};}
  if(command==='pi_evidence_operation'){read.add('passage-1');return {payload:{items:[{evidenceId:'passage-1',text:'selected primary text'}]},sources:[source]};}
  if(command==='pi_finish_research'){if(args.selection.evidence_ids.some((id:string)=>!read.has(id)))throw new Error('unknown or unread');
    return args.selection.evidence_ids.length?{payload:{items:[{evidenceId:'passage-1',text:'selected primary text'}],gaps:[]},sources:[source]}:{payload:{items:[],gaps:args.selection.gaps},sources:[]};}
  if(command==='pi_release_research'){active=false;return;}
});});
afterEach(async()=>{await Promise.all(harnesses.splice(0).map(h=>h.close(context)));});
async function setup(adaptive=false){
  const policies:RequestPolicies=new Map(),permitted=new Set<number>();let harness:Harness;
  const admitted={admission:{id:'native',provider:'local',model:'m',tools:true,images:false,audio:false,video:false,reasoningEffort:'off',serviceTier:'standard'},snapshot:{history:[]}} as unknown as ActiveAdmission;
  const deps={harness:()=>harness,policies,permitted,admission:(id:number)=>permitted.has(id)?admitted:undefined};
  const notes=notesExtension(permitted,policies),registry=createRegistry();registry.install(notes);
  for(const extension of researchExtensions(deps,notes))registry.install(extension);
  if(adaptive)registry.install(compactionExtension({...deps,capacity:async()=>32768}));
  const models=createModels(),faux=fauxProvider({provider:'local',models:[{id:'m'}]});models.setProvider(faux.provider);
  const storage=new MemoryStorage();harness=await Harness.open(storage,{registry,models,settings:{retry:{enabled:false},compaction:{enabled:false,keepRecentTokens:1024}}},context);harnesses.push(harness);
  const parent=await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'local',modelId:'m'},instructions:'Parent-only private workflow',tools:registry.snapshot().tools().map(({tool})=>tool)}},context);
  permitted.add(parent.id);
  await harness.commit(async tx=>{Object.assign(await tx.doc(Evidence,parent.id),{access:'full',sessionId:'parent',contextJson:'[]',grantsJson:'["n1"]'});},context);
  return {harness,parent,faux,permitted,policies,storage};
}
describe('Pi-owned research isolation',()=>{
  it('accepts only closed bounded selection objects with explicit empty gaps',()=>{
    for(const raw of ['prose','{"evidence_ids":[],"gaps":[]}','{"evidence_ids":["a","a"],"gaps":[]}',
      '{"evidence_ids":[],"gaps":["guessed"]}','{"evidence_ids":["a"],"gaps":[],"prose":"claim"}'])expect(()=>parseResearchSelection(raw)).toThrow();
    expect(parseResearchSelection('{"evidence_ids":["a"],"gaps":["coverage_incomplete"]}')).toEqual({evidence_ids:['a'],gaps:['coverage_incomplete']});
  });
  it('runs a task-owned evidence-only conversation and returns native passages with fresh parent selectors',async()=>{
    const {harness,parent,faux,storage}=await setup();let workerSeen=false,parentHandoff='';
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('research_notes',{question:'Focused gap',note_ids:['n1']},{id:'research'}),{stopReason:'toolUse'}),
      (request)=>{const serialized=JSON.stringify(request);expect(serialized).not.toContain('Parent-only private');expect(serialized).not.toContain('parent secret question');
        expect(serialized).toContain('Focused gap');const names=request.messages.filter(m=>m.role==='system').flatMap(m=>m.toolsAdded?.map(t=>t.name)??[]);
        expect(names.sort()).toEqual(['find_notes','list_note_activity','read_notes']);workerSeen=true;
        return fauxAssistantMessage(fauxToolCall('read_notes',{note_id:'n1'},{id:'read'}),{stopReason:'toolUse'});},
      fauxAssistantMessage('{"evidence_ids":["passage-1"],"gaps":[]}'),
      (request)=>{parentHandoff=JSON.stringify(request);return fauxAssistantMessage('Parent answer');}
    ]);
    expect((await (await parent.submit({type:'input',content:'parent secret question'},context)).wait(context)).status).toBe('done');
    expect(workerSeen).toBe(true);expect(parentHandoff).toContain('selected primary text');expect(parentHandoff).toContain('S1');
    expect(parentHandoff).not.toContain('isolated vault evidence researcher');
    expect((await harness.snapshot(Evidence,parent.id,context))?.sourcesJson).toContain('passage-1');
    const graph=await harness.inspect(context);expect(graph.tasks).toHaveLength(0);
    expect(native.invoke.mock.calls.filter(([command])=>command==='pi_release_research')).toHaveLength(1);
    const child=(await storage.scanConversations({},128,undefined,context)).items.find(record=>record.owner?.conversationId===parent.id);
    expect(child).toBeDefined();expect((await harness.snapshot(ResearchWorker,child!.id,context))?.parentId).toBe(parent.id);
    const workerLedger=await harness.snapshot(UsageDoc,child!.id,context),workerUsage=emptyUsageCounters();
    for(const value of Object.values(workerLedger?.models??{}))addUsageCounters(workerUsage,usageCounters(value));
    const parentEntries=(await storage.scanEntries({conversationId:parent.id,order:'ascending'},128,undefined,context)).items;
    const projected=parentEntries.map(researchUsage).filter(value=>value!==undefined);
    expect(projected).toEqual([workerUsage]);expect(workerUsage.totalTokens).toBeGreaterThan(0);
    expect(missingResearchUsage(parentEntries,workerUsage)).toEqual(emptyUsageCounters());
    expect(missingResearchUsage([],workerUsage)).toEqual(workerUsage);
    expect((await harness.snapshot(UsageDoc,parent.id,context))?.tools).toEqual({});
  });
  it('rejects unread selection at native handoff without promoting worker text to parent evidence',async()=>{
    const {harness,parent,faux}=await setup();faux.setResponses([
      fauxAssistantMessage(fauxToolCall('research_notes',{question:'gap'},{id:'research'}),{stopReason:'toolUse'}),
      fauxAssistantMessage('{"evidence_ids":["unknown"],"gaps":[]}'),fauxAssistantMessage('Direct evidence remains available')]);
    await (await parent.submit({type:'input',content:'question'},context)).wait(context);
    expect((await harness.snapshot(Evidence,parent.id,context))?.sourcesJson).toBe('[]');
    expect(native.invoke.mock.calls.some(([command])=>command==='pi_release_research')).toBe(true);
  });
  it('compacts an extended isolated worker and resumes evidence-only selection with paired current results',async()=>{
    const {parent,faux,policies,harness,storage}=await setup(true);let reads=0,summaries=0;
    const original=native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async(command,args)=>{const result=await original(command,args);
      if(command==='pi_evidence_operation')return {...result,payload:{items:[{evidenceId:'passage-1',text:'primary '.repeat(700)}]}};
      return result;});
    faux.setResponses([fauxAssistantMessage(fauxToolCall('research_notes',{question:'Extended focused gap'},{id:'research'}),{stopReason:'toolUse'}),
      ...Array.from({length:45},()=>((request,options)=>{
        const purpose=policies.get(options!.sessionId!)?.purpose;
        if(purpose==='summary'){summaries++;expect(JSON.stringify(request)).toContain('Extended focused gap');return fauxAssistantMessage('{"summary":"Focused question retained; repeated reads covered passage-1; continue checking the remaining evidence gap"}');}
        if(purpose==='researchSelection'){
          expect(JSON.stringify(request.messages)).toContain('Extended focused gap');
          const messages=request.messages;for(let index=0;index<messages.length;index++){const message=messages[index];
            if(message.role==='toolResult')expect(messages.slice(0,index).some(candidate=>candidate.role==='assistant'&&candidate.content.some(block=>block.type==='toolCall'&&block.id===message.toolCallId))).toBe(true);}
          if(reads++<30)return fauxAssistantMessage(fauxToolCall('read_notes',{note_id:'n1'},{id:`read-${reads}`}),{stopReason:'toolUse'});
          return fauxAssistantMessage('{"evidence_ids":["passage-1"],"gaps":[]}');
        }
        return fauxAssistantMessage('Parent uses the selected native passage');
      }) as Parameters<typeof faux.setResponses>[0][number])]);
    const settled=await (await parent.submit({type:'input',content:'Extended research request'},context)).wait(context);
    const child=(await storage.scanConversations({},128,undefined,context)).items.find(record=>record.owner?.conversationId===parent.id);
    expect(settled.status).toBe('done');expect(summaries).toBeGreaterThan(1);expect(reads,JSON.stringify(await harness.snapshot(CompactionState,child!.id,context))).toBe(31);
    expect(native.invoke.mock.calls.some(([command])=>command==='pi_finish_research')).toBe(true);
  });
  it('an explicit worker deadline aborts and joins owned inference and releases admission for another invocation',async()=>{
    const {parent,faux}=await setup();
    faux.setResponses([fauxAssistantMessage(fauxToolCall('research_notes',{question:'slow gap',timeout_ms:20},{id:'slow'}),{stopReason:'toolUse'}),
      (_request,options)=>new Promise(resolve=>options?.signal?.addEventListener('abort',()=>resolve(fauxAssistantMessage('aborted',{stopReason:'aborted'})),{once:true})),fauxAssistantMessage('Timed out explicitly')]);
    const submitted=await parent.submit({type:'input',content:'question'},context);
    await vi.waitFor(()=>expect(native.invoke.mock.calls.some(([command])=>command==='pi_release_research')).toBe(true));
    await submitted.wait(context);
    expect(native.invoke.mock.calls.filter(([command])=>command==='pi_release_research')).toHaveLength(1);
    faux.setResponses([fauxAssistantMessage(fauxToolCall('research_notes',{question:'another gap'},{id:'next'}),{stopReason:'toolUse'}),
      fauxAssistantMessage('{"evidence_ids":[],"gaps":["no_match"]}'),fauxAssistantMessage('Next invocation completed')]);
    expect((await (await parent.submit({type:'input',content:'Different remaining gap'},context)).wait(context)).status).toBe('done');
    expect(native.invoke.mock.calls.filter(([command])=>command==='pi_begin_research')).toHaveLength(2);
    expect(native.invoke.mock.calls.filter(([command])=>command==='pi_release_research')).toHaveLength(2);
  });
});
