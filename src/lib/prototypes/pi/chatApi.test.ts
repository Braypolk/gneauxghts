import { expect, it, vi } from 'vitest';
import type { ChatApi } from '$lib/features/chat/api';
import type { ChatSettings } from '$lib/features/chat/types';
import type { MemoryStorage } from '@earendil-works/pi-durable/storage/memory';
import type { Message } from '@earendil-works/pi-ai';
import { createPiChatApi } from './chatApi';
import {createChatControllerMachineState,transitionChatControllerMachine} from '$lib/features/chat/machines/controllerMachine';

const probe=vi.hoisted(()=>({store:undefined as unknown as MemoryStorage,histories:[] as Array<readonly Message[]>,watches:0,slow:false,failure:'',whole:false,finish:()=>{},holdSubmit:undefined as (()=>Promise<void>)|undefined,observedPartial:undefined as (()=>void)|undefined,changeTypes:[] as string[]}));
vi.mock('@earendil-works/pi-durable',async()=>{
  const actual=await vi.importActual<typeof import('@earendil-works/pi-durable')>('@earendil-works/pi-durable');
  return {...actual,Harness:{...actual.Harness,open:async(...args:Parameters<typeof actual.Harness.open>)=>{
    const harness=await actual.Harness.open(...args);const read=harness.conversation.bind(harness);
    harness.subscribeCommits(publication=>{if(!probe.observedPartial)return;for(const change of publication.changes)if(change.type==='document'&&change.record.kind==='pi.live'){const value=change.value as {generation?:{message?:{content?:Array<{type:string;text?:string}>}}}|null;if(value?.generation?.message?.content?.some(block=>block.type==='text'&&block.text))probe.observedPartial();}});
    harness.conversation=async(...input)=>{const conversation=await read(...input);if(!conversation)return conversation;const submit=conversation.submit.bind(conversation);conversation.submit=async(...input)=>{const result=await submit(...input);await probe.holdSubmit?.();return result;};return conversation;};return harness;
  }},watchEvents:async(...args:Parameters<typeof actual.watchEvents>)=>{
    const stream=await actual.watchEvents(...args);probe.watches++;const stop=stream.stop.bind(stream);let stopped=false;
    stream.stop=async()=>{if(!stopped){stopped=true;probe.watches--;}return stop();};const start=stream.start.bind(stream);stream.start=listener=>start(async(events,context)=>{for(const event of events){probe.changeTypes.push(event.type);if(event.type==='message_update')probe.changeTypes.push(...event.changes.map(change=>change.type));}await listener(events,context);});return stream;
  }};
});
vi.mock('@tauri-apps/api/event',()=>({listen:async()=>()=>{}}));
vi.mock('@tauri-apps/api/core',()=>({invoke:async(command:string,args?:{paths?:string[]})=>{
  if(command==='pi_probe_config')return {fixture:true};
  if(command==='pi_bind_vault_location')return;
  if(command==='pi_resolve_locations')return args?.paths;
  if(command==='pi_transcript_status')return null;
  if(command==='pi_publish_transcript')return {projectionPath:'Chats/Pi/Origin.md',detached:false,conflict:null,warning:null};
  if(command==='pi_prepare_evidence')return {sessionId:crypto.randomUUID(),context:[],selectedNoteIds:[],grants:[],temporal:{referenceInstant:'2026-10-15T12:00:00Z',timeZone:'UTC',dateTimeContext:null,referenceLabel:'2026-10-15 UTC',prompt:'Current time: 2026-10-15T12:00:00Z'}};
  if(command==='pi_validate_evidence'||command==='pi_validate_sources'||command==='pi_release_evidence')return;
  throw new Error(`Unexpected native command ${command}`);
}}));
vi.mock('./nativeSqlite',()=>({openNativeSqlite:async()=>({})}));
vi.mock('@earendil-works/pi-durable/storage/sqlite',()=>({SqliteStorage:{open:async()=>probe.store}}));
vi.mock('./nativeProvider',async()=>{
  const {createModels,createAssistantMessageEventStream}=await import('@earendil-works/pi-ai');
  const {fauxProvider,fauxAssistantMessage}=await import('@earendil-works/pi-ai/providers/faux');
  return {
    admitNativeRequest:async(provider:string,model:string,reasoningEffort:string,serviceTier:string)=>({id:crypto.randomUUID(),provider,model,reasoningEffort,serviceTier}),
    releaseNativeRequest:async()=>{},
    nativeModels:(policies:Map<string,{history:readonly Message[];admission:unknown}>)=>{
      const models=createModels();const faux=fauxProvider({provider:'local',models:[{id:'pi-native-fixture'},{id:'pi-native-fixture-b'}],tokensPerSecond:probe.slow?20:undefined});models.setProvider(faux.provider);
      const response=(_context:unknown,options:{sessionId?:string}|undefined)=>{
        const policy=policies.get(options?.sessionId ?? '');if(!policy?.admission)throw new Error('Missing explicit request admission');probe.histories.push(policy.history);
        if(probe.failure)return fauxAssistantMessage('',{stopReason:'error',errorMessage:probe.failure});
        return fauxAssistantMessage(probe.slow?'First point. Second point. '.repeat(12):'First point. Second point.');
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

it('reopens the committed actionable failure without exposing unsafe provider diagnostics',async()=>{
  const {MemoryStorage}=await import('@earendil-works/pi-durable/storage/memory');
  const settings:ChatSettings={provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',localBaseUrl:'http://localhost:1234/v1',reasoningEffort:'off',serviceTier:'standard',webAccess:'off',defaultVaultAccess:'none',atlasVisibility:'hidden'};
  for(const diagnostic of ['Evidence changed before delivery; read again','Native provider HTTP 401','Authorization: Bearer sk-private-secret; request body: {"messages":["private authored text"]}']) {
    probe.store=new MemoryStorage();probe.store.close=async()=>{};probe.failure=diagnostic;
    const api=createPiChatApi({getSettings:async()=>settings} as ChatApi);let conversationId='';
    try {
      conversationId=(await api.createConversation()).id;const failed=Promise.withResolvers<string>();const off=await api.on('chat://failed',event=>failed.resolve(event.error));
      await api.sendMessage({conversationId,content:'Trigger a failed request'});const visible=await failed.promise;off();
      if(diagnostic.startsWith('Authorization:')){expect(visible).toBe('The model request failed. Check the model and connection settings, then Retry.');}
      else expect(visible).toContain(diagnostic);
      expect(visible).not.toMatch(/sk-private-secret|private authored text|messages/);
      await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();probe.failure='A different volatile diagnostic';
      const reopened=createPiChatApi({getSettings:async()=>settings} as ChatApi);
      try {const restored=await reopened.getConversation(conversationId);expect(restored.messages.at(-1)?.errorMessage).toBe(visible);}
      finally {await (reopened as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
    } finally {probe.failure='';await (api as ChatApi & {prototypeClose():Promise<void>}).prototypeClose();}
  }
});
