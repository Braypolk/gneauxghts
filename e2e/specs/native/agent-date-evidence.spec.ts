import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { browser, $ } from '@wdio/globals';

// Live inference is explicitly opt-in; ordinary native suites never call a model.
const preview = process.env.GNEAUX_SOURCE_FIRST_PREVIEW === '1';
const live = process.env.GNEAUX_LIVE_NATIVE === '1' ? describe : describe.skip;
type Note = { noteId: string; path: string; title: string; markdown: string };
type Source = { kind: string; title: string; excerpt: string; noteId?: string; url?: string;
  anchor?: string; passage?: { id: string } };
type Event = { type: string; name?: string; status?: string; title?: string };
type Message = { id: string; role: string; status: string; content: string; error?: string;
  sources: Source[]; agentEvents: { event: Event }[] };
type Conversation = { id: string; messages: Message[] };
type Receipt = { requestId: string; assistantMessageId: string };
type Resolution = { source: Source; markdown: string; selection: { anchor: number; head: number } | null };

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.executeAsync(
    (command: string, args: Record<string, unknown>, done: (value: { ok: boolean; value?: unknown; error?: string }) => void) => {
      const native = window as typeof window & {
        __TAURI_INTERNALS__?: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      };
      if (!native.__TAURI_INTERNALS__) return done({ ok: false, error: 'Real native IPC is required' });
      void native.__TAURI_INTERNALS__.invoke(command, args).then(
        value => done({ ok: true, value }), error => done({ ok: false, error: String(error) })
      );
    }, command, args
  );
  if (!result.ok) throw new Error(result.error);
  return result.value as T;
}

