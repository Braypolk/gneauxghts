// Explicit opt-in probe of the existing workspace, never an alternate UI/runtime.
import { invoke } from '@tauri-apps/api/core';
import { EditorView } from '@codemirror/view';
import { chatApi, type ChatApi } from '$lib/features/chat/api';
import type { ChatProposalDraft, ChatMessage } from '$lib/features/chat/types';
import { assertAcknowledgedReview } from './iosTranscriptContract';
import { acknowledgedProbeDraft, acquireProbeReview } from './probeReview';
import { reviewProjection } from '$lib/features/proposals/reviewExtension';
import { openVisibleProbeChat } from './probeChatFocus';

type ProbeApi = ChatApi & {
  prototypeState(): Promise<{ transcriptStateJson?: string } | undefined>;
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
type ProbeTrace = (step: string, detail?: Record<string, unknown>) => void;
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
function describeControl(node: Element) {
  try {
    const element = node as HTMLElement;
    const style = getComputedStyle(element);
    return { tag: node.tagName, label: (node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '').slice(0, 160),
      paneId: node.closest<HTMLElement>('[data-testid="workspace-pane"]')?.dataset.paneId,
      hidden: Boolean(node.closest('[hidden]')), inert: Boolean(node.closest('[inert]')),
      ariaHidden: Boolean(node.closest('[aria-hidden="true"]')), rectangles: element.getClientRects().length,
      visibility: style.visibility, display: style.display, disabled: (element as HTMLButtonElement).disabled === true };
  } catch (error) { return { captureError: String(error).slice(0, 400) }; }
}
/** Bounded DOM evidence only; it never activates controls or reveals a surface. */
export function iosTranscriptDomReceipt() {
  try {
    return {
      active: document.activeElement ? describeControl(document.activeElement) : undefined,
      panes: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="workspace-pane"]')).slice(0, 8).map(pane => ({
        ...describeControl(pane), kind: pane.dataset.paneKind, collapsed: pane.hasAttribute('data-pane-collapsed'),
        frameInert: pane.querySelector('[data-pane-frame]')?.hasAttribute('inert'),
        frameAriaHidden: pane.querySelector('[data-pane-frame]')?.getAttribute('aria-hidden'),
      })),
      chats: Array.from(document.querySelectorAll<HTMLElement>('[aria-label="Thought partner chat"]')).slice(0, 8).map(describeControl),
      titles: Array.from(document.querySelectorAll<HTMLInputElement>('[aria-label="Chat title"]')).slice(0, 8).map(node => ({ ...describeControl(node), title: node.value.slice(0, 160) })),
      composers: Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Message"]')).slice(0, 8).map(node => ({
        ...describeControl(node), inDock: Boolean(node.closest('.workspace-chat-slot')), dockMode: node.closest<HTMLElement>('[data-input-dock-mode]')?.dataset.inputDockMode,
      })),
      controls: Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(node => /^(Expand |Open thought partner|Conversations|Review in editor|Keep All|Keep Remaining|Retry|Restore transcript from chat|Save to note)/.test(node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '')).slice(0, 24).map(describeControl),
    };
  } catch (error) { return { captureError: String(error).slice(0, 400) }; }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until<T>(read: () => T | Promise<T>, label: string, timeout = 45000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (value) return value as NonNullable<T>; await pause(); }
  throw new Error(`iOS transcript deadline: ${label}`);
}
const button = (label: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(node => !node.disabled && (node.textContent?.trim() === label || node.getAttribute('aria-label') === label));
async function click(label: string, root: ParentNode = document) { (await until(() => button(label, root), label)).click(); await pause(); }
async function open(trace: ProbeTrace) {
  trace('open:begin');
  await openVisibleProbeChat(async <T>(read: () => T | Promise<T>, label: string) => {
    trace('open:wait', { label });
    const value = await until(read, label);
    if (label === 'visible normal chat expansion control') {
      const selected = value as unknown as { kind: string; node?: HTMLElement };
      trace('open:control', { kind: selected.kind, control: selected.node ? describeControl(selected.node) : undefined });
    }
    return value;
  });
  trace('open:ready');
}
async function select(id: string, trace: ProbeTrace) {
  trace('select:begin', { id });
  await open(trace); const conversation = await api.getConversation(id); await click('Conversations');
  (await until(() => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(node => node.textContent?.trim() === conversation.title), 'conversation picker')).click();
  await until(() => document.querySelector<HTMLInputElement>('[aria-label="Chat title"]')?.value === conversation.title, 'selected conversation');
  trace('select:ready', { id });
}
async function send(id: string, content: string) {
  const count = (await api.getConversation(id)).messages.length;
  const field = await until(() => { const node = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]'); return node && !node.disabled ? node : undefined; }, 'composer');
  field.focus(); field.value = content; field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content })); await click('Send message');
  const message = await until(async () => { const messages = (await api.getConversation(id)).messages; const value = messages.length > count && messages.at(-1); return value && !['pending', 'streaming'].includes(value.status) ? value : undefined; }, 'terminal committed assistant');
  assert(message.status === 'completed', `Request ${message.status}: ${message.errorMessage}`); return message;
}
async function review(id: string, trace: ProbeTrace) {
  trace('review:begin', { id });
  const draft = await api.getProposalDraft!(id);
  const editor = () => Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="note-title"]')).some(node => node.value === draft.title)
    ? Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')).map(node => EditorView.findFromDOM(node)).find(view => view?.state.doc.toString() === draft.markdown)
    : undefined;
  await acquireProbeReview({ editor, openChat: () => open(trace), until,
    card: () => document.querySelector(`section[data-proposal-id="${id}"]`) ?? undefined,
    openCard: card => { trace('review:open-card', { id }); return click('Review in editor', card); } });
  trace('review:editor-ready', { id });
  await open(trace);
  return until(() => document.querySelector(`[data-proposal-strip="active"][data-proposal-id="${id}"]`), 'normal review strip');
}
async function wholeSave(conversationId: string, messageId: string, trace: ProbeTrace) {
  trace('save:begin', { conversationId, messageId });
  await open(trace);
  const before = new Set((await api.listPendingProposals(conversationId)).map(value => value.id));
  const answer = await until(() => document.querySelector(`[data-chat-message-id="${messageId}"]`), 'exact message Save control');
  await click('Save to note', answer);
  return until(async () => (await api.listPendingProposals(conversationId)).find(value => !before.has(value.id)), 'UI-staged whole-answer Save');
}
async function acknowledgedPending(id: string, trace: ProbeTrace) {
  await review(id, trace);
  const draft = await api.getProposalDraft!(id);
  const editor = await until(() => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor'))
    .map(node => EditorView.findFromDOM(node)).find(view => view?.state.doc.toString() === draft.markdown && view.state.field(reviewProjection, false)?.hunks.length), 'mounted creation review decisions');
  const title = editor.dom.closest('[data-pane-frame]')?.querySelector<HTMLInputElement>('[data-testid="note-title"]');
  assert(title, 'Mounted pending review has no corresponding title');
  return acknowledgedProbeDraft({ draft: () => api.getProposalDraft!(id), until,
    working: () => {
      const projection = editor.state.field(reviewProjection, false);
      assert(projection, 'Pending review projection disappeared before acknowledgement');
      return { markdown: editor.state.doc.toString(), title: title.value, path: draft.path, decisions: projection.hunks };
    } });
}
async function keep(id: string, trace: ProbeTrace) {
  const strip = await review(id, trace);
  const control = await until(() => button('Keep All', strip) ?? button('Keep Remaining', strip) ?? button('Retry', strip), 'normal Keep or Retry');
  trace('keep:control', { id, control: describeControl(control) }); control.click();
}
async function conflict() { await until(() => button('Restore transcript from chat'), 'watcher-driven conflict UI'); }
async function resolve(label: string) { await click(label); await until(() => !button('Restore transcript from chat'), 'conflict resolved'); }

