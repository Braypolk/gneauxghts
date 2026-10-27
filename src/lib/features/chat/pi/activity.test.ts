import { get } from 'svelte/store';
import { expect, it, vi } from 'vitest';
import { ChatDoc, PI_CONTEXT } from './runtime';
import { ChatReadDoc } from './documents';
import { createChatActivity, getChatActivity, isCompletionDisplayed } from './activity';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { piViewFixture } from '../ui/piViewTestSupport';

const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => resolve = done); return { promise, resolve }; };

it('tracks detached work, queued follow-ups and unread completion through Pi without a mounted view', async () => {
  const f = await piViewFixture(), release = gate(), started = gate();
  const activity = getChatActivity(f.runtime), report = vi.spyOn(f.runtime.diagnostics, 'report');
  try {
    await activity.ready;
    f.faux.setResponses([async () => { started.resolve(); await release.promise; return fauxAssistantMessage('First answer'); }, fauxAssistantMessage('Queued answer')]);
    await f.binding.initialize();
    const first = (await f.binding.send('First question'))!, id = f.binding.getSnapshot().conversation!.id;
    await started.promise;
    await f.binding.send('Follow-up');
    f.binding.dispose();
    expect(get(activity).conversations.get(id)).toMatchObject({ running: true, unread: false });
    release.resolve(); await first.wait(PI_CONTEXT);
    await vi.waitFor(() => expect(get(activity).conversations.get(id)).toMatchObject({ running: false, unread: true }));
    expect(get(activity).status).toBe('unread');
    const completed = get(activity).conversations.get(id)!.completed;
    await activity.markRead(id, completed);
    expect(get(activity).status).toBeNull();
    expect((await f.harness.snapshot(ChatReadDoc, id, PI_CONTEXT))?.throughSubmissionId).toBe(completed);
    expect(report).not.toHaveBeenCalled();
  } finally { release.resolve(); await f.close(); }
});

it('retains unread across runtime reopen and prevents stale acknowledgements from clearing a newer result', async () => {
  const f = await piViewFixture();
  let reopened: Awaited<ReturnType<typeof f.open>> | undefined;
  try {
    const activity = getChatActivity(f.runtime); await activity.ready;
    const chat = await f.runtime.createConversation();
    f.faux.setResponses([fauxAssistantMessage('First answer'), fauxAssistantMessage('Next answer')]);
    const first = await chat.submit({ type: 'input', content: 'First question' }, PI_CONTEXT); await first.wait(PI_CONTEXT);
    const firstCompletion = get(activity).conversations.get(chat.id)!.completed;
    const second = await chat.submit({ type: 'input', content: 'Next question' }, PI_CONTEXT); await second.wait(PI_CONTEXT);
    await activity.markRead(chat.id, firstCompletion);
    expect(get(activity).conversations.get(chat.id)?.unread).toBe(true);
    f.binding.dispose(); await f.harness.close(PI_CONTEXT);
    reopened = await f.open();
    const restored = createChatActivity(reopened, f.storage, f.runtime.diagnostics.report); await restored.ready;
    expect(get(restored).conversations.get(chat.id)).toMatchObject({ running: false, unread: true });
    await restored.markRead(chat.id, get(restored).conversations.get(chat.id)!.completed);
    await reopened.close(PI_CONTEXT); reopened = await f.open();
    const readAgain = createChatActivity(reopened, f.storage, f.runtime.diagnostics.report); await readAgain.ready;
    expect(get(readAgain).status).toBeNull();
  } finally { await reopened?.close(PI_CONTEXT); await f.close(); }
});

