import {
  shouldSkipAutosave,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';
import {
  applySnapshotToNote,
  setNoteStatus,
  type NoteDraftState,
  type NoteKey
} from '$lib/features/notepad/state/noteStore';

export interface PersistenceControllerParams {
  getDocumentSession: () => NoteDraftState;
  timers: Map<NoteKey, ReturnType<typeof window.setTimeout>>;
  queues: Map<NoteKey, Promise<void>>;
  saveNoteSession: (
    title: string,
    markdown: string,
    currentPath: string | null
  ) => Promise<SessionSnapshot>;
  rekeyNoteWithRuntime: (note: NoteDraftState, snapshot: SessionSnapshot) => NoteDraftState;
  scheduleAutoSync: (reason: string, delayMs?: number) => void;
}

export function createNotepadPersistenceController(params: PersistenceControllerParams) {
  function hasCleanBuffer(note: NoteDraftState = params.getDocumentSession()) {
    return shouldSkipAutosave(
      note.title,
      note.bodyMarkdown,
      note.currentNoteId,
      note.currentNotePath,
      note
    );
  }

  function invalidatePendingSaveResults(note: NoteDraftState = params.getDocumentSession()) {
    note.operationRevision += 1;
  }

  function getNoteSaveQueue(noteKey: NoteKey) {
    return params.queues.get(noteKey) ?? Promise.resolve();
  }

  function queueNoteOperation(note: NoteDraftState, operation: () => Promise<void>) {
    const queue = getNoteSaveQueue(note.key)
      .then(operation)
      .catch((error) => {
        console.error('Notepad note operation failed:', error);
        setNoteStatus(note, 'error');
      });
    params.queues.set(note.key, queue);
    return queue;
  }

  async function persistNote(note: NoteDraftState) {
    const operationRevision = note.operationRevision;
    const title = note.title;
    const markdown = note.bodyMarkdown;
    const currentNoteId = note.currentNoteId;
    const currentNotePath = note.currentNotePath;

    if (shouldSkipAutosave(title, markdown, currentNoteId, currentNotePath, note)) {
      return;
    }

    setNoteStatus(note, 'saving');
    const savedSession = await params.saveNoteSession(title, markdown, currentNotePath);
    if (note.operationRevision !== operationRevision) {
      return;
    }

    const preserveDraft =
      note.title !== title ||
      note.bodyMarkdown !== markdown ||
      note.currentNoteId !== currentNoteId ||
      note.currentNotePath !== currentNotePath;

    const savedNote = params.rekeyNoteWithRuntime(note, savedSession);
    applySnapshotToNote(savedNote, savedSession, { preserveDraft });
    setNoteStatus(savedNote, 'idle');
    params.scheduleAutoSync('note-saved', 600);
  }

  function cancelPendingAutosave(note: NoteDraftState = params.getDocumentSession()) {
    const pendingTimer = params.timers.get(note.key);
    if (!pendingTimer) {
      return;
    }

    window.clearTimeout(pendingTimer);
    params.timers.delete(note.key);
  }

  function scheduleAutosave(note: NoteDraftState = params.getDocumentSession()) {
    cancelPendingAutosave(note);
    params.timers.set(
      note.key,
      window.setTimeout(() => {
        params.timers.delete(note.key);
        void enqueueSave(note);
      }, 1000)
    );
  }

  async function enqueueSave(note: NoteDraftState = params.getDocumentSession()) {
    return queueNoteOperation(note, () => persistNote(note));
  }

  function flushPendingAutosave(note: NoteDraftState = params.getDocumentSession()) {
    const pendingTimer = params.timers.get(note.key);
    if (!pendingTimer) {
      return;
    }

    window.clearTimeout(pendingTimer);
    params.timers.delete(note.key);
    void enqueueSave(note);
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
    scheduleAutosave
  };
}
