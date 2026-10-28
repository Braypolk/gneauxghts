import { tick } from 'svelte';
import { captureFocusIntent } from '../navigation/focusIntent';
import { appStore } from '#lib/app/appStore.svelte.js';
import {
  resolveAssetRootPath,
  storePastedImageAsset,
  type SessionSnapshot
} from '#lib/features/notepad/session/session.js';
import {
  consumePendingNoteTarget
} from '#lib/noteNavigation.js';
import {
  consumePendingTaskTarget
} from '#lib/taskNavigation.js';

export interface NotepadSessionLifecycleDeps {
  hasLoadedInitialSession: () => boolean;
  markInitialSessionLoaded: () => void;
  isInitialEditorRootReady: () => boolean;
  applySession: (snapshot: SessionSnapshot) => void;
  bindVaultScope: (vaultRoot: string) => void;
  loadRecoveryCopies?: () => Promise<void>;
  applyAssetRoot: (
    path: string | null,
    storeImage: typeof storePastedImageAsset
  ) => void;
  registerWindowCloseHandler: () => () => void;
  registerPendingSaveHandler: () => () => void;
  registerTransientMenuListeners: () => () => void;
  ensurePaneEditors: () => Promise<void>;
  refreshCurrentNote: () => Promise<void>;
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
    const initialFocus = captureFocusIntent();
    const revision = ++mountRevision;
    const current = () => mounted && revision === mountRevision && deps.isInitialEditorRootReady();
    const unregisterWindowClose = deps.registerWindowCloseHandler();
    const unregisterPendingSave = deps.registerPendingSaveHandler();
    const unregisterTransientMenus = deps.registerTransientMenuListeners();
    let unsubscribeVault: (() => void) | null = null;

    const ready = (async () => {
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

      // Recovery availability is advisory and cannot make canonical editing fail.
      void deps.loadRecoveryCopies?.().catch(error => console.error('Draft recovery could not load:', error));

      try {
        await deps.ensurePaneEditors();
        if (!current()) return;
        // Listen before reading disk: changes during the read are coalesced by
        // the refresh owner, and focus/pending navigation must not delay admission.
        unsubscribeVault = appStore.subscribeVaultNoteChanged(deps.onVaultNoteChanged);
        await deps.refreshCurrentNote();
        if (!current()) return;
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
          await deps.openNote(noteTarget.notePath, {
            noteId: noteTarget.noteId,
            focusEditorAfterOpen: true
          });
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
          if (current() && initialFocus.isCurrent()) deps.focusNavigationPane();
        }
      } catch (error) {
        console.error('Notepad init failed:', error);
      }
    })().finally(() => initialFocus.dispose());

    // The callable remains the mount cleanup; callers may also join startup.
    return Object.assign(() => {
      mounted = false;
      initialFocus.dispose();
      unregisterWindowClose();
      unregisterPendingSave();
      unregisterTransientMenus();
      unsubscribeVault?.();
      if (revision === mountRevision) deps.dispose();
    }, { ready });
  }

  return { mount };
}
