import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createNotepadSessionLifecycle, type NotepadSessionLifecycleDeps } from './notepadSessionLifecycle';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), subscribe: vi.fn(), vaultInfo: null as { runningPath: string; selectedPath?: string } | null, noteTarget: vi.fn(), taskTarget: vi.fn() }));
vi.mock('$lib/app/appStore.svelte', () => ({ appStore: { bootstrap: mocks.bootstrap, subscribeVaultNoteChanged: mocks.subscribe, get vaultInfo() { return mocks.vaultInfo; } } }));
vi.mock('$lib/noteNavigation', () => ({ consumePendingNoteTarget: mocks.noteTarget }));
vi.mock('$lib/taskNavigation', () => ({ consumePendingTaskTarget: mocks.taskTarget }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const payload = { session: createEmptySessionSnapshot(), vault: { runningPath: '/vault' } };
function deps(hasLoadedInitialSession = false): NotepadSessionLifecycleDeps {
  return {
    hasLoadedInitialSession: () => hasLoadedInitialSession, markInitialSessionLoaded: vi.fn(), isInitialEditorRootReady: () => true,
    applySession: vi.fn(), bindVaultScope: vi.fn(), applyAssetRoot: vi.fn(), registerWindowCloseHandler: () => vi.fn(), registerPendingSaveHandler: () => vi.fn(),
    registerTransientMenuListeners: () => vi.fn(), getWorkspaceShell: () => null, ensurePaneEditors: vi.fn().mockResolvedValue(undefined),
    refreshCurrentNote: vi.fn().mockResolvedValue(undefined), updateRelatedLayout: vi.fn(), scheduleRelated: vi.fn(),
    openNote: vi.fn().mockResolvedValue(undefined), navigateToTaskTarget: vi.fn().mockResolvedValue(undefined),
    openChatProjection: vi.fn().mockResolvedValue(undefined), focusNavigationPane: vi.fn(), onVaultNoteChanged: vi.fn(), dispose: vi.fn()
  };
}
async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.bootstrap.mockResolvedValue(payload);
  mocks.vaultInfo = null;
  mocks.subscribe.mockReturnValue(vi.fn());
  mocks.noteTarget.mockReturnValue(null);
  mocks.taskTarget.mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1; });
});
afterEach(() => vi.unstubAllGlobals());
it('ignores late bootstrap after unmount and allows only the new mount to apply and subscribe', async () => {
  const old = deferred<typeof payload>();
  mocks.bootstrap.mockReturnValueOnce(old.promise).mockResolvedValueOnce(payload);
  const d = deps(); const lifecycle = createNotepadSessionLifecycle(d);
  const unmount = lifecycle.mount(); await settle(); unmount();
  const unmountNew = lifecycle.mount(); await settle();
  old.resolve({ ...payload, session: { ...payload.session, title: 'obsolete' } }); await settle();
  expect(d.applySession).toHaveBeenCalledTimes(1);
  expect(d.applySession).toHaveBeenCalledWith(payload.session);
  expect(d.applyAssetRoot).toHaveBeenCalledTimes(1);
  expect(d.markInitialSessionLoaded).toHaveBeenCalledTimes(1);
  expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  expect(d.focusNavigationPane).toHaveBeenCalledTimes(1);
  const unsubscribe = mocks.subscribe.mock.results[0].value;
  unmountNew(); expect(unsubscribe).toHaveBeenCalledOnce();
});
it('keeps editing unavailable after bootstrap failure and admits a later successful retry', async () => {
  mocks.bootstrap.mockRejectedValue(new Error('bootstrap unavailable'));
  const d = deps(); const lifecycle = createNotepadSessionLifecycle(d);
  const unmount = lifecycle.mount(); await settle();
  expect(d.applySession).not.toHaveBeenCalled(); expect(d.applyAssetRoot).not.toHaveBeenCalled();
  expect(d.markInitialSessionLoaded).not.toHaveBeenCalled(); expect(mocks.subscribe).not.toHaveBeenCalled();
  unmount();
  mocks.bootstrap.mockResolvedValue(payload);
  const unmountRetry = lifecycle.mount(); await settle();
  expect(d.applySession).toHaveBeenCalledWith(payload.session);
  expect(d.applyAssetRoot).toHaveBeenCalledOnce();
  expect(d.markInitialSessionLoaded).toHaveBeenCalledOnce();
  unmountRetry();
});
it('uses the shared running vault on remount after another vault is staged', async () => {
  mocks.vaultInfo = { runningPath: '/running-a', selectedPath: '/staged-b' };
  const d = deps(true);
  const unmount = createNotepadSessionLifecycle(d).mount(); await settle();
  expect(d.applySession).not.toHaveBeenCalled();
  expect(d.bindVaultScope).toHaveBeenCalledWith('/running-a');
  expect(d.applyAssetRoot).toHaveBeenCalledWith('/running-a/assets', expect.any(Function));
  expect(d.markInitialSessionLoaded).not.toHaveBeenCalled();
  unmount();
});
it.each(['ensurePaneEditors', 'refreshCurrentNote', 'openNote'] as const)('does not continue initialization after delayed %s loses its mount', async (stage) => {
  const pending = deferred<void>(); const d = deps();
  vi.mocked(d[stage]).mockReturnValue(pending.promise);
  if (stage === 'openNote') mocks.taskTarget.mockReturnValue({ notePath: '/vault/note.md', noteId: 'note' });
  const unmount = createNotepadSessionLifecycle(d).mount(); await settle();
  expect(d[stage]).toHaveBeenCalledOnce(); unmount(); pending.resolve(); await settle();
  expect(d.focusNavigationPane).not.toHaveBeenCalled(); expect(mocks.subscribe).not.toHaveBeenCalled();
  if (stage === 'ensurePaneEditors') expect(d.refreshCurrentNote).not.toHaveBeenCalled();
  if (stage === 'openNote') expect(d.navigateToTaskTarget).not.toHaveBeenCalled();
});
