// Opt-in projection onto the existing ChatApi and editor/review UI. Durable
// session/task state stays in Pi; native retained services supply only domain operations.
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Harness, createRegistry, defineDoc, watchEvents, LiveDoc, UsageDoc, type AgentEventStream, type EntryRecord, type ConversationId, type SubmissionId } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { ChatApi } from '$lib/features/chat/api';
import type { AgentEvent, AgentPlanEntry, ChatAgentEventEnvelope, ChatAgentProposal, ChatConversation, ChatConversationSummary, ChatEventMap, ChatMessage, ChatSettings } from '$lib/features/chat/types';
import { CHAT_AGENT_EVENT_SCHEMA_VERSION, initialAgentEventState, replayAgentEvents } from '$lib/features/chat/agentEvents';
import { normalizeSource } from '$lib/features/chat/sources';
import type { CommitNoteReviewResult } from '$lib/types/proposals';
import { openNativeSqlite } from './nativeSqlite';
import { nativeModels, admitNativeRequest, releaseNativeRequest, type RequestPolicies, type NativeAdmission } from './nativeProvider';
import { prepareAttachments, projectAttachments } from './attachments';
import { vaultSources } from './web';
import { Evidence, EvidenceRun, AdmittedAnswer, notesExtension, evidenceSources, evidenceGrants, prepareEvidence, stageEvidence, releaseEvidence, evidencePrompt, evidenceReadEvents, evidencePermissionEvents, resolveEvidencePermission, type PreparedEvidence } from './notesExtension';
import { scanAll, safeHistory, continuityCandidates, selectedEvidenceNoteIds, requestSnapshot, REQUEST_KIND, lifecycleExtension, type ActiveAdmission, type RequestSnapshot, type SendInput } from './lifecycle';
import { saveAnswer, conversationFromOriginPath, originProjectionPath } from './save';
import { suggestPiContext } from './suggestions';
import { researchExtensions, researchAdmission, ResearchWorker, type ResearchDependencies } from './research';
import { compactionExtension } from './compaction';
import { SummaryUsageRun, summaryUsageKey, emptyUsageCounters, usageCounters, addUsageCounters, researchUsage, missingResearchUsage, type UsageCounters } from './compactionState';
import { buildTranscriptSnapshot, createTranscriptPublisher, transcriptStatus, resolveTranscriptConflict, type TranscriptStatus } from './transcript';
import { createTextProjection } from './streamProjection';
import { Review, Reviews, reviewExtension, readReview, proposalOf, checkpointReview, keepReview, discardReview } from './reviews';

const Meta = defineDoc({kind:'gneauxghts.pi.chat-presentation',version:1,scope:'conversation',history:'latest',fork:'initial',
  initial:() => ({title:'Pi conversation',createdAtMillis:Date.now(),archived:false as boolean,reasoningEffort:'medium'})});
const cid = (id:string) => {if(!/^pi-\d+$/.test(id)) throw new Error('A fresh Pi-owned conversation is required');return Number(id.slice(3)) as ConversationId;};
const sid = (id:string) => {if(!/^pi-(?:request|assistant)-\d+$/.test(id))throw new Error('A Pi request or assistant message identity is required');return Number(id.match(/\d+$/)![0]) as SubmissionId;};
const textOf = (content:unknown):string => typeof content==='string' ? content : Array.isArray(content) ? content.filter(b=>b.type==='text').map(b=>b.text).join('') : '';
const unresolved = (proposal:ChatAgentProposal) => proposal.status==='pending' || proposal.status==='conflict';

// Provider/parser exceptions can echo request bodies or credentials. Only known
// application diagnostics are suitable for the durable conversation projection.
const visibleFailures=new Set([
  'Canonical note changed; retry','Canonical note changed; read it again',
  'Original context is no longer allowed','Original context changed; start a fresh message',
  'Evidence changed before delivery; read again','Evidence or access changed; read again',
  'Evidence binding mismatch','Current request authorization retired',
  'Prior note references changed; Retry with current access.',
  'Invalid plain answer','Unissued note citation in plain answer',
  'Note evidence requires structured answer admission','Issued passage required',
  'Structured answer exceeds the size limit','The model returned an invalid structured answer',
  'Invalid answer segment count','Invalid answer segment','Note citations must be selected in segment sources',
  'Duplicate answer source','Invalid answer source ID','An answer source is stale or no longer allowed',
  'Passage identity unavailable','Native provider connection failed','Native provider stream failed',
  'Native provider did not return SSE','Native stream ended before headers',
  'Unable to configure native transport','Webview disconnected','Prototype provider response exceeds bound',
]);
function visibleFailure(detail:unknown,partial:unknown):string {
  for(const candidate of [detail,partial])if(typeof candidate==='string') {
    const diagnostic=candidate.replace(/^Error: /,'').trim();
    if(visibleFailures.has(diagnostic)||/^Native provider HTTP [1-5]\d{2}$/.test(diagnostic))return diagnostic;
  }
  return 'The model request failed. Check the model and connection settings, then Retry.';
}

function message(id:string,conversationId:string,role:ChatMessage['role'],content:string,status:ChatMessage['status'],now:number):ChatMessage {
  return {id,conversationId,role,content,status,createdAtMillis:now,updatedAtMillis:now,requestId:null,errorMessage:null,
    citations:[],attachments:[],linkTarget:role==='assistant'?`${originProjectionPath(conversationId).replace(/\.md$/,'')}#^msg_${id}`:null,parts:initialAgentEventState(content).parts,
    agentRunId:null,agentSequence:0,agentEventCreatedAtMillis:0,agentRetiredRunIds:[]};
}

