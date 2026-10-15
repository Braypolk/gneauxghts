// Opt-in projection onto the existing ChatApi and editor/review UI. Durable
// session/task state stays in Pi; native ChatService supplies only domain settings.
import { invoke } from '@tauri-apps/api/core';
import { Harness, createRegistry, defineDoc, watchEvents, type ConversationId, type SubmissionId, type TaskId } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { ChatApi } from '$lib/features/chat/api';
import type { ChatAgentProposal, ChatConversation, ChatConversationSummary, ChatEventMap, ChatMessage, ChatProposalDraft, ChatSettings } from '$lib/features/chat/types';
import { initialAgentEventState } from '$lib/features/chat/agentEvents';
import { normalizeSource } from '$lib/features/chat/sources';
import type { CommitNoteReviewResult } from '$lib/types/proposals';
import { openNativeSqlite } from './nativeSqlite';
import { nativeModels, type RequestPolicies } from './nativeProvider';
import { Evidence, AdmittedAnswer, notesExtension, evidenceSources } from './notesExtension';
import { Review, Reviews, reviewExtension, stageReview, readReview, proposalOf, draftOf } from './reviews';

const Meta = defineDoc({kind:'gneauxghts.pi.chat-presentation',version:1,scope:'conversation',history:'latest',fork:'initial',
  initial:() => ({title:'Pi conversation',createdAtMillis:Date.now(),archived:false as boolean})});
const cid = (id:string) => {if(!/^pi-\d+$/.test(id)) throw new Error('A fresh Pi-owned conversation is required');return Number(id.slice(3)) as ConversationId;};
const sid = (id:string) => Number(id.match(/\d+$/)?.[0]) as SubmissionId;
const textOf = (content:unknown):string => typeof content==='string' ? content : Array.isArray(content) ? content.filter(b=>b.type==='text').map(b=>b.text).join('') : '';
const unresolved = (proposal:ChatAgentProposal) => proposal.status==='pending' || proposal.status==='conflict';

function message(id:string,conversationId:string,role:ChatMessage['role'],content:string,status:ChatMessage['status'],now:number):ChatMessage {
  return {id,conversationId,role,content,status,createdAtMillis:now,updatedAtMillis:now,requestId:null,errorMessage:null,
    citations:[],attachments:[],linkTarget:null,parts:initialAgentEventState(content).parts,
    agentRunId:null,agentSequence:0,agentEventCreatedAtMillis:0,agentRetiredRunIds:[]};
}

