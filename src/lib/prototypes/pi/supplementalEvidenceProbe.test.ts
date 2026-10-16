import { describe, expect, it, vi } from 'vitest';
import type { ChatApi } from '$lib/features/chat/api';
import type { ChatConversation, ChatMessage, ChatProvider } from '$lib/features/chat/types';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { assertNoProvisionalEvidence, assertSourceRaceOutcome, assertStoppedResearch, runSupplementalEvidenceJourneys, type SupplementalEvidenceControls } from './supplementalEvidenceProbe';

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({ id: 'assistant', conversationId: 'conversation', role: 'assistant', content: '',
  status: 'streaming', createdAtMillis: 1, updatedAtMillis: 1, requestId: 'request', errorMessage: null, citations: [], attachments: [], linkTarget: null,
  parts: [], agentRunId: 'run', agentSequence: 0, agentEventCreatedAtMillis: 1, agentRetiredRunIds: [], ...overrides });
const source = { noteId: 'note', path: '/vault/renamed.md', title: 'Renamed', markdown: 'Canonical body' };
const citation = { id: 'S1', kind: 'note' as const, noteId: source.noteId, notePath: source.path, label: source.title, sectionLabel: null, startLine: 1, excerpt: source.markdown };
const tool = (name: string, status: 'running' | 'success' | 'error', noteId?: string) => ({ id: name, type: 'tool' as const, callId: name, name, title: name,
  status, ...(noteId ? { readSources: [{ ...citation, noteId }] } : {}) });

describe('mandatory supplemental evidence boundaries', () => {
  it('withholds drafts, content, citations and source/text parts while retaining actual read activity', () => {
    expect(() => assertNoProvisionalEvidence(message({ parts: [tool('read_note', 'success', 'note')] }))).not.toThrow();
    for (const partial of [{ content: 'Synthetic provisional answer' }, { answerDraft: { attempt: 1, sequence: 1, text: 'Provisional' } }, { citations: [citation] },
      { parts: [{ id: 'text' as const, type: 'text' as const, text: '{"segments":' }] }, { parts: [{ id: 'sources' as const, type: 'sources' as const, citations: [citation] }] }])
      expect(() => assertNoProvisionalEvidence(message(partial))).toThrow(/Provisional/);
  });
  it('edit/exclude require explicit refusal while rename resolves current path with the original Note Identity', () => {
    const refusal = message({ status: 'error', errorMessage: 'Canonical evidence changed' });
    expect(assertSourceRaceOutcome('edit', refusal, source, 'Grounded')).toBe('explicit-refusal');
    expect(assertSourceRaceOutcome('exclude', message({ status: 'cancelled' }), source, 'Grounded')).toBe('explicit-refusal');
    const admitted = message({ status: 'completed', content: 'Grounded', citations: [citation] });
    expect(assertSourceRaceOutcome('rename', admitted, source, 'Grounded')).toBe('current-identity');
    expect(() => assertSourceRaceOutcome('edit', admitted, source, 'Grounded')).toThrow(/admitted an answer/);
    for (const changed of [{ noteId: 'other' }, { notePath: '/vault/old.md' }])
      expect(() => assertSourceRaceOutcome('rename', { ...admitted, citations: [{ ...citation, ...changed }] }, source, 'Grounded')).toThrow(/current canonical path/);
    expect(() => assertSourceRaceOutcome('edit', message({ status: 'error' }), source, 'Grounded')).toThrow(/explicit error/);
  });
  it('Stop requires durable cancelled parent retirement with no successful or evidenced late research', () => {
    const stopped = message({ status: 'cancelled', parts: [tool('research_notes', 'error')] });
    expect(() => assertStoppedResearch(stopped, null)).not.toThrow();
    expect(() => assertStoppedResearch(stopped, 'still-active')).toThrow(/retire/);
    expect(() => assertStoppedResearch({ ...stopped, parts: [tool('research_notes', 'success')] }, null)).toThrow(/late answer evidence/);
    expect(() => assertStoppedResearch({ ...stopped, parts: [tool('research_notes', 'error', 'note')] }, null)).toThrow(/late answer evidence/);
  });
});

