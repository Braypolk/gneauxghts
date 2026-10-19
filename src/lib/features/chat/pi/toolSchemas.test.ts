import { expect, it, vi } from 'vitest';
import { Harness, MemoryStorage, ProviderDoc, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createNativeModels, type NativeBinding } from './nativeProvider';
import { notesExtension } from './notes';
import { editExtension } from './edit';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, Channel: class { onmessage = (_frame: unknown) => {}; } }));

// Exercise extension registration → durable generation → real Pi provider serialization.
// A flag on a tool alone does not prove the provider receives an enforceable schema.
it.each(['openai', 'local'] as const)('offers all four tools with supported %s schema enforcement', async provider => {
  const requests: Record<string, any>[] = [];
  native.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === 'pi_chat_model_configuration') return { contextWindow: 8192, maxTokens: 2048, images: false, tools: true, reasoningEffort: 'off', reasoningWireEffort: null };
    if (command === 'chat_openai_auth_method') return 'apiKey';
    if (command === 'pi_chat_validate_authority') return;
    if (command !== 'pi_chat_fetch') throw new Error(`Unexpected native command ${command}`);
    requests.push(JSON.parse(args.body));
    const events = provider === 'openai'
      ? [{ type: 'response.completed', response: { id: 'hosted', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } }]
      : [{ id: 'local', choices: [{ index: 0, delta: { role: 'assistant', content: 'Ready' }, finish_reason: 'stop' }] }, '[DONE]'];
    args.frames.onmessage({ type: 'headers', status: 200, content_type: 'text/event-stream' });
    args.frames.onmessage({ type: 'chunk', bytes: [...new TextEncoder().encode(events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''))] });
    args.frames.onmessage({ type: 'done' });
  });
  const bindings = new Map<string, NativeBinding>();
  const models = createNativeModels(bindings, async (_binding, message) => message);
  const model = await models.registerModel(provider, provider === 'openai' ? 'gpt-6-luna' : 'fixture');
  const registry = createRegistry();
  registry.install(notesExtension(async () => 'authority'));
  registry.install(editExtension(async () => 'authority'));
  const harness = await Harness.open(new MemoryStorage(), { registry, models, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
  try {
    const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider, modelId: model.id } } }, context);
    const { sessionId } = (await harness.snapshot(ProviderDoc, conversation.id, context))!;
    bindings.set(sessionId, { authorityId: 'authority', conversationId: conversation.id, providerSessionId: sessionId });
    expect((await (await conversation.submit({ type: 'input', content: 'Ready' }, context)).wait(context)).status).toBe('done');
    expect(requests).toHaveLength(1);
    const tools = requests[0].tools.map((tool: any) => provider === 'local' ? tool.function : tool);
    expect(tools.map((tool: any) => tool.name).sort()).toEqual(['create_note', 'edit_note', 'read_note', 'search_notes']);
    for (const tool of tools) {
      expect(tool.parameters.additionalProperties).toBe(false);
      if (provider === 'openai') {
        expect(tool.strict).toBe(true);
        expect(tool.parameters.required.slice().sort()).toEqual(Object.keys(tool.parameters.properties).sort());
      } else {
        // OpenAI-compatible transport does not establish server strict-mode support.
        expect(tool).not.toHaveProperty('strict');
      }
    }
    const schema = (name: string) => tools.find((tool: any) => tool.name === name).parameters;
    for (const [name, property] of [['search_notes', 'cursor'], ['search_notes', 'limit'], ['read_note', 'quote'], ['create_note', 'folder']]) {
      if (provider === 'openai') expect(schema(name).properties[property].anyOf).toContainEqual({ type: 'null' });
      else expect(schema(name).required).not.toContain(property);
    }
    const edit = schema('edit_note');
    expect(edit.required).toEqual(['noteId', 'expectedReadSourceId', 'edits']);
    expect(edit.properties.edits.items.required).toEqual(['oldText', 'newText']);
    if (provider === 'openai') expect(edit.properties.edits.items.additionalProperties).toBe(false);
  } finally { await harness.close(context); }
});