export async function runIosTranscriptProbe(): Promise<IosTranscriptReport | undefined> {
  if (!new URL(location.href).searchParams.has('piTranscriptTest')) return;
  const config = await invoke<{ fixture: boolean; interactiveGate: boolean; expandedGate: boolean }>('pi_probe_config');
  if (!config.fixture || !config.interactiveGate || !config.expandedGate) return;
  const report: IosTranscriptReport = { gate: 'ios-native-transcript-fixture', launchId: crypto.randomUUID(), phase: 'starting', status: 'running', checks: [], receipts: {},
    limits: ['Synthetic protocols and programmatic normal UI actions in WKWebView; no physical touch, live provider or pressure behavior is established.',
      'Driver moves owned vault and Pi/native state between fresh simulator sandbox paths; standalone Settings-selected vault relocation is not established.'] };
  const transitions: Record<string, unknown>[] = [];
  report.receipts.trace = transitions;
  const trace: ProbeTrace = (step, detail) => {
    if (transitions.length === 48) transitions.shift();
    transitions.push({ step, atMs: performance.now(), ...detail });
  };
  const emit = async (phase: string, receipt?: unknown) => { report.phase = phase; if (receipt !== undefined) report.receipts[phase] = receipt; await invoke('pi_ui_report', { report }); };
  const close = async () => {
    const receipt = await invoke<{ ready: boolean; timelinePortable: boolean }>('prepare_restart');
    assert(receipt.ready && receipt.timelinePortable, 'Native restart did not close to portable state'); return receipt;
  };
  try {
    await until(() => document.querySelector('[data-testid="workspace-pane"]'), 'normal native workspace');
    const prior = (await api.prototypeState())?.transcriptStateJson;
    if (!prior) {
      assert(!(await api.listConversations()).length, 'Fresh generated simulator container required');
      const source = await invoke<{ noteId: string; path: string }>('save_note', { title: 'Pi transcript orchard', markdown: 'The synthetic orchard has seven pear trees.', currentPath: null });
      await invoke('finalize_note_editing_window', { noteId: source.noteId });
      const a = await api.createConversation({ title: 'Pi iOS transcript local', provider: 'local', model: 'pi-native-fixture', vaultAccess: 'full' });
      const b = await api.createConversation({ title: 'Pi iOS transcript openai', provider: 'openai', model: 'pi-native-fixture', vaultAccess: 'full' });
      await select(a.id, trace); const hello = await send(a.id, 'PI_UI:HELLO');
      await emit('awaiting-external-edit', { conversationId: a.id, projectionPath: (await api.getConversation(a.id)).projectionPath, content: hello.content });
      // Only DOM is polled before observation; getConversation cannot create this UI evidence.
      await conflict(); assert((await api.getConversation(a.id)).projectionConflict === 'edited', 'Wrong external conflict classification');
      await resolve('Keep edited copy as a note');
      await emit('awaiting-external-delete', { projectionPath: (await api.getConversation(a.id)).projectionPath });
      await conflict(); assert((await api.getConversation(a.id)).projectionConflict === 'missing', 'Deleted transcript was not classified'); await resolve('Restore transcript from chat');
      report.checks.push('watcher-driven external edit/delete and normal Convert/Restore buttons');
      trace('watcher:resolved');
      const cited = await send(a.id, `PI_UI:READ:${source.noteId}`); assert(cited.citations.length, 'No admitted source citation');
      trace('citation:admitted', { messageId: cited.id });
      const saved = await wholeSave(a.id, cited.id, trace); await keep(saved.id, trace);
      await until(async () => !(await api.listPendingProposals(a.id)).some(value => value.id === saved.id), 'Save receipt');
      const savedDraft = await api.getProposalDraft!(saved.id); const savedReceipt = await api.commitAgentProposal(saved.id, savedDraft.markdown, savedDraft.version);
      assert(savedReceipt.status === 'committed', 'Save was not committed'); report.receipts.saved = savedReceipt;
      trace('save:committed', { proposalId: saved.id });
      await select(b.id, trace); await send(b.id, 'PI_UI:HELLO'); await send(b.id, 'PI_UI:CREATE');
      const pendingProposal = (await api.listPendingProposals(b.id))[0]; assert(pendingProposal, 'No pending proposal');
      const initial = await api.getProposalDraft!(pendingProposal.id);
      const stagedPending = await api.checkpointProposalDraft!(pendingProposal.id, { ...initial, title: 'Relocated iOS pending review', markdown: `${initial.markdown}\n\nAcknowledged iOS relocation checkpoint.` });
      const pending = await acknowledgedPending(pendingProposal.id, trace);
      assert(pending.markdown === stagedPending.markdown && pending.title === stagedPending.title && pending.path === stagedPending.path, 'Mounting changed pending authored fields');
      assert(pending.decisions.length, 'Mounted creation decisions must be acknowledged before relocation');
      await select(a.id, trace); const uncertainProposal = await wholeSave(a.id, hello.id, trace);
      await api.prototypeFault(uncertainProposal.id, 'receipt-write'); await keep(uncertainProposal.id, trace);
      await until(async () => (await api.listPendingProposals(a.id)).find(value => value.id === uncertainProposal.id && value.status === 'conflict'), 'uncertain native Keep acknowledgement');
      const uncertain = await api.getProposalDraft!(uncertainProposal.id);
      await select(b.id, trace); await emit('awaiting-retained-conflict', { projectionPath: (await api.getConversation(b.id)).projectionPath }); await conflict();
      const vault = await invoke<{ runningPath: string }>('get_vault_info');
      const state: State = { phase: 'relocated', oldVault: vault.runningPath, a: a.id, b: b.id, source, cited, pendingId: pendingProposal.id, pending, uncertainId: uncertainProposal.id, uncertain,
        conversationIds: (await api.listConversations()).map(value => value.id) };
      await api.prototypeCheckpoint({ transcriptStateJson: JSON.stringify(state) });
      trace('relocation:checkpoint-acknowledged');
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
    await select(state.b, trace); await conflict(); assert((await api.getConversation(state.b)).projectionConflict === 'edited', 'Relocation erased true conflict');
    await emit('relocated-conflict-visible', { projectionPath: (await api.getConversation(state.b)).projectionPath }); await resolve('Restore transcript from chat');
    await review(state.pendingId, trace);
    await until(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="note-title"]')).some(node => node.value === pending.title) && Array.from(document.querySelectorAll('[data-testid="note-editor"] .cm-content')).some(node => node.textContent?.includes('Acknowledged iOS relocation checkpoint.')), 'normal acknowledged review title/body');
    await emit('relocated-pending-visible', { proposalId: state.pendingId, draft: pending });
    await select(state.a, trace); await keep(state.uncertainId, trace);
    await until(async () => !(await api.listPendingProposals(state.a)).some(value => value.id === state.uncertainId), 'explicit UI Keep recovery');
    const recovered = await api.commitAgentProposal(state.uncertainId, state.uncertain.markdown, state.uncertain.version);
    assert(recovered.status === 'committed' && recovered.applied?.path === mapped[2], 'Keep receipt did not recover at native resolved path');
    const duplicate = await api.commitAgentProposal(state.uncertainId, state.uncertain.markdown, state.uncertain.version);
    assert(JSON.stringify(duplicate) === JSON.stringify(recovered), 'Duplicate Keep receipt changed'); report.receipts.recovered = recovered;
    await select(state.a, trace); const citation = await until(() => Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-slot="inline-citation"]')).find(node => node.textContent?.includes(state.cited.citations[0].label)), 'actual source button'); citation.click();
    await until(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="note-title"]')).some(node => node.value === 'Pi transcript orchard'), 'native source editor');
    const origin = `${vault.runningPath}/Chats/Pi/${state.a}/Origin.md`; assert(await api.findConversationByProjectionPath(origin) === state.a, 'Stable Origin lookup failed');
    let rejected = false; try { await invoke('pi_resolve_locations', { paths: [`${state.oldVault}-unknown/Source.md`] }); } catch { rejected = true; } assert(rejected, 'Unknown root was guessed');
    report.checks.push('actual sandbox path changed; pending body/version and real conflict retained', 'explicit UI uncertain Keep recovery and duplicate API Keep', 'normal source button opens native editor; stable Origin lookup and unknown-root rejection');
    report.receipts.close = await close(); report.status = 'passed'; await emit('complete');
  } catch (error) { report.status = 'failed'; report.error = String(error); report.receipts.failedDom = iosTranscriptDomReceipt(); await emit('failed'); }
  return report;
}
