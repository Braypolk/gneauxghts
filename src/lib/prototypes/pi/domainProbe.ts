// Synthetic acceptance checks against the same adapter used by the real UI.
import {invoke} from '@tauri-apps/api/core';
import type {ChatApi} from '$lib/features/chat/api';
const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
export async function domainProbe(api:ChatApi,mark:(name:string)=>Promise<void>){
  const a=await api.createConversation({title:'Pi domain A',vaultAccess:'full'});
  const b=await api.createConversation({title:'Pi domain B',vaultAccess:'full'});
  const turn=async(conversationId:string,content:string)=>{const sent=await api.sendMessage({conversationId,content});const deadline=Date.now()+20000;while(Date.now()<deadline){const loaded=await api.getConversation(conversationId);const answer=loaded.messages.find(m=>m.id===sent.assistantMessage!.id);if(answer && answer.status!=='streaming' && answer.status!=='pending')return answer;await new Promise(r=>setTimeout(r,50));}throw new Error('Domain turn deadline');};
  const failed=await turn(a.id,'PROPOSE_CREATE FAIL_AFTER_STAGE');
  assert(failed.status==='error','Model failure after staged proposal was not terminal');
  const proposal=(await api.listPendingProposals(a.id))[0];assert(proposal,'Staged proposal lost after model failure');assert(!(await api.listPendingProposals(b.id)).length,'Cross-session proposal leak');
  const draft=await api.getProposalDraft!(proposal.id);
  const same=await api.checkpointProposalDraft!(proposal.id,draft);assert(same.version===draft.version,'No-op checkpoint invented a version');
  let invalid=false;try{await api.checkpointProposalDraft!(proposal.id,{...draft,decisions:[{id:'bad',from:0,to:999999}] as never});}catch{invalid=true;}assert(invalid,'Malformed hunk checkpoint admitted');
  const raced=await Promise.allSettled([api.commitAgentProposal(proposal.id,draft.markdown,draft.version),api.commitAgentProposal(proposal.id,draft.markdown,draft.version)]);
  const kept=raced.find(r=>r.status==='fulfilled');assert(kept?.status==='fulfilled' && kept.value.status==='committed','Concurrent Keep failed to publish');
  const receipt=await api.commitAgentProposal(proposal.id,draft.markdown,draft.version);assert(receipt.noteId=== (kept as PromiseFulfilledResult<typeof receipt>).value.noteId,'Duplicate Keep changed identity');
  let settled=false;try{await api.dismissAgentProposal(proposal.id);}catch{settled=true;}assert(settled,'Discard changed a committed review');
  await mark('model proposal survives failed generation; two-session isolation, malformed checkpoint, concurrent/duplicate Keep, settled callback rejection');
  const update=await turn(a.id,`PROPOSE_UPDATE:${receipt.noteId}`);assert(update.status==='completed','Update tool turn failed');
  const changed=(await api.listPendingProposals(a.id))[0];assert(changed?.kind==='update','Update review not staged');
  const updateDraft=await api.getProposalDraft!(changed.id);
  await invoke('save_note',{title:'Synthetic model note',markdown:'External canonical edit before Keep.',currentPath:receipt.applied?.path});
  const conflict=await api.commitAgentProposal(changed.id,updateDraft.markdown,updateDraft.version);assert(conflict.status==='conflict','Changed target received stale reviewed bytes');
  const refreshed=await api.getProposalDraft!(changed.id);assert(refreshed.version>updateDraft.version,'Conflict did not require a new review version');
  const reapproved=await api.commitAgentProposal(changed.id,refreshed.markdown,refreshed.version);assert(reapproved.status==='committed','Explicit reapproval failed');
  await mark('model update, changed-target conflict and explicit reapproval through NoteTimeline');
  const answer=await turn(b.id,'Synthetic domain direct Save');assert(answer.status==='completed','B turn failed');
  const save=await api.prepareNoteSave!(b.id,answer.id);const saveDraft=await api.getProposalDraft!(save.id);
  await api.setConversationVaultAccess(b.id,'none');
  const denied=await api.commitAgentProposal(save.id,saveDraft.markdown,saveDraft.version);assert(denied.status==='conflict','Revoked access allowed Keep');
  await api.dismissAgentProposal(save.id);
  await mark('current access rechecked at publication; Discard settles denied review');
  const evidence=await invoke<{noteId:string;path:string}>('save_note',{title:'Pi evidence domain',markdown:'The synthetic gate binds exact canonical evidence.',currentPath:null});
  await api.setConversationVaultAccess(b.id,'full');
  const cited=await turn(b.id,`READ_NOTE:${evidence.noteId}`);assert(cited.status==='completed' && cited.citations.length,'Admitted citation absent');
  const source=cited.citations[0];
  const resolve=(api as ChatApi & {prototypeResolvePassage:(id:string,evidenceId:string)=>Promise<unknown>}).prototypeResolvePassage;
  // UI uses the same issued binding and current access adapter.
  await resolve(b.id,source.kind==='note' && source.passage ? source.passage.id : '');
  await api.setNoteExcluded(evidence.noteId,'Pi evidence domain',true);
  let excluded=false;try{await resolve(b.id,source.kind==='note' && source.passage ? source.passage.id : '');}catch{excluded=true;}assert(excluded,'Excluded citation navigation succeeded');
  await api.setNoteExcluded(evidence.noteId,'Pi evidence domain',false);
  const waiting=api.sendMessage({conversationId:b.id,content:`READ_NOTE:${evidence.noteId} DELAY_FINAL`});const sent=await waiting;
  await new Promise(r=>setTimeout(r,450));await api.setConversationVaultAccess(b.id,'none');
  const deadline=Date.now()+10000;let terminal=false;while(Date.now()<deadline){const loaded=await api.getConversation(b.id);const current=loaded.messages.find(m=>m.id===sent.assistantMessage!.id);if(current?.status==='error'){terminal=true;break;}if(current?.status==='completed')throw new Error('Revoked in-flight evidence was admitted');await new Promise(r=>setTimeout(r,50));}assert(terminal,'Revoked in-flight admission did not settle');
  await mark('issued citation navigation/exclusion and current access change during final inference');
}
