import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { Harness, MemoryStorage, ProviderDoc, createRegistry, type Conversation } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { ChatDoc, openPiChat, type PiChat } from './runtime';

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), storage: undefined as unknown }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, Channel: class {} }));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));
vi.mock('./nativeSqlite', () => ({ openNativeSqlite: async () => ({}) }));
vi.mock('@earendil-works/pi-durable/storage/sqlite', () => ({ SqliteStorage: { open: async () => native.storage } }));

const openHarness = Harness.open;
let chat: PiChat | undefined;
let harnessOpen: MockInstance<typeof Harness.open>;
const scheduled: number[] = [];
const resumed = vi.fn();
const restored: string[] = [];
let failConfiguration: boolean;
beforeEach(() => {
  restored.length = 0;
  scheduled.length = 0;
  resumed.mockClear();
  failConfiguration = false;
  native.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === 'pi_chat_authority') return { authorityId: args.authorityId, retired: args.authorityId === 'retired' };
    if (command === 'pi_chat_validate_authority') { restored.push(args.providerSessionId); return; }
    if (command === 'pi_chat_model_configuration') {
      if (failConfiguration && args.model === 'second') throw new Error('Native discovery unavailable');
      return { contextWindow: 8192, maxTokens: 1024, images: false, tools: true, reasoningEffort: 'off' };
    }
    throw new Error(`Unexpected native command ${command}`);
  });
  native.listen.mockReset().mockResolvedValue(() => {});
  harnessOpen = vi.spyOn(Harness, 'open');
});
afterEach(async () => { await chat?.close(); chat = undefined; harnessOpen.mockRestore(); });

async function seed() {
  const storage = new MemoryStorage();
  storage.close = async () => {};
  native.storage = storage;
  const models = createModels();
  models.setProvider(fauxProvider({ provider: 'local', models: [{ id: 'first' }, { id: 'second' }] }).provider);
  models.setProvider(fauxProvider({ provider: 'openai', models: [{ id: 'gpt-4.1' }] }).provider);
  const harness = await Harness.open(storage, { registry: createRegistry(), models }, context);
  const conversations: Conversation[] = [];
  for (const [provider, modelId, authorityId] of [
    ['local', 'first', 'valid-1'], ['openai', 'gpt-4.1', 'valid-2'],
    ['local', 'first', 'valid-3'], ['local', 'second', 'valid-4'],
    ['openai', 'gpt-4.1', 'valid-5'], ['local', 'first', 'retired'],
  ]) {
    conversations.push(await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider, modelId } },
      init: async (tx, id) => { (await tx.doc(ChatDoc, id)).authorityId = authorityId; }
    }, context));
  }
  const sessions = await Promise.all(conversations.slice(0, 5).map(async conversation => (await harness.snapshot(ProviderDoc, conversation.id, context))!.sessionId));
  await harness.close(context);
  harnessOpen.mockImplementation(async (...args: Parameters<typeof Harness.open>) => {
    const running: Harness = await openHarness(...args);
    const resume = running.resume.bind(running);
    running.resume = () => { scheduled.push(restored.length); resumed(); return resume(); };
    const conversation = running.conversation.bind(running);
    running.conversation = async (...args) => {
      const handle = await conversation(...args);
      if (handle) {
        const abort = handle.abort.bind(handle);
        handle.abort = (...args) => { scheduled.push(restored.length); return abort(...args); };
      }
      return handle;
    };
    return running;
  });
  return { sessions };
}

it('restores every mixed-model binding before scheduling and discovers each distinct pair once per startup', async () => {
  const { sessions } = await seed();
  chat = await openPiChat();
  expect(restored).toEqual(sessions);
  expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_model_configuration').map(([, args]) => [args.provider, args.model])).toEqual([
    ['local', 'first'], ['openai', 'gpt-4.1'], ['local', 'second'],
  ]);
  expect(resumed).toHaveBeenCalledOnce();
  expect(scheduled).toEqual([5, 5]);
  await chat.close();
  chat = undefined;
  restored.length = 0;
  native.invoke.mockClear();
  chat = await openPiChat();
  expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_model_configuration')).toHaveLength(3);
  expect(restored).toEqual(sessions);
});

it('fails startup model discovery before any scheduling operation', async () => {
  await seed();
  failConfiguration = true;
  await expect(openPiChat()).rejects.toThrow('Native discovery unavailable');
  expect(resumed).not.toHaveBeenCalled();
  expect(scheduled).toEqual([]);
  expect(native.listen).not.toHaveBeenCalled();
  expect(native.invoke.mock.calls.filter(([command]) => command === 'pi_chat_fetch')).toHaveLength(0);
});
