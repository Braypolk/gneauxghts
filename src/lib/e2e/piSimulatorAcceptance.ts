/** Instrumented ordinary WKWebView acceptance only. Never imported by an ordinary build. */
import { invoke } from '#lib/features/chat/pi/nativeInvoke.js';
import { ProviderDoc } from '@earendil-works/pi-durable';
import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate';
import type { ConversationId, ConversationView, LiveState, TaskId, WatchHandle } from '@earendil-works/pi-durable';
import type { PiChat, PI_CONTEXT } from '#lib/features/chat/pi/runtime.js';
import type { AuthoritySnapshot, ReadMode, WritePolicy } from '#lib/features/chat/pi/authority.js';
import type { PreparedMutation, PublicationIntent, ReconciliationResult } from '#lib/features/chat/pi/publication.js';
import type { PiViewSnapshot } from '#lib/features/chat/ui/piConversationView.js';
import type { NativeModelConfiguration } from '#lib/features/chat/pi/nativeProvider.js';
import type { PiDiagnosticSnapshot } from '#lib/features/chat/pi/diagnostics.js';

const SIMULATOR = 'FBAC4D90-9149-4B49-B40D-EA5B90B7069C';
const ENDPOINT = 'http://100.117.20.29:1234/v1', MODEL = 'qwen3.8-27b-gsq-rco';
type Pane = Pick<PiViewSnapshot, 'title' | 'view' | 'entries' | 'authority' | 'error' | 'read' | 'initialized' | 'loading'> & { conversationId: number | null };
type Bridge = {
  piChat(): Promise<PiChat>; piContext(): Promise<typeof PI_CONTEXT> | typeof PI_CONTEXT;
  piPublicationTask(): Promise<typeof import('#lib/features/chat/pi/publication.js').PublicationTask>;
  piNativeInvokeProbe(): Promise<typeof import('#lib/e2e/piNativeInvokeProbe.js')>;
  readPiChatState(): Pane[];
  readEditorState(): { noteId: string | null; editor: { markdown: string } | null };
};
type Host = Window & { __GNEAUXGHTS_NATIVE_E2E__?: Bridge; __PI_SIMULATOR_ACCEPTANCE_STOP__?: () => void };
type Action = 'snapshot' | 'diagnostics' | 'configure' | 'open-chat' | 'new-conversation' | 'select-conversation' | 'send'
  | 'wait-idle' | 'stop' | 'withdraw' | 'new-attempt' | 'read-mode' | 'attach' | 'remove-attachment'
  | 'reasoning' | 'tool-details' | 'source' | 'earlier' | 'save-fixture' | 'read-fixture' | 'exclude'
  | 'authority' | 'check-source' | 'grant' | 'prepare' | 'approve' | 'publish' | 'reconcile' | 'task' | 'challenge'
  | 'seed-history' | 'inspect-context' | 'history-fixture';
type Command = { runId: string; launchId: string; sequence: number; action: Action; args?: Record<string, unknown>; timeoutMillis?: number; deadlineAtMillis: number };
type Progress = { observations: number; textWhileBusy: boolean; reasoningWhileBusy: boolean; uiTextWhileBusy: boolean;
  uiReasoningWhileBusy: boolean; compactionObserved: boolean; firstTextAt?: number; firstReasoningAt?: number };
type Fixture = { noteId: string; title: string; path: string; markdown: string };
const fixtureKeys = new Set(['lantern', 'other', 'update', 'excluded']);
const body = (key: string, version: number) => key === 'lantern'
  ? `The expedition lantern is ${version === 1 ? 'amber' : 'violet'}. Its inventory code is LANTERN-742.`
  : `Generated ${key} fixture version ${version}. Inventory code SIM-${key.toUpperCase()}-${version}.`;

function requireValue(value: unknown, code: string): asserts value { if (!value) throw { code }; }
function stringArg(args: Record<string, unknown>, name: string, limit = 256) {
  const value = args[name]; requireValue(typeof value === 'string' && value.length > 0 && value.length <= limit, `invalid_${name}`); return value;
}
function numberArg(args: Record<string, unknown>, name: string) {
  const value = args[name]; requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value > 0, `invalid_${name}`); return value;
}
function safeCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(error.code)) return error.code;
  if (error === 'Editing Window requires a finalized baseline') return 'window_baseline_required';
  if (error === 'Finalize lifecycle transition before Editing Window admission') return 'window_path_transition_required';
  if (error === 'Editing Window requires a finalized anchor') return 'window_anchor_required';
  if (error === 'Surviving Editing Window requires startup recovery') return 'window_startup_recovery_required';
  return 'acceptance_action_failed'; // Never echo arbitrary native/provider errors into a report.
}
const pause = (ms = 100) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => T | Promise<T>, timeoutMillis = 30000): Promise<NonNullable<T>> {
  const end = Date.now() + timeoutMillis;
  while (Date.now() < end) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([Promise.resolve().then(read), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject({ code: 'acceptance_deadline' }), Math.max(1, end - Date.now()));
      })]);
      if (value) return value as NonNullable<T>;
    } finally { clearTimeout(timer); }
    await pause();
  }
  throw { code: 'acceptance_deadline' };
}
async function withinCommandDeadline<T>(command: Command, run: () => Promise<T>) {
  const remaining = command.deadlineAtMillis - Date.now();
  requireValue(Number.isSafeInteger(command.deadlineAtMillis) && remaining > 0 && remaining <= 660000, 'acceptance_phase_deadline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // This bounds observation only. The losing Pi/native operation is never aborted or replayed here.
    return await Promise.race([Promise.resolve().then(run), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject({ code: 'acceptance_phase_deadline' }), remaining);
    })]);
  } finally { clearTimeout(timer); }
}
const visible = (element: HTMLElement) => Boolean(element.getClientRects().length) && !element.closest('[inert]');
function findControl(label: string, root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(element =>
    !element.disabled && visible(element) && (element.getAttribute('aria-label') === label || element.textContent?.trim() === label));
}
async function click(label: string, root: ParentNode = document) { (await until(() => findControl(label, root))).click(); await pause(); }
function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.focus({ preventScroll: true }); element.value = value;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
}
async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function live(pane: Pane) { return pane.view?.docs['pi.live'] as LiveState | undefined; }
function sourceEvidence(source: unknown) {
  if (!source || typeof source !== 'object') return undefined;
  const value = source as { sourceId?: string; noteId?: string; readState?: { kind?: string; contentHash?: string; observedAtMillis?: number; revision?: { revisionId?: string; atMillis?: number } } };
  return { sourceId: value.sourceId, noteId: value.noteId, readState: { kind: value.readState?.kind, contentHash: value.readState?.contentHash,
    observedAtMillis: value.readState?.observedAtMillis, revisionId: value.readState?.revision?.revisionId, revisionAtMillis: value.readState?.revision?.atMillis } };
}
function taskResultEvidence(value: unknown) {
  if (!value || typeof value !== 'object' || !('status' in value)) return undefined;
  const result = value as { status: string; receiptId?: string; code?: string };
  return result.status === 'committed' ? { status: result.status, receiptId: result.receiptId }
    : result.status === 'blocked' ? { status: result.status, code: result.code } : undefined;
}

