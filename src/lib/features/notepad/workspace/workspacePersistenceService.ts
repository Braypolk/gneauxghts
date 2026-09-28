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
  /** The proposal session retains this working copy without a canonical save. */
  isReviewingDocument?: (document: NoteDraftState) => boolean;
}

/**
 * Coordinates persistence barriers. Editor markdown is already synchronous,
 * so only cursor timers, autosave timers and active save queues need flushing.
 */
export function createWorkspacePersistenceService(
  deps: WorkspacePersistenceServiceDeps
) {
  function needsCanonicalSave(document: NoteDraftState) {
    return !documentHasCleanBuffer(document) && (
      !deps.isReviewingDocument?.(document) ||
      documentHasUnresolvedConflict(document)
    );
  }

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

    // A queue can still be publishing while its shared buffer looks clean.
    await awaitAllSaveQueues();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const pending = documents.filter(needsCanonicalSave);
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

    const unsaved = documents.filter(needsCanonicalSave);
    if (unsaved.length > 0) {
      throw new Error(
        'Some note changes could not be saved before navigation.'
      );
    }
  }

  return {
    flushAllForNavigation
  };
}
