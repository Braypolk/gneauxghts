import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { browser, $ } from '@wdio/globals';
import { addCalendarDays } from '../../../src/lib/features/tasks/taskDates';

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.executeAsync((cmd, input, done: (r: { ok: boolean; value?: unknown; error?: string }) => void) => {
    const native = window as typeof window & { __TAURI_INTERNALS__: { invoke: (c: string, a: Record<string, unknown>) => Promise<unknown> } };
    void native.__TAURI_INTERNALS__.invoke(cmd, input).then(
      value => done({ ok: true, value }), error => done({ ok: false, error: String(error) })
    );
  }, command, args);
  if (!result.ok) throw new Error(result.error);
  return result.value as T;
}

type Answer = {
  role: string; status: string; content: string; error?: string;
  sources: Array<{ noteId?: string; passage?: { id: string; location: string } }>;
  agentEvents: Array<{ event: { type: string; name?: string; status?: string; details?: Record<string, unknown> } }>;
};
type Proposal = { status: string; noteId?: string; preview: { proposedEditorMarkdown: string } };
const live = process.env.GNEAUX_CHAT_DATES_NATIVE === '1' ? describe : describe.skip;

live('Chat dates and portable deadlines through the native runtime', function () {
  this.timeout(900_000);
  it('reads deadlines, composes research and prepares a date-aware reviewed edit', async () => {
    const endpoint = process.env.GNEAUX_LIVE_ENDPOINT;
    const model = process.env.GNEAUX_LIVE_MODEL;
    const output = process.env.GNEAUX_LIVE_OUTPUT;
    assert(endpoint && model && output, 'Explicit local endpoint, model and output required');
    await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
    const settings = await invoke<Record<string, unknown>>('chat_get_settings');
    await invoke('chat_set_settings', { settings: {
      ...settings, provider: 'local', model, localModel: model, localBaseUrl: endpoint,
      defaultAccess: 'approved', webAccess: 'off', reasoningEffort: 'medium'
    } });
    await invoke('chat_set_local_model_capabilities', { model, capabilities: {
      tools: true, images: false, audio: false, video: false, reasoningEffort: 'medium'
    } });
    const dateTimeContext = {
      locale: 'en-GB', timeZone: 'America/Denver',
      dateOrder: ['day', 'month', 'year'], hourCycle: 'h23'
    };
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: dateTimeContext.timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const part = (name: string) => parts.find(p => p.type === name)!.value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const tomorrow = addCalendarDays(today, 1);
    const yesterday = addCalendarDays(today, -1);
    const parentLine = `- [ ] Parent deadline @due(${tomorrow}) @due(${addCalendarDays(today, 7)})`;
    const body = [
      '# Meridian dates', '', parentLine,
      `  - [ ] Child deadline @due(${yesterday})`,
      '  - [ ] Undated child',
      `- [ ] Today deadline @due(${today})`,
      `- [x] Completed deadline @due(${yesterday})`,
      '- [ ] Plain date 01/02/2027 21:32',
      '- [ ] Invalid deadline @due(2026-02-30)',
      '- [ ] Code example `@due(2027-03-01)`',
      '', '```markdown', '- [ ] Fenced example @due(2027-04-01)', '```'
    ].join('\n');
    const note = await invoke<{ noteId: string; path: string; title: string; markdown: string }>('save_note', {
      title: 'Meridian dates', markdown: body, currentPath: null
    });
    assert(note.path.includes('gneauxghts-native-e2e-'), 'Disposable synthetic vault only');
    await invoke('finalize_note_editing_window', { noteId: note.noteId });
    await invoke('e2e_flush_vault_watcher_path', { path: note.path });
    await invoke('chat_grant_note', { noteId: note.noteId });
    const privateNote = await invoke<{ noteId: string; title: string }>('save_note', {
      title: 'Private dates', markdown: '- [ ] DATE_CANARY_918 @due(2027-01-01)', currentPath: null
    });
    await invoke('chat_set_note_excluded', { noteId: privateNote.noteId, title: privateNote.title, excluded: true });
    const before = readFileSync(note.path, 'utf8');
    const results: Array<{ scenario: string; question: string; answer?: Answer; proposals?: Proposal[] }> = [];
    const record = () => {
      mkdirSync(dirname(resolve(output)), { recursive: true });
      writeFileSync(output, JSON.stringify({
        endpoint, model, today, tomorrow, yesterday, dateTimeContext,
        semanticRubric: {
          openTasks: 7, completedTasks: 1,
          overdueOpen: ['Child deadline'], dueTodayOpen: ['Today deadline'],
          dueTomorrowOpen: ['Parent deadline'],
          noExplicitDeadlineOpen: ['Undated child', 'Plain date', 'Invalid deadline', 'Code example'],
          nonTasks: ['Fenced example'], reviewedDeadline: '2027-02-01'
        },
        results
      }, null, 2));
    };
    for (const scenario of ['current', 'research', 'proposal']) {
      const conversation: { id: string } = await invoke('chat_create_conversation', { request: {
        title: 'Chat dates regression', provider: 'local', model, access: 'approved', reasoningEffort: 'medium'
      } });
      const question = scenario === 'proposal'
        ? `In note "Meridian dates", change only Parent deadline's due date to 01/02/2027 using my current editor date convention. Consolidate its supported duplicate due annotations; keep children and all unrelated text exactly intact. Prepare a reviewed proposal, do not save it.`
        : `${scenario === 'research' ? `Use research_notes to gather current explicit task deadlines from note_ids ["${note.noteId}"], then ` : ''}Read Meridian dates and explain which open tasks are overdue, due today, due tomorrow or have no supported explicit deadline. Give the dates and preserve each child's own status. Distinguish ordinary date/time text and invalid/code examples from deadlines. Cite current body evidence.`;
      const result: typeof results[number] = { scenario, question };
      results.push(result);
      record();
      await invoke('chat_send_message', { request: {
        conversationId: conversation.id, content: question, attachments: [], activeNote: null,
        selectedContext: [], forceWebSearch: false, dateTimeContext
      } });
      try {
        await browser.waitUntil(async () => {
          const data = await invoke<{ messages: Answer[] }>('chat_get_conversation', { conversationId: conversation.id });
          result.answer = data.messages.find(message => message.role === 'assistant');
          return Boolean(result.answer && ['complete', 'failed', 'cancelled'].includes(result.answer.status));
        }, { timeout: 300_000, interval: 1000 });
      } finally { record(); }
      assert(result.answer);
      assert.equal(result.answer.status, 'complete', result.answer.error);
      assert(!JSON.stringify(result.answer).includes('DATE_CANARY_918'));
      if (scenario === 'proposal') {
        result.proposals = await invoke<Proposal[]>('chat_list_pending_proposals', { conversationId: conversation.id });
        record();
        const proposal: Proposal | undefined = result.proposals.find(p => p.noteId === note.noteId && p.status === 'pending');
        assert(proposal, 'Deadline edit must be staged for review');
        const expected = note.markdown.replace(parentLine, '- [ ] Parent deadline @due(2027-02-01)');
        assert.equal(proposal.preview.proposedEditorMarkdown.trimEnd(), expected.trimEnd(), 'British numeric date resolves to February 1; only the intended deadline changes');
        assert.equal(readFileSync(note.path, 'utf8'), before, 'An unapproved proposal must not write Markdown');
      } else {
        assert(result.answer.sources.some(source => source.noteId === note.noteId && source.passage?.location === 'body'
          && result.answer!.content.includes(`passage:${source.passage.id}`)), 'Deadline answer must read and cite current body evidence');
        if (scenario === 'research') {
          assert(result.answer.agentEvents.some(({ event }) => event.type === 'researchCompleted'
            && event.details?.reason === 'validated' && Number(event.details.deliveredPassages) > 0), 'Research must deliver actually read deadline evidence');
        }
        assert(!result.answer.agentEvents.some(({ event }) => event.type === 'queryResolved'
          && event.details?.resolved != null), 'Calendar deadlines must not be filtered as recorded note activity');
        for (const source of result.answer.sources) {
          if (source.passage) await invoke('chat_resolve_passage', { conversationId: conversation.id, evidenceId: source.passage.id });
        }
      }
    }
    record();
  });
});
