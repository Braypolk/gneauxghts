import { expect, it, vi } from 'vitest';
import type { ChatApi } from '$lib/features/chat/api';
import type { AgentEvent, ChatEventMap, ChatSettings } from '$lib/features/chat/types';
import type { MemoryStorage } from '@earendil-works/pi-durable/storage/memory';
import type { ConversationId, Harness, SubmissionId } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { Message } from '@earendil-works/pi-ai';
import { createPiChatApi } from './chatApi';
import {createChatControllerMachineState,transitionChatControllerMachine} from '$lib/features/chat/machines/controllerMachine';
import { CHAT_AGENT_EVENT_SCHEMA_VERSION, initialAgentEventState, reduceAgentEvent } from '$lib/features/chat/agentEvents';
import type { RequestPolicies } from './nativeProvider';
import { AdmittedAnswer, EvidenceRun } from './notesExtension';
import { requestSnapshot } from './lifecycle';
import { webSourcesFromText } from './web';

const probe=vi.hoisted(()=>({store:undefined as unknown as MemoryStorage,harness:undefined as Harness|undefined,histories:[] as Array<readonly Message[]>,sourceValidations:[] as Array<{sources:unknown[];access?:string}>,persistAnswers:false,watches:0,slow:false,failure:'',whole:false,research:false,readEvidence:false,finish:()=>{},holdSubmit:undefined as (()=>Promise<void>)|undefined,observedPartial:undefined as (()=>void)|undefined,read:undefined as (()=>Promise<void>)|undefined,afterEvidenceSnapshot:undefined as (()=>Promise<void>)|undefined,beforeMessageEndBatch:undefined as (()=>Promise<void>)|undefined,beforeEvidenceDelivery:undefined as (()=>Promise<void>)|undefined,evidenceWatching:undefined as (()=>void)|undefined,sourceValidation:undefined as ((access:string)=>Promise<void>)|undefined,changeTypes:[] as string[]}));
const researchSource={kind:'passage',noteId:'n1',title:'One',excerpt:'Canonical worker evidence',passage:{id:'passage-1',noteId:'n1',revisions:[]}};
vi.mock('@earendil-works/pi-durable',async()=>{
  const actual=await vi.importActual<typeof import('@earendil-works/pi-durable')>('@earendil-works/pi-durable');
  return {...actual,Harness:{...actual.Harness,open:async(...args:Parameters<typeof actual.Harness.open>)=>{
    const harness=await actual.Harness.open(...args);probe.harness=harness;const read=harness.conversation.bind(harness);
    const snapshot=harness.snapshot.bind(harness);
    harness.snapshot=(async(...input:Parameters<typeof harness.snapshot>)=>{const value=await snapshot(...input);if(input[0].definition.kind==='gneauxghts.pi.evidence-run')await probe.afterEvidenceSnapshot?.();return value;}) as typeof harness.snapshot;
    const watchDoc=harness.watchDoc.bind(harness);
    harness.watchDoc=(async(...input:Parameters<typeof harness.watchDoc>)=>{const watcher=await watchDoc(...input);if(watcher&&input[0].definition.kind==='gneauxghts.pi.evidence'){const start=watcher.start.bind(watcher);watcher.start=listener=>start(async(value,ops,context)=>{if(typeof value?.readsJson==='string'&&value.readsJson!=='[]')await probe.beforeEvidenceDelivery?.();await listener(value,ops,context);});probe.evidenceWatching?.();}return watcher;}) as typeof harness.watchDoc;
    harness.subscribeCommits(publication=>{if(!probe.observedPartial)return;for(const change of publication.changes)if(change.type==='document'&&change.record.kind==='pi.live'){const value=change.value as {generation?:{message?:{content?:Array<{type:string;text?:string}>}}}|null;if(value?.generation?.message?.content?.some(block=>block.type==='text'&&block.text))probe.observedPartial();}});
    harness.conversation=async(...input)=>{const conversation=await read(...input);if(!conversation)return conversation;const submit=conversation.submit.bind(conversation);conversation.submit=async(...input)=>{const result=await submit(...input);await probe.holdSubmit?.();return result;};return conversation;};return harness;
  }},watchEvents:async(...args:Parameters<typeof actual.watchEvents>)=>{
    const stream=await actual.watchEvents(...args);probe.watches++;const stop=stream.stop.bind(stream);let stopped=false;
    stream.stop=async()=>{if(!stopped){stopped=true;probe.watches--;}return stop();};const start=stream.start.bind(stream);stream.start=listener=>start(async(events,context)=>{for(const event of events){probe.changeTypes.push(event.type);if(event.type==='message_update')probe.changeTypes.push(...event.changes.map(change=>change.type));}if(events.some(event=>event.type==='message_end'))await probe.beforeMessageEndBatch?.();await listener(events,context);});return stream;
  }};
});
vi.mock('@tauri-apps/api/event',()=>({listen:async()=>()=>{}}));
vi.mock('@tauri-apps/api/core',()=>({invoke:async(command:string,args?:{paths?:string[];sources?:unknown[];access?:string})=>{
  if(command==='pi_probe_config')return {fixture:true};
  if(command==='pi_bind_vault_location')return;
  if(command==='pi_resolve_locations')return args?.paths;
  if(command==='pi_transcript_status')return null;
  if(command==='pi_publish_transcript')return {projectionPath:'Chats/Pi/Origin.md',detached:false,conflict:null,warning:null};
  if(command==='pi_prepare_evidence')return {sessionId:crypto.randomUUID(),context:[],selectedNoteIds:[],grants:[],temporal:{referenceInstant:'2026-10-15T12:00:00Z',timeZone:'UTC',dateTimeContext:null,referenceLabel:'2026-10-15 UTC',prompt:'Current time: 2026-10-15T12:00:00Z'}};
  if(command==='pi_validate_sources'){probe.sourceValidations.push({sources:args?.sources ?? [],access:args?.access});if(args?.sources?.length)await probe.sourceValidation?.(args.access!);return;}
  if(command==='pi_validate_evidence'||command==='pi_release_evidence')return;
  if(command==='pi_evidence_operation'){await probe.read?.();return probe.research||probe.readEvidence?{payload:{items:[{evidenceId:'passage-1',text:'Canonical worker evidence'}]},sources:[researchSource]}:{payload:{items:[]},sources:[]};}
  if(command==='pi_begin_research')return {scope:{note_ids:['n1']},referenceInstant:'now',discoveryHints:[],scopeNoteCount:1};
  if(command==='pi_finish_research')return {payload:{items:[{evidenceId:'passage-1',text:'Canonical worker evidence'}],gaps:[]},sources:[researchSource]};
  if(command==='pi_release_research')return;
  throw new Error(`Unexpected native command ${command}`);
}}));
vi.mock('./nativeSqlite',()=>({openNativeSqlite:async()=>({})}));
vi.mock('@earendil-works/pi-durable/storage/sqlite',()=>({SqliteStorage:{open:async()=>probe.store}}));
vi.mock('./nativeProvider',async()=>{
  const {createModels,createAssistantMessageEventStream}=await import('@earendil-works/pi-ai');
  const {fauxProvider,fauxAssistantMessage,fauxToolCall}=await import('@earendil-works/pi-ai/providers/faux');
  return {
    admitNativeRequest:async(provider:string,model:string,reasoningEffort:string,serviceTier:string)=>({id:crypto.randomUUID(),provider,model,reasoningEffort,serviceTier}),
    releaseNativeRequest:async()=>{},
    nativeModels:(policies:RequestPolicies,persist?:Parameters<typeof import('./nativeProvider')['nativeModels']>[1])=>{
      const models=createModels();const faux=fauxProvider({provider:'local',models:[{id:'pi-native-fixture'},{id:'pi-native-fixture-b'}],tokensPerSecond:probe.slow?20:undefined});models.setProvider(faux.provider);
      const response=async(request:{messages:readonly Message[]},options:{sessionId?:string}|undefined)=>{
        const policy=policies.get(options?.sessionId ?? '');if(!policy?.admission)throw new Error('Missing explicit request admission');probe.histories.push(policy.history ?? []);
        if(probe.failure)return fauxAssistantMessage('',{stopReason:'error',errorMessage:probe.failure});
        if(probe.research){
          if(policy.purpose==='researchSelection')return request.messages.some(message=>message.role==='toolResult')?fauxAssistantMessage('{"evidence_ids":["passage-1"],"gaps":[]}'):fauxAssistantMessage(fauxToolCall('read_notes',{note_id:'n1'},{id:'worker-read'}),{stopReason:'toolUse'});
          if(!request.messages.some(message=>message.role==='toolResult'))return fauxAssistantMessage(fauxToolCall('research_notes',{question:'Focused evidence gap',note_ids:['n1']},{id:'parent-research'}),{stopReason:'toolUse'});
        }
        if(probe.read&&!request.messages.some(message=>message.role==='toolResult'))return fauxAssistantMessage(fauxToolCall('read_note',{noteId:'n1'},{id:'read-during-projection'}),{stopReason:'toolUse'});
        const text=probe.persistAnswers?`Source-free reply ${probe.histories.length}`:probe.slow?'First point. Second point. '.repeat(12):'First point. Second point.';
        if(probe.persistAnswers)await persist?.(policy,{text,sources:[]});
        return fauxAssistantMessage(text);
      };
      faux.setResponses(Array.from({length:20},()=>response));
      if(probe.whole)models.setProvider({...faux.provider,streamSimple:(_model,_context,options)=>{
        const stream=createAssistantMessageEventStream();const partial=fauxAssistantMessage('Whole first chunk');
        stream.push({type:'start',partial:fauxAssistantMessage('')});
        stream.push({type:'text_start',contentIndex:0,partial});
        probe.finish=()=>stream.push({type:'done',reason:'stop',message:partial});
        const abort=()=>stream.push({type:'error',reason:'aborted',error:{...partial,stopReason:'aborted'}});
        if(options?.signal?.aborted)abort();else options?.signal?.addEventListener('abort',abort,{once:true});
        return stream;
      }});
      return Object.assign(models,{registerModel:()=>{}});
    }
  };
});

