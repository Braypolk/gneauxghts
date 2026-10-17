import { afterEach, expect, it, vi } from 'vitest';
import { AgentDoc, Harness, LiveDoc, UsageDoc, MemoryStorage, createRegistry, type ConversationId } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { ChatDoc, PI_CONTEXT, openPiChat, type PiChat } from './runtime';
import { createPiConversationView, type PiConversationBinding } from '../ui/piConversationView';
import { fixtureSettings } from '../ui/piViewTestSupport';

const native = vi.hoisted(() => ({ storage: undefined as unknown }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('./nativeSqlite', () => ({ openNativeSqlite: async () => ({}) }));
vi.mock('@earendil-works/pi-durable/storage/sqlite', () => ({ SqliteStorage: { open: async () => native.storage } }));
let chat: PiChat | undefined;
let binding: PiConversationBinding | undefined;
afterEach(async () => { binding?.dispose(); await chat?.close(); binding = undefined; chat = undefined; vi.restoreAllMocks(); });

const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => resolve = done); return { promise, resolve }; };
async function setup(size = 60) {
  const storage = new MemoryStorage(); storage.close = async () => {}; native.storage = storage;
  const models = createModels();
  const faux = fauxProvider({ provider: 'local', models: [{ id: 'fixture' }] }); models.setProvider(faux.provider);
  const seed = await Harness.open(storage, { registry: createRegistry(), models }, PI_CONTEXT);
  for (let index = 0; index < size; index++) await seed.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'local', modelId: 'fixture' } },
    init: async (tx, id) => { (await tx.doc(ChatDoc, id)).title = `Conversation ${index}`; } }, PI_CONTEXT);
  await seed.close(PI_CONTEXT);
  chat = await openPiChat();
  binding = createPiConversationView({ open: async () => chat!, settings: async () => fixtureSettings, observeAuthority: async () => () => {} });
  return { storage, faux };
}
async function create(title: string) {
  return chat!.harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'local', modelId: 'fixture' } },
    init: async (tx, id) => { (await tx.doc(ChatDoc, id)).title = title; } }, PI_CONTEXT);
}
async function metadata(id: ConversationId, title: string, retired = false) {
  await chat!.harness.commit(async tx => { const doc = await tx.doc(ChatDoc, id); doc.title = title; doc.retired = retired; }, PI_CONTEXT);
}

it('measures matched sixty-row initial hydration and one-row title update without inference', async () => {
  const { storage, faux } = await setup();
  const scans = vi.spyOn(storage, 'scanConversations');
  const handles = vi.spyOn(chat!.harness, 'conversation');
  const snapshots = vi.spyOn(chat!.harness, 'snapshot');
  const counts = () => ({ scans: scans.mock.calls.length, handles: handles.mock.calls.length,
    chatSnapshots: snapshots.mock.calls.filter(([doc]) => doc.definition.kind === ChatDoc.definition.kind).length,
    agentSnapshots: snapshots.mock.calls.filter(([doc]) => doc.definition.kind === AgentDoc.definition.kind).length });
  await binding!.initialize();
  expect(binding!.getSnapshot().conversations).toHaveLength(50);
  const initial = counts();
  scans.mockClear(); handles.mockClear(); snapshots.mockClear();
  const id = binding!.getSnapshot().conversations[0].id;
  await chat!.harness.commit(async tx => { (await tx.doc(ChatDoc, id)).title = 'Renamed'; }, PI_CONTEXT);
  await vi.waitFor(() => expect(binding!.getSnapshot().conversations.find(row => row.id === id)?.title).toBe('Renamed'));
  const update = counts();
  console.info('LIST_READ_MEASUREMENT', JSON.stringify({ initial, update }));
  expect(initial).toEqual({ scans: 1, handles: 0, chatSnapshots: 50, agentSnapshots: 50 });
  expect(update).toEqual({ scans: 0, handles: 0, chatSnapshots: 0, agentSnapshots: 0 });
  expect(faux.state.callCount).toBe(0);
});


