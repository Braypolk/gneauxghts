import { invoke } from '@tauri-apps/api/core';
import { defineDoc, defineDocFamily, defineTask, defineExtension, defineTool, type Harness, type ConversationId, type TaskId, type Tx } from '@earendil-works/pi-durable';
import { Evidence } from './notesExtension';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context, awaitWithContext } from '@earendil-works/chord/context';
import type { ChatAgentProposal, ChatProposalDraft, VaultAccess } from '$lib/features/chat/types';
import type { CommitNoteReviewResult } from '$lib/types/proposals';

export const Reviews = defineDoc({kind:'gneauxghts.pi.reviews',version:1,scope:'session',initial:() => ({ids:[] as number[],origins:{} as Record<string,number>})});
export const Review = defineDocFamily({family:true,kind:'gneauxghts.pi.review',version:1,scope:'session',initial:(_seed:string) => ({
  proposalJson:'',draftJson:'',decision:'pending',acceptedJson:'',receiptJson:'',receiptVersion:0,fault:''
})});
export const proposalOf = (value:{proposalJson:string}): ChatAgentProposal => JSON.parse(value.proposalJson);
export const draftOf = (value:{draftJson:string}): ChatProposalDraft => JSON.parse(value.draftJson);

export const ReviewTask = defineTask<null,{phase:'review';revision:number},string>({
  name:'gneauxghts.pi.review',version:1,initial:() => ({phase:'review',revision:0}),
  phases:{review:async (task,runtime,callContext) => {
    const watch = await runtime.watchDoc(Review,String(task.id),callContext);
    if(!watch) throw new Error('Missing durable review');
    const decision = Promise.withResolvers<NonNullable<typeof watch.value>>();
    const choose = (value:typeof watch.value) => {if(value && value.decision !== 'pending') decision.resolve(value);};
    watch.start(async value => {choose(value);}); choose(watch.value);
    let chosen;
    try {chosen = await awaitWithContext(decision.promise,callContext);} finally {await watch.stop();}
    if(chosen.decision === 'discard') {
      await runtime.commit(async tx => {const doc=await tx.doc(Review,String(task.id),'');const proposal=proposalOf(doc);
        proposal.status='dismissed';doc.proposalJson=JSON.stringify(proposal);
        return {status:'terminal',outcome:{status:'completed',result:'discarded'}};
      },callContext);return;
    }
    const accepted=JSON.parse(chosen.acceptedJson);
    let receipt:CommitNoteReviewResult;
    try {receipt=await invoke('pi_publish_review',{accepted,currentAccess:(await runtime.snapshot(Evidence,task.conversationId!,callContext))?.access ?? 'none',fault:chosen.fault || null});}
    catch(error) {receipt={status:'conflict',applied:null,noteId:null,committedMarkdown:null,message:String(error)};}
    let refreshed:Partial<ChatAgentProposal>|undefined;
    if(receipt.status==='conflict') {
      try {refreshed=await invoke('pi_prepare_review',{title:accepted.title,markdown:accepted.markdown,
        noteId:accepted.noteId,access:accepted.access,path:accepted.kind==='create'?undefined:accepted.path});} catch { /* Keep the existing edited draft. */ }
    }
    await runtime.commit(async tx => {const doc=await tx.doc(Review,String(task.id),'');const proposal=proposalOf(doc);const draft=draftOf(doc);
      doc.receiptJson=JSON.stringify(receipt);doc.receiptVersion=accepted.version;
      if(receipt.status==='committed') {
        proposal.status='committed';proposal.payload={...proposal.payload,committedNoteId:receipt.noteId,committedPath:receipt.applied?.path};doc.proposalJson=JSON.stringify(proposal);
        return {status:'terminal',outcome:{status:'completed',result:doc.receiptJson}};
      }
      Object.assign(proposal,refreshed,{status:'conflict'});draft.version++;draft.path=proposal.suggestedPath ?? draft.path;
      doc.proposalJson=JSON.stringify(proposal);doc.draftJson=JSON.stringify(draft);doc.decision='pending';doc.acceptedJson='';doc.fault='';
      return {status:'running',checkpoint:{phase:'review',revision:task.state.checkpoint.revision+1}};
    },callContext);
  }},
  abort:async (task,runtime,callContext) => {await runtime.commit(async tx => {
    const doc=await tx.doc(Review,String(task.id),'');const proposal=proposalOf(doc);proposal.status='dismissed';doc.proposalJson=JSON.stringify(proposal);
    return {status:'terminal',outcome:{status:'aborted',reason:'Review explicitly cancelled'}};
  },callContext);}
});

export async function stageReview(tx:Tx, conversationId:ConversationId, prepared:Partial<ChatAgentProposal>,
  assistantMessageId:string, origin:string) {
  const catalog=await tx.doc(Reviews);
  if(catalog.origins[origin]) return catalog.origins[origin] as TaskId<string>;
  const taskId=await tx.createTask(ReviewTask,null,{ownership:{kind:'conversation'},conversationId,background:true});
  const proposal={...prepared,id:`pi-review-${taskId}`,conversationId:`pi-${conversationId}`,assistantMessageId,runId:null,
    status:'pending',createdAtMillis:Date.now(),updatedAtMillis:Date.now()} as ChatAgentProposal;
  const draft:ChatProposalDraft={version:1,markdown:String(proposal.payload.markdown),title:proposal.title,path:proposal.suggestedPath!,decisions:[]};
  const doc=await tx.doc(Review,String(taskId),'');doc.proposalJson=JSON.stringify(proposal);doc.draftJson=JSON.stringify(draft);
  catalog.ids.push(taskId);catalog.origins[origin]=taskId;
  return taskId;
}

export function reviewExtension(access: (conversationId:number) => Promise<VaultAccess>, messageId: (conversationId:number) => string) {
  return defineExtension({name:'gneauxghts.review',tasks:[ReviewTask],tools:[defineTool({
    name:'propose_note',description:'Stage a complete note create/update for editable human review. Only Keep publishes. Staging is not saving.',
    parameters:Type.Object({title:Type.String(),markdown:Type.String(),noteId:Type.Optional(Type.String())}),replay:'safe',
    execute:async (input,api,callContext) => {
      const prepared=await invoke<Partial<ChatAgentProposal>>('pi_prepare_review',{...input,noteId:input.noteId ?? null,access:await access(api.conversationId)});
      let id=0;await api.commit(async tx => {id=await stageReview(tx,api.conversationId,prepared,messageId(api.conversationId),`tool:${api.taskId}:${api.callId}`);},callContext);
      return {output:[{type:'text',text:`Staged pi-review-${id}; awaiting human Keep or Discard. No canonical note was changed.`}]};
    }
  })]});
}

export async function readReview(harness:Harness,id:string) {
  const taskId=Number(id.replace('pi-review-','')) as TaskId<string>;
  const value=await harness.snapshot(Review,String(taskId),context);
  if(!value?.proposalJson) throw new Error('Unknown Pi review');
  return {taskId,value,proposal:proposalOf(value),draft:draftOf(value)};
}
