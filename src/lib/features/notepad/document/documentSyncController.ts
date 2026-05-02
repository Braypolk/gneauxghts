import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import {
  getEditorPaneCountForNote,
  getSharedEditorState,
  getSharedEditorStateGeneration
} from '$lib/features/notepad/session/noteRuntime';
import type { NoteDraftState, NoteKey } from '$lib/features/notepad/state/noteStore';

export interface DocumentSyncDeps<TPaneId extends string> {
  /** All pane ids (primary + secondary) currently bound to a document. */
  getPaneIdsForDocument: (document: NoteDraftState) => TPaneId[];
  /** Per-pane editor generation cursor. */
  getPaneEditorGeneration: (paneId: TPaneId) => number;
  setPaneEditorGeneration: (paneId: TPaneId, value: number) => void;
  /** Whether a pane has an attached EditorController. */
  hasController: (paneId: TPaneId) => boolean;
  /** Apply the shared snapshot through the pane's editor lifecycle. */
  applySharedEditorState: (paneId: TPaneId, document: NoteDraftState) => boolean;
  /** All NoteKeys currently referenced by any pane. */
  listReferencedNoteKeys: () => NoteKey[];
  /** Look up a note by NoteKey. */
  getNoteByKey: (noteKey: NoteKey) => NoteDraftState | null;
}

/**
 * DocumentSyncController batches per-document editor-state syncs that
 * fan out to every pane currently bound to that document. The original
 * implementation lived inline in Notepad.svelte as
 * flushDocumentEditorSync / scheduleDocumentEditorSync /
 * flushAllPendingDocumentSyncs; this module owns the same orchestration
 * but stores the rAF id on the per-document runtime via the registry.
 */
export function createDocumentSyncController<TPaneId extends string>(
  deps: DocumentSyncDeps<TPaneId>
) {
  function markPaneDocumentGeneration(paneId: TPaneId, document: NoteDraftState): void {
    deps.setPaneEditorGeneration(paneId, getSharedEditorStateGeneration(document));
  }

  function flushDocumentEditorSync(document: NoteDraftState): void {
    documentRegistry.get(document.key)?.clearSyncFrame();

    if (getEditorPaneCountForNote(document.key) > 0) {
      return;
    }

    const sharedEditorState = getSharedEditorState(document);
    if (!sharedEditorState) {
      return;
    }

    for (const paneId of deps.getPaneIdsForDocument(document)) {
      if (deps.getPaneEditorGeneration(paneId) >= getSharedEditorStateGeneration(document)) {
        continue;
      }

      if (!deps.hasController(paneId)) {
        markPaneDocumentGeneration(paneId, document);
        continue;
      }

      if (deps.applySharedEditorState(paneId, document)) {
        markPaneDocumentGeneration(paneId, document);
      }
    }
  }

  function scheduleDocumentEditorSync(document: NoteDraftState): void {
    const runtime = documentRegistry.ensure(document.key);
    if (runtime.hasSyncFrame()) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      runtime.clearSyncFrame();
      flushDocumentEditorSync(document);
    });
    runtime.setSyncFrame(frameId);
  }

  function hasPendingSync(document: NoteDraftState): boolean {
    return documentRegistry.get(document.key)?.hasSyncFrame() ?? false;
  }

  function flushAllPendingDocumentSyncs(): void {
    const noteKeys = new Set<NoteKey>(deps.listReferencedNoteKeys());
    for (const noteKey of noteKeys) {
      const document = deps.getNoteByKey(noteKey);
      if (document) {
        flushDocumentEditorSync(document);
      }
    }
  }

  return {
    flushDocumentEditorSync,
    scheduleDocumentEditorSync,
    flushAllPendingDocumentSyncs,
    hasPendingSync,
    markPaneDocumentGeneration
  };
}
