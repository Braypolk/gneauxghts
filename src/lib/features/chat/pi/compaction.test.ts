import { afterEach, describe, expect, it } from 'vitest';
import {
  Harness, MemoryStorage, createRegistry, LiveDoc, ProviderDoc, UsageDoc,
  type CompactionPolicy, type HarnessSettings, type ContextView,
} from '@earendil-works/pi-durable';
import { createModels, type TranscriptContext } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseFactory } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { modelLimits } from './modelLimits';

const openHarnesses = new Set<Harness>();
afterEach(async () => {
  await Promise.all([...openHarnesses].map(harness => harness.close(context)));
  openHarnesses.clear();
});
const fixturePolicy: CompactionPolicy = {
  enabled: true, reserveTokens: 512, keepRecentTokens: 512, backgroundTokens: 0,
};
const text = (value: unknown) => JSON.stringify(value);
const user = (content: string) => ({ role: 'user' as const, content, timestamp: 1 });
const signalGate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
function aborted(signal: AbortSignal | undefined): Promise<void> {
  if (!signal || signal.aborted) return Promise.resolve();
  return new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
}
async function setup(options: { contextWindow?: number; policy?: Partial<CompactionPolicy>; retry?: HarnessSettings['retry'] } = {}) {
  const models = createModels();
  const faux = fauxProvider({ provider: 'local', models: [{ id: 'observed-model', contextWindow: options.contextWindow ?? 4096, maxTokens: 0 }] });
  models.setProvider(faux.provider);
  const storage = new MemoryStorage();
  // Keep committed state across handle close, modelling reopening a durable store.
  storage.close = async () => {};
  const settings = { compaction: { ...fixturePolicy, ...options.policy }, retry: options.retry ?? { enabled: false } };
  const open = async () => {
    const harness = await Harness.open(storage, { registry: createRegistry(), models, settings }, context);
    openHarnesses.add(harness);
    return harness;
  };
  const harness = await open();
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'local', modelId: 'observed-model' } } }, context);
  for (let index = 0; index < 6; index++) {
    await conversation.submit({ type: 'write', entry: { kind: 'dialogue', model: [user(`OLD_QUESTION_${index} ${'old context '.repeat(130)}`)] } }, context);
    await conversation.submit({ type: 'write', entry: { kind: 'dialogue', model: [fauxAssistantMessage(`OLD_ANSWER_${index} ${'old answer '.repeat(130)}`)] } }, context);
  }
  // The retained tool result must never be separated from its assistant call.
  await conversation.submit({ type: 'write', entry: { kind: 'dialogue', model: [fauxAssistantMessage(fauxToolCall('read_note', { noteId: 'recent-note' }, { id: 'recent-read' }), { stopReason: 'toolUse' })] } }, context);
  await conversation.submit({ type: 'write', entry: { kind: 'dialogue', model: [{ role: 'toolResult', toolCallId: 'recent-read', toolName: 'read_note', content: [{ type: 'text', text: `RECENT_TOOL_DATA ${'keep this '.repeat(120)}` }], isError: false, timestamp: 2 }] } }, context);
  return { harness, conversation, faux, storage, open };
}
async function close(harness: Harness) {
  await harness.close(context);
  openHarnesses.delete(harness);
}
function expectCompacted(view: ContextView, request: TranscriptContext) {
  expect(view.head?.kind).toBe('pi.compaction');
  expect(text(request.messages)).toContain('<summary>');
  expect(text(request.messages)).toContain('recent-read');
  expect(text(request.messages)).toContain('RECENT_TOOL_DATA');
  expect(text(request.messages)).not.toContain('OLD_ANSWER_0');
}

describe('Pi model capacity metadata', () => {
  it('keeps unknown context/output limits independent', () => {
    expect(modelLimits({ contextWindow: 129280, maxTokens: null })).toEqual({ contextWindow: 129280, maxTokens: 0 });
    expect(modelLimits({ contextWindow: null, maxTokens: 4096 })).toEqual({ contextWindow: 0, maxTokens: 4096 });
    for (const invalid of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(modelLimits({ contextWindow: invalid, maxTokens: invalid })).toEqual({ contextWindow: 0, maxTokens: 0 });
    }
  });
});

