import { afterEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { MemoryStorage, GenerationTask, createRegistry, defineExtension, hook, type CommitPublication } from '@earendil-works/pi-durable';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { ChatDoc, PI_CONTEXT, openPiChat, type PiChat } from './runtime';
import { EditReviewDoc } from './publication';
import { piViewFixture } from '../ui/piViewTestSupport';

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(async () => () => {}), storage: undefined as unknown }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, Channel: class {} }));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));
vi.mock('./nativeSqlite', () => ({ openNativeSqlite: async () => ({}) }));
vi.mock('@earendil-works/pi-durable/storage/sqlite', () => ({ SqliteStorage: { open: async () => native.storage } }));
let chat: PiChat | undefined;
afterEach(async () => { await chat?.close(); chat = undefined; vi.restoreAllMocks(); });

it('creates app documents atomically for raw conversation creation and resets review state on fork', async () => {
  native.storage = new MemoryStorage(); native.invoke.mockReset();
  chat = await openPiChat();
  const commits: CommitPublication[] = [];
  const stop = chat.harness.subscribeCommits(commit => commits.push(commit));
  try {
    const parent = await chat.harness.commit(tx => tx.createConversation({ ownership: { kind: 'ownerless' } }), PI_CONTEXT);
    expect(commits).toHaveLength(1);
    expect(commits[0].changes.filter(change => change.type === 'document').map(change => change.record.kind))
      .toEqual(expect.arrayContaining([ChatDoc.definition.kind, EditReviewDoc.definition.kind]));
    expect(await chat.harness.snapshot(EditReviewDoc, parent.id, PI_CONTEXT)).toEqual({ items: {} });
    const entry = await chat.harness.commit(async tx => {
      (await tx.doc(ChatDoc, parent.id)).title = 'Parent title';
      (await tx.doc(EditReviewDoc, parent.id)).items['7'] = { taskId: 7, title: 'Note', kind: 'edit', patch: 'Exact pending diff', decision: 'pending' };
      return tx.appendEntry(parent.id, { kind: 'fixture', model: [{ role: 'user', content: 'Fork here', timestamp: 1 }] });
    }, PI_CONTEXT);
    const fork = await chat.harness.commit(tx => tx.forkConversation(parent.id, entry.id, { ownership: { kind: 'ownerless' } }), PI_CONTEXT);
    expect(await chat.harness.snapshot(ChatDoc, fork.id, PI_CONTEXT)).toMatchObject({ title: '', authorityId: '', forgotten: false });
    expect(await chat.harness.snapshot(EditReviewDoc, fork.id, PI_CONTEXT)).toEqual({ items: {} });
    expect((await chat.harness.snapshot(EditReviewDoc, parent.id, PI_CONTEXT))?.items['7'].decision).toBe('pending');
    expect(native.invoke).not.toHaveBeenCalled();
  } finally { stop(); }
});

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
