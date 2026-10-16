// Fixture-only driver of the existing workspace. It never mounts an alternate
// view or writes generic chat rows; public Pi API reads inspect UI operations.
import { invoke } from '@tauri-apps/api/core';
import { EditorView } from '@codemirror/view';
import { chatApi, type ChatApi } from '$lib/features/chat/api';
import { nativeTransportStats } from './nativeProvider';
import type { ChatMessage, ChatProposalDraft } from '$lib/features/chat/types';
import { acknowledgedProbeDraft, acquireProbeReview } from './probeReview';
import { reviewProjection } from '$lib/features/proposals/reviewExtension';
import { openProbeChatSplit } from './probeSplit';
import { openVisibleProbeChat, visibleProbeControl } from './probeChatFocus';
import { revealProbeReadActivity } from './probeReadActivity';
import { focusProbeChatComposer, probeChatPane, probeComposerSend, probeChatSendDiagnostics } from './probeChatSend';
import { probePaneTitle } from './probePaneTitle';
import { assertSharedKeepDraft, assertSharedMountedReview, assertSharedPublication, expectedSharedEditorMarkdown, expectedSharedKeepDraft, sharedProofDigest, type SharedCanonicalNote, type SharedKeepPlan } from './sharedKeepProof';

type State = { a: string; b: string; permission: string; source: { noteId: string; path: string }; keepId?: string; discardId?: string;
  editedBody?: string; editedTitle?: string; stoppedId?: string; interruptedId?: string; savedId?: string; savedNoteId?: string; savedPath?: string };
