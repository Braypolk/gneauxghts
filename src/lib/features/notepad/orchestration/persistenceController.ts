import { documentRegistry } from "$lib/features/notepad/document/documentRegistry";
import {
  type SessionSnapshot,
} from "$lib/features/notepad/session/session";
import {
  beginDocumentOperation,
  completeDocumentOperation,
  documentHasCleanBuffer,
  documentHasUnresolvedConflict,
  failDocumentOperation,
  getDocumentMarkdown,
  getDocumentNoteId,
  getDocumentPath,
  getDocumentTitle,
  invalidateDocumentOperations,
  isDocumentOperationCurrent,
  type NoteDraftState,
  type NoteKey,
} from "$lib/features/notepad/document/documentState";

export interface PersistenceControllerParams {
  getDocumentSession: () => NoteDraftState;
  saveNoteSession: (
    title: string,
    markdown: string,
    currentPath: string | null,
  ) => Promise<SessionSnapshot>;
  markNoteOpened?: (noteId: string) => Promise<void>;
  isActiveNote?: (note: NoteDraftState) => boolean;
  rekeyNoteWithRuntime: (
    note: NoteDraftState,
    snapshot: SessionSnapshot,
  ) => NoteDraftState | Promise<NoteDraftState>;
  applySavedSnapshot: (
    note: NoteDraftState,
    snapshot: SessionSnapshot,
    options: { preserveDraft: boolean },
  ) => void | Promise<void>;
  isTitleEditing?: (note: NoteDraftState) => boolean;
  /** Prevent generic save paths from persisting an editable proposal review. */
  shouldSuppressPersistence?: (note: NoteDraftState) => boolean;
}

export function createNotepadPersistenceController(
  params: PersistenceControllerParams,
) {
  function hasCleanBuffer(note: NoteDraftState = params.getDocumentSession()) {
    return documentHasCleanBuffer(note);
  }

  function invalidatePendingSaveResults(
    note: NoteDraftState = params.getDocumentSession(),
  ) {
    invalidateDocumentOperations(note);
  }

  function getNoteSaveQueue(noteKey: NoteDraftState["key"]) {
    return documentRegistry.get(noteKey)?.getSaveQueue() ?? Promise.resolve();
  }

  function queueNoteOperation(
    note: NoteDraftState,
    operation: () => Promise<void>,
  ) {
    const runtime = documentRegistry.ensure(note.key);
    return runtime.requestSave(async () => {
      try {
        await operation();
      } catch (error) {
        console.error("Notepad note operation failed:", error);
        if (note.operation.kind === "saving") {
          failDocumentOperation(
            note,
            "saving",
            error,
            note.operation.token,
          );
        }
        throw error;
      }
    });
  }

  async function persistNote(note: NoteDraftState) {
    if (
      documentHasUnresolvedConflict(note) ||
      params.shouldSuppressPersistence?.(note)
    ) {
      return;
    }
    const title = getDocumentTitle(note);
    const markdown = getDocumentMarkdown(note);
    const currentNoteId = getDocumentNoteId(note);
    const currentNotePath = getDocumentPath(note);

    if (documentHasCleanBuffer(note)) {
      return;
    }

    const operationToken = beginDocumentOperation(
      note,
      "saving",
    );
    const operationRevision = note.operation.revision;
    const savedSession = await params.saveNoteSession(
      title,
      markdown,
      currentNotePath,
    );
    if (!isDocumentOperationCurrent(note, operationToken)) {
      return;
    }

    const preserveDraft =
      note.operation.revision !== operationRevision ||
      getDocumentTitle(note) !== title ||
      getDocumentMarkdown(note) !== markdown ||
      getDocumentNoteId(note) !== currentNoteId ||
      getDocumentPath(note) !== currentNotePath ||
      (params.isTitleEditing?.(note) ?? false);

    const savedNote = await params.rekeyNoteWithRuntime(
      note,
      savedSession,
    );
    await params.applySavedSnapshot(
      savedNote,
      savedSession,
      { preserveDraft },
    );
    if (savedSession.commitWarning) {
      console.warn(
        "Note was saved, but required projections need repair:",
        savedSession.commitWarning,
      );
    }
    if (
      currentNotePath === null &&
      savedSession.currentNoteId &&
      (params.isActiveNote?.(savedNote) ?? true)
    ) {
      try {
        await params.markNoteOpened?.(savedSession.currentNoteId);
      } catch (error) {
        // The note is already safely on disk. Session-restore bookkeeping is
        // secondary and must not turn a completed save into a save failure.
        console.error("Failed to mark newly saved note as opened:", error);
      }
    }
    completeDocumentOperation(
      savedNote,
      savedNote === note
        ? operationToken
        : savedNote.operation.token,
    );
  }

  function cancelPendingAutosave(
    note: NoteDraftState = params.getDocumentSession(),
  ) {
    documentRegistry.get(note.key)?.clearSaveTimer();
  }

  function scheduleAutosave(
    note: NoteDraftState = params.getDocumentSession(),
  ) {
    const runtime = documentRegistry.ensure(note.key);
    runtime.clearSaveTimer();
    runtime.setSaveTimer(
      window.setTimeout(() => {
        runtime.clearSaveTimer();
        void enqueueSave(note).catch(() => undefined);
      }, 1000),
    );
  }

  async function enqueueSave(
    note: NoteDraftState = params.getDocumentSession(),
  ) {
    return queueNoteOperation(note, () => persistNote(note));
  }

  function flushPendingAutosave(
    note: NoteDraftState = params.getDocumentSession(),
  ) {
    const runtime = documentRegistry.get(note.key);
    if (!runtime || runtime.getSaveTimer() === null) {
      return;
    }

    runtime.clearSaveTimer();
    void enqueueSave(note).catch(() => undefined);
  }

  /** Iterate every running save queue and await it. */
  async function awaitAllSaveQueues() {
    const queues: Promise<void>[] = [];
    for (const runtime of documentRegistry.values()) {
      queues.push(runtime.getSaveQueue());
    }
    await Promise.all(queues);
  }

  return {
    cancelPendingAutosave,
    enqueueSave,
    flushPendingAutosave,
    getNoteSaveQueue,
    hasCleanBuffer,
    invalidatePendingSaveResults,
    persistNote,
    queueNoteOperation,
    scheduleAutosave,
    awaitAllSaveQueues,
  };
}