function projectTurnEvents(entries:readonly EntryRecord[],submissionId:number,conversationId:string,timestamp:number,summaryUsage?:Partial<UsageCounters>,aggregate=emptyUsageCounters()):ChatAgentEventEnvelope[] {
  const events:ChatAgentEventEnvelope[]=[];
  const append=(event:AgentEvent,createdAtMillis=timestamp)=>events.push({schemaVersion:CHAT_AGENT_EVENT_SCHEMA_VERSION,requestId:`pi-request-${submissionId}`,conversationId,messageId:`pi-assistant-${submissionId}`,runId:`pi-run-${submissionId}`,sequence:events.length+1,createdAtMillis,event});
  let callIndex=0;
  if(summaryUsage){addUsageCounters(aggregate,summaryUsage);append({type:'usageUpdated',callIndex:callIndex++,aggregate:{...aggregate}});}
  for(const entry of entries){const workerUsage=researchUsage(entry);
    if(workerUsage){addUsageCounters(aggregate,workerUsage);append({type:'usageUpdated',callIndex:callIndex++,aggregate:{...aggregate}});}
    for(const item of entry.model ?? []) {
    if(item.role==='assistant') {
      for(const block of item.content)if(block.type==='toolCall')append({type:'toolCallUpdated',callId:block.id,name:block.name,title:block.name,status:'running'},item.timestamp);
      addUsageCounters(aggregate,usageCounters(item.usage));
      append({type:'usageUpdated',callIndex:callIndex++,aggregate:{...aggregate}},item.timestamp);
    } else if(item.role==='toolResult'){
      if(item.toolName==='update_plan'&&!item.isError)try{const plan=JSON.parse(textOf(item.content)) as {entries:AgentPlanEntry[]};if(Array.isArray(plan.entries)&&plan.entries.length<=12)append({type:'planUpdated',entries:plan.entries},item.timestamp);}catch{/* Malformed tool output is not a plan. */}
      append({type:'toolCallUpdated',callId:item.toolCallId,name:item.toolName,title:item.toolName,status:item.isError?'error':'success'},item.timestamp);}
  }}
  return events;
}

const liveApis=new Set<()=>Promise<void>>();
const policyCancellations=new Set<()=>Promise<void>>();
let quiesceListener:Promise<unknown>|undefined;
export async function closePiChatApis():Promise<void> {await Promise.all([...liveApis].map(close=>close()));}
function attachQuiesceListener() {
  return quiesceListener ??= Promise.all([listen<{token:string}>('pi-lifecycle-quiesce',async event=>{await closePiChatApis();await invoke('pi_lifecycle_quiesced',{token:event.payload.token});}),listen('pi-policy-changed',async()=>{await Promise.all([...policyCancellations].map(cancel=>cancel()));})]);
}

