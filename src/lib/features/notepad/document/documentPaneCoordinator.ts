import type { EditorSnapshot } from '$lib/features/notepad/editor/editor';
import type { createEditorLifecycleController } from '$lib/features/notepad/editor/editorLifecycleController';
import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
import {
  cleanupNoteRuntime,
  getSharedEditorState,
  getSharedEditorStateGeneration,
  registerEditorPaneForNote,
  setSharedEditorState,
  setSharedEditorStateGeneration,
  unregisterEditorPaneForNote
} from '$lib/features/notepad/session/noteRuntime';
import type { NoteDraftState, NoteKey } from '$lib/features/notepad/state/noteStore';

type EditorLifecycleController = ReturnType<typeof createEditorLifecycleController>;

export interface DocumentPaneCoordinatorDeps<TPaneId extends string> {
  /** Pane runtimes (one per pane id). */
  getPaneRuntime: (paneId: TPaneId) => PaneRuntime;
  /** Per-pane editor lifecycle controller. */
  getEditorLifecycleController: (paneId: TPaneId) => EditorLifecycleController;
  /** All visible pane ids in workspace order. */
  getVisiblePaneIds: () => TPaneId[];
  /** Pane ids currently bound to a document (editor kind only). */
  getPaneIdsForDocument: (document: NoteDraftState) => TPaneId[];
  /** Pane kind lookup. */
  getPaneKind: (paneId: TPaneId) => 'editor' | 'chat';
  /** Current navigation document (active editor pane's document). */
  getNavigationDocument: () => NoteDraftState;
  /** Current navigation pane id. */
  getNavigationPaneId: () => TPaneId;
  /** Document for a given pane id. */
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  /** Look up a note by key. */
  getNoteByKey: (noteKey: NoteKey) => NoteDraftState | null;
}

/**
 * DocumentPaneCoordinator owns cross-pane document operations:
 *   - replace note content in every pane bound to a document
 *   - flush/restore editor + cursor state across panes
 *   - register/unregister editor panes for documents
 *   - mark editor generations across panes
 *
 * Notepad.svelte previously walked panes/editors itself; this module
 * centralises the orchestration so the component calls high-level
 * operations.
 */
