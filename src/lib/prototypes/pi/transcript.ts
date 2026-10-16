import { invoke } from '@tauri-apps/api/core';
import type { EntryRecord, SubmissionRecord } from '@earendil-works/pi-durable';
import type { ChatReadSource } from '$lib/features/chat/types';
import { requestSnapshot } from './lifecycle';
import { originProjectionPath } from './save';

export type TranscriptSnapshot = {
  conversationId: string;
  title: string;
  createdAtMillis: number;
  messages: Array<{ id: string; role: 'user' | 'assistant'; status: string; content: string;
    sources: ChatReadSource[]; attachments: Array<{name:string;mimeType:string}> }>;
  settledOrigins: Array<{messageId:string;noteId:string}>;
};
export type TranscriptStatus = { projectionPath:string; detached:boolean;
  conflict:'edited'|'missing'|'occupied'|null; warning:string|null; convertedPath?:string|null };
const textOf = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter(block => block?.type === 'text').map(block => block.text).join('') : '';

/** Projection reads only acknowledged Pi entries. LiveDoc may contain provisional deltas. */
export function buildTranscriptSnapshot(input: {
  conversationId:string; title:string; createdAtMillis:number;
  entries:readonly EntryRecord[]; submissions:readonly SubmissionRecord[];
  answers:ReadonlyMap<number,{text:string;sourcesJson:string}>;
  structuredSubmissions?:ReadonlySet<number>;
  settledOrigins?:readonly {messageId:string;noteId:string}[];
}):TranscriptSnapshot {
  originProjectionPath(input.conversationId);
  const records=input.submissions.filter(record=>record.type==='input' && record.entry)
    .sort((a,b)=>Number(a.entry)-Number(b.entry));
  const entries=new Map(input.entries.map(entry=>[entry.id,entry]));
  const orderedEntries=[...input.entries].sort((a,b)=>Number(a.id)-Number(b.id));
  let offset=0;
  const messages:TranscriptSnapshot['messages']=[];
  for(let i=0;i<records.length;i++) {
    const record=records[i],entry=record.entry && entries.get(record.entry);
    if(!entry)continue;
    const request=requestSnapshot(entry);
    messages.push({id:`pi-user-${record.id}`,role:'user',status:'completed',
      content:request?.input.content ?? textOf(entry.model?.find(item=>item.role==='user')?.content),sources:[],
      attachments:(request?.input.attachments ?? []).map(attachment=>({name:attachment.name,mimeType:attachment.mimeType}))});
    const answer=record.status==='done' && record.answer ? entries.get(record.answer) : undefined;
    const admitted=answer?.byTaskId ? input.answers.get(answer.byTaskId) : undefined;
    const structured=input.structuredSubmissions?.has(record.id)
      || request?.evidence?.context.some(item=>item.kind==='selected_excerpt');
    const next=records[i+1]?.entry;
    while(offset<orderedEntries.length && orderedEntries[offset].id<=entry.id)offset++;
    let partial:{content:unknown}|undefined;
    while(offset<orderedEntries.length && (!next || orderedEntries[offset].id<next)) {
      for(const item of orderedEntries[offset].model ?? [])if(item.role==='assistant')partial=item;
      offset++;
    }
    // A completed structured answer is publishable only through its admitted doc.
    const content=admitted?.text ?? (structured ? '' : textOf(answer?.model?.find(item=>item.role==='assistant')?.content ?? partial?.content));
    messages.push({id:`pi-assistant-${record.id}`,role:'assistant',
      status:record.status==='done'?'completed':record.status==='unanswered' && record.reason==='aborted'?'cancelled':record.status==='placed'?'pending':'error',
      content,sources:admitted ? JSON.parse(admitted.sourcesJson || '[]') : [],attachments:[]});
  }
  return {conversationId:input.conversationId,title:input.title,createdAtMillis:input.createdAtMillis,messages,
    settledOrigins:input.settledOrigins?.map(origin=>({...origin})) ?? []};
}
export const publishTranscript=(snapshot:TranscriptSnapshot)=>invoke<TranscriptStatus>('pi_publish_transcript',{snapshot});
export const transcriptStatus=(conversationId:string)=>invoke<TranscriptStatus>('pi_transcript_status',{conversationId});
export const resolveTranscriptConflict=(snapshot:TranscriptSnapshot,action:'convertToNote'|'restoreTranscript')=>
  invoke<TranscriptStatus>('pi_resolve_transcript_conflict',{snapshot,action});

/** Each publication loads the latest committed state after the preceding one settles.
 * Failures remain projection warnings and cannot reject the operation that committed Pi state. */
export function createTranscriptPublisher(load:(id:string)=>Promise<TranscriptSnapshot>,onStatus?:(id:string,status:TranscriptStatus)=>void) {
  const dirty=new Set<string>();
  let running:Promise<void>|undefined,closed=false;
  const run=async()=>{
    while(dirty.size) {
      const id=dirty.values().next().value!;dirty.delete(id);
      try {const status=await publishTranscript(await load(id));onStatus?.(id,status);}
      catch(error) {onStatus?.(id,{projectionPath:originProjectionPath(id),detached:false,conflict:null,
        warning:`Transcript publication needs retry: ${String(error)}`});}
    }
  };
  const start=()=>{if(!running)running=run().finally(()=>{running=undefined;if(dirty.size)start();});};
  return {
    schedule(id:string){if(closed)return;originProjectionPath(id);dirty.add(id);start();},
    async flush(){while(running)await running;},
    async close(){closed=true;while(running)await running;}
  };
}
