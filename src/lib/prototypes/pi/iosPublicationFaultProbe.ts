// Existing native publication faults only; this module is inert without the
// separate owned loopback controller and all expanded synthetic launch gates.
import type { ChatApi } from '$lib/features/chat/api';
import type { ChatMessage, ChatProposalDraft } from '$lib/features/chat/types';
import type { CommitNoteReviewResult } from '$lib/types/proposals';
import { expectedSharedKeepDraft, expectedSharedEditorMarkdown, assertSharedKeepDraft, assertSharedMountedReview, type SharedCanonicalNote } from './sharedKeepProof';
import { suspensionControlOrigin } from './supplementalSuspensionProbe';

export const iosPublicationBoundaries = ['after-intent', 'after-publication', 'after-receipt'] as const;
export const iosCommandCrashBoundaries = ['prepared-review', 'transport-completed'] as const;
export type IosPublicationBoundary = typeof iosPublicationBoundaries[number] | typeof iosCommandCrashBoundaries[number];
export type IosPublicationConfig = { gate: 'owned-ios-publication-fault-control'; boundary: IosPublicationBoundary; scope: string; execute?: { nonce: string; issuedAt: number } };
export type IosPublicationState = { boundary: IosPublicationBoundary; scope: string; conversationId: string; proposalId: string; reviewId: string;
  reviewedDraft: ChatProposalDraft; acceptedDraft: ChatProposalDraft; expectedEditorMarkdown: string;
  sourceMessageId: string; sourceContent: string; firstLaunchId: string };
type ProbeApi = ChatApi & { prototypeState(): Promise<{ iosPublicationFaultStateJson?: string; iosCommandCrashStateJson?: string } | undefined>;
  prototypeCheckpoint(value: unknown): Promise<void>; prototypeFault(id: string, fault: string): Promise<void> };
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function assertIosPublicationConfig(config: IosPublicationConfig) {
  assert(config?.gate === 'owned-ios-publication-fault-control' && [...iosPublicationBoundaries, ...iosCommandCrashBoundaries].includes(config.boundary), 'Unrecognized owned iOS publication fault configuration');
  assert(typeof config.scope === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(config.scope), 'Invalid generated iOS publication scope');
}
export function assertIosPublicationRestore(state: IosPublicationState, draft: ChatProposalDraft, source: ChatMessage | undefined, config: IosPublicationConfig) {
  assertIosPublicationConfig(config);
  assert(state.boundary === config.boundary && state.scope === config.scope, 'Relaunch publication scope or boundary changed');
  assert(same(state.acceptedDraft, draft), 'Relaunch changed the exact accepted review version/body/title/location/hunks');
  assert(source?.id === state.sourceMessageId && source.status === 'completed' && source.content === state.sourceContent,
    'Relaunch changed the original completed assistant source');
}
export function assertIosPublicationReceipt(state: IosPublicationState, first: CommitNoteReviewResult, duplicate: CommitNoteReviewResult, canonical: SharedCanonicalNote) {
  assert(first.status === 'committed' && first.noteId && first.applied?.path === state.acceptedDraft.path, 'Explicit restored Keep lacks its canonical receipt');
  assert(same(first, duplicate), 'Duplicate restored Keep changed the canonical receipt');
  assert(first.committedMarkdown === state.expectedEditorMarkdown && canonical.markdown === state.expectedEditorMarkdown,
    'Canonical editor bytes differ from the exact accepted review');
  assert(canonical.noteId === first.noteId && canonical.path === first.applied.path && canonical.title === state.acceptedDraft.title,
    'Canonical identity/title/location differ from the immutable accepted publication');
}

