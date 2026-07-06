import { documentRegistry } from "$lib/features/notepad/document/documentRegistry";
import {
  shouldSkipAutosave,
  type SessionSnapshot,
} from "$lib/features/notepad/session/session";
import {
  applySnapshotToNote,
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
  rekeyNoteWithRuntime: (
    note: NoteDraftState,
    snapshot: SessionSnapshot,
  ) => NoteDraftState;
  isTitleEditing?: (note: NoteDraftState) => boolean;
  /** @deprecated retained for backward compatibility; per-note timers now live in DocumentRegistry. */
  timers?: Map<NoteKey, number>;
  /** @deprecated retained for backward compatibility; per-note queues now live in DocumentRegistry. */
  queues?: Map<NoteKey, Promise<void>>;
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
    const queue = runtime
      .getSaveQueue()
      .then(operation)
      .catch((error) => {
        console.error("Notepad note operation failed:", error);
        setNoteStatus(note, "error");
      });
    runtime.setSaveQueue(queue);
    return queue;
  }

  async function persistNote(note: NoteDraftState) {
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

    const savedNote = params.rekeyNoteWithRuntime(note, savedSession);
    applySnapshotToNote(savedNote, savedSession, { preserveDraft });
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