it('keeps deferred lifecycle capabilities explicit and never delegates them to native chat',async()=>{
  const legacy={branchFromMessage:vi.fn(),createExcerpt:vi.fn(),resolveProjectionConflict:vi.fn()} as unknown as ChatApi;
  const api=createPiChatApi(legacy);
  await expect(api.branchFromMessage('old-message')).rejects.toThrow('unavailable');
  await expect(api.createExcerpt('old-message','text')).rejects.toThrow('unavailable');
  expect(legacy.branchFromMessage).not.toHaveBeenCalled();expect(legacy.createExcerpt).not.toHaveBeenCalled();expect(legacy.resolveProjectionConflict).not.toHaveBeenCalled();
  await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();
});

it('keeps source-free follow-up history and timestamps after switching and reopening without implicit inference',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.histories=[];
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'none',atlasVisibility:'hidden'};
  const native={getSettings:async()=>settings} as ChatApi;
  const api=createPiChatApi(native);
  try {
    const first=await api.createConversation();const other=await api.createConversation();
    const send=async(conversationId:string,content:string)=>{
      const completed=Promise.withResolvers<void>();const off=await api.on('chat://completed',()=>completed.resolve());
      const failed=await api.on('chat://failed',event=>completed.reject(new Error(event.error)));
      try {await api.sendMessage({conversationId,content});await completed.promise;}finally{off();failed();}
    };
    await send(first.id,'Give me two points');
    const initial=await api.getConversation(first.id);expect(initial.messages[1].content).toBe('First point. Second point.');
    for(let index=0;index<12;index++){await api.getConversation(other.id);await api.getConversation(first.id);}
    expect(probe.watches).toBe(0);
    await send(first.id,'Expand your second point');
    expect(probe.histories[1].some(message=>message.role==='assistant')).toBe(true);
    const before=await api.getConversation(first.id);const calls=probe.histories.length;
    await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();
    const reopened=createPiChatApi(native);
    try {const restored=await reopened.getConversation(first.id);expect(restored.messages.map(message=>[message.content,message.createdAtMillis])).toEqual(before.messages.map(message=>[message.content,message.createdAtMillis]));expect(probe.histories).toHaveLength(calls);expect(probe.watches).toBe(0);}
    finally{await (reopened as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
  } finally {await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('projects every source-free persisted turn and terminal identity without historical empty source validation',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.histories=[];probe.sourceValidations=[];probe.persistAnswers=true;
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'none',atlasVisibility:'hidden'};
  const native={getSettings:async()=>settings} as ChatApi;const api=createPiChatApi(native);
  const identities:Array<{id:string;role:string;content:string;status:string;requestId:string|null}>=[];
  const completedIds:string[]=[];const failed:string[]=[],cancelled:string[]=[];
  const offFailure=await api.on('chat://failed',event=>failed.push(event.requestId));const offCancel=await api.on('chat://cancelled',event=>cancelled.push(event.requestId));
  try {
    const conversation=await api.createConversation({vaultAccess:'none'});
    for(let turn=1;turn<=4;turn++){
      const terminal=Promise.withResolvers<ChatEventMap['chat://completed']>();const off=await api.on('chat://completed',event=>terminal.resolve(event));
      const offFailed=await api.on('chat://failed',event=>terminal.reject(new Error(event.error)));
      try {
        const receipt=await api.sendMessage({conversationId:conversation.id,content:`Source-free question ${turn}`});const event=await terminal.promise;
        expect(event).toMatchObject({requestId:receipt.requestId,conversationId:conversation.id,messageId:receipt.assistantMessage!.id,message:{id:receipt.assistantMessage!.id,content:`Source-free reply ${turn}`,status:'completed'}});
        completedIds.push(event.requestId);
        identities.push({id:receipt.userMessage!.id,role:'user',content:`Source-free question ${turn}`,status:'completed',requestId:null},
          {id:receipt.assistantMessage!.id,role:'assistant',content:`Source-free reply ${turn}`,status:'completed',requestId:receipt.requestId});
        const expected=identities.map(({role,content})=>({role,content}));
        expect(event.conversation).toMatchObject({id:conversation.id,messageCount:turn*2});
        expect((await api.getConversation(conversation.id)).messages.map(({role,content})=>({role,content}))).toEqual(expected);
        expect(probe.histories[turn-1].map(({role,content})=>({role,content}))).toEqual(expected.slice(0,-2).map(({role,content})=>({role,content:role==='user'?content:[{type:'text',text:content}]})));
      } finally {off();offFailed();}
    }
    const before=await api.getConversation(conversation.id);
    expect(before.messages.map(({id,role,content,status,requestId})=>({id,role,content,status,requestId}))).toEqual(identities);
    expect(new Set(before.messages.map(message=>message.id)).size).toBe(8);expect(new Set(completedIds).size).toBe(4);
    expect(before.activeRequestId).toBeNull();expect(failed).toEqual([]);expect(cancelled).toEqual([]);
    const admitted=await probe.store.scanDocuments({scope:{kind:'session'},at:'current',kind:AdmittedAnswer.definition.kind},128,undefined,context);
    expect(admitted.items).toHaveLength(4);
    // The provider is mocked here; these calls belong to display reconstruction,
    // not the mandatory native pi_admit_answer boundary tested in nativeProvider.
    expect(probe.sourceValidations).toEqual([]);
    await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();
    const reopened=createPiChatApi(native);
    try {
      const restored=await reopened.getConversation(conversation.id);expect(restored.messages).toEqual(before.messages);expect(restored.activeRequestId).toBeNull();
      expect(probe.histories).toHaveLength(4);expect(probe.sourceValidations).toEqual([]);expect(probe.watches).toBe(0);
    } finally {await (reopened as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
  } finally {offFailure();offCancel();probe.persistAnswers=false;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('preserves web-only citations and still validates read activity with empty issued sources',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.histories=[];probe.sourceValidations=[];probe.persistAnswers=true;
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'none',atlasVisibility:'hidden'};
  const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);
  try {
    const conversation=await api.createConversation({vaultAccess:'none'});const terminal=Promise.withResolvers<void>();const off=await api.on('chat://completed',()=>terminal.resolve());const offFailed=await api.on('chat://failed',event=>terminal.reject(new Error(event.error)));
    try {await api.sendMessage({conversationId:conversation.id,content:'Keep this source-free turn'});await terminal.promise;}finally{off();offFailed();}
    const entries=(await probe.store.scanEntries({conversationId:Number(conversation.id.slice(3)) as ConversationId,order:'ascending'},128,undefined,context)).items;
    const snapshot=entries.map(requestSnapshot).find(value=>value?.evidence)!;const answer=entries.find(entry=>entry.byTaskId&&entry.model?.some(message=>message.role==='assistant'))!;
    const web=webSourcesFromText('https://example.com/reference');
    await probe.harness!.commit(async tx=>{const doc=await tx.doc(AdmittedAnswer,String(answer.byTaskId),'');doc.sourcesJson=JSON.stringify(web);},context);
    const webOnly=await api.getConversation(conversation.id);
    expect(webOnly.messages.at(-1)?.citations).toMatchObject([{kind:'web',url:'https://example.com/reference'}]);expect(probe.sourceValidations).toEqual([]);
    await probe.harness!.commit(async tx=>{const origin=await tx.doc(EvidenceRun,snapshot.evidence!.sessionId,'');origin.sourcesJson='[]';origin.readsJson=JSON.stringify([{callId:'empty-read',name:'read_note',sources:[]}]);},context);
    const withRead=await api.getConversation(conversation.id);
    expect(probe.sourceValidations).toEqual([{sources:[],access:'none'}]);
    expect(withRead.messages.at(-1)?.parts.find(part=>part.type==='tool')).toMatchObject({callId:'empty-read',status:'success',outputSummary:'0 notes delivered'});
    expect(withRead.messages.at(-1)?.citations).toEqual(webOnly.messages.at(-1)?.citations);
    probe.sourceValidations=[];
    await probe.harness!.commit(async tx=>{const origin=await tx.doc(EvidenceRun,snapshot.evidence!.sessionId,'');origin.readsJson='[]';origin.sourcesJson=JSON.stringify([researchSource]);const doc=await tx.doc(AdmittedAnswer,String(answer.byTaskId),'');doc.sourcesJson=JSON.stringify([researchSource,...web]);},context);
    probe.sourceValidation=async()=>{throw new Error('Evidence or access changed; read again');};
    const stale=await api.getConversation(conversation.id);
    expect(probe.sourceValidations).toHaveLength(2);expect(probe.sourceValidations.every(call=>call.sources.length===1)).toBe(true);
    expect(stale.messages.at(-1)?.citations).toEqual(webOnly.messages.at(-1)?.citations);expect(stale.messages.at(-1)?.parts.some(part=>part.type==='tool'&&part.readSources?.length)).toBe(false);
  } finally {probe.persistAnswers=false;probe.sourceValidation=undefined;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('Stop retains acknowledged ordinary partial text and Retry uses the original snapshot after a newer turn',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.histories=[];probe.slow=true;
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'none',atlasVisibility:'hidden'};
  const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);
  try {
    const conversation=await api.createConversation();const partial=Promise.withResolvers<void>();const cancelled=Promise.withResolvers<void>();
    const offDelta=await api.on('chat://text-delta',()=>partial.resolve());const offCancel=await api.on('chat://cancelled',()=>cancelled.resolve());
    const receipt=await api.sendMessage({conversationId:conversation.id,content:'Original interrupted question'});
    const assistantMessageId=receipt.assistantMessage!.id;
    await partial.promise;await api.cancelRequest(receipt.requestId);await cancelled.promise;offDelta();offCancel();probe.slow=false;
    const interrupted=await api.getConversation(conversation.id);const original=interrupted.messages.find(message=>message.id===assistantMessageId)!;
    expect(original.status).toBe('cancelled');expect(original.content.length).toBeGreaterThan(0);
    const complete=async(action:()=>Promise<unknown>)=>{const terminal=Promise.withResolvers<void>();const off=await api.on('chat://completed',()=>terminal.resolve());const failure=await api.on('chat://failed',event=>terminal.reject(new Error(event.error)));try{await action();await terminal.promise;}finally{off();failure();}};
    await complete(()=>api.sendMessage({conversationId:conversation.id,content:'A newer unrelated question'}));
    await complete(()=>api.retryMessage(assistantMessageId));
    expect(probe.histories[2]).toEqual(probe.histories[0]);
    const resumed=await api.getConversation(conversation.id);expect(resumed.messages.find(message=>message.id===original.id)?.content).toBe(original.content);expect(resumed.messages.at(-2)?.content).toBe('Original interrupted question');expect(probe.watches).toBe(0);
  } finally {probe.slow=false;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('shows a whole first chunk while its actual Harness request remains stoppable',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.whole=true;probe.changeTypes=[];
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'none',atlasVisibility:'hidden'};
  const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);
  try {
    const conversation=await api.createConversation();const visible=Promise.withResolvers<string>();const cancelled=Promise.withResolvers<void>();let completed=false;
    const offDelta=await api.on('chat://text-delta',event=>visible.resolve(event.delta));const offCancel=await api.on('chat://cancelled',()=>cancelled.resolve());const offComplete=await api.on('chat://completed',()=>{completed=true;});
    const receipt=await api.sendMessage({conversationId:conversation.id,content:'Hold after a whole first chunk'});
    expect(await visible.promise).toBe('Whole first chunk');expect(completed).toBe(false);
    expect(probe.changeTypes.some(type=>type==='text_start'||type==='message_start'||type==='message')).toBe(true);expect(probe.changeTypes).not.toContain('text_delta');
    expect((await api.getConversation(conversation.id)).activeRequestId).toBe(receipt.requestId);
    await api.cancelRequest(receipt.requestId);await cancelled.promise;offDelta();offCancel();offComplete();
    const stopped=await api.getConversation(conversation.id);expect(stopped.messages.at(-1)?.status).toBe('cancelled');expect(stopped.messages.at(-1)?.content).toBe('Whole first chunk');expect(probe.watches).toBe(0);
  } finally {probe.whole=false;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('retains an admitted whole partial committed before submit returns and delivers it after started',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.whole=true;
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'none',atlasVisibility:'hidden'};
  const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);const release=Promise.withResolvers<void>();const committed=Promise.withResolvers<void>();
  probe.holdSubmit=()=>release.promise;probe.observedPartial=()=>committed.resolve();
  try {
    const conversation=await api.createConversation();let state=createChatControllerMachineState();state=transitionChatControllerMachine(state,{type:'startLoading',conversationId:conversation.id,operationId:1});state=transitionChatControllerMachine(state,{type:'selectionLoaded',operationId:1,conversation:await api.getConversation(conversation.id),proposals:[],capabilities:null});state=transitionChatControllerMachine(state,{type:'submit',conversationId:conversation.id,operationId:2});
    const started=Promise.withResolvers<void>();const order:string[]=[];
    const offStart=await api.on('chat://started',payload=>{order.push('started');state=transitionChatControllerMachine(state,{type:'backend',channel:'chat://started',payload,now:Date.now()});started.resolve();});
    const offDelta=await api.on('chat://text-delta',payload=>{order.push('text');state=transitionChatControllerMachine(state,{type:'backend',channel:'chat://text-delta',payload,now:Date.now()});});
    const sending=api.sendMessage({conversationId:conversation.id,content:'Stream immediately while the admission return is held'}).then(receipt=>{state=transitionChatControllerMachine(state,{type:'receipt',receipt,operationId:2,includeUser:true});return receipt;});
    await committed.promise;expect((await api.getConversation(conversation.id)).messages.at(-1)?.content).toBe('Whole first chunk');expect(order).toEqual([]);
    release.resolve();const receipt=await sending;await started.promise;await new Promise(resolve=>setTimeout(resolve,0));
    expect(order).toEqual(['started','text']);expect(state.conversation?.messages.at(-1)?.content).toBe('Whole first chunk');expect(state.request.kind).toBe('streaming');
    await api.cancelRequest(receipt.requestId);offStart();offDelta();
  } finally {release.resolve();probe.holdSubmit=undefined;probe.observedPartial=undefined;probe.whole=false;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('rechecks a pending scan when a request completes during conversation projection',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.whole=true;
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'none',atlasVisibility:'hidden'};
  const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);const release=Promise.withResolvers<void>();
  try {
    const conversation=await api.createConversation();const visible=Promise.withResolvers<void>();const completed=Promise.withResolvers<void>();
    const offDelta=await api.on('chat://text-delta',()=>visible.resolve());const offComplete=await api.on('chat://completed',()=>completed.resolve());
    const receipt=await api.sendMessage({conversationId:conversation.id,content:'Complete while the pending scan is suspended'});await visible.promise;
    const scanned=Promise.withResolvers<void>();const scan=probe.store.scanSubmissions.bind(probe.store);let suspend=true;
    probe.store.scanSubmissions=async(...args)=>{const page=await scan(...args);if(suspend){suspend=false;expect(page.items.some(record=>record.id===Number(receipt.requestId.split('-').at(-1))&&(record.status==='placed'||record.status==='queued'))).toBe(true);scanned.resolve();await release.promise;}return page;};
    const reading=api.getConversation(conversation.id);await scanned.promise;probe.finish();await completed.promise;release.resolve();
    const restored=await reading;expect(restored.messages.at(-1)?.status).toBe('completed');expect(restored.messages.at(-1)?.errorMessage).toBeNull();expect(restored.messages.at(-1)?.content).toBe('Whole first chunk');
    offDelta();offComplete();
  } finally {release.resolve();probe.whole=false;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('projects committed tool outcomes when a pending turn settles after its entries were scanned',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.histories=[];
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'none',atlasVisibility:'hidden'};
  const toolStarted=Promise.withResolvers<void>(),releaseTool=Promise.withResolvers<void>(),scanned=Promise.withResolvers<void>(),releaseScan=Promise.withResolvers<void>();
  probe.read=async()=>{toolStarted.resolve();await releaseTool.promise;};
  const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);
  try {
    const conversation=await api.createConversation();const completed=Promise.withResolvers<void>();
    const offComplete=await api.on('chat://completed',()=>completed.resolve());
    const receipt=await api.sendMessage({conversationId:conversation.id,content:'Read while conversation projection is suspended'});await toolStarted.promise;
    const scan=probe.store.scanEntries.bind(probe.store);let suspend=true;
    probe.store.scanEntries=async(...args)=>{const page=await scan(...args);if(suspend&&page.items.some(entry=>entry.model?.some(message=>message.role==='assistant'&&message.content.some(block=>block.type==='toolCall'&&block.id==='read-during-projection')))){
      suspend=false;expect(page.items.some(entry=>entry.model?.some(message=>message.role==='toolResult'))).toBe(false);scanned.resolve();await releaseScan.promise;
    }return page;};
    const reading=api.getConversation(conversation.id);await scanned.promise;
    releaseTool.resolve();await completed.promise;releaseScan.resolve();
    const projected=await reading;const assistant=projected.messages.find(message=>message.id===receipt.assistantMessage!.id)!;
    expect(assistant.status).toBe('completed');expect(assistant.parts.find(part=>part.type==='tool'&&part.name==='read_note')).toMatchObject({status:'success'});
    expect((await api.getConversation(conversation.id)).messages.at(-1)?.parts).toEqual(assistant.parts);offComplete();
  } finally {releaseTool.resolve();releaseScan.resolve();probe.read=undefined;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('delivers successful parent research activity live and after reopening through the supported event schema',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.histories=[];probe.research=true;
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'none',atlasVisibility:'hidden'};
  const native={getSettings:async()=>settings} as ChatApi;const api=createPiChatApi(native);
  try {
    const conversation=await api.createConversation();let state=initialAgentEventState();const versions:number[]=[];
    let controller=createChatControllerMachineState();controller=transitionChatControllerMachine(controller,{type:'startLoading',conversationId:conversation.id,operationId:1});controller=transitionChatControllerMachine(controller,{type:'selectionLoaded',operationId:1,conversation,proposals:[],capabilities:null});controller=transitionChatControllerMachine(controller,{type:'submit',conversationId:conversation.id,operationId:2});
    const offStart=await api.on('chat://started',payload=>{controller=transitionChatControllerMachine(controller,{type:'backend',channel:'chat://started',payload,now:Date.now()});});
    const offEvent=await api.on('chat://agent-event',payload=>{state=reduceAgentEvent(state,payload);if(payload.schemaVersion!==undefined)versions.push(payload.schemaVersion);controller=transitionChatControllerMachine(controller,{type:'backend',channel:'chat://agent-event',payload,now:Date.now()});});
    const completed=Promise.withResolvers<void>();const offComplete=await api.on('chat://completed',payload=>{controller=transitionChatControllerMachine(controller,{type:'backend',channel:'chat://completed',payload,now:Date.now()});completed.resolve();});
    const receipt=await api.sendMessage({conversationId:conversation.id,content:'Research a focused gap'});controller=transitionChatControllerMachine(controller,{type:'receipt',receipt,operationId:2,includeUser:true});await completed.promise;offEvent();offComplete();offStart();
    expect(versions.length).toBeGreaterThan(0);expect(new Set(versions)).toEqual(new Set([CHAT_AGENT_EVENT_SCHEMA_VERSION]));
    expect(state.parts.filter(part=>part.type==='tool')).toHaveLength(1);expect(state.parts.find(part=>part.type==='tool')).toMatchObject({name:'research_notes',status:'success'});
    const projected=await api.getConversation(conversation.id);const tools=projected.messages.at(-1)!.parts.filter(part=>part.type==='tool');
    expect(tools).toHaveLength(1);expect(tools[0]).toMatchObject({name:'research_notes',status:'success',readSources:[{noteId:'n1',label:'One',excerpt:'Canonical worker evidence'}]});
    expect(state.parts.filter(part=>part.type==='tool')).toEqual(tools);
    expect(controller.conversation?.messages.at(-1)?.parts.filter(part=>part.type==='tool')).toEqual(tools);
    await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();const reopened=createPiChatApi(native);
    try {expect((await reopened.getConversation(conversation.id)).messages.at(-1)!.parts.filter(part=>part.type==='tool')).toEqual(tools);}
    finally {await (reopened as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
  } finally {probe.research=false;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('settles canonical read Activity before completion even when both live watches lag behind the committed read',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.readEvidence=true;
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'full',atlasVisibility:'hidden'};
  const release=Promise.withResolvers<void>(),watching=Promise.withResolvers<void>();probe.read=()=>watching.promise;probe.evidenceWatching=()=>watching.resolve();probe.beforeMessageEndBatch=()=>release.promise;probe.beforeEvidenceDelivery=()=>release.promise;
  const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);
  try {
    const conversation=await api.createConversation();let controller=createChatControllerMachineState();controller=transitionChatControllerMachine(controller,{type:'startLoading',conversationId:conversation.id,operationId:1});controller=transitionChatControllerMachine(controller,{type:'selectionLoaded',operationId:1,conversation,proposals:[],capabilities:null});controller=transitionChatControllerMachine(controller,{type:'submit',conversationId:conversation.id,operationId:2});
    const offStart=await api.on('chat://started',payload=>{controller=transitionChatControllerMachine(controller,{type:'backend',channel:'chat://started',payload,now:Date.now()});});
    const offEvent=await api.on('chat://agent-event',payload=>{controller=transitionChatControllerMachine(controller,{type:'backend',channel:'chat://agent-event',payload,now:Date.now()});});
    const completed=Promise.withResolvers<void>();const offComplete=await api.on('chat://completed',payload=>{controller=transitionChatControllerMachine(controller,{type:'backend',channel:'chat://completed',payload,now:Date.now()});completed.resolve();});
    const receipt=await api.sendMessage({conversationId:conversation.id,content:'Read a note with slow live observers'});controller=transitionChatControllerMachine(controller,{type:'receipt',receipt,operationId:2,includeUser:true});await completed.promise;
    const canonical=(await api.getConversation(conversation.id)).messages.at(-1)!;
    expect(canonical.parts.find(part=>part.type==='tool')).toMatchObject({title:'Read note evidence',status:'success',readSources:[{noteId:'n1'}]});
    expect(controller.conversation?.messages.at(-1)?.parts.filter(part=>part.type==='tool')).toEqual(canonical.parts.filter(part=>part.type==='tool'));
    const terminalParts=controller.conversation?.messages.at(-1)?.parts;release.resolve();await new Promise(resolve=>setTimeout(resolve,0));
    expect(controller.conversation?.messages.at(-1)?.parts).toEqual(terminalParts);offStart();offEvent();offComplete();
  } finally {release.resolve();probe.read=undefined;probe.readEvidence=false;probe.beforeMessageEndBatch=undefined;probe.beforeEvidenceDelivery=undefined;probe.evidenceWatching=undefined;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it.each(['origin snapshot','native validation'] as const)('does not publish terminal read links after access is revoked during %s',async boundary=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.readEvidence=true;
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'full',atlasVisibility:'hidden'};
  const release=Promise.withResolvers<void>(),watching=Promise.withResolvers<void>();probe.read=()=>watching.promise;probe.evidenceWatching=()=>watching.resolve();probe.beforeMessageEndBatch=()=>release.promise;probe.beforeEvidenceDelivery=()=>release.promise;
  const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);
  try {
    const conversation=await api.createConversation();let validations=0,revoked=false;
    const revoke=async()=>{await api.setConversationVaultAccess(conversation.id,'none');revoked=true;};
    probe.sourceValidation=async access=>{validations++;if(boundary==='native validation'&&validations===3)await revoke();if(access==='none')throw new Error('Evidence or access changed; read again');};
    if(boundary==='origin snapshot')probe.afterEvidenceSnapshot=async()=>{if(validations!==2)return;probe.afterEvidenceSnapshot=undefined;await revoke();};
    const events:AgentEvent[]=[];const offEvent=await api.on('chat://agent-event',payload=>events.push(payload.event));
    const completed=Promise.withResolvers<void>();const offComplete=await api.on('chat://completed',()=>completed.resolve());
    await api.sendMessage({conversationId:conversation.id,content:'Revoke access at terminal read admission'});await completed.promise;
    expect(revoked).toBe(true);expect(events.filter(event=>event.type==='toolCallUpdated'&&event.readSources?.length)).toEqual([]);
    release.resolve();await new Promise(resolve=>setTimeout(resolve,0));expect(events.filter(event=>event.type==='toolCallUpdated'&&event.readSources?.length)).toEqual([]);offEvent();offComplete();
  } finally {release.resolve();probe.read=undefined;probe.readEvidence=false;probe.beforeMessageEndBatch=undefined;probe.beforeEvidenceDelivery=undefined;probe.evidenceWatching=undefined;probe.sourceValidation=undefined;probe.afterEvidenceSnapshot=undefined;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('keeps terminal read admission independent of another conversation access change',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.readEvidence=true;
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'full',atlasVisibility:'hidden'};
  const release=Promise.withResolvers<void>(),watching=Promise.withResolvers<void>();probe.read=()=>watching.promise;probe.evidenceWatching=()=>watching.resolve();probe.beforeMessageEndBatch=()=>release.promise;probe.beforeEvidenceDelivery=()=>release.promise;
  const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);
  try {
    const conversation=await api.createConversation(),other=await api.createConversation();let validations=0;
    probe.sourceValidation=async()=>{if(++validations===3)await api.setConversationVaultAccess(other.id,'none');};
    const events:AgentEvent[]=[];const offEvent=await api.on('chat://agent-event',payload=>events.push(payload.event));
    const completed=Promise.withResolvers<void>();const offComplete=await api.on('chat://completed',()=>completed.resolve());
    await api.sendMessage({conversationId:conversation.id,content:'Keep this read while another conversation changes access'});await completed.promise;
    expect(events.filter(event=>event.type==='toolCallUpdated'&&event.readSources?.length)).toMatchObject([{callId:'read-during-projection',readSources:[{noteId:'n1'}]}]);offEvent();offComplete();
  } finally {release.resolve();probe.read=undefined;probe.readEvidence=false;probe.beforeMessageEndBatch=undefined;probe.beforeEvidenceDelivery=undefined;probe.evidenceWatching=undefined;probe.sourceValidation=undefined;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('does not admit cached access while a conversation access change is still committing',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.readEvidence=true;
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'full',atlasVisibility:'hidden'};
  const release=Promise.withResolvers<void>(),watching=Promise.withResolvers<void>(),commitReached=Promise.withResolvers<void>(),releaseCommit=Promise.withResolvers<void>(),validationReached=Promise.withResolvers<void>(),releaseValidation=Promise.withResolvers<void>();
  probe.read=()=>watching.promise;probe.evidenceWatching=()=>watching.resolve();probe.beforeMessageEndBatch=()=>release.promise;probe.beforeEvidenceDelivery=()=>release.promise;
  const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);let mutation:ReturnType<ChatApi['setConversationVaultAccess']>|undefined;
  try {
    const conversation=await api.createConversation();let validations=0;
    probe.sourceValidation=async access=>{if(++validations===3){expect(access).toBe('full');validationReached.resolve();await releaseValidation.promise;}if(access==='none')throw new Error('Evidence or access changed; read again');};
    probe.afterEvidenceSnapshot=async()=>{if(validations!==2)return;probe.afterEvidenceSnapshot=undefined;
      const commit=probe.store.commit.bind(probe.store);let hold=true;
      probe.store.commit=async(...args)=>{if(hold){hold=false;commitReached.resolve();await releaseCommit.promise;}return commit(...args);};
      mutation=api.setConversationVaultAccess(conversation.id,'none');await commitReached.promise;
    };
    const events:AgentEvent[]=[];const offEvent=await api.on('chat://agent-event',payload=>events.push(payload.event));
    const completed=Promise.withResolvers<void>();const offComplete=await api.on('chat://completed',()=>completed.resolve());
    await api.sendMessage({conversationId:conversation.id,content:'Start read admission behind an unsettled access change'});
    await Promise.race([completed.promise,validationReached.promise]);releaseCommit.resolve();await mutation;releaseValidation.resolve();await completed.promise;
    expect(mutation).toBeDefined();expect(events.filter(event=>event.type==='toolCallUpdated'&&event.readSources?.length)).toEqual([]);offEvent();offComplete();
  } finally {release.resolve();releaseCommit.resolve();releaseValidation.resolve();probe.read=undefined;probe.readEvidence=false;probe.beforeMessageEndBatch=undefined;probe.beforeEvidenceDelivery=undefined;probe.evidenceWatching=undefined;probe.sourceValidation=undefined;probe.afterEvidenceSnapshot=undefined;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('reconciles terminal activity when its process owner retires during the evidence-origin snapshot',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.histories=[];
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'none',atlasVisibility:'hidden'};
  const toolStarted=Promise.withResolvers<void>(),releaseTool=Promise.withResolvers<void>(),originRead=Promise.withResolvers<void>(),releaseOrigin=Promise.withResolvers<void>();
  probe.read=async()=>{toolStarted.resolve();await releaseTool.promise;};
  const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);
  try {
    const conversation=await api.createConversation();const completed=Promise.withResolvers<void>();const offComplete=await api.on('chat://completed',()=>completed.resolve());
    const receipt=await api.sendMessage({conversationId:conversation.id,content:'Finish after the pending submission recheck'});await toolStarted.promise;
    probe.afterEvidenceSnapshot=async()=>{probe.afterEvidenceSnapshot=undefined;const submission=await probe.store.submission(Number(receipt.requestId.split('-').at(-1)) as SubmissionId,context);expect(submission?.status).toBe('placed');originRead.resolve();await releaseOrigin.promise;};
    const reading=api.getConversation(conversation.id);await originRead.promise;releaseTool.resolve();await completed.promise;releaseOrigin.resolve();
    const assistant=(await reading).messages.find(message=>message.id===receipt.assistantMessage!.id)!;
    expect(assistant.status).toBe('completed');expect(assistant.errorMessage).toBeNull();expect(assistant.content).toBe('First point. Second point.');
    expect(assistant.parts.find(part=>part.type==='tool'&&part.name==='read_note')).toMatchObject({status:'success'});
    expect((await api.getConversation(conversation.id)).messages.at(-1)?.parts).toEqual(assistant.parts);offComplete();
  } finally {releaseTool.resolve();releaseOrigin.resolve();probe.afterEvidenceSnapshot=undefined;probe.read=undefined;await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
});

it('reopens the committed actionable failure without exposing unsafe provider diagnostics',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'none',atlasVisibility:'hidden'};
  const validationFailures=[
    ['Current notes are still updating; retry the read','Notes are still updating. Wait a moment, then Retry.'],
    ['Current notes changed during the read; retry the read','Notes changed while they were being checked. Retry to read fresh evidence.'],
    ['Current note validation could not complete; retry the read','Notes could not be checked. Retry the request.'],
  ].flatMap(([reason,message])=>['Evidence','Context'].map(kind=>[`${kind} validation unavailable: ${reason}`,message] as const));
  const generic='The model request failed. Check the model and connection settings, then Retry.';
  const cases=[
    ['Evidence changed before delivery; read again','Evidence changed before delivery; read again'],
    ['Native provider HTTP 401','Native provider HTTP 401'],
    ['Authorization: Bearer sk-private-secret; request body: {"messages":["private authored text"]}',generic],
    ...validationFailures,
    ...validationFailures.map(([diagnostic])=>[`${diagnostic}; private path: /private/authored-note.md; sk-private-secret`,generic] as const),
  ];
  for(const [diagnostic,expected] of cases) {
    probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.failure=diagnostic;
    const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);let conversationId='';
    try {
      conversationId=(await api.createConversation()).id;const failed=Promise.withResolvers<string>();const off=await api.on('chat://failed',event=>failed.resolve(event.error));
      await api.sendMessage({conversationId,content:'Trigger a failed request'});const visible=await failed.promise;off();
      expect(visible).toBe(expected);
      expect(visible).not.toMatch(/sk-private-secret|private authored text|messages|authored-note/);
      await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();probe.failure='A different volatile diagnostic';
      const reopened=createPiChatApi({getSettings:async()=>settings} as ChatApi);
      try {
        const restored=await reopened.getConversation(conversationId);expect(restored.messages.at(-1)?.errorMessage).toBe(visible);
        const submissions=await probe.store.scanSubmissions({conversationId:Number(conversationId.slice(3)) as ConversationId},128,undefined,context);
        expect(submissions.items).toContainEqual(expect.objectContaining({status:'unanswered',detail:diagnostic}));
      }
      finally {await (reopened as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
    } finally {probe.failure='';await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
  }
});
