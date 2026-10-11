import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { browser, $ } from '@wdio/globals';
import { createLiveNativeEvaluation, invokeNative as invoke, passageIds } from '../../support/liveNative';
import type { ChatCitation } from '../../../src/lib/features/chat/types';

type Note = { noteId: string; path: string; title: string; markdown: string };
type Event = { type: string; status?: string; name?: string; call_id?: string; aggregate?: { totalTokens?: number }; details?: Record<string, unknown> };
type Answer = { id: string; role: string; status: string; content: string; error?: string; sources: { kind: string; title: string; noteId?: string; anchor?: string; passage?: { id: string; location: string; excerpt: string } }[]; agentEvents: { requestId: string; event: Event }[] };
type Conversation = { id: string; messages: Answer[] };
type SemanticStatus = { textReady: boolean; modelAvailable: boolean; annIndexLoaded: boolean; indexedNotes: number; indexingInProgress: boolean; lastError: string | null; settings: { semanticSearchEnabled: boolean } };
type Metrics = { metrics: { embeddingRequestCount: number; embeddingRequestFailureCount: number; annQueryCount: number; annQueryCandidateTotal: number }; recentEvents: unknown[] };

const live = process.env.GNEAUX_CONTEXT_SELECTION_NATIVE === '1' ? describe : describe.skip;
live('Multi-turn context with real local semantic retrieval', function () {
  this.timeout(600_000);
  const evaluation = createLiveNativeEvaluation();
  evaluation.installHooks();
  it('keeps the conversational referent across editor changes, refreshes evidence, and changes topic', async () => {
    const fixture = process.env.GNEAUXGHTS_NATIVE_E2E_FIXTURE!;
    const assets = process.env.GNEAUX_NATIVE_SEMANTIC_ASSETS!;
    const model = process.env.GNEAUX_LIVE_MODEL!;
    console.info('CONTEXT_NATIVE_STAGE', 'copy installed assets');
    assert(basename(fixture).startsWith('gneauxghts-native-e2e-'));
    assert(assets && model === 'gpt-6-luna');
    // Copy only installed model/runtime assets. The user's databases, notes and
    // settings never enter the disposable app. Warmup uses the ordinary provider.
    const semanticRoot = join(fixture, 'app-data/semantic');
    mkdirSync(join(semanticRoot, 'models'), { recursive: true });
    copyFileSync(join(assets, 'models/embeddinggemma-2-text-vision-440m.litertlm'), join(semanticRoot, 'models/embeddinggemma-2-text-vision-440m.litertlm'));
    cpSync(join(assets, 'litert-0.18.0'), join(semanticRoot, 'litert-0.18.0'), { recursive: true });
    console.info('CONTEXT_NATIVE_STAGE', 'configure disposable app');
    await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
    const { atlasVisibility: _visibility, ...defaults } = await invoke<Record<string, unknown>>('chat_get_settings');
    await invoke('chat_set_defaults', { defaults: { ...defaults, provider: 'openai', model, openaiModel: model, defaultAccess: 'approved', webAccess: 'off', reasoningEffort: 'low' } });
    const settings = await invoke<Record<string, unknown>>('get_semantic_settings');
    await invoke('set_semantic_settings', { settings: { ...settings, semanticSearchEnabled: true } });
    console.info('CONTEXT_NATIVE_STAGE', 'save fixtures');
    const save = evaluation.saveNote;
    const operations = await save('Meridian operations', 'Mateo signed off on the production rollout.\n\nRecovery token: QUARTZ-908.');
    const draft = await save('Meridian operations draft', 'Experimental sandbox only. Iris signed off on the rehearsal.\n\nRecovery token: AMBER-119.');
    const picnic = await save('Cedar afternoon', 'Outdoor meal: meet beside the lake at 13:30.\n\nBring nectarines.');
    const excluded = await save('Meridian confidential', 'CANARY_CONTEXT_NATIVE_841. The production approver was Vesper.');
    for (const note of [operations, draft, picnic]) await invoke('chat_grant_note', { noteId: note.noteId });
    await invoke('chat_set_note_excluded', { noteId: excluded.noteId, title: excluded.title, excluded: true });
    const results: Record<string, unknown>[] = [];
    const diagnostics: Record<string, unknown> = {};
    const record = () => evaluation.artifact.write({ method: 'Real native app, OpenAI runtime, local installed Gemma embeddings, disposable synthetic vault. First turn through composer; subsequent turns through production IPC with the inspected open editor snapshot. Human claim review recorded separately.', notes: [operations, draft, picnic], diagnostics, results });
    try {
      console.info('CONTEXT_NATIVE_STAGE', 'prepare real embeddings');
      await browser.setTimeout({ script: 120_000 });
      await invoke('prepare_semantic_model');
      await invoke('rebuild_semantic_index');
      await browser.waitUntil(async () => {
        const status = await invoke<SemanticStatus>('get_semantic_status');
        diagnostics.semanticStatus = status;
        return status.textReady && status.modelAvailable && status.annIndexLoaded && status.indexedNotes >= 4 && !status.indexingInProgress && !status.lastError;
      }, { timeout: 120_000, interval: 1000, timeoutMsg: 'Real semantic index must finish before paid requests' });
      await browser.setTimeout({ script: 30_000 });
      console.info('CONTEXT_NATIVE_STAGE', 'semantic probe');
      // Same ordinary search command, same query and corpus, toggle semantic
      // retrieval only. This is a retrieval probe, not a model-quality score.
      const query = 'green light for launch';
      const search = () => invoke<{ noteId: string; semanticScore: number | null }[]>('search_notes_hybrid', { query, currentPath: null, currentTitle: '', currentMarkdown: null, currentBodyHash: null, currentTags: null, limit: 8, semanticWeight: null, lexicalWeight: null });
      await invoke('set_semantic_settings', { settings: { ...settings, semanticSearchEnabled: false } });
      diagnostics.lexicalProbe = await search();
      await invoke('set_semantic_settings', { settings: { ...settings, semanticSearchEnabled: true } });
      diagnostics.hybridProbe = await search();
      assert(!(diagnostics.lexicalProbe as { noteId: string }[]).some(n => n.noteId === operations.noteId), 'Paraphrase target must not already match lexical probe');
      assert((diagnostics.hybridProbe as { noteId: string; semanticScore: number | null }[]).some(n => n.noteId === operations.noteId && Number(n.semanticScore) > 0), 'Semantic-enabled probe must retrieve paraphrase target');
      diagnostics.beforeChat = await invoke<Metrics>('get_semantic_debug_metrics');
      record();

      // Capture only synthetic answer deltas, before final citation rendering.
      // This separates a model omission from delivery/reference conversion.
      const listenerError = await browser.executeAsync((done: (error: string | null) => void) => {
        const host = window as typeof window & { __GNEAUX_CONTEXT_STREAMS__?: Record<string, string>; __TAURI__: { event: { listen: (name: string, callback: (event: { payload: { messageId: string; delta?: string } }) => void) => Promise<() => void> } } };
        host.__GNEAUX_CONTEXT_STREAMS__ = {};
        void host.__TAURI__.event.listen('chat://text-delta', ({ payload }) => {
          const streams = host.__GNEAUX_CONTEXT_STREAMS__!;
          streams[payload.messageId] = (streams[payload.messageId] ?? '') + (payload.delta ?? '');
        }).then(() => done(null), e => done(String(e)));
      });
      assert.equal(listenerError, null);
      diagnostics.inlineCitationsSupported = true;

      await $('button[aria-label="Open thought partner in this pane"]').click();
      const initial = 'Who gave the green light for launch? Use my notes and distinguish production from rehearsal.';
      const composer = await $('[data-notepad-command-bar] textarea');
      await composer.waitForEnabled({ timeout: 30_000 });
      await composer.setValue(initial);
      await $('button[aria-label="Send message"]').click();
      let conversationId = '';
      await browser.waitUntil(async () => {
        for (const summary of await invoke<{ id: string }[]>('chat_list_conversations')) {
          const c = await invoke<Conversation>('chat_get_conversation', { conversationId: summary.id });
          if (c.messages.some(m => m.role === 'user' && m.content === initial)) { conversationId = c.id; return true; }
        }
        return false;
      }, { timeout: 20_000, interval: 250 });

      const wait = async (question: string, previous: string[], requestId?: string) => {
        let stopped = false;
        let answer: Answer | undefined;
        try {
          await browser.waitUntil(async () => {
            const c = await invoke<Conversation>('chat_get_conversation', { conversationId });
            answer = c.messages.find(m => m.role === 'assistant' && !previous.includes(m.id));
            if (!answer) return false;
            const events = answer.agentEvents.map(e => e.event);
            const calls = new Set(events.filter(e => e.type === 'toolCallUpdated').map(e => e.call_id)).size;
            const modelCalls = events.filter(e => e.type === 'contextMeasured' && e.details?.phase === 'request').length;
            const tokens = Math.max(0, ...events.filter(e => e.type === 'usageUpdated').map(e => e.aggregate?.totalTokens ?? 0));
            if (calls > 8 || modelCalls > 6 || tokens > 40_000) {
              const cancelId = requestId ?? answer.agentEvents[0]?.requestId;
              if (cancelId && !stopped) { await invoke('chat_cancel_request', { requestId: cancelId }); stopped = true; }
              throw new Error('Small evaluation spending bound reached');
            }
            return ['complete', 'failed', 'cancelled'].includes(answer.status);
          }, { timeout: 60_000, interval: 500 });
        } catch (error) {
          const cancelId = requestId ?? answer?.agentEvents[0]?.requestId;
          if (cancelId && !stopped && answer && !['complete', 'failed', 'cancelled'].includes(answer.status)) {
            await invoke('chat_cancel_request', { requestId: cancelId }); stopped = true;
          }
          throw error;
        } finally {
          const rawStream = answer ? await browser.execute((id: string) => (window as typeof window & { __GNEAUX_CONTEXT_STREAMS__?: Record<string, string> }).__GNEAUX_CONTEXT_STREAMS__?.[id], answer.id).catch(() => undefined) : undefined;
          results.push({ question, answer, rawStream, stopped }); record();
        }
        assert(answer);
        assert.equal(answer.status, 'complete', answer.error);
        assert(!JSON.stringify(answer).includes('CANARY_CONTEXT_NATIVE_841'));
        const links = passageIds(answer.content);
        if (links.length === 0) { diagnostics.inlineCitationsSupported = false; record(); }
        for (const evidenceId of links) await invoke('chat_resolve_passage', { conversationId, evidenceId });
        return answer;
      };
      const first = await wait(initial, []);
      diagnostics.afterFirstAnswer = await invoke<Metrics>('get_semantic_debug_metrics');
      const beforeFirst = (diagnostics.beforeChat as Metrics).metrics;
      const afterFirst = (diagnostics.afterFirstAnswer as Metrics).metrics;
      assert(first.agentEvents.some(({ event }) => event.type === 'queryResolved' && event.details?.capability === 'search_evidence'), 'First answer must execute passage discovery');
      assert(afterFirst.embeddingRequestCount - afterFirst.embeddingRequestFailureCount > beforeFirst.embeddingRequestCount - beforeFirst.embeddingRequestFailureCount && afterFirst.annQueryCount > beforeFirst.annQueryCount && afterFirst.annQueryCandidateTotal > beforeFirst.annQueryCandidateTotal, 'First chat turn must execute embeddings and ANN retrieval before citation/editor navigation');
      record();
      assert(/Mateo/i.test(first.content), 'Production approver must come from operations');
      const sourceIndex = first.sources.findIndex(s => s.noteId === operations.noteId && s.passage?.location === 'body' && first.content.includes(`passage:${s.passage.id}`));
      assert(sourceIndex >= 0, 'First answer must read and cite operations body');
      const source = first.sources[sourceIndex];
      const citationId = `${source.kind}:${source.noteId}:${source.anchor ?? sourceIndex}`;
      const citation = await $(`[data-chat-note-citation-id=${JSON.stringify(citationId)}]`);
      await citation.waitForExist({ timeout: 15_000 });
      const navigation = await invoke<{ markdown: string; selection: { anchor: number; head: number } | null }>('chat_resolve_passage', { conversationId, evidenceId: source.passage!.id });
      assert(navigation.selection);
      await browser.saveScreenshot(resolve(process.env.GNEAUX_LIVE_OUTPUT! + '.first-answer.png'));
      await browser.execute((el: HTMLElement) => el.click(), citation);
      await browser.waitUntil(async () => browser.execute((noteId, navigation) => {
        const state = (window as typeof window & { __GNEAUXGHTS_NATIVE_E2E__?: { readEditorState: () => { noteId: string; editor?: { markdown: string; selection: { anchor: number; head: number } } } } }).__GNEAUXGHTS_NATIVE_E2E__!.readEditorState();
        return state.noteId === noteId && state.editor?.markdown === navigation.markdown && state.editor?.selection.anchor === navigation.selection?.anchor && state.editor?.selection.head === navigation.selection?.head;
      }, operations.noteId, navigation), { timeout: 15_000, timeoutMsg: 'Rendered citation must open and select its exact canonical passage' });
      diagnostics.citationNavigationVerified = true;

      // Run the same frontend citation-opening callback as normal navigation,
      // then check the actual editor rather than only supplying a fake snapshot.
      const navigationError = await browser.executeAsync((note: Note, notePath: string, done: (value: string | null) => void) => {
        const bridge = (window as typeof window & { __GNEAUXGHTS_NATIVE_E2E__?: { openRevisionCitation: (citation: ChatCitation) => Promise<void> } }).__GNEAUXGHTS_NATIVE_E2E__!;
        void bridge.openRevisionCitation({ id: 'context-switch', kind: 'note', label: note.title, noteId: note.noteId, notePath, sectionLabel: null, startLine: null, excerpt: null }).then(() => done(null), e => done(String(e)));
      }, draft, draft.path);
      assert.equal(navigationError, null);
      await browser.waitUntil(async () => (await $('[data-testid="note-title"]').getValue()) === draft.title, { timeout: 15_000 });
      const ask = async (question: string) => {
        const previous = (await invoke<Conversation>('chat_get_conversation', { conversationId })).messages.map(m => m.id);
        const editor = await browser.execute(() => (window as typeof window & { __GNEAUXGHTS_NATIVE_E2E__?: { readEditorState: () => { noteId: string; editor: { markdown: string } } } }).__GNEAUXGHTS_NATIVE_E2E__!.readEditorState());
        assert.equal(editor.noteId, draft.noteId);
        assert.equal(editor.editor.markdown, draft.markdown);
        const accepted = await invoke<{ requestId: string }>('chat_send_message', { request: { conversationId, content: question, attachments: [], selectedContext: [], forceWebSearch: false, activeNote: { noteId: editor.noteId, title: draft.title, path: draft.path, body: editor.editor.markdown, bodyHash: '', selection: null } } });
        return wait(question, previous, accepted.requestId);
      };
      const second = await ask('In that production note, what is the recovery token?');
      diagnostics.editorSwitchSupported = second.content.includes('QUARTZ-908') && second.sources.some(s => s.noteId === operations.noteId && s.passage?.excerpt.includes('QUARTZ-908') && second.content.includes(`passage:${s.passage.id}`));

      await save(operations.title, 'Mateo signed off on the production rollout.\n\nRecovery token: TOPAZ-642. This supersedes the previous token.', operations.path);
      const updated = await ask('I updated the production note. Read it again: what is the recovery token now?');
      diagnostics.updatedTokenSupported = updated.content.includes('TOPAZ-642') && updated.sources.some(s => s.noteId === operations.noteId && s.passage?.excerpt.includes('TOPAZ-642') && updated.content.includes(`passage:${s.passage.id}`));
      const changed = await ask('Switch topics: in Cedar afternoon, where and when are we meeting?');
      diagnostics.topicChangeSupported = /lake/i.test(changed.content) && /13:30|1:30/i.test(changed.content);
      const carried = await ask('What should I bring?');
      diagnostics.newTopicFollowupSupported = /nectarines/i.test(carried.content);
      diagnostics.afterChat = await invoke<Metrics>('get_semantic_debug_metrics');
      const before = (diagnostics.beforeChat as Metrics).metrics;
      const after = (diagnostics.afterChat as Metrics).metrics;
      assert(after.embeddingRequestCount - after.embeddingRequestFailureCount > before.embeddingRequestCount - before.embeddingRequestFailureCount && after.annQueryCount > before.annQueryCount && after.annQueryCandidateTotal > before.annQueryCandidateTotal, 'Chat must actually execute local embedding and ANN retrieval');
      await browser.saveScreenshot(resolve(process.env.GNEAUX_LIVE_OUTPUT! + '.png'));
      await browser.refresh();
      await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
      const restored = await invoke<Conversation>('chat_get_conversation', { conversationId });
      assert.equal(restored.messages.find(m => m.id === carried.id)?.content, carried.content);
      for (const evidenceId of passageIds(carried.content)) await invoke('chat_resolve_passage', { conversationId, evidenceId });
      diagnostics.reloadVerified = true;
      // Record every planned turn before evaluating these smoke assertions.
      // Correct citations and structural completion still need claim review.
      for (const key of ['editorSwitchSupported', 'updatedTokenSupported', 'topicChangeSupported', 'newTopicFollowupSupported', 'inlineCitationsSupported']) assert.equal(diagnostics[key], true, key);
    } finally { record(); }
  });
});
