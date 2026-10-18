import { describe, expect, it, vi } from 'vitest';
import { createRegistry, defineExtension, defineTool, defineTask, AgentDoc, LiveDoc, InboxDoc } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { ChatDoc, PI_CONTEXT, type PiChat } from '../pi/runtime';
import { piViewFixture } from './piViewTestSupport';
import { createPiConversationView, latestFailure, viewInbox, viewLive } from './piConversationView';
import { fixtureSettings } from './piViewTestSupport';
import * as publication from '../pi/publication';

const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => resolve = done); return { promise, resolve }; };
const untilAborted = (signal: AbortSignal | undefined) => signal?.aborted ? Promise.resolve() : new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), { once: true }));

describe('Pi conversation presentation binding', () => {
  it.each(['creation', 'selection', 'disposal'] as const)('does not change editing permission after the originating draft is superseded during %s', async phase => {
    const f = await piViewFixture(), started = gate(), release = gate();
    const write = vi.spyOn(publication, 'setWritePolicy').mockImplementation(async (id, _revision, value) => ({ ...[...f.authorities.values()].find(a => a.authorityId === id)!, write: value }));
    try {
      await f.binding.initialize();
      const other = await f.runtime.createConversation({ title: 'Other chat' });
      if (phase === 'selection') {
        const read = f.runtime.authorityForConversation.bind(f.runtime);
        vi.spyOn(f.runtime, 'authorityForConversation').mockImplementation(async id => {
          if (id !== other.id) { started.resolve(); await release.promise; }
          return read(id);
        });
      } else {
        const create = f.runtime.createConversation.bind(f.runtime);
        vi.spyOn(f.runtime, 'createConversation').mockImplementationOnce(async options => {
          const result = await create(options); started.resolve(); await release.promise; return result;
        });
      }
      const changing = f.binding.changeWrite({ grant: { duration: 'temporary', conversationId: 0, operations: ['update'], scope: { noteIds: [], folders: ['.'] } }, reviewBeforeApplying: true });
      const rejected = expect(changing).rejects.toThrow('chat changed');
      await started.promise;
      if (phase === 'disposal') f.binding.dispose(); else await f.binding.select(String(other.id));
      release.resolve(); await rejected;
      expect(write).not.toHaveBeenCalled();
      if (phase !== 'disposal') expect(f.binding.getSnapshot().conversation?.id).toBe(other.id);
    } finally { release.resolve(); write.mockRestore(); await f.close(); }
  });

  it('grants editing permission to the new chat when its selection stays current', async () => {
    const f = await piViewFixture();
    const write = vi.spyOn(publication, 'setWritePolicy').mockImplementation(async (id, revision, value) => ({ ...[...f.authorities.values()].find(a => a.authorityId === id)!, revision: revision + 1, write: value }));
    try {
      await f.binding.initialize();
      await f.binding.changeWrite({ grant: { duration: 'temporary', conversationId: 0, operations: ['update'], scope: { noteIds: [], folders: ['.'] } }, reviewBeforeApplying: true });
      const current = f.binding.getSnapshot();
      expect(current.authority?.write.grant).toMatchObject({ duration: 'temporary', conversationId: current.conversation!.id });
      expect(write.mock.calls[0][0]).toBe(current.authority!.authorityId);
    } finally { write.mockRestore(); await f.close(); }
  });

  it('opens without writing or resolving an agent, observes model changes and receives the first review', async () => {
    const fixture = await piViewFixture();
    try {
      await fixture.binding.initialize();
      const conversation = await fixture.runtime.createConversation({ title: 'Watch-backed selection' });
      await fixture.binding.refreshList();
      vi.spyOn(fixture.harness, 'conversation').mockResolvedValueOnce(conversation);
      const agent = vi.spyOn(conversation, 'agent'), commit = vi.spyOn(fixture.harness, 'commit');
      await fixture.binding.select(String(conversation.id));
      expect(commit).not.toHaveBeenCalled(); expect(agent).not.toHaveBeenCalled();
      expect(fixture.binding.getSnapshot()).toMatchObject({ title: 'Watch-backed selection', provider: 'local', model: 'fixture', editReviews: [] });
      const review = { taskId: 7, title: 'First edit', kind: 'edit' as const, patch: 'Exact diff', decision: 'pending' as const };
      await fixture.harness.commit(async tx => {
        (await tx.doc(AgentDoc, conversation.id)).model = { provider: 'openai', modelId: 'watch-model' };
        (await tx.doc(publication.EditReviewDoc, conversation.id)).items['7'] = review;
      }, PI_CONTEXT);
      await vi.waitFor(() => expect(fixture.binding.getSnapshot()).toMatchObject({ provider: 'openai', model: 'watch-model', editReviews: [review] }));
      expect(fixture.faux.state.callCount).toBe(0);
    } finally { await fixture.close(); }
  });

  it.each(['title', 'forgotten'] as const)('uses initial watch metadata when %s changes just before attachment', async field => {
    const fixture = await piViewFixture();
    try {
      await fixture.binding.initialize();
      const conversation = await fixture.runtime.createConversation({ title: 'Before attachment' });
      const watchDoc = fixture.harness.watchDoc.bind(fixture.harness);
      vi.spyOn(fixture.harness, 'watchDoc').mockImplementationOnce(async (...args) => {
        await fixture.harness.commit(async tx => {
          const doc = await tx.doc(ChatDoc, conversation.id);
          if (field === 'title') doc.title = 'At attachment'; else doc.forgotten = true;
        }, PI_CONTEXT);
        return watchDoc(...args);
      });
      await fixture.binding.select(String(conversation.id));
      if (field === 'title') expect(fixture.binding.getSnapshot().title).toBe('At attachment');
      else expect(fixture.binding.getSnapshot().conversation).toBeNull();
      expect(fixture.faux.state.callCount).toBe(0);
    } finally { await fixture.close(); }
  });

  it('retains loaded history during streaming without rebuilding it for progress-only frames', async () => {
    const fixture = await piViewFixture({ tokensPerSecond: 500 });
    let stop = () => {};
    try {
      await fixture.binding.initialize();
      const conversation = await fixture.runtime.createConversation();
      for (let index = 0; index < 61; index++) await conversation.submit({ type: 'write', entry: { kind: 'fixture', model: [{ role: 'user', content: `Past ${index}`, timestamp: index }] } }, PI_CONTEXT);
      const history = (await conversation.entries({ order: 'ascending' }, 100, undefined, PI_CONTEXT)).items;
      await conversation.submit({ type: 'write', entry: { kind: 'pi.compaction', head: history[55].id, model: [{ role: 'user', content: '<summary>Earlier history</summary>', timestamp: 100 }] } }, PI_CONTEXT);
      await fixture.binding.select(String(conversation.id)); await fixture.binding.loadOlder();
      let previous = fixture.binding.getSnapshot(), progressFrames = 0;
      stop = fixture.binding.subscribe(value => {
        if (value.view && value.view !== previous.view && value.view.entries === previous.view?.entries && viewLive(value.view).generation?.message) {
          expect(value.entries).toBe(previous.entries);
          progressFrames++;
        }
        previous = value;
      });
      const answer = 'A streamed answer that keeps the entire loaded conversation history.';
      fixture.faux.setResponses([fauxAssistantMessage(answer)]);
      await (await fixture.binding.send('Continue after compaction'))!.wait(PI_CONTEXT);
      await vi.waitFor(() => expect(JSON.stringify(fixture.binding.getSnapshot().entries)).toContain(answer));
      expect(progressFrames).toBeGreaterThan(1);
      expect(fixture.binding.getSnapshot().entries.some(entry => entry.id === history[0].id)).toBe(true);
    } finally { stop(); await fixture.close(); }
  });

  it('merges a full replacement frame after Pi coalesces a slow history observer', async () => {
    const fixture = await piViewFixture(), started = gate(), release = gate();
    let replacements = 0;
    try {
      await fixture.binding.initialize();
      const conversation = await fixture.runtime.createConversation();
      const watch = conversation.watch.bind(conversation);
      vi.spyOn(fixture.harness, 'conversation').mockResolvedValueOnce(conversation);
      vi.spyOn(conversation, 'watch').mockImplementationOnce(async context => {
        const handle = await watch(context), start = handle.start.bind(handle);
        let hold = true;
        vi.spyOn(handle, 'start').mockImplementation(listener => start(async (view, ops, context) => {
          if (hold) { hold = false; started.resolve(); await release.promise; }
          await listener(view, ops, context);
          if (ops.some(op => op[0] === 'r')) {
            replacements++;
            expect(fixture.binding.getSnapshot().entries).toEqual(expect.arrayContaining([...view.entries]));
          }
        }));
        return handle;
      });
      await fixture.binding.select(String(conversation.id));
      await conversation.submit({ type: 'write', entry: { kind: 'fixture', model: [] } }, PI_CONTEXT);
      await started.promise;
      for (let index = 0; index < 150; index++) await conversation.submit({ type: 'write', entry: { kind: 'fixture', model: [] } }, PI_CONTEXT);
      release.resolve();
      await vi.waitFor(() => expect(fixture.binding.getSnapshot().entries).toHaveLength(151));
      expect(replacements).toBeGreaterThan(0);
    } finally { release.resolve(); await fixture.close(); }
  });

  it('reopens the last viewed chat with its history, even when a newer chat exists, and keeps New chat fresh', async () => {
    const fixture = await piViewFixture();
    const conversation = await fixture.runtime.createConversation({ title: 'Last viewed' });
    await conversation.submit({ type: 'write', entry: { kind: 'fixture', model: [{ role: 'user', content: 'Remember this history', timestamp: 1 }] } }, PI_CONTEXT);
    await fixture.runtime.createConversation({ title: 'Created later' });
    const remembered = vi.fn(async () => String(conversation.id));
    const binding = createPiConversationView({ open: async () => fixture.runtime as unknown as PiChat, settings: async () => fixtureSettings,
      lastConversation: remembered, observeAuthority: async () => () => {} });
    try {
      await binding.initialize(null);
      expect(binding.getSnapshot().conversation?.id).toBe(conversation.id);
      expect(binding.getSnapshot().entries[0].model).toMatchObject([{ role: 'user', content: 'Remember this history' }]);
      await binding.startNew();
      await binding.initialize();
      expect(binding.getSnapshot().conversation).toBeNull();
      expect(remembered).toHaveBeenCalledTimes(1);
      expect(fixture.faux.state.callCount).toBe(0);
    } finally { binding.dispose(); await fixture.close(); }
  });

  it('honors an explicit conversation instead of restoring the remembered chat', async () => {
    const fixture = await piViewFixture();
    const conversation = await fixture.runtime.createConversation();
    const remembered = vi.fn(async () => '999');
    const binding = createPiConversationView({ open: async () => fixture.runtime as unknown as PiChat, settings: async () => fixtureSettings,
      lastConversation: remembered, observeAuthority: async () => () => {} });
    try {
      await binding.initialize(String(conversation.id));
      expect(binding.getSnapshot().conversation?.id).toBe(conversation.id);
      expect(remembered).not.toHaveBeenCalled();
    } finally { binding.dispose(); await fixture.close(); }
  });

  it.each(['missing', 'forgotten', 'invalid', 'unavailable'] as const)('opens a fresh composer when the remembered chat is %s', async kind => {
    const fixture = await piViewFixture();
    const conversation = await fixture.runtime.createConversation();
    if (kind === 'forgotten') await fixture.harness.commit(async tx => { (await tx.doc(ChatDoc, conversation.id)).forgotten = true; }, PI_CONTEXT);
    const binding = createPiConversationView({ open: async () => fixture.runtime as unknown as PiChat, settings: async () => fixtureSettings,
      lastConversation: async () => {
        if (kind === 'unavailable') throw new Error('Preference unavailable');
        return kind === 'forgotten' ? String(conversation.id) : kind === 'invalid' ? 'legacy-chat' : '999';
      }, observeAuthority: async () => () => {} });
    try {
      await binding.initialize();
      expect(binding.getSnapshot()).toMatchObject({ initialized: true, loading: false, conversation: null, error: null });
      expect(fixture.faux.state.callCount).toBe(0);
    } finally { binding.dispose(); await fixture.close(); }
  });

  it('lets New chat supersede a delayed remembered selection', async () => {
    const fixture = await piViewFixture();
    const conversation = await fixture.runtime.createConversation();
    const started = gate(), release = gate();
    const binding = createPiConversationView({ open: async () => fixture.runtime as unknown as PiChat, settings: async () => fixtureSettings,
      lastConversation: async () => { started.resolve(); await release.promise; return String(conversation.id); }, observeAuthority: async () => () => {} });
    try {
      const opening = binding.initialize();
      await started.promise;
      await binding.startNew();
      release.resolve(); await opening;
      expect(binding.getSnapshot()).toMatchObject({ loading: false, conversation: null, error: null });
    } finally { release.resolve(); binding.dispose(); await fixture.close(); }
  });

  it('refreshes native write policy and revisions across mounted chat bindings', async () => {
    const fixture = await piViewFixture();
    const receive: Array<(change: { retiredAuthorityIds: string[]; writePolicyChanged?: boolean }) => void> = [];
    const bindings = [0, 1].map(() => createPiConversationView({
      open: async () => fixture.runtime as unknown as PiChat, settings: async () => fixtureSettings,
      observeAuthority: async callback => { receive.push(callback); return () => {}; }
    }));
    try {
      const first = await fixture.runtime.createConversation(), second = await fixture.runtime.createConversation();
      await bindings[0].initialize(String(first.id)); await bindings[1].initialize(String(second.id));
      for (const id of [first.id, second.id]) {
        const authority = fixture.authorities.get(id)!;
        fixture.authorities.set(id, { ...authority, revision: authority.revision + 1,
          write: { grant: { duration: 'always', operations: ['update'], scope: { noteIds: [], folders: ['.'] } }, reviewBeforeApplying: false } });
      }
      for (const callback of receive) callback({ retiredAuthorityIds: [], writePolicyChanged: true });
      await vi.waitFor(() => {
        for (const binding of bindings) {
          expect(binding.getSnapshot().authority?.revision).toBe(2);
          expect(binding.getSnapshot().authority?.write.grant.duration).toBe('always');
          expect(binding.getSnapshot().authority?.write.reviewBeforeApplying).toBe(false);
        }
      });
    } finally { for (const binding of bindings) binding.dispose(); await fixture.close(); }
  });
  it('does not replace a newer native policy event with a delayed command response', async () => {
    const fixture = await piViewFixture();
    let receive!: (change: { retiredAuthorityIds: string[]; writePolicyChanged?: boolean }) => void;
    const binding = createPiConversationView({ open: async () => fixture.runtime as unknown as PiChat, settings: async () => fixtureSettings,
      observeAuthority: async callback => { receive = callback; return () => {}; } });
    const response = Promise.withResolvers<Awaited<ReturnType<typeof publication.setWritePolicy>>>();
    const write = vi.spyOn(publication, 'setWritePolicy').mockReturnValue(response.promise);
    try {
      const conversation = await fixture.runtime.createConversation(); await binding.initialize(String(conversation.id));
      const old = fixture.authorities.get(conversation.id)!;
      const pending = binding.changeWrite({ grant: { duration: 'off' }, reviewBeforeApplying: true });
      const newer = { ...old, revision: 3, write: { ...old.write, reviewBeforeApplying: false } };
      fixture.authorities.set(conversation.id, newer);
      receive({ retiredAuthorityIds: [], writePolicyChanged: true });
      await vi.waitFor(() => expect(binding.getSnapshot().authority?.revision).toBe(3));
      response.resolve({ ...old, revision: 2 }); await pending;
      expect(binding.getSnapshot().authority).toEqual(newer);
    } finally { write.mockRestore(); binding.dispose(); await fixture.close(); }
  });
  it('forgets an idle chat durably, updates other panes, and restores its exact Pi history without inference', async () => {
    const fixture = await piViewFixture();
    const other = createPiConversationView({ open: async () => fixture.runtime as unknown as PiChat, settings: async () => fixtureSettings, observeAuthority: async () => () => {} });
    try {
      await fixture.binding.initialize();
      const conversation = await fixture.runtime.createConversation({ title: 'Remember this chat' });
      await conversation.submit({ type: 'write', entry: { kind: 'fixture', model: [{ role: 'user', content: 'Keep this history', timestamp: 1 }] } }, PI_CONTEXT);
      await fixture.binding.select(String(conversation.id));
      await other.initialize(String(conversation.id));
      const entries = fixture.binding.getSnapshot().entries;
      await fixture.binding.forget();
      expect((await fixture.harness.snapshot(ChatDoc, conversation.id, PI_CONTEXT))?.forgotten).toBe(true);
      await vi.waitFor(() => expect(other.getSnapshot().conversation).toBe(null));
      expect(fixture.binding.getSnapshot().conversation).toBe(null);
      expect(fixture.binding.getSnapshot().recentlyForgotten).toBe(conversation.id);
      await fixture.binding.refreshList(); await other.refreshList();
      expect(other.getSnapshot().conversations).toEqual([]);
      await fixture.binding.unforget();
      expect(fixture.binding.getSnapshot().entries).toEqual(entries);
      expect(fixture.binding.getSnapshot().recentlyForgotten).toBeUndefined();
      await vi.waitFor(() => expect(other.getSnapshot().conversations.map(row => row.id)).toEqual([conversation.id]));
      expect(fixture.authorities.get(conversation.id)?.retired).toBe(false);
      expect(fixture.faux.state.callCount).toBe(0);
    } finally { other.dispose(); await fixture.close(); }
  });

  it('refuses to forget active Pi work even if the selected view is stale', async () => {
    const fixture = await piViewFixture();
    try {
      await fixture.binding.initialize();
      fixture.faux.setResponses([async (_request, options) => { await untilAborted(options?.signal); return fauxAssistantMessage('Stopped', { stopReason: 'aborted' }); }]);
      const active = (await fixture.binding.send('Still working'))!;
      await vi.waitFor(() => expect(fixture.faux.state.callCount).toBe(1));
      await expect(fixture.binding.forget()).rejects.toThrow('Stop');
      expect((await fixture.harness.snapshot(ChatDoc, fixture.binding.getSnapshot().conversation!.id, PI_CONTEXT))?.forgotten).not.toBe(true);
      await fixture.binding.stop(); await active.wait(PI_CONTEXT);
    } finally { await fixture.close(); }
  });

  it('does not resurrect retired native access when a forgotten chat is restored', async () => {
    const fixture = await piViewFixture();
    try {
      await fixture.binding.initialize();
      const conversation = await fixture.runtime.createConversation();
      await fixture.binding.select(String(conversation.id));
      await fixture.runtime.retireConversation(conversation.id);
      await fixture.binding.forget(); await fixture.binding.unforget();
      expect(fixture.binding.getSnapshot().authority?.retired).toBe(true);
      await expect(fixture.binding.send('Use old access')).rejects.toThrow('retired access');
      expect(fixture.faux.state.callCount).toBe(0);
    } finally { await fixture.close(); }
  });
  it('opens empty without inference, streams retained reasoning/text, and keeps tool diagnostics after settlement', async () => {
    const registry = createRegistry();
    registry.install(defineExtension({ name: 'fixture', tools: [defineTool({ name: 'read_note', description: 'Read a fixture note', parameters: Type.Object({}), async execute(_args, api) { api.diagnostic({ severity: 'error', message: 'The selected note was removed.', code: 'note_missing' }); return { output: [{ type: 'text', text: 'Cannot read this note.' }], isError: true }; } })] }));
    const fixture = await piViewFixture({ registry, tokensPerSecond: 200 });
    const { binding, faux } = fixture;
    try {
      await binding.initialize(); expect(faux.state.callCount).toBe(0);
      faux.setResponses([fauxAssistantMessage(fauxToolCall('read_note', {}, { id: 'read-1' }), { stopReason: 'toolUse' }), fauxAssistantMessage([{ type: 'thinking', thinking: 'The tool reported a missing note.' }, { type: 'text', text: 'The selected note is unavailable. Please select another note.' }])]);
      const submission = (await binding.send('Read this note'))!;
      await vi.waitFor(() => expect(viewLive(binding.getSnapshot().view).generation?.message?.content.some(block => block.type === 'text' && block.text.length > 0)).toBe(true));
      expect((await submission.status(PI_CONTEXT)).status).not.toBe('done');
      await submission.wait(PI_CONTEXT);
      await vi.waitFor(() => expect(viewLive(binding.getSnapshot().view).run).toBeUndefined());
      const history = JSON.stringify(binding.getSnapshot().entries);
      expect(history).toContain('The tool reported a missing note.'); expect(history).toContain('The selected note was removed.');
      expect(history).toContain('Cannot read this note.');
    } finally { await fixture.close(); }
  });

  it('shows actual queued input, withdraws it, and Stop aborts active work plus queued input', async () => {
    const fixture = await piViewFixture(); const { binding, faux, harness } = fixture;
    try {
      await binding.initialize();
      faux.setResponses([async (_request, options) => { await untilAborted(options?.signal); return fauxAssistantMessage('Retained partial.', { stopReason: 'aborted' }); }]);
      const active = (await binding.send('Active request'))!;
      await vi.waitFor(() => expect(faux.state.callCount).toBe(1));
      const queued = (await binding.send('Withdraw me'))!;
      await vi.waitFor(() => expect(viewInbox(binding.getSnapshot().view).items.map(item => item.id)).toContain(queued.id));
      await binding.withdraw(queued.id); expect((await queued.status(PI_CONTEXT)).status).toBe('unanswered');
      const remaining = (await binding.send('Stop withdraws this too'))!;
      await binding.stop();
      expect((await active.wait(PI_CONTEXT)).status).toBe('unanswered'); expect((await remaining.status(PI_CONTEXT)).status).toBe('unanswered');
      expect((await harness.snapshot(InboxDoc, binding.getSnapshot().conversation!.id, PI_CONTEXT))?.items).toEqual([]);
      expect((await harness.snapshot(LiveDoc, binding.getSnapshot().conversation!.id, PI_CONTEXT))?.run).toBeUndefined();
      expect(faux.state.callCount).toBe(1);
    } finally { await fixture.close(); }
  });

  it('places a follow-up once at the next Pi boundary and retains both answers', async () => {
    const fixture = await piViewFixture(); const { binding, faux } = fixture;
    const started = gate(), release = gate();
    try {
      await binding.initialize();
      faux.setResponses([async () => { started.resolve(); await release.promise; return fauxAssistantMessage('First answer'); }, fauxAssistantMessage('Queued answer')]);
      const first = (await binding.send('First question'))!; await started.promise;
      const queued = (await binding.send('Follow-up question'))!;
      expect((await queued.status(PI_CONTEXT)).status).toBe('queued');
      release.resolve(); await first.wait(PI_CONTEXT); await queued.wait(PI_CONTEXT);
      await vi.waitFor(() => expect(viewLive(binding.getSnapshot().view).run).toBeUndefined());
      expect(viewInbox(binding.getSnapshot().view).items).toEqual([]);
      const messages = binding.getSnapshot().entries.flatMap(entry => entry.model ?? []);
      expect(messages.filter(message => message.role === 'user' && message.content === 'Follow-up question')).toHaveLength(1);
      expect(JSON.stringify(messages)).toContain('First answer'); expect(JSON.stringify(messages)).toContain('Queued answer');
      expect(faux.state.callCount).toBe(2);
    } finally { release.resolve(); await fixture.close(); }
  });

  it('Stop joins conversation-owned background work as well as ordinary work', async () => {
    const started = gate();
    const background = defineTask<null, { phase: 'hold' }, null>({ name: 'fixture.background', version: 1, initial: () => ({ phase: 'hold' }),
      phases: { hold: async (_task, runtime) => { started.resolve(); await untilAborted(runtime.signal); } },
      abort: async (_task, runtime, context) => { await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted', reason: 'Stopped' } }), context); }
    });
    const registry = createRegistry(); registry.install(defineExtension({ name: 'fixture', tasks: [background] }));
    const fixture = await piViewFixture({ registry });
    try {
      await fixture.binding.initialize(); const conversation = await fixture.runtime.createConversation(); await fixture.binding.select(String(conversation.id));
      const task = await conversation.commit(tx => tx.createTask(background, null, { ownership: { kind: 'conversation' }, background: true }), PI_CONTEXT);
      fixture.harness.resume();
      await started.promise;
      await conversation.waitForIdle(PI_CONTEXT); // Ordinary idle deliberately excludes this task.
      await fixture.binding.stop();
      expect((await fixture.harness.waitForTask(task, PI_CONTEXT)).state.outcome.status).toBe('aborted');
    } finally { await fixture.close(); }
  });

  it('exposes a durable unanswered input when generation faults before an assistant entry exists', async () => {
    const fixture = await piViewFixture();
    try {
      await fixture.binding.initialize();
      vi.spyOn(fixture.runtime.models, 'getModel').mockImplementationOnce(() => { throw new Error('Fixture model resolution failed.'); });
      const submission = (await fixture.binding.send('Keep this question'))!;
      expect((await submission.wait(PI_CONTEXT)).status).toBe('unanswered');
      await vi.waitFor(() => expect(fixture.binding.getSnapshot().latestInput).toMatchObject({ id: submission.id, status: 'unanswered' }));
      expect(latestFailure(fixture.binding.getSnapshot().entries)).toBeUndefined();
      expect(fixture.binding.getSnapshot().latestInput).toMatchObject({ reason: 'faulted', detail: 'Fixture model resolution failed.' });
    } finally { await fixture.close(); }
  });

  it('starts a new attempt from the actual failed input rather than a later compaction summary', async () => {
    const fixture = await piViewFixture();
    try {
      await fixture.binding.initialize();
      fixture.faux.setResponses([fauxAssistantMessage('Incomplete answer', { stopReason: 'error', errorMessage: 'Unavailable' }), fauxAssistantMessage('New answer')]);
      const failed = (await fixture.binding.send('Actual question'))!; const failedRecord = await failed.wait(PI_CONTEXT);
      const conversation = fixture.binding.getSnapshot().conversation!;
      await conversation.submit({ type: 'write', entry: { kind: 'pi.compaction', head: failedRecord.entry!, model: [{ role: 'user', content: '<summary>Historical work</summary>', timestamp: 1 }] } }, PI_CONTEXT);
      await (await fixture.binding.newAttempt())!.wait(PI_CONTEXT);
      const entries = (await conversation.entries({}, 50, undefined, PI_CONTEXT)).items;
      const inputs = entries.filter(entry => entry.kind === 'pi.user').flatMap(entry => entry.model ?? []);
      expect(inputs.map(message => message.content)).toEqual(['Actual question', 'Actual question']);
    } finally { await fixture.close(); }
  });

  it('releases a late native listener after disposal', async () => {
    const fixture = await piViewFixture(); const acquired = gate(), release = gate(), stop = vi.fn();
    const binding = createPiConversationView({ open: async () => fixture.runtime as unknown as PiChat, settings: async () => fixtureSettings,
      observeAuthority: async () => { acquired.resolve(); await release.promise; return stop; } });
    try {
      await binding.initialize(); await acquired.promise; binding.dispose(); release.resolve();
      await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    } finally { binding.dispose(); release.resolve(); await fixture.close(); }
  });

  it('stops a watch acquired after its selection was replaced', async () => {
    const fixture = await piViewFixture(); const acquired = gate(), release = gate();
    const watchDoc = fixture.harness.watchDoc.bind(fixture.harness);
    let lateWatch: Awaited<ReturnType<typeof fixture.harness.watchDoc>>;
    try {
      await fixture.binding.initialize();
      const first = await fixture.runtime.createConversation({ title: 'Late selection' }), second = await fixture.runtime.createConversation({ title: 'Current selection' });
      vi.spyOn(fixture.harness, 'watchDoc').mockImplementationOnce(async (...args) => {
        lateWatch = await watchDoc(...args); acquired.resolve(); await release.promise; return lateWatch;
      });
      const staleSelection = fixture.binding.select(String(first.id)); await acquired.promise;
      await fixture.binding.select(String(second.id)); release.resolve(); await staleSelection;
      expect((await lateWatch!.closed).reason).toBe('cancelled');
      expect(fixture.binding.getSnapshot().error).toBeNull();
      expect(fixture.binding.getSnapshot().title).toBe('Current selection');
    } finally { release.resolve(); await fixture.close(); }
  });

  it('switches without cancellation, rejects old watch updates, and reopens Pi history after terminal failure', async () => {
    const fixture = await piViewFixture(); const { binding, faux, runtime } = fixture;
    try {
      await binding.initialize(); const first = await runtime.createConversation({ title: 'First' }), second = await runtime.createConversation({ title: 'Second' });
      const started = gate(), release = gate();
      faux.setResponses([async () => { started.resolve(); await release.promise; return fauxAssistantMessage('First answer'); }, fauxAssistantMessage('Second failure', { stopReason: 'error', errorMessage: 'The model is unavailable.' })]);
      await binding.select(String(first.id)); const firstSubmission = (await binding.send('First question'))!; await started.promise;
      await binding.select(String(second.id)); const secondSubmission = (await binding.send('Second question'))!; await secondSubmission.wait(PI_CONTEXT);
      release.resolve(); await firstSubmission.wait(PI_CONTEXT);
      await vi.waitFor(() => expect(latestFailure(binding.getSnapshot().entries)?.errorMessage).toBe('The model is unavailable.'));
      expect(JSON.stringify(binding.getSnapshot().entries)).not.toContain('First answer');
      await binding.select(String(first.id)); expect(JSON.stringify(binding.getSnapshot().entries)).toContain('First answer');
      binding.dispose();
      await fixture.harness.close(PI_CONTEXT);
      const reopened = await fixture.open(); runtime.harness = reopened;
      const firstReopened = await reopened.conversation(first.id, PI_CONTEXT);
      expect(JSON.stringify((await firstReopened!.entries({}, 50, undefined, PI_CONTEXT)).items)).toContain('First answer');
    } finally { await fixture.close(); }
  });

  it('paginates full history independently from the compacted active context and starts a fresh context on restriction', async () => {
    const fixture = await piViewFixture(); const { binding, runtime } = fixture;
    try {
      await binding.initialize(); const conversation = await runtime.createConversation({ title: 'Long history' });
      for (let index = 0; index < 61; index++) await conversation.submit({ type: 'write', entry: { kind: 'fixture', model: [{ role: 'user', content: `Past ${index}`, timestamp: index }] } }, PI_CONTEXT);
      const entries = (await conversation.entries({ order: 'ascending' }, 100, undefined, PI_CONTEXT)).items;
      await conversation.submit({ type: 'write', entry: { kind: 'pi.compaction', head: entries[55].id, model: [{ role: 'user', content: '<summary>Older work</summary>', timestamp: 100 }] } }, PI_CONTEXT);
      await binding.select(String(conversation.id)); expect(binding.getSnapshot().historyNext).toBeDefined();
      expect(JSON.stringify(binding.getSnapshot().entries)).not.toContain('Past 0"');
      await binding.loadOlder(); expect(JSON.stringify(binding.getSnapshot().entries)).toContain('Past 0"');
      await binding.changeRead({ mode: 'attachedNotesOnly', attachedNoteIds: [] });
      expect(binding.getSnapshot().conversation?.id).not.toBe(conversation.id); expect(binding.getSnapshot().entries).toEqual([]);
      expect((await runtime.authorityForConversation(conversation.id))?.retired).toBe(true);
    } finally { await fixture.close(); }
  });

  it('uses fresh observation after A→B→A and ignores callbacks already running on the old selection', async () => {
    const fixture = await piViewFixture(); const { binding, runtime, harness } = fixture;
    const acquired = gate(), release = gate();
    try {
      await binding.initialize();
      const first = await runtime.createConversation({ title: 'First' }), second = await runtime.createConversation({ title: 'Second' });
      const watchDoc = harness.watchDoc.bind(harness);
      let titleWatch: Awaited<ReturnType<typeof harness.watchDoc>>;
      // Capture the actual title listener: a queued native callback may outlive cancellation.
      let lateCallback: Parameters<NonNullable<typeof titleWatch>['start']>[0] | undefined;
      vi.spyOn(harness, 'watchDoc').mockImplementationOnce(async (...args) => {
        titleWatch = await watchDoc(...args);
        const start = titleWatch!.start.bind(titleWatch);
        vi.spyOn(titleWatch!, 'start').mockImplementation(listener => { lateCallback = listener; start(listener); });
        return titleWatch;
      });
      await binding.select(String(first.id));
      const authority = runtime.authorityForConversation.bind(runtime);
      vi.spyOn(runtime, 'authorityForConversation').mockImplementationOnce(async id => { acquired.resolve(); await release.promise; return authority(id); });
      const stale = lateCallback!({ ...titleWatch!.value!, title: 'Old callback', retired: true }, [], PI_CONTEXT); await acquired.promise;
      await binding.select(String(second.id)); await binding.select(String(first.id));
      release.resolve(); await stale;
      expect(binding.getSnapshot().title).toBe('First');
      await binding.rename('Fresh title');
      await vi.waitFor(() => expect(binding.getSnapshot().title).toBe('Fresh title'));
      expect(binding.getSnapshot().model).toBe('fixture');
      expect(binding.getSnapshot().error).toBeNull();
    } finally { release.resolve(); await fixture.close(); }
  });

  it('cancels a watch attached late during disposal and leaves a fresh mounted binding usable', async () => {
    const fixture = await piViewFixture(); const acquired = gate(), release = gate();
    const watchDoc = fixture.harness.watchDoc.bind(fixture.harness);
    let lateWatch: Awaited<ReturnType<typeof fixture.harness.watchDoc>>;
    try {
      await fixture.binding.initialize(); const conversation = await fixture.runtime.createConversation();
      vi.spyOn(fixture.harness, 'watchDoc').mockImplementationOnce(async (...args) => {
        lateWatch = await watchDoc(...args); acquired.resolve(); await release.promise; return lateWatch;
      });
      const selection = fixture.binding.select(String(conversation.id)); await acquired.promise;
      fixture.binding.dispose(); release.resolve(); await selection;
      expect((await lateWatch!.closed).reason).toBe('cancelled');
      expect(fixture.binding.getSnapshot().conversation).toBeNull();
      const remount = createPiConversationView({ open: async () => fixture.runtime as unknown as PiChat, settings: async () => fixtureSettings, observeAuthority: async () => () => {} });
      try { await remount.initialize(String(conversation.id)); expect(remount.getSnapshot().conversation?.id).toBe(conversation.id); }
      finally { remount.dispose(); }
    } finally { release.resolve(); await fixture.close(); }
  });

  it('cancels successful sibling watches when another selection acquisition fails', async () => {
    const fixture = await piViewFixture(); const acquired = gate();
    const { binding, runtime, harness } = fixture;
    let liveWatch: Awaited<ReturnType<Awaited<ReturnType<typeof runtime.createConversation>>['watch']>> | undefined;
    let titleWatch: Awaited<ReturnType<typeof harness.watchDoc>>;
    try {
      await binding.initialize(); const conversation = await runtime.createConversation();
      vi.spyOn(harness, 'conversation').mockResolvedValueOnce(conversation);
      const watch = conversation.watch.bind(conversation), watchDoc = harness.watchDoc.bind(harness);
      vi.spyOn(conversation, 'watch').mockImplementationOnce(async context => { liveWatch = await watch(context); acquired.resolve(); return liveWatch; });
      vi.spyOn(harness, 'watchDoc').mockImplementationOnce(async (...args) => { titleWatch = await watchDoc(...args); return titleWatch; });
      vi.spyOn(conversation, 'entries').mockImplementationOnce(async () => { await acquired.promise; throw new Error('Page unavailable'); });
      await binding.select(String(conversation.id));
      expect((await liveWatch!.closed).reason).toBe('cancelled');
      expect((await titleWatch!.closed).reason).toBe('cancelled');
      expect(binding.getSnapshot()).toMatchObject({ loading: false, error: 'Chat updates are unavailable. Restart the app to reconnect.' });
      await binding.select(String(conversation.id)); expect(binding.getSnapshot().conversation?.id).toBe(conversation.id);
      expect(binding.getSnapshot().error).toBeNull();
    } finally { await fixture.close(); }
  });

  it('does not bind stale native authority or publish late initial pages after switching', async () => {
    const fixture = await piViewFixture(); const authorityRead = gate(), releaseAuthority = gate(), pageRead = gate(), releasePage = gate();
    const { binding, runtime, harness } = fixture;
    try {
      await binding.initialize(); const first = await runtime.createConversation({ title: 'First' }), second = await runtime.createConversation({ title: 'Second' });
      const bind = vi.spyOn(runtime, 'bindConversation');
      vi.spyOn(runtime, 'authorityForConversation').mockImplementationOnce(async () => { authorityRead.resolve(); await releaseAuthority.promise; return undefined; });
      const staleAuthority = binding.select(String(first.id)); await authorityRead.promise;
      await binding.select(String(second.id)); releaseAuthority.resolve(); await staleAuthority;
      expect(bind).not.toHaveBeenCalled(); expect(binding.getSnapshot().title).toBe('Second');
      vi.spyOn(harness, 'conversation').mockResolvedValueOnce(first);
      const entries = first.entries.bind(first);
      vi.spyOn(first, 'entries').mockImplementationOnce(async (...args) => { const page = await entries(...args); pageRead.resolve(); await releasePage.promise; return page; });
      const stalePage = binding.select(String(first.id)); await pageRead.promise;
      await binding.select(String(second.id)); releasePage.resolve(); await stalePage;
      expect(binding.getSnapshot()).toMatchObject({ title: 'Second', error: null, loading: false });
    } finally { releaseAuthority.resolve(); releasePage.resolve(); await fixture.close(); }
  });

  it('ignores an older immutable page that completes after another conversation is selected', async () => {
    const fixture = await piViewFixture(); const acquired = gate(), release = gate();
    const { binding, runtime, harness } = fixture;
    try {
      await binding.initialize(); const first = await runtime.createConversation({ title: 'First' }), second = await runtime.createConversation({ title: 'Second' });
      for (let index = 0; index < 51; index++) await first.submit({ type: 'write', entry: { kind: 'fixture', model: [{ role: 'user', content: `First past ${index}`, timestamp: index }] } }, PI_CONTEXT);
      vi.spyOn(harness, 'conversation').mockResolvedValueOnce(first);
      await binding.select(String(first.id));
      const entries = first.entries.bind(first);
      let signal: AbortSignal | undefined;
      vi.spyOn(first, 'entries').mockImplementationOnce(async (...args) => { signal = args[3].abortSignal; const page = await entries(...args); acquired.resolve(); await release.promise; return page; });
      const older = binding.loadOlder(); await acquired.promise;
      await binding.select(String(second.id)); release.resolve(); await older;
      expect(signal?.aborted).toBe(true);
      expect(binding.getSnapshot().title).toBe('Second'); expect(JSON.stringify(binding.getSnapshot().entries)).not.toContain('First past');
      expect(binding.getSnapshot().error).toBeNull();
    } finally { release.resolve(); await fixture.close(); }
  });

  it('reports Harness observation failure safely and releases the selection', async () => {
    const fixture = await piViewFixture();
    try {
      await fixture.binding.initialize(); const conversation = await fixture.runtime.createConversation(); await fixture.binding.select(String(conversation.id));
      vi.spyOn(fixture.storage, 'commit').mockRejectedValueOnce(new Error('secret provider content /private/notes'));
      await expect(fixture.binding.rename('Fail')).rejects.toThrow();
      await vi.waitFor(() => expect(fixture.binding.getSnapshot().error).toBe('Conversation updates stopped. Restart the app to reconnect.'));
      expect(fixture.binding.getSnapshot().error).not.toContain('secret');
      await fixture.harness.closed;
      expect(fixture.binding.getSnapshot().runtimeState).toBe('failed');
      const submit = vi.spyOn(conversation, 'submit'), register = vi.spyOn(fixture.runtime.models, 'registerModel');
      await expect(fixture.binding.send('Retain this draft')).rejects.toThrow('Chat is unavailable. Restart the app to reconnect.');
      await expect(fixture.binding.configure('local', 'fixture')).rejects.toThrow('Chat is unavailable. Restart the app to reconnect.');
      expect(submit).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled();
      const retire = vi.spyOn(fixture.runtime, 'retireConversation');
      await expect(fixture.binding.changeRead({ mode: 'attachedNotesOnly', attachedNoteIds: [] })).rejects.toThrow('Chat is unavailable.');
      await expect(fixture.binding.rename('No write')).rejects.toThrow('Chat is unavailable.');
      await expect(fixture.binding.loadOlder()).rejects.toThrow('Chat is unavailable.');
      await expect(fixture.binding.newAttempt()).rejects.toThrow('Chat is unavailable.');
      expect(retire).not.toHaveBeenCalled();
      fixture.binding.report(new Error('secret failed owner'));
      expect(fixture.binding.getSnapshot().error).toBe('Chat is unavailable. Restart the app to reconnect.');
      let notices = '';
      const stop = fixture.runtime.diagnostics.subscribe(value => { notices = JSON.stringify(value); }); stop();
      expect(notices).toContain('runtime_failed'); expect(notices).not.toContain('secret');
    } finally { await fixture.close(); }
  });

  it('refuses new admission when the runtime is closing or closed', async () => {
    for (const ending of ['closing', 'closed'] as const) {
      const fixture = await piViewFixture();
      try {
        await fixture.binding.initialize();
        if (ending === 'closing') fixture.runtime.diagnostics.beginClose();
        else await fixture.harness.close(PI_CONTEXT);
        expect(fixture.binding.getSnapshot().runtimeState).toBe(ending);
        const create = vi.spyOn(fixture.runtime, 'createConversation');
        await expect(fixture.binding.send('Keep my text')).rejects.toThrow('Chat is unavailable. Restart the app to reconnect.');
        await expect(fixture.binding.configure('local', 'fixture')).rejects.toThrow('Chat is unavailable. Restart the app to reconnect.');
        expect(create).not.toHaveBeenCalled();
      } finally { await fixture.close(); }
    }
  });

  it('keeps a submitted run alive after disposal but actual authority retirement aborts it', async () => {
    const fixture = await piViewFixture(); const started = gate();
    try {
      await fixture.binding.initialize();
      fixture.faux.setResponses([async (_request, options) => { started.resolve(); await untilAborted(options?.signal); return fauxAssistantMessage('Retired', { stopReason: 'aborted' }); }]);
      const submission = (await fixture.binding.send('Keep working'))!; await started.promise;
      const conversation = fixture.binding.getSnapshot().conversation!;
      fixture.binding.dispose();
      expect((await submission.status(PI_CONTEXT)).status).not.toBe('unanswered');
      await fixture.runtime.retireConversation(conversation.id);
      expect((await submission.wait(PI_CONTEXT)).status).toBe('unanswered');
      expect((await fixture.runtime.authorityForConversation(conversation.id))?.retired).toBe(true);
    } finally { await fixture.close(); }
  });

  it.each([['watch', 'message'], ['watch', 'getter'], ['page', 'message'], ['page', 'getter']] as const)('sanitizes hostile %s acquisition errors with %s canaries', async (failed, shape) => {
    const fixture = await piViewFixture();
    const getter = vi.fn(() => { throw new Error('SECRET getter'); });
    const hostile = shape === 'getter' ? Object.defineProperty({ body: 'SECRET body', path: '/SECRET/path' }, 'message', { get: getter }) : new Error('SECRET prompt/provider body /SECRET/path');
    try {
      await fixture.binding.initialize();
      const conversation = await fixture.runtime.createConversation();
      vi.spyOn(fixture.harness, 'conversation').mockResolvedValueOnce(conversation);
      if (failed === 'watch') vi.spyOn(conversation, 'watch').mockRejectedValueOnce(hostile);
      else vi.spyOn(conversation, 'entries').mockRejectedValueOnce(hostile);
      await fixture.binding.select(String(conversation.id));
      expect(fixture.binding.getSnapshot().error).toBe('Chat updates are unavailable. Restart the app to reconnect.');
      expect(getter).not.toHaveBeenCalled();
      expect(JSON.stringify(fixture.runtime.diagnostics)).not.toContain('SECRET');
      let notice: unknown;
      const stop = fixture.runtime.diagnostics.subscribe(value => { notice = value; }); stop();
      expect(JSON.stringify(notice)).not.toContain('SECRET');
      expect(notice).toMatchObject({ state: 'open', notices: [{ code: 'runtime_report' }] });
    } finally { await fixture.close(); }
  });

});
