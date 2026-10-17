import { afterEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { MemoryStorage, GenerationTask, createRegistry, defineExtension, hook } from '@earendil-works/pi-durable';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { PI_CONTEXT, openPiChat, type PiChat } from './runtime';
import { piViewFixture } from '../ui/piViewTestSupport';

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(async () => () => {}), storage: undefined as unknown }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, Channel: class {} }));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));
vi.mock('./nativeSqlite', () => ({ openNativeSqlite: async () => ({}) }));
vi.mock('@earendil-works/pi-durable/storage/sqlite', () => ({ SqliteStorage: { open: async () => native.storage } }));
let chat: PiChat | undefined;
afterEach(async () => { await chat?.close(); chat = undefined; vi.restoreAllMocks(); });

it('wires real Harness reports separately from terminal storage failure without inference or effects', async () => {
  const canary = 'SECRET_PROMPT_NOTE_CREDENTIAL_HEADER_ENDPOINT_PATH';
  const storage = new MemoryStorage(); native.storage = storage; native.invoke.mockReset();
  chat = await openPiChat();
  const stream = vi.spyOn(chat.models, 'streamSimple');
  const stop = chat.harness.subscribeCommits(() => { throw Error(canary); });
  const conversation = await chat.harness.createConversation({ ownership: { kind: 'ownerless' } }, PI_CONTEXT);
  stop();
  expect(get(chat.diagnostics)).toMatchObject({ state: 'open', notices: [{ code: 'runtime_report' }] });
  expect(get(chat.diagnostics).notices[0]).not.toHaveProperty('conversationId');
  vi.spyOn(storage, 'conversation').mockRejectedValueOnce(new Error(canary));
  await expect(chat.harness.conversation(conversation.id, PI_CONTEXT)).rejects.toThrow();
  expect(await chat.harness.closed).toMatchObject({ reason: 'failed' });
  expect(get(chat.diagnostics)).toMatchObject({ state: 'failed' });
  expect(get(chat.diagnostics).notices.at(-1)).toMatchObject({ code: 'runtime_failed' });
  expect(JSON.stringify(get(chat.diagnostics))).not.toContain(canary);
  expect(stream).not.toHaveBeenCalled(); expect(native.invoke).not.toHaveBeenCalled();
  const released = chat.diagnostics;
  await chat.close();
  expect(get(released)).toEqual({ state: 'closed', notices: [] });
});

it('surfaces an actual extension hook report while Pi completes the same single generation', async () => {
  const canary = 'SECRET_EXTENSION_NOTE_PROMPT_CREDENTIAL_PROVIDER_BODY';
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.failure', hooks: [hook(GenerationTask, {
    beforeRequest() { throw new Error(canary); },
  })] }));
  const fixture = await piViewFixture({ registry });
  try {
    await fixture.binding.initialize();
    fixture.faux.setResponses([fauxAssistantMessage('The response completed.')]);
    const submission = (await fixture.binding.send('A normal question'))!;
    expect((await submission.wait(PI_CONTEXT)).status).toBe('done');
    expect(fixture.faux.state.callCount).toBe(1);
    expect(get(fixture.runtime.diagnostics)).toMatchObject({ state: 'open', notices: [{ code: 'runtime_report', count: 1 }] });
    expect(JSON.stringify(get(fixture.runtime.diagnostics))).not.toContain(canary);
    expect(JSON.stringify(await fixture.runtime.storage.scanEntries({ conversationId: fixture.binding.getSnapshot().conversation!.id }, 50, undefined, PI_CONTEXT))).not.toContain(canary);
  } finally { await fixture.close(); }
});
