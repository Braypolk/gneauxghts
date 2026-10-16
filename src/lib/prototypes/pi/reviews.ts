import { invoke } from '@tauri-apps/api/core';
import { defineDoc, defineDocFamily, defineTask, defineExtension, defineTool, type Harness, type ConversationId, type TaskId, type Tx, type ToolExecutionApi } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import { Evidence, evidenceGrants } from './notesExtension';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context, awaitWithContext } from '@earendil-works/chord/context';
import type { ChatAgentProposal, ChatProposalDraft, VaultAccess } from '$lib/features/chat/types';
import type { CommitNoteReviewResult } from '$lib/types/proposals';
import { acknowledgeDraft, acceptKeep, requirePending, proposalOf, draftOf, sameDraft } from './reviewState';
export { proposalOf, draftOf } from './reviewState';

export const Reviews = defineDoc({kind:'gneauxghts.pi.reviews',version:1,scope:'session',initial:() => ({ids:[] as number[],origins:{} as Record<string,number>})});
export const Review = defineDocFamily({family:true,kind:'gneauxghts.pi.review',version:1,scope:'session',initial:(_seed:string) => ({
  proposalJson:'',draftJson:'',decision:'pending',acceptedJson:'',receiptJson:'',receiptVersion:0,fault:'',refinementsJson:'{}'
})});

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
    let uncertain = false;
    const binding=await runtime.snapshot(Evidence,task.conversationId!,callContext);
    try {receipt=await invoke('pi_publish_review',{accepted,currentAccess:binding?.access ?? 'none',currentGrants:binding ? evidenceGrants(binding) : [],fault:chosen.fault || null});}
    catch(error) {uncertain = true;receipt={status:'conflict',applied:null,noteId:null,committedMarkdown:null,message:`Keep acknowledgement failed; Retry Keep to reconcile. ${String(error)}`};}
    let refreshed:Partial<ChatAgentProposal>|undefined;
    if(receipt.status==='conflict' && !uncertain) {
      try {
        if(accepted.promotion && accepted.kind==='update') {
          refreshed=await invoke('pi_refresh_saved_addition',{proposal:proposalOf(chosen),markdown:accepted.markdown,title:accepted.title,path:accepted.path,access:binding?.access ?? 'none',grants:binding ? evidenceGrants(binding) : []});
        } else refreshed=await invoke('pi_prepare_review',{title:accepted.title,markdown:accepted.markdown,
          noteId:accepted.noteId,access:binding?.access ?? 'none',grants:binding ? evidenceGrants(binding) : [],path:accepted.kind==='create'?undefined:accepted.path});
      } catch { /* Keep the existing edited draft. */ }
    }
    await runtime.commit(async tx => {const doc=await tx.doc(Review,String(task.id),'');const proposal=proposalOf(doc);const draft=draftOf(doc);
      doc.receiptJson=JSON.stringify(receipt);doc.receiptVersion=accepted.version;
      if(receipt.status==='committed') {
        proposal.status='committed';proposal.payload={...proposal.payload,committedNoteId:receipt.noteId,committedPath:receipt.applied?.path};doc.proposalJson=JSON.stringify(proposal);
        return {status:'terminal',outcome:{status:'completed',result:doc.receiptJson}};
      }
      if (uncertain) {
        proposal.status='conflict';doc.proposalJson=JSON.stringify(proposal);doc.decision='pending';
        return {status:'running',checkpoint:{phase:'review',revision:task.state.checkpoint.revision+1}};
      }
      const payload={...proposal.payload,...refreshed?.payload};
      Object.assign(proposal,refreshed,{status:'conflict',payload});draft.version++;draft.path=proposal.suggestedPath ?? draft.path;
      if(refreshed?.payload?.promotion && typeof refreshed.payload.markdown==='string')draft.markdown=refreshed.payload.markdown;
      doc.proposalJson=JSON.stringify(proposal);doc.draftJson=JSON.stringify(draft);doc.decision='pending';doc.acceptedJson='';doc.fault='';
      return {status:'running',checkpoint:{phase:'review',revision:task.state.checkpoint.revision+1}};
    },callContext);
  }},
  abort:async (task,runtime,callContext) => {await runtime.commit(async tx => {
    const doc=await tx.doc(Review,String(task.id),'');
    if(doc.acceptedJson)throw new Error('An accepted native effect must reconcile before cancelling its review');
    const proposal=proposalOf(doc);proposal.status='dismissed';doc.proposalJson=JSON.stringify(proposal);
    return {status:'terminal',outcome:{status:'aborted',reason:'Review explicitly cancelled'}};
  },callContext);}
});

