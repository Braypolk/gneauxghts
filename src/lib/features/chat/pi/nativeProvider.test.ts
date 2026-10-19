import { beforeEach, expect, it, vi } from 'vitest';
import type { AssistantMessage, Model } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { createNativeModels, DEFAULT_GENERATION_MAX_TOKENS, nativeFetch, type NativeBinding } from './nativeProvider';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, Channel: class { onmessage = (_frame: unknown) => {}; } }));
beforeEach(() => { native.invoke.mockReset(); });

it('keeps streamed ChatGPT plan limits terminal and redacts provider details', async () => {
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'pi_chat_model_configuration') return { contextWindow: null, maxTokens: null, images: true, tools: true, reasoningEffort: 'off', reasoningWireEffort: null };
    if (command === 'chat_openai_auth_method') return 'chatgpt';
    if (command === 'pi_chat_validate_authority') return;
    if (command === 'pi_chat_fetch') {
      args.frames.onmessage({ type: 'headers', status: 200, content_type: 'text/event-stream' });
      const event = { type: 'response.failed', response: { id: 'r', status: 'failed', error: { code: 'subscription_sharing_usage_limit_exceeded', message: '429 temporary secret-provider-detail' } } };
      args.frames.onmessage({ type: 'chunk', bytes: [...new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)] });
      args.frames.onmessage({ type: 'done' });
      return;
    }
    throw new Error(`Unexpected native command ${command}`);
  });
  const binding = { authorityId: 'authority', conversationId: 1, providerSessionId: 'session' };
  const models = createNativeModels(new Map([['session', binding]]), async (_binding, message) => message);
  const model = await models.registerModel('openai', 'gpt-6-luna');
  const result = await models.completeSimple(model, { messages: [{ role: 'user', content: 'Read my note', timestamp: 1 }] }, { sessionId: 'session' });
  expect(result.stopReason).toBe('error');
  expect(result.errorMessage).toContain('insufficient_quota');
  expect(result.errorMessage).toContain('ChatGPT usage limit reached');
  expect(result.errorMessage).not.toContain('secret-provider-detail');
});

it('uses Pi subscription serialization for the selected billing method and can switch back without exposing credentials', async () => {
  let method: 'apiKey' | 'chatgpt' = 'chatgpt';
  const requests: Record<string, any>[] = [];
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'pi_chat_model_configuration') return { contextWindow: null, maxTokens: null, images: true, tools: true, reasoningEffort: 'high', reasoningWireEffort: 'high' };
    if (command === 'chat_openai_auth_method') return method;
    if (command === 'pi_chat_validate_authority') return;
    if (command === 'pi_chat_fetch') {
      requests.push(JSON.parse(args.body));
      args.frames.onmessage({ type: 'headers', status: 200, content_type: 'text/event-stream' });
      args.frames.onmessage({ type: 'chunk', bytes: [...new TextEncoder().encode('data: {"type":"response.completed","response":{"id":"r","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":0,"total_tokens":1}}}\n\n')] });
      args.frames.onmessage({ type: 'done' });
      return;
    }
    throw new Error(`Unexpected native command ${command}`);
  });
  const binding = { authorityId: 'authority', conversationId: 1, providerSessionId: 'session' };
  const models = createNativeModels(new Map([['session', binding]]), async (_binding, message) => message);
  const model = await models.registerModel('openai', 'gpt-6-luna');
  for (method of ['chatgpt', 'apiKey', 'chatgpt'] as const) {
    const result = await models.completeSimple(model, { messages: [{ role: 'user', content: 'Read my note', timestamp: 1 }] }, { sessionId: 'session', temperature: 0.4, maxTokens: 2048 });
    expect(result.stopReason).toBe('stop');
  }
  for (const request of [requests[0], requests[2]]) {
    expect(request).toMatchObject({ store: false, stream: true, reasoning: { effort: 'high' } });
    expect(request).not.toHaveProperty('max_output_tokens');
    expect(request).not.toHaveProperty('temperature');
    expect(request.input.some((item: any) => item.type === 'configuration_update')).toBe(false);
  }
  expect(requests[1].max_output_tokens).toBe(2048);
  expect(JSON.stringify(requests)).not.toContain('placeholder');
});

