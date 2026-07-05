import { tick } from 'svelte';
import type { CursorPosition } from '$lib/features/notepad/editor/cursorState';
import { loadCursorPosition, saveCursorPosition } from '$lib/features/notepad/editor/cursorState';
import {
  createEditor as createEditorInstance,
  destroyEditor as destroyEditorInstance,
  prepareEditor,
  readCursorPosition,
  readEditorState,
  replaceEditorContent as replaceEditorBuffer,
  replaceEditorDocument,
  alignEditorScrollToSelection,
  restoreCursorPosition,
  swapEditorRuntime,
  type EditorController,
  type EditorSnapshot,
  type EditorViewCallbacks,
  type SharedEditorResources
} from '$lib/features/notepad/editor/editor';
import {
  bindSlashMenuViewToPane,
  unbindSlashMenuView
} from '$lib/features/notepad/editor/slashMenuBridge';
import { waitForEditorPaint } from '$lib/features/notepad/navigation/navigation';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';

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
  getShellElement: () => HTMLDivElement | null;
  getEditorShell: () => HTMLDivElement | null;
  getEditorRoot: () => HTMLDivElement | null;
  getDocumentSession: () => NoteDraftState;
  getSharedEditorState: (document: NoteDraftState) => EditorSnapshot | null;
  setSharedEditorState: (document: NoteDraftState, editorState: EditorSnapshot | null) => void;
  setIsEditorReady: (value: boolean) => void;
  setIsApplyingExternalContent: (value: boolean) => void;
  handleEditorMarkdownChange: (
    paneId: string,
    document: NoteDraftState,
    nextMarkdown: string,
    editorState: EditorSnapshot | null
  ) => void;
  getSharedEditorResources: (document: NoteDraftState) => SharedEditorResources;
  getViewCallbacks: () => EditorViewCallbacks;
  closeTransientUi: () => void;
}

