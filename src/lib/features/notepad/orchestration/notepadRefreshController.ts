import {
  captureExternalDeletionConflict,
  documentHasCleanBuffer,
  getDocumentPath,
  type ExternalRefreshSource
} from '$lib/features/notepad/document/documentState';
import type { NotepadPaneId } from '$lib/features/notepad/session/runtimeStore.svelte';
import type {
  NoteDraftState,
  NoteKey
} from '$lib/features/notepad/state/noteStore';

export interface VaultNoteChangeEvent {
  notePath: string;
  deleted: boolean;
  documentKind?: 'note' | 'chatIndex' | 'chatTranscript';
  source?: string | null;
}

interface NotepadRefreshControllerParams {
  getDocumentSession: () => NoteDraftState;
  refreshDerivedViews: () => void | Promise<void>;
  updateRelatedDrawerLayout: () => void;
  refreshDocumentFromDisk: (
    document: NoteDraftState,
    options: { source: ExternalRefreshSource }
  ) => Promise<unknown>;
  getNoteByKey: (noteKey: NoteKey) => NoteDraftState | null;
  getPaneIdsForDocument: (document: NoteDraftState) => NotepadPaneId[];
  replaceNoteAcrossPanes: (
    previousNote: NoteDraftState,
    nextNote: NoteDraftState,
    options?: { restoreCursor?: boolean }
  ) => Promise<void>;
  replaceReferencedNoteWithFreshDraft: (
    noteKey: NoteKey
  ) => NoteDraftState;
  suspendPersistenceForConflict: (
    document: NoteDraftState
  ) => void;
  noteKeyFromPath: (notePath: string) => NoteKey | null;
  shouldDeferRefresh?: (notePath: string) => boolean;
}

export function createNotepadRefreshController(
  params: NotepadRefreshControllerParams
) {
  async function refreshCurrentNoteAndDerivedViews(
    source: Extract<
      ExternalRefreshSource,
      'windowFocus' | 'visibility'
    > = 'windowFocus'
  ) {
    await params.refreshDocumentFromDisk(
      params.getDocumentSession(),
      { source }
    );
    await params.refreshDerivedViews();
  }

  function handleWindowFocus() {
    void refreshCurrentNoteAndDerivedViews('windowFocus');
  }

  function handleWindowResize() {
    params.updateRelatedDrawerLayout();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void refreshCurrentNoteAndDerivedViews('visibility');
    }
  }

  function findLoadedReferencedDocument(notePath: string) {
    const noteKey = params.noteKeyFromPath(notePath);
    const keyedDocument = noteKey
      ? params.getNoteByKey(noteKey)
      : null;
    const document =
      keyedDocument ??
      (getDocumentPath(params.getDocumentSession()) === notePath
        ? params.getDocumentSession()
        : null);
    if (
      !document ||
      params.getPaneIdsForDocument(document).length === 0
    ) {
      return null;
    }
    return document;
  }

  async function handleVaultNoteChanged(
    payload: VaultNoteChangeEvent
  ) {
    if (
      payload.documentKind &&
      payload.documentKind !== 'note'
    ) {
      return;
    }
    if (params.shouldDeferRefresh?.(payload.notePath)) {
      await params.refreshDerivedViews();
      return;
    }

    const document = findLoadedReferencedDocument(
      payload.notePath
    );
    if (document) {
      const source: ExternalRefreshSource =
        payload.source === 'taskMutation'
          ? 'taskMutation'
          : 'watcher';
      if (payload.deleted) {
        if (documentHasCleanBuffer(document)) {
          const freshDraft =
            params.replaceReferencedNoteWithFreshDraft(
              document.key
            );
          await params.replaceNoteAcrossPanes(
            document,
            freshDraft
          );
        } else {
          params.suspendPersistenceForConflict(document);
          captureExternalDeletionConflict(
            document,
            payload.notePath,
            source
          );
        }
      } else {
        await params.refreshDocumentFromDisk(document, {
          source
        });
      }
    }

    await params.refreshDerivedViews();
  }

  return {
    refreshCurrentNoteAndDerivedViews,
    handleWindowFocus,
    handleWindowResize,
    handleVisibilityChange,
    handleVaultNoteChanged
  };
}
