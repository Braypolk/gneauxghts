// Explicit native acceptance supplement. It uses the mounted composer/Stop and
// public ChatApi; only the provider's terminal frames wait at fixture barriers.
import { invoke } from '@tauri-apps/api/core';
import { EditorView } from '@codemirror/view';
import type { ChatApi } from '$lib/features/chat/api';
import type { ChatConversation, ChatMessage, ChatProvider } from '$lib/features/chat/types';
import { acquireFollowonsConversation, followonsReasoningMode, type FollowonsConversationControls } from './followonsConversation';
import { collapseFollowonsEditorSelections } from './followonsEditorContext';
import { openVisibleProbeChat, visibleProbeControl } from './probeChatFocus';
import { focusProbeChatComposer, probeChatPane, probeComposerSend } from './probeChatSend';
import { probePaneTitle } from './probePaneTitle';

type Source = { noteId: string; path: string; title: string; markdown: string };
type Race = 'edit' | 'rename' | 'exclude';
type Barrier = { barrier: string; heldAt: number; releasedAt: number | null; closedAt: number | null; closedBeforeRelease: boolean; completed: boolean; firstTextAt: number | null };
export type SupplementalEvidenceReport = {
  gate: 'supplemental-native-evidence-fixture'; status: 'running' | 'passed' | 'failed'; run: string;
  checks: string[]; receipts: Record<string, Record<string, Record<string, unknown>>>; error?: string;
};
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
async function until<T>(read: () => T | Promise<T>, description: string, timeout = 30000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (value) return value as NonNullable<T>; await pause(); }
  throw new Error(`Supplemental evidence deadline: ${description}`);
}
const noteCitations = (message: ChatMessage) => message.citations.filter(source => source.kind === 'note');

export function assertNoProvisionalEvidence(message: ChatMessage) {
  assert(message.content === '' && !message.answerDraft?.text && message.citations.length === 0
    && !message.parts.some(part => part.type === 'text' && part.text || part.type === 'sources' && part.citations.length),
  'Provisional structured answer or answer sources escaped native admission');
}
export function assertSourceRaceOutcome(action: Race, message: ChatMessage, source: Source, marker: string) {
  if (action === 'rename' && message.status === 'completed') {
    const citations = noteCitations(message);
    assert(message.content.includes(marker) && citations.length > 0 && citations.every(citation => citation.noteId === source.noteId && citation.notePath === source.path),
      'Rename answer did not resolve the same Note Identity at its current canonical path');
    return 'current-identity';
  }
  assert(['error', 'cancelled'].includes(message.status), `Changed/revoked source admitted an answer: ${action}/${message.status}`);
  assertNoProvisionalEvidence(message);
  assert(message.status === 'cancelled' || !!message.errorMessage, 'Source refusal did not retain an explicit error');
  return 'explicit-refusal';
}
export function assertStoppedResearch(message: ChatMessage, activeRequestId: string | null) {
  assert(message.status === 'cancelled' && activeRequestId === null, 'Normal Stop did not retire the parent request durably');
  assertNoProvisionalEvidence(message);
  assert(!message.parts.some(part => part.type === 'tool' && (part.readSources?.length || part.name === 'research_notes' && part.status === 'success')),
    'Cancelled worker handed off late answer evidence or completed parent research');
}

export type SupplementalEvidenceControls = {
  conversation(provider: ChatProvider, run: string): Promise<ChatConversation>;
  start(conversationId: string, content: string): Promise<ChatMessage>;
  stop(): Promise<void>;
  noProvisionalUi(messageId: string, forbidden: string): Promise<void>;
  createSource(title: string, markdown: string): Promise<Source>;
  mutateSource(source: Source, title: string, markdown: string): Promise<Source>;
  readSource(source: Source): Promise<Source>;
  barrier(key: string): Promise<Barrier>;
  release(key: string): Promise<void>;
  checkpoint(report: SupplementalEvidenceReport): Promise<void>;
};

/** Separable orchestration for pure failure tests. Native execution supplies
 * actual UI/NoteTimeline/control operations from runSupplementalEvidenceProbe.
 */
