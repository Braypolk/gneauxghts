// Optional fixture acceptance phase. Mutations use retained native commands;
// review admission, errors and resolutions use the normal workspace controls.
import { invoke } from '@tauri-apps/api/core';
import { EditorView } from '@codemirror/view';
import type { ChatApi } from '$lib/features/chat/api';
import type { ChatAgentProposal, ChatCitation, ChatMessage } from '$lib/features/chat/types';
import type { NoteSession } from '$lib/features/notepad/model/types';
import { reviewProjection } from '$lib/features/proposals/reviewExtension';
import { acknowledgedProbeDraft } from './probeReview';
import { observeStaleProbeCitation } from './probeCitation';
import { prepareFailureReviewControls } from './interactiveFailureReview';
import { probePaneTitle } from './probePaneTitle';
import { visibleProbeControl } from './probeChatFocus';
import { openProbeChatSplit } from './probeSplit';
import { focusProbeChatComposer } from './probeChatSend';

type FailureApi = ChatApi & { prototypeFault(id: string, fault: string): Promise<void> };
export interface InteractiveFailureJourney {
  api: FailureApi;
  conversationId: string;
  selectConversation(id: string): Promise<void>;
  send(id: string, content: string): Promise<ChatMessage>;
  startSend(id: string, content: string): Promise<ChatMessage>;
  terminal(id: string, messageId: string): Promise<ChatMessage>;
  newProposal(id: string, prompt: string): Promise<ChatAgentProposal>;
  currentReview(id: string, reviewId?: string): Promise<EditorView>;
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

/** Bind stale refusal evidence to the real originating pane/composer and the
 * exact currently retained EditorViews, including compact collapsed frames. */
export async function observeFailureStaleSource(input: {
  api: ChatApi; conversationId: string; cited: ChatMessage; noteId: string; change(): Promise<void>;
}) {
  const { api, conversationId, cited, noteId } = input;
  const sources = cited.citations.filter((value): value is Extract<ChatCitation, { kind: 'note' }> => value.kind === 'note' && value.noteId === noteId && Boolean(value.passage));
  assert(sources.length, 'Stale-source setup has no exact admitted note passage');
  const pane = document.querySelector<HTMLElement>(`[data-chat-message-id="${cited.id}"]`)?.closest<HTMLElement>('[data-testid="workspace-pane"]');
  assert(pane?.isConnected && pane.dataset.paneKind === 'chat', 'Stale source message lacks its mounted owning chat pane');
  const composer = await focusProbeChatComposer(pane, until);
  const errorRoot = composer.closest<HTMLElement>('.chat-composer-footer');
  assert(errorRoot, 'Stale source owner lacks its normal composer error surface');
  const mountedEditors = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')).map(node => EditorView.findFromDOM(node));
  const retainedEditors = mountedEditors();
  assert(retainedEditors.length && retainedEditors.every(view => view?.dom.isConnected), 'Stale source requires genuinely retained editor ownership');
  return observeStaleProbeCitation({ messageId: cited.id, citationIds: sources.map(value => value.id), pane, errorRoot, until, change: input.change,
    working: () => {
      const current = mountedEditors();
      assert(current.length === retainedEditors.length && current.every((view, index) => view === retainedEditors[index] && view?.dom.isConnected), 'Stale source replaced retained editor membership or identity');
      return retainedEditors.map(view => {
        const owner = view!.dom.closest<HTMLElement>('[data-testid="workspace-pane"]');
        const title = probePaneTitle(owner, 'editor');
        assert(owner?.isConnected && owner.dataset.paneKind === 'editor' && title?.isConnected, 'Stale source lost retained editor pane/title ownership');
        return { paneId: owner.dataset.paneId, markdown: view!.state.doc.toString(), title: title.value,
          selection: view!.state.selection.toJSON(), review: view!.state.field(reviewProjection, false) ?? null };
      });
    },
    unavailable: async () => {
      const original = sources.map(value => value.passage!.id);
      const current = (await api.getConversation(conversationId)).messages.find(value => value.id === cited.id);
      return Boolean(current) && original.every(id => !current!.citations.some(value => value.kind === 'note' && value.passage?.id === id));
    } });
}

export async function runInteractiveFailures(journey: InteractiveFailureJourney) {
  const { api, conversationId: conversation, mark } = journey;
  const draft = (id: string) => api.getProposalDraft!(id);
  const mountedWorking = (editor: EditorView, reviewId: string, active = false) => {
    const pane = editor.dom.closest<HTMLElement>('[data-testid="workspace-pane"]');
    const projection = editor.state.field(reviewProjection, false);
    assert(editor.dom.isConnected && pane?.isConnected && pane.dataset.paneKind === 'editor'
      && reviewId && projection?.reviewId === reviewId, 'Mounted failure review identity or connection differs');
    const title = probePaneTitle(pane, 'editor');
    assert(title?.isConnected, 'Mounted review has no corresponding title input');
    if (active) assert(visibleProbeControl(editor.dom) && visibleProbeControl(title), 'Failure review editor and title must be visible before capture');
    // A normal compact chat activation collapses this retained editor. Its
    // title returns locally; it must never borrow the active chat's header.
    return {markdown:editor.state.doc.toString(),title:title.value,decisions:projection.hunks};
  };
  const retainEditorBesideChat = async () => {
    if (document.querySelector('[aria-label="Thought partner chat"]')) return;
    // In a solo compact pane, Open thought partner replaces the editor. The
    // supported narrow split instead retains its real frame behind a rail.
    const enabledVisible = (node: HTMLButtonElement) => !node.disabled && visibleProbeControl(node);
    await openProbeChatSplit({ until, pause,
      visibleButton: label => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node => enabledVisible(node)
        && (node.getAttribute('aria-label') === label || node.textContent?.trim() === label)),
      mobileThoughtPartner: () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-pane-command="split"] button#pane-command-thought-partner')).find(enabledVisible) });
    await until(() => document.querySelector('[aria-label="Thought partner chat"]')
      && document.querySelectorAll('[data-testid="workspace-pane"]').length > 1, 'normal retained failure editor/chat split');
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
    const reviewId = (await api.listPendingProposals(conversation)).find(value => value.id === id)?.preview.reviewId;
    assert(typeof reviewId === 'string' && reviewId, 'Conflicted proposal has no exact review identity');
    const editor = await journey.currentReview(id, reviewId), target = await canonical(targetId);
    assert(target.path, 'Refreshed canonical target has no current path');
    const before = await acknowledgedProbeDraft({draft:() => draft(id),until,
      working:() => ({...mountedWorking(editor, reviewId),path:target.path!})});
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
  const reviewId = first.preview.reviewId;
  assert(typeof reviewId === 'string' && reviewId, 'Failure proposal has no exact review identity');
  const editor = await journey.currentReview(first.id, reviewId);
  mountedWorking(editor, reviewId, true);
  const before = await acknowledgedProbeDraft({ draft: () => draft(first.id), until,
    working: () => mountedWorking(editor, reviewId) });
  const initial = mountedWorking(editor, reviewId);
  await retainEditorBesideChat();
  const controls = await prepareFailureReviewControls({ conversationId: conversation, proposalId: first.id,
    selectConversation: journey.selectConversation, until,
    strip: () => {
      const node = strip(first.id);
      return node && !node.closest('[hidden],[inert],[aria-hidden="true"]') && node.getClientRects().length > 0
        && getComputedStyle(node).visibility !== 'hidden' ? node : undefined;
    },
    working: () => ({ connected: editor.dom.isConnected, ...mountedWorking(editor, reviewId) }) });
  assert(JSON.stringify(mountedWorking(editor, reviewId)) === JSON.stringify(initial), 'Selecting the review owner changed the exact acknowledged review');
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
  await mark('failed checkpoint pins live review; recovery acknowledges exact edited bytes', { ...controls, beforeVersion: before.version, failedVersion: failed.version, recoveredVersion: recovered.version, markdown: recovered.markdown });

  // A source selected before a canonical edit must produce a visible error,
  // never open or highlight a stale range as if it were current evidence.
  const stale = await note('Pi stale citation orchard');
  const cited = await journey.send(conversation, `PI_UI:READ:${stale.noteId}`);
  const sourceError = await observeFailureStaleSource({ api, conversationId: conversation, cited, noteId: stale.noteId,
    change: () => change(stale, 'The synthetic orchard source changed after the answer was admitted.') });
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
