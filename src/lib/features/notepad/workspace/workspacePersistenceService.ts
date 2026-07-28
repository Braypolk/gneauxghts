import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import {
  documentHasCleanBuffer,
  documentHasUnresolvedConflict
} from '$lib/features/notepad/document/documentState';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';

export interface WorkspacePersistenceServiceDeps {
  flushAllPaneCursorSaves: () => void;
  getDocuments: () => Iterable<NoteDraftState>;
  cancelPendingAutosave: (document: NoteDraftState) => void;
  enqueueSave: (document: NoteDraftState) => Promise<void>;
}

/**
 * Coordinates persistence barriers. Editor markdown is already synchronous,
 * so only cursor timers, autosave timers and active save queues need flushing.
 */
export function createWorkspacePersistenceService(
  deps: WorkspacePersistenceServiceDeps
) {
  async function awaitAllSaveQueues(): Promise<void> {
    await Promise.all(
      [...documentRegistry.values()].map((runtime) => runtime.getSaveQueue())
    );
  }

  async function flushAllForNavigation(): Promise<void> {
    deps.flushAllPaneCursorSaves();
    const documents = [...deps.getDocuments()];
    for (const document of documents) {
      deps.cancelPendingAutosave(document);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const pending = documents.filter(
        (document) => !documentHasCleanBuffer(document)
      );
      if (pending.length === 0) return;
      const conflict = pending.find(documentHasUnresolvedConflict);
      if (conflict) {
        throw new Error(
          'Resolve the note’s external-change conflict before leaving the editor.'
        );
      }

      await Promise.all(
        pending.map((document) => deps.enqueueSave(document))
      );
      await awaitAllSaveQueues();
    }

    const unsaved = documents.filter(
      (document) => !documentHasCleanBuffer(document)
    );
    if (unsaved.length > 0) {
      throw new Error(
        'Some note changes could not be saved before navigation.'
      );
    }
  }

  return {
    awaitAllSaveQueues,
    flushAllForNavigation
  };
}
