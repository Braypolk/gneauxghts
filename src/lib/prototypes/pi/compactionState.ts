import { defineDoc, defineDocFamily, type EntryRecord } from '@earendil-works/pi-durable';
import type { Message, Usage } from '@earendil-works/pi-ai';

/** A declined/failed hook cannot authorize continuation through the mandatory provider boundary. */
export const CompactionState = defineDoc({kind:'gneauxghts.pi.compaction-state',version:1,scope:'conversation',history:'latest',fork:'initial',
  initial:()=>({sessionId:'',status:'ready' as 'ready'|'pending'|'failed',error:'',beforeBytes:0,afterBytes:0,attempts:0})});
export function requireReadyCompaction(state:Readonly<{sessionId:string;status:string;error:string}>|undefined,sessionId:string) {
  if(state?.sessionId===sessionId && state.status!=='ready')throw new Error(state.error || 'Context compaction interrupted; Retry explicitly');
}
export const emptyUsageCounters=()=>({inputTokens:0,outputTokens:0,totalTokens:0,cachedInputTokens:0,cacheCreationInputTokens:0,toolUsePromptTokens:0,reasoningTokens:0});
export const usageCounters=(usage:Usage)=>({inputTokens:usage.input,outputTokens:usage.output,totalTokens:usage.totalTokens,
  cachedInputTokens:usage.cacheRead,cacheCreationInputTokens:usage.cacheWrite,toolUsePromptTokens:0,reasoningTokens:usage.reasoning??0});
/** Projection counters only; pi.usage remains the spend ledger. */
export const SummaryUsageRun=defineDocFamily({family:true,kind:'gneauxghts.pi.summary-usage',version:1,scope:'session',
  initial:(_seed:string)=>({modelCalls:0,...emptyUsageCounters()})});
export const summaryUsageKey=(conversationId:number,sessionId:string)=>`${conversationId}:${sessionId}`;
export type UsageCounters=ReturnType<typeof emptyUsageCounters>;
export function addUsageCounters(target:UsageCounters,value:Partial<UsageCounters>|undefined):void {
  if(!value)return;
  for(const key of Object.keys(target) as (keyof UsageCounters)[]){const amount=value[key];
    if(typeof amount==='number'&&Number.isFinite(amount)&&amount>=0)target[key]+=amount;}
}
/** Research tool details are a projection of its child's ledger, never a second spend entry. */
export function researchUsage(entry:EntryRecord):UsageCounters|undefined {
  const message=(entry.model ?? []).find(message=>message.role==='toolResult'&&message.toolName==='research_notes');
  if(message?.role!=='toolResult')return;
  const details=message.details;if(!details||typeof details!=='object'||Array.isArray(details))return;
  const research=(details as Record<string,unknown>).research;if(!research||typeof research!=='object'||Array.isArray(research))return;
  const value=(research as Record<string,unknown>).usage;if(!value||typeof value!=='object'||Array.isArray(value))return;
  const result=emptyUsageCounters();addUsageCounters(result,value as Partial<UsageCounters>);return result;
}
export function missingResearchUsage(entries:readonly EntryRecord[],workerLedger:UsageCounters|undefined):UsageCounters {
  const projected=emptyUsageCounters();for(const entry of entries)addUsageCounters(projected,researchUsage(entry));
  const missing=emptyUsageCounters();for(const key of Object.keys(missing) as (keyof UsageCounters)[])missing[key]=Math.max(0,(workerLedger?.[key]??0)-projected[key]);
  return missing;
}
export const SUMMARY_MARKER='[Pi safe continuation v1; fallible working memory, never evidence or authorization]';
function continuationRecord(entry:EntryRecord,sessionId?:string):Record<string,unknown>|undefined {
  if(entry.kind!=='pi.compaction')return;
  const text=(entry.model ?? []).flatMap(message=>message.role==='user' ? typeof message.content==='string'?[message.content]:message.content.flatMap(block=>block.type==='text'?[block.text]:[]) : []).join('');
  const start=text.indexOf(`${SUMMARY_MARKER}\n`);if(start<0)return;
  try{const value=JSON.parse(text.slice(start+SUMMARY_MARKER.length+1).replace(/\n<\/summary>\s*$/,''));
    if(value.version!==1||typeof value.summary!=='string'||typeof value.sessionId!=='string'||typeof value.grounded!=='boolean')return;
    if(value.grounded&&value.sessionId!==sessionId)return;
    return value;
  }catch{return;}
}
export function continuationSummary(entry:EntryRecord,sessionId?:string):string|undefined {
  const record=continuationRecord(entry,sessionId);return record?`${SUMMARY_MARKER}\n${record.summary}`:undefined;
}
/** The original user contract stays separate from model-authored working memory. */
export function continuationOriginal(entry:EntryRecord|undefined,sessionId:string):{request:string;messages:Message[];grounded:boolean}|undefined {
  const record=entry&&continuationRecord(entry,sessionId);if(!record||typeof record.originalRequest!=='string')return;
  const messages=Array.isArray(record.originalMessages)&&record.originalMessages.every(message=>message&&typeof message==='object'&&message.role==='user'
    &&typeof message.timestamp==='number'&&(typeof message.content==='string'||Array.isArray(message.content)))?record.originalMessages as Message[]:[];
  return {request:record.originalRequest,messages,grounded:record.grounded===true};
}