export function createDocumentPaneCoordinator<TPaneId extends string>(
  deps: DocumentPaneCoordinatorDeps<TPaneId>
) {
  function markPaneDocumentGeneration(
    paneId: TPaneId,
    document: NoteDraftState = deps.getPaneDocument(paneId)
  ): void {
    deps.getPaneRuntime(paneId).ui.editorGeneration = getSharedEditorStateGeneration(document);
  }

  function registerPaneEditorForDocument(
    paneId: TPaneId,
    document: NoteDraftState = deps.getPaneDocument(paneId)
  ): void {
    registerEditorPaneForNote(document.key, paneId);
  }

  function unregisterPaneEditorForDocument(
    paneId: TPaneId,
    document: NoteDraftState = deps.getPaneDocument(paneId)
  ): void {
    unregisterEditorPaneForNote(document.key, paneId);
  }

  function flushPaneCursorSave(paneId: TPaneId): void {
    deps.getPaneRuntime(paneId).flushCursorSave(() => {
      deps
        .getEditorLifecycleController(paneId)
        .saveCursorPositionForDocument(deps.getPaneDocument(paneId));
    });
  }

  function schedulePaneCursorSave(paneId: TPaneId): void {
    deps.getPaneRuntime(paneId).scheduleCursorSave(() => {
      deps
        .getEditorLifecycleController(paneId)
        .saveCursorPositionForDocument(deps.getPaneDocument(paneId));
    });
  }

  function flushAllPendingCursorSaves(): void {
    for (const paneId of deps.getVisiblePaneIds()) {
      flushPaneCursorSave(paneId);
    }
  }

  function saveCursorPositionForDocument(
    document: NoteDraftState = deps.getNavigationDocument()
  ): void {
    for (const paneId of deps.getPaneIdsForDocument(document)) {
      deps.getPaneRuntime(paneId).flushCursorSave(() => {
        deps.getEditorLifecycleController(paneId).saveCursorPositionForDocument(document);
      });
    }
  }

  function saveSharedEditorStateForDocument(
    document: NoteDraftState = deps.getNavigationDocument(),
    editorState: EditorSnapshot | null = null,
    preferredPaneId: TPaneId = deps.getNavigationPaneId()
  ): void {
    const paneIds = deps.getPaneIdsForDocument(document);
    const paneId =
      (paneIds.includes(preferredPaneId) ? preferredPaneId : paneIds[0]) ?? null;
    if (!paneId) {
      if (!getSharedEditorState(document) && editorState) {
        setSharedEditorState(document, editorState);
      }
      return;
    }

    if (
      getSharedEditorState(document) &&
      deps.getPaneRuntime(paneId).ui.editorGeneration < getSharedEditorStateGeneration(document)
    ) {
      return;
    }

    deps.getEditorLifecycleController(paneId).saveSharedEditorStateForDocument(
      document,
      editorState
    );
  }

  function discardSharedEditorStateForDocument(document: NoteDraftState): void {
    setSharedEditorState(document, null);
    setSharedEditorStateGeneration(document, 0);
  }

  async function replaceEditorContent(
    nextMarkdown: string,
    options: { preserveScroll?: boolean; restoreCursor?: boolean } = {}
  ): Promise<void> {
    const document = deps.getNavigationDocument();
    for (const paneId of deps.getPaneIdsForDocument(document)) {
      await deps
        .getEditorLifecycleController(paneId)
        .replaceEditorContent(nextMarkdown, options);
    }
  }

  async function replaceEditorContentInPlace(nextMarkdown: string): Promise<void> {
    const document = deps.getNavigationDocument();
    for (const paneId of deps.getPaneIdsForDocument(document)) {
      await deps
        .getEditorLifecycleController(paneId)
        .replaceEditorContentInPlace(nextMarkdown);
    }
  }

  async function replaceNoteAcrossPanes(
    previousNote: NoteDraftState,
    nextNote: NoteDraftState,
    { restoreCursor = false }: { restoreCursor?: boolean } = {}
  ): Promise<void> {
    for (const paneId of deps.getVisiblePaneIds()) {
      if (deps.getPaneKind(paneId) !== 'editor') {
        continue;
      }

      if (deps.getPaneDocument(paneId).key !== nextNote.key) {
        continue;
      }

      const runtime = deps.getPaneRuntime(paneId);
      const lifecycle = deps.getEditorLifecycleController(paneId);

      if (!runtime.controller) {
        markPaneDocumentGeneration(paneId, nextNote);
        continue;
      }

      if (previousNote.key === nextNote.key) {
        // Same note identity — safe in-place buffer replace (avoids full destroy + create).
        await lifecycle.replaceEditorContentInPlaceForDocument(nextNote.bodyMarkdown, nextNote);
      } else {
        // Different note — try an in-place runtime swap first to keep the
        // existing EditorView and DOM mounted. Only fall back to a full
        // destroy + recreate when the swap can't be applied (no live view,
        // detached root, etc.).
        unregisterPaneEditorForDocument(paneId, previousNote);
        const swapped = lifecycle.swapEditorBuffer(nextNote);
        if (swapped) {
          if (runtime.controller) {
            registerPaneEditorForDocument(paneId, nextNote);
          }
          if (restoreCursor) {
            lifecycle.restoreCursorPositionForDocument(nextNote);
          }
        } else {
          await lifecycle.replaceEditorContent(nextNote.bodyMarkdown, {
            restoreCursor,
            suppressReadyReset: true
          });
          if (runtime.controller) {
            registerPaneEditorForDocument(paneId, nextNote);
          }
        }
      }
      markPaneDocumentGeneration(paneId, nextNote);
    }

    if (!deps.getNoteByKey(previousNote.key)) {
      cleanupNoteRuntime(previousNote.key);
    }
  }

  return {
    markPaneDocumentGeneration,
    registerPaneEditorForDocument,
    unregisterPaneEditorForDocument,
    flushPaneCursorSave,
    schedulePaneCursorSave,
    flushAllPendingCursorSaves,
    saveCursorPositionForDocument,
    saveSharedEditorStateForDocument,
    discardSharedEditorStateForDocument,
    replaceEditorContent,
    replaceEditorContentInPlace,
    replaceNoteAcrossPanes
  };
}

export type DocumentPaneCoordinator<TPaneId extends string> = ReturnType<
  typeof createDocumentPaneCoordinator<TPaneId>
>;
