import { documentRegistry } from "$lib/features/notepad/document/documentRegistry";
import {
  type SessionSnapshot,
} from "$lib/features/notepad/session/session";
import {
  dispatchDocumentOperation,
  documentHasCleanBuffer,
  documentHasUnresolvedConflict,
  getDocumentMarkdown,
  getDocumentNoteId,
  getDocumentPath,
  getDocumentTitle,
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
  saveTaskNoteSession?: (
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
  const taskActionAttributions = new WeakMap<
    NoteDraftState,
    { revision: number; markdown: string }
  >();

  function hasCleanBuffer(note: NoteDraftState = params.getDocumentSession()) {
    return documentHasCleanBuffer(note);
  }

  function invalidatePendingSaveResults(
    note: NoteDraftState = params.getDocumentSession(),
  ) {
    dispatchDocumentOperation(note, { type: "invalidate" });
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
          dispatchDocumentOperation(note, {
            type: "fail",
            error,
            token: note.operation.token,
          });
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
    const taskAttribution = taskActionAttributions.get(note);
    const isAttributedTaskAction = Boolean(
      taskAttribution &&
        taskAttribution.revision === note.operation.revision &&
        taskAttribution.markdown === markdown,
    );
    if (
      taskAttribution &&
      note.operation.revision >= taskAttribution.revision &&
      !isAttributedTaskAction
    ) {
      taskActionAttributions.delete(note);
    }

    if (documentHasCleanBuffer(note)) {
      return;
    }

    dispatchDocumentOperation(note, {
      type: "start",
      operation: "saving",
    });
    const operationToken = note.operation.token;
    const operationRevision = note.operation.revision;
    const save = isAttributedTaskAction
      ? params.saveTaskNoteSession
      : params.saveNoteSession;
    if (!save) {
      throw new Error("Task note persistence is not configured");
    }
    const savedSession = await save(title, markdown, currentNotePath);
    if (
      isAttributedTaskAction &&
      taskActionAttributions.get(note) === taskAttribution
    ) {
      taskActionAttributions.delete(note);
    }
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
    dispatchDocumentOperation(savedNote, {
      type: "succeed",
      token:
        savedNote === note
          ? operationToken
          : savedNote.operation.token,
    });
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

  function attributeTaskActionSave(
    note: NoteDraftState,
    expectedMarkdown: string,
  ) {
    const attribution = {
      revision: note.operation.revision + 1,
      markdown: expectedMarkdown,
    };
    taskActionAttributions.set(note, attribution);
    return () => {
      if (taskActionAttributions.get(note) === attribution) {
        taskActionAttributions.delete(note);
      }
    };
  }

  return {
    attributeTaskActionSave,
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