it('keeps older pages, orders creation, and applies title/model/retirement commits on either page without rereading', async () => {
  const { storage } = await setup();
  await binding!.initialize();
  const firstPage = binding!.getSnapshot().conversations.map(row => row.id);
  expect(firstPage).toEqual([...firstPage].sort((a, b) => b - a));
  expect(binding!.getSnapshot().listNext).toBeDefined();
  await binding!.refreshList(true);
  expect(binding!.getSnapshot().conversations).toHaveLength(60);
  expect(binding!.getSnapshot().listNext).toBeUndefined();
  const scans = vi.spyOn(storage, 'scanConversations'), snapshots = vi.spyOn(chat!.harness, 'snapshot');
  const newest = firstPage[0], oldest = binding!.getSnapshot().conversations.at(-1)!.id;
  for (const id of [newest, oldest]) {
    await metadata(id, `Renamed ${id}`, id === oldest);
    await chat!.harness.commit(async tx => { (await tx.doc(AgentDoc, id)).model = { provider: 'openai', modelId: `stored-${id}` }; }, PI_CONTEXT);
    expect(binding!.getSnapshot().conversations.find(row => row.id === id)).toMatchObject({ title: `Renamed ${id}`, retired: id === oldest, model: { provider: 'openai', modelId: `stored-${id}` } });
  }
  expect(scans).not.toHaveBeenCalled(); expect(snapshots).not.toHaveBeenCalled();
  const fresh = await create('Created now');
  await vi.waitFor(() => expect(binding!.getSnapshot().conversations[0].id).toBe(fresh.id));
  expect(binding!.getSnapshot().conversations).toHaveLength(61);
  await binding!.refreshList();
  expect(binding!.getSnapshot().conversations).toHaveLength(61);
  expect(binding!.getSnapshot().listNext).toBeUndefined();
  const calls = scans.mock.calls.length;
  await binding!.refreshList(true);
  expect(scans).toHaveBeenCalledTimes(calls);
  await chat!.harness.commit(async tx => { delete (await tx.doc(AgentDoc, oldest)).model; }, PI_CONTEXT);
  expect(binding!.getSnapshot().conversations.find(row => row.id === oldest)?.model).toBeUndefined();
});

it('correlates delayed page reads with newer metadata and serializes overlapping paging and refresh', async () => {
  await setup(110); await binding!.initialize();
  const started = gate(), release = gate();
  const list = chat!.listConversations.bind(chat!);
  const spy = vi.spyOn(chat!, 'listConversations').mockImplementationOnce(async (...args) => {
    const page = await list(...args); started.resolve(); await release.promise; return page;
  });
  try {
    const paging = binding!.refreshList(true); await started.promise;
    const overlapping = binding!.refreshList(true), refresh = binding!.refreshList();
    const oldestLoaded = binding!.getSnapshot().conversations.at(-1)!.id;
    await metadata(oldestLoaded, 'Current title', true);
    await chat!.harness.commit(async tx => { (await tx.doc(AgentDoc, oldestLoaded)).model = { provider: 'openai', modelId: 'new-model' }; }, PI_CONTEXT);
    const notYetLoaded = (await list(50, binding!.getSnapshot().listNext)).items.at(-1)!.id;
    await metadata(notYetLoaded, 'Changed during older read', true);
    const fresh = await create('Created while paging');
    release.resolve(); await Promise.all([paging, overlapping, refresh]);
    await vi.waitFor(() => expect(binding!.getSnapshot().conversations[0].id).toBe(fresh.id));
    const rows = binding!.getSnapshot().conversations;
    expect(rows).toHaveLength(111); expect(new Set(rows.map(row => row.id)).size).toBe(111);
    expect(rows.find(row => row.id === oldestLoaded)).toMatchObject({ title: 'Current title', retired: true, model: { modelId: 'new-model' } });
    expect(rows.find(row => row.id === notYetLoaded)).toMatchObject({ title: 'Changed during older read', retired: true });
    expect(binding!.getSnapshot().listNext).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(3);
  } finally { release.resolve(); }
});

