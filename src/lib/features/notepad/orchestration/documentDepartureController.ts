import {
  documentCanLeaveWithoutCanonicalWrite,
  documentHasCleanBuffer,
  documentHasUnresolvedConflict
} from '$lib/features/notepad/document/documentState';
import type {
  NoteDraftState,
  DocumentHandle
} from '$lib/features/notepad/state/noteStore';

export interface DocumentDepartureControllerDeps<
  TPaneId extends string
> {
  hasOtherEditingPane: (paneId: TPaneId, document: NoteDraftState) => boolean;
  finalizeWindow: (document: NoteDraftState) => Promise<void>;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  flushAllPendingCursorSaves: () => void;
  saveCursorPositionForPane: (
    paneId: TPaneId,
    document: NoteDraftState
  ) => void | Promise<void>;
  cancelPendingAutosave: (document: NoteDraftState) => void;
  enqueueSave: (document: NoteDraftState) => Promise<void>;
  getNoteSaveQueue: (documentHandle: DocumentHandle) => Promise<void>;
  clearLastOpenedNote: () => Promise<void>;
  /** The proposal session retains this working copy without a canonical save. */
  isReviewingDocument?: (document: NoteDraftState) => boolean;
}

export interface PrepareDocumentDepartureOptions {
  clearLastOpened?: boolean;
  persist?: boolean;
  /** Save/cursor-only preparation when navigation has not been chosen yet. */
  finalize?: boolean;
}

/**
 * Canonical boundary for leaving an editable document.
 *
 * Persistence runs before the final cursor save so a new draft has an
 * authoritative path/ID for cursor storage and location history. Callers run
 * this from the pane transition pipeline's `departDocument` phase.
 */
export function createDocumentDepartureController<
  TPaneId extends string
>(deps: DocumentDepartureControllerDeps<TPaneId>) {
  function retainsProposalReview(document: NoteDraftState) {
    return deps.isReviewingDocument?.(document) === true &&
      !documentHasUnresolvedConflict(document);
  }

  async function prepare(
    paneId: TPaneId,
    document: NoteDraftState,
    {
      clearLastOpened = false,
      persist = true,
      finalize = true
    }: PrepareDocumentDepartureOptions = {}
  ): Promise<NoteDraftState> {
    deps.flushAllPendingCursorSaves();
    if (persist) {
      deps.cancelPendingAutosave(document);
      await deps.getNoteSaveQueue(document.handle);
      const documentAfterQueue = deps.getPaneDocument(paneId);
      if (
        !documentCanLeaveWithoutCanonicalWrite(documentAfterQueue) &&
        !retainsProposalReview(documentAfterQueue)
      ) {
        await deps.enqueueSave(documentAfterQueue);
      }
    }

    const authoritativeDocument =
      deps.getPaneDocument(paneId);
    if (
      !documentHasCleanBuffer(authoritativeDocument) &&
      !retainsProposalReview(authoritativeDocument)
    ) {
      throw new Error('The note could not be saved before leaving the editor.');
    }
    if (finalize && !deps.hasOtherEditingPane(paneId, authoritativeDocument)) {
      await deps.finalizeWindow(authoritativeDocument);
    }
    await deps.saveCursorPositionForPane(
      paneId,
      authoritativeDocument
    );

    if (clearLastOpened) {
      await deps.clearLastOpenedNote();
    }
    return authoritativeDocument;
  }

  return { prepare };
}

export type DocumentDepartureController<
  TPaneId extends string
> = ReturnType<
  typeof createDocumentDepartureController<TPaneId>
>;
