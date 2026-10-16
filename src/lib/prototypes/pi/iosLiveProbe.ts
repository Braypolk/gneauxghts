// Explicit disposable live-provider gate. Drives the existing UI and public API.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { chatApi, type ChatApi } from '$lib/features/chat/api';
import type { ChatMessage, ChatProposalDraft, ChatSettings } from '$lib/features/chat/types';
import type { CommitNoteReviewResult } from '$lib/types/proposals';
import { documentReviewField, resolveReviewHunk, reviewProjection, setDocumentReview } from '$lib/features/proposals/reviewExtension';
import { acknowledgedProbeDraft, acquireProbeReview } from './probeReview';
import { openVisibleProbeChat, visibleProbeControl } from './probeChatFocus';
import { focusProbeChatComposer, probeChatPane, probeComposerSend } from './probeChatSend';
import { admittedProbeRead, revealProbeReadActivity } from './probeReadActivity';
import { probePaneTitle } from './probePaneTitle';
import { sameDraft } from './reviewState';

export const IOS_LIVE = { upstream: 'http://100.117.20.29:1234/v1', endpoint: 'http://127.0.0.1:1444/v1', model: 'qwen3.8-27b-gsq-rco' } as const;
type ProbeApi = ChatApi & { prototypeState(): Promise<{ iosLiveStateJson?: string } | undefined>; prototypeCheckpoint(value: unknown): Promise<void> };
type State = { phase: 'pending' | 'kept'; conversationId: string; source: { noteId: string; path: string }; messages: Pick<ChatMessage, 'id' | 'content' | 'status' | 'role'>[]; proposalId: string; reviewId: string; draft: ChatProposalDraft; reviewedDraft: ChatProposalDraft; expectedKeepDraft: ChatProposalDraft; receipt?: CommitNoteReviewResult };
type CanonicalNote = { noteId: string | null; path: string | null; title: string; markdown: string };
type Report = { gate: 'ios-local-live'; launchId: string; phase: string; status: 'running' | 'passed' | 'failed'; checks: string[]; receipts: Record<string, unknown>; error?: string; limits: string[] };
const api = chatApi as ProbeApi;
const pause = () => new Promise(resolve => setTimeout(resolve, 75));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export function iosLiveEnabled(url: string, config: { fixture: boolean; interactiveGate: boolean }) {
  return new URL(url).searchParams.get('piIosLiveTest') === '1' && config.interactiveGate === true && config.fixture === false;
}
export function assertIosLiveSettings(settings: Pick<ChatSettings, 'provider' | 'model' | 'localModel' | 'localBaseUrl' | 'reasoningEffort'>) {
  assert(settings.provider === 'local' && settings.model === IOS_LIVE.model && settings.localModel === IOS_LIVE.model && settings.localBaseUrl === IOS_LIVE.endpoint && settings.reasoningEffort === 'off', 'Live local configuration read-back mismatch');
}
export function assertIosLiveReview(reviewId: string, projection: { reviewId: string } | null | undefined) {
  assert(reviewId.length > 0 && projection?.reviewId === reviewId, 'Mounted live review identity mismatch');
}
export function assertIosLivePublication(reviewed: ChatProposalDraft, receipt: CommitNoteReviewResult, canonical: CanonicalNote) {
  assert(receipt.status === 'committed' && receipt.noteId && receipt.applied?.path === reviewed.path, 'Live Keep receipt target differs from acknowledged review');
  assert(receipt.committedMarkdown === reviewed.markdown, 'Live Keep receipt differs from exact acknowledged review body');
  assert(canonical.noteId === receipt.noteId && canonical.path === reviewed.path && canonical.title === reviewed.title, 'Canonical live note identity, title or path differs from acknowledged review');
  assert(canonical.markdown === reviewed.markdown, 'Canonical live note body differs from exact acknowledged review');
}
/** Predict normal Keep without dispatching to the live editor or checkpointing.
 * Use the document's actual hunk reducer and the acknowledged-draft equality
 * contract; only a changed decision checkpoint advances its version. */