it('replays repeated metadata commits during delayed new-row hydration', async () => {
  await setup(1); await binding!.initialize();
  const started = gate(), release = gate();
  const snapshot = chat!.harness.snapshot.bind(chat!.harness);
  vi.spyOn(chat!.harness, 'snapshot').mockImplementationOnce(async (...args: Parameters<typeof snapshot>) => {
    const value = await snapshot(...args); started.resolve(); await release.promise; return value;
  });
  try {
    const fresh = await create('Initial title'); await started.promise;
    await metadata(fresh.id, 'Intermediate title');
    await metadata(fresh.id, 'Latest title', true);
    await chat!.harness.commit(async tx => { (await tx.doc(AgentDoc, fresh.id)).model = { provider: 'openai', modelId: 'latest-model' }; }, PI_CONTEXT);
    release.resolve();
    await vi.waitFor(() => expect(binding!.getSnapshot().conversations[0]).toMatchObject({ id: fresh.id, title: 'Latest title', retired: true, model: { modelId: 'latest-model' } }));
    expect(binding!.getSnapshot().conversations).toHaveLength(2);
  } finally { release.resolve(); }
});

it('ignores active/usage/history commits and cancels list reads on disposal without aborting work', async () => {
  const { storage } = await setup(1); await binding!.initialize();
  const id = binding!.getSnapshot().conversations[0].id;
  const scans = vi.spyOn(storage, 'scanConversations'), snapshots = vi.spyOn(chat!.harness, 'snapshot');
  await chat!.harness.commit(async tx => {
    await tx.doc(LiveDoc, id); await tx.doc(UsageDoc, id);
    await tx.appendEntry(id, { kind: 'fixture', model: [{ role: 'user', content: 'Immutable history', timestamp: 1 }] });
  }, PI_CONTEXT);
  expect(scans).not.toHaveBeenCalled(); expect(snapshots).not.toHaveBeenCalled();
  const started = gate(), release = gate();
  let signal: AbortSignal | undefined;
  const list = chat!.listConversations.bind(chat!);
  vi.spyOn(chat!, 'listConversations').mockImplementationOnce(async (...args) => {
    const page = await list(...args); signal = args[2]?.abortSignal; started.resolve(); await release.promise; return page;
  });
  const abort = vi.spyOn(chat!.harness, 'abortSubmission');
  try {
    const pending = binding!.refreshList(); await started.promise;
    const rows = binding!.getSnapshot().conversations;
    binding!.dispose(); expect(signal?.aborted).toBe(true);
    await metadata(id, 'After disposal'); release.resolve(); await pending;
    expect(binding!.getSnapshot().conversations).toBe(rows);
    expect(abort).not.toHaveBeenCalled();
  } finally { release.resolve(); }
});


it('adopts an app document attached while its new-row snapshot was absent', async () => {
  await setup(1); await binding!.initialize();
  const started = gate(), release = gate();
  const snapshot = chat!.harness.snapshot.bind(chat!.harness);
  const spy = vi.spyOn(chat!.harness, 'snapshot');
  spy.mockImplementationOnce(async (...args: Parameters<typeof snapshot>) => snapshot(...args));
  spy.mockImplementationOnce(async (...args: Parameters<typeof snapshot>) => {
    const value = await snapshot(...args); started.resolve(); await release.promise; return value;
  });
  try {
    const fresh = await chat!.harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'local', modelId: 'fixture' } } }, PI_CONTEXT);
    await started.promise;
    await metadata(fresh.id, 'Attached later', true);
    release.resolve();
    await vi.waitFor(() => expect(binding!.getSnapshot().conversations[0]).toMatchObject({ id: fresh.id, title: 'Attached later', retired: true }));
  } finally { release.resolve(); }
});

it.each(['message', 'getter'] as const)('sanitizes hostile list read acquisition %s errors and keeps them observational', async shape => {
  await setup(1);
  const getter = vi.fn(() => { throw new Error('SECRET getter'); });
  const hostile = shape === 'getter' ? Object.defineProperty({ body: 'SECRET provider body', path: '/SECRET/path' }, 'message', { get: getter }) : new Error('SECRET prompt/provider body /SECRET/path');
  vi.spyOn(chat!, 'listConversations').mockRejectedValueOnce(hostile);
  await binding!.initialize();
  expect(binding!.getSnapshot().error).toBe('Chat updates are unavailable. Restart the app to reconnect.');
  expect(getter).not.toHaveBeenCalled();
  let notice: unknown;
  const stop = chat!.diagnostics.subscribe(value => { notice = value; }); stop();
  expect(JSON.stringify(notice)).not.toContain('SECRET');
  expect(notice).toMatchObject({ state: 'open', notices: [{ code: 'runtime_report', count: 1 }] });
  await binding!.refreshList(); expect(binding!.getSnapshot().conversations).toHaveLength(1);
});