export function createEditorLifecycleController({
  getController,
  getPaneId,
  setController,
  getShellElement,
  getEditorShell,
  getEditorRoot,
  getDocumentSession,
  getSharedEditorState,
  setSharedEditorState,
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
        const editorState = readEditorState(getController());
        handleEditorMarkdownChange(getPaneId(), liveDocument, nextMarkdown, editorState);
        saveSharedEditorStateForDocument(liveDocument, editorState);
      }
    });
    bindSlashMenuViewToPane(controller.view, getPaneId());
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
      initialValue: nextDocument.bodyMarkdown,
      initialState: null,
      viewCallbacks: getViewCallbacks(),
      onMarkdownChange: (nextMarkdown) => {
        const liveDocument = getDocumentSession();
        const editorState = readEditorState(getController());
        handleEditorMarkdownChange(getPaneId(), liveDocument, nextMarkdown, editorState);
        saveSharedEditorStateForDocument(liveDocument, editorState);
      }
    });
    if (!ok) {
      return false;
    }
    bindSlashMenuViewToPane(controller.view, getPaneId());
    setIsEditorReady(true);
    return true;
  }

  function saveCursorPositionForDocument(
    document: NoteDraftState = getDocumentSession(),
    position: CursorPosition | null = readCursorPosition(getController())
  ) {
    if (!document.currentNotePath || !position) {
      return;
    }

    saveCursorPosition(document.currentNotePath, position, getPaneId(), document.currentNoteId);
  }

  function saveSharedEditorStateForDocument(
    document: NoteDraftState = getDocumentSession(),
    editorState: EditorSnapshot | null = readEditorState(getController())
  ) {
    setSharedEditorState(document, editorState);
  }

  function getSharedEditorStateForDocument(document: NoteDraftState) {
    return getSharedEditorState(document);
  }

  function discardSharedEditorStateForDocument(document: NoteDraftState) {
    setSharedEditorState(document, null);
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
      document.currentNotePath,
      getPaneId(),
      document.currentNoteId
    )
  ) {
    if (!document.currentNotePath || !position) {
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
              document.currentNotePath,
              getPaneId(),
              document.currentNoteId
            ) ?? getSharedEditorStateForDocument(document)?.selection ?? null);

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
            let aligned = alignEditorScrollToSelection(getController(), shell, 0.25);
            for (let attempt = 0; !aligned && attempt < 8; attempt++) {
              await new Promise<void>((resolve) => {
                requestAnimationFrame(() => resolve());
              });
              getController()?.view.requestMeasure();
              aligned = alignEditorScrollToSelection(getController(), shell, 0.25);
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

  async function replaceEditorContentInPlace(nextMarkdown: string) {
    const controller = getController();
    const cursorPosition = readCursorPosition(controller);
    const scrollTop = controller?.view.scrollDOM.scrollTop ?? 0;

    setIsApplyingExternalContent(true);
    try {
      if (!replaceEditorBuffer(controller, nextMarkdown)) {
        setIsApplyingExternalContent(false);
        await replaceEditorContent(nextMarkdown, {
          preserveScroll: true,
          restoreCursor: !!cursorPosition,
          cursorPosition
        });
        return;
      }

      saveSharedEditorStateForDocument();
      closeTransientUi();
      restoreCursorPosition(controller, cursorPosition, { scrollIntoView: false });
      await tick();

      restoreEditorScrollTop(scrollTop);
    } finally {
      setIsApplyingExternalContent(false);
    }
  }

  async function replaceEditorContentInPlaceForDocument(
    nextMarkdown: string,
    document: NoteDraftState
  ) {
    if (getDocumentSession() !== document) {
      return;
    }

    const controller = getController();
    const cursorPosition =
      loadCursorPosition(document.currentNotePath, getPaneId(), document.currentNoteId) ??
      getSharedEditorStateForDocument(document)?.selection ?? { anchor: 0, head: 0 };

    setIsApplyingExternalContent(true);
    try {
      if (!replaceEditorBuffer(controller, nextMarkdown, { flushHistory: true })) {
        if (getDocumentSession() !== document) {
          return;
        }

        setIsApplyingExternalContent(false);
        await replaceEditorContent(nextMarkdown, {
          restoreCursor: true,
          cursorPosition,
          expectedDocument: document
        });
        return;
      }

      if (getDocumentSession() !== document) {
        return;
      }

      saveSharedEditorStateForDocument(document);
      closeTransientUi();
      restoreCursorPosition(controller, cursorPosition);
      await tick();
    } finally {
      setIsApplyingExternalContent(false);
    }
  }

  async function restoreSharedEditorStateForDocument(document: NoteDraftState) {
    if (getDocumentSession() !== document) {
      return false;
    }

    const sharedEditorState = getSharedEditorStateForDocument(document);
    const persistedCursor = loadCursorPosition(
      document.currentNotePath,
      getPaneId(),
      document.currentNoteId
    );
    const selectionToRestore = persistedCursor ?? sharedEditorState?.selection ?? null;
    if (
      !replaceEditorDocument(getController(), sharedEditorState?.markdown ?? null, {
        anchor: selectionToRestore?.anchor ?? null,
        head: selectionToRestore?.head ?? null,
        focus: false,
        scrollSelectionIntoView: false
      })
    ) {
      return false;
    }

    if (getDocumentSession() !== document) {
      return false;
    }

    restoreCursorPosition(getController(), selectionToRestore);
    await tick();
    return getDocumentSession() === document;
  }

  function applySharedEditorStateForDocument(document: NoteDraftState) {
    if (getDocumentSession() !== document) {
      return false;
    }

    const sharedEditorState = getSharedEditorStateForDocument(document);
    if (!sharedEditorState) {
      return false;
    }

    const controller = getController();
    const scrollTop = controller?.view.scrollDOM.scrollTop ?? 0;
    const cursorPosition = readCursorPosition(controller);

    setIsApplyingExternalContent(true);
    try {
      if (
        !replaceEditorDocument(controller, sharedEditorState.markdown, {
          anchor: cursorPosition?.anchor ?? null,
          head: cursorPosition?.head ?? null,
          focus: false,
          scrollSelectionIntoView: false
        })
      ) {
        return false;
      }

      closeTransientUi();
      restoreEditorScrollTop(scrollTop);
      return true;
    } finally {
      setIsApplyingExternalContent(false);
    }
  }

  function dispose() {}

  return {
    destroyEditor,
    createEditor,
    swapEditorBuffer,
    saveCursorPositionForDocument,
    saveSharedEditorStateForDocument,
    discardSharedEditorStateForDocument,
    restoreCursorPositionForDocument,
    replaceEditorContent,
    replaceEditorContentInPlace,
    replaceEditorContentInPlaceForDocument,
    restoreSharedEditorStateForDocument,
    applySharedEditorStateForDocument,
    dispose
  };
}
