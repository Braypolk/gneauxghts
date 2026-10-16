import type { ChatProposalDraft } from '$lib/features/chat/types';

/** Fixture driver boundary: Save can mount its review before a chat card exists. */
export async function acquireProbeReview<T,C>(input: {
  editor(): T | undefined;
  card(): C | undefined;
  openChat(): Promise<void>;
  openCard(card: C): Promise<void>;
  until<V>(read: () => V | Promise<V>, label: string): Promise<NonNullable<V>>;
}): Promise<NonNullable<T>> {
  const ready=input.editor();if(ready)return ready;
  await input.openChat();
  let opened=false;
  return input.until(async()=>{
    const editor=input.editor();if(editor)return editor;
    const card=input.card();
    if(card&&!opened){opened=true;await input.openCard(card);}
    return input.editor();
  },'retained CodeMirror proposal review');
}
/** Capture acknowledged mounted fields before testing an operation for writes. */
export async function acknowledgedProbeDraft(input: {
  draft(): Promise<ChatProposalDraft>;
  working(): Pick<ChatProposalDraft,'markdown'|'decisions'|'title'> & Partial<Pick<ChatProposalDraft,'path'>>;
  until<V>(read: () => V | Promise<V>, label: string): Promise<NonNullable<V>>;
}): Promise<ChatProposalDraft> {
  return input.until(async()=>{
    const draft=await input.draft(),working=input.working();
    return draft.markdown===working.markdown && draft.title===working.title &&
      (working.path===undefined || draft.path===working.path) &&
      JSON.stringify(draft.decisions)===JSON.stringify(working.decisions) ? draft : undefined;
  },'acknowledged mounted review checkpoint');
}
