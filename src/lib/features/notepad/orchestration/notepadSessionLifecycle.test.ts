import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createNotepadSessionLifecycle, type NotepadSessionLifecycleDeps } from './notepadSessionLifecycle';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), subscribe: vi.fn(), loadSession: vi.fn(), loadVault: vi.fn(), noteTarget: vi.fn(), taskTarget: vi.fn() }));
vi.mock('$lib/app/appStore.svelte', () => ({ appStore: { bootstrap: mocks.bootstrap, subscribeVaultNoteChanged: mocks.subscribe } }));
vi.mock('$lib/features/notepad/session/session', async (load) => ({ ...await load<object>(), loadSavedNoteSession: mocks.loadSession, loadCurrentVaultInfo: mocks.loadVault }));
vi.mock('$lib/noteNavigation', () => ({ consumePendingNoteTarget: mocks.noteTarget }));
vi.mock('$lib/taskNavigation', () => ({ consumePendingTaskTarget: mocks.taskTarget }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const payload = { session: createEmptySessionSnapshot(), vault: { currentPath: '/vault' } };
function deps(): NotepadSessionLifecycleDeps {
  return {
    hasLoadedInitialSession: () => false, markInitialSessionLoaded: vi.fn(), isInitialEditorRootReady: () => true,
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
it('ignores fallback session and asset results or failures after unmount', async () => {
  const session = deferred<ReturnType<typeof createEmptySessionSnapshot>>(); const vault = deferred<{ currentPath: string }>();
  mocks.bootstrap.mockRejectedValue(new Error('bootstrap unavailable'));
  mocks.loadSession.mockReturnValue(session.promise); mocks.loadVault.mockReturnValue(vault.promise);
  const d = deps(); const unmount = createNotepadSessionLifecycle(d).mount(); await settle(); unmount();
  session.resolve(createEmptySessionSnapshot()); vault.reject(new Error('late')); await settle();
  expect(d.applySession).not.toHaveBeenCalled(); expect(d.applyAssetRoot).not.toHaveBeenCalled();
  expect(d.markInitialSessionLoaded).not.toHaveBeenCalled(); expect(mocks.subscribe).not.toHaveBeenCalled();
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
