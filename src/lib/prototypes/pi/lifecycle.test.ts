import { describe, expect, it, vi } from 'vitest';
import { Harness, createRegistry, defineExtension, hook, GenerationTask, ProviderDoc, type ConversationId, type EntryRecord } from '@earendil-works/pi-durable';
import { MemoryStorage } from '@earendil-works/pi-durable/storage/memory';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { REQUEST_KIND, requestSnapshot, safeHistory, continuityCandidates, selectedEvidenceNoteIds, attachContinuity, lifecycleExtension, scanAll, type RequestSnapshot, type ActiveAdmission } from './lifecycle';
import { Evidence, notesExtension } from './notesExtension';
import { nativeModels, type RequestPolicies } from './nativeProvider';
const native=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke,Channel:class {onmessage:unknown}}));

const user=(text:string) => ({role:'user' as const,content:text,timestamp:100});
const entry=(id:number,model:EntryRecord['model'],byTaskId?:number):EntryRecord => ({id:id as EntryRecord['id'],conversationId:1 as ConversationId,kind:'test',model,byTaskId:byTaskId as EntryRecord['byTaskId']});
const snapshot:RequestSnapshot={version:1,input:{conversationId:'pi-1',content:'Original question'},settings:{provider:'local',model:'original-model',reasoningEffort:'off',serviceTier:'standard',localBaseUrl:'http://localhost:1234/v1'},history:[user('Earlier question'),fauxAssistantMessage('Earlier answer')],createdAtMillis:12345,retryOf:null,origin:null};

