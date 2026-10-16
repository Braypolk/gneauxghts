// Optional fixture acceptance phase. Mutations use retained native commands;
// review admission, errors and resolutions use the normal workspace controls.
import { invoke } from '@tauri-apps/api/core';
import type { EditorView } from '@codemirror/view';
import type { ChatApi } from '$lib/features/chat/api';
import type { ChatAgentProposal, ChatMessage } from '$lib/features/chat/types';
import type { NoteSession } from '$lib/features/notepad/model/types';
import { reviewProjection } from '$lib/features/proposals/reviewExtension';
import { acknowledgedProbeDraft } from './probeReview';
import { observeStaleProbeCitation } from './probeCitation';

type FailureApi = ChatApi & { prototypeFault(id: string, fault: string): Promise<void> };
export interface InteractiveFailureJourney {
  api: FailureApi;
  conversationId: string;
  selectConversation(id: string): Promise<void>;
  send(id: string, content: string): Promise<ChatMessage>;
  startSend(id: string, content: string): Promise<ChatMessage>;
  terminal(id: string, messageId: string): Promise<ChatMessage>;
  newProposal(id: string, prompt: string): Promise<ChatAgentProposal>;
  currentReview(id: string): Promise<EditorView>;
  openSource(message: ChatMessage): Promise<EditorView>;
  openChat(): Promise<void>;
  mark(name: string, receipt?: unknown): Promise<void>;
}
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until<T>(read: () => T | Promise<T>, description: string): Promise<NonNullable<T>> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const value = await read(); if (value) return value as NonNullable<T>; await pause(); }
  throw new Error(`Interactive failure deadline: ${description}`);
}
const buttons = (root: ParentNode, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(node => !node.disabled && (node.textContent?.trim() === label || node.getAttribute('aria-label') === label));
const strip = (id: string) => document.querySelector(`[data-proposal-strip="active"][data-proposal-id="${id}"]`);
const rewrite = (view: EditorView, markdown: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: markdown }, userEvent: 'input.type' });