export async function runSupplementalEvidenceJourneys(api: ChatApi, controls: SupplementalEvidenceControls, run: string): Promise<SupplementalEvidenceReport> {
  const report: SupplementalEvidenceReport = { gate: 'supplemental-native-evidence-fixture', status: 'running', run, checks: [], receipts: {} };
  const outputEvents = new Map<string, string[]>();
  const listeners: Array<() => void> = [];
  const recordOutput = (id: string, type: string) => { const events = outputEvents.get(id) ?? []; events.push(type); outputEvents.set(id, events); };
  const noOutputEvents = (id: string) => assert((outputEvents.get(id)?.length ?? 0) === 0, 'Provisional or late answer/evidence event escaped native admission');
  const message = async (conversationId: string, id: string) => {
    const snapshot = await api.getConversation(conversationId);
    const result = snapshot.messages.find(item => item.id === id);
    assert(result, 'Accepted supplemental assistant disappeared'); return result;
  };
  const terminal = (conversationId: string, id: string) => until(async () => {
    const snapshot = await api.getConversation(conversationId); const current = snapshot.messages.find(item => item.id === id);
    return current && !['pending', 'streaming'].includes(current.status) && snapshot.activeRequestId === null ? current : undefined;
  }, 'durable terminal request');
  const mark = async (provider: string, check: string, receipt: Record<string, unknown>) => {
    report.checks.push(`${provider} ${check}`); await controls.checkpoint(report); return receipt;
  };
  try {
    listeners.push(await api.on('chat://text-delta', event => { if (event.delta) recordOutput(event.messageId, 'text'); }));
    listeners.push(await api.on('chat://answer-draft', event => { if (event.content) recordOutput(event.messageId, 'draft'); }));
    listeners.push(await api.on('chat://source', event => recordOutput(event.messageId, 'source')));
    listeners.push(await api.on('chat://completed', event => recordOutput(event.messageId, 'completed')));
    for (const provider of ['local', 'openai'] as const) {
      const ownedRun = `${run}_${provider}`;
      const conversation = await controls.conversation(provider, ownedRun);
      assert(conversation.provider === provider && conversation.model === 'pi-native-fixture' && conversation.vaultAccess === 'full', 'Supplemental conversation routing differs from its native fixture configuration');
      const receipts: Record<string, Record<string, unknown>> = report.receipts[provider] = {};
      for (const action of ['edit', 'rename', 'exclude'] as const) {
        const source = await controls.createSource(`Pi supplemental ${ownedRun} ${action}`, `Synthetic original canonical evidence ${ownedRun} ${action}.`);
        const accepted = await controls.start(conversation.id, `PI_SUPPLEMENTAL:${action.toUpperCase()}:${ownedRun}:${source.noteId}`);
        const key = `${ownedRun}:${action.toUpperCase()}`;
        let excluded = false;
        try {
          const held = await controls.barrier(key);
          assert(held.firstTextAt !== null && held.firstTextAt <= held.heldAt && held.releasedAt === null && !held.completed && held.closedAt === null, 'Inference barrier did not hold a live streamed structured draft');
          const pending = await message(conversation.id, accepted.id);
          assert(pending.status === 'streaming' && pending.parts.some(part => part.type === 'tool' && part.name === 'read_note' && part.status === 'success' && part.readSources?.some(read => read.noteId === source.noteId)), 'Source mutation was not ordered after an actual canonical read');
          assertNoProvisionalEvidence(pending);
          noOutputEvents(accepted.id);
          const marker = `Synthetic supplemental grounded answer ${ownedRun}.`;
          await controls.noProvisionalUi(accepted.id, marker);
          let current = source;
          if (action === 'exclude') {
            await api.setNoteExcluded(source.noteId, source.title, true); excluded = true;
            assert((await api.listNotePolicies()).some(policy => policy.noteId === source.noteId && policy.disposition === 'excluded'), 'Exclusion was not admitted by the public policy API');
          } else {
            current = await controls.mutateSource(source, action === 'rename' ? `${source.title} renamed` : source.title,
              action === 'edit' ? `Synthetic replacement canonical evidence ${ownedRun}.` : source.markdown);
            assert(current.noteId === source.noteId && (action !== 'rename' || current.path !== source.path), 'Source race did not preserve Note Identity/change the intended canonical path');
            const readBack = await controls.readSource(current);
            assert(readBack.noteId === source.noteId && readBack.path === current.path && readBack.title === current.title && readBack.markdown === current.markdown, 'Source mutation lacks exact native canonical read-back');
          }
          const mutatedAt = Date.now();
          // Structured text must still be withheld after the native mutation.
          assertNoProvisionalEvidence(await message(conversation.id, accepted.id));
          noOutputEvents(accepted.id);
          await controls.noProvisionalUi(accepted.id, marker);
          await controls.release(key);
          const final = await terminal(conversation.id, accepted.id);
          const outcome = assertSourceRaceOutcome(action, final, current, marker);
          const replayed = await message(conversation.id, accepted.id);
          assertSourceRaceOutcome(action, replayed, current, marker);
          if (outcome === 'explicit-refusal') noOutputEvents(accepted.id);
          if (outcome === 'explicit-refusal') await controls.noProvisionalUi(accepted.id, marker);
          receipts[action] = await mark(provider, `${action} after actual read with no provisional answer`, {
            conversationId: conversation.id, messageId: accepted.id, noteId: source.noteId, originalPath: source.path, currentPath: current.path,
            heldAt: held.heldAt, mutatedAt, status: replayed.status, outcome, noProvisional: true,
          });
        } finally { if (excluded) await api.setNoteExcluded(source.noteId, source.title, false); }
      }

      const stoppedSource = await controls.createSource(`Pi supplemental ${ownedRun} stopped worker`, `Synthetic private stopped-worker evidence ${ownedRun}.`);
      const freshSource = await controls.createSource(`Pi supplemental ${ownedRun} fresh worker`, `Synthetic fresh-worker evidence ${ownedRun}.`);
      const accepted = await controls.start(conversation.id, `PI_SUPPLEMENTAL:STOP_RESEARCH:${ownedRun}:${stoppedSource.noteId}`);
      const key = `${ownedRun}:STOP_WORKER`;
      const held = await controls.barrier(key);
      assert(held.firstTextAt !== null && held.releasedAt === null && held.closedAt === null && !held.completed, 'Research Stop did not overlap active worker selection inference');
      const running = await message(conversation.id, accepted.id);
      assert(running.status === 'streaming' && running.parts.some(part => part.type === 'tool' && part.name === 'research_notes' && part.status === 'running'), 'Research parent was not active when Stop was exercised');
      assertNoProvisionalEvidence(running);
      noOutputEvents(accepted.id);
      const stopClickedAt = Date.now(); await controls.stop();
      await terminal(conversation.id, accepted.id);
      const stopped = await api.getConversation(conversation.id);
      assertStoppedResearch(stopped.messages.find(item => item.id === accepted.id)!, stopped.activeRequestId);
      await controls.noProvisionalUi(accepted.id, `Synthetic supplemental research answer ${ownedRun}.`);
      const closed = await until(async () => { const value = await controls.barrier(key); return value.closedAt !== null ? value : undefined; }, 'cancelled worker HTTP termination');
      assert(closed.closedBeforeRelease && closed.closedAt !== null && !closed.completed, 'Stopped research worker native HTTP stream remained alive');
      await controls.release(key);
      const fresh = await controls.start(conversation.id, `PI_SUPPLEMENTAL:NEW_RESEARCH:${ownedRun}:${freshSource.noteId}`);
      const completed = await terminal(conversation.id, fresh.id);
      assert(completed.status === 'completed' && completed.content.includes(`Synthetic supplemental research answer ${ownedRun}.`)
        && noteCitations(completed).length > 0 && noteCitations(completed).every(citation => citation.noteId === freshSource.noteId)
        && completed.parts.some(part => part.type === 'tool' && part.name === 'research_notes' && part.status === 'success' && part.readSources?.some(source => source.noteId === freshSource.noteId)), 'New research was not admitted cleanly with fresh isolated evidence');
      const after = await api.getConversation(conversation.id);
      assertStoppedResearch(after.messages.find(item => item.id === accepted.id)!, after.activeRequestId);
      noOutputEvents(accepted.id);
      await controls.noProvisionalUi(accepted.id, `Synthetic supplemental research answer ${ownedRun}.`);
      receipts.stop = await mark(provider, 'normal Stop terminates active research and admits fresh research', {
        conversationId: conversation.id, messageId: accepted.id, freshMessageId: fresh.id, stoppedNoteId: stoppedSource.noteId, freshNoteId: freshSource.noteId,
        heldAt: held.heldAt, stopClickedAt, workerClosedAt: closed.closedAt, outputEventCount: outputEvents.get(accepted.id)?.length ?? 0, noLateEvidence: true, newResearchCompleted: true,
      });
    }
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = String(error); }
  finally { for (const unlisten of listeners) unlisten(); }
  await controls.checkpoint(report); return report;
}