describe('Pi request history and admission',()=>{
  it('keeps ordinary dialogue and source-free tool conversations',()=>{
    const call=fauxAssistantMessage(fauxToolCall('calculate',{value:2},{id:'calc'}),{stopReason:'toolUse'});
    const result={role:'toolResult' as const,toolCallId:'calc',toolName:'calculate',content:[{type:'text' as const,text:'4'}],isError:false,timestamp:101};
    const messages=safeHistory([entry(1,[user('Explain')]),entry(2,[call]),entry(3,[result]),entry(4,[fauxAssistantMessage('Second point')])],new Set());
    expect(messages.map(message=>message.role)).toEqual(['user','assistant','toolResult','assistant']);
    expect(messages.at(-1)).toEqual(fauxAssistantMessage('Second point',{timestamp:(messages.at(-1)!).timestamp}));
  });
  it('retains authored questions but excludes prior note answers and evidence',()=>{
    const messages=safeHistory([entry(1,[user('What changed?')]),entry(2,[fauxAssistantMessage(fauxToolCall('read_note',{noteId:'private'}),{stopReason:'toolUse'})],7),entry(3,[{role:'toolResult',toolCallId:'read',toolName:'read_note',content:[{type:'text',text:'private evidence'}],isError:false,timestamp:101}]),entry(4,[fauxAssistantMessage('Grounded answer')],9),entry(5,[user('Follow up')])],new Set([9]));
    expect(messages).toEqual([user('What changed?'),user('Follow up')]);
  });
  it('replays only the authored question from an input with canonical selected context',()=>{
    const original={...snapshot,evidence:{sessionId:'evidence-1',context:[{kind:'selected_excerpt',text:'Private canonical excerpt'}],selectedNoteIds:['note-1'],grants:[]}};
    const submitted={...entry(1,[user('App context: Private canonical excerpt. Original question')]),kind:REQUEST_KIND,data:JSON.parse(JSON.stringify(original))};
    const messages=safeHistory([submitted,entry(2,[fauxAssistantMessage('Answer from selected note')],9)],new Set());
    expect(messages).toEqual([user('Original question')]);
  });
  it('keeps complete source-free turns for adaptive compaction without silently dropping history',()=>{
    const entries=Array.from({length:12},(_,i)=>[entry(i*2+1,[user(`q${i}`)]),entry(i*2+2,[fauxAssistantMessage(`a${i}`)])]).flat();
    const messages=safeHistory(entries,new Set());
    expect(messages).toHaveLength(24);expect(messages[0]).toEqual(user('q0'));expect(messages.at(-1)?.role).toBe('assistant');
  });
  it('keeps normal dialogue through the actual provider with an automatic open-note hint and source-free follow-up',async()=>{
    native.invoke.mockReset();const wires:unknown[]=[];let calls=0;
    native.invoke.mockImplementation(async(command,args)=>{
      if(command==='pi_admit_answer')return {text:args.raw,sources:[]};
      if(command!=='pi_fetch')return;
      const wire=JSON.parse(args.body);wires.push(wire);const text=++calls===1?'1. Alpha\n2. Beta\n3. Gamma':'Beta expanded from the prior answer';
      args.frames.onmessage({type:'headers',status:200,content_type:'text/event-stream'});
      const chunk=(delta:unknown,finish_reason:unknown=null)=>`data: ${JSON.stringify({id:'reply',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})}\n\n`;
      args.frames.onmessage({type:'chunk',bytes:[...new TextEncoder().encode(chunk({role:'assistant'})+chunk({content:text})+chunk({},'stop')+'data: [DONE]\n\n')]});args.frames.onmessage({type:'done'});
    });
    const policies:RequestPolicies=new Map(),permitted=new Set<number>(),admissions=new Map<number,ActiveAdmission>(),registry=createRegistry();
    registry.install(notesExtension(permitted,policies));registry.install(lifecycleExtension(admissions,policies));
    const models=nativeModels(policies);models.registerModel('local','m');const storage=new MemoryStorage();
    const harness=await Harness.open(storage,{models,registry,settings:{compaction:{enabled:false}}},context);
    try{const conversation=await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'local',modelId:'m'}}},context);permitted.add(conversation.id);
      const evidence={sessionId:'open-hint',context:[{kind:'adjacent_editor_hint',noteId:'private-note',title:'Private editor title',contentHash:'hash'}],selectedNoteIds:[],grants:[]};
      await harness.commit(async tx=>{Object.assign(await tx.doc(Evidence,conversation.id),{access:'full',sessionId:evidence.sessionId,contextJson:JSON.stringify(evidence.context)});},context);
      const original={...snapshot,input:{conversationId:`pi-${conversation.id}`,content:'Give me three examples'},history:[],evidence};
      const admission={id:'native',provider:'local',model:'m',tools:false,reasoningEffort:'off',serviceTier:'standard'} as ActiveAdmission['admission'];
      admissions.set(conversation.id,{admission,snapshot:original});
      expect((await (await conversation.submit({type:'input',content:'App context: private-note Private editor title. Give me three examples',entry:{kind:REQUEST_KIND,data:JSON.parse(JSON.stringify(original))}},context)).wait(context)).status).toBe('done');
      const entries=(await storage.scanEntries({conversationId:conversation.id,order:'ascending'},128,undefined,context)).items;
      const history=safeHistory(entries,new Set());expect(JSON.stringify(history)).toContain('2. Beta');expect(JSON.stringify(history)).not.toContain('Private editor title');
      const candidates=continuityCandidates(entries,new Set(),new Map([[entries[0].id,selectedEvidenceNoteIds(evidence)]]));expect(candidates).toEqual([]);
      admissions.set(conversation.id,{admission,snapshot:{...original,history,continuityCandidates:candidates,input:{...original.input,content:'Expand the second'}}});
      expect((await (await conversation.submit({type:'input',content:'Expand the second'},context)).wait(context)).status).toBe('done');
      expect(JSON.stringify(wires[1])).toContain('2. Beta');expect(JSON.stringify(wires[1])).toContain('Expand the second');expect(JSON.stringify(wires[1])).not.toContain('private-note');
    }finally{await harness.close(context);}
  });
  it('metadata candidates alone do not omit unrelated source-free assistant dialogue',()=>{
    const original={...snapshot,continuityCandidates:[{historyIndex:0,noteIds:['note-1']}]};
    const entries=[{...entry(1,[user('Original question')]),kind:REQUEST_KIND,data:JSON.parse(JSON.stringify(original))},entry(2,[fauxAssistantMessage('Three ordinary examples')])];
    expect(JSON.stringify(safeHistory(entries,new Set()))).toContain('Three ordinary examples');
  });
  it('a delivered canonical editor selection still omits dependent prose and retains only revalidatable identity',()=>{
    const evidence={sessionId:'selection',context:[{kind:'adjacent_editor_hint',noteId:'n1',title:'Private',selection:'Selected canonical text'}],selectedNoteIds:[],grants:[]};
    const original={...snapshot,evidence};const entries=[{...entry(1,[user('Private app selection + question')]),kind:REQUEST_KIND,data:JSON.parse(JSON.stringify(original))},entry(2,[fauxAssistantMessage('Claims based on selected canonical text')])];
    const history=safeHistory(entries,new Set());expect(history).toEqual([user('Original question')]);
    const candidates=continuityCandidates(entries,new Set(),new Map([[1,selectedEvidenceNoteIds(evidence)]]));expect(candidates).toEqual([{historyIndex:0,noteIds:['n1']}]);
    expect(attachContinuity(history,candidates,[])).toEqual([user('Original question')]);
  });
  it('ties bounded identity-only references to the authored question and never carries prior evidence/prose',()=>{
    const submitted={...entry(1,[user('What changed?')]),kind:REQUEST_KIND,data:JSON.parse(JSON.stringify(snapshot))};
    const entries=[submitted,entry(2,[fauxAssistantMessage('Private previous answer and excerpt')],9),entry(3,[user('Check that note again')])];
    const grounded=new Set([9]),history=safeHistory(entries,grounded);
    const candidates=continuityCandidates(entries,grounded,new Map([[1,['note-1']]]));
    expect(candidates).toEqual([{historyIndex:0,noteIds:['note-1']}]);
    const refreshed=attachContinuity(history,candidates,[{noteId:'note-1',title:'Current title'}]);
    expect(JSON.stringify(refreshed)).toContain('Current title');expect(JSON.stringify(refreshed)).toContain('discovery metadata only');
    expect(JSON.stringify(refreshed)).not.toContain('Private previous answer');expect(JSON.stringify(refreshed)).not.toContain('sourceId');
    expect(attachContinuity(history,candidates,[])).toEqual(history);
    const many=Array.from({length:40},(_,index)=>entry(index+1,[user(`q${index}`)]));
    expect(continuityCandidates(many,new Set(),new Map(many.map(value=>[value.id,['a','b','c','d','e']]))).flatMap(candidate=>candidate.noteIds)).toHaveLength(16);
  });
  it('freshly resolves retry titles and mandatory validation rejects revocation during inference',async()=>{
    native.invoke.mockReset();let references=[{noteId:'note-1',title:'Fresh canonical title'}];
    native.invoke.mockImplementation(async command=>command==='pi_continuity_references'?references:undefined);
    const policies:RequestPolicies=new Map(),admissions=new Map<number,ActiveAdmission>(),registry=createRegistry();
    registry.install(defineExtension({name:'test.policy',hooks:[hook(GenerationTask,{beforeRequest:async({messages},api,ctx)=>{
      const provider=await api.snapshot(ProviderDoc,api.conversationId,ctx);policies.set(provider!.sessionId,{access:'full',sources:[],taskId:api.taskId,validate:async()=>{}});return {messages};
    }})]}));registry.install(lifecycleExtension(admissions,policies));
    const models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);
    const harness=await Harness.open(new MemoryStorage(),{models,registry},context);
    try{const conversation=await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},context);
      await harness.commit(async tx=>{Object.assign(await tx.doc(Evidence,conversation.id),{access:'full',sessionId:'current'});},context);
      const frozen={...snapshot,history:[user('What changed?')],continuityCandidates:[{historyIndex:0,noteIds:['note-1']}]};
      admissions.set(conversation.id,{snapshot:frozen,admission:{id:'native',provider:'local',model:'m'}} as ActiveAdmission);
      faux.setResponses([async(_request,options)=>{const policy=policies.get(options!.sessionId!)!;
        expect(JSON.stringify(policy.history)).toContain('Fresh canonical title');expect(JSON.stringify(frozen.history)).not.toContain('Fresh canonical title');
        await policy.validate!();references=[];await expect(policy.validate!()).rejects.toThrow('Prior note references changed');return fauxAssistantMessage('Discarded by the real mandatory provider boundary');}]);
      await (await conversation.submit({type:'input',content:'Check that note again'},context)).wait(context);
      faux.setResponses([async(_request,options)=>{const policy=policies.get(options!.sessionId!)!;
        expect(policy.history).toEqual(frozen.history);expect(JSON.stringify(policy.history)).not.toContain('note-1');await policy.validate!();return fauxAssistantMessage('No private reference remains');}]);
      await (await conversation.submit({type:'input',content:'Retry check'},context)).wait(context);
      expect(native.invoke.mock.calls.every(([,args])=>!JSON.stringify(args).includes('Fresh canonical title'))).toBe(true);
    }finally{await harness.close(context);}
  });
  it('pages beyond 1,000 records in storage order',async()=>{
    const values=Array.from({length:1205},(_,i)=>i);
    const records=await scanAll(async cursor=>{const offset=Number(cursor?.offset ?? 0);return {items:values.slice(offset,offset+128),next:offset+128<values.length?{offset:offset+128}:undefined};});
    expect(records).toEqual(values);
  });
  it('fails explicitly when a storage cursor stops advancing',async()=>{
    await expect(scanAll(async()=>({items:[1],next:{offset:1}}))).rejects.toThrow('cursor did not advance');
  });
  it('failed Pi admission leaves neither a partial turn nor its request metadata',async()=>{
    const storage=new MemoryStorage();const models=createModels();const faux=fauxProvider();models.setProvider(faux.provider);
    const harness=await Harness.open(storage,{models,registry:createRegistry()},context);
    try {
      const conversation=await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},context);
      storage.close=async()=>{}; // Reopening a durable store retains committed state after the failed Harness closes.
      const commit=storage.commit.bind(storage);storage.commit=async(writes,ctx)=>{if(writes.some(write=>write.type==='submission'))throw new Error('admission unavailable');return commit(writes,ctx);};
      await expect(conversation.submit({type:'input',content:snapshot.input.content,entry:{kind:REQUEST_KIND,data:JSON.parse(JSON.stringify(snapshot))}},context)).rejects.toThrow('admission unavailable');
      expect((await storage.scanSubmissions({conversationId:conversation.id},128,undefined,context)).items).toEqual([]);
      expect((await storage.scanEntries({conversationId:conversation.id},128,undefined,context)).items).toEqual([]);
    } finally {await harness.close(context);}
  });
  it('stores exact admitted input/settings/history and retry origin with the Pi input',async()=>{
    const storage=new MemoryStorage();const models=createModels();const faux=fauxProvider();models.setProvider(faux.provider);faux.setResponses([fauxAssistantMessage('Answer')]);
    const harness=await Harness.open(storage,{models,registry:createRegistry()},context);
    try {
      const conversation=await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},context);
      const original={...snapshot,input:{...snapshot.input,conversationId:`pi-${conversation.id}`}};
      const submitted=await conversation.submit({type:'input',content:original.input.content,entry:{kind:REQUEST_KIND,data:JSON.parse(JSON.stringify(original))}},context);
      const record=await submitted.status(context);expect(record.entry).toBeDefined();
      const stored=await storage.entry(record.entry!,context);expect(requestSnapshot(stored?.entry)).toEqual(original);
      await submitted.wait(context);
      const retry={...original,retryOf:submitted.id,origin:submitted.id,createdAtMillis:23456};
      faux.setResponses([fauxAssistantMessage('Newer answer'),fauxAssistantMessage('Retry answer')]);
      await (await conversation.submit({type:'input',content:'A newer unrelated turn'},context)).wait(context);
      const continued=await conversation.submit({type:'input',content:retry.input.content,entry:{kind:REQUEST_KIND,data:JSON.parse(JSON.stringify(retry))}},context);
      const continuedRecord=await continued.status(context);const retained=requestSnapshot((await storage.entry(continuedRecord.entry!,context))?.entry);
      expect(retained?.history).toEqual(original.history);expect(retained?.settings.model).toBe('original-model');expect(retained?.origin).toBe(submitted.id);
      await continued.wait(context);
    } finally {await harness.close(context);}
  });
});