live('Live local agent date evidence in a disposable native vault', function () {
  this.timeout(300_000);
  const endpoint = process.env.GNEAUX_LIVE_ENDPOINT;
  const model = process.env.GNEAUX_LIVE_MODEL;
  const output = process.env.GNEAUX_LIVE_OUTPUT;
  const results: Record<string, unknown>[] = [];
  let excluded: Note;
  let tasks: Note;
  let meetings: Note;
  let deadlines: Note;
  let conditions: Note | undefined;
  let success: Note | undefined;
  let scratch: Note;
  let uiConversation: Conversation;

  function persist() {
    assert(output, 'An explicit output path is required');
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(output, JSON.stringify({ endpoint, model, preview,
      method: 'Native Tauri app, real ChatService/AgentRuntime/tools, synthetic vault, lexical retrieval. First question submitted through the Svelte composer; later questions use production IPC. Quality graded separately.',
      notes: [tasks, meetings, deadlines, conditions, success].filter((n): n is Note => Boolean(n)).map(n => ({ title: n.title, markdown: n.markdown })),
      results }, null, 2));
  }

  async function save(title: string, markdown: string, currentPath: string | null = null): Promise<Note> {
    const note = await invoke<Note>('save_note', { title, markdown, currentPath });
    assert(note.path.includes('gneauxghts-native-e2e-'), 'Writes must land in the owned native E2E fixture');
    await invoke('finalize_note_editing_window', { noteId: note.noteId });
    await invoke('e2e_flush_vault_watcher_path', { path: note.path });
    return { ...note, markdown };
  }

  before(async () => {
    assert(endpoint && model && output, 'Explicit local endpoint, model, and artifact required');
    assert(!process.env.GNEAUXGHTS_RELEASE_SCALE_RUN, 'Use a fresh disposable native fixture');
    await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
    const settings = await invoke<Record<string, unknown>>('chat_get_settings');
    await invoke('chat_set_settings', { settings: { ...settings, provider: 'local', model,
      localModel: model, localBaseUrl: endpoint, defaultAccess: 'full', webAccess: 'off', reasoningEffort: 'medium' } });
    await invoke('chat_set_local_model_capabilities', { model,
      capabilities: { tools: true, images: false, audio: false, video: false, reasoningEffort: 'medium' } });
    const semantic = await invoke<Record<string, unknown>>('get_semantic_settings');
    await invoke('set_semantic_settings', { settings: { ...semantic, semanticSearchEnabled: false } });
    tasks = await save('Cobalt task log', '- [ ] Send Cobalt proposal\n- [ ] Investigate Cobalt migration\n\nPlan to deploy Cobalt Friday.');
    tasks = await save(tasks.title, '- [x] Send Cobalt proposal\n- [ ] Investigate Cobalt migration\n\nPlan to deploy Cobalt Friday.', tasks.path);
    if (preview) {
      const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      tasks = await save(tasks.title, tasks.markdown + `\n\nOn ${today}, I completed the Cobalt access review.\nInvoice 42 paid; Cobalt payment receipt filed by me.`, tasks.path);
      success = await save('Cedar recovery result', 'Cedar may resume only after route B passes a witnessed recovery drill. Route B passed the witnessed Cedar recovery drill on September 11, 2026 at 14:00. The office printer needs toner.');
      conditions = await save('Cobalt recovery condition', 'Cobalt may resume only after route B passes a witnessed recovery drill. The route B drill is scheduled for September 18, 2026. No route B drill result is recorded. The office printer needs toner.');
    }
    meetings = await save('Cobalt meeting retrospective', 'September 10, 2026 retrospective: the Cobalt design review took place July 8, 2026. The Cobalt budget workshop was scheduled for July 11, but no outcome is recorded here. The Cobalt vendor meeting on July 10 was canceled before it began. The prior Cobalt safety briefing took place June 30.');
    deadlines = await save('Cobalt deadline schedule', 'Cobalt contract signature originally due September 16, 2026. September 9 amendment: moved to September 23, replacing September 16. The Cobalt inspection report is due September 18. Its inspection meeting took place September 8; submission of the report is not recorded.');
    excluded = await save('Cobalt excluded source', 'CONFIDENTIAL_CANARY_Z91: Cobalt secret meeting took place July 9, 2026.');
    await invoke('chat_set_note_excluded', { noteId: excluded.noteId, title: excluded.title, excluded: true });
    scratch = await save('Evaluation workspace', 'Disposable synthetic evaluation workspace.');
    await invoke('mark_note_opened', { noteId: scratch.noteId });
    await browser.refresh();
    await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
    persist();
  });

  async function completed(conversationId: string, messageId?: string): Promise<Message> {
    let answer: Message | undefined;
    await browser.waitUntil(async () => {
      const conversation = await invoke<Conversation>('chat_get_conversation', { conversationId });
      answer = conversation.messages.find(m => m.role === 'assistant' && (!messageId || m.id === messageId));
      if (preview && answer?.status === 'streaming') assert.equal(answer.content, '', 'Unvalidated preview text must stay hidden');
      return Boolean(answer && ['complete', 'failed', 'cancelled'].includes(answer.status));
    }, { timeout: 240_000, interval: 1000, timeoutMsg: 'Native agent did not reach a terminal message state' });
    assert(answer);
    return answer;
  }

  async function record(id: string, question: string, conversationId: string, answer: Message, started: number, expected: string) {
    const events = answer.agentEvents.filter(e => ['toolCallUpdated', 'runGuardTriggered', 'usageUpdated', 'modelTurnRetried'].includes(e.event.type));
    const links = [...answer.content.matchAll(/passage:([^\s)\]]+)/g)].map(m => m[1]);
    const resolutions: Record<string, unknown>[] = [];
    for (const evidenceId of new Set(links)) {
      try {
        const resolved = await invoke<Resolution>('chat_resolve_passage', { conversationId, evidenceId });
        resolutions.push({ evidenceId, title: resolved.source.title, excerpt: resolved.source.excerpt,
          selection: resolved.selection, status: 'resolved' });
      } catch (error) { resolutions.push({ evidenceId, status: 'failed', error: String(error) }); }
    }
    results.push({ id, question, expected, conversationId, status: answer.status, answer: answer.content,
      error: answer.error, latencyMillis: Date.now() - started, events,
      sources: answer.sources.map(s => ({ title: s.title, excerpt: s.excerpt, passage: s.passage })), resolutions });
    persist();
    assert.equal(answer.status, 'complete', answer.error);
    if (preview) {
      assert(answer.content.startsWith('**Source-first preview**'));
      assert(answer.content.includes('Selection may be incomplete.'));
      const quotes = answer.content.split('\n').filter(line => line.startsWith('> '))
        .map(line => line.slice(2).replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1'));
      assert(quotes.length > 0, 'Preview must contain exact quotations');
      for (const quote of quotes) assert(answer.sources.some(source => source.excerpt.includes(quote)), `Quotation must match a delivered source: ${quote}`);
      assert(!answer.content.includes('"confirmed":'), 'Raw selection JSON must not appear');
      const supporting = answer.content.split('**Supporting evidence**')[1]?.split('**Related evidence')[0] ?? '';
      const related = answer.content.split('**Related evidence')[1] ?? '';
      if (id === 'meetings_ui') {
        assert(supporting.includes('July 8'), 'Actual event date must be retained');
        assert(!supporting.includes('July 11'), 'Scheduled workshop is not confirmed held');
        assert(related.includes('July 11'), 'Unknown workshop outcome must be visible');
      } else if (id === 'checkbox_week') {
        assert(supporting.includes('Send Cobalt proposal'), 'Marked completion must be selected');
        assert(supporting.includes('I completed the Cobalt access review'), 'Explicit prose completion must be selected');
        assert(!supporting.includes('Invoice 42 paid'), 'Unknown payer and work date cannot establish my completion this week');
        assert(!supporting.includes('Investigate Cobalt migration'), 'Open task cannot count as completed');
      } else if (id === 'condition_success') {
        assert(supporting.includes('Route B passed the witnessed Cedar recovery drill'), 'Explicit success must remain supporting evidence');
        assert(!answer.content.includes('printer'), 'Unrelated evidence must be omitted');
      } else if (id === 'condition_outcome') {
        assert.equal(supporting, '', 'Missing drill outcome does not establish condition met');
        assert(related.includes('No route B drill result is recorded'), 'Missing outcome must be visible');
        assert(!answer.content.includes('printer'), 'Unrelated evidence must be omitted');
      }
    }
    assert(events.some(e => e.event.name === 'search_evidence'), 'Actual agent must choose search');
    assert(events.some(e => e.event.name === 'read_evidence'), 'Actual agent must read evidence');
    assert(links.length > 0, 'Answer must contain supplied current-passage links');
    assert(/\[Source \d+\]\(passage:/.test(answer.content), 'ChatService must construct the final source links');
    assert(!/\[S\d+\]|\[citation unavailable\]/.test(answer.content), 'All requested citation references must resolve');
    const reloaded = await invoke<Conversation>('chat_get_conversation', { conversationId });
    assert.equal(reloaded.messages.find(m => m.id === answer.id)?.content, answer.content,
      'Durable answer must retain app-constructed links independently of the model reference registry');
    assert(resolutions.every(r => r.status === 'resolved'), 'Every final citation must resolve');
    assert(!JSON.stringify({ answer: answer.content, sources: answer.sources }).includes('CONFIDENTIAL_CANARY_Z91'), 'Excluded content cannot enter answer evidence');
    assert(!answer.sources.some(s => s.noteId === excluded.noteId), 'Excluded note cannot be cited');
    return links;
  }

  it('searches for dated events through the real Svelte composer and opens a citation', async () => {
    const questionText = 'Which Cobalt meetings actually took place July 6–12, 2026? Separate confirmed meetings from plans.';
    const question = preview ? `/sources ${questionText}` : questionText;
    const open = await $('button[aria-label="Open thought partner in this pane"]');
    await open.waitForExist();
    await browser.execute((el: HTMLElement) => el.click(), open);
    const composer = await $('[data-testid="workspace-pane"][data-pane-kind="chat"] textarea');
    await composer.waitForEnabled({ timeout: 30_000 });
    await composer.setValue(questionText);
    if (preview) {
      const toggle = await $('button[aria-label="Source-first preview"]');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      assert.equal(await composer.getValue(), question);
      await toggle.click();
      assert.equal(await composer.getValue(), questionText, 'Turning preview off preserves the question');
      await toggle.click();
    }
    const started = Date.now();
    await $('button[aria-label="Send message"]').click();
    await browser.waitUntil(async () => {
      const summaries = await invoke<{ id: string }[]>('chat_list_conversations');
      for (const summary of summaries) {
        const c = await invoke<Conversation>('chat_get_conversation', { conversationId: summary.id });
        if (c.messages.some(m => m.role === 'user' && m.content === question)) { uiConversation = c; return true; }
      }
      return false;
    }, { timeout: 30_000, interval: 500 });
    const answer = await completed(uiConversation.id);
    const links = await record('meetings_ui', question, uiConversation.id, answer, started,
      'Only July 8 design review confirmed held. July 11 workshop occurrence unknown; July 10 vendor meeting canceled; June 30 outside period. A July text-edit filter alone cannot find this newly recorded retrospective.');
    const sourceIndex = answer.sources.findIndex(s => s.passage?.id === links[0]);
    assert(sourceIndex >= 0, 'Inline passage must have a delivered source');
    const source = answer.sources[sourceIndex];
    // The renderer uses the normalized source identity, while Markdown links use passage IDs.
    const citationId = `${source.kind}:${source.noteId ?? source.url ?? source.title}:${source.anchor ?? sourceIndex}`;
    const citation = await $(`[data-chat-note-citation-id=${JSON.stringify(citationId)}]`);
    await citation.waitForExist({ timeout: 15_000 });
    const resolved = await invoke<Resolution>('chat_resolve_passage', { conversationId: uiConversation.id, evidenceId: links[0] });
    assert(resolved.selection, 'Synthetic prose passage must be highlightable');
    await browser.saveScreenshot(join(dirname(resolve(output!)), `${basename(output!)}-meetings-answer.png`));
    await browser.execute((el: HTMLElement) => el.click(), citation);
    await browser.waitUntil(async () => browser.execute((noteId, markdown, selection) => {
      const state = (window as typeof window & { __GNEAUXGHTS_NATIVE_E2E__?: { readEditorState: () => { noteId: string; editor?: { markdown: string; selection: { anchor: number; head: number } } } } }).__GNEAUXGHTS_NATIVE_E2E__?.readEditorState();
      return Boolean(state && state.noteId === noteId && state.editor?.markdown === markdown &&
        state.editor.selection.anchor === selection.anchor && state.editor.selection.head === selection.head);
    }, source.noteId, resolved.markdown, resolved.selection!), { timeout: 15_000, timeoutMsg: 'Current citation did not highlight the resolved passage in the intended editor note' });
    results.push({ id: 'citation_ui', status: 'highlighted', title: source.title, selection: resolved.selection }); persist();
  });

  for (const scenario of (preview ? [
    { id: 'checkbox_week', question: 'Which Cobalt tasks were marked complete or did I explicitly complete this week? Separate items with unknown completion dates.', expected: 'Send Cobalt proposal marked complete this week; explicitly dated access review completed. Invoice payer unknown and receipt work date unknown. Open migration and deployment plan are not completions.' },
    { id: 'condition_outcome', question: 'Has Cobalt met its route B recovery condition?', expected: 'No confirmed outcome; quote missing drill result and relevant condition/schedule as related evidence. Do not infer failure or success.' },
    { id: 'condition_success', question: 'Has Cedar met its route B recovery condition?', expected: 'Recorded successful witnessed drill confirms the condition. Preserve this definite result; omit printer.' }
  ] : [
    { id: 'checkbox_week', question: 'Which Cobalt tasks were marked complete this week?', expected: 'Only Send Cobalt proposal is marked complete. Investigate migration stays open; deployment is a plan.' },
    { id: 'deadline_week', question: 'Which Cobalt deadlines are currently scheduled for September 14–20, 2026?', expected: 'Inspection report due September 18. Contract moved to September 23; old September 16 superseded. Meeting date is not deadline or submission evidence.' }
  ])) {
    it(`runs ${scenario.id} through production chat IPC and tools`, async () => {
      const c = await invoke<Conversation>('chat_create_conversation', { request: {
        title: `Native ${scenario.id}`, provider: 'local', model, access: 'full', reasoningEffort: 'medium' } });
      const started = Date.now();
      const receipt = await invoke<Receipt>('chat_send_message', { request: { conversationId: c.id, content: preview ? `/sources ${scenario.question}` : scenario.question,
        activeNote: null, attachments: [], selectedContext: [], forceWebSearch: false } });
      const answer = await completed(c.id, receipt.assistantMessageId);
      await record(scenario.id, scenario.question, c.id, answer, started, scenario.expected);
    });
  }

  it('rejects a delivered passage after exclusion and a later canonical edit', async () => {
    assert(uiConversation, 'Requires the initial native chat');
    const c = await invoke<Conversation>('chat_get_conversation', { conversationId: uiConversation.id });
    const source = c.messages.flatMap(m => m.sources).find(s => s.passage && s.noteId === meetings.noteId);
    assert(source?.passage, 'Requires delivered meeting evidence');
    const args = { conversationId: c.id, evidenceId: source.passage.id };
    await invoke('chat_resolve_passage', args);
    await invoke('chat_set_note_excluded', { noteId: meetings.noteId, title: meetings.title, excluded: true });
    await assert.rejects(invoke('chat_resolve_passage', args), /unavailable|changed|allowed/i);
    await invoke('chat_set_note_excluded', { noteId: meetings.noteId, title: meetings.title, excluded: false });
    await invoke('chat_resolve_passage', args);
    await save(meetings.title, 'Current replacement: the previous synthetic meeting account has been removed.', meetings.path);
    await assert.rejects(invoke('chat_resolve_passage', args), /unavailable|changed|allowed/i);
    results.push({ id: 'citation_freshness', status: 'passed', checks: ['excluded source rejected', 'unchanged reallowed source resolves', 'edited source rejected'] }); persist();
  });

  afterEach(async function () {
    if (this.currentTest?.state === 'failed') {
      results.push({ id: 'native_check_failure', test: this.currentTest.title,
        error: this.currentTest.err?.message });
      persist();
      await browser.saveScreenshot(join(dirname(resolve(output!)), `${basename(output!)}-failure-${results.length}.png`));
    }
  });
  after(() => persist());
});
