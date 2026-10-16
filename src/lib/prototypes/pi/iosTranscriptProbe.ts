// Explicit opt-in probe of the existing workspace, never an alternate UI/runtime.
import { invoke } from '@tauri-apps/api/core';
import { chatApi, type ChatApi } from '$lib/features/chat/api';
import type { ChatProposalDraft, ChatMessage } from '$lib/features/chat/types';
import { assertAcknowledgedReview } from './iosTranscriptContract';

type ProbeApi = ChatApi & {
  prototypeState(): Promise<{ transcriptStateJson?: string }>;
  prototypeCheckpoint(value: unknown): Promise<void>;
  prototypeFault(id: string, fault: string): Promise<void>;
};
type State = {
  phase: 'relocated'; oldVault: string; a: string; b: string; source: { noteId: string; path: string };
  cited: ChatMessage; pendingId: string; pending: ChatProposalDraft;
  uncertainId: string; uncertain: ChatProposalDraft; conversationIds: string[];
};
export type IosTranscriptReport = {
  gate: 'ios-native-transcript-fixture'; launchId: string; phase: string;
  status: 'running' | 'passed' | 'failed'; checks: string[]; receipts: Record<string, unknown>;
  error?: string; limits: readonly string[];
};
const api = chatApi as ProbeApi;
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until<T>(read: () => T | Promise<T>, label: string, timeout = 45000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (value) return value as NonNullable<T>; await pause(); }
  throw new Error(`iOS transcript deadline: ${label}`);
}
const button = (label: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(node => !node.disabled && (node.textContent?.trim() === label || node.getAttribute('aria-label') === label));
async function click(label: string, root: ParentNode = document) { (await until(() => button(label, root), label)).click(); await pause(); }
async function open() { if (!document.querySelector('[aria-label="Thought partner chat"]')) await click('Open thought partner'); await until(() => document.querySelector('[aria-label="Thought partner chat"]'), 'chat'); }
async function select(id: string) {
  await open(); const conversation = await api.getConversation(id); await click('Conversations');
  (await until(() => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(node => node.textContent?.trim() === conversation.title), 'conversation picker')).click();
  await until(() => document.querySelector<HTMLInputElement>('[aria-label="Chat title"]')?.value === conversation.title, 'selected conversation');
}
async function send(id: string, content: string) {
  const count = (await api.getConversation(id)).messages.length;
  const field = await until(() => { const node = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]'); return node && !node.disabled ? node : undefined; }, 'composer');
  field.focus(); field.value = content; field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content })); await click('Send message');
  const message = await until(async () => { const messages = (await api.getConversation(id)).messages; const value = messages.length > count && messages.at(-1); return value && !['pending', 'streaming'].includes(value.status) ? value : undefined; }, 'terminal committed assistant');
  assert(message.status === 'completed', `Request ${message.status}: ${message.errorMessage}`); return message;
}
async function review(id: string) {
  await open(); const card = await until(() => document.querySelector(`section[data-proposal-id="${id}"]`), 'proposal card'); await click('Review in editor', card);
  return until(() => document.querySelector(`[data-proposal-strip="active"][data-proposal-id="${id}"]`), 'normal review strip');
}
async function keep(id: string) { const strip = await review(id); (await until(() => button('Keep All', strip) ?? button('Keep Remaining', strip) ?? button('Retry', strip), 'normal Keep or Retry')).click(); }
async function conflict() { await until(() => button('Restore transcript from chat'), 'watcher-driven conflict UI'); }
async function resolve(label: string) { await click(label); await until(() => !button('Restore transcript from chat'), 'conflict resolved'); }