export function expectedIosLiveKeepDraft(draft: ChatProposalDraft, reviewId: string): ChatProposalDraft {
  const mounted = EditorState.create({ doc: draft.markdown, extensions: [documentReviewField] }).update({
    effects: setDocumentReview.of({ reviewId, hunks: structuredClone(draft.decisions) })
  }).state;
  const resolved = mounted.update({ effects: draft.decisions.filter(hunk => hunk.status === 'pending' || hunk.status === 'modified')
    .map(hunk => resolveReviewHunk.of({ id: hunk.id, status: 'kept' })) }).state;
  const expected = { ...draft, decisions: resolved.field(documentReviewField)!.hunks };
  return { ...expected, version: draft.version + (sameDraft(draft, expected) ? 0 : 1) };
}
export function assertIosLiveKeepDraft(expected: ChatProposalDraft, actual: ChatProposalDraft) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), 'Normal Keep checkpoint differs from independently planned draft');
}
/** Timeout includes an individual stalled IPC predicate, not just poll intervals. */
export async function iosLiveUntil<T>(read: () => T | Promise<T>, label: string, timeout = 45000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`iOS live deadline: ${label}`)), Math.max(1, end - Date.now())); });
      const value = await Promise.race([Promise.resolve().then(read), expired]);
      if (value) return value as NonNullable<T>;
    } finally { clearTimeout(timer); }
    await pause();
  }
  throw new Error(`iOS live deadline: ${label}`);
}
const until = iosLiveUntil;
const button = (label: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(node => !node.disabled && visibleProbeControl(node) && (node.textContent?.trim() === label || node.getAttribute('aria-label') === label));
async function click(label: string, root: ParentNode = document) { (await until(() => button(label, root), label)).click(); await pause(); }
function input(node: HTMLTextAreaElement | HTMLInputElement, text: string) { node.focus(); node.value = text; node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); }
const openChat = () => openVisibleProbeChat(until);
async function select(id: string) {
  await openChat(); const conversation = await api.getConversation(id);
  const pane = await until(() => probeChatPane(conversation.title) ?? probeChatPane(), 'normal chat picker pane');
  await focusProbeChatComposer(pane, until); await click('Conversations', pane);
  (await until(() => Array.from(pane.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(node => node.textContent?.trim() === conversation.title), 'live conversation picker item')).click();
  await until(() => probePaneTitle(pane, 'chat')?.value === conversation.title, 'selected live conversation');
}
async function send(id: string, text: string) {
  const before = await api.getConversation(id), ids = new Set(before.messages.map(value => value.id));
  const pane = await until(() => probeChatPane(before.title), 'live conversation mounted');
  const composer = await focusProbeChatComposer(pane, until); input(composer, text);
  (await until(() => probeComposerSend(composer), 'live normal Send')).click();
  const message = await until(async () => (await api.getConversation(id)).messages.find(value => !ids.has(value.id) && value.role === 'assistant' && !['pending', 'streaming'].includes(value.status)), 'real local model terminal answer', 180000);
  assert(message.status === 'completed', `Live request failed (${message.status}): ${message.errorMessage}`);
  assert(message.content.length > 0 && message.content.length < 8000, 'Live answer is empty or exceeds bounded probe content');
  await until(() => document.querySelector(`[data-chat-message-id="${message.id}"] [aria-label="Assistant response"]`) ?? document.querySelector(`[data-chat-message-id="${message.id}"]`), 'rendered live assistant');
  return message;
}
async function review(id: string, conversationId: string, waitForAutomaticMount = false) {
  const draft = await api.getProposalDraft!(id);
  const proposal = (await api.listPendingProposals(conversationId)).find(value => value.id === id);
  const reviewId = proposal?.preview.reviewId;
  assert(typeof reviewId === 'string' && reviewId.length > 0, 'Pending live proposal lacks exact review identity');
  const editor = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')).map(node => EditorView.findFromDOM(node)).find(view => view?.state.doc.toString() === draft.markdown && view.state.field(reviewProjection, false)?.reviewId === reviewId && probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor')?.value === draft.title);
  const view = await acquireProbeReview({ editor, openChat, until, waitForAutomaticMount, card: () => document.querySelector(`section[data-proposal-id="${id}"]`) ?? undefined, openCard: card => click('Review in editor', card) });
  return { view, draft, reviewId };
}
async function acknowledge(id: string, conversationId: string) {
  const { view, draft, reviewId } = await review(id, conversationId);
  const title = probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor'); assert(title, 'Review title unavailable');
  return acknowledgedProbeDraft({ draft: () => api.getProposalDraft!(id), until, working: () => {
    const projection = view.state.field(reviewProjection, false); assertIosLiveReview(reviewId, projection); assert(projection, 'Review projection unavailable');
    return { markdown: view.state.doc.toString(), title: title.value, path: draft.path, decisions: projection.hunks };
  } });
}
export async function keepIosLiveReview(input: { view: EditorView; proposalId: string; conversationId: string; reviewId: string; reviewedDraft: ChatProposalDraft; expectedKeepDraft: ChatProposalDraft }) {
  assertIosLiveReview(input.reviewId, input.view.state.field(reviewProjection, false));
  assert(input.view.dom.isConnected && input.view.state.doc.toString() === input.reviewedDraft.markdown && probePaneTitle(input.view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor')?.value === input.reviewedDraft.title, 'Live working review changed before Keep');
  assertIosLiveKeepDraft(input.expectedKeepDraft, expectedIosLiveKeepDraft(input.reviewedDraft, input.reviewId));
  // Compact chat navigation replaces the pane's editor. Retain the independent
  // mounted proof above, then bind normal Keep to the same acknowledged draft
  // and pending review rather than reading a destroyed EditorView's old DOM.
  await openChat();
  const strip = await until(() => document.querySelector(`[data-proposal-strip="active"][data-proposal-id="${input.proposalId}"]`), 'normal retained review strip');
  const keep = await until(() => button('Keep All', strip) ?? button('Keep Remaining', strip), 'normal retained Keep');
  const pending = (await api.listPendingProposals(input.conversationId)).find(proposal => proposal.id === input.proposalId);
  assertIosLiveReview(input.reviewId, typeof pending?.preview.reviewId === 'string' ? { reviewId: pending.preview.reviewId } : undefined);
  const draft = await api.getProposalDraft!(input.proposalId);
  assert(JSON.stringify(draft) === JSON.stringify(input.reviewedDraft), 'Acknowledged live review changed before normal Keep');
  keep.click();
}
export async function openIosLiveSource(message: ChatMessage, noteId: string) {
  admittedProbeRead(message, noteId); await openChat(); await revealProbeReadActivity({ message, noteId, until });
  const card = await until(() => document.querySelector(`[data-chat-message-id="${message.id}"]`), 'cited live answer');
  const admittedIds = new Set(message.citations.filter(citation => citation.kind === 'note' && citation.noteId === noteId).map(citation => citation.id));
  (await until(() => Array.from(card.querySelectorAll<HTMLButtonElement>('button[data-chat-note-citation-id]')).find(node =>
    admittedIds.has(node.getAttribute('data-chat-note-citation-id') ?? '') && !node.disabled && !node.closest('[hidden]') && visibleProbeControl(node)), 'normal source citation')).click();
  await until(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="note-title"]')).some(node => node.value === 'Pi live synthetic orchard') && Array.from(document.querySelectorAll('[data-testid="note-editor"] .cm-content')).some(node => node.textContent?.includes('thirteen cobalt pears')), 'canonical synthetic source opened');
}
function assertRestored(state: State, messages: ChatMessage[], draft: ChatProposalDraft) {
  assert(JSON.stringify(messages.map(({ id, content, status, role }) => ({ id, content, status, role }))) === JSON.stringify(state.messages), 'Committed live conversation changed across launch');
  assert(JSON.stringify(draft) === JSON.stringify(state.draft), 'Acknowledged live review changed across launch');
}
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(value => value.toString(16).padStart(2, '0')).join('');
export async function runIosLiveProbe(): Promise<Report | undefined> {
  if (new URL(location.href).searchParams.get('piIosLiveTest') !== '1') return;
  const config = await invoke<{ fixture: boolean; interactiveGate: boolean }>('pi_probe_config');
  if (!iosLiveEnabled(location.href, config)) return;
  const report: Report = { gate: 'ios-local-live', launchId: crypto.randomUUID(), phase: 'starting', status: 'running', checks: [], receipts: { routing: IOS_LIVE }, limits: ['Local compatible protocol only; hosted live acceptance is deferred.', 'Programmatic normal WKWebView controls; physical touch, OS pressure and physical iPhone behavior remain unverified.'] };
  const emit = async (phase: string, receipt?: unknown) => { report.phase = phase; if (receipt !== undefined) report.receipts[phase] = receipt; await invoke('pi_ui_report', { report }); };
  let disposeBackground: (() => void) | undefined;
  try {
    await until(() => document.querySelector('[data-testid="workspace-pane"]'), 'normal native workspace');
    const prior = (await api.prototypeState())?.iosLiveStateJson;
    if (!prior) {
      assert(!(await api.listConversations()).length, 'Fresh generated simulator container required');
      const settings = await api.getSettings();
      await api.setDefaults({ ...settings, provider: 'local', model: IOS_LIVE.model, localModel: IOS_LIVE.model, localBaseUrl: IOS_LIVE.endpoint, reasoningEffort: 'off', defaultVaultAccess: 'full', webAccess: 'off' });
      assertIosLiveSettings(await api.getSettings());
      await api.setLocalModelCapabilities(IOS_LIVE.model, { tools: true, images: false, audio: false, video: false, reasoningEffort: 'off' });
      const note = await invoke<{ noteId: string; path: string }>('save_note', { title: 'Pi live synthetic orchard', markdown: 'The synthetic orchard grows thirteen cobalt pears. Its inspection code is ORCHARD-LIVE-12.', currentPath: null });
      await invoke('finalize_note_editing_window', { noteId: note.noteId });
      const conversation = await api.createConversation({ title: 'Pi iOS live local', provider: 'local', model: IOS_LIVE.model, vaultAccess: 'full', reasoningEffort: 'off' });
      await select(conversation.id);
      const first = await send(conversation.id, 'Without using any tools, write one short sentence about a paper kite. Remember this conversation code for my next question: KITE-LIVE-12.');
      assert(first.citations.length === 0 && !first.parts.some(part => part.type === 'tool' && part.readSources?.length), 'Source-free turn acquired note evidence'); report.checks.push('real local source-free normal Send');
      const cited = await send(conversation.id, `What conversation code did I give you? Then read the note titled "Pi live synthetic orchard" (Note Identity ${note.noteId}) with the note evidence tool. Report its pear fact and inspection code with an admitted source citation. Do not create or edit notes. Keep the answer short.`);
      assert(cited.content.includes('KITE-LIVE-12') && cited.content.includes('ORCHARD-LIVE-12'), 'Live follow-up failed conversation continuity or actual source fact');
      report.receipts.noInferenceAfterMillis = Date.now();
      await openIosLiveSource(cited, note.noteId); report.checks.push('real local follow-up, actual canonical read activity and citation navigation');
      await openChat();
      const before = new Set((await api.listPendingProposals(conversation.id)).map(value => value.id));
      const card = await until(() => document.querySelector(`[data-chat-message-id="${cited.id}"]`), 'exact live Save answer'); await click('Save to note', card);
      const proposal = await until(async () => (await api.listPendingProposals(conversation.id)).find(value => !before.has(value.id)), 'normal Save proposal');
      const { view, reviewId } = await review(proposal.id, conversation.id, true);
      const body = `${view.state.doc.toString()}\n\nSynthetic iOS live review edit retained 12.`;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body }, userEvent: 'input.type' });
      const field = await until(() => { const title = probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor'); return title && visibleProbeControl(title) ? title : undefined; }, 'mounted live review has its visible normal title');
      input(field, 'Pi iOS live saved answer'); field.blur();
      await until(async () => { const value = await api.getProposalDraft!(proposal.id); return value.markdown === body && value.title === field.value ? value : undefined; }, 'normal body/title acknowledged');
      const draft = await acknowledge(proposal.id, conversation.id);
      const expectedKeepDraft = expectedIosLiveKeepDraft(draft, reviewId);
      const state: State = { phase: 'pending', conversationId: conversation.id, source: note, messages: (await api.getConversation(conversation.id)).messages.map(({ id, content, status, role }) => ({ id, content, status, role })), proposalId: proposal.id, reviewId, draft, reviewedDraft: draft, expectedKeepDraft };
      await api.prototypeCheckpoint({ iosLiveStateJson: JSON.stringify(state) });
      let backgrounds = 0; disposeBackground = await listen('app://backgrounding', () => { backgrounds++; });
      await emit('awaiting-background', { conversationId: conversation.id, sourceNoteId: note.noteId, proposalId: proposal.id, reviewId, draftVersion: draft.version, expectedKeepVersion: expectedKeepDraft.version, expectedKeepDraftSha256: await digest(JSON.stringify(expectedKeepDraft)), reviewedTitle: draft.title, reviewedPath: draft.path, answerSha256: await digest(cited.content), reviewedSha256: await digest(draft.markdown) });
      await until(() => backgrounds > 0, 'actual native background event', 120000);
      assertRestored(state, (await api.getConversation(state.conversationId)).messages, await api.getProposalDraft!(state.proposalId));
      report.checks.push('normal Save and editable acknowledged review survive native background event');
      await emit('ready-to-relaunch', { backgrounds, conversationId: state.conversationId, proposalId: state.proposalId });
      return report;
    }
    const state: State = JSON.parse(prior); assert(state.phase === 'pending' || state.phase === 'kept', 'Unexpected live checkpoint phase');
    assertIosLiveSettings(await api.getSettings());
    const conversation = await api.getConversation(state.conversationId);
    assert(conversation.provider === 'local' && conversation.model === IOS_LIVE.model, 'Persisted live provider/model changed');
    assertRestored(state, conversation.messages, await api.getProposalDraft!(state.proposalId));
    await select(state.conversationId);
    if (state.phase === 'pending') {
      const { view, reviewId } = await review(state.proposalId, state.conversationId);
      assert(reviewId === state.reviewId, 'Pending live proposal review identity changed across launch');
      const acknowledged = await acknowledge(state.proposalId, state.conversationId);
      assert(JSON.stringify(acknowledged) === JSON.stringify(state.reviewedDraft), 'Mounted live review differs from pre-relaunch acknowledgement');
      // Capture the expected content before Keep can produce any receipt.
      const expectedSha256 = await digest(state.reviewedDraft.markdown);
      await keepIosLiveReview({ view, proposalId: state.proposalId, conversationId: state.conversationId, reviewId: state.reviewId, reviewedDraft: state.reviewedDraft, expectedKeepDraft: state.expectedKeepDraft });
      await until(async () => !(await api.listPendingProposals(state.conversationId)).some(value => value.id === state.proposalId), 'native kept publication');
      const draft = await api.getProposalDraft!(state.proposalId);
      assertIosLiveKeepDraft(state.expectedKeepDraft, draft);
      const receipt = await api.commitAgentProposal(state.proposalId, draft.markdown, draft.version);
      assert(receipt.status === 'committed' && receipt.noteId, 'Live Keep failed to return a committed Note Identity');
      const canonical = await invoke<CanonicalNote>('read_note', { noteId: receipt.noteId, path: state.reviewedDraft.path });
      assertIosLivePublication(state.reviewedDraft, receipt, canonical);
      const duplicate = await api.commitAgentProposal(state.proposalId, draft.markdown, draft.version); assert(JSON.stringify(duplicate) === JSON.stringify(receipt), 'Duplicate Keep receipt changed');
      await api.prototypeCheckpoint({ iosLiveStateJson: JSON.stringify({ ...state, phase: 'kept', draft, receipt }) });
      report.checks.push('same live conversation and acknowledged pending review restored; normal Keep and duplicate receipt');
      await emit('kept-ready-to-relaunch', { conversationId: state.conversationId, proposalId: state.proposalId, reviewId: state.reviewId, version: draft.version, keptDraftSha256: await digest(JSON.stringify(draft)), noteId: receipt.noteId, path: receipt.applied?.path, expectedSha256, canonical: { noteId: canonical.noteId, title: canonical.title, path: canonical.path, editorSha256: await digest(canonical.markdown) } });
      return report;
    }
    const duplicate = await api.commitAgentProposal(state.proposalId, state.draft.markdown, state.draft.version);
    assert(JSON.stringify(duplicate) === JSON.stringify(state.receipt), 'Durable live Keep receipt changed after relaunch');
    const canonical = await invoke<CanonicalNote>('read_note', { noteId: duplicate.noteId, path: state.reviewedDraft.path });
    assertIosLivePublication(state.reviewedDraft, duplicate, canonical);
    const cited = conversation.messages.filter(value => value.role === 'assistant').at(-1); assert(cited, 'Restored live answer missing'); await openIosLiveSource(cited, state.source.noteId);
    report.checks.push('same committed conversation, source identity and Keep receipt restored without inference');
    report.status = 'passed'; await emit('complete', { conversationId: state.conversationId, proposalId: state.proposalId, reviewId: state.reviewId, noteId: duplicate.noteId, canonical: { noteId: canonical.noteId, title: canonical.title, path: canonical.path, editorSha256: await digest(canonical.markdown) } });
  } catch (error) { report.status = 'failed'; report.error = String(error).slice(0, 1500); await emit(report.phase); }
  finally { disposeBackground?.(); }
  return report;
}