export async function stageReview(tx:Tx, conversationId:ConversationId, prepared:Partial<ChatAgentProposal>,
  assistantMessageId:string, origin:string) {
  const catalog=await tx.doc(Reviews);
  if(catalog.origins[origin] !== undefined) {
    const previous=await tx.doc(Review,String(catalog.origins[origin]),'');
    if(proposalOf(previous).status!=='dismissed')return catalog.origins[origin] as TaskId<string>;
  }
  const taskId=await tx.createTask(ReviewTask,null,{ownership:{kind:'conversation'},conversationId,background:true});
  const proposal={...prepared,id:`pi-review-${taskId}`,conversationId:`pi-${conversationId}`,assistantMessageId,runId:null,
    status:'pending',createdAtMillis:Date.now(),updatedAtMillis:Date.now()} as ChatAgentProposal;
  const draft:ChatProposalDraft={version:1,markdown:String(proposal.payload.markdown),title:proposal.title,path:proposal.suggestedPath!,decisions:[]};
  const doc=await tx.doc(Review,String(taskId),'');doc.proposalJson=JSON.stringify(proposal);doc.draftJson=JSON.stringify(draft);
  catalog.ids.push(taskId);catalog.origins[origin]=taskId;
  return taskId;
}

export function reviewExtension(access: (conversationId:number) => Promise<VaultAccess>, messageId: (conversationId:number) => string) {
  return defineExtension({name:'gneauxghts.review',tasks:[ReviewTask],sections:[{key:'gneauxghts-review',render:()=>
    'Canonical note writes require human Keep. To refine a pending Note Proposal, first read_note_proposal, then refine_note_proposal with its exact acknowledged version. Preserve its latest human edits. Never create another proposal to replace a pending draft. Read an existing canonical target completely before proposing its replacement.'}],tools:[defineTool({
    name:'propose_note',description:'Stage a complete note create/update for editable human review. Only Keep publishes. Staging is not saving.',
    parameters:Type.Object({title:Type.String(),markdown:Type.String(),noteId:Type.Optional(Type.String())}),replay:'safe',
    execute:async (input,api,callContext) => {
      const proof=input.noteId ? await validateTargetEvidence(api,input.noteId,callContext) : undefined;
      const binding=await api.snapshot(Evidence,api.conversationId,callContext);
      const prepared=await invoke<Partial<ChatAgentProposal>>('pi_prepare_review',{...input,noteId:input.noteId ?? null,access:await access(api.conversationId),grants:binding ? evidenceGrants(binding) : []});
      if(proof && prepared.baseHash!==proof.baseHash)throw new Error('Target changed after its canonical read; read it again before proposing');
      let id=0;await api.commit(async tx => {id=await stageReview(tx,api.conversationId,prepared,messageId(api.conversationId),`tool:${api.taskId}:${api.callId}`);},callContext);
      return {output:[{type:'text',text:`Staged pi-review-${id}; awaiting human Keep or Discard. No canonical note was changed.`}]};
    }
  }), defineTool({
    name:'read_note_proposal',description:'Read the latest acknowledged pending Note Proposal body, title, location, hunk choices and exact version before refinement. This is working content, not canonical evidence.',
    parameters:Type.Object({proposalId:Type.String()}),replay:'safe',
    execute:async ({proposalId},api,callContext)=>{
      const doc=await api.snapshot(Review,String(reviewTaskId(proposalId)),callContext);
      if(!doc?.proposalJson || proposalOf(doc).conversationId!==`pi-${api.conversationId}`)throw new Error('Unknown proposal in this conversation');
      requirePending(doc);return {output:[{type:'text',text:JSON.stringify({proposalId,...draftOf(doc)})}]};
    }
  }), defineTool({
    name:'refine_note_proposal',description:'Revise the same pending Note Proposal from its latest read version. Late output is rejected after another checkpoint or Keep/Discard. Only human Keep publishes.',
    parameters:Type.Object({proposalId:Type.String(),expectedVersion:Type.Integer({minimum:1}),title:Type.String(),markdown:Type.String()}),replay:'safe',
    execute:async (input,api,callContext)=>{
      const taskId=reviewTaskId(input.proposalId), key=`${api.taskId}:${api.callId}`;
      const doc=await api.snapshot(Review,String(taskId),callContext);
      if(!doc?.proposalJson || proposalOf(doc).conversationId!==`pi-${api.conversationId}`)throw new Error('Unknown proposal in this conversation');
      const replay=JSON.parse(doc.refinementsJson || '{}') as Record<string,number>;
      if(replay[key]!==undefined)return {output:[{type:'text',text:`Already acknowledged refinement of ${input.proposalId} at version ${replay[key]}. No further change was made.`}]};
      requirePending(doc,input.expectedVersion);
      const proposal=proposalOf(doc), latest=draftOf(doc);
      const proof=proposal.noteId ? await validateTargetEvidence(api,proposal.noteId,callContext) : undefined;
      const binding=await api.snapshot(Evidence,api.conversationId,callContext);
      const prepared=await invoke<Partial<ChatAgentProposal>>('pi_prepare_review',{title:input.title,markdown:input.markdown,
        noteId:proposal.noteId,access:await access(api.conversationId),grants:binding ? evidenceGrants(binding) : [],path:latest.path});
      // Re-preparing cannot silently rebase against a changed canonical target.
      if(prepared.baseHash!==proposal.baseHash || proof && prepared.baseHash!==proof.baseHash)throw new Error('Target changed; review its conflict before refining');
      let version=0;
      await api.commit(async tx=>{
        const record=await tx.doc(Review,String(taskId),'');
        const seen=JSON.parse(record.refinementsJson || '{}') as Record<string,number>;
        if(seen[key]!==undefined){version=seen[key];return;}
        version=acknowledgeDraft(record,{...latest,version:input.expectedVersion,title:input.title,markdown:input.markdown,decisions:[]},prepared).version;
        seen[key]=version;record.refinementsJson=JSON.stringify(seen);
      },callContext);
      return {output:[{type:'text',text:`Refined ${input.proposalId} at version ${version}; awaiting human review. No canonical note was changed.`}]};
    }
  })]});
}

