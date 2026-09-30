import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { browser, $ } from '@wdio/globals';

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.executeAsync((cmd, input, done: (r: {
    ok: boolean;
    value?: unknown;
    error?: string;
  }) => void) => {
    const native = window as typeof window & {
      __TAURI_INTERNALS__: {
        invoke: (c: string, a: Record<string, unknown>) => Promise<unknown>;
      };
    };
    void native.__TAURI_INTERNALS__.invoke(cmd, input).then(value => done({ ok: true, value }), error => done({ ok: false, error: String(error) }));
  }, command, args);
  if (!result.ok)
    throw new Error(result.error);
  return result.value as T;
}

type Note = {
  noteId: string;
  path: string;
  title: string;
};
type Source = {
  kind: string;
  title: string;
  anchor?: string;
  url?: string;
  noteId?: string;
  passage?: {
    id: string;
    location: string;
    historical?: {
      changeKind: string;
    };
  };
};
type Answer = {
  id: string;
  role: string;
  status: string;
  content: string;
  error?: string;
  sources: Source[];
  agentEvents: Array<{
    event: {
      type: string;
      details?: Record<string, unknown>;
    };
  }>;
};

const live = process.env.GNEAUX_ACTIVITY_NATIVE === '1' ? describe : describe.skip;

live('Activity follow-ups through the real chat runtime', function() {
  this.timeout(900_000);
  it('connects retained changes to current status without promoting old backlog or assistant text', async () => {
    const endpoint = process.env.GNEAUX_LIVE_ENDPOINT;
    const model = process.env.GNEAUX_LIVE_MODEL;
    const output = process.env.GNEAUX_LIVE_OUTPUT;
    assert(endpoint && model && output, 'Explicit local model and output path required');
    await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
    const settings = await invoke<Record<string, unknown>>('chat_get_settings');
    await invoke('chat_set_settings', {
      settings: {
        ...settings, provider: 'local', model, localModel: model, localBaseUrl: endpoint, defaultAccess: 'approved', webAccess: 'off', reasoningEffort: 'medium'
      }
    });
    await invoke('chat_set_local_model_capabilities', {
      model, capabilities: {
        tools: true, images: false, audio: false, video: false, reasoningEffort: 'medium'
      }
    });
    const save = async (title: string, markdown: string, currentPath: string | null = null) => {
      const note = await invoke<Note>('save_note', {
        title, markdown, currentPath
      });
      assert(note.path.includes('gneauxghts-native-e2e-'), 'Synthetic disposable vault only');
      await invoke('finalize_note_editing_window', { noteId: note.noteId });
      await invoke('e2e_flush_vault_watcher_path', { path: note.path });
      return note;
    };
    const baseline = '# Meridian\n\n- [ ] Ancient untouched backlog: redesign the logo\n\nInitial proposal: weekly exports.';
    const note = await save('Meridian activity regression', baseline);
    await invoke('chat_grant_note', { noteId: note.noteId });
    const start = new Date().toISOString();
    await save(note.title, baseline + '\n\n- [ ] Send Larissa the report\n\nPrepare an onboarding plan.\n\nExperimental pilot idea.', note.path);
    const end = new Date().toISOString();
    assert(start < end);
    await save(note.title, '# Meridian\n\n- [ ] Ancient untouched backlog: redesign the logo\n\nInitial proposal: weekly exports.\n\n- [x] Send Larissa the report\n\nOnboarding plan superseded: arrange a vendor review instead.\n\nThe experimental pilot was canceled.', note.path);
    const privateNote = await save('Private activity', 'CANARY_FOLLOWUP_817');
    await invoke('chat_set_note_excluded', {
      noteId: privateNote.noteId, title: privateNote.title, excluded: true
    });
    const results: unknown[] = [];
    const currentStatusIds: string[] = [];
    const record = () => {
      mkdirSync(dirname(resolve(output)), { recursive: true });
      writeFileSync(output, JSON.stringify({
        endpoint, model, start, end, method: "Real native app; first request via composer with rendered citation navigation; remaining requests via production IPC; synthetic disposable vault; semantic rubric reviewed separately", results
      }, null, 2));
    };
    const ask = async (conversationId: string, question: string, alreadySent = false) => {
      const before = await invoke<{
        messages: Answer[];
      }>('chat_get_conversation', { conversationId });
      const previous = new Set(before.messages.map(m => m.id));
      if (!alreadySent)
        await invoke('chat_send_message', {
          request: {
            conversationId, content: question, attachments: [], activeNote: null, selectedContext: [], forceWebSearch: false
          }
        });
      let answer: Answer | undefined;
      try {
        await browser.waitUntil(async () => {
          const c = await invoke<{
            messages: Answer[];
          }>('chat_get_conversation', { conversationId });
          answer = c.messages.find(m => m.role === 'assistant' && (alreadySent || !previous.has(m.id)));
          return Boolean(answer && ['complete', 'failed', 'cancelled'].includes(answer.status));
        }, { timeout: 300_000, interval: 1000 });
      }
      catch (error) {
        results.push({
          scenario: 'request-timeout', question, answer
        });
        record();
        throw error;
      }
      assert(answer);
      return answer;
    };
    const validate = async (conversationId: string, answer: Answer) => {
      assert.equal(answer.status, 'complete', answer.error);
      assert(!JSON.stringify(answer).includes('CANARY_FOLLOWUP_817'));
      const links = [...answer.content.matchAll(/passage:([^\s)\]]+)/g)].map(m => m[1]);
      assert(links.length > 0);
      for (const evidenceId of links)
        await invoke('chat_resolve_passage', { conversationId, evidenceId });
    };
    const repeats = Number(process.env.GNEAUX_LIVE_REPEATS ?? '2');
    assert(repeats >= 1 && repeats <= 3);
    for (let repeat = 0; repeat < repeats; repeat++) {
      let conversation: {
        id: string;
      };
      const question = `From what I worked on between ${start} (inclusive) and ${end} (exclusive), what are things I need to do now? Explain what changed and use the latest status.`;
      if (repeat === 0) {
        const open = await $('button[aria-label="Open thought partner in this pane"]');
        await open.waitForExist();
        await browser.execute((el: HTMLElement) => el.click(), open);
        const composer = await $('[data-testid="workspace-pane"][data-pane-kind="chat"] textarea');
        await composer.waitForEnabled({ timeout: 30_000 });
        await composer.setValue(question);
        assert.equal(await $('button[aria-label="Source-first preview"]').isExisting(), false);
        await $('button[aria-label="Send message"]').click();
        await browser.waitUntil(async () => {
          const summaries = await invoke<{
            id: string;
          }[]>('chat_list_conversations');
          for (const summary of summaries) {
            const c = await invoke<{
              id: string;
              messages: Answer[];
            }>('chat_get_conversation', { conversationId: summary.id });
            if (c.messages.some(m => m.role === 'user' && m.content === question)) {
              conversation = c;
              return true;
            }
          }
          return false;
        }, { timeout: 30_000, interval: 500 });
      }
      else
        conversation = await invoke<{
          id: string;
        }>('chat_create_conversation', {
          request: {
            title: 'Activity follow-ups', provider: 'local', model, access: 'approved', reasoningEffort: 'medium'
          }
        });
      const answer = await ask(conversation!.id, question, repeat === 0);
      results.push({
        repeat, question, answer, rubric: { required: ['Activity evidence includes changed report/onboarding/pilot passages', 'Report is already recorded complete', 'Vendor review supersedes onboarding plan; honor any later completion status', 'Pilot is canceled', 'Old logo backlog is not attributed to the interval', 'Inferences are distinguished from recorded commitments', 'Coverage limitations disclosed'], forbidden: ['Private canary', 'Treating task deletion alone as completion'] }
      });
      record();
      await validate(conversation!.id, answer);
      assert(answer.sources.some(s => s.passage?.historical), 'Answer must acquire retained changed-passages, not just current note dates');
      assert(answer.sources.some(s => s.passage && !s.passage.historical), 'Answer must acquire current status evidence');
      if (repeat === 0) {
        const sourceIndex = answer.sources.findIndex(s => s.passage?.location === 'body' && !s.passage.historical && answer.content.includes(`passage:${s.passage.id}`));
        assert(sourceIndex >= 0, 'Answer must cite current body evidence for status');
        const source = answer.sources[sourceIndex];
        assert(source.passage);
        const citationId = `${source.kind}:${source.noteId ?? source.url ?? source.title}:${source.anchor ?? sourceIndex}`;
        const citation = await $(`[data-chat-note-citation-id=${JSON.stringify(citationId)}]`);
        await browser.waitUntil(async () => {
          const ready = await citation.isExisting();
          if (!ready) {
            const state = await browser.execute(() => ({ text: document.body.innerText.slice(-6000), citationIds: Array.from(document.querySelectorAll<HTMLElement>('[data-chat-note-citation-id]')).map(el => el.dataset.chatNoteCitationId) }));
            writeFileSync(resolve(dirname(output), 'native-ui-citation-state.json'), JSON.stringify({ expected: citationId, state }, null, 2));
          }
          return ready;
        }, {
          timeout: 30_000, interval: 1000, timeoutMsg: 'Delivered current citation must render'
        });
        const resolved = await invoke<{
          markdown: string;
          selection: {
            anchor: number;
            head: number;
          } | null;
        }>('chat_resolve_passage', { conversationId: conversation!.id, evidenceId: source.passage.id });
        assert(resolved.selection, 'A current body citation must resolve a selection');
        await browser.saveScreenshot(resolve(dirname(output), 'native-final-answer.png'));
        await browser.execute((el: HTMLElement) => el.click(), citation);
        await browser.waitUntil(async () => browser.execute((noteId, markdown, selection) => {
          const state = (window as typeof window & {
            __GNEAUXGHTS_NATIVE_E2E__?: {
              readEditorState: () => {
                noteId: string;
                editor?: {
                  markdown: string;
                  selection: {
                    anchor: number;
                    head: number;
                  };
                };
              };
            };
          }).__GNEAUXGHTS_NATIVE_E2E__?.readEditorState();
          return Boolean(state && state.noteId === noteId && state.editor?.markdown === markdown && state.editor.selection?.anchor === selection?.anchor && state.editor.selection?.head === selection?.head);
        }, source.noteId, resolved.markdown, resolved.selection), { timeout: 15_000, timeoutMsg: 'Current citation must open and highlight the exact passage' });
      }
      // Add a later status in another note after the answer. The next turn must read it freshly.
      const status = await save(`Meridian vendor status ${repeat}`, `# Meridian vendor status\n\nVendor review is now recorded complete.\n\n- [ ] Send Rhea the final contract.`);
      await invoke('chat_grant_note', { noteId: status.noteId });
      currentStatusIds.push(status.noteId);
      const followupQuestion = 'Check the latest Meridian vendor status in related notes. What follow-ups remain now? Distinguish recorded commitments from suggestions.';
      const followup = await ask(conversation!.id, followupQuestion);
      results.push({
        repeat, scenario: 'fresh-cross-note-followup', question: followupQuestion, answer: followup, rubric: { required: ['Vendor review is recorded complete in the new status note', 'Rhea contract is a recorded outstanding commitment', 'No stale onboarding or pilot task'], forbidden: ['Weekly exports treated as a recorded outstanding commitment'] }
      });
      record();
      await validate(conversation!.id, followup);
      assert(followup.sources.some(s => s.noteId === status.noteId && s.passage?.location === 'body' && followup.content.includes(`passage:${s.passage.id}`)), 'Follow-up must read and cite the new cross-note status');
    }
    const conversation = await invoke<{
      id: string;
    }>('chat_create_conversation', {
      request: {
        title: 'Research evidence regression', provider: 'local', model, access: 'approved', reasoningEffort: 'medium'
      }
    });
    const question = `Use research_notes to gather the specific Meridian passages changed between ${start} and ${end}, then independently read current related notes and tell me what remains to do. Use direct evidence if research cannot finish.`;
    const answer = await ask(conversation!.id, question);
    results.push({
      scenario: 'bounded-research-and-current-status', question, answer, rubric: { required: ['Research invoked with explicit interval', 'Only validated read passages delivered', 'Latest vendor completion and Rhea contract reflected', 'Fallback disclosed when needed'] }
    });
    record();
    await validate(conversation!.id, answer);
    assert(answer.agentEvents.some(e => e.event.type === 'researchCompleted'), 'Research invocation must record its actual outcome');
    assert(answer.sources.some(s => currentStatusIds.includes(s.noteId ?? '') && s.passage?.location === 'body' && answer.content.includes(`passage:${s.passage.id}`)), 'Research or its fallback must independently read and cite the latest cross-note status');
    assert(answer.sources.some(s => s.passage?.historical && answer.content.includes(`passage:${s.passage.id}`)), 'Research or its direct fallback must read and cite historical evidence, not quote discovery previews');
  });
});
