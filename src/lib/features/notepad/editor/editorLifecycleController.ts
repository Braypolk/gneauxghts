import { tick } from 'svelte';
import type { CursorPosition } from '$lib/features/notepad/editor/cursorState';
import { loadCursorPosition, saveCursorPosition } from '$lib/features/notepad/editor/cursorState';
import {
  createEditor as createEditorInstance,
  destroyEditor as destroyEditorInstance,
  prepareEditor,
  readCursorPosition,
  replaceEditorContent as replaceEditorBuffer,
  alignEditorScrollToSelection,
  restoreCursorPosition,
  swapEditorRuntime,
  type EditorController,
  type EditorViewCallbacks,
  type SharedEditorResources
} from '$lib/features/notepad/editor/editor';
import {
  bindSlashMenuViewToPane,
  unbindSlashMenuView
} from '$lib/features/notepad/editor/slashMenuBridge';
import {
  bindSelectionMenuViewToPane,
  unbindSelectionMenuView
} from '$lib/features/notepad/editor/selectionMenuBridge';
import { waitForEditorPaint } from '$lib/features/notepad/navigation/navigation';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import {
  getDocumentNoteId,
  getDocumentPath
} from '$lib/features/notepad/document/documentState';

interface ReplaceEditorContentOptions {
  preserveScroll?: boolean;
  restoreCursor?: boolean;
  cursorPosition?: CursorPosition | null | undefined;
  expectedDocument?: NoteDraftState | null;
  /** When true, do not flip the pane to a loading state while the editor is torn down and recreated. */
  suppressReadyReset?: boolean;
}

interface EditorLifecycleControllerDeps {
  getController: () => EditorController | null;
  getPaneId: () => string;
  setController: (value: EditorController | null) => void;
  getEditorShell: () => HTMLDivElement | null;
  getEditorRoot: () => HTMLDivElement | null;
  getDocumentSession: () => NoteDraftState;
  setIsEditorReady: (value: boolean) => void;
  setIsApplyingExternalContent: (value: boolean) => void;
  handleEditorMarkdownChange: (
    paneId: string,
    document: NoteDraftState,
    nextMarkdown: string
  ) => void;
  getSharedEditorResources: (document: NoteDraftState) => SharedEditorResources;
  getViewCallbacks: () => EditorViewCallbacks;
  closeTransientUi: () => void;
}