// The native evidence owner validates full canonical read coverage; a draft read
// cannot grant authority to replace a canonical note.
async function validateTargetEvidence(api:ToolExecutionApi,noteId:string,callContext:Context) {
  const binding=await api.snapshot(Evidence,api.conversationId,callContext);
  if(!binding)throw new Error('Read the complete canonical target before proposing its replacement');
  return invoke<{baseHash:string}>('pi_validate_proposal_evidence',{sessionId:binding.sessionId,noteId,access:binding.access,grants:evidenceGrants(binding)});
}

function reviewTaskId(id:string) {
  if(!/^pi-review-[1-9]\d*$/.test(id))throw new Error('Invalid Pi review identity');
  const value=Number(id.slice('pi-review-'.length));
  if(!Number.isSafeInteger(value))throw new Error('Invalid Pi review identity');
  return value as TaskId<string>;
}

export async function readReview(harness:Harness,id:string) {
  const taskId=reviewTaskId(id);
  const value=await harness.snapshot(Review,String(taskId),context);
  if(!value?.proposalJson) throw new Error('Unknown Pi review');
  return {taskId,value,proposal:proposalOf(value),draft:draftOf(value)};
}

export async function checkpointReview(harness:Harness,id:string,draft:ChatProposalDraft,path:string|undefined,access:VaultAccess) {
  const current=await readReview(harness,id);
  requirePending(current.value,draft.version);
  // Only the existing synthetic-only prototypeFault API can arm this value.
  if(current.value.fault==='checkpoint')throw new Error('Synthetic review checkpoint persistence failure');
  let target=path ?? draft.path;
  let displayTarget=target;
  if(target!==current.draft.path) {
    const locations=await invoke<string[]>('pi_resolve_locations',{paths:[current.draft.path,target]});
    if(locations.length!==2 || locations.some(value=>typeof value!=='string'||!value))throw new Error('Invalid resolved review location');
    displayTarget=locations[1];
    // A proven root move changes presentation, not the target bytes hashed into
    // an accepted native effect (or the version of an unchanged pending draft).
    if(locations[0]===locations[1])target=current.draft.path;
  }
  if(current.value.acceptedJson) {
    const normalized={...draft,path:target};
    if(!sameDraft(current.draft,normalized))throw new Error('Retry Keep to reconcile the pending native publication before editing');
    await invoke('pi_validate_review_checkpoint',{markdown:draft.markdown,title:draft.title,path:displayTarget,decisions:draft.decisions});
    let acknowledged=current.draft;
    await harness.commit(async tx=>{
      const doc=await tx.doc(Review,String(current.taskId),'');requirePending(doc,draft.version);
      if(doc.acceptedJson!==current.value.acceptedJson || !sameDraft(draftOf(doc),normalized))throw new Error('Review changed; reopen its latest checkpoint');
      acknowledged=draftOf(doc);
    },context);
    return {...acknowledged,path:displayTarget};
  }
  if(path && target!==current.draft.path || draft.title!==current.draft.title) {
    const binding=await harness.snapshot(Evidence,Number(current.proposal.conversationId.slice(3)) as ConversationId,context);
    const prepared=await invoke<Partial<ChatAgentProposal>>('pi_prepare_review',{title:draft.title,markdown:draft.markdown,
      noteId:current.proposal.noteId,access,grants:binding ? evidenceGrants(binding) : [],path:path ?? null});
    target=prepared.suggestedPath!;
    displayTarget=target;
  }
  await invoke('pi_validate_review_checkpoint',{markdown:draft.markdown,title:draft.title,path:displayTarget,decisions:draft.decisions});
  let acknowledged=draft;
  await harness.commit(async tx=>{acknowledged=acknowledgeDraft(await tx.doc(Review,String(current.taskId),''),{...draft,path:target});},context);
  return {...acknowledged,path:displayTarget};
}

