import { documentRegistry } from "$lib/features/notepad/document/documentRegistry";
import {
  shouldSkipAutosave,
  type SessionSnapshot,
} from "$lib/features/notepad/session/session";
import {
  setNoteStatus,
  type NoteDraftState,
  type NoteKey,
} from "$lib/features/notepad/state/noteStore";

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
    return shouldSkipAutosave(
      note.title,
      note.bodyMarkdown,
      note.currentNoteId,
      note.currentNotePath,
      note,
    );
  }

  function invalidatePendingSaveResults(
    note: NoteDraftState = params.getDocumentSession(),
  ) {
    note.saveInvalidation += 1;
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
        setNoteStatus(note, "error");
      }
    });
  }

  async function persistNote(note: NoteDraftState) {
    if (params.shouldSuppressPersistence?.(note)) {
      return;
    }
    const saveInvalidation = note.saveInvalidation;
    const title = note.title;
    const markdown = note.bodyMarkdown;
    const currentNoteId = note.currentNoteId;
    const currentNotePath = note.currentNotePath;

    if (
      shouldSkipAutosave(title, markdown, currentNoteId, currentNotePath, note)
    ) {
      return;
    }

    setNoteStatus(note, "saving");
    const savedSession = await params.saveNoteSession(
      title,
      markdown,
      currentNotePath,
    );
    if (note.saveInvalidation !== saveInvalidation) {
      return;
    }

    const preserveDraft =
      note.title !== title ||
      note.bodyMarkdown !== markdown ||
      note.currentNoteId !== currentNoteId ||
      note.currentNotePath !== currentNotePath ||
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
    setNoteStatus(savedNote, "idle");
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
        void enqueueSave(note);
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
    void enqueueSave(note);
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