export async function runIosTranscriptProbe(): Promise<IosTranscriptReport | undefined> {
  if (!new URL(location.href).searchParams.has('piTranscriptTest')) return;
  const config = await invoke<{ fixture: boolean; interactiveGate: boolean; expandedGate: boolean }>('pi_probe_config');
  if (!config.fixture || !config.interactiveGate || !config.expandedGate) return;
  const report: IosTranscriptReport = { gate: 'ios-native-transcript-fixture', launchId: crypto.randomUUID(), phase: 'starting', status: 'running', checks: [], receipts: {},
    limits: ['Synthetic protocols and programmatic normal UI actions in WKWebView; no physical touch, live provider or pressure behavior is established.',
      'Driver moves owned vault and Pi/native state between fresh simulator sandbox paths; standalone Settings-selected vault relocation is not established.'] };
  const emit = async (phase: string, receipt?: unknown) => { report.phase = phase; if (receipt !== undefined) report.receipts[phase] = receipt; await invoke('pi_ui_report', { report }); };
  const close = async () => {
    const receipt = await invoke<{ ready: boolean; timelinePortable: boolean }>('prepare_restart');
    assert(receipt.ready && receipt.timelinePortable, 'Native restart did not close to portable state'); return receipt;
  };
  try {
    await until(() => document.querySelector('[data-testid="workspace-pane"]'), 'normal native workspace');
    const prior = (await api.prototypeState()).transcriptStateJson;
    if (!prior) {
      assert(!(await api.listConversations()).length, 'Fresh generated simulator container required');
      const source = await invoke<{ noteId: string; path: string }>('save_note', { title: 'Pi transcript orchard', markdown: 'The synthetic orchard has seven pear trees.', currentPath: null });
      await invoke('finalize_note_editing_window', { noteId: source.noteId });
      const a = await api.createConversation({ title: 'Pi iOS transcript local', provider: 'local', model: 'pi-native-fixture', vaultAccess: 'full' });
      const b = await api.createConversation({ title: 'Pi iOS transcript openai', provider: 'openai', model: 'pi-native-fixture', vaultAccess: 'full' });
      await select(a.id); const hello = await send(a.id, 'PI_UI:HELLO');
      await emit('awaiting-external-edit', { conversationId: a.id, projectionPath: (await api.getConversation(a.id)).projectionPath, content: hello.content });
      // Only DOM is polled before observation; getConversation cannot create this UI evidence.
      await conflict(); assert((await api.getConversation(a.id)).projectionConflict === 'edited', 'Wrong external conflict classification');
      await resolve('Keep edited copy as a note');
      await emit('awaiting-external-delete', { projectionPath: (await api.getConversation(a.id)).projectionPath });
      await conflict(); assert((await api.getConversation(a.id)).projectionConflict === 'missing', 'Deleted transcript was not classified'); await resolve('Restore transcript from chat');
      report.checks.push('watcher-driven external edit/delete and normal Convert/Restore buttons');
      const cited = await send(a.id, `PI_UI:READ:${source.noteId}`); assert(cited.citations.length, 'No admitted source citation');
      const saved = await api.prepareNoteSave!(a.id, cited.id); await select(a.id); await keep(saved.id);
      await until(async () => !(await api.listPendingProposals(a.id)).some(value => value.id === saved.id), 'Save receipt');
      const savedDraft = await api.getProposalDraft!(saved.id); const savedReceipt = await api.commitAgentProposal(saved.id, savedDraft.markdown, savedDraft.version);
      assert(savedReceipt.status === 'committed', 'Save was not committed'); report.receipts.saved = savedReceipt;
      await select(b.id); await send(b.id, 'PI_UI:HELLO'); await send(b.id, 'PI_UI:CREATE');
      const pendingProposal = (await api.listPendingProposals(b.id))[0]; assert(pendingProposal, 'No pending proposal');
      const initial = await api.getProposalDraft!(pendingProposal.id);
      const pending = await api.checkpointProposalDraft!(pendingProposal.id, { ...initial, title: 'Relocated iOS pending review', markdown: `${initial.markdown}\n\nAcknowledged iOS relocation checkpoint.` });
      await select(a.id); const uncertainProposal = await api.prepareNoteSave!(a.id, hello.id);
      await api.prototypeFault(uncertainProposal.id, 'receipt-write'); await select(a.id); await keep(uncertainProposal.id);
      await until(async () => (await api.listPendingProposals(a.id)).find(value => value.id === uncertainProposal.id && value.status === 'conflict'), 'uncertain native Keep acknowledgement');
      const uncertain = await api.getProposalDraft!(uncertainProposal.id);
      await select(b.id); await emit('awaiting-retained-conflict', { projectionPath: (await api.getConversation(b.id)).projectionPath }); await conflict();
      const vault = await invoke<{ runningPath: string }>('get_vault_info');
      const state: State = { phase: 'relocated', oldVault: vault.runningPath, a: a.id, b: b.id, source, cited, pendingId: pendingProposal.id, pending, uncertainId: uncertainProposal.id, uncertain,
        conversationIds: (await api.listConversations()).map(value => value.id) };
      await api.prototypeCheckpoint({ transcriptStateJson: JSON.stringify(state) });
      await emit('ready-to-relocate', { state, close: await close() });
      // The driver must terminate now. No Pi/API read follows portable closure.
      return report;
    }
    const state: State = JSON.parse(prior); assert(state.phase === 'relocated', 'Unexpected persisted probe phase');
    const vault = await invoke<{ runningPath: string }>('get_vault_info'); assert(vault.runningPath !== state.oldVault, 'Simulator sandbox did not actually relocate');
    const mapped = await invoke<string[]>('pi_resolve_locations', { paths: [state.source.path, state.pending.path, state.uncertain.path] });
    assert(mapped.every(path => path.startsWith(`${vault.runningPath}/`)), 'Native mapping escaped current vault');
    const conversations = await api.listConversations(); assert(JSON.stringify(conversations.map(value => value.id).sort()) === JSON.stringify(state.conversationIds.sort()), 'Sessions lost or legacy artifact imported');
    const pending = await api.getProposalDraft!(state.pendingId);
    assertAcknowledgedReview(state.pending, pending, mapped[1]);
    await select(state.b); await conflict(); assert((await api.getConversation(state.b)).projectionConflict === 'edited', 'Relocation erased true conflict');
    await emit('relocated-conflict-visible', { projectionPath: (await api.getConversation(state.b)).projectionPath }); await resolve('Restore transcript from chat');
    await review(state.pendingId);
    await until(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="note-title"]')).some(node => node.value === pending.title) && Array.from(document.querySelectorAll('[data-testid="note-editor"] .cm-content')).some(node => node.textContent?.includes('Acknowledged iOS relocation checkpoint.')), 'normal acknowledged review title/body');
    await emit('relocated-pending-visible', { proposalId: state.pendingId, draft: pending });
    await select(state.a); await keep(state.uncertainId);
    await until(async () => !(await api.listPendingProposals(state.a)).some(value => value.id === state.uncertainId), 'explicit UI Keep recovery');
    const recovered = await api.commitAgentProposal(state.uncertainId, state.uncertain.markdown, state.uncertain.version);
    assert(recovered.status === 'committed' && recovered.applied?.path === mapped[2], 'Keep receipt did not recover at native resolved path');
    const duplicate = await api.commitAgentProposal(state.uncertainId, state.uncertain.markdown, state.uncertain.version);
    assert(JSON.stringify(duplicate) === JSON.stringify(recovered), 'Duplicate Keep receipt changed'); report.receipts.recovered = recovered;
    await select(state.a); const citation = await until(() => Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-slot="inline-citation"]')).find(node => node.textContent?.includes(state.cited.citations[0].label)), 'actual source button'); citation.click();
    await until(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="note-title"]')).some(node => node.value === 'Pi transcript orchard'), 'native source editor');
    const origin = `${vault.runningPath}/Chats/Pi/${state.a}/Origin.md`; assert(await api.findConversationByProjectionPath(origin) === state.a, 'Stable Origin lookup failed');
    let rejected = false; try { await invoke('pi_resolve_locations', { paths: [`${state.oldVault}-unknown/Source.md`] }); } catch { rejected = true; } assert(rejected, 'Unknown root was guessed');
    report.checks.push('actual sandbox path changed; pending body/version and real conflict retained', 'explicit UI uncertain Keep recovery and duplicate API Keep', 'normal source button opens native editor; stable Origin lookup and unknown-root rejection');
    report.receipts.close = await close(); report.status = 'passed'; await emit('complete');
  } catch (error) { report.status = 'failed'; report.error = String(error); await emit('failed'); }
  return report;
}
