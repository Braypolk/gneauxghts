import type { NotepadPaneId } from '$lib/features/notepad/session/runtimeStore.svelte';
import type { NoteDraftState, NoteKey } from '$lib/features/notepad/state/noteStore';

export interface VaultNoteChangeEvent {
  notePath: string;
  deleted: boolean;
}

interface NotepadRefreshControllerParams {
  getDocumentSession: () => NoteDraftState;
  refreshDerivedViews: () => void | Promise<void>;
  updateRelatedDrawerLayout: () => void;
  runAutoSyncNow: (reason: string) => Promise<unknown>;
  scheduleAutoSync: (reason: string, delayMs?: number) => void;
  refreshCurrentNoteIfChanged: () => Promise<void>;
  getNoteByKey: (noteKey: NoteKey) => NoteDraftState | null;
  getPaneIdsForDocument: (document: NoteDraftState) => NotepadPaneId[];
  replaceNoteAcrossPanes: (
    previousNote: NoteDraftState,
    nextNote: NoteDraftState,
    options?: { restoreCursor?: boolean }
  ) => Promise<void>;
  replaceReferencedNoteWithFreshDraft: (noteKey: NoteKey) => NoteDraftState;
  noteKeyFromPath: (notePath: string) => NoteKey | null;
}

export function createNotepadRefreshController(params: NotepadRefreshControllerParams) {
  async function syncAndRefresh(reason: string) {
    await params.runAutoSyncNow(reason);
    await params.refreshCurrentNoteIfChanged();
    await params.refreshDerivedViews();
  }

  function handleWindowFocus() {
    void syncAndRefresh('window-focus');
  }

  function handleWindowResize() {
    params.updateRelatedDrawerLayout();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void syncAndRefresh('window-visible');
    }
  }

  async function handleVaultNoteChanged(payload: VaultNoteChangeEvent) {
    const documentSession = params.getDocumentSession();
    if (documentSession.currentNotePath === payload.notePath) {
      await params.refreshCurrentNoteIfChanged();
    } else if (payload.deleted) {
      const noteKey = params.noteKeyFromPath(payload.notePath);
      if (noteKey) {
        const note = params.getNoteByKey(noteKey);
        if (note && params.getPaneIdsForDocument(note).length > 0) {
          const freshDraft = params.replaceReferencedNoteWithFreshDraft(note.key);
          await params.replaceNoteAcrossPanes(note, freshDraft);
        }
      }
    }

    await params.refreshDerivedViews();
    params.scheduleAutoSync('vault-note-change', 1200);
  }

  return {
    syncAndRefresh,
    handleWindowFocus,
    handleWindowResize,
    handleVisibilityChange,
    handleVaultNoteChanged
  };
}