export function createPiChatApi(native:ChatApi):ChatApi {
  let engine:Promise<{harness:Harness;storage:SqliteStorage;models:ReturnType<typeof nativeModels>}>|undefined;
  let closing=false;
  let transcripts:ReturnType<typeof createTranscriptPublisher>|undefined;
  let projectionUnlisten:(()=>void)|undefined;
  const projectionStates=new Map<string,TranscriptStatus>();
  const readProjection=async(id:string)=>{try{const state=await transcriptStatus(id);return state ? {...state,warning:projectionStates.get(id)?.warning ?? state.warning} : projectionStates.get(id);}catch{return projectionStates.get(id);}};
  let unsubscribeCommits:(()=>void)|undefined;
  const admissions=new Map<number,ActiveAdmission>();
  const admitting=new Set<number>();
  const permitted=new Set<number>(),policies:RequestPolicies=new Map();
  const active=new Map<number,SubmissionId>();
  const watched=new Map<number,AgentEventStream>();
  const requestEventsEnabled=new Set<number>();
  const evidenceWatched=new Map<number,{stop():Promise<unknown>}>();
  const sequences=new Map<number,number>();
  const listeners=new Map<keyof ChatEventMap,Set<(payload:unknown)=>void>>();
  const emit=<K extends keyof ChatEventMap>(event:K,payload:ChatEventMap[K]) => {for(const listener of listeners.get(event) ?? []) listener(payload);};
  let fixture=false,followonsFixture=false;
  const getSettings=async ():Promise<ChatSettings> => {
    const probe=await invoke<{fixture:boolean;followonsGate?:boolean}>('pi_probe_config');
    fixture=probe.fixture;followonsFixture=fixture&&probe.followonsGate===true;
    const settings=await native.getSettings();
    return fixture?{...settings,provider:'local',model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',defaultVaultAccess:'full'}:settings;
  };
  const open=() => {if(closing)throw new Error('Pi chat is closing');return engine ??= (async () => {
    await attachQuiesceListener();
    await invoke('pi_bind_vault_location');
    projectionUnlisten=await listen<ChatEventMap['chat://projection-conflict']>('chat://projection-conflict',event=>emit('chat://projection-conflict',event.payload));
    const settings=await getSettings();
    const storage=await SqliteStorage.open(await openNativeSqlite());
    let harness:Harness;
    const registry=createRegistry();const evidenceExtension=notesExtension(permitted,policies);registry.install(evidenceExtension);
    registry.install(lifecycleExtension(admissions,policies));
    registry.install(reviewExtension(async id=>(await harness.snapshot(Evidence,id as ConversationId,context))?.access ?? 'none',
      id=>active.has(id)?`pi-assistant-${active.get(id)}`:`pi-tool-${id}`));
    const researchDeps:ResearchDependencies={harness:()=>harness,policies,admission:id=>admissions.get(id),permitted};
    for(const extension of researchExtensions(researchDeps,evidenceExtension))registry.install(extension);
    registry.install(compactionExtension({...researchDeps,capacity:async id=>{if(fixture)return undefined;const admitted=await researchAdmission(researchDeps,id,context);return admitted ? (await invoke<number|null>('pi_context_capacity',{admissionId:admitted.admission.id})) ?? undefined : undefined;}}));
    const models=nativeModels(policies,async (policy,answer) => {
      await harness.commit(async tx=>{const doc=await tx.doc(AdmittedAnswer,String(policy.taskId),'');doc.text=answer.text;doc.sourcesJson=JSON.stringify(answer.sources);const binding=await tx.doc(Evidence,[...admissions.entries()].find(([,value])=>value.admission.id===policy.admission?.id)![0] as ConversationId);doc.grantsJson=binding.grantsJson;doc.associationsJson=JSON.stringify((answer as {associations?:unknown[]}).associations ?? []);},context);
    },settings.model);
    harness=await Harness.open(storage,{registry,models,settings:{retry:{enabled:false,maxRetries:0},compaction:{enabled:false,keepRecentTokens:1024}}},context);
    void harness.closed.then(()=>{if(!closing)engine=undefined;});
    transcripts=createTranscriptPublisher(loadTranscript,(id,status)=>{const previous=projectionStates.get(id);projectionStates.set(id,status);if((status.detached||status.warning||previous?.detached||previous?.warning)&&JSON.stringify(previous)!==JSON.stringify(status))emit('chat://projection-conflict',{conversationId:id,notePath:status.projectionPath,deleted:status.conflict==='missing'});});
    // Domain proposals may appear before a model run fails. This observer emits
    // only committed previews; it does not become an approval owner.
    const publishedReviews=new Map<number,string>();
    const announced=new Set((await harness.snapshot(Reviews,context))?.ids ?? []);
    let queued=false;
    unsubscribeCommits=harness.subscribeCommits(()=>{if(queued)return;queued=true;queueMicrotask(async()=>{queued=false;
      try {const catalog=await harness.snapshot(Reviews,context);for(const id of catalog?.ids ?? []) {
        const doc=await harness.snapshot(Review,String(id),context);
        if(doc?.receiptJson && publishedReviews.get(id)!==doc.receiptJson){publishedReviews.set(id,doc.receiptJson);if(doc.proposalJson)transcripts?.schedule(proposalOf(doc).conversationId);}
        if(announced.has(id))continue;
        if(doc?.proposalJson){const proposal=proposalOf(doc);announced.add(id);if(unresolved(proposal))emit('chat://proposal',await displayProposal(proposal));}
      }} catch { /* Failed storage is surfaced by the operation owning it. */ }
    });});
    queueMicrotask(()=>{void scanAll(cursor=>storage.scanConversations({},128,cursor,context)).then(async records=>{for(const record of records)if(await harness.snapshot(Meta,record.id,context))transcripts?.schedule(`pi-${record.id}`);}).catch(()=>{});});
    return {harness,storage,models};
  })().catch(error=>{engine=undefined;throw error;});};
  const summary=async (id:ConversationId):Promise<ChatConversationSummary> => {
    const {harness,storage}=await open();const conversation=await harness.conversation(id,context);if(!conversation)throw new Error('Unknown Pi conversation');
    const meta=await harness.snapshot(Meta,id,context);const agent=await conversation.agent(context);const evidence=await harness.snapshot(Evidence,id,context);
    const submissions=await scanAll(cursor=>storage.scanSubmissions({conversationId:id},128,cursor,context));
    const updatedAtMillis=(await entriesFor(id)).reduce((latest,entry)=>(entry.model ?? []).reduce((time,message)=>Math.max(time,message.timestamp),latest),meta?.createdAtMillis ?? 0);
    const projection=await readProjection(`pi-${id}`);
    return {id:`pi-${id}`,title:meta?.title ?? 'Pi conversation',status:projection?.detached?'projectionConflict':meta?.archived?'archived':'active',vaultAccess:evidence?.access ?? 'none',
      createdAtMillis:meta?.createdAtMillis ?? 0,updatedAtMillis,messageCount:submissions.filter(record=>record.type==='input').length*2,lastMessagePreview:null,
      provider:(agent.model?.provider ?? 'local') as 'local'|'openai',model:agent.model?.modelId ?? '',reasoningEffort:meta?.reasoningEffort ?? 'medium'};
  };
  const stopWatch=async(id:number) => {requestEventsEnabled.delete(id);const stream=watched.get(id);watched.delete(id);if(stream)await stream.stop();const evidence=evidenceWatched.get(id);evidenceWatched.delete(id);if(evidence)await evidence.stop();sequences.delete(id);};
  const watch=async(id:ConversationId) => {
    if(watched.has(id))return ()=>{};const {harness}=await open();const stream=await watchEvents(harness,id,context);watched.set(id,stream);
    const projectText=createTextProjection();let usageOrigin:SubmissionId|undefined;
    let aggregate=emptyUsageCounters(),summarySeen=emptyUsageCounters();
    const publish:Parameters<AgentEventStream['start']>[0]=async batch=>{
      const submissionId=active.get(id);if(!submissionId)return;
      const identity={requestId:`pi-request-${submissionId}`,conversationId:`pi-${id}`,messageId:`pi-assistant-${submissionId}`};
      for(const event of batch) {
        if(event.type==='message_end'){
          if(usageOrigin!==submissionId){usageOrigin=submissionId;aggregate=emptyUsageCounters();summarySeen=emptyUsageCounters();}
          const binding=await harness.snapshot(Evidence,id,context);
          const summaryUsage=binding?.sessionId?await harness.snapshot(SummaryUsageRun,summaryUsageKey(id,binding.sessionId),context):undefined;
          const delta=emptyUsageCounters();for(const key of Object.keys(delta) as (keyof UsageCounters)[]){delta[key]=Math.max(0,(summaryUsage?.[key]??0)-summarySeen[key]);summarySeen[key]=summaryUsage?.[key]??0;}
          for(const envelope of projectTurnEvents([event.entry],submissionId,identity.conversationId,Date.now(),Object.values(delta).some(value=>value>0)?delta:undefined,aggregate)){const sequence=(sequences.get(id)??0)+1;sequences.set(id,sequence);emit('chat://agent-event',{...envelope,sequence});}
        }
        const update=projectText(event);
        if(update?.type==='delta')emit('chat://text-delta',{...identity,delta:update.delta});
        else if(update?.type==='draft')emit('chat://answer-draft',{...identity,attempt:update.attempt,sequence:update.sequence,content:update.content});
        if(event.type==='tool_execution_start' || event.type==='tool_execution_end')emit('chat://activity',{...identity,runId:`pi-run-${submissionId}`,status:event.type==='tool_execution_start'?'running':'completed'});
      }
    };
    // Acquisition already retains a bounded committed backlog (overflow becomes
    // a snapshot). Do not consume it before submit returns or before the UI has
    // received its started message; either ordering would lose the first text.
    let started=false;
    return ()=>{if(!started&&watched.get(id)===stream){started=true;stream.start(publish);}};
  };
  const watchEvidence=async(id:ConversationId,submissionId:SubmissionId)=>{
    const {harness}=await open();const watcher=await harness.watchDoc(Evidence,id,context);if(!watcher)return;if(closing||!requestEventsEnabled.has(id)||active.get(id)!==submissionId){await watcher.stop();return;}evidenceWatched.set(id,watcher);
    const seen=new Set<string>();const identity={requestId:`pi-request-${submissionId}`,conversationId:`pi-${id}`,messageId:`pi-assistant-${submissionId}`,runId:`pi-run-${submissionId}`};
    const publish=async(binding:typeof watcher.value)=>{
      if(!binding || active.get(id)!==submissionId)return;
      let reads:AgentEvent[]=[];try{await invoke('pi_validate_sources',{sources:evidenceSources(binding),access:binding.access,grants:evidenceGrants(binding)});reads=evidenceReadEvents(binding);}catch{/* Revoked sources cannot become live read links. */}
      for(const event of [...reads,...evidencePermissionEvents(binding,identity)]){const key=JSON.stringify(event);if(seen.has(key))continue;seen.add(key);const sequence=(sequences.get(id)??0)+1;sequences.set(id,sequence);emit('chat://agent-event',{...identity,sequence,createdAtMillis:Date.now(),event});}
    };
    watcher.start(publish);await publish(watcher.value);
  };
  const entriesFor=async(id:ConversationId):Promise<EntryRecord[]> => {const {storage}=await open();return scanAll(cursor=>storage.scanEntries({conversationId:id,order:'ascending'},128,cursor,context));};
  const historyFor=async(id:ConversationId) => {const {harness}=await open();const entries=await entriesFor(id);const grounded=new Set<number>(),byRequest=new Map<number,string[]>();let origin:number|undefined;
    for(const entry of entries){const snapshot=requestSnapshot(entry);if(snapshot){origin=entry.id;
        const previous=snapshot.evidence?await harness.snapshot(EvidenceRun,snapshot.evidence.sessionId,context):undefined;
        byRequest.set(origin,[...selectedEvidenceNoteIds(snapshot.evidence),...(previous?vaultSources(evidenceSources(previous)).flatMap(source=>source.noteId?[source.noteId]:[]):[])]);}
      if(entry.byTaskId){const answer=await harness.snapshot(AdmittedAnswer,String(entry.byTaskId),context);if(answer){const sources=vaultSources(evidenceSources(answer));
          if(sources.length)grounded.add(entry.byTaskId);if(origin!==undefined)byRequest.set(origin,[...(byRequest.get(origin)??[]),...sources.flatMap(source=>source.noteId?[source.noteId]:[])]);}}}
    return {history:safeHistory(entries,grounded),continuityCandidates:continuityCandidates(entries,grounded,byRequest)};
  };
  const getConversation=async(conversationId:string):Promise<ChatConversation> => {
    const id=cid(conversationId);const {harness,storage}=await open();const conversation=await harness.conversation(id,context);if(!conversation)throw new Error('Unknown Pi conversation');
    const records=(await scanAll(cursor=>storage.scanSubmissions({conversationId:id},128,cursor,context))).filter(r=>r.type==='input');
    let entries=await entriesFor(id);
    const live=await harness.snapshot(LiveDoc,id,context);
    // Stopped/interrupted tools may never append their final details. Recover
    // received worker spend from its own Pi ledger, without reading its prose.
    const workerUsageByOrigin=new Map<string,UsageCounters>();
    const children=(await scanAll(cursor=>storage.scanConversations({},128,cursor,context))).filter(record=>record.owner?.conversationId===id);
    for(const child of children){const worker=await harness.snapshot(ResearchWorker,child.id,context);if(worker?.parentId!==id)continue;
      const ledger=await harness.snapshot(UsageDoc,child.id,context);const totals=workerUsageByOrigin.get(worker.parentSessionId)??emptyUsageCounters();
      for(const value of Object.values(ledger?.models??{}))addUsageCounters(totals,usageCounters(value));workerUsageByOrigin.set(worker.parentSessionId,totals);}
    const messages:ChatMessage[]=[];
    for(let record of records) {
      const userEntry=record.entry && entries.find(e=>e.id===record.entry);
      const snapshot=requestSnapshot(userEntry);
      // Projection awaits per-origin documents. A pending scan may have settled
      // and retired its process owner by then; durable settlement wins.
      let currentLive=live;
      if(record.status==='placed'||record.status==='queued') {
        currentLive=await harness.snapshot(LiveDoc,id,context);
        const latest=await storage.submission(record.id,context);
        if(latest?.type==='input'){
          record=latest;
          // Settlement commits tool results before its terminal submission.
          // Refresh the entries too, so terminal text, activity and usage all
          // come from the completed turn rather than the earlier live scan.
          if(record.status!=='placed'&&record.status!=='queued')entries=await entriesFor(id);
        }
      }
      let origin=snapshot?.evidence ? await harness.snapshot(EvidenceRun,snapshot.evidence.sessionId,context) : undefined;
      // An origin read can outlive the final owner retirement too. Reconcile
      // once more before interpreting owner absence as interruption; retirement
      // follows durable settlement, so the terminal record cannot regress.
      if((record.status==='placed'||record.status==='queued')&&active.get(id)!==record.id&&!admitting.has(id)){
        const latest=await storage.submission(record.id,context);
        if(latest?.type==='input'){
          record=latest;
          if(record.status!=='placed'&&record.status!=='queued'){
            entries=await entriesFor(id);
            origin=snapshot?.evidence ? await harness.snapshot(EvidenceRun,snapshot.evidence.sessionId,context) : undefined;
          }
        }
      }
      const structured=!!origin && (evidenceSources(origin).length>0 || snapshot?.evidence?.context.some(item=>item.kind==='selected_excerpt'));
      const timestamp=snapshot?.createdAtMillis ?? userEntry?.model?.[0]?.timestamp ?? 0;
      const user=message(`pi-user-${record.id}`,conversationId,'user',snapshot?.input.content ?? textOf(userEntry && userEntry.model?.[0]?.content),'completed',timestamp);
      user.attachments=projectAttachments(snapshot?.input.attachments);
      const answerEntry=record.status==='done' ? entries.find(e=>e.id===record.answer) ?? (await storage.entry(record.answer,context))?.entry : undefined;
      const nextInput=records.find(other=>other.id>record.id && other.entry);
      const turnEntries=entries.filter(entry=>record.entry && entry.id>record.entry && (!nextInput?.entry || entry.id<nextInput.entry));
      const partial=turnEntries.flatMap(entry=>entry.model ?? []).filter(value=>value.role==='assistant').at(-1);
      const livePartial=currentLive?.run?.inputs.includes(record.id) ? currentLive.generation?.message : undefined;
      const current=active.get(id)===record.id || ((record.status==='placed'||record.status==='queued')&&admitting.has(id));
      const assistant=message(`pi-assistant-${record.id}`,conversationId,'assistant',textOf(answerEntry?.model?.[0]?.content ?? (structured ? undefined : livePartial?.content ?? partial?.content)),record.status==='done'?'completed':current?'streaming':record.status==='unanswered' && record.reason==='aborted'?'cancelled':'error',timestamp+1);
      assistant.requestId=`pi-request-${record.id}`;
      if(assistant.status==='error')assistant.errorMessage=record.status==='unanswered'?visibleFailure(record.detail,partial?.errorMessage):'Interrupted request; Retry explicitly permits network work.';
      if(answerEntry && answerEntry.byTaskId) {const admitted=await harness.snapshot(AdmittedAnswer,String(answerEntry.byTaskId),context);if(admitted){assistant.content=admitted.text;assistant.parts=initialAgentEventState(admitted.text).parts;try{await invoke('pi_validate_sources',{sources:vaultSources(evidenceSources(admitted)),access:(await harness.snapshot(Evidence,id,context))?.access ?? 'none',grants:evidenceGrants(admitted)});assistant.citations=evidenceSources(admitted).map(normalizeSource);}catch{assistant.citations=evidenceSources(admitted).filter(source=>source.kind==='web').map(normalizeSource);}}}
      const summaryUsage=snapshot?.evidence?.sessionId?await harness.snapshot(SummaryUsageRun,summaryUsageKey(id,snapshot.evidence.sessionId),context):undefined;
      const supplemental=missingResearchUsage(turnEntries,snapshot?.evidence?.sessionId?workerUsageByOrigin.get(snapshot.evidence.sessionId):undefined);addUsageCounters(supplemental,summaryUsage);
      const events=projectTurnEvents(turnEntries,record.id,conversationId,timestamp,Object.values(supplemental).some(value=>value>0)?supplemental:undefined);
      if(origin){const binding=origin;
        let reads:AgentEvent[]=[];try{await invoke('pi_validate_sources',{sources:evidenceSources(binding),access:(await harness.snapshot(Evidence,id,context))?.access ?? 'none',grants:evidenceGrants(binding)});reads=evidenceReadEvents(binding);}catch{/* Keep stale destinations unavailable. */}
        for(const event of [...reads,...evidencePermissionEvents(binding,{requestId:`pi-request-${record.id}`,conversationId,messageId:assistant.id,runId:`pi-run-${record.id}`})])events.push({schemaVersion:CHAT_AGENT_EVENT_SCHEMA_VERSION,requestId:`pi-request-${record.id}`,conversationId,messageId:assistant.id,runId:`pi-run-${record.id}`,sequence:events.length+1,createdAtMillis:timestamp,event});}
      if(!current)for(const envelope of [...events])if(envelope.event.type==='permissionRequested'&&!events.some(candidate=>candidate.event.type==='permissionResolved'&&candidate.event.permissionId===(envelope.event as Extract<AgentEvent,{type:'permissionRequested'}>).request.permissionId))events.push({...envelope,sequence:events.length+1,event:{type:'permissionResolved',permissionId:envelope.event.request.permissionId,resolution:'cancelled'}});
      const eventState=replayAgentEvents(assistant.content,events,{conversationId,messageId:assistant.id});assistant.parts=eventState.parts;assistant.agentRunId=eventState.runId;assistant.agentSequence=eventState.sequence;assistant.agentEventCreatedAtMillis=eventState.createdAtMillis;
      messages.push(user,assistant);
    }
    const catalog=await harness.snapshot(Reviews,context);for(const reviewId of catalog?.ids ?? []){const doc=await harness.snapshot(Review,String(reviewId),context);if(!doc?.receiptJson)continue;const proposal=proposalOf(doc);if(proposal.conversationId!==conversationId || proposal.status!=='committed' || !proposal.payload.originalSave || !proposal.payload.wholeAnswer)continue;const receipt=JSON.parse(doc.receiptJson) as CommitNoteReviewResult;const saved=messages.find(m=>m.id===proposal.assistantMessageId);if(saved && receipt.noteId && receipt.applied?.path)saved.savedNote={noteId:receipt.noteId,path:await displayPath(receipt.applied.path)};}
    const projection=await readProjection(conversationId);
    return {...await summary(id),messages,activeRequestId:active.has(id)?`pi-request-${active.get(id)}`:null,projectionPath:projection?.projectionPath ?? null,projectionWarning:projection?.warning ?? null,projectionConflict:projection?.conflict ?? null,excerptMessageIds:{}};
  };
  const loadTranscript=async(conversationId:string)=>{
    const id=cid(conversationId),{harness,storage}=await open();
    const entries=await entriesFor(id),submissions=await scanAll(cursor=>storage.scanSubmissions({conversationId:id},128,cursor,context));
    const meta=await harness.snapshot(Meta,id,context),answers=new Map<number,{text:string;sourcesJson:string}>(),structured=new Set<number>();
    for(const taskId of new Set(entries.flatMap(entry=>entry.byTaskId?[entry.byTaskId]:[]))){const answer=await harness.snapshot(AdmittedAnswer,String(taskId),context);if(answer)answers.set(taskId,answer);}
    for(const record of submissions){const snapshot=requestSnapshot(entries.find(entry=>entry.id===record.entry));const evidence=snapshot?.evidence && await harness.snapshot(EvidenceRun,snapshot.evidence.sessionId,context);if(snapshot?.evidence?.context.some(item=>item.kind==='selected_excerpt') || evidence && vaultSources(evidenceSources(evidence)).length)structured.add(record.id);}
    const settledOrigins:Array<{messageId:string;noteId:string}>=[];const reviews=await harness.snapshot(Reviews,context);
    for(const reviewId of reviews?.ids ?? []){const review=await harness.snapshot(Review,String(reviewId),context);if(!review?.receiptJson||!review.proposalJson)continue;const proposal=proposalOf(review),receipt=JSON.parse(review.receiptJson) as CommitNoteReviewResult;if(proposal.conversationId===conversationId && receipt.noteId && proposal.assistantMessageId)settledOrigins.push({messageId:proposal.assistantMessageId,noteId:receipt.noteId});}
    return buildTranscriptSnapshot({conversationId,title:meta?.title ?? 'Pi conversation',createdAtMillis:meta?.createdAtMillis ?? 0,entries,submissions,answers,structuredSubmissions:structured,settledOrigins});
  };
  const submit=async(input:SendInput,retry?:{snapshot:RequestSnapshot;submissionId:number}):ReturnType<ChatApi['sendMessage']> => {
    const id=cid(input.conversationId);if(admitting.has(id)||active.has(id))throw new Error('A request is already running in this conversation.');
    admitting.add(id);
    let accepted=false;
    let admission:ActiveAdmission|undefined;
    let frozenRequest:NativeAdmission|undefined;
    let prepared:PreparedEvidence|undefined;
    try {
      const {harness,storage,models}=await open();
      const unfinished=(await scanAll(cursor=>storage.scanSubmissions({conversationId:id},128,cursor,context))).some(r=>r.status==='placed'||r.status==='queued');
      if(unfinished)throw new Error('Stop or Retry the interrupted request before sending another.');
      const conversation=await harness.conversation(id,context);if(!conversation)throw new Error('Unknown Pi conversation');
      const settings=await getSettings();const agent=await conversation.agent(context);
      const selected:RequestSnapshot['settings']=retry?.snapshot.settings ?? {provider:(agent.model?.provider ?? settings.provider) as ChatSettings['provider'],model:agent.model?.modelId ?? settings.model,reasoningEffort:(await harness.snapshot(Meta,id,context))?.reasoningEffort ?? settings.reasoningEffort,serviceTier:settings.serviceTier,localBaseUrl:settings.localBaseUrl,webAccess:settings.webAccess};
      selected.webAccess ??= 'off';
      selected.modelCapabilities ??= await overrides.getModelCapabilities(selected.provider,selected.model,selected.localBaseUrl);models.registerModel(selected.provider,selected.model,selected.modelCapabilities);
      const previousHistory=retry?{history:retry.snapshot.history,continuityCandidates:retry.snapshot.continuityCandidates??[]}:await historyFor(id);
      const history=previousHistory.history;
      const binding=await harness.snapshot(Evidence,id,context);
      if(retry&&!retry.snapshot.evidence)throw new Error('Original temporal context is unavailable; start a fresh message.');
      prepared=await prepareEvidence(input,binding?.access ?? 'none',JSON.parse(binding?.sessionGrantsJson || '[]'),retry?.snapshot.evidence);
      const frozen=await admitNativeRequest(selected.provider,selected.model,selected.reasoningEffort,selected.serviceTier,{localBaseUrl:selected.localBaseUrl,capabilities:selected.modelCapabilities,webAccess:selected.webAccess,forceWebSearch:input.forceWebSearch});
      frozenRequest=frozen;
      input={...input,attachments:input.attachments?.length ? await prepareAttachments(input.attachments,frozen) : []};
      const snapshot:RequestSnapshot={version:1,input:structuredClone(input),settings:selected,history,continuityCandidates:previousHistory.continuityCandidates,evidence:prepared,createdAtMillis:Date.now(),retryOf:retry?.submissionId ?? null,origin:retry?.snapshot.origin ?? retry?.submissionId ?? null};
      admission={admission:frozen,snapshot};admissions.set(id,admission);
      await conversation.configure({model:{provider:selected.provider,modelId:selected.model}},context);
      await harness.commit(async tx=>stageEvidence(tx,id,prepared!),context);
      permitted.add(id);const startWatching=await watch(id);
      const submission=await conversation.submit({type:'input',content:evidencePrompt(prepared)+input.content,whenBusy:'reject',requestId:crypto.randomUUID(),entry:{kind:REQUEST_KIND,data:JSON.parse(JSON.stringify(snapshot))}},context);
      accepted=true;active.set(id,submission.id);requestEventsEnabled.add(id);
      const requestId=`pi-request-${submission.id}`;
      const userMessage=message(`pi-user-${submission.id}`,input.conversationId,'user',input.content,'completed',snapshot.createdAtMillis);
      userMessage.attachments=projectAttachments(input.attachments);
      const assistantMessage=message(`pi-assistant-${submission.id}`,input.conversationId,'assistant','','streaming',snapshot.createdAtMillis+1);assistantMessage.requestId=requestId;
      setTimeout(()=>{if(closing||active.get(id)!==submission.id)return;emit('chat://started',{requestId,conversationId:input.conversationId,messageId:assistantMessage.id,message:assistantMessage});startWatching();void watchEvidence(id,submission.id).catch(()=>{});
        void submission.wait(context).then(async receipt=>{
          if(active.get(id)!==submission.id)return;
          permitted.delete(id);
          await stopWatch(id);await releaseNativeRequest(frozen).catch(()=>{});await releaseEvidence(prepared!.sessionId).catch(()=>{});active.delete(id);admissions.delete(id);
          if(closing)return;
          transcripts?.schedule(input.conversationId);
          const conversation=await getConversation(input.conversationId);const final=conversation.messages.find(m=>m.id===assistantMessage.id)!;
          const identity={requestId,conversationId:input.conversationId,messageId:final.id,message:final};
          if(receipt.status==='done')emit('chat://completed',{...identity,conversation});
          else if(final.status==='cancelled')emit('chat://cancelled',identity);
          else emit('chat://failed',{...identity,error:final.errorMessage ?? 'Pi request failed',retryable:true});
        }).catch(async error=>{if(active.has(id)&&active.get(id)!==submission.id)return;active.delete(id);permitted.delete(id);admissions.delete(id);await stopWatch(id).catch(()=>{});await releaseNativeRequest(frozen).catch(()=>{});await releaseEvidence(prepared!.sessionId).catch(()=>{});if(!closing)emit('chat://failed',{requestId,conversationId:input.conversationId,messageId:assistantMessage.id,message:{...assistantMessage,status:'error',errorMessage:String(error)},error:String(error),retryable:true});});
      },0);
      return {requestId,conversationId:input.conversationId,userMessage,assistantMessage};
    } finally {
      admitting.delete(id);
      if(!accepted){permitted.delete(id);admissions.delete(id);await stopWatch(id);if(frozenRequest)await releaseNativeRequest(frozenRequest);if(prepared)await releaseEvidence(prepared.sessionId);}
    }
  };
  const sendMessage:ChatApi['sendMessage']=input=>submit(input);
  const displayPath=async(path:string)=>(await invoke<string[]>('pi_resolve_locations',{paths:[path]}))[0];
  const displayProposal=async(proposal:ChatAgentProposal)=>{const result=structuredClone(proposal);if(result.suggestedPath)result.suggestedPath=await displayPath(result.suggestedPath);for(const key of ['notePath','path'])if(typeof result.preview[key]==='string')result.preview[key]=await displayPath(result.preview[key] as string);return result;};
  const pending=async(conversationId:string) => {const {harness}=await open();const catalog=await harness.snapshot(Reviews,context);const proposals=[];
    for(const id of catalog?.ids ?? []) {const doc=await harness.snapshot(Review,String(id),context);if(doc?.proposalJson){const proposal=proposalOf(doc);if(proposal.conversationId===conversationId && unresolved(proposal))proposals.push(await displayProposal(proposal));}}return proposals;};
  const unavailable=(capability:string):never=>{throw new Error(`${capability} is unavailable in the Pi evaluation`);};
  const overrides:ChatApi={
    setDefaults:defaults=>native.setDefaults(defaults),
    setAtlasVisibility:visibility=>native.setAtlasVisibility(visibility),
    getComposerDraft:slot=>native.getComposerDraft(slot),
    setComposerDraft:(slot,body)=>native.setComposerDraft(slot,body),
    getKeyStatus:provider=>native.getKeyStatus(provider),
    setApiKey:(provider,key)=>native.setApiKey(provider,key),
    setLocalModelCapabilities:(model,capabilities)=>native.setLocalModelCapabilities(model,capabilities),
    listGrants:()=>native.listGrants(),grantNote:id=>native.grantNote(id),revokeNote:id=>native.revokeNote(id),
    setNoteExcluded:(id,title,excluded)=>native.setNoteExcluded(id,title,excluded),
    listNotePolicies:()=>native.listNotePolicies(),searchNotesForPolicy:(query,limit)=>native.searchNotesForPolicy(query,limit),
    branchFromMessage:async()=>unavailable('Branching'),createExcerpt:async()=>unavailable('Standalone excerpts'),
    rememberExcerpt:async()=>unavailable('Standalone excerpts'),unrememberExcerpt:async()=>unavailable('Standalone excerpts'),
    resolveProjectionConflict:async(id,resolution)=>{const status=await resolveTranscriptConflict(await loadTranscript(id),resolution);projectionStates.set(id,status);return getConversation(id);},decidePermission:async(identity,decision)=>{const current=active.get(cid(identity.conversationId));if(!current||identity.requestId!==`pi-request-${current}`||identity.messageId!==`pi-assistant-${current}`||identity.runId!==`pi-run-${current}`)throw new Error('Permission request is no longer active');return resolveEvidencePermission((await open()).harness,identity,decision);},
    getSettings,
    listLocalModels:async baseUrl=>fixture?['pi-native-fixture','pi-native-fixture-b'].map(id=>({id,ownedBy:'synthetic fixture'})):native.listLocalModels(baseUrl),
    listOpenAiModels:async()=>fixture?['pi-native-fixture','pi-native-fixture-b'].map(id=>({id,ownedBy:'synthetic fixture'})):native.listOpenAiModels(),
    getModelCapabilities:async(provider,model,baseUrl)=>{
      if(fixture&&!['pi-native-fixture','pi-native-fixture-b'].includes(model))throw new Error('Unknown synthetic fixture model');
      if(followonsFixture)return {images:true,audio:provider==='local',video:provider==='local',files:true,
        acceptedMimeTypes:['text/plain','image/png',...(provider==='local'?['audio/wav','video/mp4']:['application/pdf'])],tools:true,reasoningOptions:['off'],defaultReasoningEffort:'off'};
      return fixture?{images:false,audio:false,video:false,files:false,acceptedMimeTypes:[],tools:true,reasoningOptions:['off'],defaultReasoningEffort:'off'}:native.getModelCapabilities(provider,model,baseUrl);
    },
    createConversation:async input=>{const {harness,models}=await open();const settings=await getSettings();const provider=input?.provider ?? settings.provider;const model=input?.model ?? settings.model;models.registerModel(provider,model,await overrides.getModelCapabilities(provider,model,settings.localBaseUrl));const conversation=await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:input?.provider ?? settings.provider,modelId:input?.model ?? settings.model}}},context);
      await harness.commit(async tx=>{const meta=await tx.doc(Meta,conversation.id);meta.title=input?.title ?? 'Pi conversation';meta.reasoningEffort=input?.reasoningEffort ?? settings.reasoningEffort;(await tx.doc(Evidence,conversation.id)).access=input?.vaultAccess ?? settings.defaultVaultAccess;},context);
      return getConversation(`pi-${conversation.id}`);},
    listConversations:async includeArchived=>{const {storage,harness}=await open();const records=await scanAll(cursor=>storage.scanConversations({},128,cursor,context));const selected=[];for(const record of records)if(await harness.snapshot(Meta,record.id,context))selected.push(record);const items=await Promise.all(selected.map(r=>summary(r.id)));return items.filter(s=>includeArchived || s.status!=='archived');},
    getConversation,sendMessage,
    renameConversation:async(id,title)=>{const {harness}=await open();await harness.commit(async tx=>{(await tx.doc(Meta,cid(id))).title=title;},context);transcripts?.schedule(id);return summary(cid(id));},
    archiveConversation:async(id,archived)=>{const {harness}=await open();await harness.commit(async tx=>{(await tx.doc(Meta,cid(id))).archived=archived;},context);return null;},
    setConversationVaultAccess:async(id,access)=>{const {harness}=await open();await harness.commit(async tx=>{(await tx.doc(Evidence,cid(id))).access=access;},context);return summary(cid(id));},
    setConversationProvider:async(id,provider,model,reasoningEffort)=>{if(active.has(cid(id))||admitting.has(cid(id)))throw new Error('Stop the active request before changing models');const {harness,models}=await open();models.registerModel(provider,model,await overrides.getModelCapabilities(provider,model));await harness.commit(async tx=>{(await tx.doc(Meta,cid(id))).reasoningEffort=reasoningEffort;},context);await (await harness.conversation(cid(id),context))!.configure({model:{provider,modelId:model}},context);return summary(cid(id));},
    cancelRequest:async requestId=>{const {harness,storage}=await open();const record=await storage.submission(sid(requestId),context);if(!record||record.status==='done'||record.status==='unanswered')return;await (await harness.conversation(record.conversationId,context))!.abort(context);},
    retryMessage:async messageId=>{const {storage,harness}=await open();const record=await storage.submission(sid(messageId),context);if(!record || record.type!=='input')throw new Error('Unknown interrupted request');if(active.has(record.conversationId))throw new Error('Stop the active request before Retry');
      const entry=record.entry ? (await storage.entry(record.entry,context))?.entry : undefined;const snapshot=requestSnapshot(entry);if(!snapshot)throw new Error('Original admitted request context is unavailable; Retry is unsafe');
      if(record.status==='done')throw new Error('A completed answer cannot be retried');
      if(record.status==='placed'||record.status==='queued')await (await harness.conversation(record.conversationId,context))!.abort(context);
      return submit(structuredClone(snapshot.input),{snapshot,submissionId:record.id});},
    findConversationByProjectionPath:async path=>{const id=conversationFromOriginPath(path);return id && await (await open()).harness.conversation(cid(id),context)?id:null;},
    suggestContext:suggestPiContext,
    listPendingProposals:pending,
    prepareNoteSave:async(conversationId,messageId,selection,options)=>{
      const {harness,storage}=await open();const record=await storage.submission(sid(messageId),context);
      if(!record || record.conversationId!==cid(conversationId) || record.status!=='done' || !record.answer)throw new Error('Save requires an admitted completed message');
      const entry=(await storage.entry(record.answer,context))?.entry;
      const answer=entry?.byTaskId && await harness.snapshot(AdmittedAnswer,String(entry.byTaskId),context);
      if(!answer)throw new Error('The completed answer has no durable admission');
      return saveAnswer(harness,{conversationId,messageId,answer,selection,options,access:(await summary(cid(conversationId))).vaultAccess,grants:evidenceGrants(answer)});
    },
    getProposalDraft:async id=>{const draft=(await readReview((await open()).harness,id)).draft;return {...draft,path:await displayPath(draft.path)};},
    checkpointProposalDraft:async(id,draft,path)=>{const {harness}=await open();const current=await readReview(harness,id);return checkpointReview(harness,id,draft,path,(await summary(cid(current.proposal.conversationId))).vaultAccess);},
    commitAgentProposal:async(id,markdown,expectedVersion)=>{
      const receipt=await keepReview((await open()).harness,id,markdown,expectedVersion);
      if(!receipt.applied)return receipt;
      const applied={...receipt.applied};
      if(applied.path)applied.path=await displayPath(applied.path);
      if(applied.previousPath)applied.previousPath=await displayPath(applied.previousPath);
      return {...receipt,applied};
    },
    dismissAgentProposal:async id=>discardReview((await open()).harness,id),
    on:async(event,handler)=>{let set=listeners.get(event);if(!set){set=new Set();listeners.set(event,set);}const listener=handler as (payload:unknown)=>void;set.add(listener);return()=>{set!.delete(listener);};}
  };
  Object.assign(overrides,{prototypeCheckpoint:async(value:unknown)=>{const {UiProbe}=await import('./probe');const {harness}=await open();await harness.commit(async tx=>{Object.assign(await tx.doc(UiProbe),value);},context);}});
  Object.assign(overrides,{prototypeState:async()=>{const {UiProbe}=await import('./probe');return (await open()).harness.snapshot(UiProbe,context);}});
  Object.assign(overrides,{prototypeResolvePassage:async(conversationId:string,evidenceId:string)=>{
    const {harness}=await open();const current=await summary(cid(conversationId));const entries=await entriesFor(cid(conversationId));
    for(const entry of entries){const snapshot=requestSnapshot(entry);const origin=snapshot?.evidence && await harness.snapshot(EvidenceRun,snapshot.evidence.sessionId,context);
      const answer=entry.byTaskId && await harness.snapshot(AdmittedAnswer,String(entry.byTaskId),context);
      for(const binding of [origin,answer]){if(!binding)continue;const source=evidenceSources(binding).find(source=>source.passage?.id===evidenceId);if(source)return invoke('pi_resolve_passage',{source,access:current.vaultAccess,grants:evidenceGrants(binding)});}
    }
    throw new Error('Source was not issued to this conversation');
  }});
  Object.assign(overrides,{prototypeFault:async(id:string,fault:string)=>{if(!fixture)throw new Error('Synthetic fixture required');const {harness}=await open();const current=await readReview(harness,id);await harness.commit(async tx=>{(await tx.doc(Review,String(current.taskId),'')).fault=fault;},context);}});
  const cancelForPolicy=async()=>{permitted.clear();policies.clear();if(engine){const {harness}=await engine;await Promise.all([...active.keys()].map(async id=>{await (await harness.conversation(id as ConversationId,context))?.abort(context);}));}};
  policyCancellations.add(cancelForPolicy);
  let closePromise:Promise<void>|undefined;
  const close=async(retire=false)=>{
    if(closePromise)return closePromise;
    closing=true;
    closePromise=(async()=>{
      unsubscribeCommits?.();unsubscribeCommits=undefined;
      await Promise.all([...watched.keys()].map(stopWatch));
      await transcripts?.close();transcripts=undefined;projectionUnlisten?.();projectionUnlisten=undefined;
      if(engine)await (await engine).harness.close(context);
      for(const value of admissions.values()){await releaseNativeRequest(value.admission);if(value.snapshot.evidence)await releaseEvidence(value.snapshot.evidence.sessionId);}
      admissions.clear();permitted.clear();policies.clear();active.clear();engine=undefined;
      if(retire){listeners.clear();liveApis.delete(quiesce);policyCancellations.delete(cancelForPolicy);}
    })();
    try{await closePromise;}finally{closePromise=undefined;if(!retire)closing=false;}
  };
  const quiesce=()=>close();
  liveApis.add(quiesce);
  Object.assign(overrides,{prototypeClose:()=>close(true)});
  return overrides;
}