export async function keepReview(harness:Harness,id:string,markdown?:string,expectedVersion?:number) {
  const current=await readReview(harness,id), version=expectedVersion ?? current.draft.version;
  if(current.proposal.status==='committed') {
    if(current.value.receiptVersion!==version || (markdown!==undefined && markdown!==current.draft.markdown))throw new Error('Keep does not match the committed review');
    return JSON.parse(current.value.receiptJson) as CommitNoteReviewResult;
  }
  await harness.commit(async tx=>{
    const doc=await tx.doc(Review,String(current.taskId),'');
    const binding=await tx.doc(Evidence,Number(proposalOf(doc).conversationId.slice(3)) as ConversationId);
    acceptKeep(doc,id,version,markdown,binding.access,evidenceGrants(binding));
  },context);
  harness.resume();
  const watch=await harness.watchDoc(Review,String(current.taskId),context);
  if(!watch)throw new Error('Review disappeared');
  const result=Promise.withResolvers<CommitNoteReviewResult>();
  const choose=(doc:typeof watch.value)=>{if(doc?.receiptJson && doc.receiptVersion===version)result.resolve(JSON.parse(doc.receiptJson));};
  watch.start(async doc=>{choose(doc);});choose(watch.value);
  try{return await result.promise;}finally{await watch.stop();}
}

export async function discardReview(harness:Harness,id:string) {
  const current=await readReview(harness,id);
  if(current.proposal.status==='dismissed')return current.proposal;
  await harness.commit(async tx=>{
    const doc=await tx.doc(Review,String(current.taskId),'');requirePending(doc);
    if(doc.acceptedJson)throw new Error('Retry Keep to reconcile the pending native publication before Discard');
    doc.decision='discard';
  },context);
  harness.resume();await harness.waitForTask(current.taskId,context);
  return (await readReview(harness,id)).proposal;
}
