import { documentRegistry } from '#lib/features/notepad/document/documentRegistry.js';
import {
  documentHasCleanBuffer,
  documentHasUnresolvedConflict
} from '#lib/features/notepad/document/documentState.js';
import type { NoteDraftState } from '#lib/features/notepad/state/noteStore.js';

export interface WorkspacePersistenceServiceDeps {
  flushAllPaneCursorSaves: () => void;
  getDocuments: () => Iterable<NoteDraftState>;
  cancelPendingAutosave: (document: NoteDraftState) => void;
  enqueueSave: (document: NoteDraftState) => Promise<void>;
  flushRecoveryCopies?: () => Promise<void>;
}

/**
 * Coordinates persistence barriers. Editor markdown is already synchronous,
 * so only cursor timers, autosave timers and active save queues need flushing.
 */
export function createWorkspacePersistenceService(
  deps: WorkspacePersistenceServiceDeps
) {
  function needsCanonicalSave(document: NoteDraftState) {
    return !documentHasCleanBuffer(document);
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

    const recovery = Promise.resolve().then(() => deps.flushRecoveryCopies?.()).catch(() => undefined);
    try { await flushCanonicalDocuments(documents); }
    finally { await recovery; }
  }

  async function flushCanonicalDocuments(documents: NoteDraftState[]): Promise<void> {
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

  /** Backgrounding cannot be vetoed; one blocked note must not delay the rest. */
  async function flushAllForBackground(): Promise<void> {
    const recovery = Promise.resolve().then(() => deps.flushRecoveryCopies?.()).catch(() => undefined);
    try { await flushForBackground(); }
    finally { await recovery; }
  }

  async function flushForBackground(): Promise<void> {
    deps.flushAllPaneCursorSaves();
    const documents = [...deps.getDocuments()];
    for (const document of documents) deps.cancelPendingAutosave(document);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const results = await Promise.allSettled(documents.map((document) => {
        if (needsCanonicalSave(document) && !documentHasUnresolvedConflict(document)) {
          return deps.enqueueSave(document);
        }
        return documentRegistry.get(document.handle)?.getSaveQueue() ?? Promise.resolve();
      }));
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      const pending = documents.filter(needsCanonicalSave);
      if (pending.length === 0) return;
      if (pending.every(documentHasUnresolvedConflict)) break;
    }
    throw new Error('Some note changes remain unsaved after backgrounding. Resolve any note conflicts or save errors.');
  }

  return {
    flushAllForNavigation,
    flushAllForBackground
  };
}
