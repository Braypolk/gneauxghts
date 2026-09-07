import {
  dispatchDocumentExternalSync,
  documentHasCleanBuffer,
  getDocumentNoteId,
  getDocumentPath,
  type ExternalRefreshSource
} from '$lib/features/notepad/document/documentState';
import type { NotepadPaneId } from '$lib/features/notepad/session/runtimeStore.svelte';
import type {
  NoteDraftState,
  DocumentHandle
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
  findOpenDocumentByPath: (notePath: string) => NoteDraftState | null;
  getPaneIdsForDocument: (document: NoteDraftState) => NotepadPaneId[];
  replaceNoteAcrossPanes: (
    previousNote: NoteDraftState,
    nextNote: NoteDraftState,
    options?: { restoreCursor?: boolean }
  ) => Promise<void>;
  replaceReferencedNoteWithFreshDraft: (
    documentHandle: DocumentHandle
  ) => NoteDraftState;
  suspendPersistenceForConflict: (
    document: NoteDraftState
  ) => void;
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
    const document =
      params.findOpenDocumentByPath(notePath) ??
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
        // The watcher reports a filesystem move as an old-path deletion
        // followed by a new-path change. Durable identity can already resolve
        // the new location, so try that before treating this as disappearance.
        // A true deletion fails this read and follows the existing branch.
        if (getDocumentNoteId(document)) {
          const outcome = await params.refreshDocumentFromDisk(document, {
            source
          });
          if (
            outcome === 'refreshed' ||
            outcome === 'unchanged' ||
            outcome === 'conflict'
          ) {
            await params.refreshDerivedViews();
            return;
          }
        }
        if (documentHasCleanBuffer(document)) {
          const freshDraft =
            params.replaceReferencedNoteWithFreshDraft(
              document.handle
            );
          await params.replaceNoteAcrossPanes(
            document,
            freshDraft
          );
        } else {
          params.suspendPersistenceForConflict(document);
          dispatchDocumentExternalSync(document, {
            type: 'externalCaptured',
            external: {
              kind: 'deletion',
              source,
              path: payload.notePath
            }
          });
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