it.each(['gpt-6-luna', 'gpt-4.1'])('inherits Pi’s complete built-in definition for %s without changing the upstream catalog', async id => {
  native.invoke.mockResolvedValue({ contextWindow: null, maxTokens: null, images: false, tools: true, reasoningEffort: 'off', reasoningWireEffort: null });
  const published = openaiProvider().getModels().find(model => model.id === id)!;
  const original = structuredClone(published);
  const models = createNativeModels(new Map(), async (_binding, message) => message);
  const model = await models.registerModel('openai', id) as Model<'openai-responses'>;
  expect(model).toMatchObject({ name: published.name, api: published.api, input: published.input, reasoning: published.reasoning,
    cost: published.cost, contextWindow: published.contextWindow, maxTokens: published.maxTokens,
    inputLimits: published.inputLimits, compat: published.compat });
  // These nested capability records must not alias Pi's shared built-in catalog.
  expect(model.compat).not.toBe(published.compat);
  model.compat!.supportsStrictMode = false;
  expect(published).toEqual(original);
  expect((await models.registerModel('openai', id)).compat).toEqual(published.compat);
});

it('keeps an uncatalogued hosted model conservative rather than borrowing another model’s capabilities', async () => {
  native.invoke.mockResolvedValue({ contextWindow: null, maxTokens: null, images: false, tools: true, reasoningEffort: 'off', reasoningWireEffort: null });
  const models = createNativeModels(new Map(), async (_binding, message) => message);
  const model = await models.registerModel('openai', 'uncatalogued-model') as Model<'openai-responses'>;
  expect(model).toMatchObject({ id: 'uncatalogued-model', contextWindow: 0, maxTokens: 0 });
  expect(model.compat?.supportsStrictMode).not.toBe(true);
  expect(model.compat?.supportsOpenAIGrammarTools).not.toBe(true);
});