/** Pure orchestration seam: adapter operations exercise the real normal UI. */
export async function runIosPublicationFaultJourney(input: {
  api: ProbeApi; config: IosPublicationConfig; launchId: string;
  createAndEdit(): Promise<{ conversationId: string; proposalId: string; reviewId: string; draft: ChatProposalDraft; source: ChatMessage }>;
  clickKeep(proposalId: string): Promise<void>; waitCrashCommand(): Promise<{ nonce: string; issuedAt: number }>;
  acknowledgeCrash(command: { nonce: string; issuedAt: number }): Promise<unknown>;
  readCanonical(receipt: CommitNoteReviewResult): Promise<SharedCanonicalNote>;
  emit(value: Record<string, unknown>): Promise<void>;
}) {
  assertIosPublicationConfig(input.config);
  assert((iosPublicationBoundaries as readonly string[]).includes(input.config.boundary), 'Publication journey requires an existing publication boundary');
  const prior = (await input.api.prototypeState())?.iosPublicationFaultStateJson;
  if (!prior) {
    const prepared = await input.createAndEdit();
    assert(prepared.draft.decisions.some(hunk => hunk.status === 'modified'), 'Normal review editing did not acknowledge modified hunks');
    const acceptedDraft = expectedSharedKeepDraft(prepared.draft, prepared.reviewId);
    const state: IosPublicationState = { boundary: input.config.boundary, scope: input.config.scope, firstLaunchId: input.launchId,
      conversationId: prepared.conversationId, proposalId: prepared.proposalId, reviewId: prepared.reviewId,
      reviewedDraft: prepared.draft, acceptedDraft, expectedEditorMarkdown: expectedSharedEditorMarkdown(acceptedDraft),
      sourceMessageId: prepared.source.id, sourceContent: prepared.source.content };
    await input.api.prototypeCheckpoint({ iosPublicationFaultStateJson: JSON.stringify(state) });
    await input.api.prototypeFault(state.proposalId, state.boundary);
    await input.emit({ phase: 'ready-to-crash', status: 'running', state });
    const command = await input.waitCrashCommand();
    assert(typeof command.nonce === 'string' && command.nonce.length >= 16 && Number.isFinite(command.issuedAt), 'Fresh owned crash challenge is absent');
    const acknowledgement = await input.acknowledgeCrash(command);
    await input.emit({ phase: 'crash-command-acknowledged', status: 'running', state, command, acknowledgement });
    await input.clickKeep(state.proposalId);
    throw new Error('Native publication fault returned without terminating its process');
  }
  const state = JSON.parse(prior) as IosPublicationState;
  assert(input.launchId !== state.firstLaunchId, 'Publication recovery requires a different native launch');
  const draft = await input.api.getProposalDraft!(state.proposalId);
  const source = (await input.api.getConversation(state.conversationId)).messages.find(value => value.id === state.sourceMessageId);
  assertIosPublicationRestore(state, draft, source, input.config);
  await input.emit({ phase: 'restored-before-keep', status: 'running', state, restoredDraft: draft, source });
  // Normal first Keep accepted every hunk before the crash; restart can retain
  // no unresolved UI hunks. Public explicit Keep joins that pinned acceptance.
  const first = await input.api.commitAgentProposal!(state.proposalId, draft.markdown, draft.version);
  const duplicate = await input.api.commitAgentProposal!(state.proposalId, draft.markdown, draft.version);
  const canonical = await input.readCanonical(first);
  assertIosPublicationReceipt(state, first, duplicate, canonical);
  assert(!(await input.api.listPendingProposals(state.conversationId)).some(value => value.id === state.proposalId), 'Explicit recovered publication remains pending');
  const result = { phase: 'recovered', status: 'passed', state, restoredDraft: draft, receipt: first, duplicate, canonical };
  await input.emit(result); return result;
}

export type IosCommandCrashState = { boundary: IosPublicationBoundary; scope: string; conversationId: string; userContent: string; firstLaunchId: string; assistantMessageId?: string; partial?: string };
export type IosPreparedKeepPlan = { proposalId: string; reviewId: string; reviewedDraft: ChatProposalDraft; acceptedDraft: ChatProposalDraft; expectedEditorMarkdown: string; capturedAt: number };
export function assertIosPreparedPublication(plan: IosPreparedKeepPlan, settled: ChatProposalDraft, receipt: CommitNoteReviewResult, duplicate: CommitNoteReviewResult, canonical: SharedCanonicalNote) {
  assertSharedKeepDraft(plan.acceptedDraft, settled);
  assert(receipt.status === 'committed' && receipt.noteId && same(receipt, duplicate), 'Retried prepared review changed its committed canonical receipt');
  assert(receipt.committedMarkdown === plan.expectedEditorMarkdown && canonical.markdown === plan.expectedEditorMarkdown,
    'Retried prepared publication differs from exact independently predicted editor bytes');
  assert(canonical.noteId === receipt.noteId && canonical.path === plan.acceptedDraft.path && receipt.applied?.path === plan.acceptedDraft.path && canonical.title === plan.acceptedDraft.title,
    'Retried prepared publication changed expected identity/title/location');
}
export function assertIosCommandCrashRestored(state: IosCommandCrashState, conversation: Awaited<ReturnType<ChatApi['getConversation']>>, pending: unknown[], config: IosPublicationConfig) {
  assert(state.scope === config.scope && state.boundary === config.boundary, 'Restored command crash scope/boundary changed');
  assert(pending.length === 0, 'Undelivered prepared tool outcome became a durable proposal');
  assert(conversation.messages.find(value => value.role === 'user')?.content === state.userContent, 'Restored original admitted input changed');
  const partial = conversation.messages.at(-1);
  assert(partial?.role === 'assistant' && ['error', 'cancelled'].includes(partial.status), 'Native command crash did not retain an interrupted retryable assistant');
  if (state.boundary === 'transport-completed') assert(partial.id === state.assistantMessageId && partial.content === state.partial && partial.content === `Synthetic terminal partial PI_E2E_CRASH_${state.scope}.`, 'Native completion crash lost its acknowledged exact partial');
  return partial;
}