type ProbeApi = ChatApi & { prototypeState(): Promise<{ interactiveStateJson?: string }>; prototypeCheckpoint(value: unknown): Promise<void>; prototypeFault(id: string, fault: string): Promise<void> };
const api = chatApi as ProbeApi;
const timings: Array<Record<string, unknown>> = [];
const trace = (event: string, detail: Record<string, unknown> = {}) => timings.push({ event, at: Date.now(), ...detail });
const visibleButtons = () => [...new Set(Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  .filter(node => !node.disabled).map(node => node.getAttribute('aria-label') ?? node.textContent?.trim())
  .filter(label => label === 'Send message' || label === 'Stop response' || label === 'Retry'))];
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until<T>(read: () => T | Promise<T>, description: string, timeout = 30000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => {
      trace('predicateDeadline', { description });
      reject(new Error(`Interactive UI predicate deadline: ${description}`));
    }, Math.max(1, end - Date.now())); });
    let value: T;
    try { value = await Promise.race([Promise.resolve().then(read), expired]); }
    finally { clearTimeout(timer); }
    if (value) return value as NonNullable<T>;
    await pause();
  }
  throw new Error(`Interactive UI deadline: ${description}`);
}
const button = (label: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(node => !node.disabled && (node.textContent?.trim() === label || node.getAttribute('aria-label') === label));
async function click(label: string, root: ParentNode = document) { (await until(() => button(label, root), label)).click(); await pause(); }
function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.focus(); element.value = value; element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
}
async function openChat() {
  await openVisibleProbeChat(until);
}
async function selectConversation(id: string) {
  await openChat(); const conversation = await api.getConversation(id);
  const pane = await until(() => probeChatPane(conversation.title) ?? probeChatPane(), 'normal chat pane for conversation picker');
  trace('pickerComposerAcquire', { conversationId: id, paneId: pane.dataset.paneId, title: conversation.title });
  await focusProbeChatComposer(pane, until);
  await click('Conversations', pane);
  const item = await until(() => Array.from(pane.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(node => node.textContent?.trim() === conversation.title), 'conversation picker item');
  item.click();
  await until(() => probePaneTitle(pane, 'chat')?.value === conversation.title, 'selected chat title in picker owner pane');
}
async function startSend(id: string, content: string) {
  const debug = /PI_UI:(STOP|INTERRUPT)/.test(content);
  if (debug) trace('startSend', { conversationId: id, content });
  const snapshot = await until(() => api.getConversation(id), 'conversation snapshot before UI send');
  const count = snapshot.messages.length;
  // Review editing can leave the retained compact chat behind an inert rail.
  // Reveal it with normal workspace controls before requiring its visible title.
  await openChat();
  const pane = await until(() => probeChatPane(snapshot.title), 'requested conversation mounted in normal chat pane');
  trace('sendComposerAcquire', { conversationId: id, paneId: pane.dataset.paneId, title: snapshot.title });
  const composer = await focusProbeChatComposer(pane, until);
  input(composer, content);
  const sendControl = await until(() => probeComposerSend(composer), 'requested composer Send message');
  trace('sendClick', { conversationId: id, paneId: pane.dataset.paneId, title: snapshot.title, content, visibleComposer: true });
  sendControl.click(); await pause();
  const admitted = await until(async () => { const messages = (await api.getConversation(id)).messages; return messages.length > count ? messages.at(-1) : undefined; }, 'Pi admission of UI send');
  if (debug) trace('startSendReturned', { content, messageId: admitted.id, status: admitted.status, buttons: visibleButtons() });
  return admitted;
}
async function terminal(id: string, messageId: string) {
  return until(async () => { const message = (await api.getConversation(id)).messages.find(value => value.id === messageId); return message && !['streaming', 'pending'].includes(message.status) ? message : undefined; }, 'terminal UI request');
}
async function send(id: string, content: string) {
  const message = await terminal(id, (await startSend(id, content)).id);
  assert(message.status === 'completed', `UI send did not complete (${message.status}): ${message.errorMessage}`);
  await until(() => Array.from(document.querySelectorAll('[aria-label="Assistant response"]')).some(node => node.textContent?.includes(message.content.replace(/\[.*?\]\(.*?\)/g, '').trim().slice(0, 25))), 'rendered admitted answer');
  return message;
}
async function currentReview(id: string, reviewId?: string) {
  const draft = await api.getProposalDraft!(id);
  const editor = () => {
    return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')).map(node => EditorView.findFromDOM(node)).find(view => view?.dom.isConnected && view.state.doc.toString() === draft.markdown && probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor')?.value === draft.title && (reviewId === undefined || view.state.field(reviewProjection, false)?.reviewId === reviewId));
  };
  return acquireProbeReview({ editor, openChat, until,
    card: () => document.querySelector(`section[data-proposal-id="${id}"]`) ?? undefined,
    openCard: card => click('Review in editor', card) });
}
async function editReview(id: string, body: string, title: string) {
  const view = await currentReview(id);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body }, userEvent: 'input.type' });
  const field = await until(() => { const title = probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor'); return title && !title.readOnly && visibleProbeControl(title) ? title : undefined; }, 'review title');
  input(field, title); await pause(); field.blur();
  return until(async () => { const draft = await api.getProposalDraft!(id); return draft.markdown === body && draft.title === title ? draft : undefined; }, 'acknowledged body/title checkpoint');
}
async function settleReview(id: string, keep: boolean, conversationId: string, beforeKeep?: (plan: SharedKeepPlan) => Promise<void>) {
  const pending = (await api.listPendingProposals(conversationId)).find(proposal => proposal.id === id);
  const reviewId = pending?.preview.reviewId;
  assert(typeof reviewId === 'string' && reviewId.length > 0, 'Shared proposal lacks exact pending review identity');
  const view = await currentReview(id, reviewId);
  let plan: SharedKeepPlan | undefined;
  if (keep) {
    assert(beforeKeep, 'Shared Keep requires independently recorded pre-click plan');
    const draft = await acknowledgedProbeDraft({ draft: () => api.getProposalDraft!(id), until, working: () => {
      const projection = view.state.field(reviewProjection, false);
      const title = probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor')?.value;
      assert(view.dom.isConnected && projection?.reviewId === reviewId && title !== undefined, 'Mounted shared review identity or connection differs');
      return { markdown: view.state.doc.toString(), title, decisions: projection.hunks };
    } });
    assertSharedMountedReview(draft, reviewId, { connected: view.dom.isConnected, markdown: view.state.doc.toString(),
      title: probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor')?.value, projection: view.state.field(reviewProjection, false) });
    const expectedKeepDraft = expectedSharedKeepDraft(draft, reviewId);
    const expectedEditorMarkdown = expectedSharedEditorMarkdown(expectedKeepDraft);
    plan = { proposalId: id, reviewId, expectedNoteId: pending?.noteId ?? null, reviewedDraft: structuredClone(draft), expectedKeepDraft,
      expectedEditorMarkdown, expectedDraftSha256: await sharedProofDigest(JSON.stringify(expectedKeepDraft)), expectedEditorSha256: await sharedProofDigest(expectedEditorMarkdown) };
    await beforeKeep(plan);
  }
  await openChat();
  const strip = await until(() => document.querySelector(`[data-proposal-strip="active"][data-proposal-id="${id}"]`), 'normal review action strip');
  if (keep) {
    const action = await until(() => button('Keep All', strip) ?? button('Keep Remaining', strip), 'Keep All');
    const current = (await api.listPendingProposals(conversationId)).find(proposal => proposal.id === id);
    assert(current?.preview.reviewId === reviewId, 'Pending shared review identity changed before normal Keep');
    assertSharedKeepDraft(plan!.reviewedDraft, await api.getProposalDraft!(id));
    action.click();
  }
  else await click('Discard', strip);
  await until(async () => !(await api.listPendingProposals(conversationId)).some(proposal => proposal.id === id), keep ? 'native Keep receipt' : 'native Discard');
  const settled = await api.getProposalDraft!(id);
  if (plan) assertSharedKeepDraft(plan.expectedKeepDraft, settled);
  return settled;
}
async function newProposal(id: string, prompt: string) {
  const before = new Set((await api.listPendingProposals(id)).map(value => value.id));
  await send(id, prompt);
  return until(async () => (await api.listPendingProposals(id)).find(value => !before.has(value.id)), 'Pi-owned pending proposal');
}
async function setModel(id: string, provider: 'local' | 'openai', model: string) {
  await click('AI model'); const picker = await until(() => document.querySelector('[aria-label="AI model picker"]'), 'normal model picker');
  await click(provider === 'local' ? 'Server' : 'ChatGPT', picker);
  const field = await until(() => picker.querySelector<HTMLInputElement>('[aria-label="Custom model ID"]'), 'model ID field'); input(field, model);
  await click('Use', picker);
  await until(async () => { const conversation = await api.getConversation(id); return conversation.provider === provider && conversation.model === model; }, 'Pi model configuration');
}
async function openSource(message: ChatMessage) {
  assert(message.citations.length, 'No admitted current citation');
  const label = message.citations[0].label;
  const citation = await until(() => Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-slot="inline-citation"]')).find(node => node.textContent?.includes(label)), 'normal current source button');
  citation.click();
  return until(() => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')).map(node => EditorView.findFromDOM(node)).find(view => view?.state.doc.toString().includes('orchard')), 'current note opened by citation');
}

/** Compact Keep returns to chat and can unmount the editor. Re-enter through
 * the originating message's ordinary committed Save action before keyboard
 * navigation; the saved Note Identity, canonical bytes and mounted title/body
 * must all agree with the already independently verified append result. */
export async function openSharedSavedOrigin(conversationId: string, messageId: string, expected: SharedCanonicalNote) {
  await selectConversation(conversationId);
  const conversation = await api.getConversation(conversationId);
  const message = conversation.messages.find(value => value.id === messageId);
  assert(expected.noteId && expected.path && message?.savedNote?.noteId === expected.noteId && message.savedNote.path === expected.path,
    'Originating message Open note target differs from exact saved Note Identity/path');
  const card = await until(() => document.querySelector(`[data-chat-message-id="${messageId}"]`), 'originating message saved Open note card');
  const open = await until(() => Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find(node =>
    node.isConnected && !node.disabled && visibleProbeControl(node) && node.getAttribute('aria-label') === 'Open note'), 'visible originating message Open note control');
  open.click();
  // A retained editor can already match the note while this ordinary Open
  // operation is still restoring it. Wait for the clicked action's actual
  // awaited completion before acquiring a view or selecting its origin link.
  await until(() => open.getAttribute('aria-busy') === 'false' && !open.disabled,
    'originating message Open note operation completed');
  const canonical = await invoke<SharedCanonicalNote>('read_note', { noteId: expected.noteId, path: expected.path });
  assert(canonical.noteId === expected.noteId && canonical.path === expected.path && canonical.title === expected.title && canonical.markdown === expected.markdown,
    'Opened saved canonical identity, body, title or path differs from exact final append');
  const savedEditor = await until(() => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor'))
    .map(node => EditorView.findFromDOM(node)).find(view => view?.dom.isConnected && visibleProbeControl(view.dom) &&
      view.dom.closest('[data-testid="note-editor"]')?.getAttribute('aria-busy') === 'false' &&
      view.state.doc.toString() === expected.markdown && probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor')?.value === expected.title),
  'exact saved target mounted by normal Open note');
  const originPosition = savedEditor.state.doc.toString().indexOf('[[Chats/Pi/'); assert(originPosition >= 0, 'Saved origin link absent');
  savedEditor.dispatch({ selection: { anchor: originPosition + 4 }, scrollIntoView: true });
  savedEditor.focus();
  // @codemirror/view/dist/index.js selects browser.mac for Mod bindings using
  // this exact Apple-mobile-or-Mac rule; iPhone/iPad platforms need Meta too.
  const appleMobile = /Apple Computer/.test(navigator.vendor) && (/Mobile\/\w+/.test(navigator.userAgent) || navigator.maxTouchPoints > 2);
  const metaKey = appleMobile || /Mac/.test(navigator.platform);
  // Observe the ordinary anchor effect rather than accepting a chat/card that
  // was already present in a desktop split. Begin immediately before keydown:
  // there is no async window for unrelated navigation to satisfy this proof.
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let anchorScroll: ScrollIntoViewOptions | undefined;
  let anchorTarget: HTMLElement | undefined;
  let anchorPane: HTMLElement | undefined;
  const exactVisibleOrigin = (target: HTMLElement | undefined, pane: HTMLElement | undefined) => {
    const title = probePaneTitle(pane, 'chat');
    return target?.getAttribute('data-chat-message-id') === messageId && target.isConnected && visibleProbeControl(target) &&
      pane?.dataset.paneKind === 'chat' && !pane.closest('[hidden]') && visibleProbeControl(pane) &&
      title?.value === conversation.title && visibleProbeControl(title) && target.closest('[data-testid="workspace-pane"]') === pane;
  };
  Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
    const target = this as HTMLElement;
    const pane = target.closest<HTMLElement>('[data-testid="workspace-pane"]') ?? undefined;
    if (typeof options === 'object' && options.block === 'center' && ['auto', 'smooth', 'instant'].includes(options.behavior ?? '') &&
      exactVisibleOrigin(target, pane)) {
      anchorScroll = { ...options }; anchorTarget = target; anchorPane = pane;
    }
    originalScrollIntoView.call(this, options);
  };
  try {
    savedEditor.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', metaKey, ctrlKey: !metaKey, bubbles: true, cancelable: true }));
    // A split can display this conversation twice. Verify the exact element
    // actually scrolled by the link, rather than the first retained chat card.
    await until(() => anchorScroll && exactVisibleOrigin(anchorTarget, anchorPane),
      'Open in chat scrolls to exact originating message');
  } finally {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  }
  return { noteId: canonical.noteId, path: canonical.path, title: canonical.title, conversationId, messageId, anchorScroll,
    keyboardPlatform: { platform: navigator.platform, appleMobile, metaKey, ctrlKey: !metaKey } };
}

export async function runInteractiveProbe() {
  const config = await invoke<{ fixture: boolean; interactiveGate: boolean }>('pi_probe_config');
  if (!config.fixture || !config.interactiveGate) return;
  (window as Window & { __piInteractiveTimings?: typeof timings }).__piInteractiveTimings = timings;
  const phase = new URL(location.href).searchParams.get('piInteractiveTest');
  const report: { gate: string; phase: string | null; status: string; checks: string[]; receipts: Record<string, unknown>; error?: string; visible?: string } = {
    gate: 'first-usable-desktop-fixture', phase, status: 'running', checks: [], receipts: { timings }
  };
  const publish = async () => {
    try { await invoke('pi_ui_report', { report }); return report; }
    catch (error) {
      const compact = { ...report, status: 'failed', visible: undefined,
        error: [report.error?.slice(0, 1500), `Report publication failed: ${String(error).slice(0, 1500)}`].filter(Boolean).join('\n'),
        receipts: { publicationFailure: true, timingCount: timings.length, lastTiming: timings.at(-1) } };
      (window as Window & { __piInteractiveReportFailure?: unknown }).__piInteractiveReportFailure = compact;
      console.error(compact.error);
      await invoke('pi_ui_report', { report: compact });
      return compact;
    }
  };
  const mark = async (name: string, receipt?: unknown) => {
    report.checks.push(name); if (receipt !== undefined) report.receipts[name] = receipt;
    const published = await publish();
    if (published.status === 'failed') throw new Error(published.error);
  };
  const persist = (state: State) => api.prototypeCheckpoint({ interactiveStateJson: JSON.stringify(state) });
  const proveKeep = async (id: string, conversationId: string, role: 'kept' | 'saved' | 'appended', reviewed: ChatProposalDraft) => {
    let plan: SharedKeepPlan | undefined;
    const settled = await settleReview(id, true, conversationId, async value => {
      plan = value;
      // Normal review mounting may seed/acknowledge hunks after the caller's
      // staged API snapshot. Preserve its authored fields while the connected,
      // acknowledged capture owns the independent version/decision prediction.
      assert(reviewed.markdown === value.reviewedDraft.markdown && reviewed.title === value.reviewedDraft.title && reviewed.path === value.reviewedDraft.path,
        'Mounted shared review changed caller-authored body, title or path');
      const plans = (report.receipts.publicationPlans ??= {}) as Record<string, SharedKeepPlan>;
      plans[role] = value;
      const published = await publish(); // Retain the independent expectation before normal Keep.
      assert(published.status !== 'failed', published.error ?? 'Shared pre-click plan publication failed');
    });
    assert(plan, 'Missing shared pre-click publication plan');
    const receipt = await api.commitAgentProposal(id, plan.expectedKeepDraft.markdown, plan.expectedKeepDraft.version);
    const canonical = await invoke<SharedCanonicalNote>('read_note', { noteId: receipt.noteId, path: plan.expectedKeepDraft.path });
    assertSharedPublication(plan, receipt, canonical);
    report.receipts[role] = receipt;
    const proofs = (report.receipts.publicationReadBacks ??= {}) as Record<string, unknown>;
    proofs[role] = { settledDraft: settled, canonical, editorSha256: await sharedProofDigest(canonical.markdown) };
    return receipt;
  };
  try {
    await until(() => document.querySelector('[data-testid="workspace-pane"]'), 'actual native workspace');
    if (phase === 'seed') {
      assert(!(await api.listConversations()).length, 'Interactive gate requires fresh synthetic Pi storage');
      const source = await invoke<{ noteId: string; path: string }>('save_note', { title: 'Pi interactive orchard', markdown: 'The synthetic orchard once had six pear trees.', currentPath: null });
      await invoke('finalize_note_editing_window', { noteId: source.noteId });
      await invoke('save_note', { title: 'Pi interactive orchard', markdown: 'The synthetic orchard has seven pear trees.', currentPath: source.path });
      await invoke('finalize_note_editing_window', { noteId: source.noteId });
      const a = await api.createConversation({ title: 'Pi interactive A', vaultAccess: 'full', provider: 'local', model: 'pi-native-fixture' });
      const b = await api.createConversation({ title: 'Pi interactive B', vaultAccess: 'full', provider: 'openai', model: 'pi-native-fixture' });
      const permission = await api.createConversation({ title: 'Pi interactive permission', vaultAccess: 'approved', provider: 'local', model: 'pi-native-fixture' });
      await persist({ a: a.id, b: b.id, permission: permission.id, source });
      await mark('fresh synthetic setup uses Pi conversations and canonical native note command');
    } else {
      const json = (await api.prototypeState()).interactiveStateJson; assert(json, 'Missing Pi-owned interactive setup'); const state: State = JSON.parse(json);
      await openChat();
      if (phase === 'failures') {
        assert(state.savedId && state.savedNoteId, 'Complete the base relaunch journey before failure acceptance');
        const { runInteractiveFailures } = await import('./interactiveFailures');
        await runInteractiveFailures({ api, conversationId: state.a, selectConversation, send, startSend, terminal, newProposal, currentReview, openSource, openChat, mark });
      } else if (phase === 'first') {
        await selectConversation(state.a);
        const hello = await send(state.a, 'PI_UI:HELLO'); await mark('ordinary UI send', { messageId: hello.id, status: hello.status });
        await send(state.a, 'PI_UI:FOLLOWUP'); await mark('source-free follow-up receives previous answer');
        await selectConversation(state.b); await send(state.b, 'PI_UI:HELLO');
        assert((await api.getConversation(state.b)).messages.length === 2, 'Session message leak');
        await selectConversation(state.a); await mark('normal conversation picker isolates sessions');
        await setModel(state.a, 'local', 'pi-native-fixture-b'); await send(state.a, 'PI_UI:MODEL'); await mark('normal model picker changes native dispatch');
        const cited = await send(state.a, `PI_UI:READ:${state.source.noteId}`);
        let editor = await openSource(cited); await mark('current source admitted and normal citation opens canonical editor');
        // A single-pane editor is unmounted when it becomes chat, so its
        // selection cannot be read by the composer. Use the ordinary split
        // control to keep the selected editor mounted beside the chat.
        if (!document.querySelector('[aria-label="Thought partner chat"]')) {
          const visible = (node: HTMLButtonElement) => !node.disabled && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
          const splitKind = await openProbeChatSplit({ until, pause,
            visibleButton: label => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node => visible(node) && (node.getAttribute('aria-label') === label || node.textContent?.trim() === label)),
            mobileThoughtPartner: () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-pane-command="split"] button#pane-command-thought-partner')).find(visible) });
          trace('normalChatSplit', { control: splitKind });
          await until(() => document.querySelector('[aria-label="Thought partner chat"]') && document.querySelectorAll('[data-testid="workspace-pane"]').length > 1, 'real editor/chat split');
          await selectConversation(state.a);
          editor = await until(() => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')).map(node => EditorView.findFromDOM(node)).find(view => view?.state.doc.toString().includes('orchard')), 'mounted sibling note editor');
        }
        editor.focus();
        editor.dispatch({ selection: { anchor: 0, head: Math.min(24, editor.state.doc.length) } }); await pause(100);
        report.receipts.contextSelection = { before: editor.state.selection.main.toJSON(), selectedText: editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to) };
        await openChat(); await pause(100);
        Object.assign(report.receipts.contextSelection as object, { after: editor.state.selection.main.toJSON(), titles: Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="note-title"]')).map(node => node.value) });
        await send(state.a, 'PI_UI:CONTEXT'); await mark('ordinary UI send captures open note and selected passage');
        editor.dispatch({ selection: { anchor: 0 } });
        const historical = await send(state.a, `PI_UI:HISTORY:${state.source.noteId}`);
        assert(historical.citations.some(source => source.kind === 'note' && source.passage?.historical), 'No admitted retained-change source');
        const historicalButton = await until(() => Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-slot="inline-citation"]')).find(node => node.textContent?.includes('Historical change')), 'normal historical citation'); historicalButton.click();
        await until(() => document.querySelector('[data-testid="history-mode"]'), 'retained revision opens History Mode');
        await click('Back to workspace'); await mark('historical discovery/read and normal retained revision navigation');
        await selectConversation(state.permission);
        const denied = await startSend(state.permission, `PI_UI:DISCOVER_DENY:${state.source.noteId}`);
        const deny = await until(() => document.querySelector('[aria-label^="Decide permission for"]'), 'normal note permission request'); await click('Deny', deny);
        assert((await terminal(state.permission, denied.id)).status === 'completed', 'Deny did not settle');
        await mark('discovery and native denial through normal permission UI');
        const allowed = await startSend(state.permission, `PI_UI:DISCOVER_ALLOW:${state.source.noteId}`);
        const allow = await until(() => document.querySelector('[aria-label^="Decide permission for"]'), 'second note permission request'); await click('Allow once', allow);
        const allowedAnswer = await terminal(state.permission, allowed.id); assert(allowedAnswer.status === 'completed' && allowedAnswer.citations.length, 'Allowed read missing admitted evidence');
        const readActivity = await revealProbeReadActivity({ message: allowedAnswer, noteId: state.source.noteId, until });
        await mark('normal permission Allow once delivers read activity and citation', readActivity);
        await selectConversation(state.a);
        const stopped = await startSend(state.a, 'PI_UI:STOP');
        await until(() => document.querySelector(`[data-chat-message-id="${stopped.id}"]`)?.textContent?.includes('Acknowledged partial fixture text.'), 'acknowledged visible partial stream');
        trace('partialSeenBeforeStop', { messageId: stopped.id, buttons: visibleButtons(), transport: { ...nativeTransportStats }, status: (await api.getConversation(state.a)).messages.find(message => message.id === stopped.id)?.status });
        trace('stopClick', { messageId: stopped.id }); await click('Stop response');
        const cancelled = await terminal(state.a, stopped.id); assert(cancelled.status === 'cancelled', 'Stop did not persist cancellation'); state.stoppedId = stopped.id;
        trace('stopSettled', { messageId: stopped.id, content: cancelled.content, status: cancelled.status });
        await mark('Stop persists acknowledged partial text', { messageId: stopped.id, content: cancelled.content });
        const retry = await until(() => { const root = document.querySelector(`[data-chat-message-id="${stopped.id}"]`); return root ? button('Retry', root) : undefined; }, 'normal Retry control'); retry.click();
        await until(async () => (await api.getConversation(state.a)).messages.some(value => value.content === 'Retried fixture complete.' && value.status === 'completed'), 'explicit Retry completed');
        await mark('normal Retry explicitly resumes native inference');
        const keep = await newProposal(state.a, 'PI_UI:CREATE'); state.keepId = keep.id;
        state.editedBody = 'Actual retained editor text survives a native process restart.'; state.editedTitle = 'Pi edited interactive title';
        const draft = await editReview(keep.id, state.editedBody, state.editedTitle);
        const discard = await newProposal(state.a, 'PI_UI:CREATE'); state.discardId = discard.id;
        await currentReview(discard.id); const restored = await currentReview(keep.id); assert(restored.state.doc.toString() === state.editedBody, 'Review switch lost edits');
        await mark('editable proposal body/title checkpoint and review switching', { proposalId: keep.id, version: draft.version });
        const interrupted = await startSend(state.a, 'PI_UI:INTERRUPT'); state.interruptedId = interrupted.id;
        await until(() => document.querySelector(`[data-chat-message-id="${interrupted.id}"]`)?.textContent?.includes('Acknowledged partial fixture text.'), 'new request partial before process termination');
        const activeInterrupted = (await api.getConversation(state.a)).messages.find(value => value.id === interrupted.id);
        assert(activeInterrupted?.status === 'streaming', 'Interrupted request finished before process termination');
        trace('partialSeenBeforeTermination', { messageId: interrupted.id, status: activeInterrupted.status, buttons: visibleButtons() });
        await persist(state); await mark('pending review and active request ready for process termination', { assistantMessageId: interrupted.id });
      } else if (phase === 'relaunch') {
        assert(state.keepId && state.discardId && state.interruptedId && state.editedBody && state.editedTitle, 'First UI phase incomplete');
        await selectConversation(state.a);
        const conversation = await api.getConversation(state.a); assert(conversation.model === 'pi-native-fixture-b', 'Model choice lost on relaunch');
        const interrupted = conversation.messages.find(value => value.id === state.interruptedId); assert(interrupted?.status === 'error' && interrupted.content.includes('Acknowledged partial fixture text.'), 'Interrupted checkpoint not restored');
        await mark('relaunch restores committed history, model and interrupted partial without replay');
        const view = await currentReview(state.keepId); const draft = await api.getProposalDraft!(state.keepId);
        assert(view.state.doc.toString() === state.editedBody && draft.title === state.editedTitle, 'Relaunch lost reviewed edits');
        await proveKeep(state.keepId, state.a, 'kept', draft);
        await settleReview(state.discardId, false, state.a); await mark('relaunch edited review Keep and Discard; duplicate Keep returns canonical receipt');
        await openChat(); const retry = await until(() => { const root = document.querySelector(`[data-chat-message-id="${state.interruptedId}"]`); return root ? button('Retry', root) : undefined; }, 'interrupted Retry'); retry.click();
        await until(async () => (await api.getConversation(state.a)).messages.some(value => value.id !== state.interruptedId && value.content === 'Retried fixture complete.' && value.status === 'completed'), 'restart Retry completion');
        await mark('interrupted work resumes only through explicit UI Retry');
        await selectConversation(state.b);
        const message = (await api.getConversation(state.b)).messages.find(value => value.role === 'assistant' && value.status === 'completed'); assert(message, 'Save answer absent');
        const noInference = { ...nativeTransportStats };
        const before = new Set((await api.listPendingProposals(state.b)).map(value => value.id));
        const answerElement = await until(() => document.querySelector(`[data-chat-message-id="${message.id}"]`), 'answer Save control'); await click('Save to note', answerElement);
        const save = await until(async () => (await api.listPendingProposals(state.b)).find(value => !before.has(value.id)), 'whole answer Save review'); state.savedId = save.id;
        let saveDraft = await api.getProposalDraft!(save.id); assert(saveDraft.markdown.includes('Echo phrase. Echo phrase.') && saveDraft.markdown.includes('Open in chat'), 'Whole-answer Save altered answer/origin');
        // Save publishes pending before its asynchronous normal editor presentation completes.
        await acquireProbeReview({ waitForAutomaticMount: true, until, openChat,
          editor: () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor'))
            .map(node => EditorView.findFromDOM(node)).find(view => view?.state.doc.toString() === saveDraft.markdown &&
              probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor')?.value === saveDraft.title &&
              view.state.field(reviewProjection, false)?.reviewId === String(save.preview.reviewId ?? save.id)),
          card: () => document.querySelector(`section[data-proposal-id="${save.id}"]`) ?? undefined,
          openCard: card => click('Review in editor', card) });
        saveDraft = await editReview(save.id, `${saveDraft.markdown}\n\n## Selected addition\n`, saveDraft.title);
        const saved = await proveKeep(save.id, state.b, 'saved', saveDraft);
        assert(saved.status === 'committed' && saved.noteId && saved.applied?.path, 'Save Keep lacks native receipt'); state.savedNoteId = saved.noteId; state.savedPath = saved.applied.path; report.receipts.saved = saved;
        const duplicate = await api.prepareNoteSave!(state.b, message.id); assert(duplicate.id === save.id && duplicate.status === 'committed', 'Repeated Save changed effect identity');
        await mark('normal whole-answer Save review Keep and duplicate Save preserve faithful content/origin');
        // Explicit destination and repeated-text occurrence are public Save inputs;
        // no UI control currently collects target/heading. Their native outcomes
        // are recorded separately from the UI-initiated whole-answer journey.
        const selection = await api.prepareNoteSave!(state.b, message.id, { markdown: 'Echo phrase.', text: 'Echo phrase.', occurrence: 1 }, { targetNoteId: state.savedNoteId, heading: 'Selected addition' });
        const selected = await api.getProposalDraft!(selection.id); assert(selected.markdown.includes('Selected addition'), 'Explicit append heading absent');
        await currentReview(selection.id);
        const appended = await proveKeep(selection.id, state.b, 'appended', selected); assert(appended.noteId === state.savedNoteId, 'Append changed target identity'); report.receipts.appended = appended;
        assert(nativeTransportStats.chunks === noInference.chunks && nativeTransportStats.bytes === noInference.bytes, 'Save or Keep dispatched inference');
        await mark('public deterministic repeated-selection append uses retained UI review and exact target', { before: noInference, after: { ...nativeTransportStats } });
        assert(appended.status === 'committed', 'Append lacks committed editor Markdown');
        const origin = await openSharedSavedOrigin(state.b, message.id, { noteId: state.savedNoteId, path: state.savedPath!, title: selected.title, markdown: appended.committedMarkdown });
        await mark('saved ordinary Open in chat link navigates to originating conversation/message', origin);
        await persist(state);
      } else throw new Error(`Unsupported interactive phase ${phase}`);
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = String(error); report.visible = document.body.innerText.slice(0, 2500);
    report.receipts.chatSend = probeChatSendDiagnostics();
    report.receipts.workspaceFocus = {
      panes: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="workspace-pane"]')).slice(0, 6).map(node => ({ id: node.dataset.paneId, kind: node.dataset.paneKind, collapsed: node.hasAttribute('data-pane-collapsed'), inertFrame: Boolean(node.querySelector('[data-pane-frame][inert]')) })),
      controls: Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(node => /^(Expand |Open thought partner)/.test(node.getAttribute('aria-label') ?? '')).slice(0, 12).map(node => ({ label: node.getAttribute('aria-label'), disabled: node.disabled, hidden: Boolean(node.closest('[inert],[aria-hidden="true"]')), rectangles: node.getClientRects().length }))
    };
  }
  return publish();
}
