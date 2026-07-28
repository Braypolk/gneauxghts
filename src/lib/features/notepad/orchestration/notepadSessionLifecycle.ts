import { tick } from 'svelte';
import { appStore } from '$lib/app/appStore.svelte';
import {
  createEmptySessionSnapshot,
  loadCurrentVaultInfo,
  loadSavedNoteSession,
  resolveAssetRootPath,
  storePastedImageAsset,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';
import {
  consumePendingNoteTarget
} from '$lib/noteNavigation';
import {
  consumePendingTaskTarget
} from '$lib/taskNavigation';

export interface NotepadSessionLifecycleDeps {
  hasLoadedInitialSession: () => boolean;
  markInitialSessionLoaded: () => void;
  isInitialEditorRootReady: () => boolean;
  applySession: (snapshot: SessionSnapshot) => void;
  applyAssetRoot: (
    path: string | null,
    storeImage: typeof storePastedImageAsset
  ) => void;
  registerWindowCloseHandler: () => () => void;
  registerPendingSaveHandler: () => () => void;
  registerTransientMenuListeners: () => () => void;
  getWorkspaceShell: () => HTMLDivElement | null;
  ensurePaneEditors: () => Promise<void>;
  refreshCurrentNote: () => Promise<void>;
  updateRelatedLayout: () => void;
  scheduleRelated: (options: { immediate: true }) => void;
  openNote: (
    notePath: string | null,
    options: {
      noteId?: string | null;
      focusEditorAfterOpen?: boolean;
    }
  ) => Promise<void>;
  navigateToTaskTarget: (
    target: ReturnType<typeof consumePendingTaskTarget>
  ) => Promise<void>;
  openChatProjection: (notePath: string | null) => Promise<unknown>;
  focusNavigationPane: () => void;
  onVaultNoteChanged: (
    payload: Parameters<typeof appStore.subscribeVaultNoteChanged>[0] extends (
      value: infer T
    ) => unknown
      ? T
      : never
  ) => void;
  dispose: () => void;
}

/** Bootstrap, pending-target navigation, window subscriptions and teardown. */
export function createNotepadSessionLifecycle(
  deps: NotepadSessionLifecycleDeps
) {
  async function loadSavedNoteFallback() {
    try {
      deps.applySession(await loadSavedNoteSession());
    } catch (error) {
      console.error('Failed to load saved note:', error);
      deps.applySession(createEmptySessionSnapshot());
    }
  }

  async function loadAssetRootFallback() {
    try {
      const vault = await loadCurrentVaultInfo();
      deps.applyAssetRoot(
        resolveAssetRootPath(vault.currentPath),
        storePastedImageAsset
      );
    } catch (error) {
      console.error('Failed to load vault info for image assets:', error);
      deps.applyAssetRoot(null, storePastedImageAsset);
    }
  }

  function mount() {
    let mounted = true;
    const unregisterWindowClose = deps.registerWindowCloseHandler();
    const unregisterPendingSave = deps.registerPendingSaveHandler();
    const unregisterTransientMenus = deps.registerTransientMenuListeners();
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(deps.updateRelatedLayout);
    const shell = deps.getWorkspaceShell();
    if (shell) resizeObserver?.observe(shell);
    let unsubscribeVault: (() => void) | null = null;

    void (async () => {
      await tick();
      if (!mounted || !deps.isInitialEditorRootReady()) return;
      if (deps.hasLoadedInitialSession()) {
        await loadAssetRootFallback();
      } else {
        try {
          const bootstrap = await appStore.bootstrap();
          deps.applySession(bootstrap.session);
          deps.applyAssetRoot(
            resolveAssetRootPath(bootstrap.vault.currentPath),
            storePastedImageAsset
          );
        } catch (error) {
          console.error(
            'appStore.bootstrap failed, falling back to individual invokes:',
            error
          );
          await Promise.all([
            loadSavedNoteFallback(),
            loadAssetRootFallback()
          ]);
        }
        deps.markInitialSessionLoaded();
      }
      if (!mounted || !deps.isInitialEditorRootReady()) return;

      try {
        await deps.ensurePaneEditors();
        await deps.refreshCurrentNote();
        deps.updateRelatedLayout();
        deps.scheduleRelated({ immediate: true });
        let skipDefaultFocus = false;

        const taskTarget = consumePendingTaskTarget();
        if (taskTarget) {
          skipDefaultFocus = true;
          await deps.openNote(taskTarget.notePath, {
            noteId: taskTarget.noteId,
            focusEditorAfterOpen: false
          });
          await deps.navigateToTaskTarget(taskTarget);
        }

        const noteTarget = consumePendingNoteTarget();
        if (noteTarget) {
          skipDefaultFocus = true;
          if (
            noteTarget.documentKind &&
            noteTarget.documentKind !== 'note'
          ) {
            await deps.openChatProjection(noteTarget.notePath);
          } else {
            await deps.openNote(noteTarget.notePath, {
              noteId: noteTarget.noteId,
              focusEditorAfterOpen: true
            });
          }
        }

        if (!skipDefaultFocus) {
          await tick();
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve())
            );
          });
          if (mounted) deps.focusNavigationPane();
        }
        const unsubscribe = appStore.subscribeVaultNoteChanged(
          deps.onVaultNoteChanged
        );
        unsubscribeVault = () => unsubscribe();
      } catch (error) {
        console.error('Notepad init failed:', error);
      }
    })();

    return () => {
      mounted = false;
      unregisterWindowClose();
      unregisterPendingSave();
      unregisterTransientMenus();
      unsubscribeVault?.();
      resizeObserver?.disconnect();
      deps.dispose();
    };
  }

  return { mount };
}