export async function runIosCommandCrashJourney(input: {
  api: ProbeApi; config: IosPublicationConfig; launchId: string;
  createConversation(): Promise<string>; send(conversationId: string, content: string): Promise<void>;
  waitPartial(conversationId: string): Promise<ChatMessage>; retry(conversationId: string, messageId: string): Promise<ChatMessage>;
  keepPrepared(conversationId: string, proposalId: string): Promise<{ proposalId: string; plan: IosPreparedKeepPlan; settled: ChatProposalDraft; receipt: CommitNoteReviewResult; duplicate: CommitNoteReviewResult; canonical: SharedCanonicalNote }>;
  waitCrashCommand(): Promise<{ nonce: string; issuedAt: number }>; acknowledgeCrash(command: { nonce: string; issuedAt: number }): Promise<unknown>;
  emit(value: Record<string, unknown>): Promise<void>; awaitCrash(): Promise<void>;
}) {
  assertIosPublicationConfig(input.config);
  assert((iosCommandCrashBoundaries as readonly string[]).includes(input.config.boundary), 'Command crash requires an existing guarded native boundary');
  const prior = (await input.api.prototypeState())?.iosCommandCrashStateJson;
  if (!prior) {
    const conversationId = await input.createConversation();
    const state: IosCommandCrashState = { boundary: input.config.boundary, scope: input.config.scope, conversationId, firstLaunchId: input.launchId,
      userContent: `${input.config.boundary === 'prepared-review' ? 'PI_CRASH_REVIEW' : 'PI_CRASH_TERMINAL'} PI_E2E_CRASH_${input.config.scope}` };
    await input.api.prototypeCheckpoint({ iosCommandCrashStateJson: JSON.stringify(state) });
    await input.emit({ phase: 'ready-to-crash', status: 'running', state });
    const command = await input.waitCrashCommand();
    assert(typeof command.nonce === 'string' && command.nonce.length >= 16 && Number.isFinite(command.issuedAt), 'Fresh owned command-crash challenge is absent');
    const acknowledgement = await input.acknowledgeCrash(command);
    await input.emit({ phase: 'crash-command-acknowledged', status: 'running', state, command, acknowledgement });
    await input.send(conversationId, state.userContent);
    if (state.boundary === 'transport-completed') {
      const partial = await input.waitPartial(conversationId);
      assert(partial.status === 'streaming' && partial.content === `Synthetic terminal partial PI_E2E_CRASH_${state.scope}.`, 'Native terminal barrier did not expose the exact ordinary partial');
      state.assistantMessageId = partial.id; state.partial = partial.content;
      await input.api.prototypeCheckpoint({ iosCommandCrashStateJson: JSON.stringify(state) });
      await input.emit({ phase: 'partial-ready', status: 'running', state, partial });
    }
    await input.awaitCrash(); throw new Error('Guarded native command crash did not terminate the process');
  }
  const state = JSON.parse(prior) as IosCommandCrashState;
  assert(input.launchId !== state.firstLaunchId, 'Command crash recovery requires a different native launch');
  const conversation = await input.api.getConversation(state.conversationId);
  const interrupted = assertIosCommandCrashRestored(state, conversation, await input.api.listPendingProposals(state.conversationId), input.config);
  await input.emit({ phase: 'restored-before-retry', status: 'running', state, interrupted });
  const retried = await input.retry(state.conversationId, interrupted.id);
  assert(retried.id !== interrupted.id && retried.status === 'completed' && retried.content === (state.boundary === 'prepared-review' ? 'Synthetic crash review staging completed.' : state.partial),
    'Explicit exact interrupted Retry failed');
  let pendingKept;
  if (state.boundary === 'prepared-review') {
    const pending = await input.api.listPendingProposals(state.conversationId); assert(pending.length === 1, 'Explicit prepared-review Retry did not stage exactly one proposal');
    pendingKept = await input.keepPrepared(state.conversationId, pending[0].id);
    assertIosPreparedPublication(pendingKept.plan, pendingKept.settled, pendingKept.receipt, pendingKept.duplicate, pendingKept.canonical);
  }
  const result = { phase: 'recovered', status: 'passed', state, interrupted, retried, pendingKept };
  await input.emit(result); return result;
}

