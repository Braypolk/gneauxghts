import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
import { cleanupNoteRuntime } from '$lib/features/notepad/session/noteRuntime';
import type {
  NoteDraftState,
  NoteKey
} from '$lib/features/notepad/state/noteStore';

export interface DocumentPaneCoordinatorDeps<
  TPaneId extends string
> {
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  getPaneRuntime: (paneId: TPaneId) => PaneRuntime;
  getVisiblePaneIds: () => TPaneId[];
  getPaneIdsForDocument: (
    document: NoteDraftState
  ) => TPaneId[];
  getPaneKind: (paneId: TPaneId) => 'editor' | 'chat';
  getNavigationDocument: () => NoteDraftState;
  getNavigationPaneId: () => TPaneId;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getNoteByKey: (noteKey: NoteKey) => NoteDraftState | null;
}

/**
 * Cross-pane cursor and document-binding coordination. The canonical editor
 * runtime performs synchronous same-document fanout, while PaneEditorSession
 * serializes every view transition.
 */
export function createDocumentPaneCoordinator<
  TPaneId extends string
>(deps: DocumentPaneCoordinatorDeps<TPaneId>) {
  function flushPaneCursorSave(paneId: TPaneId): void {
    deps.getPaneRuntime(paneId).flushCursorSave(() => {
      void deps.paneLifecycle.saveCursorPosition(
        paneId,
        deps.getPaneDocument(paneId)
      );
    });
  }

  function schedulePaneCursorSave(paneId: TPaneId): void {
    deps.getPaneRuntime(paneId).scheduleCursorSave(() => {
      void deps.paneLifecycle.saveCursorPosition(
        paneId,
        deps.getPaneDocument(paneId)
      );
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
        void deps.paneLifecycle.saveCursorPosition(
          paneId,
          document
        );
      });
    }
  }

  function preferredEditorPane(
    document: NoteDraftState
  ): TPaneId | null {
    const paneIds = deps
      .getPaneIdsForDocument(document)
      .filter(
        (paneId) => deps.getPaneKind(paneId) === 'editor'
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
    const paneId = preferredEditorPane(
      deps.getNavigationDocument()
    );
    if (paneId) {
      await deps.paneLifecycle.replaceContentInPlace(
        paneId,
        nextMarkdown
      );
    }
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
    const matching = deps
      .getVisiblePaneIds()
      .filter(
        (paneId) =>
          deps.getPaneKind(paneId) === 'editor' &&
          deps.getPaneDocument(paneId).key === nextNote.key
      );

    if (previousNote.key === nextNote.key) {
      const paneId =
        preferredEditorPane(nextNote) ?? matching[0];
      if (paneId) {
        await deps.paneLifecycle.replaceContentInPlace(
          paneId,
          nextNote.bodyMarkdown,
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
      !deps.getNoteByKey(previousNote.key)
    ) {
      cleanupNoteRuntime(previousNote.key);
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
    if (deps.getPaneKind(paneId) !== 'editor') return;

    if (previousNote.key === nextNote.key) {
      await deps.paneLifecycle.replaceContentInPlace(
        paneId,
        nextNote.bodyMarkdown,
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

    if (!deps.getNoteByKey(previousNote.key)) {
      cleanupNoteRuntime(previousNote.key);
    }
  }

  return {
    flushPaneCursorSave,
    schedulePaneCursorSave,
    flushAllPendingCursorSaves,
    saveCursorPositionForDocument,
    replaceEditorContent,
    replaceEditorContentInPlace,
    replacePaneDocument,
    replaceNoteAcrossPanes
  };
}

export type DocumentPaneCoordinator<
  TPaneId extends string
> = ReturnType<typeof createDocumentPaneCoordinator<TPaneId>>;