export async function runInteractiveFailures(journey: InteractiveFailureJourney) {
  const { api, conversationId: conversation, mark } = journey;
  const draft = (id: string) => api.getProposalDraft!(id);
  const mountedWorking = (editor: EditorView) => {
    const title = editor.dom.closest('[data-pane-frame]')?.querySelector<HTMLInputElement>('[data-testid="note-title"]');
    assert(title, 'Mounted review has no corresponding title input');
    return {markdown:editor.state.doc.toString(),title:title.value,decisions:editor.state.field(reviewProjection,false)?.hunks ?? []};
  };
  const canonical = (noteId: string) => invoke<NoteSession>('read_note', { noteId });
  const note = async (title: string) => {
    const result = await invoke<{ noteId: string; path: string }>('save_note', { title, markdown: 'The synthetic orchard has seven pear trees.', currentPath: null });
    await invoke('finalize_note_editing_window', { noteId: result.noteId });
    return result;
  };
  const change = async (target: { noteId: string; path: string }, markdown: string) => {
    await invoke('save_note', { title: 'Pi interactive orchard', markdown, currentPath: target.path });
    await invoke('finalize_note_editing_window', { noteId: target.noteId });
    assert((await canonical(target.noteId)).markdown === markdown, 'Synthetic canonical edit was not retained');
  };
  const requestReview = async (id: string) => {
    await journey.openChat();
    const card = await until(() => document.querySelector(`section[data-proposal-id="${id}"]`), 'pending review card');
    (await until(() => buttons(card, 'Review in editor'), 'normal Review in editor')).click();
  };
  const discard = async (id: string) => {
    await journey.currentReview(id); await journey.openChat();
    const action = await until(() => { const root = strip(id); return root && (buttons(root, 'Discard') ?? buttons(root, 'Undo All') ?? buttons(root, 'Undo Remaining')); }, 'normal Discard or Undo All');
    action.click();
    await until(async () => !(await api.listPendingProposals(conversation)).some(value => value.id === id), 'Discard settled');
  };
  const keepConflict = async (id: string, expectedCanonical: string, targetId: string) => {
    await journey.currentReview(id); await journey.openChat();
    const action = await until(() => { const root = strip(id); return root && (buttons(root, 'Keep All') ?? buttons(root, 'Keep Remaining')); }, 'normal Keep All');
    action.click();
    const proposal = await until(async () => (await api.listPendingProposals(conversation)).find(value => value.id === id && value.status === 'conflict'), 'native stale-target conflict');
    const alert = await until(() => strip(id)?.querySelector('[role="alert"]')?.textContent?.trim(), 'visible Keep conflict');
    assert((await canonical(targetId)).markdown === expectedCanonical, 'Conflicted Keep overwrote a canonical edit');
    return { proposalId: proposal.id, status: proposal.status, alert, canonical: expectedCanonical, draft: await draft(id) };
  };
  const reloadConflict = async (id: string, expectedCanonical: string, targetId: string) => {
    const editor = await journey.currentReview(id), target = await canonical(targetId);
    assert(target.path, 'Refreshed canonical target has no current path');
    const before = await acknowledgedProbeDraft({draft:() => draft(id),until,
      working:() => ({...mountedWorking(editor),path:target.path!})});
    await journey.openChat();
    const reload = () => { const root = strip(id); return root && buttons(root, 'Reload Disk'); };
    (await until(reload, 'normal conflict Reload Disk')).click();
    await until(() => strip(id)?.querySelector('[role="alert"]')?.textContent?.includes('Select Reload Disk again to confirm'), 'explicit Reload Disk confirmation');
    assert(JSON.stringify(await draft(id)) === JSON.stringify(before), 'Reload confirmation changed the exact acknowledged review');
    assert(editor.state.doc.toString() === before.markdown, 'Reload confirmation discarded reviewed editor bytes before confirmation');
    assert((await api.listPendingProposals(conversation)).some(value => value.id === id), 'Reload dismissed the review before confirmation');
    (await until(reload, 'confirmed normal Reload Disk')).click();
    await until(async () => !(await api.listPendingProposals(conversation)).some(value => value.id === id) && !strip(id), 'conflicted review Reload Disk settled');
    await until(() => editor.state.doc.toString() === expectedCanonical, 'Reload Disk adopts current canonical editor bytes');
    assert((await canonical(targetId)).markdown === expectedCanonical, 'Reload Disk altered the newer canonical authored bytes');
  };
  await journey.selectConversation(conversation);

  // A failed checkpoint must retain the live editor as the working-copy owner,
  // and a switch must not acknowledge or replace that unpersisted body.
  const first = await journey.newProposal(conversation, 'PI_UI:CREATE');
  const second = await journey.newProposal(conversation, 'PI_UI:CREATE');
  const editor = await journey.currentReview(first.id);
  const before = await acknowledgedProbeDraft({ draft: () => draft(first.id), until,
    working: () => mountedWorking(editor) });
  const edited = 'Synthetic unacknowledged editor bytes survive a failed checkpoint.';
  await api.prototypeFault(first.id, 'checkpoint');
  rewrite(editor, edited);
  await until(() => strip(first.id)?.querySelector('[role="alert"]')?.textContent?.includes('checkpoint persistence failure'), 'visible failed checkpoint');
  await requestReview(second.id); await pause(150);
  const failed = await draft(first.id);
  assert(editor.state.doc.toString() === edited && Boolean(strip(first.id)), 'Failed checkpoint allowed a switch to replace the working editor');
  assert(failed.version === before.version && failed.markdown === before.markdown, 'Failed checkpoint was reported as acknowledged');
  await api.prototypeFault(first.id, '');
  await requestReview(second.id); await journey.currentReview(second.id);
  const recovered = await draft(first.id);
  assert(recovered.markdown === edited && recovered.version > before.version, 'Retry did not acknowledge the retained editor bytes');
  await discard(second.id); await discard(first.id);
  await mark('failed checkpoint pins live review; recovery acknowledges exact edited bytes', { proposalId: first.id, beforeVersion: before.version, failedVersion: failed.version, recoveredVersion: recovered.version, markdown: recovered.markdown });

  // A source selected before a canonical edit must produce a visible error,
  // never open or highlight a stale range as if it were current evidence.
  const stale = await note('Pi stale citation orchard');
  const cited = await journey.send(conversation, `PI_UI:READ:${stale.noteId}`);
  assert(cited.citations.length, 'Stale-source setup has no admitted citation');
  const sourceError = await observeStaleProbeCitation({ messageId: cited.id, until,
    change: () => change(stale, 'The synthetic orchard source changed after the answer was admitted.'),
    unavailable: async () => {
      const original = cited.citations.filter(value => value.kind === 'note').map(value => value.passage?.id).filter(Boolean);
      const current = (await api.getConversation(conversation)).messages.find(value => value.id === cited.id);
      return original.length > 0 && Boolean(current) && original.every(id => !current!.citations.some(value => value.kind === 'note' && value.passage?.id === id));
    } });
  await mark('changed canonical source refuses stale citation navigation visibly', { messageId: cited.id, noteId: stale.noteId, ...sourceError });

  // A new canonical target revision after preparation must block publication.
  const target = await note('Pi conflicting target orchard');
  const update = await journey.newProposal(conversation, `PI_UI:UPDATE:${target.noteId}`);
  await journey.currentReview(update.id);
  const targetEdit = 'A newer synthetic canonical target must survive stale Keep.';
  await change(target, targetEdit);
  const conflict = await keepConflict(update.id, targetEdit, target.noteId);
  assert(conflict.draft.markdown.includes('eight synthetic pear trees'), 'Target conflict lost the proposed editor content');
  await reloadConflict(update.id, targetEdit, target.noteId);
  await mark('canonical target edit blocks stale Keep and preserves review bytes', conflict);

  // Keep editing faster than autosave while the provider prepares a proposal.
  // Its bounded reply delay makes dirty-buffer arrival observable, rather than
  // injecting an alternate editor owner or bypassing ordinary autosave.
  const dirty = await note('Pi dirty ordinary orchard');
  const read = await journey.send(conversation, `PI_UI:READ:${dirty.noteId}`);
  const ordinary = await journey.openSource(read);
  await journey.openChat();
  const known = new Set((await api.listPendingProposals(conversation)).map(value => value.id));
  const sending = await journey.startSend(conversation, `PI_UI:UPDATE_DIRTY:${dirty.noteId}`);
  let revision = 0, latest = '', pending: ChatAgentProposal | undefined;
  const deadline = Date.now() + 30000;
  while (!pending && Date.now() < deadline) {
    latest = `Synthetic dirty ordinary orchard edit ${++revision} remains authored content.`;
    rewrite(ordinary, latest);
    pending = (await api.listPendingProposals(conversation)).find(value => !known.has(value.id));
    if (!pending) await pause(30);
  }
  assert(pending, 'Dirty-buffer setup never received a proposal');
  await pause(100); // Allow normal passive presentation to react to the proposal.
  const atArrival = await canonical(dirty.noteId);
  assert(ordinary.state.doc.toString() === latest, 'Passive proposal arrival replaced ordinary editor bytes');
  assert(atArrival.markdown !== latest, 'Dirty-buffer arrival was not observed before autosave; no dirty protection proof');
  assert(!strip(pending.id), 'Passive proposal arrival attached a review to a dirty ordinary buffer');
  const finished = await journey.terminal(conversation, sending.id);
  assert(finished.status === 'completed', 'Dirty-buffer fixture inference did not complete');
  assert(ordinary.state.doc.toString() === latest && !strip(pending.id), 'Late passive presentation replaced the ordinary working buffer');
  await until(async () => (await canonical(dirty.noteId)).markdown === latest, 'ordinary authored edit autosave');
  const dirtyReceipt = await keepConflict(pending.id, latest, dirty.noteId);
  await reloadConflict(pending.id, latest, dirty.noteId);
  await mark('dirty ordinary buffer survives passive proposal arrival and stale Keep', { ...dirtyReceipt, revision, canonicalAtArrival: atArrival.markdown, localAtArrival: latest });
}
