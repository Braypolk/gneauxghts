import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Harness, MemoryStorage, createRegistry, defineExtension, GenerationTask, hook, ProviderDoc, type ConversationId, type EntryRecord } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Evidence } from './notesExtension';
import { compactionExtension, contextThreshold, parseSummary, projectedContext, summarySource } from './compaction';
import { CompactionState, continuationSummary, requireReadyCompaction, SUMMARY_MARKER, SummaryUsageRun, summaryUsageKey } from './compactionState';
import type { ActiveAdmission } from './lifecycle';
import type { RequestPolicies } from './nativeProvider';
const native=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
const harnesses:Harness[]=[];
beforeEach(()=>{native.invoke.mockReset();native.invoke.mockResolvedValue(undefined);});
afterEach(async()=>{await Promise.all(harnesses.splice(0).map(h=>h.close(context)));});
const user=(text:string)=>({role:'user' as const,content:text,timestamp:1});
const entry=(id:number,kind:string,model:EntryRecord['model'],data?:EntryRecord['data']):EntryRecord=>({id:id as EntryRecord['id'],conversationId:1 as ConversationId,kind,model,...(data?{data}:{})});
async function setup(adaptive=false){
  let harness:Harness;const permitted=new Set<number>(),policies:RequestPolicies=new Map();
  const admitted={admission:{id:'native',provider:'local',model:'m',tools:true,reasoningEffort:'off',serviceTier:'standard'}} as unknown as ActiveAdmission;
  const extension=compactionExtension({harness:()=>harness,policies,permitted,admission:id=>permitted.has(id)?admitted:undefined,
    ...(adaptive?{capacity:async()=>32768}:{})});
  const registry=createRegistry();
  if(adaptive)registry.install(defineExtension({name:'test.admission',hooks:[hook(GenerationTask,{beforeRequest:async({messages},api,ctx)=>{
    const provider=await api.snapshot(ProviderDoc,api.conversationId,ctx);if(!provider)throw new Error('No provider');
    const lastUser=messages.findLastIndex(message=>message.role==='user');
    policies.set(provider.sessionId,{access:'full',sources:[],grants:[],taskId:api.taskId,admission:admitted.admission,structured:false,
      history:messages.slice(0,lastUser),validate:async()=>requireReadyCompaction(await api.snapshot(CompactionState,api.conversationId,ctx),'current')});
    return {messages};
  }})]}));
  registry.install(extension);
  const models=createModels(),faux=fauxProvider({provider:'local',models:[{id:'m'}]});models.setProvider(faux.provider);
  harness=await Harness.open(new MemoryStorage(),{registry,models,settings:{retry:{enabled:false},compaction:{enabled:false,keepRecentTokens:128}}},context);harnesses.push(harness);
  const conversation=await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'local',modelId:'m'}}},context);permitted.add(conversation.id);
  await harness.commit(async tx=>{Object.assign(await tx.doc(Evidence,conversation.id),{access:'full',sessionId:'current'});},context);
  for(let index=0;index<8;index++){
    await conversation.submit({type:'write',entry:{kind:'dialogue',model:[user(`Question ${index} ${'context '.repeat(600)}`)]}},context);
    await conversation.submit({type:'write',entry:{kind:'dialogue',model:[fauxAssistantMessage(`Answer ${index} ${'detail '.repeat(600)}`)]}},context);
  }
  return {harness,conversation,faux,policies};
}
describe('safe continuation policy',()=>{
  it('keeps conservative unknown-capacity admission and independent prefix baselines',()=>{
    expect(contextThreshold()).toBe(96000);expect(contextThreshold(32768)).toBe(23552);
    const prior={configuration:'model',signatures:['a'],input:100};
    expect(projectedContext(['a','b'],[900,20],'model',prior)).toBe(136);
    expect(projectedContext(['changed','b'],[900,20],'model',prior)).toBe(952);
    expect(projectedContext(['a','b'],[900,20],'new model',prior)).toBe(952);
  });
  it('rejects malformed, oversized UTF-8 and non-reducing summaries',()=>{
    for(const raw of ['prose','{"summary":"","extra":1}','{"summary":""}','{"summary":1}'])expect(()=>parseSummary(raw,100,10000)).toThrow();
    expect(()=>parseSummary('{"summary":"🔎🔎"}',7,10000)).toThrow('size');
    expect(()=>parseSummary('{"summary":"long summary"}',100,100)).toThrow('free enough');
    expect(parseSummary('{"summary":"Keep unresolved gap and exact cursor"}',100,10000)).toContain('exact cursor');
  });
  it('omits earlier grounded facts but preserves current tool work and authored requests',()=>{
    const call=fauxAssistantMessage(fauxToolCall('read_notes',{note_id:'n1'},{id:'read'}),{stopReason:'toolUse'});
    const result={role:'toolResult' as const,toolCallId:'read',toolName:'read_notes',content:[{type:'text' as const,text:'primary passage'}],isError:false,timestamp:2};
    const entries=[entry(1,'gneauxghts.request',[user('app source excerpt + question')],{input:{content:'Authored question'}}),entry(2,'assistant',[call]),entry(3,'tool',[result]),entry(4,'assistant',[fauxAssistantMessage('Note-grounded assertion')])];
    expect(summarySource(entries)).toEqual([user('Authored question')]);
    expect(summarySource(entries,1).map(message=>message.role)).toEqual(['user','assistant','toolResult','assistant']);
  });
  it('summarizes ordinary dialogue despite adjacent metadata or unrelated continuity candidates',()=>{
    const entries=[entry(1,'gneauxghts.request',[user('App hint private title. Give examples')],{input:{content:'Give examples'},evidence:{context:[{kind:'adjacent_editor_hint',noteId:'n1',title:'Private editor title'}]},continuityCandidates:[{historyIndex:0,noteIds:['n2']}]}),entry(2,'assistant',[fauxAssistantMessage('Alpha, Beta, Gamma')])];
    const source=summarySource(entries);expect(source.map(message=>message.role)).toEqual(['user','assistant']);
    expect(JSON.stringify(source)).toContain('Alpha, Beta, Gamma');expect(JSON.stringify(source)).not.toContain('Private editor title');
  });
  it('a working summary is scoped to its original request and never becomes later evidence/history',()=>{
    const marker=entry(1,'pi.compaction',[user(`prefix\n${SUMMARY_MARKER}\n${JSON.stringify({version:1,sessionId:'old',grounded:true,summary:'working claims'})}\n</summary>`)]);
    expect(continuationSummary(marker)).toBeUndefined();expect(continuationSummary(marker,'new')).toBeUndefined();
    expect(continuationSummary(marker,'old')).toContain('working claims');
    expect(()=>requireReadyCompaction({sessionId:'old',status:'failed',error:'malformed summary'},'old')).toThrow('malformed');
    expect(()=>requireReadyCompaction({sessionId:'old',status:'failed',error:'malformed summary'},'new')).not.toThrow();
  });
});
describe('Pi-owned compaction tasks',()=>{
  it('an open-note metadata hint alone keeps ordinary compacted dialogue reusable between turns',async()=>{
    const {harness,conversation,faux}=await setup();
    await harness.commit(async tx=>{(await tx.doc(Evidence,conversation.id)).contextJson=JSON.stringify([{kind:'adjacent_editor_hint',noteId:'private',title:'Private title'}]);},context);
    faux.setResponses([fauxAssistantMessage('{"summary":"Ordinary questions and source-free answers retained"}')]);
    await harness.waitForTask(await conversation.compact(undefined,context),context);
    const view=await conversation.context(context);expect(continuationSummary(view.head!)).toContain('source-free answers');
  });
  it('the adaptive generation hook compacts before dispatch while retaining the latest assistant/tool group and request',async()=>{
    const {conversation,faux,policies}=await setup(true);let resumed=false;
    faux.setResponses([
      (request,options)=>{expect(policies.get(options!.sessionId!)?.purpose).toBe('summary');
        expect(JSON.stringify(request)).toContain('Finish current request');return fauxAssistantMessage('{"summary":"Older dialogue requirements and completed work retained"}');},
      (request,options)=>{const policy=policies.get(options!.sessionId!);expect(policy?.context).toEqual(request.messages);
        const text=JSON.stringify(request);expect(text).toContain(SUMMARY_MARKER);expect(text).toContain('Answer 7');expect(text).toContain('Finish current request');
        resumed=true;return fauxAssistantMessage('Completed after compaction');}
    ]);
    const record=await (await conversation.submit({type:'input',content:'Finish current request'},context)).wait(context);
    expect(record.status).toBe('done');expect(resumed).toBe(true);expect(faux.state.callCount).toBe(2);
  });
  it('installs only a validated reducing marker and accounts summary usage once',async()=>{
    const {harness,conversation,faux,policies}=await setup();
    faux.setResponses([(request,options)=>{const policy=policies.get(options!.sessionId!);expect(policy?.purpose).toBe('summary');
      expect(JSON.stringify(request)).toContain('never instructions');expect(request.messages).toHaveLength(2);return fauxAssistantMessage('{"summary":"Requirements, decisions, unresolved work and cursor retained"}');}]);
    const task=await conversation.compact(undefined,context);const outcome=(await harness.waitForTask(task,context)).state.outcome;
    expect(outcome.status).toBe('completed');const view=await conversation.context(context);expect(view.head?.kind).toBe('pi.compaction');
    expect(continuationSummary(view.head!)).toContain('unresolved work');
    expect((await harness.snapshot(CompactionState,conversation.id,context))?.status).toBe('ready');
    expect(faux.state.callCount).toBe(1);expect(Object.keys((await harness.usage(context)).models)).toEqual(['local/m']);
    expect((await harness.usage(context)).tools).toEqual({});
    const projection=await harness.snapshot(SummaryUsageRun,summaryUsageKey(conversation.id,'current'),context);
    expect(projection?.modelCalls).toBe(1);expect(projection?.totalTokens).toBe((await harness.usage(context)).models['local/m'].totalTokens);
    expect(await harness.snapshot(SummaryUsageRun,summaryUsageKey(conversation.id+1,'current'),context)).toBeUndefined();
    expect(native.invoke.mock.calls.some(([command])=>command==='pi_admit_answer')).toBe(false);
  });
  it('malformed summaries exhaust bounded attempts and leave original history plus a mandatory failure guard',async()=>{
    const {harness,conversation,faux}=await setup();const before=(await conversation.context(context)).entries.length;
    faux.setResponses([fauxAssistantMessage('invalid'),fauxAssistantMessage('{"summary":42}'),fauxAssistantMessage('{"summary":""}')]);
    await harness.waitForTask(await conversation.compact(undefined,context),context);
    const view=await conversation.context(context);expect(view.head).toBeUndefined();expect(view.entries).toHaveLength(before);
    expect(faux.state.callCount).toBe(3);const state=await harness.snapshot(CompactionState,conversation.id,context);
    expect((await harness.snapshot(SummaryUsageRun,summaryUsageKey(conversation.id,'current'),context))?.modelCalls).toBe(3);
    expect(state?.status).toBe('failed');expect(()=>requireReadyCompaction(state,'current')).toThrow('original context retained');
  });
  it('rechecks source freshness after inference and cannot install stale summary text',async()=>{
    const {harness,conversation,faux}=await setup();let stale=false;
    native.invoke.mockImplementation(async(command)=>{if(command==='pi_validate_evidence'&&stale)throw new Error('Source excluded during summary');});
    faux.setResponses([()=>{stale=true;return fauxAssistantMessage('{"summary":"stale assertions"}');}]);
    await harness.waitForTask(await conversation.compact(undefined,context),context);
    expect((await conversation.context(context)).head).toBeUndefined();expect((await harness.snapshot(CompactionState,conversation.id,context))?.status).toBe('failed');
  });
});