it('does not count stopped inputs, passive history, internal title jobs or forgotten chats as unread', async () => {
  const f = await piViewFixture();
  try {
    const activity = getChatActivity(f.runtime); await activity.ready;
    f.faux.setResponses([async (_request, options) => {
      await new Promise<void>(resolve => { if (options?.signal?.aborted) resolve(); else options?.signal?.addEventListener('abort', () => resolve(), { once: true }); });
      return fauxAssistantMessage('Stopped', { stopReason: 'aborted' });
    }, fauxAssistantMessage('Internal answer'), fauxAssistantMessage('Human answer')]);
    const chat = await f.runtime.createConversation();
    const pending = await chat.submit({ type: 'input', content: 'Stop me' }, PI_CONTEXT);
    await vi.waitFor(() => expect(f.faux.state.callCount).toBe(1));
    expect(get(activity).status).toBe('running');
    await chat.abort(PI_CONTEXT); await pending.wait(PI_CONTEXT);
    expect(get(activity).status).toBeNull();
    await chat.submit({ type: 'write', entry: { kind: 'fixture', model: [fauxAssistantMessage('Passive history')] } }, PI_CONTEXT);
    const internal = await f.runtime.createConversation();
    await f.harness.commit(async tx => { (await tx.doc(ChatDoc, internal.id)).purpose = 'noteTitles'; }, PI_CONTEXT);
    const internalInput = await internal.submit({ type: 'input', content: 'Internal prompt' }, PI_CONTEXT); await internalInput.wait(PI_CONTEXT);
    expect(get(activity).conversations.has(internal.id)).toBe(false);
    expect(get(activity).status).toBeNull();
    const humanInput = await chat.submit({ type: 'input', content: 'Human prompt' }, PI_CONTEXT); await humanInput.wait(PI_CONTEXT);
    expect(get(activity).status).toBe('unread');
    await f.harness.commit(async tx => { (await tx.doc(ChatDoc, chat.id)).forgotten = true; }, PI_CONTEXT);
    expect(get(activity).status).toBeNull();
    await f.harness.commit(async tx => { (await tx.doc(ChatDoc, chat.id)).forgotten = false; }, PI_CONTEXT);
    expect(get(activity).status).toBe('unread');
  } finally { await f.close(); }
});

it('surfaces a background failure with no assistant answer as an unread result', async () => {
  const f = await piViewFixture();
  try {
    const activity = getChatActivity(f.runtime); await activity.ready;
    f.faux.setResponses([() => { throw new Error('Provider unavailable'); }]);
    const chat = await f.runtime.createConversation(), input = await chat.submit({ type: 'input', content: 'Question' }, PI_CONTEXT);
    await input.wait(PI_CONTEXT);
    await vi.waitFor(() => expect(get(activity).conversations.get(chat.id)).toMatchObject({ running: false, unread: true }));
    await f.binding.initialize(String(chat.id));
    await vi.waitFor(() => expect(f.binding.getSnapshot().latestInput?.status).toBe('unanswered'));
    const item = get(activity).conversations.get(chat.id)!;
    const snapshot = f.binding.getSnapshot();
    expect(item.completion).toMatchObject({ id: input.id, status: 'unanswered' });
    expect(item.completion).not.toHaveProperty('answer');
    expect(isCompletionDisplayed(item.completion, snapshot.latestInput, [])).toBe(false);
    expect(isCompletionDisplayed(item.completion, snapshot.latestInput, snapshot.entries)).toBe(true);
    await activity.markRead(chat.id, item.completed);
    expect(get(activity).conversations.get(chat.id)?.unread).toBe(false);
  } finally { await f.close(); }
});