it('forwards live reasoning and answer text while the native stream and terminal admission are still pending', async () => {
  const releaseText = Promise.withResolvers<void>();
  const releaseDone = Promise.withResolvers<void>();
  const received: string[] = [];
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'pi_chat_model_configuration') return { contextWindow: 8192, maxTokens: 2048, images: false, tools: true, reasoningEffort: 'on', reasoningWireEffort: null };
    if (command === 'chat_openai_auth_method') return 'apiKey';
    if (command === 'pi_chat_validate_authority') return;
    if (command === 'pi_chat_fetch') {
      const chunk = (delta: Record<string, string>, finish: string | null = null) => args.frames.onmessage({ type: 'chunk', bytes: [...new TextEncoder().encode(`data: ${JSON.stringify({ id: 'local', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)] });
      args.frames.onmessage({ type: 'headers', status: 200, content_type: 'text/event-stream' });
      chunk({ role: 'assistant', reasoning_content: 'Compare the note themes.' });
      await releaseText.promise;
      chunk({ content: 'Your notes explore creative projects.' });
      await releaseDone.promise;
      chunk({}, 'stop');
      args.frames.onmessage({ type: 'chunk', bytes: [...new TextEncoder().encode('data: [DONE]\n\n')] });
      args.frames.onmessage({ type: 'done' });
      return;
    }
    throw new Error(`Unexpected command ${command}`);
  });
  const binding: NativeBinding = { authorityId: 'authority', conversationId: 1, providerSessionId: 'session' };
  const admit = vi.fn(async (_binding: NativeBinding, message: AssistantMessage) => message);
  const models = createNativeModels(new Map([['session', binding]]), admit);
  const model = await models.registerModel('local', 'fixture');
  const stream = models.streamSimple(model, { messages: [{ role: 'user', content: 'Find themes', timestamp: 1 }] }, { sessionId: 'session' });
  const consume = (async () => { for await (const event of stream) received.push(event.type); })();
  try {
    await vi.waitFor(() => expect(received).toContain('thinking_delta'));
    expect(admit).not.toHaveBeenCalled();
    expect(received).not.toContain('text_delta');
    releaseText.resolve();
    await vi.waitFor(() => expect(received).toContain('text_delta'));
    expect(received).not.toContain('done');
    expect(admit).not.toHaveBeenCalled();
  } finally {
    releaseText.resolve(); releaseDone.resolve(); await consume;
  }
  expect((await stream.result()).stopReason).toBe('stop');
  expect(admit).toHaveBeenCalledTimes(1);
});

it('never forwards caller URLs or headers to native routing or credentials', async () => {
  native.invoke.mockImplementation(async (command, args) => {
    expect(command).toBe('pi_chat_fetch');
    args.frames.onmessage({ type: 'headers', status: 200, content_type: 'text/event-stream' });
    args.frames.onmessage({ type: 'done' });
  });
  const binding: NativeBinding = { authorityId: 'authority', conversationId: 1, providerSessionId: 'session' };
  const response = await nativeFetch(binding, 'local', 'selected')('https://caller.invalid/inference', {
    method: 'POST', body: '{"model":"selected","stream":true}', headers: { Authorization: 'caller-selected' },
  });
  expect(response.ok).toBe(true);
  const args = native.invoke.mock.calls[0][1];
  expect(args).toMatchObject({ ...binding, provider: 'local', model: 'selected' });
  expect(Object.keys(args).sort()).toEqual(['authorityId', 'body', 'conversationId', 'frames', 'id', 'model', 'provider', 'providerSessionId']);
});

it.each(['text/event-stream', ''])('uses the real hosted Responses parser and native admission with Content-Type %j', async contentType => {
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'pi_chat_model_configuration') return { provider: 'openai', model: 'gpt-4.1', contextWindow: null, maxTokens: null, images: true, tools: true, reasoningEffort: 'off', reasoningWireEffort: null };
    if (command === 'chat_openai_auth_method') return 'apiKey';
    if (command === 'pi_chat_validate_authority') return;
    if (command === 'pi_chat_fetch') {
      const item = { type: 'message', id: 'message-1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Hosted response', annotations: [] }] };
      const events = [
        { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'Hosted response' },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: 'response-1', status: 'completed', output: [item], usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } } },
      ];
      args.frames.onmessage({ type: 'headers', status: 200, content_type: contentType });
      args.frames.onmessage({ type: 'chunk', bytes: [...new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))] });
      args.frames.onmessage({ type: 'done' });
      return;
    }
    throw new Error(`Unexpected command ${command}`);
  });
  const binding: NativeBinding = { authorityId: 'native-owned', conversationId: 8, providerSessionId: 'persisted-session' };
  const admit = vi.fn(async (_binding: NativeBinding, message: AssistantMessage) => message);
  const models = createNativeModels(new Map([[binding.providerSessionId, binding]]), admit);
  const model = await models.registerModel('openai', 'gpt-4.1');
  expect(model.contextWindow).toBeGreaterThan(0);
  expect(model.maxTokens).toBeGreaterThan(0);
  const result = await models.completeSimple(model, { messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] }, { sessionId: binding.providerSessionId });
  expect(result.stopReason).toBe('stop');
  expect(result.content[0]).toMatchObject({ type: 'text', text: 'Hosted response' });
  expect(result.usage).toMatchObject({ input: 4, output: 3, totalTokens: 7 });
  expect(admit).toHaveBeenCalledWith(binding, expect.objectContaining({ api: 'openai-responses' }));
  const request = native.invoke.mock.calls.find(([command]) => command === 'pi_chat_fetch')![1];
  expect(request).toMatchObject({ ...binding, provider: 'openai', model: 'gpt-4.1' });
  expect(JSON.parse(request.body)).toMatchObject({ model: 'gpt-4.1', max_output_tokens: Math.min(DEFAULT_GENERATION_MAX_TOKENS, model.maxTokens) });
  expect(request).not.toHaveProperty('headers');
  expect(request).not.toHaveProperty('apiKey');
  expect(request).not.toHaveProperty('endpoint');
});

it.each(['local', 'openai'] as const)('keeps %s provider-specific options while native settings select reasoning for both stream entrypoints', async provider => {
  const requests: Record<string, any>[] = [];
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'pi_chat_model_configuration') return { contextWindow: 8192, maxTokens: 2048, images: false, tools: true, reasoningEffort: 'high', reasoningWireEffort: 'high' };
    if (command === 'chat_openai_auth_method') return 'apiKey';
    if (command === 'pi_chat_validate_authority') return;
    if (command === 'pi_chat_fetch') {
      requests.push(JSON.parse(args.body));
      const events = provider === 'local' ? [
        { id: 'local', choices: [{ index: 0, delta: { role: 'assistant', content: 'Answer' }, finish_reason: null }] },
        { id: 'local', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        '[DONE]',
      ] : [{ type: 'response.completed', response: { id: 'hosted', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } }];
      args.frames.onmessage({ type: 'headers', status: 200, content_type: 'text/event-stream' });
      args.frames.onmessage({ type: 'chunk', bytes: [...new TextEncoder().encode(events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''))] });
      args.frames.onmessage({ type: 'done' });
      return;
    }
    throw new Error(`Unexpected command ${command}`);
  });
  const binding: NativeBinding = { authorityId: 'authority', conversationId: 1, providerSessionId: 'session' };
  const admit = vi.fn(async (_binding: NativeBinding, message: AssistantMessage) => message);
  const models = createNativeModels(new Map([['session', binding]]), admit);
  const model = await models.registerModel(provider, provider === 'local' ? 'reasoning-model' : 'gpt-5');
  const transcript = { messages: [{ role: 'user' as const, content: 'Hello', timestamp: 1 }] };
  expect((await models.complete(model, transcript, { sessionId: 'session', reasoningEffort: 'high', toolChoice: 'none' })).stopReason).toBe('stop');
  expect((await models.completeSimple(model, transcript, { sessionId: 'session', reasoning: 'low' })).stopReason).toBe('stop');
  if (provider === 'local') {
    expect(requests[0]).toMatchObject({ reasoning_effort: 'high', tool_choice: 'none' });
    expect(requests[1]).toMatchObject({ reasoning_effort: 'high' });
  } else {
    expect(requests[0]).toMatchObject({ reasoning: { effort: 'high' }, tool_choice: 'none' });
    expect(requests[1]).toMatchObject({ reasoning: { effort: 'high' } });
  }
  expect(admit).toHaveBeenCalledTimes(2); // Empty hosted output still crosses terminal authority admission.
});

it('merges concurrent selected-model registrations and explicitly reloads changed native settings', async () => {
  let contextWindow: number | null = 8192;
  const firstConfiguration = Promise.withResolvers<void>();
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'pi_chat_model_configuration') {
      if (args.model === 'first') await firstConfiguration.promise;
      return { contextWindow, maxTokens: null, images: false, tools: true, reasoningEffort: 'off', reasoningWireEffort: null };
    }
    throw new Error(`Unexpected command ${command}`);
  });
  const models = createNativeModels(new Map(), async (_binding, message) => message);
  const pendingFirst = models.registerModel('local', 'first');
  const second = await models.registerModel('local', 'second');
  firstConfiguration.resolve();
  const first = await pendingFirst;
  expect(models.getModels('local')).toEqual([second, first]);
  contextWindow = null;
  expect(await models.registerModel('local', 'first')).toBe(first);
  expect(first.contextWindow).toBe(0);
  expect(models.getAllModels('local').find(model => model.id === 'first')).toBe(first);
  expect(second.contextWindow).toBe(8192);
  expect(native.invoke).toHaveBeenCalledTimes(3);
});

it.each(['local', 'openai'] as const)('preserves %s text/reasoning/tool deltas, signatures, usage and tool stop reason', async provider => {
  const reasoning = { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'Reasoning' }], encrypted_content: 'opaque' };
  const text = { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Answer', annotations: [] }] };
  const tool = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_note', arguments: '{"noteId":"note"}', status: 'completed' };
  const events = provider === 'local' ? [
    { id: 'local', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'Reasoning' }, finish_reason: null }] },
    { id: 'local', choices: [{ index: 0, delta: { content: 'Answer' }, finish_reason: null }] },
    { id: 'local', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_note', arguments: '{"noteId":' } }] }, finish_reason: null }] },
    { id: 'local', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"note"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } },
    '[DONE]',
  ] : [
    { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, summary: [] } },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'Reasoning' },
    { type: 'response.output_item.done', output_index: 0, item: reasoning },
    { type: 'response.output_item.added', output_index: 1, item: { ...text, content: [] } },
    { type: 'response.output_text.delta', output_index: 1, delta: 'Answer' },
    { type: 'response.output_item.done', output_index: 1, item: text },
    { type: 'response.output_item.added', output_index: 2, item: { ...tool, arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 2, delta: '{"noteId":' },
    { type: 'response.function_call_arguments.delta', output_index: 2, delta: '"note"}' },
    { type: 'response.output_item.done', output_index: 2, item: tool },
    { type: 'response.completed', response: { id: 'hosted', status: 'completed', output: [reasoning, text, tool], usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } } },
  ];
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'pi_chat_model_configuration') return { contextWindow: 8192, maxTokens: 2048, images: false, tools: true, reasoningEffort: 'high', reasoningWireEffort: 'high' };
    if (command === 'chat_openai_auth_method') return 'apiKey';
    if (command === 'pi_chat_validate_authority') return;
    if (command === 'pi_chat_fetch') {
      args.frames.onmessage({ type: 'headers', status: 200, content_type: 'text/event-stream' });
      for (const event of events) args.frames.onmessage({ type: 'chunk', bytes: [...new TextEncoder().encode(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`)] });
      args.frames.onmessage({ type: 'done' }); return;
    }
    throw new Error(`Unexpected command ${command}`);
  });
  const binding: NativeBinding = { authorityId: 'authority', conversationId: 1, providerSessionId: 'session' };
  const admit = vi.fn(async (_binding: NativeBinding, message: AssistantMessage) => message);
  const models = createNativeModels(new Map([['session', binding]]), admit);
  const model = await models.registerModel(provider, provider === 'local' ? 'reasoning-model' : 'gpt-5');
  const stream = models.streamSimple(model, { messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] }, { sessionId: 'session' });
  const received = []; for await (const event of stream) received.push(event);
  expect(received).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'thinking_delta', delta: 'Reasoning' }),
    expect.objectContaining({ type: 'text_delta', delta: 'Answer' }),
    expect.objectContaining({ type: 'toolcall_delta', delta: '{"noteId":' }),
  ]));
  const result = await stream.result();
  expect(result.stopReason).toBe('toolUse');
  expect(result.usage).toMatchObject({ input: 4, output: 3, totalTokens: 7 });
  expect(result.content).toEqual([
    expect.objectContaining({ type: 'thinking', thinking: 'Reasoning', thinkingSignature: expect.any(String) }),
    expect.objectContaining({ type: 'text', text: 'Answer' }),
    expect.objectContaining({ type: 'toolCall', name: 'read_note', arguments: { noteId: 'note' } }),
  ]);
  if (provider === 'openai') expect(result.content[1]).toHaveProperty('textSignature');
  expect(admit).toHaveBeenCalledWith(binding, result);
});