export function createEditorLifecycleController({
  getController,
  getPaneId,
  setController,
  getEditorShell,
  getEditorRoot,
  getDocumentSession,
  setIsEditorReady,
  setIsApplyingExternalContent,
  handleEditorMarkdownChange,
  getSharedEditorResources,
  getViewCallbacks,
  closeTransientUi
}: EditorLifecycleControllerDeps) {
  async function destroyEditor() {
    const controller = getController();
    if (controller) {
      unbindSlashMenuView(controller.view);
      unbindSelectionMenuView(controller.view);
    }
    setController(await destroyEditorInstance(controller));
  }

  async function createEditor(initialValue: string) {
    const editorRoot = getEditorRoot();
    if (!(await prepareEditor(editorRoot)) || !editorRoot) {
      return;
    }

    const document = getDocumentSession();

    const controller = await createEditorInstance({
      editorRoot,
      initialValue,
      initialState: null,
      sharedResources: getSharedEditorResources(document),
      viewCallbacks: getViewCallbacks(),
      onMarkdownChange: (nextMarkdown) => {
        // Resolve the pane's note at event time: a save can rekey/replace the
        // note object after the editor is created, and a stale capture would
        // route body edits to an orphaned note (splitting one note into two).
        const liveDocument = getDocumentSession();
        handleEditorMarkdownChange(getPaneId(), liveDocument, nextMarkdown);
      }
    });
    bindSlashMenuViewToPane(controller.view, getPaneId());
    bindSelectionMenuViewToPane(controller.view, getPaneId());
    setController(controller);
    setIsEditorReady(true);
  }

  /**
   * In-place swap of the editor's bound note runtime — replaces the
   * EditorView's state to match `nextDocument`'s content, rebuilds the
   * pane extensions against the new note's [`SharedEditorResources`], and
   * re-binds slash-menu / wikilinks. The EditorView and DOM stay mounted.
   *
   * Returns true on success. The caller should fall back to a full
   * destroy/recreate when this returns false.
   */
  async function swapEditorBuffer(nextDocument: NoteDraftState): Promise<boolean> {
    const controller = getController();
    if (!controller) {
      return false;
    }

    await tick();

    const ok = swapEditorRuntime(controller, {
      sharedResources: getSharedEditorResources(nextDocument),
      initialValue: nextDocument.working.markdown,
      initialState: null,
      viewCallbacks: getViewCallbacks(),
      onMarkdownChange: (nextMarkdown) => {
        const liveDocument = getDocumentSession();
        handleEditorMarkdownChange(getPaneId(), liveDocument, nextMarkdown);
      }
    });
    if (!ok) {
      return false;
    }
    bindSlashMenuViewToPane(controller.view, getPaneId());
    bindSelectionMenuViewToPane(controller.view, getPaneId());
    setIsEditorReady(true);
    return true;
  }

  function saveCursorPositionForDocument(
    document: NoteDraftState = getDocumentSession(),
    position: CursorPosition | null = readCursorPosition(getController())
  ) {
    const path = getDocumentPath(document);
    if (!path || !position) {
      return;
    }

    saveCursorPosition(
      path,
      position,
      getPaneId(),
      getDocumentNoteId(document)
    );
  }

  function restoreEditorScrollTop(scrollTop: number) {
    const scrollEl = getController()?.view.scrollDOM;
    if (!scrollEl) {
      return;
    }

    const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    scrollEl.scrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
  }

  function restoreCursorPositionForDocument(
    document: NoteDraftState = getDocumentSession(),
    position: CursorPosition | null = loadCursorPosition(
      getDocumentPath(document),
      getPaneId(),
      getDocumentNoteId(document)
    )
  ) {
    if (!getDocumentPath(document) || !position) {
      return false;
    }

    return restoreCursorPosition(getController(), position, { scrollIntoView: true });
  }

  async function replaceEditorContent(
    nextMarkdown: string,
    {
      preserveScroll = false,
      restoreCursor = false,
      cursorPosition = undefined,
      expectedDocument = null,
      suppressReadyReset = false
    }: ReplaceEditorContentOptions = {}
  ) {
    if (expectedDocument && getDocumentSession() !== expectedDocument) {
      return;
    }

    const scrollTop = preserveScroll ? (getController()?.view.scrollDOM.scrollTop ?? 0) : 0;
    const document = getDocumentSession();
    const shouldRestoreFocus = restoreCursor && (getController()?.view.hasFocus ?? false);

    if (!suppressReadyReset) {
      setIsEditorReady(false);
    }
    await destroyEditor();

    if (expectedDocument && getDocumentSession() !== expectedDocument) {
      return;
    }

    await createEditor(nextMarkdown);

    if (restoreCursor) {
      if (expectedDocument && getDocumentSession() !== expectedDocument) {
        return;
      }

      const positionToRestore =
        cursorPosition !== undefined
          ? cursorPosition
          : (loadCursorPosition(
              getDocumentPath(document),
              getPaneId(),
              getDocumentNoteId(document)
            ) ?? null);

      const shell = getEditorShell();
      const hideForCursorScroll = Boolean(
        suppressReadyReset && shell && positionToRestore && !preserveScroll
      );

      if (hideForCursorScroll && shell) {
        shell.style.visibility = 'hidden';
        shell.style.pointerEvents = 'none';
      }

      try {
        await waitForEditorPaint();

        if (expectedDocument && getDocumentSession() !== expectedDocument) {
          return;
        }

        if (positionToRestore) {
          restoreCursorPosition(getController(), positionToRestore, { scrollIntoView: false });
          if (!preserveScroll) {
            let aligned = alignEditorScrollToSelection(getController(), 0.25);
            for (let attempt = 0; !aligned && attempt < 8; attempt++) {
              await new Promise<void>((resolve) => {
                requestAnimationFrame(() => resolve());
              });
              getController()?.view.requestMeasure();
              aligned = alignEditorScrollToSelection(getController(), 0.25);
            }
          }
        }

        if (hideForCursorScroll && shell) {
          await tick();
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => resolve());
            });
          });
        }
      } finally {
        if (hideForCursorScroll && shell) {
          shell.style.visibility = '';
          shell.style.pointerEvents = '';
        }
      }
    }

    if (shouldRestoreFocus) {
      getController()?.view.focus();
    }

    if (preserveScroll) {
      await tick();
      restoreEditorScrollTop(scrollTop);
    }
  }

  async function replaceEditorContentInPlaceInternal(
    nextMarkdown: string,
    {
      expectedDocument = null,
      flushHistory = false,
      cursorPosition = readCursorPosition(getController()),
      preserveScroll = false,
      scrollSelectionIntoView = false
    }: {
      expectedDocument?: NoteDraftState | null;
      flushHistory?: boolean;
      cursorPosition?: CursorPosition | null;
      preserveScroll?: boolean;
      scrollSelectionIntoView?: boolean;
    } = {}
  ) {
    if (
      expectedDocument &&
      getDocumentSession() !== expectedDocument
    ) {
      return;
    }

    const controller = getController();
    const scrollTop = preserveScroll
      ? (controller?.view.scrollDOM.scrollTop ?? 0)
      : 0;

    setIsApplyingExternalContent(true);
    try {
      if (
        !replaceEditorBuffer(controller, nextMarkdown, {
          flushHistory
        })
      ) {
        if (
          expectedDocument &&
          getDocumentSession() !== expectedDocument
        ) {
          return;
        }

        setIsApplyingExternalContent(false);
        await replaceEditorContent(nextMarkdown, {
          preserveScroll,
          restoreCursor: Boolean(cursorPosition),
          cursorPosition,
          expectedDocument
        });
        return;
      }

      if (
        expectedDocument &&
        getDocumentSession() !== expectedDocument
      ) {
        return;
      }

      closeTransientUi();
      restoreCursorPosition(controller, cursorPosition, {
        scrollIntoView: scrollSelectionIntoView
      });
      await tick();
      if (preserveScroll) restoreEditorScrollTop(scrollTop);
    } finally {
      setIsApplyingExternalContent(false);
    }
  }

  async function replaceEditorContentInPlace(
    nextMarkdown: string
  ) {
    await replaceEditorContentInPlaceInternal(nextMarkdown, {
      preserveScroll: true
    });
  }

  async function replaceEditorContentInPlaceForDocument(
    nextMarkdown: string,
    document: NoteDraftState
  ) {
    const cursorPosition =
      loadCursorPosition(
        getDocumentPath(document),
        getPaneId(),
        getDocumentNoteId(document)
      ) ?? { anchor: 0, head: 0 };
    await replaceEditorContentInPlaceInternal(nextMarkdown, {
      expectedDocument: document,
      flushHistory: true,
      cursorPosition,
      scrollSelectionIntoView: true
    });
  }

  return {
    destroyEditor,
    createEditor,
    swapEditorBuffer,
    saveCursorPositionForDocument,
    restoreCursorPositionForDocument,
    replaceEditorContent,
    replaceEditorContentInPlace,
    replaceEditorContentInPlaceForDocument
  };
}
