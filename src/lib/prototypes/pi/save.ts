import { invoke } from '@tauri-apps/api/core';
import type { Harness, ConversationId } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { ChatAgentProposal, VaultAccess } from '$lib/features/chat/types';
import { Reviews, Review, proposalOf, readReview, stageReview } from './reviews';

type Selection = {markdown:string;text:string;occurrence?:number};
type Options = {copyIntent?:string;targetNoteId?:string;heading?:string};
export type SaveAnswer = {text:string;sourcesJson:string;associationsJson?:string};

/** Save intent is independent of object property order and omitted defaults. */
export function saveOrigin(conversationId:string,messageId:string,selection?:Selection,options?:Options) {
  return JSON.stringify(['save',conversationId,messageId,selection
    ? [selection.markdown.trim(),selection.text.trim().split(/\s+/).join(' '),selection.occurrence ?? 0]
    : 'whole',options?.targetNoteId ?? 'new',options?.heading ?? 'append',options?.copyIntent ?? 'original']);
}

export function originProjectionPath(conversationId:string) {
  if(!/^pi-[1-9]\d*$/.test(conversationId))throw new Error('Invalid Pi conversation identity');
  return `Chats/Pi/${conversationId}/Origin.md`;
}

/** Accept only this reserved origin shape, relative or under a vault root. */
export function conversationFromOriginPath(path:string):string|null {
  return path.replaceAll('\\','/').match(/(?:^|\/)Chats\/Pi\/(pi-[1-9]\d*)\/Origin(?:\.md)?$/)?.[1] ?? null;
}

/** Deterministic direct Save: this path never submits or resumes model work. */
export async function saveAnswer(harness:Harness,input:{conversationId:string;messageId:string;answer:SaveAnswer;
  selection?:Selection;options?:Options;access:VaultAccess;grants?:string[]}) {
  const {conversationId,messageId,selection,options,answer}=input;
  if(!/^pi-[1-9]\d*$/.test(conversationId) || !/^pi-assistant-[1-9]\d*$/.test(messageId))throw new Error('Save requires a completed Pi answer');
  const origin=saveOrigin(conversationId,messageId,selection,options);
  const existing=(await harness.snapshot(Reviews,context))?.origins[origin];
  if(existing!==undefined) {
    const record=await harness.snapshot(Review,String(existing),context);
    if(record?.proposalJson && proposalOf(record).status!=='dismissed')return proposalOf(record);
  }
  const prepared=await invoke<Partial<ChatAgentProposal>>('pi_prepare_save',{input:{conversationId,messageId,
    markdown:answer.text,sources:JSON.parse(answer.sourcesJson || '[]'),
    associations:answer.associationsJson ? JSON.parse(answer.associationsJson) : null,
    selection:selection ?? null,targetNoteId:options?.targetNoteId ?? null,heading:options?.heading ?? null,
    copyIntent:options?.copyIntent ?? null,title:null,access:input.access,grants:input.grants ?? []}});
  let taskId=0;
  await harness.commit(async tx=>{taskId=await stageReview(tx,Number(conversationId.slice(3)) as ConversationId,prepared,messageId,origin);},context);
  return (await readReview(harness,`pi-review-${taskId}`)).proposal;
}