it.each(['local', 'openai'] as const)('cancels %s native transport in flight without successful terminal admission', async provider => {
  native.invoke.mockImplementation(async command => {
    if (command === 'pi_chat_model_configuration') return { contextWindow: 8192, maxTokens: 2048, images: false, tools: true, reasoningEffort: 'off', reasoningWireEffort: null };
    if (command === 'chat_openai_auth_method') return 'apiKey';
    if (command === 'pi_chat_validate_authority' || command === 'pi_chat_cancel_fetch') return;
    if (command === 'pi_chat_fetch') return new Promise<void>(() => {});
    throw new Error(`Unexpected command ${command}`);
  });
  const binding: NativeBinding = { authorityId: 'authority', conversationId: 1, providerSessionId: 'session' };
  const admit = vi.fn(async (_binding: NativeBinding, message: AssistantMessage) => message);
  const models = createNativeModels(new Map([['session', binding]]), admit);
  const model = await models.registerModel(provider, provider === 'local' ? 'loaded' : 'gpt-4.1');
  const controller = new AbortController();
  const result = models.completeSimple(model, { messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] }, { sessionId: 'session', signal: controller.signal });
  await vi.waitFor(() => expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_fetch')).toBe(true));
  controller.abort();
  expect((await result).stopReason).toBe('aborted');
  expect(admit).not.toHaveBeenCalled();
  expect(native.invoke.mock.calls.some(([command]) => command === 'pi_chat_cancel_fetch')).toBe(true);
});

