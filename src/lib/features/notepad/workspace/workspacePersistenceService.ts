import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
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
    await Promise.all(documents.map((document) => deps.enqueueSave(document)));
    await awaitAllSaveQueues();
  }

  return {
    awaitAllSaveQueues,
    flushAllForNavigation
  };
}
