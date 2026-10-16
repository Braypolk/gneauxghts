// Generated-fixture product acceptance preparation. All conversation/turn writes
// use ChatApi; the separate engine-only scaleProbe is not product acceptance.
import type { ChatApi } from '$lib/features/chat/api';
import type { ChatConversation } from '$lib/features/chat/types';

export const productScaleTitle = (index:number) => `Synthetic product scale ${String(index).padStart(4,'0')}`;
export const productScaleInput = (index:number) => `PRODUCT_SCALE_INPUT_${index}.`;
export const productScaleReply = (index:number) => `Synthetic product scale reply ${index}.`;
function requireValue(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
export interface ProductScaleIdentity { conversations:string[]; messages:string[]; submissions:number }
export interface ProductScaleProgress { phase:string; conversations:number; submissions:number; probeListeners:number }
type Progress = (value:ProductScaleProgress)=>void;
const positions = (length:number) => [...new Set([0,Math.floor(length/2),length-1])];

function checkHistory(chat:ChatConversation,submissions:number,expectedIds?:string[]) {
  requireValue(!chat.activeRequestId,'Product history has unfinished work');
  requireValue(chat.messages.length===submissions*2,'Product history count truncated or expanded');
  requireValue(new Set(chat.messages.map(row=>row.id)).size===chat.messages.length,'Duplicate product message identity');
  // Check every position, not just three examples: missing rows must not be
  // hidden by a coincidentally correct count or a rebuilt tail.
  for(let index=0;index<submissions;index++){
    const user=chat.messages[index*2],assistant=chat.messages[index*2+1];
    requireValue(user.role==='user'&&user.content===productScaleInput(index),'Product input order/content differs');
    requireValue(assistant.role==='assistant'&&assistant.status==='completed'&&assistant.content===productScaleReply(index),'Product answer order/content differs');
  }
  if(expectedIds)requireValue(chat.messages.every((row,index)=>row.id===expectedIds[index]),'Product message identity changed across restart');
}

export async function verifyProductScale(api:ChatApi,identity:ProductScaleIdentity) {
  requireValue(identity.conversations.length>0&&identity.submissions>0,'Empty product scale identity');
  requireValue(new Set(identity.conversations).size===identity.conversations.length,'Duplicate expected conversation identity');
  const started=performance.now(),listed=await api.listConversations(true);
  requireValue(listed.length===identity.conversations.length,'Product list count truncated or expanded');
  requireValue(new Set(listed.map(row=>row.id)).size===listed.length,'Duplicate listed conversation identity');
  const byId=new Map(listed.map(row=>[row.id,row]));
  identity.conversations.forEach((id,index)=>{
    const row=byId.get(id);requireValue(row?.title===productScaleTitle(index),'Product Meta title/identity missing');
    requireValue(row.messageCount===(index===0?identity.submissions*2:0),'Product summary message count differs');
  });
  const listMillis=performance.now()-started,navigation=[];
  for(const index of positions(identity.conversations.length)){
    const at=performance.now(),chat=await api.getConversation(identity.conversations[index]);
    requireValue(chat.id===identity.conversations[index]&&chat.title===productScaleTitle(index),'Product early/middle/late navigation differs');
    if(index===0)checkHistory(chat,identity.submissions,identity.messages.length?identity.messages:undefined);
    else requireValue(chat.messages.length===0&&!chat.activeRequestId,'Empty product conversation changed');
    navigation.push({index,millis:performance.now()-at,messageCount:chat.messages.length});
  }
  return {conversations:listed.length,submissions:identity.submissions,messages:identity.submissions*2,listMillis,navigation,
    checkedHistoryPositions:positions(identity.submissions),allHistoryPositionsVerified:true,allMetaIdentitiesVerified:true,
    publicPagination:'aggregate-only-no-cursor-argument',productParity:false};
}

export async function seedProductScale(api:ChatApi,conversations=1005,submissions=1005,progress:Progress=()=>{}) {
  requireValue(Number.isInteger(conversations)&&conversations>=1&&conversations<=1100,'Invalid bounded conversation count');
  requireValue(Number.isInteger(submissions)&&submissions>=1&&submissions<=1100,'Invalid bounded submission count');
  requireValue((await api.listConversations(true)).length===0,'Product scale requires fresh empty generated storage');
  const identity:ProductScaleIdentity={conversations:[],messages:[],submissions};
  for(let index=0;index<conversations;index++){
    const chat=await api.createConversation({title:productScaleTitle(index),provider:'local',model:'pi-native-fixture',reasoningEffort:'off',vaultAccess:'none'});
    identity.conversations.push(chat.id);
    if(index%25===0||index===conversations-1)progress({phase:'create',conversations:index+1,submissions:0,probeListeners:0});
  }
  // Subscribe once per batch and retain only the current correlated terminal.
  // Events can arrive before sendMessage resolves; the small buffer covers that
  // race. No application-private listener/watch map is inferred from this count.
  let listeners=0;
  const terminals=new Map<string,string>(),pending=new Map<string,(status:string)=>void>(),unlisten:(()=>void)[]=[];
  try{
    for(const event of ['chat://completed','chat://cancelled','chat://failed'] as const){
      const stop=await api.on(event,payload=>{const status=event==='chat://completed'?'completed':'failed';
        const waiter=pending.get(payload.requestId);if(waiter){pending.delete(payload.requestId);waiter(status)}else terminals.set(payload.requestId,status);});
      listeners++;unlisten.push(()=>{stop();listeners--;});
    }
    for(let index=0;index<submissions;index++){
      const receipt=await api.sendMessage({conversationId:identity.conversations[0],content:productScaleInput(index)});
      const status=terminals.get(receipt.requestId)??await new Promise<string>((ok,fail)=>{
        const timer=setTimeout(()=>{pending.delete(receipt.requestId);fail(new Error('Product terminal deadline'));},60000);
        pending.set(receipt.requestId,value=>{clearTimeout(timer);ok(value)});
      });
      terminals.delete(receipt.requestId);
      requireValue(status==='completed','Product scale turn did not complete');
      requireValue(receipt.assistantMessage,'Product receipt has no assistant identity');
      identity.messages.push(receipt.userMessage.id,receipt.assistantMessage.id);
      if(index%25===0||index===submissions-1)progress({phase:'submit',conversations,submissions:index+1,probeListeners:listeners});
    }
  }finally{for(const stop of unlisten.reverse())stop();pending.clear();terminals.clear();progress({phase:'settled',conversations:identity.conversations.length,submissions:identity.messages.length/2,probeListeners:listeners});}
  const verified=await verifyProductScale(api,identity);
  return {identity,verified,probeListenersAfter: listeners,privateListeners:null,privateWatchers:null};
}

export async function checkProductArchive(api:ChatApi,identity:ProductScaleIdentity) {
  const ids=identity.conversations.slice(1,11);
  for(const id of ids)await api.archiveConversation(id,true,1);
  requireValue((await api.listConversations()).length===identity.conversations.length-ids.length,'Archived product list differs');
  requireValue((await api.listConversations(true)).length===identity.conversations.length,'Archive removed retained history');
  for(const id of ids)await api.archiveConversation(id,false,1);
  await verifyProductScale(api,identity);
  return {archivedAndRestored:ids.length,retirement:null,collection:null,meaning:'public archive hides/restores; retained storage is not collection proof'};
}

export async function nativeProductScaleApi() {
  const {invoke}=await import('@tauri-apps/api/core');
  requireValue((await invoke<{fixture:boolean}>('pi_probe_config')).fixture,'Explicit generated native fixture required');
  return (await import('$lib/features/chat/api')).chatApi;
}

// Run only after product checks and before process shutdown. Closing the product
// owner joins its queues; this opens one storage facade for definition-free scans
// and never constructs a second Harness or seeds a row. Current scoped documents
// are counted exactly; historical/retired/collected rows remain unknown.
export async function countClosedProductStore() {
  const {invoke}=await import('@tauri-apps/api/core');
  requireValue((await invoke<{fixture:boolean}>('pi_probe_config')).fixture,'Explicit generated native fixture required');
  const [{closePiChatApis},{SqliteStorage},{openNativeSqlite},{scanAll},{BACKGROUND_CONTEXT:context}]=await Promise.all([
    import('./chatApi'),import('@earendil-works/pi-durable/storage/sqlite'),import('./nativeSqlite'),import('./lifecycle'),import('@earendil-works/chord/context')]);
  await closePiChatApis();
  const storage=await SqliteStorage.open(await openNativeSqlite());
  try{
    const conversations=await scanAll(cursor=>storage.scanConversations({},128,cursor,context));
    const tasks=await scanAll(cursor=>storage.scanTasks({},128,cursor,context));
    const submissions=await scanAll(cursor=>storage.scanSubmissions({},128,cursor,context));
    let currentDocuments=0,keyedCurrentDocuments=0,metaDocuments=0;const kinds=new Set<string>();
    const scopes=[{kind:'session'} as const,...conversations.map(row=>({kind:'conversation' as const,conversationId:row.id})),...tasks.map(row=>({kind:'task' as const,taskId:row.id}))];
    for(const scope of scopes){const docs=await scanAll(cursor=>storage.scanDocuments({scope,at:'current'},128,cursor,context));
      currentDocuments+=docs.length;for(const doc of docs){kinds.add(doc.kind);if(doc.key!==undefined)keyedCurrentDocuments++;if(doc.kind==='gneauxghts.pi.chat-presentation')metaDocuments++;}}
    return {conversations:conversations.length,tasks:tasks.length,inputSubmissions:submissions.filter(row=>row.type==='input').length,
      currentDocuments,keyedCurrentDocuments,currentDocumentKinds:kinds.size,metaDocuments,scopesScanned:scopes.length,pageSize:128,
      retiredDocuments:null,collectedDocuments:null,historicalVersions:null,privateWatchers:null,privateListeners:null};
  }finally{await storage.close(context);}
}