it.each([
  { provider: 'local', selection: 'off', wire: 'none', expected: { reasoning_effort: 'none' } },
  { provider: 'local', selection: 'on', wire: null, expected: {} },
  { provider: 'local', selection: 'deep', wire: 'deep', expected: { reasoning_effort: 'deep' } },
  { provider: 'local', selection: 'brief', wire: 'brief', expected: { reasoning_effort: 'brief' } },
  { provider: 'local', selection: 'off', wire: null, expected: {} },
  { provider: 'openai', selection: 'off', wire: null, expected: {} },
  { provider: 'openai', selection: 'high', wire: 'high', expected: { reasoning: { effort: 'high' } } },
] as const)('serializes $provider native reasoning selection $selection / $wire through Pi for full and simple requests', async ({ provider, selection, wire, expected }) => {
  const requests: Record<string, unknown>[] = [];
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'pi_chat_model_configuration') return { contextWindow: 8192, maxTokens: 2048, images: false, tools: true, reasoningEffort: selection, reasoningWireEffort: wire };
    if (command === 'chat_openai_auth_method') return 'apiKey';
    if (command === 'pi_chat_validate_authority') return;
    if (command === 'pi_chat_fetch') {
      requests.push(JSON.parse(args.body));
      const events = provider === 'local' ? [
        { id: 'local', choices: [{ index: 0, delta: { role: 'assistant', content: 'Answer' }, finish_reason: 'stop' }] }, '[DONE]',
      ] : [{ type: 'response.completed', response: { id: 'hosted', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } }];
      args.frames.onmessage({ type: 'headers', status: 200, content_type: 'text/event-stream' });
      args.frames.onmessage({ type: 'chunk', bytes: [...new TextEncoder().encode(events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''))] });
      args.frames.onmessage({ type: 'done' });
      return;
    }
    throw new Error('Unexpected native command');
  });
  const binding: NativeBinding = { authorityId: 'authority', conversationId: 1, providerSessionId: 'session' };
  const models = createNativeModels(new Map([['session', binding]]), async (_binding, message) => message);
  const model = await models.registerModel(provider, 'model-with-no-inferred-capabilities');
  const transcript = { messages: [{ role: 'user' as const, content: 'Hello', timestamp: 1 }] };
  expect((await models.complete(model, transcript, { sessionId: 'session', reasoningEffort: 'max' })).stopReason).toBe('stop');
  expect((await models.completeSimple(model, transcript, { sessionId: 'session', reasoning: 'low' })).stopReason).toBe('stop');
  for (const request of requests) {
    expect(request).toMatchObject(expected);
    if (!('reasoning_effort' in expected)) expect(request).not.toHaveProperty('reasoning_effort');
    if (!('reasoning' in expected)) expect(request).not.toHaveProperty('reasoning');
    expect(request).not.toHaveProperty('enable_thinking');
    expect(request).not.toHaveProperty('chat_template_kwargs');
  }
  expect(requests).toHaveLength(2);
});
