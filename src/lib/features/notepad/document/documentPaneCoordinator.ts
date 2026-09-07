import type {
  PaneEditorLifecycle,
  PaneEditorOperationResult
} from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
import { cleanupNoteRuntime } from '$lib/features/notepad/session/noteRuntime';
import type {
  NoteDraftState,
  DocumentHandle
} from '$lib/features/notepad/state/noteStore';
import type { EditorViewState } from '$lib/features/notepad/editor/editorViewState';
import {
  getPaneIdsWithCapability,
  paneHasCapability
} from '$lib/features/notepad/workspace/paneCapabilities';
import type { PaneKind } from '$lib/features/notepad/workspace/paneTypes';

export interface DocumentPaneCoordinatorDeps<
  TPaneId extends string
> {
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  getPaneRuntime: (paneId: TPaneId) => PaneRuntime;
  getVisiblePaneIds: () => TPaneId[];
  getPaneIdsForDocument: (
    document: NoteDraftState
  ) => TPaneId[];
  getPaneKind: (paneId: TPaneId) => PaneKind;
  getNavigationDocument: () => NoteDraftState;
  getNavigationPaneId: () => TPaneId;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getDocumentByHandle: (documentHandle: DocumentHandle) => NoteDraftState | null;
}

/**
 * Cross-pane cursor and document-binding coordination. The canonical editor
 * runtime performs synchronous same-document fanout, while PaneEditorSession
 * serializes every view transition.
 */
export function createDocumentPaneCoordinator<
  TPaneId extends string
>(deps: DocumentPaneCoordinatorDeps<TPaneId>) {
  const latestViewStateByPane = new Map<
    TPaneId,
    { documentHandle: DocumentHandle; position: EditorViewState }
  >();

  function flushPaneCursorSave(
    paneId: TPaneId
  ): void {
    deps.getPaneRuntime(paneId).flushCursorSave();
  }

  function schedulePaneCursorSave(paneId: TPaneId): void {
    const position = deps.paneLifecycle.captureViewState(paneId);
    const document = deps.getPaneDocument(paneId);
    if (position) {
      latestViewStateByPane.set(paneId, {
        documentHandle: document.handle,
        position
      });
    }
    deps.getPaneRuntime(paneId).scheduleCursorSave(() => {
      void deps.paneLifecycle.saveCursorPosition(
        paneId,
        document,
        position
      );
    });
  }

  function flushAllPendingCursorSaves(): void {
    for (const paneId of deps.getVisiblePaneIds()) {
      flushPaneCursorSave(paneId);
    }
  }

  async function saveCursorPositionForDocument(
    document: NoteDraftState = deps.getNavigationDocument()
  ): Promise<void> {
    await Promise.all(
      deps.getPaneIdsForDocument(document).map((paneId) => {
        let save = Promise.resolve<unknown>(undefined);
        deps.getPaneRuntime(paneId).flushCursorSave(() => {
          save = deps.paneLifecycle.saveCursorPosition(
            paneId,
            document
          );
        });
        return save;
      })
    );
  }

  async function saveCursorPositionForPane(
    paneId: TPaneId,
    document: NoteDraftState = deps.getPaneDocument(paneId)
  ): Promise<void> {
    const captured = latestViewStateByPane.get(paneId);
    const position = captured?.documentHandle === document.handle
      ? captured.position
      : undefined;
    await deps.paneLifecycle.saveCursorPosition(
      paneId,
      document,
      position
    );
    latestViewStateByPane.delete(paneId);
  }

  function preferredEditorPane(
    document: NoteDraftState
  ): TPaneId | null {
    const paneIds = getPaneIdsWithCapability(
      deps.getPaneIdsForDocument(document),
      deps.getPaneKind,
      'edit-document'
    );
    const preferred = deps.getNavigationPaneId();
    return paneIds.includes(preferred)
      ? preferred
      : (paneIds[0] ?? null);
  }

  async function replaceEditorContent(
    nextMarkdown: string,
    options: {
      preserveScroll?: boolean;
      restoreCursor?: boolean;
    } = {}
  ): Promise<void> {
    const paneId = preferredEditorPane(
      deps.getNavigationDocument()
    );
    if (paneId) {
      await deps.paneLifecycle.replaceContent(
        paneId,
        nextMarkdown,
        options
      );
    }
  }

  async function replaceEditorContentInPlace(
    nextMarkdown: string
  ): Promise<void> {
    await replaceDocumentContentInPlace(
      deps.getNavigationDocument(),
      nextMarkdown
    );
  }

  async function replaceDocumentContentInPlace(
    document: NoteDraftState,
    nextMarkdown: string,
    options: { resetUndoHistory?: boolean } = {}
  ): Promise<PaneEditorOperationResult> {
    const paneId = preferredEditorPane(document);
    if (!paneId) return 'unavailable';
    return deps.paneLifecycle.replaceContentInPlace(
      paneId,
      nextMarkdown,
      document,
      true,
      options
    );
  }

  async function replaceNoteAcrossPanes(
    previousNote: NoteDraftState,
    nextNote: NoteDraftState,
    {
      restoreCursor = false,
      cleanupPrevious = true
    }: {
      restoreCursor?: boolean;
      cleanupPrevious?: boolean;
    } = {}
  ): Promise<void> {
    const matching = getPaneIdsWithCapability(
      deps.getVisiblePaneIds(),
      deps.getPaneKind,
      'edit-document'
    ).filter(
      (paneId) =>
        deps.getPaneDocument(paneId).handle === nextNote.handle
    );

    if (previousNote.handle === nextNote.handle) {
      const paneId =
        preferredEditorPane(nextNote) ?? matching[0];
      if (paneId) {
        await deps.paneLifecycle.replaceContentInPlace(
          paneId,
          nextNote.working.markdown,
          nextNote,
          true
        );
      }
    } else {
      for (const paneId of matching) {
        await deps.paneLifecycle.bindDocument(
          paneId,
          nextNote,
          { restoreCursor }
        );
      }
    }

    if (
      cleanupPrevious &&
      !deps.getDocumentByHandle(previousNote.handle)
    ) {
      cleanupNoteRuntime(previousNote.handle);
    }
  }

  async function replacePaneDocument(
    paneId: TPaneId,
    previousNote: NoteDraftState,
    nextNote: NoteDraftState,
    {
      restoreCursor = false
    }: { restoreCursor?: boolean } = {}
  ): Promise<void> {
    if (
      !paneHasCapability(
        deps.getPaneKind(paneId),
        'edit-document'
      )
    ) {
      return;
    }

    if (previousNote.handle === nextNote.handle) {
      await deps.paneLifecycle.replaceContentInPlace(
        paneId,
        nextNote.working.markdown,
        nextNote,
        true
      );
    } else {
      await deps.paneLifecycle.bindDocument(
        paneId,
        nextNote,
        { restoreCursor }
      );
    }

    if (!deps.getDocumentByHandle(previousNote.handle)) {
      cleanupNoteRuntime(previousNote.handle);
    }
  }

  return {
    flushPaneCursorSave,
    schedulePaneCursorSave,
    flushAllPendingCursorSaves,
    saveCursorPositionForDocument,
    saveCursorPositionForPane,
    replaceEditorContent,
    replaceEditorContentInPlace,
    replaceDocumentContentInPlace,
    replacePaneDocument,
    replaceNoteAcrossPanes
  };
}

export type DocumentPaneCoordinator<
  TPaneId extends string
> = ReturnType<typeof createDocumentPaneCoordinator<TPaneId>>;