function nativeControls(api: ChatApi, fixtureBaseUrl: string): SupplementalEvidenceControls {
  const origin = new URL(fixtureBaseUrl);
  assert(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Supplemental control requires the owned loopback fixture');
  const endpoint = new URL('/__pi_supplemental_evidence', origin);
  const control = async (body?: unknown) => {
    const response = await fetch(endpoint, { method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store',
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    assert(response.ok, `Supplemental fixture control HTTP ${response.status}`);
    return await response.json() as { barriers: Barrier[] };
  };
  const button = (label: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
    .find(node => !node.disabled && visibleProbeControl(node) && (node.getAttribute('aria-label') === label || node.textContent?.trim() === label));
  const click = async (label: string, root: ParentNode = document) => { (await until(() => button(label, root), label)).click(); await pause(); };
  const input = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => { field.focus(); field.value = value; field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); };
  let pane: HTMLElement | undefined;
  const composer = async () => {
    await openVisibleProbeChat(until); pane = await until(() => probeChatPane(), 'visible supplemental chat');
    return focusProbeChatComposer(pane, until);
  };
  const send = async (content: string) => { const field = await composer(); input(field, content); (await until(() => probeComposerSend(field), 'normal supplemental Send')).click(); };
  const draftControls: FollowonsConversationControls = {
    focusChat: async () => { const field = await composer(); field.focus(); await until(() => button('New Chat. Start a blank chat in this pane.'), 'focused normal New Chat'); },
    newChat: async () => { await click('New Chat. Start a blank chat in this pane.'); await until(() => probePaneTitle(pane, 'chat')?.value === '', 'blank supplemental chat draft'); },
    title: async title => { const field = await until(() => probePaneTitle(pane, 'chat'), 'supplemental draft title'); input(field, title); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(); },
    model: async (provider, model) => { await click('AI model'); const picker = await until(() => document.querySelector('[aria-label="AI model picker"]'), 'normal model picker'); await click(provider === 'local' ? 'Server' : 'ChatGPT', picker); input(await until(() => picker.querySelector<HTMLInputElement>('[aria-label="Custom model ID"]'), 'custom model'), model); await click('Use', picker); },
    vault: async () => { await click('Vault access'); const menu = await until(() => document.querySelector('[role="menu"][aria-label="Vault access"]'), 'vault access menu'); (await until(() => Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).find(node => node.querySelector('span.font-medium')?.textContent === 'Full vault'), 'Full vault')).click(); },
    reasoning: async (_value, provider, model) => { if (followonsReasoningMode(provider, model, await api.getModelCapabilities(provider, model)) === 'unsupported-off') return; await click('Reasoning effort'); const picker = await until(() => document.querySelector('[aria-label="Reasoning effort picker"]'), 'reasoning picker'); await click('Off', picker); },
    send,
    accepted: async (title, content) => until(async () => { const id = (await api.listConversations()).find(item => item.title === title)?.id; if (!id) return; const value = await api.getConversation(id); return value.messages.some(item => item.role === 'user' && item.content === content) && value.messages.at(-1)?.status === 'completed' ? value : undefined; }, 'normal warmup completion'),
  };
  return {
    conversation: async (provider, run) => {
      collapseFollowonsEditorSelections(Array.from(document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')).flatMap(node => { const view = EditorView.findFromDOM(node); return view ? [view] : []; }));
      return acquireFollowonsConversation(draftControls, { title: `Pi supplemental ${run}`, provider, model: 'pi-native-fixture', vaultAccess: 'full', reasoningEffort: 'off' }, `PI_SUPPLEMENTAL:WARMUP:${run}`);
    },
    start: async (id, content) => { const before = (await api.getConversation(id)).messages.length; await send(content); return until(async () => { const messages = (await api.getConversation(id)).messages; return messages.length > before && messages.at(-1)?.role === 'assistant' ? messages.at(-1) : undefined; }, 'normal supplemental Send admission'); },
    stop: async () => { await click('Stop response'); },
    noProvisionalUi: async (id, forbidden) => { const root = await until(() => document.querySelector(`[data-chat-message-id="${id}"]`), 'mounted supplemental assistant'); assert(!root.textContent?.includes(forbidden) && !root.textContent?.includes('{"segments"') && !root.querySelector('[data-chat-answer-draft]'), 'Provisional structured answer appeared in normal UI'); },
    createSource: async (title, markdown) => { const saved = await invoke<Source>('save_note', { title, markdown, currentPath: null }); await invoke('finalize_note_editing_window', { noteId: saved.noteId }); return saved; },
    mutateSource: (source, title, markdown) => invoke<Source>('save_note', { title, markdown, currentPath: source.path }),
    readSource: source => invoke<Source>('read_note', { noteId: source.noteId, path: source.path }),
    barrier: key => until(async () => (await control()).barriers.find(item => item.barrier === key), 'provider inference barrier'),
    release: async key => { await control({ action: 'release', barrier: key }); },
    checkpoint: report => invoke('pi_ui_report', { report }),
  };
}

export async function runSupplementalEvidenceProbe(input: { api: ChatApi; fixtureBaseUrl: string }): Promise<SupplementalEvidenceReport | undefined> {
  const config = await invoke<{ fixture: boolean; interactiveGate: boolean; expandedGate: boolean; followonsGate?: boolean }>('pi_probe_config');
  if (!config.fixture || !config.interactiveGate || !config.expandedGate || !config.followonsGate || !new URL(location.href).searchParams.has('piExpandedTest')) return;
  return runSupplementalEvidenceJourneys(input.api, nativeControls(input.api, input.fixtureBaseUrl), crypto.randomUUID());
}
