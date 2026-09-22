import type { TagEdit } from "../session/session";
import type { HistoryReadiness } from "$lib/contracts/historyReadiness";
import { documentRegistry } from "$lib/features/notepad/document/documentRegistry";
import type { NoteSession } from "$lib/features/notepad/model/types";
import type { DocumentEditingService } from "$lib/features/notepad/document/documentEditingService";
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
  type DocumentHandle,
} from "$lib/features/notepad/document/documentState";

export interface PersistenceControllerParams {
  getDocumentSession: () => NoteDraftState;
  saveNoteSession: (
    title: string,
    markdown: string,
    currentPath: string | null,
    tagEdit?: TagEdit,
  ) => Promise<NoteSession>;
  saveTaskNoteSession?: (
    title: string,
    markdown: string,
    currentPath: string | null,
    tagEdit?: TagEdit,
  ) => Promise<NoteSession>;
  loadHistoryReadiness?: (noteId: string | null) => Promise<HistoryReadiness>;
  markNoteOpened?: (noteId: string) => Promise<void>;
  isActiveNote?: (note: NoteDraftState) => boolean;
  documentEditing: Pick<
    DocumentEditingService<string>,
    "captureSave" | "adoptSavedResult"
  >;
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

  function getNoteSaveQueue(documentHandle: NoteDraftState["handle"]) {
    return documentRegistry.get(documentHandle)?.getSaveQueue() ?? Promise.resolve();
  }

  function queueNoteOperation(
    note: NoteDraftState,
    operation: () => Promise<void>,
  ) {
    const runtime = documentRegistry.ensure(note.handle);
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
    const capture = params.documentEditing.captureSave(note);
    const save = isAttributedTaskAction
      ? params.saveTaskNoteSession
      : params.saveNoteSession;
    if (!save) {
      throw new Error("Task note persistence is not configured");
    }
    // Start the authoritative IPC immediately. Observation never gates or
    // retries publication and must not change its result (including warnings).
    const saving = capture.tagEdit
      ? save(title, markdown, capture.path, capture.tagEdit)
      : save(title, markdown, capture.path);
    const stopObserving = observePendingSave(
      note,
      capture.operationToken,
      capture.noteId,
    );
    let savedSession: NoteSession;
    try {
      savedSession = await saving;
    } finally {
      stopObserving();
    }
    if (
      isAttributedTaskAction &&
      taskActionAttributions.get(note) === taskAttribution
    ) {
      taskActionAttributions.delete(note);
    }
    const savedNote = await params.documentEditing.adoptSavedResult(
      capture,
      savedSession,
    );
    if (!savedNote) return;
    if (savedSession.commitWarning) {
      console.warn(
        "Note was saved, but required projections need repair:",
        savedSession.commitWarning,
      );
    }
    if (
      capture.path === null &&
      savedSession.noteId &&
      (params.isActiveNote?.(savedNote) ?? true)
    ) {
      try {
        await params.markNoteOpened?.(savedSession.noteId);
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
          ? capture.operationToken
          : savedNote.operation.token,
    });
  }

  function observePendingSave(note: NoteDraftState, token: number, noteId: string | null) {
    const observe = params.loadHistoryReadiness;
    if (!observe) return () => undefined;
    let stopped = false;
    let identity: Pick<HistoryReadiness, 'scope' | 'revision'> | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const current = () => !stopped && note.operation.kind === "saving" &&
      isDocumentOperationCurrent(note, token) && getDocumentNoteId(note) === noteId;
    const poll = async () => {
      if (!current()) return;
      try {
        const readiness = await observe(noteId);
        if (!current() || readiness.noteId !== noteId) return;
        if (identity && (identity.scope !== readiness.scope || identity.revision !== readiness.revision)) {
          dispatchDocumentOperation(note, { type: "savingProgress", token });
          return;
        }
        identity = readiness;
        // A draft has no target identity to observe. Its null-ID snapshot can
        // describe vault recovery, but cannot describe the generated note's check.
        dispatchDocumentOperation(note, {
          type: "savingProgress", token,
          waitReason: readiness.state === 'recoveryPending' ? 'recovery'
            : readiness.state === 'targetVerificationPending' ? (noteId === null ? undefined : 'verification')
            : readiness.state === 'ready' ? undefined : readiness.state,
        });
        timer = setTimeout(() => void poll(), 250);
      } catch {
        // Advisory observation may be unavailable even when the save succeeds.
        if (current()) dispatchDocumentOperation(note, { type: "savingProgress", token });
      }
    };
    // Fast saves need no extra IPC. A pending observer never overlaps another.
    timer = setTimeout(() => void poll(), 250);
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (isDocumentOperationCurrent(note, token)) {
        dispatchDocumentOperation(note, { type: "savingProgress", token });
      }
    };
  }

  function cancelPendingAutosave(
    note: NoteDraftState = params.getDocumentSession(),
  ) {
    documentRegistry.get(note.handle)?.clearSaveTimer();
  }

  function scheduleAutosave(
    note: NoteDraftState = params.getDocumentSession(),
  ) {
    const runtime = documentRegistry.ensure(note.handle);
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
    const runtime = documentRegistry.get(note.handle);
    if (!runtime || runtime.getSaveTimer() === null) {
      return;
    }

    runtime.clearSaveTimer();
    void enqueueSave(note).catch(() => undefined);
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
    scheduleAutosave,
  };
}
