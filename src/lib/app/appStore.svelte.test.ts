import { beforeEach, expect, it, vi } from 'vitest';
import { bootstrapFixture, settingsViewFixture } from './testFixtures';
import { AppStore } from './appStore.svelte';
import type { BootstrapAppResult } from '#lib/features/notepad/session/bootstrap.js';
const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), listen: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('#lib/features/notepad/session/bootstrap.js', () => ({ loadBootstrapPayload: mocks.bootstrap }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const payload = bootstrapFixture();
async function listenersStarted() { await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(4)); }

beforeEach(() => {
  vi.clearAllMocks(); mocks.bootstrap.mockResolvedValue(payload);
  mocks.listen.mockImplementation(async () => vi.fn());
});
it('starts listeners and payload together and admits the editable session only after listeners', async () => {
  const listeners = deferred<() => void>(); mocks.listen.mockReturnValue(listeners.promise);
  const store = new AppStore(); const booted = store.bootstrap(); const applied = vi.fn(); void booted.then(applied);
  await listenersStarted(); expect(mocks.bootstrap).toHaveBeenCalledOnce(); expect(mocks.listen).toHaveBeenCalledTimes(4);
  expect(applied).not.toHaveBeenCalled(); expect(store.ready).toBe(false);
  listeners.resolve(vi.fn()); expect(await booted).toBe(payload); expect(store.ready).toBe(true);
  await store.dispose();
});
it('does not overwrite a newer event with delayed bootstrap, independently by field', async () => {
  const bootstrap = deferred<BootstrapAppResult>(); mocks.bootstrap.mockReturnValue(bootstrap.promise);
  const callbacks = new Map<string, (event: { payload: unknown }) => void>();
  mocks.listen.mockImplementation(async (channel: string, callback: (event: { payload: unknown }) => void) => { callbacks.set(channel, callback); return vi.fn(); });
  const store = new AppStore(); const booted = store.bootstrap(); await listenersStarted();
  const semantic = { ...payload.semanticStatus, indexedNotes: 99 };
  const vault = { ...payload.vault, selectedPath: '/event-newer' };
  callbacks.get('semantic-status-changed')!({ payload: semantic });
  callbacks.get('vault-changed')!({ payload: vault });
  callbacks.get('note-saved')!({ payload: { revision: 9 } });
  bootstrap.resolve(payload); await booted;
  expect(store.semanticStatus).toEqual(semantic); expect(store.indexRevision).toBe(9);
  expect(store.vaultInfo).toEqual(vault);
  await store.dispose();
});
it('disposal invalidates delayed payload and listeners across reentry', async () => {
  const bootstrap = deferred<BootstrapAppResult>(); const listeners = deferred<() => void>();
  mocks.bootstrap.mockReturnValueOnce(bootstrap.promise).mockResolvedValue(payload);
  mocks.listen.mockReturnValueOnce(listeners.promise);
  const store = new AppStore(); const old = store.bootstrap(); await listenersStarted(); await store.dispose();
  await store.bootstrap();
  const unlisten = vi.fn(); listeners.resolve(unlisten); bootstrap.resolve({ ...payload, indexRevision: 99 }); await old;
  expect(unlisten).toHaveBeenCalledOnce(); expect(store.indexRevision).toBe(1); expect(store.ready).toBe(true);
  await store.dispose();
});
it('cleans admitted listeners after a failed payload and retries the complete bootstrap', async () => {
  const listeners = deferred<() => void>(); mocks.listen.mockReturnValue(listeners.promise);
  mocks.bootstrap.mockRejectedValue(new Error('bootstrap failed'));
  const store = new AppStore(); const booted = store.bootstrap();
  await listenersStarted();
  const unlisten = vi.fn(); listeners.resolve(unlisten);
  await expect(booted).rejects.toThrow('bootstrap failed');
  expect(unlisten).toHaveBeenCalledTimes(4); expect(store.ready).toBe(false);
  mocks.bootstrap.mockResolvedValue(payload); mocks.listen.mockResolvedValue(vi.fn());
  await expect(store.bootstrap()).resolves.toBe(payload);
  expect(mocks.bootstrap).toHaveBeenCalledTimes(2); expect(mocks.listen).toHaveBeenCalledTimes(8);
  await store.dispose();
});
it('partial listener failure rejects admission, cleans valid subscriptions, and retries all listeners', async () => {
  const unlisten = vi.fn(); mocks.listen.mockRejectedValueOnce(new Error('listener offline')).mockResolvedValue(unlisten);
  const store = new AppStore(); await expect(store.bootstrap()).rejects.toThrow('listener offline');
  expect(unlisten).toHaveBeenCalledTimes(3); expect(store.ready).toBe(false);
  unlisten.mockClear();
  await expect(store.bootstrap()).resolves.toBe(payload);
  expect(mocks.listen).toHaveBeenCalledTimes(8); expect(store.ready).toBe(true);
  await store.dispose(); expect(unlisten).toHaveBeenCalledTimes(4);
});
it.each(['newer-first', 'older-first'] as const)('admits only the newest staged vault result (%s)', async order => {
  const store = new AppStore();
  const b = deferred<typeof payload.vault>();
  const c = deferred<typeof payload.vault>();
  mocks.invoke.mockReturnValueOnce(b.promise).mockReturnValueOnce(c.promise);
  const applyB = store.stageVaultSelection('/vault-b');
  const applyC = store.stageVaultSelection('/vault-c');
  const vaultB = { ...payload.vault, selectedPath: '/vault-b' };
  const vaultC = { ...payload.vault, selectedPath: '/vault-c' };
  if (order === 'older-first') {
    b.resolve(vaultB); await applyB;
    expect(store.vaultInfo).toBeNull();
    c.resolve(vaultC); await applyC;
  } else {
    c.resolve(vaultC); await applyC;
    b.resolve(vaultB); await applyB;
  }
  expect(mocks.invoke).toHaveBeenCalledWith('set_vault_directory', { path: '/vault-c' });
  expect(store.vaultInfo).toEqual(vaultC);
});

it('owns bundled Settings snapshot admission independently of the feature lifetime', async () => {
  const store = new AppStore();
  const bundle = deferred<ReturnType<typeof settingsViewFixture>>();
  mocks.invoke.mockReturnValueOnce(bundle.promise).mockResolvedValueOnce({ ...payload.vault, selectedPath: '/newer' });
  const loading = store.loadSettingsView();
  await store.stageVaultSelection('/newer');
  bundle.resolve(settingsViewFixture());
  expect(await loading).toEqual({
    semanticSettings: settingsViewFixture().semanticSettings, semanticDebug: settingsViewFixture().semanticDebug });
  expect(store.vaultInfo?.selectedPath).toBe('/newer');
  expect(store.semanticStatus).toEqual(settingsViewFixture().semanticStatus);
});

it('releases completed subscriptions immediately on dispose even while a sibling hangs', async () => {
  const late = deferred<() => void>();
  const release = vi.fn();
  mocks.listen.mockReturnValueOnce(late.promise).mockResolvedValue(release);
  const store = new AppStore();
  const old = store.bootstrap();
  await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(4));
  await store.dispose();
  expect(release).toHaveBeenCalledTimes(3);
  const lateRelease = vi.fn();
  late.resolve(lateRelease); await old;
  expect(lateRelease).toHaveBeenCalledOnce();
  expect(store.ready).toBe(false);
});
