import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Harness, MemoryStorage, ProviderDoc, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { admitProviderMessage, type AnswerSegments } from './citations';
import { createNativeModels, type NativeBinding } from './nativeProvider';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, Channel: class { onmessage: (frame: unknown) => void = () => {}; } }));
const id = 'a'.repeat(48), invented = 'b'.repeat(48);
const harnesses: Harness[] = [];
let output: string, denyTerminal: boolean;
beforeEach(() => {
  output = `## Goal\nRead [Note: Plan](gneauxghts-source:${id}), copied [Untrusted label](gneauxghts-source:${id}), invented [Note: Invented](gneauxghts-source:${invented}).`;
  denyTerminal = false;
  native.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === 'pi_chat_validate_authority') return;
    if (command === 'pi_chat_model_configuration') return { contextWindow: 129280, maxTokens: 4096, images: false, tools: true, reasoningEffort: 'off' };
    if (command === 'pi_chat_admit_answer') {
      if (denyTerminal) throw { code: 'retired_authority', message: 'Retired' };
      return args.answers.map((answer: AnswerSegments) => answer.segments.map(segment => segment.text + segment.sources.map(source => source === id ? `[Note: Plan](gneauxghts-source:${id})` : '[citation unavailable]').join('')).join(''));
    }
    if (command === 'pi_chat_fetch') {
      const chunk = (value: unknown) => args.frames.onmessage({ type: 'chunk', bytes: [...new TextEncoder().encode(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`)] });
      args.frames.onmessage({ type: 'headers', status: 200, content_type: 'text/event-stream' });
      chunk({ id: 'response', object: 'chat.completion.chunk', model: 'loaded', choices: [{ index: 0, delta: { role: 'assistant', content: output }, finish_reason: null }] });
      chunk({ id: 'response', object: 'chat.completion.chunk', model: 'loaded', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      chunk('[DONE]'); args.frames.onmessage({ type: 'done' }); return;
    }
    if (command === 'pi_chat_cancel_fetch') return;
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(async () => { await Promise.all(harnesses.splice(0).map(harness => harness.close(context))); });
async function setup() {
  const bindings = new Map<string, NativeBinding>();
  const models = createNativeModels(bindings, admitProviderMessage);
  const model = await models.registerModel('local', 'loaded');
  const storage = new MemoryStorage(); storage.close = async () => {};
  const harness = await Harness.open(storage, { registry: createRegistry(), models, settings: { compaction: { keepRecentTokens: 64, reserveTokens: 1024 }, retry: { enabled: false } } }, context);
  harnesses.push(harness);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'local', modelId: 'loaded' } } }, context);
  const provider = (await harness.snapshot(ProviderDoc, conversation.id, context))!;
  const binding = { authorityId: 'native-authority', conversationId: conversation.id, providerSessionId: provider.sessionId };
  bindings.set(provider.sessionId, binding);
  return { harness, conversation, models, model, binding };
}
it('uses Pi AI real streaming parser but withholds authoritative completion until native citation admission', async () => {
  const { models, model, binding } = await setup();
  const stream = models.streamSimple(model, { messages: [{ role: 'user', content: 'Read', timestamp: 1 }] }, { sessionId: binding.providerSessionId });
  const events = [];
  for await (const event of stream) events.push(event);
  expect(events.some(event => event.type === 'text_delta' && event.delta.includes('gneauxghts-source:'))).toBe(true);
  const final = await stream.result();
  expect(final.stopReason).toBe('stop');
  expect(JSON.stringify(final.content)).not.toContain('Untrusted label');
  expect(JSON.stringify(final.content)).toContain('[citation unavailable]');
  expect(JSON.stringify(final.content)).toContain(`gneauxghts-source:${id}`);
  expect(native.invoke.mock.calls.find(([name]) => name === 'pi_chat_admit_answer')?.[1]).toMatchObject(binding);
});
it('standard Pi compaction revalidates both issued Markdown citations and copied source links without a custom summary hook', async () => {
  const { harness, conversation, binding } = await setup();
  for (let i = 0; i < 4; i++) await conversation.submit({ type: 'write', entry: { kind: 'dialogue', model: [{ role: 'user', content: `Question ${i} ${'detail '.repeat(100)}`, timestamp: 1 }] } }, context);
  const task = await conversation.compact(undefined, context);
  expect((await harness.waitForTask(task, context)).state.outcome.status).toBe('completed');
  const admitted = native.invoke.mock.calls.find(([name]) => name === 'pi_chat_admit_answer')![1];
  expect(admitted).toMatchObject(binding);
  expect(admitted.answers.flatMap((answer: AnswerSegments) => answer.segments.flatMap(segment => segment.sources))).toEqual([id, id, invented]);
  const head = JSON.stringify((await conversation.context(context)).head);
  expect(head).toContain('## Goal');
  expect(head).toContain(`gneauxghts-source:${id}`);
  expect(head).toContain('[citation unavailable]');
  expect(head).not.toContain('Untrusted label');
});
it('native terminal rejection becomes Pi provider failure with no successful done event', async () => {
  const { models, model, binding } = await setup(); denyTerminal = true;
  const stream = models.streamSimple(model, { messages: [{ role: 'user', content: 'Read', timestamp: 1 }] }, { sessionId: binding.providerSessionId });
  const events = []; for await (const event of stream) events.push(event);
  expect(events.some(event => event.type === 'done')).toBe(false);
  expect((await stream.result()).stopReason).toBe('error');
});
