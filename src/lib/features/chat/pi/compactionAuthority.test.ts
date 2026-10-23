import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Harness, MemoryStorage, ProviderDoc, createRegistry, type HarnessSettings } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { admitProviderMessage } from './citations';
import { createNativeModels, DEFAULT_GENERATION_MAX_TOKENS, type NativeBinding } from './nativeProvider';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: native.invoke,
  Channel: class { onmessage: (value: unknown) => void = () => {}; },
}));
const harnesses = new Set<Harness>();
afterEach(async () => {
  await Promise.all([...harnesses].map(harness => harness.close(context)));
  harnesses.clear();
});
let retired: boolean;
let retireOnDelivery: boolean;
let requestedBodies: Array<Record<string, unknown>>;
let failures: Array<{ code: string; message: string; status?: number }>;
let capacities: Array<number | null>;
let configurationDelay: Promise<void> | undefined;
let configurationReads: number;
let configurationFailure: boolean;
let reasoningWireEffort: string | null;
const PRIVATE_SERVER_ECHO = 'SECRET_PROVIDER_ECHO_api-key-private-note';
beforeEach(() => {
  native.invoke.mockReset();
  retired = false;
  retireOnDelivery = false;
  requestedBodies = [];
  failures = [];
  capacities = [129280];
  configurationDelay = undefined;
  configurationReads = 0;
  configurationFailure = false;
  reasoningWireEffort = null;
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'pi_chat_model_configuration') {
      configurationReads++;
      const capacity = capacities.length > 1 ? capacities.shift()! : capacities[0];
      if (configurationReads > 1) {
        await configurationDelay;
        if (configurationFailure) throw new Error('Metadata discovery unavailable');
      }
      return {
        provider: 'local', model: 'loaded-model', contextWindow: capacity, maxTokens: null,
        images: false, tools: true, reasoningEffort: reasoningWireEffort ?? 'off', reasoningWireEffort,
      };
    }
    if (command === 'pi_chat_validate_authority') {
      if (retired) throw new Error('Authority retired');
      return;
    }
    if (command === 'pi_chat_admit_answer') {
      if (retired) throw new Error('Authority retired');
      return args.answers.map((answer: { segments: { text: string }[] }) => answer.segments.map(segment => segment.text).join(''));
    }
    if (command === 'pi_chat_fetch') {
      requestedBodies.push(JSON.parse(args.body));
      const failure = failures.shift();
      if (failure) {
        // Native HTTP failures retain status with sanitized JSON error frames.
        // Adversarial message text also verifies parser redaction before storage.
        if (failure.status) {
          args.frames.onmessage({ type: 'headers', status: failure.status, content_type: 'application/json' });
          args.frames.onmessage({ type: 'chunk', bytes: [...new TextEncoder().encode(JSON.stringify({ error: { code: failure.code, message: failure.message } }))] });
          args.frames.onmessage({ type: 'done' });
          return;
        }
        // Authority/protocol failures reject with their native typed category.
        throw failure;
      }
      const chunk = (value: unknown) => args.frames.onmessage({ type: 'chunk', bytes: [...new TextEncoder().encode(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`)] });
      args.frames.onmessage({ type: 'headers', status: 200, content_type: 'text/event-stream' });
      chunk({ id: 'summary-response', object: 'chat.completion.chunk', model: 'loaded-model', choices: [{ index: 0, delta: { role: 'assistant', content: '## Goal\nOrdinary standard summary.' }, finish_reason: null }] });
      if (retireOnDelivery) retired = true;
      chunk({ id: 'summary-response', object: 'chat.completion.chunk', model: 'loaded-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      chunk('[DONE]');
      args.frames.onmessage({ type: 'done' });
      return;
    }
    if (command === 'pi_chat_cancel_fetch') return;
    throw new Error(`Unexpected command ${command}`);
  });
});
async function setup(options: { retry?: HarnessSettings['retry'] } = {}) {
  const bindings = new Map<string, NativeBinding>();
  const models = createNativeModels(bindings, admitProviderMessage);
  await models.registerModel('local', 'loaded-model');
  const storage = new MemoryStorage();
  storage.close = async () => {};
  const open = async () => {
    const harness = await Harness.open(storage, {
      registry: createRegistry(), models,
      settings: { compaction: { keepRecentTokens: 64, reserveTokens: 1024 }, retry: options.retry ?? { enabled: false } },
    }, context);
    harnesses.add(harness);
    return harness;
  };
  const harness = await open();
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'local', modelId: 'loaded-model' } } }, context);
  const provider = (await harness.snapshot(ProviderDoc, conversation.id, context))!;
  const binding = { conversationId: conversation.id, providerSessionId: provider.sessionId, authorityId: 'native-authority' };
  bindings.set(provider.sessionId, binding);
  for (let index = 0; index < 4; index++) await conversation.submit({ type: 'write', entry: { kind: 'dialogue', model: [{ role: 'user', content: `Question ${index} ${'detail '.repeat(100)}`, timestamp: 1 }] } }, context);
  return { harness, conversation, binding, bindings, models, storage, open };
}

describe('standard compaction through the mandatory native provider', () => {
  it('uses the same advertised reasoning mapping for generation, overflow recovery, summary and continuation', async () => {
    reasoningWireEffort = 'deep';
    const { conversation } = await setup();
    failures = [{ code: 'provider_context_overflow', status: 400, message: 'prompt is too long' }];
    expect((await (await conversation.submit({ type: 'input', content: 'Continue through standard recovery' }, context)).wait(context)).status).toBe('done');
    expect(requestedBodies).toHaveLength(3);
    expect(JSON.stringify(requestedBodies[1])).toContain('context summarization assistant');
    expect(JSON.stringify(requestedBodies[2])).toContain('<summary>');
    for (const body of requestedBodies) expect(body.reasoning_effort).toBe('deep');
  });

  it('uses the real Pi AI parser and standard Markdown summary with persisted native session routing', async () => {
    const { harness, conversation, binding } = await setup();
    const task = await conversation.compact(undefined, context);
    expect((await harness.waitForTask(task, context)).state.outcome.status).toBe('completed');
    expect(JSON.stringify((await conversation.context(context)).head)).toContain('Ordinary standard summary.');
    expect(requestedBodies).toHaveLength(1);
    expect((requestedBodies[0].max_tokens ?? requestedBodies[0].max_completion_tokens)).toBe(Math.floor(0.8 * 1024));
    expect(JSON.stringify(requestedBodies[0])).toContain('context summarization assistant');
    const fetchCall = native.invoke.mock.calls.find(([command]) => command === 'pi_chat_fetch')!;
    expect(fetchCall[1]).toMatchObject(binding);
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_validate_authority')).toHaveLength(1);
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_admit_answer')).toHaveLength(1);
  });

  it('keeps unknown model output capacity honest while supplying an ordinary request allowance', async () => {
    const { models, binding } = await setup();
    const model = models.getModel('local', 'loaded-model')!;
    expect(model.maxTokens).toBe(0);
    const message = await models.completeSimple(model, { messages: [{ role: 'user', content: 'Answer normally', timestamp: 1 }] }, { sessionId: binding.providerSessionId });
    expect(message.stopReason).toBe('stop');
    expect(requestedBodies[0].max_tokens ?? requestedBodies[0].max_completion_tokens).toBe(DEFAULT_GENERATION_MAX_TOKENS);
    expect(DEFAULT_GENERATION_MAX_TOKENS).toBeGreaterThan(1);
  });

  it('refreshes local capacity after successful responses and preserves catalog object identity', async () => {
    capacities = [null, 129280];
    let release!: () => void;
    configurationDelay = new Promise<void>(done => { release = done; });
    const { conversation, models, binding } = await setup();
    const original = models.getModel('local', 'loaded-model')!;
    expect(original.contextWindow).toBe(0);
    const received: string[] = [];
    const stream = models.streamSimple(original, { messages: [{ role: 'user', content: 'Load the model', timestamp: 1 }] }, { sessionId: binding.providerSessionId });
    const finished = (async () => { for await (const event of stream) received.push(event.type); })();
    await vi.waitFor(() => { expect(configurationReads).toBe(2); });
    expect(received).toContain('text_delta');
    expect(received).not.toContain('done');
    expect(original.contextWindow).toBe(0); // Observation remains pending, never invented.
    release();
    await finished;
    expect(received.at(-1)).toBe('done');
    expect(models.getModel('local', 'loaded-model')).toBe(original);
    expect(original.contextWindow).toBe(129280);
    expect(original.maxTokens).toBe(0);
    expect((await (await conversation.submit({ type: 'input', content: 'Use the observed model capacity' }, context)).wait(context)).status).toBe('done');
    expect(requestedBodies).toHaveLength(2);
    expect((await (await conversation.submit({ type: 'input', content: 'Continue with refreshed metadata' }, context)).wait(context)).status).toBe('done');
    expect(configurationReads).toBe(4);
  });

  it.each([null, 129280])('refreshes capacity from %s on an already-resolved handle before the next standard compaction decision', async initial => {
    capacities = [initial, 1200];
    const { harness, conversation, models, binding } = await setup();
    const resolved = models.getModel('local', 'loaded-model')!;
    expect(resolved.contextWindow).toBe(initial ?? 0);
    expect((await models.completeSimple(resolved, { messages: [{ role: 'user', content: 'Load', timestamp: 1 }] }, { sessionId: binding.providerSessionId })).stopReason).toBe('stop');
    expect(resolved.contextWindow).toBe(1200);
    expect((await (await conversation.submit({ type: 'input', content: 'Continue with observed capacity' }, context)).wait(context)).status).toBe('done');
    expect(requestedBodies).toHaveLength(3); // Bootstrap inference, threshold summary, continuation.
    expect(JSON.stringify(requestedBodies[1])).toContain('context summarization assistant');
    expect((await conversation.context(context)).head?.data).toMatchObject({ reason: 'threshold' });
    expect(configurationReads).toBe(4);
    expect(models.getModel('local', 'loaded-model')).toBe(resolved);
    await harness.waitForIdle(context);
  });

  it('rejects terminal delivery when authority retires during initial capacity discovery', async () => {
    capacities = [null, 129280];
    let release!: () => void;
    configurationDelay = new Promise<void>(done => { release = done; });
    const { models, binding } = await setup();
    const model = models.getModel('local', 'loaded-model')!;
    const received: string[] = [];
    const stream = models.streamSimple(model, { messages: [{ role: 'user', content: 'Retire during discovery', timestamp: 1 }] }, { sessionId: binding.providerSessionId });
    const finished = (async () => { for await (const event of stream) received.push(event.type); })();
    await vi.waitFor(() => { expect(configurationReads).toBe(2); });
    expect(received).toContain('text_delta');
    expect(received).not.toContain('done');
    retired = true;
    release();
    await finished;
    expect(received.at(-1)).toBe('error');
    expect(received).not.toContain('done');
    expect((await stream.result()).stopReason).toBe('error');
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_validate_authority')).toHaveLength(1);
    expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_admit_answer')).toHaveLength(1);
  });

  it('keeps unavailable capacity unknown and checks again after the next successful inference', async () => {
    capacities = [null, null];
    const { conversation, models } = await setup();
    expect((await (await conversation.submit({ type: 'input', content: 'First request' }, context)).wait(context)).status).toBe('done');
    expect((await (await conversation.submit({ type: 'input', content: 'Second request' }, context)).wait(context)).status).toBe('done');
    expect(models.getModel('local', 'loaded-model')?.contextWindow).toBe(0);
    expect(configurationReads).toBe(3);
    expect(requestedBodies).toHaveLength(2);
  });

  it('keeps a valid answer when the bounded post-inference metadata observation fails', async () => {
    capacities = [null];
    configurationFailure = true;
    const { conversation, models } = await setup();
    expect((await (await conversation.submit({ type: 'input', content: 'Answer despite unavailable discovery' }, context)).wait(context)).status).toBe('done');
    expect(models.getModel('local', 'loaded-model')?.contextWindow).toBe(0);
    expect((await (await conversation.submit({ type: 'input', content: 'Continue with honest unknown capacity' }, context)).wait(context)).status).toBe('done');
    expect(configurationReads).toBe(3);
    expect(requestedBodies).toHaveLength(2);
  });

  it('reobserves first-inference capacity after explicit settings refresh invalidates an earlier failed observation', async () => {
    capacities = [null];
    configurationFailure = true;
    const { models, binding } = await setup();
    const resolved = models.getModel('local', 'loaded-model')!;
    const complete = () => models.completeSimple(resolved, { messages: [{ role: 'user', content: 'Load', timestamp: 1 }] }, { sessionId: binding.providerSessionId });
    expect((await complete()).stopReason).toBe('stop');
    expect(configurationReads).toBe(2);
    configurationFailure = false;
    capacities = [null, 129280];
    expect(await models.registerModel('local', 'loaded-model')).toBe(resolved);
    expect(resolved.contextWindow).toBe(0);
    expect((await complete()).stopReason).toBe('stop');
    expect(resolved.contextWindow).toBe(129280);
    expect(configurationReads).toBe(4);
  });

  it('automatically compacts an HTTP 400 context-overflow category through the parser and Harness', async () => {
    const { conversation, storage } = await setup();
    failures = [{ code: 'provider_context_overflow', status: 400, message: `HTTP 400 context_length_exceeded ${PRIVATE_SERVER_ECHO}` }];
    const result = await (await conversation.submit({ type: 'input', content: 'Continue after overflow' }, context)).wait(context);
    expect(result.status).toBe('done');
    expect(requestedBodies).toHaveLength(3); // Original request, standard summary, continuation.
    expect(JSON.stringify(requestedBodies[1])).toContain('context summarization assistant');
    expect(JSON.stringify(requestedBodies[2])).toContain('<summary>');
    expect(JSON.stringify(requestedBodies[2])).not.toContain('Question 0');
    expect((await conversation.context(context)).head?.data).toMatchObject({ reason: 'overflow' });
    const retained = await storage.scanEntries({ conversationId: conversation.id }, 100, undefined, context);
    expect(JSON.stringify(retained)).toContain('prompt is too long');
    expect(JSON.stringify(retained)).not.toContain(PRIVATE_SERVER_ECHO);
    expect(JSON.stringify(await storage.scanTasks({}, 100, undefined, context))).not.toContain(PRIVATE_SERVER_ECHO);
  });

  it('retries an HTTP 503 transient category through standard Pi policy without retaining server text', async () => {
    const { conversation, storage } = await setup({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 } });
    failures = [{ code: 'provider_transient', status: 503, message: `HTTP 503 ${PRIVATE_SERVER_ECHO}` }];
    const result = await (await conversation.submit({ type: 'input', content: 'Continue after a transient failure' }, context)).wait(context);
    expect(result.status).toBe('done');
    expect(requestedBodies).toHaveLength(2);
    expect((await conversation.context(context)).head).toBeUndefined();
    const retained = JSON.stringify(await storage.scanEntries({ conversationId: conversation.id }, 100, undefined, context));
    expect(retained).toContain('network error');
    expect(retained).not.toContain(PRIVATE_SERVER_ECHO);
    expect(JSON.stringify(await storage.scanTasks({}, 100, undefined, context))).not.toContain(PRIVATE_SERVER_ECHO);
  });

  it('stops repeated HTTP 503 failures at the configured standard retry limit', async () => {
    const { conversation, storage } = await setup({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 } });
    failures = Array.from({ length: 2 }, () => ({ code: 'provider_transient', status: 503, message: `HTTP 503 ${PRIVATE_SERVER_ECHO}` }));
    expect((await (await conversation.submit({ type: 'input', content: 'Retry only once' }, context)).wait(context)).status).toBe('unanswered');
    expect(requestedBodies).toHaveLength(2);
    expect(JSON.stringify(await storage.scanTasks({}, 100, undefined, context))).not.toContain(PRIVATE_SERVER_ECHO);
  });

  it.each(['provider_limit', 'provider_http'])('keeps %s terminal and safe despite an enabled retry policy', async code => {
    const { conversation, storage } = await setup({ retry: { enabled: true, maxRetries: 2, baseDelayMs: 0 } });
    failures = [{ code, status: 400, message: `HTTP rejection ${PRIVATE_SERVER_ECHO}` }];
    const result = await (await conversation.submit({ type: 'input', content: 'Fail safely' }, context)).wait(context);
    expect(result.status).toBe('unanswered');
    expect(requestedBodies).toHaveLength(1);
    const retained = JSON.stringify(await storage.scanEntries({ conversationId: conversation.id }, 100, undefined, context));
    expect(retained).not.toContain(PRIVATE_SERVER_ECHO);
    expect(retained).toContain(code === 'provider_limit'
      ? 'insufficient_quota: the model account cannot accept this request'
      : 'The model server rejected this request. Check the selected model and its server settings, then retry.');
    expect(JSON.stringify(await storage.scanTasks({}, 100, undefined, context))).not.toContain(PRIVATE_SERVER_ECHO);
  });

  it('keeps a typed native authority failure terminal through the SDK fetch-error wrapper', async () => {
    const { conversation, storage } = await setup({ retry: { enabled: true, maxRetries: 2, baseDelayMs: 0 } });
    failures = [{ code: 'foreign_authority', message: PRIVATE_SERVER_ECHO }];
    expect((await (await conversation.submit({ type: 'input', content: 'Deny this binding' }, context)).wait(context)).status).toBe('unanswered');
    expect(requestedBodies).toHaveLength(1);
    const retained = JSON.stringify(await storage.scanEntries({ conversationId: conversation.id }, 100, undefined, context));
    expect(retained).toContain('Conversation authority is unavailable');
    expect(retained).not.toContain(PRIVATE_SERVER_ECHO);
  });

  it.each(['missing binding', 'retired authority'])('denies %s before any summary network dispatch', async reason => {
    const { harness, conversation, bindings } = await setup();
    if (reason === 'missing binding') bindings.clear(); else retired = true;
    const task = await conversation.compact(undefined, context);
    expect((await harness.waitForTask(task, context)).state.outcome.status).toBe('failed');
    expect(requestedBodies).toHaveLength(0);
    expect((await conversation.context(context)).head).toBeUndefined();
  });

  it('rejects summary terminal delivery after authority retirement', async () => {
    const { harness, conversation } = await setup();
    retireOnDelivery = true;
    const task = await conversation.compact(undefined, context);
    expect((await harness.waitForTask(task, context)).state.outcome.status).toBe('failed');
    expect(requestedBodies).toHaveLength(1);
    expect((await conversation.context(context)).head).toBeUndefined();
  });

  it('denies old summary work after reopen and starts a restricted context without inherited summary', async () => {
    const { harness, conversation, open } = await setup();
    const successful = await conversation.compact(undefined, context);
    expect((await harness.waitForTask(successful, context)).state.outcome.status).toBe('completed');
    for (let index = 0; index < 3; index++) await conversation.submit({ type: 'write', entry: { kind: 'dialogue', model: [{ role: 'user', content: `Later work ${index} ${'retained '.repeat(100)}`, timestamp: 2 }] } }, context);
    await harness.close(context);
    harnesses.delete(harness);
    retired = true;
    const reopened = await open();
    const old = (await reopened.conversation(conversation.id, context))!;
    const denied = await old.compact(undefined, context);
    expect((await reopened.waitForTask(denied, context)).state.outcome.status).toBe('failed');
    expect(requestedBodies).toHaveLength(1);
    const restricted = await reopened.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'local', modelId: 'loaded-model' } } }, context);
    const clean = await restricted.context(context);
    expect(clean.head).toBeUndefined();
    expect(clean.messages).toEqual([]);
    expect((await reopened.snapshot(ProviderDoc, restricted.id, context))?.sessionId).not.toBe((await reopened.snapshot(ProviderDoc, old.id, context))?.sessionId);
  });
});
