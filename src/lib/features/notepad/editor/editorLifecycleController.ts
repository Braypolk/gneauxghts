import { tick } from 'svelte';
import type {
  CursorPosition,
  EditorViewState
} from '$lib/features/notepad/editor/editorViewState';
import {
  loadEditorViewState,
  saveEditorViewState
} from '$lib/features/notepad/editor/editorViewState';
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

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    resolve();
  });
}

interface ReplaceEditorContentOptions {
  preserveScroll?: boolean;
  restoreCursor?: boolean;
  cursorPosition?: EditorViewState | null | undefined;
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
  setIsApplyingProgrammaticUpdate: (value: boolean) => void;
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
  setIsApplyingProgrammaticUpdate,
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
    position: EditorViewState | null = captureEditorViewState()
  ) {
    const path = getDocumentPath(document);
    if (!path || !position) {
      return;
    }

    // Scroll is a live viewport fact rather than something callers know, so it
    // is always read from the editor even when the selection was passed in.
    const scrollTop = position.scrollTop ?? getController()?.view.scrollDOM.scrollTop;

    saveEditorViewState(
      path,
      {
        anchor: position.anchor,
        head: position.head,
        ...(typeof scrollTop === 'number' ? { scrollTop } : {})
      },
      getPaneId(),
      getDocumentNoteId(document)
    );
  }

  function captureEditorViewState(): EditorViewState | null {
    const controller = getController();
    const position = readCursorPosition(controller);
    if (!controller || !position) return null;
    return {
      ...position,
      scrollTop: controller.view.scrollDOM.scrollTop
    };
  }

  function applyEditorScrollTop(scrollTop: number) {
    const scrollEl = getController()?.view.scrollDOM;
    if (!scrollEl) {
      return null;
    }

    const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    scrollEl.scrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
    return {
      maxScrollTop,
      reached: Math.abs(scrollEl.scrollTop - scrollTop) < 1
    };
  }

  function restoreEditorScrollTop(scrollTop: number) {
    return applyEditorScrollTop(scrollTop)?.reached ?? false;
  }

  /**
   * Content height is not final until CodeMirror has measured the new document
   * and overlay chrome has published its inset, so a single assignment can land
   * a few pixels off. Re-apply across a few frames after the target is reached.
   */
  async function settleEditorScrollTop(scrollTop: number) {
    let previousMaxScrollTop = -1;
    let stableReachedFrames = 0;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const applied = applyEditorScrollTop(scrollTop);
      if (!applied) {
        return false;
      }

      if (applied.reached) {
        stableReachedFrames += 1;
        // Keep confirming while measure/chrome inset can still shift height.
        if (stableReachedFrames >= 5 && applied.maxScrollTop <= previousMaxScrollTop) {
          return true;
        }
      } else {
        stableReachedFrames = 0;
      }

      previousMaxScrollTop = Math.max(previousMaxScrollTop, applied.maxScrollTop);
      await nextAnimationFrame();
      getController()?.view.requestMeasure();
    }

    return applyEditorScrollTop(scrollTop)?.reached ?? false;
  }

  function loadViewStateForDocument(document: NoteDraftState) {
    return loadEditorViewState(
      getDocumentPath(document),
      getPaneId(),
      getDocumentNoteId(document)
    );
  }

  function restoreCursorPositionForDocument(
    document: NoteDraftState = getDocumentSession(),
    position: EditorViewState | null = loadViewStateForDocument(document)
  ) {
    if (!getDocumentPath(document) || !position) {
      return false;
    }

    // A saved scroll offset is the more faithful restore: the reader may have
    // scrolled well away from the cursor before leaving.
    const hasSavedScroll = typeof position.scrollTop === 'number';
    const restored = restoreCursorPosition(getController(), position, {
      scrollIntoView: !hasSavedScroll
    });

    if (restored && typeof position.scrollTop === 'number') {
      void settleEditorScrollTop(position.scrollTop);
    }

    return restored;
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

      const positionToRestore: EditorViewState | null =
        cursorPosition !== undefined
          ? cursorPosition
          : (loadViewStateForDocument(document) ?? null);

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
            if (typeof positionToRestore.scrollTop === 'number') {
              await settleEditorScrollTop(positionToRestore.scrollTop);
            } else {
              let aligned = alignEditorScrollToSelection(getController(), 0.25);
              for (let attempt = 0; !aligned && attempt < 8; attempt++) {
                await nextAnimationFrame();
                getController()?.view.requestMeasure();
                aligned = alignEditorScrollToSelection(getController(), 0.25);
              }
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
      cursorPosition?: EditorViewState | null;
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

    setIsApplyingProgrammaticUpdate(true);
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

        setIsApplyingProgrammaticUpdate(false);
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
      const savedScrollTop = cursorPosition?.scrollTop;
      restoreCursorPosition(controller, cursorPosition, {
        scrollIntoView: scrollSelectionIntoView && typeof savedScrollTop !== 'number'
      });
      await tick();
      if (preserveScroll) {
        restoreEditorScrollTop(scrollTop);
      } else if (typeof savedScrollTop === 'number') {
        await settleEditorScrollTop(savedScrollTop);
      }
    } finally {
      setIsApplyingProgrammaticUpdate(false);
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
    const cursorPosition: EditorViewState =
      loadViewStateForDocument(document) ?? { anchor: 0, head: 0 };
    const controller = getController();
    if (controller?.runtime.markdown === nextMarkdown) {
      // The pane may have just remounted onto a document runtime that is
      // already live in a sibling pane (for example, chat -> previous note).
      // This is a pane-navigation event, not a document replacement: restore
      // only this pane's cursor and leave the shared runtime and sibling
      // viewports untouched.
      closeTransientUi();
      const savedScrollTop = cursorPosition.scrollTop;
      restoreCursorPosition(controller, cursorPosition, {
        scrollIntoView: typeof savedScrollTop !== 'number'
      });
      if (typeof savedScrollTop === 'number') {
        void settleEditorScrollTop(savedScrollTop);
      }
      return;
    }
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
    captureEditorViewState,
    saveCursorPositionForDocument,
    restoreCursorPositionForDocument,
    replaceEditorContent,
    replaceEditorContentInPlace,
    replaceEditorContentInPlaceForDocument
  };
}