function harness(fault?: 'provisional' | 'unread' | 'fresh-leak' | 'transient-event') {
  const conversations = new Map<string, ChatConversation>();
  const sources = new Map<string, typeof source>();
  const policies = new Set<string>();
  const order: string[] = [];
  let active: { conversationId: string; message: ChatMessage; action: string; noteId: string; run: string };
  let index = 0, closed = false;
  const handlers = new Map<string, (event: { messageId: string; delta: string }) => void>();
  const api = {
    getConversation: vi.fn(async (id: string) => structuredClone(conversations.get(id)!)),
    setNoteExcluded: vi.fn(async (id: string, _title: string, excluded: boolean) => { if (excluded) policies.add(id); else policies.delete(id); }),
    listNotePolicies: vi.fn(async () => [...policies].map(noteId => ({ noteId, disposition: 'excluded' }))),
    cancelRequest: vi.fn(),
    on: vi.fn(async (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); }),
  } as unknown as ChatApi;
  const controls: SupplementalEvidenceControls = {
    conversation: vi.fn(async (provider: ChatProvider, run: string) => {
      const value = { id: provider, provider, title: run, model: 'pi-native-fixture', vaultAccess: 'full', messages: [], activeRequestId: null } as unknown as ChatConversation;
      conversations.set(provider, value); return value;
    }),
    start: vi.fn(async (id, content) => {
      const [, action, run, noteId] = content.split(':');
      const created = message({ id: `message-${++index}`, conversationId: id });
      const fresh = action === 'NEW_RESEARCH';
      created.parts = [tool(action.includes('RESEARCH') ? 'research_notes' : 'read_note', fresh ? 'success' : action.includes('RESEARCH') ? 'running' : 'success', !action.includes('RESEARCH') || fresh ? noteId : undefined)];
      if (fault === 'unread' && action === 'EDIT') created.parts = [];
      if (fresh) {
        created.status = 'completed'; created.content = `Synthetic supplemental research answer ${run}.`;
        created.citations = [{ ...citation, noteId: fault === 'fresh-leak' ? 'stopped-note' : noteId }];
      }
      const conversation = conversations.get(id)!;
      conversation.messages.push(created); conversation.activeRequestId = fresh ? null : created.requestId;
      active = { conversationId: id, message: created, action, noteId, run }; closed = false;
      return structuredClone(created);
    }),
    stop: vi.fn(async () => {
      order.push('normal-stop'); active.message.status = 'cancelled'; active.message.parts = [tool('research_notes', 'error')];
      conversations.get(active.conversationId)!.activeRequestId = null; closed = true;
    }),
    noProvisionalUi: vi.fn(async () => {}),
    createSource: vi.fn(async (title, markdown) => {
      const value = { title, markdown, noteId: `note-${++index}`, path: `/vault/${index}.md` }; sources.set(value.noteId, value); return value;
    }),
    mutateSource: vi.fn(async (value, title, markdown) => {
      order.push('canonical-mutation'); const updated = { ...value, title, markdown, path: value.title === title ? value.path : `${value.path}-renamed` }; sources.set(value.noteId, updated); return updated;
    }),
    readSource: vi.fn(async value => sources.get(value.noteId)!),
    barrier: vi.fn(async key => {
      order.push(`barrier:${key}`);
      if (fault === 'provisional') active.message.content = '{"segments":';
      if (fault === 'transient-event') handlers.get('chat://text-delta')?.({ messageId: active.message.id, delta: 'Transient forbidden output' });
      return { barrier: key, heldAt: Date.now() - 1, firstTextAt: Date.now() - 2, releasedAt: null, completed: false,
        closedAt: closed ? Date.now() : null, closedBeforeRelease: closed };
    }),
    release: vi.fn(async key => {
      order.push(`release:${key}`);
      if (key.endsWith(':STOP_WORKER')) return;
      if (active.action === 'RENAME') {
        const current = sources.get(active.noteId)!;
        active.message.status = 'completed'; active.message.content = `Synthetic supplemental grounded answer ${active.run}.`;
        active.message.citations = [{ ...citation, noteId: current.noteId, notePath: current.path }];
      } else { active.message.status = active.action === 'EXCLUDE' ? 'cancelled' : 'error'; active.message.errorMessage = 'Canonical evidence unavailable'; }
      conversations.get(active.conversationId)!.activeRequestId = null;
    }),
    checkpoint: vi.fn(async () => {}),
  };
  return { api, controls, order };
}

describe('shared supplemental native journey orchestration', () => {
  it('requires three actual-read races and active normal Stop/new research under both protocols', async () => {
    const { api, controls, order } = harness();
    const result = await runSupplementalEvidenceJourneys(api, controls, 'run');
    expect(result.status, result.error).toBe('passed'); expect(result.checks).toHaveLength(8);
    for (const protocol of ['local', 'openai']) {
      expect(result.receipts[protocol]).toMatchObject({ edit: { outcome: 'explicit-refusal', noProvisional: true }, rename: { outcome: 'current-identity' },
        exclude: { outcome: 'explicit-refusal' }, stop: { noLateEvidence: true, newResearchCompleted: true } });
      const release = order.indexOf(`release:run_${protocol}:STOP_WORKER`);
      expect(order.slice(0, release)).toContain('normal-stop');
    }
    expect(controls.stop).toHaveBeenCalledTimes(2); expect(api.cancelRequest).not.toHaveBeenCalled();
    expect(controls.mutateSource).toHaveBeenCalledTimes(4); expect(controls.readSource).toHaveBeenCalledTimes(4);
    expect(controls.release).toHaveBeenCalledTimes(8); expect(controls.noProvisionalUi).toHaveBeenCalledTimes(20);
  });
  it.each(['provisional', 'unread', 'fresh-leak', 'transient-event'] as const)('fails acceptance on %s without weakening or retrying expectations', async fault => {
    const { api, controls } = harness(fault);
    const result = await runSupplementalEvidenceJourneys(api, controls, 'run');
    expect(result.status).toBe('failed'); expect(result.error).toMatch(fault === 'provisional' || fault === 'transient-event' ? /Provisional/ : fault === 'unread' ? /actual canonical read/ : /fresh isolated evidence/);
    expect(controls.conversation).toHaveBeenCalledTimes(1);
    if (fault !== 'fresh-leak') { expect(controls.release).not.toHaveBeenCalled(); expect(controls.mutateSource).not.toHaveBeenCalled(); }
  });
});
