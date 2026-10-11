import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { browser, $ } from '@wdio/globals';
import { createLiveNativeEvaluation, invokeNative as invoke, passageIds, resolvePassages } from '../../support/liveNative';

type Note = { noteId: string; path: string; title: string; markdown: string };
type Event = { type: string; call_id?: string; aggregate?: { totalTokens?: number }; details?: Record<string, unknown> };
type Answer = { id: string; role: string; status: string; content: string; error?: string; sources: { noteId?: string; excerpt: string; passage?: { id: string; location: string; start: number; end: number; excerpt: string } }[]; agentEvents: { requestId: string; event: Event }[] };
type Result = { caseId: string; question: string; conversationId: string; requestId?: string; answer?: Answer; rawStream?: string; resolutions?: unknown[]; stopped?: boolean; elapsedMillis?: number };
const live = process.env.GNEAUX_CITATION_NATIVE === '1' ? describe : describe.skip;

live('Citation reliability with native read/tool context', function () {
  this.timeout(600_000);
  const evaluation = createLiveNativeEvaluation();
  evaluation.installHooks();
  it('retains raw references for deadline lists and bounded excerpt answers', async () => {
    const settings = JSON.parse(process.env.GNEAUX_CITATION_NATIVE_SETTINGS!);
    assert.equal(settings.provider, 'openai');
    const selectedCases: string[] = JSON.parse(process.env.GNEAUX_CITATION_NATIVE_CASES!);
    await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
    const { atlasVisibility: _visibility, ...defaults } = await invoke<Record<string, unknown>>('chat_get_settings');
    await invoke('chat_set_defaults', { defaults: { ...defaults, provider: settings.provider, model: settings.model, openaiModel: settings.model, defaultAccess: 'approved', webAccess: 'off', reasoningEffort: settings.reasoning_effort, serviceTier: settings.service_tier } });
    const actualSettings = await invoke<Record<string, unknown>>('chat_get_settings');
    assert.equal(actualSettings.model, settings.model);
    assert.equal(actualSettings.serviceTier, settings.service_tier);
    assert.equal(actualSettings.reasoningEffort, settings.reasoning_effort);
    const semantic = await invoke<Record<string, unknown>>('get_semantic_settings');
    await invoke('set_semantic_settings', { settings: { ...semantic, semanticSearchEnabled: false } });
    const deadlines = await evaluation.saveNote('Meridian deadlines', [
      '- [ ] Parent @due(2026-10-01) @due(2026-10-07)',
      '  - [ ] Undated child', '- [x] Completed @due(2026-09-29)',
      '- [ ] Invalid @due(2026-02-30)', '', '```markdown',
      '- [ ] Fenced example @due(2026-09-29)', '```'
    ].join('\n'));
    const excerpt = 'Deployment approval was discussed.';
    const retrospective = await evaluation.saveNote('Meridian retrospective', `${excerpt}\n\nJordan approved deployment.`);
    for (const note of [deadlines, retrospective]) await invoke('chat_grant_note', { noteId: note.noteId });
    const originals = [deadlines, retrospective].map(note => readFileSync(note.path, 'utf8'));
    const results: Result[] = [];
    const record = () => evaluation.artifact.write({
      method: 'Real native app and production chat_send_message IPC, canonical synthetic notes, full production tool definitions/preamble, actual source admission and reference rendering. Lexical-only retrieval; no semantic quality or UI navigation claim. Semantic judgments recorded separately.',
      settings: actualSettings, notes: [deadlines, retrospective], selectedExcerpt: excerpt,
      limits: { maxCases: 4, modelCallsPerAnswer: 4, toolCallsPerAnswer: 6, reportedTokensPerAnswer: 24000, timeoutMillisPerAnswer: 120000, note: 'Observed cancellation bounds; an in-flight call can exceed a token threshold before usage is reported.' }, results
    });
    const listenerError = await browser.executeAsync((done: (error: string | null) => void) => {
      const host = window as typeof window & { __GNEAUX_CITATION_STREAMS__?: Record<string, string>; __TAURI__: { event: { listen: (name: string, callback: (event: { payload: { messageId: string; delta?: string } }) => void) => Promise<() => void> } } };
      host.__GNEAUX_CITATION_STREAMS__ = {};
      void host.__TAURI__.event.listen('chat://text-delta', ({ payload }) => {
        const streams = host.__GNEAUX_CITATION_STREAMS__!;
        streams[payload.messageId] = (streams[payload.messageId] ?? '') + (payload.delta ?? '');
      }).then(() => done(null), e => done(String(e)));
    });
    assert.equal(listenerError, null);
    const deadlineQuestion = 'In Meridian deadlines, as of September 30, 2026, classify every checkbox item (including the completed one) by recorded status and supported deadline. Explain whether each would be actionable overdue on that date, and whether the fenced-code example is a task.';
    const scenarios = [
      { id: 'deadline-1', note: deadlines, question: deadlineQuestion, selected: false },
      { id: 'partial-selected', note: retrospective, question: 'Using only the selected excerpt, can you tell whether Meridian retrospective names an approver anywhere?', selected: true },
      { id: 'partial-unrestricted', note: retrospective, question: 'Does Meridian retrospective name an approver anywhere?', selected: true },
      { id: 'deadline-2', note: deadlines, question: deadlineQuestion, selected: false }
    ];
    const dateTimeContext = { locale: 'en-US', timeZone: 'America/Denver', dateOrder: ['month', 'day', 'year'], hourCycle: 'h12' };
    record();
    for (const scenario of scenarios.filter(s => selectedCases.includes(s.id))) {
      console.info('CITATION_NATIVE_STAGE', scenario.id);
      const conversation = await invoke<{ id: string }>('chat_create_conversation', { request: { title: `Citation check ${scenario.id}`, provider: settings.provider, model: settings.model, access: 'approved', reasoningEffort: settings.reasoning_effort } });
      const result: Result = { caseId: scenario.id, question: scenario.question, conversationId: conversation.id };
      results.push(result); record();
      const selectedContext = scenario.selected ? [{ noteId: retrospective.noteId, notePath: retrospective.path, title: retrospective.title, sectionLabel: null, excerpt, contentHash: createHash('sha256').update(retrospective.markdown).digest('hex'), reason: 'selected excerpt', startLine: 1, endLine: 1, blockAnchor: null }] : [];
      const activeNote = { noteId: scenario.note.noteId, title: scenario.note.title, path: scenario.note.path, body: scenario.note.markdown, bodyHash: '', selection: scenario.selected ? excerpt : null };
      const started = Date.now();
      try {
        const accepted = await invoke<{ requestId: string }>('chat_send_message', { request: { conversationId: conversation.id, content: scenario.question, attachments: [], activeNote, selectedContext, forceWebSearch: false, dateTimeContext } });
        result.requestId = accepted.requestId;
        await browser.waitUntil(async () => {
          const current = await invoke<{ messages: Answer[] }>('chat_get_conversation', { conversationId: conversation.id });
          result.answer = current.messages.find(m => m.role === 'assistant');
          if (!result.answer) return false;
          const events = result.answer.agentEvents.map(e => e.event);
          const modelCalls = events.filter(e => e.type === 'contextMeasured' && e.details?.phase === 'request').length;
          const tools = new Set(events.filter(e => e.type === 'toolCallUpdated').map(e => e.call_id)).size;
          const tokens = Math.max(0, ...events.filter(e => e.type === 'usageUpdated').map(e => e.aggregate?.totalTokens ?? 0));
          if (modelCalls > 4 || tools > 6 || tokens > 24000) throw new Error('Bounded native citation evaluation reached its spending limit');
          return ['complete', 'failed', 'cancelled'].includes(result.answer.status);
        }, { timeout: 120_000, interval: 500, timeoutMsg: 'Bounded native citation answer timed out' });
        assert.equal(result.answer?.status, 'complete', result.answer?.error);
        // Preserve semantic/citation omissions as evidence; do not stop at the first omission.
        result.resolutions = await resolvePassages(conversation.id, passageIds(result.answer!.content));
      } finally {
        if (result.requestId && !['complete', 'failed', 'cancelled'].includes(result.answer?.status ?? '')) {
          await invoke('chat_cancel_request', { requestId: result.requestId }); result.stopped = true;
          const final = await invoke<{ messages: Answer[] }>('chat_get_conversation', { conversationId: conversation.id });
          result.answer = final.messages.find(m => m.role === 'assistant') ?? result.answer;
        }
        if (result.answer) result.rawStream = await browser.execute((id: string) => (window as typeof window & { __GNEAUX_CITATION_STREAMS__?: Record<string, string> }).__GNEAUX_CITATION_STREAMS__?.[id], result.answer.id);
        result.elapsedMillis = Date.now() - started;
        evaluation.artifact.observeAnswer(conversation.id, result.answer); record();
      }
    }
    for (const [index, note] of [deadlines, retrospective].entries()) assert.equal(readFileSync(note.path, 'utf8'), originals[index], 'Read-only evaluation must preserve canonical fixture bytes');
  });
});
