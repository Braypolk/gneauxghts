import { beforeEach, expect, it, vi } from 'vitest';
import { AppStore } from './appStore.svelte';
import type { BootstrapAppResult } from '$lib/features/notepad/session/bootstrap';
const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('$lib/features/notepad/session/bootstrap', () => ({ loadBootstrapPayload: mocks.bootstrap }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const payload = { vault: { currentPath: '/vault' }, semanticStatus: { phase: 'initial' }, indexRevision: 1, session: {} } as unknown as BootstrapAppResult;
async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.bootstrap.mockResolvedValue(payload);
  mocks.listen.mockImplementation(async () => vi.fn());
});
it('starts listeners and payload together and admits the editable session only after listeners', async () => {
  const listeners = deferred<() => void>(); mocks.listen.mockReturnValue(listeners.promise);
  const store = new AppStore(); const booted = store.bootstrap(); const applied = vi.fn(); void booted.then(applied);
  await settle(); expect(mocks.bootstrap).toHaveBeenCalledOnce(); expect(mocks.listen).toHaveBeenCalledTimes(4);
  expect(applied).not.toHaveBeenCalled(); expect(store.ready).toBe(false);
  listeners.resolve(vi.fn()); expect(await booted).toBe(payload); expect(store.ready).toBe(true);
  await store.dispose();
});
it('does not overwrite a newer event with delayed bootstrap, independently by field', async () => {
  const bootstrap = deferred<BootstrapAppResult>(); mocks.bootstrap.mockReturnValue(bootstrap.promise);
  const callbacks = new Map<string, (event: { payload: unknown }) => void>();
  mocks.listen.mockImplementation(async (channel: string, callback: (event: { payload: unknown }) => void) => { callbacks.set(channel, callback); return vi.fn(); });
  const store = new AppStore(); const booted = store.bootstrap(); await settle();
  const semantic = { phase: 'event-newer' };
  callbacks.get('semantic-status-changed')!({ payload: semantic });
  callbacks.get('note-saved')!({ payload: { revision: 9 } });
  bootstrap.resolve(payload); await booted;
  expect(store.semanticStatus).toEqual(semantic); expect(store.indexRevision).toBe(9);
  expect(store.vaultInfo).toEqual(payload.vault);
  await store.dispose();
});
it('disposal invalidates delayed payload and listeners across reentry', async () => {
  const bootstrap = deferred<BootstrapAppResult>(); const listeners = deferred<() => void>();
  mocks.bootstrap.mockReturnValueOnce(bootstrap.promise).mockResolvedValue(payload);
  mocks.listen.mockReturnValueOnce(listeners.promise);
  const store = new AppStore(); const old = store.bootstrap(); await settle(); await store.dispose();
  await store.bootstrap();
  const unlisten = vi.fn(); listeners.resolve(unlisten); bootstrap.resolve({ ...payload, indexRevision: 99 }); await old;
  expect(unlisten).toHaveBeenCalledOnce(); expect(store.indexRevision).toBe(1); expect(store.ready).toBe(true);
  await store.dispose();
});
it('settles listener admission before failed-payload fallback and retains the admitted listeners', async () => {
  const listeners = deferred<() => void>(); mocks.listen.mockReturnValue(listeners.promise);
  mocks.bootstrap.mockRejectedValue(new Error('bootstrap failed'));
  const store = new AppStore(); const fallback = vi.fn(); const booted = store.bootstrap().catch(fallback);
  await settle(); expect(fallback).not.toHaveBeenCalled();
  const unlisten = vi.fn(); listeners.resolve(unlisten); await booted;
  expect(fallback).toHaveBeenCalledOnce(); expect(unlisten).not.toHaveBeenCalled();
  await expect(store.bootstrap()).rejects.toThrow('bootstrap failed'); expect(mocks.listen).toHaveBeenCalledTimes(4);
  await store.dispose(); expect(unlisten).toHaveBeenCalledTimes(4);
});
it('partial listener failure retains valid subscriptions and disposal cleans them up', async () => {
  const unlisten = vi.fn(); mocks.listen.mockRejectedValueOnce(new Error('listener offline')).mockResolvedValue(unlisten);
  const store = new AppStore(); await expect(store.bootstrap()).resolves.toBe(payload);
  expect(unlisten).not.toHaveBeenCalled(); expect(store.ready).toBe(true);
  await expect(store.bootstrap()).resolves.toBe(payload); expect(mocks.listen).toHaveBeenCalledTimes(4);
  await store.dispose(); expect(unlisten).toHaveBeenCalledTimes(3);
});
