import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import type { NoteDraftState, NoteKey } from '$lib/features/notepad/state/noteStore';

export interface WorkspacePersistenceServiceDeps {
  /** Iterate every NoteKey currently held in panes. */
  listReferencedNoteKeys: () => NoteKey[];
  /** Look up a note by NoteKey (for documents currently visible). */
  getNoteByKey: (noteKey: NoteKey) => NoteDraftState | null;
  /** Flush a single document's pending editor sync (rAF). */
  flushDocumentEditorSync: (document: NoteDraftState) => void;
  /** Flush each pane's pending cursor save (calls back per pane). */
  flushAllPaneCursorSaves: () => void;
  /** Flush the autosave timer for a single document or the active document. */
  flushPendingAutosave: (document?: NoteDraftState) => void;
  /** Cancel the autosave timer for a single document or the active document. */
  cancelPendingAutosave: (document?: NoteDraftState) => void;
  /** Enqueue a save for the given document. */
  enqueueSave: (document?: NoteDraftState) => Promise<void>;
}

/**
 * WorkspacePersistenceService consolidates the cross-document flush
 * sequences that previously lived as ad-hoc helpers in Notepad.svelte:
 *
 *   - flushAllPendingDocumentSyncs (every NoteKey)
 *   - flushAllPendingCursorSaves (every pane)
 *   - quitFlush (the onMount cleanup sequence)
 *   - registerPendingNoteSaveHandler body
 *
 * It does not own state — it operates on the DocumentRegistry and the deps
 * the caller provides. This keeps the Notepad.svelte cleanup paths short.
 */
export function createWorkspacePersistenceService(deps: WorkspacePersistenceServiceDeps) {
  function flushAllPendingDocumentSyncs(): void {
    const keys = new Set<NoteKey>(deps.listReferencedNoteKeys());
    for (const noteKey of keys) {
      const document = deps.getNoteByKey(noteKey);
      if (document) {
        deps.flushDocumentEditorSync(document);
      }
    }
  }

  /** Flush every running save queue and await them. */
  async function awaitAllSaveQueues(): Promise<void> {
    const queues: Promise<void>[] = [];
    for (const runtime of documentRegistry.values()) {
      queues.push(runtime.getSaveQueue());
    }
    await Promise.all(queues);
  }

  /**
   * Flush the full set: pending syncs, pending cursor saves, pending
   * autosave, and await every running save queue. Used by:
   *   - registerPendingNoteSaveHandler (navigation)
   *   - rememberCurrentNote
   */
  async function flushAllForNavigation(): Promise<void> {
    flushAllPendingDocumentSyncs();
    deps.flushAllPaneCursorSaves();
    deps.cancelPendingAutosave();
    await deps.enqueueSave();
    await awaitAllSaveQueues();
  }

  return {
    flushAllPendingDocumentSyncs,
    awaitAllSaveQueues,
    flushAllForNavigation
  };
}