/** No inference runs until the root-owned controller supplies an explicit finite command. */
export async function runPiSimulatorAcceptance() {
  requireValue(import.meta.env.VITE_E2E_NATIVE === 'true' && import.meta.env.VITE_PI_SIMULATOR_ACCEPTANCE === 'true', 'instrumented_build_required');
  requireValue(location.pathname === '/', 'ordinary_workspace_required');
  const origin = new URL(import.meta.env.VITE_PI_SIMULATOR_CONTROL_ORIGIN ?? '');
  requireValue(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.port && origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash, 'invalid_control_origin');
  const token = import.meta.env.VITE_PI_SIMULATOR_CONTROL_TOKEN ?? '';
  requireValue(/^[a-f0-9]{64}$/.test(token), 'invalid_control_token');
  const host = window as Host, launchId = crypto.randomUUID();
  host.__PI_SIMULATOR_ACCEPTANCE_STOP__?.();
  let stopped = false, sequence = 0, currentCommand: Command | undefined;
  const watchers = new Map<number, WatchHandle<ConversationView>>(), attaching = new Set<number>();
  const stats = { observerErrors: 0, conversations: {} as Record<number, Progress> };
  const fixtures = new Map<string, Fixture>(), prepared = new Map<string, PreparedMutation>();
  let runtime: PiChat, context: typeof PI_CONTEXT, bridge: Bridge, vault: string;
  let nativeProbe: typeof import('#lib/e2e/piNativeInvokeProbe.js'), nativeObservation: ReturnType<typeof import('#lib/e2e/piNativeInvokeProbe.js').installPiNativeInvokeProbe> | undefined;
  let cancelPark = () => {};
  const fetchControl = async (path: string, value?: unknown) => {
    const response = await fetch(`${origin.origin}${path}`, { method: value === undefined ? 'GET' : 'POST',
      headers: { 'x-pi-acceptance-token': token, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal: AbortSignal.timeout(10000) });
    requireValue(response.ok, 'control_request_failed'); return response.status === 204 ? undefined : response.json();
  };
  const emit = (kind: string, evidence: unknown, command = currentCommand) => fetchControl('/receipt', {
    launchId, sequence: command?.sequence ?? 0, runId: command?.runId, action: command?.action ?? 'ready', kind, atMillis: Date.now(), evidence
  });
  const pane = () => { const panes = bridge.readPiChatState(); requireValue(panes.length === 1, 'one_chat_pane_required'); return panes[0]; };
  const assertPath = (path: string) => requireValue(path.startsWith(`${vault}/`) && !path.slice(vault.length + 1).split('/').includes('..'), 'fixture_outside_owned_vault');
  const readFixture = async (args: Record<string, unknown>) => {
    const note = await invoke<Fixture>('read_note', { noteId: stringArg(args, 'noteId'), path: null });
    assertPath(note.path); requireValue(note.title.startsWith('Pi simulator '), 'generated_fixture_required'); return note;
  };
  const authority = async (id = pane().authority?.authorityId) => {
    requireValue(id, 'conversation_authority_required'); return invoke<AuthoritySnapshot>('pi_chat_authority', { authorityId: id });
  };
  const sample = (id: number, view: ConversationView) => {
    const progress = stats.conversations[id] ??= { observations: 0, textWhileBusy: false, reasoningWhileBusy: false, uiTextWhileBusy: false, uiReasoningWhileBusy: false, compactionObserved: false };
    const state = view.docs['pi.live'] as { run?: unknown; compactions?: unknown[]; generation?: { message?: { content: Array<{ type: string; text?: string; thinking?: string }> } } } | undefined;
    progress.observations++; progress.compactionObserved ||= Boolean(state?.compactions?.length);
    if (state?.run) for (const block of state.generation?.message?.content ?? []) {
      if (block.type === 'text' && block.text) { progress.textWhileBusy = true; progress.firstTextAt ??= performance.now(); }
      if (block.type === 'thinking' && block.thinking) { progress.reasoningWhileBusy = true; progress.firstReasoningAt ??= performance.now(); }
    }
  };
  const attach = () => {
    for (const selected of bridge.readPiChatState()) {
      const id = selected.conversationId; if (!id || watchers.has(id) || attaching.has(id) || stopped) continue;
      attaching.add(id);
      void (async () => {
        const conversation = await runtime.harness.conversation(id as ConversationId, context); if (!conversation) return;
        const watch = await conversation.watch(context); if (stopped) { await watch.stop(); return; }
        watchers.set(id, watch); sample(id, watch.value); watch.start(async view => { sample(id, view); });
      })().catch(() => { stats.observerErrors++; }).finally(() => attaching.delete(id));
    }
  };
  const observer = new MutationObserver(() => {
    attach(); const selected = bridge?.readPiChatState()[0]; if (!selected?.conversationId) return;
    const progress = stats.conversations[selected.conversationId]; if (!progress) return;
    const article = document.querySelector('[data-testid="pi-assistant-message"][data-streaming="true"]');
    progress.uiTextWhileBusy ||= Boolean(article?.querySelector('.gn-markdown-surface')?.textContent?.trim());
    progress.uiReasoningWhileBusy ||= Boolean(document.querySelector('[data-testid="pi-reasoning"][data-streaming="true"] pre')?.textContent?.trim());
  });
  let unsubscribe = () => {};
  const publicationEvidence = async (result: ReconciliationResult) => result.status === 'committed'
    ? { status: result.status, receiptId: result.receiptId, noteId: result.noteId, markdownSha256: await hash(result.markdown), commitWarning: Boolean(result.commitWarning) }
    : result.status === 'blocked' ? { status: result.status, code: result.code } : { status: result.status };
  host.__PI_SIMULATOR_ACCEPTANCE_STOP__ = () => {
    stopped = true; observer.disconnect(); unsubscribe(); for (const watch of watchers.values()) void watch.stop();
    cancelPark(); nativeObservation?.stop();
  };

  const layoutEvidence = () => {
    const panel = document.querySelector('[data-testid="pi-chat-panel"]');
    const geometry = (element: Element | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        scroll: { top: element.scrollTop, height: element.scrollHeight, clientHeight: element.clientHeight },
        style: { display: style.display, visibility: style.visibility, opacity: style.opacity, overflowY: style.overflowY,
          paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, color: style.color }, characters: element.textContent?.length ?? 0 };
    };
    const log = panel?.querySelector('[role="log"]') ?? null, rect = log?.getBoundingClientRect();
    const hit = rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
    return { panel: geometry(panel), log: geometry(log), lane: geometry(log?.firstElementChild ?? null),
      users: Array.from(panel?.querySelectorAll('[data-testid="pi-user-message"]') ?? []).slice(-3).map(geometry),
      assistants: Array.from(panel?.querySelectorAll('[data-testid="pi-assistant-message"]') ?? []).slice(-3).map(geometry),
      viewport: { innerHeight, offsetY: scrollY, height: visualViewport?.height, top: visualViewport?.offsetTop },
      centerHit: hit ? { tag: hit.tagName, testId: hit.getAttribute('data-testid'), className: hit.getAttribute('class') } : null };
  };
  const snapshot = async () => {
    const selected = bridge.readPiChatState()[0];
    const entries = selected?.entries ?? [], editor = bridge.readEditorState();
    const inbox = selected?.view?.docs['pi.inbox'] as { items?: Array<{ id: number; mode: string }> } | undefined;
    return { layout: layoutEvidence(), route: location.pathname, chatPanes: bridge.readPiChatState().length, conversationId: selected?.conversationId ?? null,
      initialized: selected?.initialized ?? false, loading: selected?.loading ?? false, error: Boolean(selected?.error),
      authority: selected?.authority, providerSessionId: selected?.conversationId ? (await runtime.harness.snapshot(ProviderDoc, selected.conversationId as ConversationId, context))?.sessionId : undefined,
      live: selected ? { run: Boolean(live(selected)?.run), compactions: live(selected)?.compactions?.length ?? 0,
        generationCharacters: live(selected)?.generation?.message?.content.reduce((count, block) => count + (block.type === 'text' ? block.text.length : 0), 0) ?? 0,
        reasoningBlocks: live(selected)?.generation?.message?.content.filter(block => block.type === 'thinking').length ?? 0 } : null,
      inbox: (inbox?.items ?? []).slice(0, 64).map(item => ({ id: item.id, mode: item.mode })),
      entries: await Promise.all(entries.slice(-256).map(async entry => ({ id: entry.id, kind: entry.kind, messages: await Promise.all((entry.model ?? []).map(async message => {
        const blocks = typeof message.content === 'string' ? [] : message.content;
        const text = typeof message.content === 'string' ? message.content : blocks.filter(block => block.type === 'text').map(block => block.type === 'text' ? block.text : '').join('\n');
        return { role: message.role, characters: text.length, textSha256: await hash(text),
          ...(message.role === 'assistant' ? { stopReason: message.stopReason, reasoningBlocks: blocks.filter(block => block.type === 'thinking').length } : {}),
          ...(message.role === 'toolResult' ? { toolName: message.toolName, isError: message.isError, source: message.details && typeof message.details === 'object' && 'source' in message.details ? sourceEvidence((message.details as { source: unknown }).source) : undefined } : {}) };
      })) }))),
      dom: { users: document.querySelectorAll('[data-testid="pi-user-message"]').length, assistants: document.querySelectorAll('[data-testid="pi-assistant-message"]').length,
        sources: document.querySelectorAll('[data-pi-source]').length, reasoning: Array.from(document.querySelectorAll('[data-testid="pi-reasoning"]')).map(element => ({ open: element.querySelector(':scope > [data-slot="trace-collapsible-trigger"]')?.getAttribute('aria-expanded') === 'true' })),
        queue: document.querySelectorAll('[aria-label="Withdraw queued message"]').length, historyMode: Boolean(document.querySelector('[data-testid="history-mode"]')),
        keyboardFocused: document.activeElement?.getAttribute('aria-label') === 'Message' }, editorNoteId: editor.noteId,
      editor: editor.editor ? { characters: editor.editor.markdown.length, markdownSha256: await hash(editor.editor.markdown) } : null,
      stats: { ...stats, native: nativeObservation?.read() } };
  };
  const openChat = async () => {
    if (!document.querySelector('[data-testid="pi-chat-panel"]')) {
      const mobile = findControl('Open thought partner');
      if (mobile) mobile.click();
      else {
        const split = findControl('Split pane');
        if (split) { split.click(); await click('Open thought partner. Press 3.'); }
        else { (await until(() => findControl('Open split pane options'))).focus(); await click('Split with thought partner'); }
      }
    }
    await until(() => bridge.readPiChatState().length === 1 && pane().initialized && !pane().loading);
    await until(() => { const composer = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]'); return composer && !composer.disabled; });
  };
  const selectedConversation = async () => {
    const id = pane().conversationId; requireValue(id, 'conversation_required');
    const conversation = await runtime.harness.conversation(id as ConversationId, context);
    requireValue(conversation, 'conversation_required'); return conversation;
  };
  const inspectContext = async () => {
    const conversation = await selectedConversation(), current = await conversation.context(context);
    const history = await conversation.entries({ order: 'ascending' }, 256, undefined, context);
    const agent = await conversation.agent(context), resolved = agent.model ? runtime.models.getModel(agent.model.provider, agent.model.modelId) : undefined;
    const reason = (data: unknown) => {
      const value = data && typeof data === 'object' && 'reason' in data ? data.reason : undefined;
      return value === 'threshold' || value === 'overflow' || value === 'manual' ? value : undefined;
    };
    const compactions = pane().view?.docs['pi.live'] as { compactions?: Array<{ taskId: number; blocking: boolean; reason: string; attempt: number }> } | undefined;
    return { conversationId: conversation.id,
      model: resolved ? { provider: resolved.provider, id: resolved.id, contextWindow: resolved.contextWindow, maxTokens: resolved.maxTokens } : undefined,
      head: current.head ? { id: current.head.id, kind: current.head.kind, reason: reason(current.head.data) } : null,
      contextCharacters: JSON.stringify(current.messages).length, contextEntryCount: current.entries.length,
      historyPageCount: history.items.length, historyHasMore: history.next !== undefined,
      historyEntries: history.items.map(entry => ({ id: entry.id, kind: entry.kind, ...(entry.kind === 'pi.compaction' ? { reason: reason(entry.data) } : {}) })),
      compactions: (compactions?.compactions ?? []).map(task => ({ taskId: task.taskId, blocking: task.blocking, reason: task.reason, attempt: task.attempt })),
      requests: (nativeObservation?.read().requests ?? []).slice(-64).map(request => ({ conversationId: request.conversationId, characters: request.characters,
        summary: request.summary, hasSummary: request.hasSummary, hasOldSeed: request.hasOldSeed, hasRecentSeed: request.hasRecentSeed,
        hasContinuation: request.hasContinuation, startedAt: request.startedAt })) };
  };
  const handle = async (command: Command) => {
    const args = command.args ?? {}, deadline = command.timeoutMillis ?? 30000;
    switch (command.action) {
      case 'snapshot': return snapshot();
      case 'diagnostics': {
        const mode = stringArg(args, 'mode');
        requireValue(mode === 'observe' || mode === 'reports' || mode === 'terminal-notification', 'invalid_diagnostic_mode');
        const before = await authority();
        requireValue(!before.retired, 'active_authority_required');
        requireValue(mode !== 'terminal-notification' || (!live(pane())?.run && !live(pane())?.compactions?.length), 'idle_conversation_required');
        const requestsBefore = nativeObservation?.read().bridge.pi_chat_fetch?.calls ?? 0;
        const canary = 'PI_ADAPTER_SYNTHETIC_PRIVATE_CANARY_742';
        let gettersRead = 0;
        if (mode === 'reports') {
          const hostile = Object.defineProperties({}, {
            code: { get() { gettersRead++; return canary; } },
            message: { get() { gettersRead++; return canary; } },
          });
          runtime.diagnostics.report(hostile);
          for (let index = 0; index < 1024; index++) runtime.diagnostics.report(new Error(canary));
          runtime.diagnostics.report({ code: 'credential', message: canary, stack: canary, headers: { authorization: canary }, body: canary });
        } else if (mode === 'terminal-notification') {
          // Tests presentation only. No Harness/storage fault or terminal settlement is claimed.
          runtime.diagnostics.end({ reason: 'failed', error: new Error(canary) });
        }
        if (mode !== 'observe') await until(() => document.querySelector(mode === 'reports'
          ? '[data-diagnostic-code="runtime_report"]' : '[data-diagnostic-code="runtime_failed"]'), 10000);
        let diagnostic: PiDiagnosticSnapshot = { state: 'open', notices: [] };
        runtime.diagnostics.subscribe(value => { diagnostic = value; })();
        const dom = document.querySelector('[data-testid="pi-runtime-diagnostics"]')?.textContent ?? '';
        const requestsAfter = nativeObservation?.read().bridge.pi_chat_fetch?.calls ?? 0;
        return { evidenceKind: mode === 'terminal-notification' ? 'synthetic-terminal-notification' : mode === 'reports' ? 'synthetic-runtime-report' : 'diagnostic-observation',
          state: diagnostic.state, noticeCount: diagnostic.notices.length, codes: diagnostic.notices.map(item => item.code),
          repeatCount: diagnostic.notices.find(item => item.code === 'runtime_report')?.count ?? 0, gettersRead,
          sinkSafe: !JSON.stringify(diagnostic).includes(canary), domSafe: !document.body.textContent?.includes(canary),
          noInventedActivity: !/\bstuck\b|\bthinking\b/i.test(dom), reportVisible: Boolean(document.querySelector('[data-diagnostic-code="runtime_report"]')),
          failureVisible: Boolean(document.querySelector('[data-diagnostic-code="runtime_failed"]')),
          inferenceCallsUnchanged: requestsBefore === requestsAfter, nativeAuthorityUnchanged: JSON.stringify(before) === JSON.stringify(await authority()),
          generationActive: Boolean(live(pane())?.run), compactionCount: live(pane())?.compactions?.length ?? 0 };
      }
      case 'inspect-context': return inspectContext();
      case 'seed-history': {
        const mode = stringArg(args, 'mode'); requireValue(mode === 'threshold' || mode === 'background', 'invalid_seed_mode');
        requireValue(!live(pane())?.run && !live(pane())?.compactions?.length, 'idle_conversation_required');
        requireValue(!(await authority()).retired, 'active_authority_required');
        const conversation = await selectedConversation(), agent = await conversation.agent(context);
        requireValue(agent.model, 'conversation_model_required');
        const metadata = await invoke<NativeModelConfiguration>('pi_chat_model_configuration', { provider: agent.model.provider, model: agent.model.modelId });
        requireValue(metadata.contextWindow && Number.isSafeInteger(metadata.contextWindow) && metadata.contextWindow > 0, 'loaded_context_capacity_required');
        const registered = runtime.models.getModel(agent.model.provider, agent.model.modelId);
        requireValue(registered?.contextWindow === metadata.contextWindow, 'registered_context_capacity_mismatch');
        const before = await conversation.entries({ order: 'ascending' }, 256, undefined, context);
        requireValue(!before.next && !before.items.some(entry => entry.kind === 'acceptance.synthetic-history'), 'unseeded_bounded_history_required');
        const count = mode === 'threshold' ? 16 : 12, fraction = mode === 'threshold' ? 1 : 0.65;
        const paragraph = mode === 'threshold'
          ? 'This is synthetic source-free acceptance history about a fictional observatory. Keep the visitor welcome as the current goal. No vault facts, permissions or tools are implied. '
          : 'Generated fictional observatory history; no notes, sources or permissions implied. ';
        let block = mode === 'threshold' ? 'SYNTHETIC_HISTORY_ORIGIN_' : 'BACKGROUND_SYNTHETIC_HISTORY_';
        while (estimateTextTokens(block) < metadata.contextWindow * fraction / count) {
          block += paragraph; requireValue(block.length * count <= 600000, 'generated_history_size_exceeds_bound');
        }
        const blocks = Array.from({ length: count }, (_, index) => mode === 'threshold'
          ? `Synthetic history block ${index}.\n${block}` : `Background synthetic history ${index}. ${block}`);
        const characters = blocks.reduce((sum, value) => sum + value.length, 0);
        requireValue(characters <= 600000, 'generated_history_size_exceeds_bound');
        const endsAt = Date.now() + Math.min(deadline, 60000);
        // Passive public Pi history writes; no generated assistant/usage, SQL or policy override.
        for (const content of blocks) {
          requireValue(Date.now() < endsAt, 'acceptance_deadline');
          const submission = await conversation.submit({ type: 'write', entry: { kind: 'acceptance.synthetic-history', data: { generated: true },
            model: [{ role: 'user', content, timestamp: Date.now() }] } }, context);
          await until(async () => { await submission.wait(context); return true; }, Math.max(1, endsAt - Date.now()));
        }
        return { mode, blockCount: count, fraction, generatedCharacters: characters, estimatedTokens: blocks.reduce((sum, value) => sum + estimateTextTokens(value), 0),
          metadata: { provider: metadata.provider, model: metadata.model, contextWindow: metadata.contextWindow, maxTokens: metadata.maxTokens }, context: await inspectContext() };
      }
      case 'challenge': return { challenge: stringArg(args, 'nonce'), visibility: document.visibilityState, observedAtMillis: Date.now() };
      case 'configure': {
        const endpoint = typeof args.endpoint === 'string' ? args.endpoint : ENDPOINT;
        requireValue(endpoint === ENDPOINT || /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}\/v1$/.test(endpoint), 'invalid_provider_endpoint');
        const model = typeof args.model === 'string' ? args.model : MODEL;
        requireValue(model === MODEL || model === 'pi-acceptance-fixture', 'invalid_provider_model');
        const settings = await invoke<Record<string, unknown>>('chat_get_settings');
        await invoke('chat_set_defaults', { defaults: { ...settings, provider: 'local', model, localModel: model, localBaseUrl: endpoint, defaultAccess: args.restricted === true ? 'none' : 'full', reasoningEffort: 'on' } });
        await invoke('chat_set_local_model_capabilities', { model, capabilities: { tools: true, images: false, audio: false, video: false, reasoningEffort: 'on' } });
        const admitted = await invoke<Record<string, unknown>>('chat_get_settings');
        requireValue(admitted.localBaseUrl === endpoint && admitted.localModel === model, 'settings_readback_failed');
        return { endpoint, model, defaultAccess: admitted.defaultAccess, reasoningEffort: admitted.reasoningEffort,
          metadata: await invoke('pi_chat_model_configuration', { provider: 'local', model }) };
      }
      case 'open-chat': await openChat(); return snapshot();
      case 'new-conversation': await click('Conversations'); await click('New conversation'); await until(() => pane().conversationId === null); return snapshot();
      case 'select-conversation': {
        const id = numberArg(args, 'conversationId'), listed = await runtime.listConversations(128), summary = listed.items.find(item => item.id === id);
        requireValue(summary, 'conversation_not_in_fixture_list'); await click('Conversations');
        const label = `${summary.title || 'Conversation'}${summary.retired ? ' · Previous access' : ''}`;
        const control = await until(() => {
          const element = document.querySelector<HTMLButtonElement>(`[role="menu"][aria-label="Conversations"] button[role="menuitem"][data-conversation-id="${id}"]`);
          return element && !element.disabled && visible(element) && element.textContent?.trim() === label ? element : undefined;
        });
        control.click(); await pause();
        await until(() => pane().conversationId === id && !pane().loading); return snapshot();
      }
      case 'send': {
        const kind = stringArg(args, 'kind');
        const prompts: Record<string, string> = {
          'source-free': 'Reason through a fictional three-day observatory visit, then provide a detailed 400-word itinerary. Use no notes or tools. This is generated simulator acceptance.',
          hold: 'Reason carefully about a fictional space museum and give a detailed 2500-word tour plan. Use no notes or tools. This is generated simulator acceptance.',
          'queued-withdraw': 'Generated simulator queued message to withdraw before execution. Say WITHDRAW-SENTINEL only.',
          'queued-keep': 'Generated simulator queued message to retain. Say KEEP-SENTINEL only.',
          continuation: 'Continue with one short sentence about our fictional observatory visitor. Use no notes or tools.',
          'fixture-read': 'fixture-read', 'fixture-hold': 'fixture-hold', 'fixture-error': 'fixture-error'
        };
        let text = prompts[kind];
        if (kind === 'read') { const title = stringArg(args, 'fixtureTitle', 160); requireValue(title.startsWith('Pi simulator '), 'generated_fixture_required');
          text = `Find the saved note titled ${title} using search_notes, read it with read_note, and report its inventory code and color. Copy the exact Markdown citation returned by read_note.`; }
        requireValue(text, 'invalid_prompt_kind');
        const before = pane().entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'user').length;
        const composer = await until(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]'));
        input(composer, text); await until(() => { const button = document.querySelector<HTMLButtonElement>('[data-testid="pi-send"]'); if (button && !button.disabled) { button.click(); return true; } });
        await until(() => pane().conversationId && (pane().entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'user').length > before || Boolean((pane().view?.docs['pi.inbox'] as { items?: unknown[] } | undefined)?.items?.length)));
        return { conversationId: pane().conversationId, promptKind: kind, characters: text.length, snapshot: await snapshot() };
      }
      case 'wait-idle': await until(() => {
        const selected = pane(), user = selected.entries.findLast(entry => entry.model?.some(message => message.role === 'user')),
          assistant = selected.entries.findLast(entry => entry.model?.some(message => message.role === 'assistant'));
        return selected.conversationId && !live(selected)?.run && !live(selected)?.compactions?.length && assistant && (!user || assistant.id >= user.id);
      }, deadline); return snapshot();
      case 'stop': await click('Stop'); await until(() => !live(pane())?.run && !live(pane())?.compactions?.length, deadline); return snapshot();
      case 'withdraw': { const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Withdraw queued message"]')).filter(visible), index = Number(args.index ?? 0); requireValue(Number.isSafeInteger(index) && buttons[index], 'queued_message_unavailable'); buttons[index].click(); await pause(); return snapshot(); }
      case 'new-attempt': await click('New attempt'); return snapshot();
      case 'read-mode': {
        const mode = stringArg(args, 'mode') as ReadMode; requireValue(mode === 'fullVault' || mode === 'attachedNotesOnly', 'invalid_read_mode');
        const select = await until(() => document.querySelector<HTMLSelectElement>('select[aria-label="Vault access"]')); select.value = mode; select.dispatchEvent(new Event('change', { bubbles: true }));
        await until(() => pane().read.mode === mode && !pane().loading); return snapshot();
      }
      case 'attach': {
        const note = await readFixture(args); await click('Attach notes'); const field = await until(() => document.querySelector<HTMLInputElement>('[aria-label="Find notes to attach"]'));
        input(field, note.title); await click(note.title); await until(() => pane().read.attachedNoteIds.includes(note.noteId)); return snapshot();
      }
      case 'remove-attachment': { const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Remove attached note"]')).filter(visible), index = Number(args.index ?? 0); requireValue(Number.isSafeInteger(index) && buttons[index], 'attachment_unavailable'); buttons[index].click(); await pause(); return snapshot(); }
      case 'reasoning': case 'tool-details': {
        const selector = command.action === 'reasoning' ? '[data-testid="pi-reasoning"]' : '[data-testid="pi-tool-result"]';
        const group = document.querySelector('[data-testid="pi-tool-activity"]');
        const groupTrigger = group?.querySelector<HTMLButtonElement>(':scope > [data-slot="trace-collapsible-trigger"]');
        if (groupTrigger?.getAttribute('aria-expanded') === 'false') { groupTrigger.click(); await pause(); }
        const details = await until(() => document.querySelector(selector));
        const trigger = details.querySelector<HTMLButtonElement>(':scope > [data-slot="trace-collapsible-trigger"]');
        requireValue(trigger, 'disclosure_trigger_unavailable');
        const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
        trigger.click(); await until(() => (trigger.getAttribute('aria-expanded') === 'true') !== wasOpen, deadline);
        return { open: trigger.getAttribute('aria-expanded') === 'true', snapshot: await snapshot() };
      }
      case 'source': { const source = await until(() => document.querySelector<HTMLElement>('[data-pi-source]')); source.click(); await pause(); return snapshot(); }
      case 'earlier': await click('Load earlier messages'); return snapshot();
      case 'save-fixture': {
        const key = stringArg(args, 'key'); requireValue(fixtureKeys.has(key), 'invalid_fixture_key'); const version = args.version === 2 ? 2 : 1;
        const prior = typeof args.noteId === 'string' ? await readFixture(args) : fixtures.get(key);
        const title = prior?.title ?? `Pi simulator ${command.runId.slice(0, 8)} ${key}`;
        const note = await invoke<Fixture>('save_note', { title, markdown: body(key, version), currentPath: prior?.path ?? null });
        assertPath(note.path); fixtures.set(key, note);
        if (args.finalize === true) await invoke('finalize_note_editing_window', { noteId: note.noteId });
        return { key, noteId: note.noteId, title: note.title, markdownSha256: await hash(note.markdown), finalized: args.finalize === true };
      }
      case 'read-fixture': {
        const note = await readFixture(args), id = typeof args.authorityId === 'string' ? args.authorityId : (await authority()).authorityId;
        try { const read = await invoke<{ markdown: string; source: unknown }>('pi_chat_read_note', { authorityId: id, noteId: note.noteId }); return { permitted: true, source: sourceEvidence(read.source), markdownSha256: await hash(read.markdown) }; }
        catch (error) { return { permitted: false, code: safeCode(error) }; }
      }
      case 'history-fixture': {
        const note = await readFixture(args);
        const page = await invoke<{ records: Array<{ kind: string; recordId: string; revisionId?: string; eventKind?: string; path?: string; previousPath?: string }> }>('get_note_history_page', { noteId: note.noteId, cursor: null, limit: 30 });
        const container = (path: string | undefined) => path?.match(/\/Containers\/Data\/Application\/([A-Fa-f0-9-]+)\//)?.[1];
        return { noteId: note.noteId, currentContainer: container(note.path), markdownSha256: await hash(note.markdown),
          records: await Promise.all(page.records.map(async record => ({ kind: record.kind, recordId: record.recordId,
            revisionId: record.revisionId, eventKind: record.eventKind, container: container(record.path), previousContainer: container(record.previousPath),
            sameCurrentPath: record.path ? record.path === note.path : undefined, pathSha256: record.path ? await hash(record.path) : undefined }))) };
      }
      case 'exclude': { const note = await readFixture(args); requireValue(typeof args.excluded === 'boolean', 'invalid_exclusion'); return invoke('pi_chat_set_exclusion', { noteId: note.noteId, excluded: args.excluded }); }
      case 'authority': return authority(typeof args.authorityId === 'string' ? args.authorityId : undefined);
      case 'check-source': {
        try { const destination = await invoke<{ kind: string }>('pi_chat_open_source', { authorityId: stringArg(args, 'authorityId'), sourceId: stringArg(args, 'sourceId') }); return { permitted: true, kind: destination.kind }; }
        catch (error) { return { permitted: false, code: safeCode(error) }; }
      }
      case 'grant': {
        const current = await authority(); requireValue(typeof args.review === 'boolean', 'invalid_review_policy');
        const duration = stringArg(args, 'duration'); requireValue(['off', 'temporary', 'always'].includes(duration), 'invalid_grant_duration');
        const write: WritePolicy = { grant: duration === 'off' ? { duration: 'off' } : duration === 'temporary'
          ? { duration: 'temporary', conversationId: pane().conversationId!, operations: ['update'], scope: { noteIds: [], folders: ['.'] } }
          : { duration: 'always', operations: ['update'], scope: { noteIds: [], folders: ['.'] } }, reviewBeforeApplying: args.review };
        return invoke('pi_chat_set_write_policy', { authorityId: current.authorityId, expectedRevision: current.revision, write });
      }
      case 'prepare': {
        const current = await authority(), operation = stringArg(args, 'operation'); requireValue(operation === 'update', 'invalid_mutation_operation');
        const note = await readFixture(args);
        const mutation = { operation: 'update', noteId: note.noteId, expectedReadSourceId: stringArg(args, 'sourceId'), markdown: 'Fresh authorized synthetic simulator update.' };
        const result = await invoke<PreparedMutation>('pi_chat_prepare_mutation', { authorityId: current.authorityId, requestId: `simulator-${command.runId}-${command.sequence}`, mutation });
        assertPath(result.target.path); prepared.set(result.intentId, result); return { intentId: result.intentId, payloadHash: result.payloadHash, reviewRequired: result.reviewRequired, noteId: result.target.noteId };
      }
      case 'approve': { const intent = prepared.get(stringArg(args, 'intentId')); requireValue(intent, 'prepared_intent_required'); await invoke('pi_chat_approve_mutation', { authorityId: (await authority()).authorityId, intentId: intent.intentId, payloadHash: intent.payloadHash }); return { intentId: intent.intentId, approved: true }; }
      case 'publish': {
        const intent = prepared.get(stringArg(args, 'intentId')); requireValue(intent, 'prepared_intent_required');
        const conversation = await runtime.harness.conversation(pane().conversationId as ConversationId, context); requireValue(conversation, 'conversation_required');
        const taskStarted = Promise.withResolvers<void>();
        let disarm = () => {};
        if (args.parkAcknowledgement === true) cancelPark = disarm = nativeProbe.parkNextPublicationAcknowledgement(intent.intentId, async receipt => {
          await taskStarted.promise;
          await emit('publication-boundary', { intentId: intent.intentId, boundary: 'lost-webview-ack-after-native-commit', status: 'committed',
            receiptId: receipt.receiptId, noteId: receipt.noteId, markdownSha256: receipt.markdownSha256, commitWarning: Boolean(receipt.commitWarning) }, command);
          // Root terminates this exact app. The actual pending Pi task/native proof is untouched.
          return new Promise<void>(() => {});
        });
        try {
          const task = await bridge.piPublicationTask(), value: PublicationIntent = { authorityId: (await authority()).authorityId, intentId: intent.intentId, target: intent.target };
          const id = await conversation.commit(tx => tx.createTask(task, value, { ownership: { kind: 'conversation' } }), context);
          await emit('publication-task-started', { taskId: id, intentId: intent.intentId }, command); taskStarted.resolve();
          const settled = await until(async () => {
            const current = await runtime.harness.getTask(id, context);
            return current?.state.status === 'terminal' ? current : undefined;
          }, deadline);
          const outcome = settled.state.status === 'terminal' ? settled.state.outcome : undefined;
          return { taskId: id, intentId: intent.intentId, taskStatus: settled.state.status, outcomeStatus: outcome?.status,
            result: outcome?.status === 'completed' ? taskResultEvidence(outcome.result) : undefined,
            reconciliation: outcome?.status === 'completed' ? await publicationEvidence(await invoke<ReconciliationResult>('pi_chat_reconcile_mutation', { intentId: intent.intentId })) : undefined };
        } finally { disarm(); }
      }
      case 'reconcile': return publicationEvidence(await invoke<ReconciliationResult>('pi_chat_reconcile_mutation', { intentId: stringArg(args, 'intentId') }));
      case 'task': {
        const id = numberArg(args, 'taskId') as TaskId, task = await runtime.storage.task(id, context); requireValue(task, 'task_unavailable');
        const outcome = task.state.status === 'terminal' ? task.state.outcome : undefined;
        return { taskId: id, taskStatus: task.state.status, outcomeStatus: outcome?.status,
          result: outcome?.status === 'completed' ? taskResultEvidence(outcome.result) : undefined };
      }
      default: throw { code: 'unknown_acceptance_action' };
    }
  };
  try {
    bridge = await until(() => host.__GNEAUXGHTS_NATIVE_E2E__);
    nativeProbe = await bridge.piNativeInvokeProbe(); nativeObservation = nativeProbe.installPiNativeInvokeProbe();
    await until(() => document.querySelector('[data-testid="note-title"]'));
    vault = (await invoke<{ runningPath: string }>('get_vault_info')).runningPath.replace(/\/$/, '');
    requireValue(new RegExp(`/CoreSimulator/Devices/${SIMULATOR}/data/Containers/Data/Application/[A-Fa-f0-9-]+/Documents/Notes$`).test(vault), 'isolated_simulator_vault_required');
    runtime = await bridge.piChat(); context = await bridge.piContext();
    unsubscribe = runtime.harness.subscribeCommits(() => queueMicrotask(attach));
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-streaming'] }); attach();
    await emit('ready', { route: location.pathname, simulator: SIMULATOR, visibility: document.visibilityState, instrumented: true, vaultVerified: true });
    while (!stopped) {
      const command = await fetchControl(`/command?launchId=${encodeURIComponent(launchId)}`) as Command | undefined;
      if (!command) { await pause(250); continue; }
      requireValue(command.launchId === launchId && command.sequence > sequence && /^[a-zA-Z0-9-]{8,64}$/.test(command.runId), 'foreign_or_stale_command');
      sequence = command.sequence; currentCommand = command;
      try { await emit('completed', await withinCommandDeadline(command, () => handle(command))); }
      catch (error) {
        const code = safeCode(error), expired = code === 'acceptance_deadline' || code === 'acceptance_phase_deadline';
        const failure = emit('failed', { code: expired ? 'acceptance_phase_deadline' : code, ...(expired ? { underlyingProductMayContinue: true } : {}) });
        if (expired) {
          // A timed-out handler may still be running. No second probe job is admitted on this launch.
          await failure.catch(() => {}); break;
        }
        await failure;
      } finally { currentCommand = undefined; }
    }
  } catch (error) {
    await emit('failed', { code: safeCode(error) }).catch(() => {});
    host.__PI_SIMULATOR_ACCEPTANCE_STOP__?.();
  }
}