export function createPiChatApi(native:ChatApi):ChatApi {
  let engine:Promise<{harness:Harness;storage:SqliteStorage}>|undefined;
  const permitted=new Set<number>(),policies:RequestPolicies=new Map();
  const active=new Map<number,SubmissionId>();
  const watched=new Set<number>();
  const listeners=new Map<keyof ChatEventMap,Set<(payload:unknown)=>void>>();
  const emit=<K extends keyof ChatEventMap>(event:K,payload:ChatEventMap[K]) => {for(const listener of listeners.get(event) ?? []) listener(payload);};
  let fixture=false;
  const getSettings=async ():Promise<ChatSettings> => {
    fixture=(await invoke<{fixture:boolean}>('pi_probe_config')).fixture;
    const settings=await native.getSettings();
    return fixture?{...settings,provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',defaultVaultAccess:'full'}:settings;
  };
  const open=() => engine ??= (async () => {
    const settings=await getSettings();
    const storage=await SqliteStorage.open(await openNativeSqlite());
    let harness:Harness;
    const registry=createRegistry();registry.install(notesExtension(permitted,policies));
    registry.install(reviewExtension(async id=>(await harness.snapshot(Evidence,id as ConversationId,context))?.access ?? 'none',
      id=>active.has(id)?`pi-assistant-${active.get(id)}`:`pi-tool-${id}`));
    harness=await Harness.open(storage,{registry,models:nativeModels(policies,async (policy,answer) => {
      await harness.commit(async tx=>{const doc=await tx.doc(AdmittedAnswer,String(policy.taskId),'');doc.text=answer.text;doc.sourcesJson=JSON.stringify(answer.sources);},context);
    },settings.model),settings:{retry:{enabled:false,maxRetries:0},compaction:{enabled:false}}},context);
    // Domain proposals may appear before a model run fails. This observer emits
    // only committed previews; it does not become an approval owner.
    const announced=new Set((await harness.snapshot(Reviews,context))?.ids ?? []);
    let queued=false;
    harness.subscribeCommits(()=>{if(queued)return;queued=true;queueMicrotask(async()=>{queued=false;
      try {const catalog=await harness.snapshot(Reviews,context);for(const id of catalog?.ids ?? []) {
        if(announced.has(id))continue;
        const doc=await harness.snapshot(Review,String(id),context);if(doc?.proposalJson){const proposal=proposalOf(doc);announced.add(id);if(unresolved(proposal))emit('chat://proposal',proposal);}
      }} catch { /* Failed storage is surfaced by the operation owning it. */ }
    });});
    return {harness,storage};
  })();
  const summary=async (id:ConversationId):Promise<ChatConversationSummary> => {
    const {harness,storage}=await open();const conversation=await harness.conversation(id,context);if(!conversation)throw new Error('Unknown Pi conversation');
    const meta=await harness.snapshot(Meta,id,context);const agent=await conversation.agent(context);const evidence=await harness.snapshot(Evidence,id,context);
    const submissions=await storage.scanSubmissions({conversationId:id},1000,undefined,context);
    return {id:`pi-${id}`,title:meta?.title ?? 'Pi conversation',status:meta?.archived?'archived':'active',vaultAccess:evidence?.access ?? 'none',
      createdAtMillis:meta?.createdAtMillis ?? 0,updatedAtMillis:meta?.createdAtMillis ?? 0,messageCount:submissions.items.length*2,lastMessagePreview:null,
      provider:(agent.model?.provider ?? 'local') as 'local'|'openai',model:agent.model?.modelId ?? '',reasoningEffort:'medium'};
  };
  const watch=async(id:ConversationId) => {
    if(watched.has(id))return;watched.add(id);const {harness}=await open();const stream=await watchEvents(harness,id,context);
    stream.start(async batch=>{
      const submissionId=active.get(id);if(!submissionId)return;
      const identity={requestId:`pi-request-${submissionId}`,conversationId:`pi-${id}`,messageId:`pi-assistant-${submissionId}`};
      for(const event of batch) {
        if(event.type==='message_update')for(const change of event.changes) if(change.type==='text_delta')emit('chat://text-delta',{...identity,delta:change.delta});
        if(event.type==='tool_execution_start' || event.type==='tool_execution_end')emit('chat://activity',{...identity,runId:`pi-${id}`,status:event.type==='tool_execution_start'?'running':'completed'});
      }
    });
  };
  const getConversation=async(conversationId:string):Promise<ChatConversation> => {
    const id=cid(conversationId);const {harness,storage}=await open();const conversation=await harness.conversation(id,context);if(!conversation)throw new Error('Unknown Pi conversation');
    await watch(id);
    const entries=(await conversation.context(context)).entries;
    const records=(await storage.scanSubmissions({conversationId:id},1000,undefined,context)).items.filter(r=>r.type==='input');
    const messages:ChatMessage[]=[];
    for(const record of records) {
      const userEntry=record.entry && entries.find(e=>e.id===record.entry);
      const user=message(`pi-user-${record.id}`,conversationId,'user',textOf(userEntry && userEntry.model?.[0]?.content),'completed',record.id);
      const answerEntry=record.status==='done' && entries.find(e=>e.id===record.answer);
      const current=active.get(id)===record.id;
      const assistant=message(`pi-assistant-${record.id}`,conversationId,'assistant',textOf(answerEntry && answerEntry.model?.[0]?.content),record.status==='done'?'completed':current?'streaming':record.status==='unanswered' && record.reason==='aborted'?'cancelled':'error',record.id+1);
      assistant.requestId=`pi-request-${record.id}`;
      if(assistant.status==='error')assistant.errorMessage=record.status==='unanswered'?record.reason:'Interrupted request; Retry explicitly permits network work.';
      if(answerEntry && answerEntry.byTaskId) {const admitted=await harness.snapshot(AdmittedAnswer,String(answerEntry.byTaskId),context);if(admitted){assistant.content=admitted.text;assistant.parts=initialAgentEventState(admitted.text).parts;assistant.citations=evidenceSources(admitted).map(normalizeSource);}}
      messages.push(user,assistant);
    }
    const catalog=await harness.snapshot(Reviews,context);for(const reviewId of catalog?.ids ?? []){const doc=await harness.snapshot(Review,String(reviewId),context);if(!doc?.receiptJson)continue;const proposal=proposalOf(doc);if(proposal.conversationId!==conversationId || proposal.status!=='committed' || !proposal.payload.originalSave || !proposal.payload.wholeAnswer)continue;const receipt=JSON.parse(doc.receiptJson) as CommitNoteReviewResult;const saved=messages.find(m=>m.id===proposal.assistantMessageId);if(saved && receipt.noteId && receipt.applied?.path)saved.savedNote={noteId:receipt.noteId,path:receipt.applied.path};}
    return {...await summary(id),messages,activeRequestId:active.has(id)?`pi-request-${active.get(id)}`:null,projectionPath:null,excerptMessageIds:{}};
  };
  const sendMessage:ChatApi['sendMessage']=async input => {
    if(input.attachments?.length || input.forceWebSearch || input.selectedContext?.length || input.activeNote)throw new Error('Prototype accepts typed prompts and explicit read_note IDs; attachment/context import remains unimplemented.');
    const id=cid(input.conversationId);const {harness,storage}=await open();
    const unfinished=(await storage.scanSubmissions({conversationId:id},1000,undefined,context)).items.some(r=>r.status==='placed'||r.status==='queued');
    if(unfinished)throw new Error('Cancel or Retry the interrupted request before sending another.');
    const conversation=await harness.conversation(id,context);if(!conversation)throw new Error('Unknown Pi conversation');
    await watch(id);permitted.add(id);await harness.commit(async tx=>{(await tx.doc(Evidence,id)).sourcesJson='[]';},context);
    const submission=await conversation.submit({type:'input',content:input.content,whenBusy:'reject'},context);active.set(id,submission.id);
    const requestId=`pi-request-${submission.id}`;const now=Date.now();
    const userMessage=message(`pi-user-${submission.id}`,input.conversationId,'user',input.content,'completed',now);
    const assistantMessage=message(`pi-assistant-${submission.id}`,input.conversationId,'assistant','','streaming',now+1);assistantMessage.requestId=requestId;
    setTimeout(()=>{emit('chat://started',{requestId,conversationId:input.conversationId,messageId:assistantMessage.id,message:assistantMessage});
      void submission.wait(context).then(async receipt=>{
        if(active.get(id)!==submission.id)return;active.delete(id);permitted.delete(id);
        const conversation=await getConversation(input.conversationId);const final=conversation.messages.find(m=>m.id===assistantMessage.id)!;
        const identity={requestId,conversationId:input.conversationId,messageId:final.id,message:final};
        if(receipt.status==='done')emit('chat://completed',{...identity,conversation});
        else if(final.status==='cancelled')emit('chat://cancelled',identity);
        else emit('chat://failed',{...identity,error:final.errorMessage ?? 'Pi request failed',retryable:true});
      }).catch(error=>{active.delete(id);permitted.delete(id);emit('chat://failed',{requestId,conversationId:input.conversationId,messageId:assistantMessage.id,message:{...assistantMessage,status:'error',errorMessage:String(error)},error:String(error),retryable:true});});
    },0);
    return {requestId,conversationId:input.conversationId,userMessage,assistantMessage};
  };
  const pending=async(conversationId:string) => {const {harness}=await open();const catalog=await harness.snapshot(Reviews,context);const proposals=[];
    for(const id of catalog?.ids ?? []) {const doc=await harness.snapshot(Review,String(id),context);if(doc?.proposalJson){const proposal=proposalOf(doc);if(proposal.conversationId===conversationId && unresolved(proposal))proposals.push(proposal);}}return proposals;};
  const overrides:Partial<ChatApi>={
    getSettings,
    listLocalModels:async baseUrl=>fixture?[{id:'pi-native-fixture',ownedBy:'synthetic fixture'}]:native.listLocalModels(baseUrl),
    listOpenAiModels:async()=>fixture?[{id:'pi-native-fixture',ownedBy:'synthetic fixture'}]:native.listOpenAiModels(),
    getModelCapabilities:async(provider,model,baseUrl)=>fixture?{images:false,audio:false,video:false,files:false,acceptedMimeTypes:[],tools:true,reasoningOptions:['off'],defaultReasoningEffort:'off'}:native.getModelCapabilities(provider,model,baseUrl),
    createConversation:async input=>{const {harness}=await open();const settings=await getSettings();const conversation=await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:input?.provider ?? settings.provider,modelId:input?.model ?? settings.model}}},context);
      await harness.commit(async tx=>{const meta=await tx.doc(Meta,conversation.id);meta.title=input?.title ?? 'Pi conversation';(await tx.doc(Evidence,conversation.id)).access=input?.vaultAccess ?? settings.defaultVaultAccess;},context);
      return getConversation(`pi-${conversation.id}`);},
    listConversations:async includeArchived=>{const {storage,harness}=await open();const records=await storage.scanConversations({},1000,undefined,context);const selected=[];for(const record of records.items)if(await harness.snapshot(Meta,record.id,context))selected.push(record);const items=await Promise.all(selected.map(r=>summary(r.id)));return items.filter(s=>includeArchived || s.status!=='archived');},
    getConversation,sendMessage,
    renameConversation:async(id,title)=>{const {harness}=await open();await harness.commit(async tx=>{(await tx.doc(Meta,cid(id))).title=title;},context);return summary(cid(id));},
    archiveConversation:async(id,archived)=>{const {harness}=await open();await harness.commit(async tx=>{(await tx.doc(Meta,cid(id))).archived=archived;},context);return null;},
    setConversationVaultAccess:async(id,access)=>{const {harness}=await open();await harness.commit(async tx=>{(await tx.doc(Evidence,cid(id))).access=access;},context);return summary(cid(id));},
    setConversationProvider:async(id,provider,model)=>{const {harness}=await open();await (await harness.conversation(cid(id),context))!.configure({model:{provider,modelId:model}},context);return summary(cid(id));},
    cancelRequest:async requestId=>{const {harness}=await open();const submission=await harness.submission(sid(requestId),context);if(!submission)return;
      const records=(await (await open()).storage.scanSubmissions({},1000,undefined,context)).items;const record=records.find(r=>r.id===sid(requestId));if(record)await (await harness.conversation(record.conversationId,context))!.abort(context);},
    retryMessage:async messageId=>{const {storage,harness}=await open();const record=(await storage.scanSubmissions({},1000,undefined,context)).items.find(r=>r.id===sid(messageId));if(!record)throw new Error('Unknown interrupted request');const conversation=await getConversation(`pi-${record.conversationId}`);const user=conversation.messages.find(m=>m.id===`pi-user-${record.id}`)!;
      await (await harness.conversation(record.conversationId,context))!.abort(context);return sendMessage({conversationId:conversation.id,content:user.content});},
    findConversationByProjectionPath:async()=>null,
    suggestContext:async()=>({status:'unavailable',reason:'Prototype uses explicit canonical note IDs',items:[]}),
    listPendingProposals:pending,
    prepareNoteSave:async(conversationId,messageId,selection,options)=>{const conversation=await getConversation(conversationId);const source=conversation.messages.find(m=>m.id===messageId && m.status==='completed');if(!source)throw new Error('Save requires an admitted completed message');
      const markdown=selection?.markdown ?? source.content;const title=selection?.text.slice(0,45) || 'Saved Pi answer';
      const prepared=await invoke<Partial<ChatAgentProposal>>('pi_prepare_review',{title,markdown,noteId:options?.targetNoteId ?? null,access:conversation.vaultAccess});
      prepared.payload={...prepared.payload,wholeAnswer:!selection,originalSave:!options?.copyIntent,reviewIntent:'requested'};
      const {harness}=await open();let taskId=0;await harness.commit(async tx=>{taskId=await stageReview(tx,cid(conversationId),prepared,messageId,JSON.stringify([conversationId,messageId,selection ?? null,options ?? null]));},context);
      return (await readReview(harness,`pi-review-${taskId}`)).proposal;},
    getProposalDraft:async id=>(await readReview((await open()).harness,id)).draft,
    checkpointProposalDraft:async(id,draft,path)=>{const {harness}=await open();const current=await readReview(harness,id);
      if(!draft.title.trim() || draft.markdown.length>262144)throw new Error('Invalid review draft');
      let target=path ?? draft.path;
      if(current.proposal.kind==='create' && (path || draft.title!==current.draft.title)) {const prepared=await invoke<Partial<ChatAgentProposal>>('pi_prepare_review',{title:draft.title,markdown:draft.markdown,noteId:null,access:(await summary(cid(current.proposal.conversationId))).vaultAccess,path:path ?? null});target=prepared.suggestedPath!;}
      if(current.proposal.kind==='update' && target!==current.draft.path)throw new Error('Update target follows Note Identity');
      await invoke('pi_validate_review_checkpoint',{markdown:draft.markdown,title:draft.title,path:target,decisions:draft.decisions});
      const next:ChatProposalDraft={...draft,path:target,version:draft.version+1};let acknowledged=next;
      await harness.commit(async tx=>{const doc=await tx.doc(Review,String(current.taskId),'');if(!unresolved(proposalOf(doc)) || doc.decision!=='pending' || draftOf(doc).version!==draft.version)throw new Error('Review changed; reopen its latest checkpoint');
        if(JSON.stringify({...next,version:draft.version})===doc.draftJson){acknowledged=draftOf(doc);return;}
        doc.draftJson=JSON.stringify(next);const proposal=proposalOf(doc);proposal.title=draft.title;proposal.suggestedPath=target;proposal.payload={...proposal.payload,title:draft.title,markdown:draft.markdown};doc.proposalJson=JSON.stringify(proposal);},context);return acknowledged;},
    commitAgentProposal:async(id,markdown,expectedVersion)=>{const {harness}=await open();const current=await readReview(harness,id);
      if(current.proposal.status==='committed')return JSON.parse(current.value.receiptJson) as CommitNoteReviewResult;
      const version=expectedVersion ?? current.draft.version;
      await harness.commit(async tx=>{const doc=await tx.doc(Review,String(current.taskId),'');const proposal=proposalOf(doc),draft=draftOf(doc);
        if(!unresolved(proposal) || doc.decision!=='pending' || draft.version!==version || (markdown!==undefined && markdown!==draft.markdown))throw new Error('Keep does not match the acknowledged review');
        doc.acceptedJson=JSON.stringify({id,version,kind:proposal.kind,noteId:proposal.noteId,path:draft.path,title:draft.title,markdown:draft.markdown,baseHash:proposal.baseHash,access:(await tx.doc(Evidence,cid(proposal.conversationId))).access});doc.decision='keep';doc.receiptJson='';
      },context);harness.resume();
      const watch=await harness.watchDoc(Review,String(current.taskId),context);if(!watch)throw new Error('Review disappeared');const result=Promise.withResolvers<CommitNoteReviewResult>();
      const choose=(doc:typeof watch.value)=>{if(doc?.receiptJson && doc.receiptVersion===version)result.resolve(JSON.parse(doc.receiptJson));};watch.start(async doc=>{choose(doc);});choose(watch.value);
      try{return await result.promise;}finally{await watch.stop();}},
    dismissAgentProposal:async id=>{const {harness}=await open();const current=await readReview(harness,id);await harness.commit(async tx=>{const doc=await tx.doc(Review,String(current.taskId),'');if(!unresolved(proposalOf(doc)) || doc.decision!=='pending')throw new Error('Review already settled or Keep is in flight');doc.decision='discard';},context);harness.resume();await harness.waitForTask(current.taskId,context);return (await readReview(harness,id)).proposal;},
    on:async(event,handler)=>{let set=listeners.get(event);if(!set){set=new Set();listeners.set(event,set);}const listener=handler as (payload:unknown)=>void;set.add(listener);return()=>{set!.delete(listener);};}
  };
  for(const key of ['branchFromMessage','createExcerpt','rememberExcerpt','unrememberExcerpt','resolveProjectionConflict','decidePermission'] as const) {
    Object.assign(overrides,{[key]:async()=>{throw new Error(`${key} is outside the Pi prototype slice`);}});
  }
  Object.assign(overrides,{prototypeCheckpoint:async(value:unknown)=>{const {UiProbe}=await import('./probe');const {harness}=await open();await harness.commit(async tx=>{Object.assign(await tx.doc(UiProbe),value);},context);}});
  Object.assign(overrides,{prototypeState:async()=>{const {UiProbe}=await import('./probe');return (await open()).harness.snapshot(UiProbe,context);}});
  Object.assign(overrides,{prototypeResolvePassage:async(conversationId:string,evidenceId:string)=>{const {harness}=await open();const current=await summary(cid(conversationId));const entries=(await (await harness.conversation(cid(conversationId),context))!.context(context)).entries;for(const entry of entries){if(!entry.byTaskId)continue;const doc=await harness.snapshot(AdmittedAnswer,String(entry.byTaskId),context);const source=doc && evidenceSources(doc).find(s=>s.passage?.id===evidenceId);if(source)return invoke('pi_resolve_passage',{source,access:current.vaultAccess});}throw new Error('Source was not issued to this conversation');}});
  Object.assign(overrides,{prototypeFault:async(id:string,fault:string)=>{if(!fixture)throw new Error('Synthetic fixture required');const {harness}=await open();const current=await readReview(harness,id);await harness.commit(async tx=>{(await tx.doc(Review,String(current.taskId),'')).fault=fault;},context);}});
  Object.assign(overrides,{prototypeClose:async()=>{if(engine)await (await engine).harness.close(context);}});
  return new Proxy(native,{get(target,key){const override=overrides[key as keyof ChatApi];const value=override ?? Reflect.get(target,key);return typeof value==='function'?value.bind(override?overrides:target):value;}});
}