async function requestControl<T>(origin: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${origin}/pi-ios-publication/${path}`, { cache: 'no-store', signal: controller.signal,
      ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    assert(response.ok, 'Owned iOS publication controller rejected request'); return await response.json() as T;
  } finally { clearTimeout(timer); }
}

/** Expanded startup hook, before the ordinary shared journey phase selection. */
export async function maybeRunIosPublicationFaultProbe() {
  const { invoke } = await import('@tauri-apps/api/core');
  const gates = await invoke<{ fixture: boolean; interactiveGate: boolean; expandedGate: boolean }>('pi_probe_config');
  if (!gates.fixture || !gates.interactiveGate || !gates.expandedGate) return undefined;
  const { chatApi } = await import('$lib/features/chat/api');
  const api = chatApi as ProbeApi;
  let origin: string, config: IosPublicationConfig;
  try { origin = suspensionControlOrigin((await api.getSettings()).localBaseUrl); config = await requestControl(origin, 'config'); }
  catch { return undefined; }
  assertIosPublicationConfig(config);
  const { EditorView } = await import('@codemirror/view');
  const { openVisibleProbeChat, visibleProbeControl } = await import('./probeChatFocus');
  const { probePaneTitle } = await import('./probePaneTitle');
  const { probeChatPane, focusProbeChatComposer, probeComposerSend } = await import('./probeChatSend');
  const { acquireProbeReview, acknowledgedProbeDraft } = await import('./probeReview');
  const { reviewProjection } = await import('$lib/features/proposals/reviewExtension');
  const pause = () => new Promise(resolve => setTimeout(resolve, 60));
  async function until<T>(read: () => T | Promise<T>, label: string): Promise<NonNullable<T>> {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) { const value = await read(); if (value) return value as NonNullable<T>; await pause(); }
    throw new Error(`iOS publication UI deadline: ${label}`);
  }
  const button = (label: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(node => !node.disabled && visibleProbeControl(node) && (node.getAttribute('aria-label') ?? node.textContent?.trim()) === label);
  const openChat = () => openVisibleProbeChat(until);
  const launchId = crypto.randomUUID();
  const report: Record<string, unknown> = { gate: 'ios-native-publication-fault', launchId, boundary: config.boundary, scope: config.scope };
  const emit = async (value: Record<string, unknown>) => { Object.assign(report, value); await invoke('pi_ui_report', { report }); };
  const selectConversation = async (conversationId: string) => {
    const conversation = await api.getConversation(conversationId);
    await openChat(); const pane = await until(() => probeChatPane(), 'normal command-crash chat pane');
    await focusProbeChatComposer(pane, until);
    (await until(() => button('Conversations', pane), 'normal command-crash picker')).click();
    (await until(() => Array.from(pane.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')).find(node => node.textContent?.trim() === conversation.title), 'exact command-crash conversation')).click();
    return until(() => probeChatPane(conversation.title), 'command-crash conversation selected');
  };
  const waitCrashCommand = () => until(async () => (await requestControl<IosPublicationConfig>(origin, 'config')).execute, 'fresh driver crash command');
  const acknowledgeCrash = (command: { nonce: string; issuedAt: number }) => requestControl(origin, 'ack', { scope: config.scope, boundary: config.boundary, launchId, ...command });
  try {
    if ((iosCommandCrashBoundaries as readonly string[]).includes(config.boundary)) return await runIosCommandCrashJourney({ api, config, launchId, emit, waitCrashCommand, acknowledgeCrash,
      createConversation: async () => {
        assert((await api.listConversations()).length === 0, 'iOS command crash requires a fresh generated root');
        return (await api.createConversation({ title: `Pi iOS ${config.boundary} ${config.scope}`, provider: 'local', model: 'pi-native-fixture', vaultAccess: 'none' })).id;
      },
      send: async (conversationId, content) => {
        const pane = await selectConversation(conversationId), composer = await focusProbeChatComposer(pane, until);
        composer.focus(); composer.value = content; composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }));
        (await until(() => probeComposerSend(composer), 'normal command-crash Send')).click();
      },
      waitPartial: async conversationId => until(async () => {
        const message = (await api.getConversation(conversationId)).messages.at(-1);
        const row = message && document.querySelector<HTMLElement>(`[data-chat-message-id="${message.id}"]`);
        return message?.role === 'assistant' && message.status === 'streaming' && message.content === `Synthetic terminal partial PI_E2E_CRASH_${config.scope}.`
          && row?.isConnected && visibleProbeControl(row) && row.textContent?.includes(message.content) ? message : undefined;
      }, 'visible and durable exact ordinary terminal partial'),
      retry: async (conversationId, messageId) => {
        await selectConversation(conversationId);
        const row = await until(() => document.querySelector(`[data-chat-message-id="${messageId}"]`), 'exact interrupted native-crash row');
        (await until(() => button('Retry', row), 'normal exact native-crash Retry')).click();
        return until(async () => {
          const message = (await api.getConversation(conversationId)).messages.at(-1);
          if (message?.id !== messageId) assert(!['error', 'cancelled'].includes(message?.status ?? ''), message?.errorMessage ?? 'Explicit native-crash Retry failed');
          return message?.id !== messageId && message?.status === 'completed' ? message : undefined;
        }, 'explicit native-crash Retry completion');
      },
      keepPrepared: async (conversationId, proposalId) => {
        const pending = (await api.listPendingProposals(conversationId)).find(value => value.id === proposalId);
        const original = await api.getProposalDraft!(proposalId), reviewId = pending?.preview.reviewId;
        assert(typeof reviewId === 'string', 'Retried prepared proposal lacks review identity');
        const view = await acquireProbeReview({ openChat, until,
          editor: () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')).map(node => EditorView.findFromDOM(node))
            .find(view => view?.dom.isConnected && view.state.field(reviewProjection, false)?.reviewId === reviewId && view.state.doc.toString() === original.markdown),
          card: () => document.querySelector(`section[data-proposal-id="${proposalId}"]`) ?? undefined,
          openCard: async card => { (await until(() => button('Review in editor', card), 'normal retried prepared Review')).click(); } });
        const reviewedDraft = await acknowledgedProbeDraft({ draft: () => api.getProposalDraft!(proposalId), until,
          working: () => ({ markdown: view.state.doc.toString(), title: probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor')?.value ?? '',
            decisions: view.state.field(reviewProjection, false)!.hunks }) });
        assertSharedMountedReview(reviewedDraft, reviewId, { connected: view.dom.isConnected, markdown: view.state.doc.toString(),
          title: probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor')?.value, projection: view.state.field(reviewProjection, false) });
        const acceptedDraft = expectedSharedKeepDraft(reviewedDraft, reviewId);
        const plan: IosPreparedKeepPlan = { proposalId, reviewId, reviewedDraft, acceptedDraft, expectedEditorMarkdown: expectedSharedEditorMarkdown(acceptedDraft), capturedAt: Date.now() };
        await emit({ phase: 'prepared-retry-ready-to-keep', preparedPlan: plan });
        await openChat(); const strip = await until(() => document.querySelector(`[data-proposal-strip="active"][data-proposal-id="${proposalId}"]`), 'normal retried prepared review strip');
        (await until(() => button('Keep All', strip) ?? button('Keep Remaining', strip), 'normal retried prepared Keep')).click();
        await until(async () => !(await api.listPendingProposals(conversationId)).some(value => value.id === proposalId), 'retired prepared proposal after native Keep');
        const settled = await api.getProposalDraft!(proposalId);
        const receipt = await api.commitAgentProposal!(proposalId, settled.markdown, settled.version), duplicate = await api.commitAgentProposal!(proposalId, settled.markdown, settled.version);
        const canonical = await invoke<SharedCanonicalNote>('read_note', { noteId: receipt.noteId, path: receipt.applied?.path });
        assertIosPreparedPublication(plan, settled, receipt, duplicate, canonical);
        return { proposalId, plan, settled, receipt, duplicate, canonical };
      },
      awaitCrash: () => new Promise(resolve => setTimeout(resolve, 20000)),
    });
    return await runIosPublicationFaultJourney({ api, config, launchId, emit,
      createAndEdit: async () => {
        assert((await api.listConversations()).length === 0, 'iOS publication fault requires a fresh generated root');
        const conversation = await api.createConversation({ title: `Pi iOS publication ${config.boundary} ${config.scope}`, vaultAccess: 'none', provider: 'local', model: 'pi-native-fixture' });
        await openChat(); const pane = await until(() => probeChatPane(), 'normal chat pane');
        await focusProbeChatComposer(pane, until);
        (await until(() => button('Conversations', pane), 'normal conversation picker')).click();
        (await until(() => Array.from(pane.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')).find(node => node.textContent?.trim() === conversation.title), 'created conversation picker item')).click();
        await until(() => probeChatPane(conversation.title), 'created conversation selected');
        const composer = await focusProbeChatComposer(pane, until);
        composer.focus(); composer.value = 'PI_UI:CREATE'; composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: composer.value }));
        (await until(() => probeComposerSend(composer), 'normal Send')).click();
        const source = await until(async () => {
          const message = (await api.getConversation(conversation.id)).messages.at(-1);
          assert(!['error', 'cancelled'].includes(message?.status ?? ''), message?.errorMessage ?? 'Synthetic proposal send failed');
          return message?.role === 'assistant' && message.status === 'completed' ? message : undefined;
        }, 'committed proposal assistant source');
        const pending = await api.listPendingProposals(conversation.id); assert(pending.length === 1, 'Expected exactly one model-created pending proposal');
        const proposal = pending[0], original = await api.getProposalDraft!(proposal.id), reviewId = proposal.preview.reviewId;
        assert(typeof reviewId === 'string' && reviewId.length > 0, 'Pending proposal lacks native review identity');
        const editor = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')).map(node => EditorView.findFromDOM(node))
          .find(view => view?.dom.isConnected && view.state.field(reviewProjection, false)?.reviewId === reviewId && view.state.doc.toString() === original.markdown);
        const view = await acquireProbeReview({ editor, openChat, until,
          card: () => document.querySelector(`section[data-proposal-id="${proposal.id}"]`) ?? undefined,
          openCard: async card => { (await until(() => button('Review in editor', card), 'normal Review in editor')).click(); } });
        const markdown = `Synthetic edited iOS publication bytes ${config.scope}.`, title = `Pi iOS edited ${config.scope}`;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: markdown }, userEvent: 'input.type' });
        const titleField = await until(() => {
          const node = probePaneTitle(view.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor');
          return node && !node.readOnly && visibleProbeControl(node) ? node : undefined;
        }, 'normal editable review title');
        titleField.focus(); titleField.value = title; titleField.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: title }));
        await pause(); titleField.blur();
        const draft = await acknowledgedProbeDraft({ draft: () => api.getProposalDraft!(proposal.id), until, working: () => ({ markdown: view.state.doc.toString(), title: titleField.value, decisions: view.state.field(reviewProjection, false)!.hunks }) });
        assertSharedMountedReview(draft, reviewId, { connected: view.dom.isConnected, markdown: view.state.doc.toString(), title: titleField.value, projection: view.state.field(reviewProjection, false) });
        await invoke('pi_validate_review_checkpoint', { markdown: draft.markdown, title: draft.title, path: draft.path, decisions: draft.decisions });
        return { conversationId: conversation.id, proposalId: proposal.id, reviewId, draft, source };
      },
      clickKeep: async proposalId => {
        await openChat(); const strip = await until(() => document.querySelector(`[data-proposal-strip="active"][data-proposal-id="${proposalId}"]`), 'normal active publication review strip');
        (await until(() => button('Keep All', strip) ?? button('Keep Remaining', strip), 'normal first Keep')).click();
        // Returning from DOM click does not mean the async native Keep returned.
        await new Promise(resolve => setTimeout(resolve, 20000));
      },
      waitCrashCommand,
      acknowledgeCrash,
      readCanonical: receipt => invoke('read_note', { noteId: receipt.noteId, path: receipt.applied?.path }),
    });
  } catch (error) { await emit({ phase: 'failed', status: 'failed', error: String(error) }); return report; }
}
