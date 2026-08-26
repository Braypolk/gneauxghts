import type {
  NoteDraftState,
  NoteKey
} from '$lib/features/notepad/state/noteStore';

export interface DocumentDepartureControllerDeps<
  TPaneId extends string
> {
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  flushAllPendingCursorSaves: () => void;
  saveCursorPositionForPane: (
    paneId: TPaneId,
    document: NoteDraftState
  ) => void | Promise<void>;
  cancelPendingAutosave: (document: NoteDraftState) => void;
  enqueueSave: (document: NoteDraftState) => Promise<void>;
  getNoteSaveQueue: (noteKey: NoteKey) => Promise<void>;
  clearLastOpenedNote: () => Promise<void>;
}

export interface PrepareDocumentDepartureOptions {
  clearLastOpened?: boolean;
  persist?: boolean;
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
  async function prepare(
    paneId: TPaneId,
    document: NoteDraftState,
    {
      clearLastOpened = false,
      persist = true
    }: PrepareDocumentDepartureOptions = {}
  ): Promise<NoteDraftState> {
    deps.flushAllPendingCursorSaves();
    if (persist) {
      deps.cancelPendingAutosave(document);
      await deps.getNoteSaveQueue(document.key);
      await deps.enqueueSave(document);
    }

    const authoritativeDocument =
      deps.getPaneDocument(paneId);
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