describe('standard Pi compaction', () => {
  it('reduces the actual blocking continuation request while retaining recent tool groups and full history', async () => {
    const { harness, conversation, faux } = await setup();
    const before = text((await conversation.context(context)).messages).length;
    const sessions: string[] = [];
    faux.setResponses([
      (request, options) => {
        sessions.push(options!.sessionId!);
        expect(request.messages).toHaveLength(2);
        expect(text(request)).toContain('OLD_QUESTION_0');
        expect(options?.maxTokens).toBe(Math.floor(0.8 * fixturePolicy.reserveTokens));
        return fauxAssistantMessage('## Goal\nContinue the requested work.\n## Critical Context\nOlder work completed.');
      },
      async (request, options) => {
        sessions.push(options!.sessionId!);
        expectCompacted(await conversation.context(context), request);
        expect(text(request)).toContain('CONTINUE_NOW');
        expect(text(request.messages).length).toBeLessThan(before / 2);
        return fauxAssistantMessage([{ type: 'thinking', thinking: 'Retained ordinary reasoning.' }, { type: 'text', text: 'Completed continuation.' }]);
      },
    ]);
    expect((await (await conversation.submit({ type: 'input', content: 'CONTINUE_NOW' }, context)).wait(context)).status).toBe('done');
    expect(sessions[0]).toBe(sessions[1]);
    expect(sessions[0]).toBe((await harness.snapshot(ProviderDoc, conversation.id, context))?.sessionId);
    const history = await conversation.entries({ order: 'ascending' }, 100, undefined, context);
    expect(text(history.items)).toContain('OLD_ANSWER_0');
    expect(text(history.items)).toContain('Retained ordinary reasoning.');
    expect(faux.state.callCount).toBe(2);
  });

  it('places background summary at a boundary and uses it in the next request', async () => {
    const { harness, conversation, faux } = await setup({ contextWindow: 10000, policy: { backgroundTokens: 7000 } });
    const summaryStarted = signalGate(), release = signalGate();
    const response: FauxResponseFactory = async (request, options) => {
      if (text(request).includes('context summarization assistant')) {
        summaryStarted.resolve();
        await Promise.race([release.promise, aborted(options?.signal)]);
        return fauxAssistantMessage('## Goal\nKeep the ongoing work.');
      }
      return fauxAssistantMessage('Ordinary answer while summary runs.');
    };
    faux.setResponses([response, response]);
    const submission = await conversation.submit({ type: 'input', content: 'First continuation' }, context);
    await summaryStarted.promise;
    const status = (await harness.snapshot(LiveDoc, conversation.id, context))!.compactions![0];
    expect(status).toMatchObject({ reason: 'threshold', blocking: false, attempt: 1 });
    expect((await submission.wait(context)).status).toBe('done');
    release.resolve();
    expect((await harness.waitForTask(status.taskId, context)).state.outcome.status).toBe('completed');
    faux.appendResponses([async request => {
      expectCompacted(await conversation.context(context), request);
      return fauxAssistantMessage('Continued from the installed summary.');
    }]);
    expect((await (await conversation.submit({ type: 'input', content: 'Continue again' }, context)).wait(context)).status).toBe('done');
  });

  it('retains an explicit background failure while ordinary generation completes', async () => {
    const { harness, conversation, faux } = await setup({ contextWindow: 10000, policy: { backgroundTokens: 7000 } });
    const started = signalGate(), release = signalGate();
    const response: FauxResponseFactory = async (request, options) => {
      if (text(request).includes('context summarization assistant')) {
        started.resolve();
        await Promise.race([release.promise, aborted(options?.signal)]);
        return fauxAssistantMessage('Incomplete summary', { stopReason: 'length' });
      }
      return fauxAssistantMessage('Ordinary answer survives background failure.');
    };
    faux.setResponses([response, response]);
    const submission = await conversation.submit({ type: 'input', content: 'Continue while summarizing' }, context);
    await started.promise;
    const task = (await harness.snapshot(LiveDoc, conversation.id, context))!.compactions![0].taskId;
    expect((await submission.wait(context)).status).toBe('done');
    release.resolve();
    expect((await harness.waitForTask(task, context)).state.outcome.status).toBe('failed');
    expect((await conversation.context(context)).head).toBeUndefined();
    expect((await harness.snapshot(LiveDoc, conversation.id, context))?.compactionFailure).toMatchObject({ taskId: task, reason: 'threshold' });
    expect(faux.state.callCount).toBe(2);
  });

  it('uses overflow recovery with unknown capacity and fails a repeated overflow without a loop', async () => {
    const { conversation, faux } = await setup({ contextWindow: 0 });
    const overflow = fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Your input exceeds the context window of this model' });
    faux.setResponses([
      request => { expect(text(request)).not.toContain('<summary>'); return overflow; },
      fauxAssistantMessage('## Goal\nRecover from overflow.'),
      async request => { expectCompacted(await conversation.context(context), request); return overflow; },
    ]);
    const result = await (await conversation.submit({ type: 'input', content: 'Try this request' }, context)).wait(context);
    expect(result.status).toBe('unanswered');
    expect(faux.state.callCount).toBe(3);
    expect(faux.getPendingResponseCount()).toBe(0);
  });

  it('does not invent a threshold when capacity is unknown', async () => {
    const { conversation, faux } = await setup({ contextWindow: 0 });
    faux.setResponses([request => { expect(text(request)).toContain('OLD_ANSWER_0'); return fauxAssistantMessage('Ordinary request accepted.'); }]);
    expect((await (await conversation.submit({ type: 'input', content: 'Continue' }, context)).wait(context)).status).toBe('done');
    expect((await conversation.context(context)).head).toBeUndefined();
    expect(faux.state.callCount).toBe(1);
  });

  it.each([
    ['length', fauxAssistantMessage('Incomplete summary', { stopReason: 'length' })],
    ['empty', fauxAssistantMessage('')],
    ['tool call', fauxAssistantMessage(fauxToolCall('read_note', {}), { stopReason: 'toolUse' })],
    ['nonretryable error', fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Invalid request' })],
  ])('stops a blocking generation after %s summary failure with original context intact', async (_label, response) => {
    const { harness, conversation, faux } = await setup();
    faux.setResponses([response]);
    const result = await (await conversation.submit({ type: 'input', content: 'Continue' }, context)).wait(context);
    expect(result.status).toBe('unanswered');
    expect((await conversation.context(context)).head).toBeUndefined();
    expect(text((await conversation.context(context)).messages)).toContain('OLD_ANSWER_0');
    expect((await harness.snapshot(LiveDoc, conversation.id, context))?.compactionFailure?.reason).toBe('threshold');
    expect(faux.state.callCount).toBe(1);
  });

  it('bounds summary retries and accounts every summary attempt once in the standard usage owner', async () => {
    const { harness, conversation, faux } = await setup({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 } });
    const failure = fauxAssistantMessage('attempt', { stopReason: 'error', errorMessage: '503 service unavailable' });
    faux.setResponses([failure, failure]);
    expect((await (await conversation.submit({ type: 'input', content: 'Continue' }, context)).wait(context)).status).toBe('unanswered');
    expect(faux.state.callCount).toBe(2);
    const usage = (await harness.snapshot(UsageDoc, conversation.id, context))!.models['local/observed-model'];
    expect(usage.output).toBe(4); // Two outputs, each ceil('attempt'.length / 4).
    expect((await harness.usage(context)).models['local/observed-model']).toEqual(usage);
    await conversation.waitForIdle(context);
    expect((await harness.snapshot(UsageDoc, conversation.id, context))!.models['local/observed-model']).toEqual(usage);
  });

  it.each([false, true])('stops %s background compaction and keeps it stopped across reopen', async background => {
    const fixture = await setup(background ? { contextWindow: 10000, policy: { backgroundTokens: 7000 } } : {});
    const { harness, conversation, faux, open } = fixture;
    const started = signalGate();
    const response: FauxResponseFactory = async (request, options) => {
      if (text(request).includes('context summarization assistant')) {
        started.resolve();
        await aborted(options?.signal);
        return fauxAssistantMessage('Late summary must not install.');
      }
      return fauxAssistantMessage('Ordinary answer.');
    };
    faux.setResponses([response, response]);
    const submission = await conversation.submit({ type: 'input', content: 'Stop during summary' }, context);
    await started.promise;
    const task = (await harness.snapshot(LiveDoc, conversation.id, context))!.compactions![0].taskId;
    await conversation.abort(context, { background: true });
    expect((await harness.waitForTask(task, context)).state.outcome.status).toBe('aborted');
    await submission.wait(context);
    expect((await conversation.context(context)).head).toBeUndefined();
    const calls = faux.state.callCount;
    await close(harness);
    const reopened = await open();
    reopened.resume();
    await reopened.waitForIdle(context);
    expect((await reopened.getTask(task, context))!.state).toMatchObject({ status: 'terminal', outcome: { status: 'aborted' } });
    expect(faux.state.callCount).toBe(calls);
  });

  it('resumes the committed standard summary checkpoint after close without duplicating placement or usage', async () => {
    const { harness, conversation, faux, open } = await setup();
    const started = signalGate();
    faux.setResponses([async (_request, options) => {
      started.resolve();
      await aborted(options?.signal);
      return fauxAssistantMessage('Interrupted summary.');
    }]);
    const submission = await conversation.submit({ type: 'input', content: 'Resume this request' }, context);
    await started.promise;
    const task = (await harness.snapshot(LiveDoc, conversation.id, context))!.compactions![0].taskId;
    await close(harness);
    faux.setResponses([fauxAssistantMessage('## Goal\nRecovered standard checkpoint.'), fauxAssistantMessage('Recovered answer.')]);
    const reopened = await open();
    const restored = (await reopened.conversation(conversation.id, context))!;
    expect((await reopened.inspect(context)).scheduling).toBe('paused');
    reopened.resume();
    const record = await (await reopened.submission(submission.id, context))!.wait(context);
    expect(record.status).toBe('done');
    expect((await reopened.waitForTask(task, context)).state.outcome.status).toBe('completed');
    const entries = (await restored.entries({ order: 'ascending' }, 100, undefined, context)).items;
    expect(entries.filter(entry => entry.kind === 'pi.compaction')).toHaveLength(1);
    const usage = (await reopened.snapshot(UsageDoc, conversation.id, context))!.models['local/observed-model'];
    const answerUsage = entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'assistant').reduce((sum, message) => sum + message.usage.output, 0);
    expect(usage.output).toBe(answerUsage + Math.ceil('## Goal\nRecovered standard checkpoint.'.length / 4));
    expect(text(await restored.context(context))).not.toContain('Interrupted summary.');
  });
});
