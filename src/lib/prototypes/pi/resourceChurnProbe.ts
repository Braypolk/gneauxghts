import type {ChatApi} from '$lib/features/chat/api';
import {readPiChatResourceSnapshot} from './chatApi';

type Snapshot=Awaited<ReturnType<typeof readPiChatResourceSnapshot>>;
const requireValue=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
export function assertOwnedResourcePlateau(before:Snapshot,after:Snapshot) {
  requireValue(JSON.stringify(before)===JSON.stringify(after),'App-owned resources did not return to the acknowledged baseline');
}

/** Actual public API subscriptions and the real controller class; no private runtime inspection. */
export async function runResourceChurnProbe(api:ChatApi,ids:string[],cycles=20,
  snapshot:()=>Promise<Snapshot>=readPiChatResourceSnapshot,navigate?:(id:string)=>Promise<unknown>) {
  requireValue(ids.length===3&&new Set(ids).size===3,'Exactly three distinct generated chats required');
  requireValue(cycles===20,'The fixed workload is twenty cycles');
  const original=await Promise.all(ids.map(id=>api.getConversation(id)));
  requireValue(original.every(chat=>!chat.activeRequestId),'Churn requires settled conversations');
  const identity=original.map(chat=>({id:chat.id,messages:chat.messages.map(row=>({id:row.id,content:row.content,status:row.status}))}));
  const pending=await Promise.all(ids.map(id=>api.listPendingProposals(id)));
  // Warm reads may populate ordinary per-conversation projections. Baseline is
  // acknowledged only after those reads, so we test repeated-use growth.
  const before=await snapshot(),samples=[];
  let unexpectedCallbacks=0;
  for(let cycle=0;cycle<cycles;cycle++){
    const stops=[] as Array<()=>void>;
    try{
      for(const event of ['chat://completed','chat://failed','chat://cancelled'] as const)
        stops.push(await api.on(event,()=>{unexpectedCallbacks++;}));
      const attached=await snapshot();
      requireValue(attached.owners.reduce((sum,row)=>sum+row.listeners,0)===before.owners.reduce((sum,row)=>sum+row.listeners,0)+3,'Actual API callbacks were not observed');
      for(const id of ids){await navigate?.(id);requireValue((await api.getConversation(id)).id===id,'Churn changed selected conversation identity');}
    }finally{for(const stop of stops.reverse())stop();}
    const settled=await snapshot();assertOwnedResourcePlateau(before,settled);samples.push({cycle:cycle+1,snapshot:settled});
  }
  requireValue(unexpectedCallbacks===0,'Read-only churn unexpectedly emitted terminal callbacks');
  const restored=await Promise.all(ids.map(id=>api.getConversation(id)));
  requireValue(JSON.stringify(restored.map(chat=>({id:chat.id,messages:chat.messages.map(row=>({id:row.id,content:row.content,status:row.status}))})))===JSON.stringify(identity),'Churn changed committed history');
  requireValue(JSON.stringify(await Promise.all(ids.map(id=>api.listPendingProposals(id))))===JSON.stringify(pending),'Churn changed pending reviews');
  const after=await snapshot();assertOwnedResourcePlateau(before,after);
  return {cycles,conversationCount:ids.length,before,after,samples,unexpectedCallbacks,
    historyAndPendingReviewsUnchanged:true,mountedNavigationObserved:navigate!==undefined,controllerDisposalObserved:false,
    coverage:'actual-public-api-subscribe-read-unsubscribe',
    limits:['No mounted controller disposal or upstream tracker/cache/lease counts are inferred.','Archive retains history; no application retirement/collection policy exists.']};
}