it('acknowledges an older answer after loading it, rather than a newer aborted input after compaction', async () => {
  const f = await piViewFixture();
  try {
    const activity = getChatActivity(f.runtime); await activity.ready;
    const chat = await f.runtime.createConversation();
    f.faux.setResponses([fauxAssistantMessage('Unread first answer'), async (_request, options) => {
      await new Promise<void>(resolve => {
        if (options?.signal?.aborted) resolve();
        else options?.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return fauxAssistantMessage('Stopped', { stopReason: 'aborted' });
    }]);
    const first = await chat.submit({ type: 'input', content: 'First question' }, PI_CONTEXT);
    const completed = await first.wait(PI_CONTEXT);
    expect(completed.status).toBe('done');
    if (completed.status !== 'done') throw new Error('Expected an answered input');
    const next = await chat.submit({ type: 'input', content: 'Later stopped question' }, PI_CONTEXT);
    await vi.waitFor(() => expect(f.faux.state.callCount).toBe(2));
    await chat.abort(PI_CONTEXT); await next.wait(PI_CONTEXT);
    // Pi's watch includes the active context. Compact it as well as paging the
    // transcript, so the old answer really is absent from the loaded view.
    for (let index = 0; index < 55; index++) await chat.submit({
      type: 'write', entry: { kind: 'fixture', model: [fauxAssistantMessage(`Later message ${index}: ${'filler '.repeat(1000)}`)] }
    }, PI_CONTEXT);
    f.faux.setResponses([fauxAssistantMessage('A summary of the older retained messages')]);
    await f.harness.waitForTask(await chat.compact(undefined, PI_CONTEXT), PI_CONTEXT);
    await f.binding.initialize(String(chat.id));
    await vi.waitFor(() => expect(f.binding.getSnapshot().latestInput).toMatchObject({ id: next.id, status: 'unanswered', reason: 'aborted' }));
    const item = get(activity).conversations.get(chat.id)!;
    const initial = f.binding.getSnapshot();
    expect(item).toMatchObject({ unread: true, running: false, completed: first.id });
    expect(item.completion).toMatchObject({ id: first.id, answer: completed.answer });
    expect(initial.historyNext).toBeDefined();
    expect(initial.entries.some(entry => entry.id === completed.answer)).toBe(false);
    expect(isCompletionDisplayed(item.completion, initial.latestInput, initial.entries)).toBe(false);
    expect(get(activity).conversations.get(chat.id)?.unread).toBe(true);

    await f.binding.loadOlder();
    const earlier = f.binding.getSnapshot();
    expect(earlier.entries.some(entry => entry.id === completed.answer)).toBe(true);
    expect(isCompletionDisplayed(item.completion, earlier.latestInput, earlier.entries)).toBe(true);
    await activity.markRead(chat.id, item.completed);
    expect(get(activity).conversations.get(chat.id)?.unread).toBe(false);
  } finally { await f.close(); }
});

it('hydrates all pages and reads old history once without marking it newly unread', async () => {
  const f = await piViewFixture();
  try {
    // Simulate an existing installation that predates the read cursor.
    const old = await f.harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'local', modelId: 'fixture' } } }, PI_CONTEXT);
    f.faux.setResponses([fauxAssistantMessage('Old answer')]);
    const input = await old.submit({ type: 'input', content: 'Old question' }, PI_CONTEXT); await input.wait(PI_CONTEXT);
    await f.harness.commit(async tx => { (await tx.doc(ChatReadDoc, old.id)).initialized = false; }, PI_CONTEXT);
    for (let i = 0; i < 130; i++) await f.runtime.createConversation({ title: `Chat ${i}` });
    const activity = getChatActivity(f.runtime); await activity.ready;
    expect(get(activity).conversations.size).toBe(131);
    expect(get(activity).status).toBeNull();
    expect((await f.harness.snapshot(ChatReadDoc, old.id, PI_CONTEXT))?.throughSubmissionId).toBe(input.id);
    f.faux.setResponses([fauxAssistantMessage('New answer')]);
    const next = await old.submit({ type: 'input', content: 'New question' }, PI_CONTEXT); await next.wait(PI_CONTEXT);
    expect(get(activity).conversations.get(old.id)?.unread).toBe(true);
  } finally { await f.close(); }
});

it('keeps completion commits arriving during delayed bootstrap reads and disposes without stopping work', async () => {
  const f = await piViewFixture(), release = gate(), started = gate();
  try {
    const chat = await f.runtime.createConversation();
    const scan = f.storage.scanSubmissions.bind(f.storage);
    vi.spyOn(f.storage, 'scanSubmissions').mockImplementationOnce(async (...args) => {
      const page = await scan(...args); started.resolve(); await release.promise; return page;
    });
    const activity = getChatActivity(f.runtime); await started.promise;
    f.faux.setResponses([fauxAssistantMessage('Finished during read')]);
    const input = await chat.submit({ type: 'input', content: 'Question' }, PI_CONTEXT); await input.wait(PI_CONTEXT);
    release.resolve(); await activity.ready;
    expect(get(activity).conversations.get(chat.id)).toMatchObject({ running: false, unread: true, completed: input.id });
    const abort = vi.spyOn(chat, 'abort'); activity.dispose();
    expect(get(activity).status).toBeNull(); expect(abort).not.toHaveBeenCalled();
  } finally { release.resolve(); await f.close(); }
});
