// Fixture-only native SQLite/Harness scale preparation. No lifecycle SQL writes,
// provider transport or invented identities. This is an engine-scale probe;
// product ChatApi/Meta/review/evidence paging remains separate acceptance.
import { invoke } from '@tauri-apps/api/core';
import { Harness, createRegistry, defineDoc, type ConversationId, type Storage } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { openNativeSqlite } from './nativeSqlite';
import { closePiChatApis } from './chatApi';
import { scanAll } from './lifecycle';

const Scale = defineDoc({kind:'gneauxghts.fixture.native-scale',version:1,scope:'session',
  initial:()=>({conversations:0,submissions:0,longConversation:0,complete:false as boolean})});
const text = (value: unknown): string => typeof value==='string' ? value : Array.isArray(value)
  ? value.filter(block=>block.type==='text').map(block=>block.text).join('') : '';
function requireScale(value: unknown, message: string): asserts value {if(!value)throw new Error(message);}

export async function inspectScale(harness: Harness, storage: Storage, expectedConversations: number, expectedSubmissions: number, longConversation: ConversationId) {
  const conversations=await scanAll(cursor=>storage.scanConversations({},128,cursor,context));
  const submissions=await scanAll(cursor=>storage.scanSubmissions({conversationId:longConversation},128,cursor,context));
  const entries=await scanAll(cursor=>storage.scanEntries({conversationId:longConversation,order:'ascending'},128,cursor,context));
  const users=entries.flatMap(entry=>entry.model??[]).filter(message=>message.role==='user');
  const assistants=entries.flatMap(entry=>entry.model??[]).filter(message=>message.role==='assistant');
  requireScale(conversations.length===expectedConversations,'Native conversation scan truncated');
  requireScale(submissions.filter(row=>row.type==='input').length===expectedSubmissions,'Native submission scan truncated');
  requireScale(users.length===expectedSubmissions&&assistants.length===expectedSubmissions,'Committed native message totals differ');
  const positions=[0,Math.floor(expectedSubmissions/2),expectedSubmissions-1];
  for(const index of positions){
    requireScale(text(users[index].content)===`Synthetic scale input ${index}.`,'Native early/middle/late input missing');
    requireScale(text(assistants[index].content)===`Synthetic scale reply ${index}.`,'Native early/middle/late answer missing');
  }
  for(const record of [conversations[0],conversations[Math.floor(conversations.length/2)],conversations.at(-1)!])
    requireScale(await harness.conversation(record.id,context),'Native conversation navigation missing');
  const sessionDocuments=await scanAll(cursor=>storage.scanDocuments({scope:{kind:'session'},at:'current'},128,cursor,context));
  const longConversationDocuments=await scanAll(cursor=>storage.scanDocuments({scope:{kind:'conversation',conversationId:longConversation},at:'current'},128,cursor,context));
  return {conversations:conversations.length,submissions:submissions.length,messages:users.length+assistants.length,
    sessionDocuments:sessionDocuments.length,longConversationDocuments:longConversationDocuments.length,allDocuments:null,
    earlyMiddleLateVerified:true,provider:'faux-no-native-network',productParity:false};
}

export async function seedScale(harness: Harness, storage: Storage, setReply: (text: string)=>void, conversations=1005, submissions=1005) {
  requireScale(Number.isInteger(conversations)&&conversations>=1&&conversations<=1100,'Invalid bounded conversation count');
  requireScale(Number.isInteger(submissions)&&submissions>=1&&submissions<=1100,'Invalid bounded submission count');
  requireScale(!(await storage.scanConversations({},1,undefined,context)).items.length,'Scale seeding requires fresh empty generated storage');
  let longConversation: ConversationId|undefined;
  for(let index=0;index<conversations;index++){
    const conversation=await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},context);
    longConversation??=conversation.id;
  }
  const conversation=await harness.conversation(longConversation!,context);requireScale(conversation,'Scale conversation absent');
  for(let index=0;index<submissions;index++){
    setReply(`Synthetic scale reply ${index}.`);
    const submitted=await conversation.submit({type:'input',content:`Synthetic scale input ${index}.`},context);
    requireScale((await submitted.wait(context)).status==='done','Native scale turn failed');
  }
  await harness.commit(async tx=>{const marker=await tx.doc(Scale);marker.conversations=conversations;marker.submissions=submissions;marker.longConversation=longConversation!;marker.complete=true;},context);
  return inspectScale(harness,storage,conversations,submissions,longConversation!);
}

export async function nativeScaleProbe(action:'seed'|'verify'='seed',conversations=1005,submissions=1005) {
  const config=await invoke<{fixture:boolean}>('pi_probe_config');requireScale(config.fixture,'Scale probe requires explicit generated native fixture mode');
  requireScale(action==='seed'||action==='verify','Invalid scale action');
  await closePiChatApis();
  const models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);
  const storage=await SqliteStorage.open(await openNativeSqlite());
  let harness:Harness|undefined;
  try {
    harness=await Harness.open(storage,{models,registry:createRegistry(),settings:{retry:{enabled:false,maxRetries:0},compaction:{enabled:false}}},context);
    if(action==='seed')return await seedScale(harness,storage,reply=>faux.setResponses([fauxAssistantMessage(reply)]),conversations,submissions);
    const marker=await harness.snapshot(Scale,context);requireScale(marker?.complete,'No completed native scale fixture');
    const observed=await inspectScale(harness,storage,marker.conversations,marker.submissions,marker.longConversation as ConversationId);
    requireScale(faux.state.callCount===0,'Scale reopen implicitly executed provider work');
    return {...observed,noImplicitProviderReplay:true};
  } finally {if(harness)await harness.close(context);else await storage.close(context);}
}
