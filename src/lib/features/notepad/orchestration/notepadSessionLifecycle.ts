import { tick } from 'svelte';
import { appStore } from '$lib/app/appStore.svelte';
import {
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
  bindVaultScope: (vaultRoot: string) => void;
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
  let mountRevision = 0;

  function mount() {
    let mounted = true;
    const revision = ++mountRevision;
    const current = () => mounted && revision === mountRevision && deps.isInitialEditorRootReady();
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
      if (!current()) return;
      try {
        const bootstrap = await appStore.bootstrap();
        if (!current()) return;
        const runningPath = appStore.vaultInfo?.runningPath ?? bootstrap.vault.runningPath;
        deps.bindVaultScope(runningPath);
        if (!deps.hasLoadedInitialSession()) {
          deps.applySession(bootstrap.session);
          deps.markInitialSessionLoaded();
        }
        deps.applyAssetRoot(resolveAssetRootPath(runningPath), storePastedImageAsset);
      } catch (error) {
        if (current()) console.error('App bootstrap failed; editing remains unavailable:', error);
        return;
      }
      if (!current()) return;

      try {
        await deps.ensurePaneEditors();
        if (!current()) return;
        await deps.refreshCurrentNote();
        if (!current()) return;
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
          if (!current()) return;
          await deps.navigateToTaskTarget(taskTarget);
          if (!current()) return;
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

        if (!current()) return;
        if (!skipDefaultFocus) {
          await tick();
          if (!current()) return;
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve())
            );
          });
          if (current()) deps.focusNavigationPane();
        }
        if (!current()) return;
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
      if (revision === mountRevision) deps.dispose();
    };
  }

  return { mount };
}
