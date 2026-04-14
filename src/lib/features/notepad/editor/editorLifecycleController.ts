import type { EditorState } from 'prosemirror-state';
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
  restoreCursorPosition,
  type EditorController,
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
}

interface EditorLifecycleControllerDeps {
  getController: () => EditorController | null;
  getPaneId: () => string;
  setController: (value: EditorController | null) => void;
  getShellElement: () => HTMLDivElement | null;
  getEditorShell: () => HTMLDivElement | null;
  getEditorRoot: () => HTMLDivElement | null;
  getDocumentSession: () => NoteDraftState;
  getSharedEditorState: (document: NoteDraftState) => EditorState | null;
  setSharedEditorState: (document: NoteDraftState, editorState: EditorState | null) => void;
  setIsEditorReady: (value: boolean) => void;
  setIsApplyingExternalContent: (value: boolean) => void;
  handleEditorMarkdownChange: (
    paneId: string,
    document: NoteDraftState,
    nextMarkdown: string,
    editorState: EditorState | null
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
        const editorState = readEditorState(getController());
        handleEditorMarkdownChange(getPaneId(), document, nextMarkdown, editorState);
        saveSharedEditorStateForDocument(document, editorState);
      }
    });
    bindSlashMenuViewToPane(controller.view, getPaneId());
    setController(controller);
    setIsEditorReady(true);
  }

  function saveCursorPositionForDocument(
    document: NoteDraftState = getDocumentSession(),
    position: CursorPosition | null = readCursorPosition(getController())
  ) {
    if (!document.currentNotePath || !position) {
      return;
    }

    saveCursorPosition(document.currentNotePath, position, getPaneId());
  }

  function saveSharedEditorStateForDocument(
    document: NoteDraftState = getDocumentSession(),
    editorState: EditorState | null = readEditorState(getController())
  ) {
    setSharedEditorState(document, editorState);
  }

  function getSharedEditorStateForDocument(document: NoteDraftState) {
    return getSharedEditorState(document);
  }

  function discardSharedEditorStateForDocument(document: NoteDraftState) {
    setSharedEditorState(document, null);
  }

  function restoreCursorPositionForDocument(
    document: NoteDraftState = getDocumentSession(),
    position: CursorPosition | null = loadCursorPosition(document.currentNotePath, getPaneId())
  ) {
    if (!document.currentNotePath || !position) {
      return false;
    }

    return restoreCursorPosition(getController(), position);
  }

  async function replaceEditorContent(
    nextMarkdown: string,
    {
      preserveScroll = false,
      restoreCursor = false,
      cursorPosition = undefined,
      expectedDocument = null
    }: ReplaceEditorContentOptions = {}
  ) {
    if (expectedDocument && getDocumentSession() !== expectedDocument) {
      return;
    }

    const editorShell = getEditorShell();
    const scrollTop = preserveScroll ? (editorShell?.scrollTop ?? 0) : 0;
    const document = getDocumentSession();

    setIsEditorReady(false);
    await destroyEditor();

    if (expectedDocument && getDocumentSession() !== expectedDocument) {
      return;
    }

    await createEditor(nextMarkdown);

    if (restoreCursor) {
      if (expectedDocument && getDocumentSession() !== expectedDocument) {
        return;
      }

      await waitForEditorPaint();
      if (cursorPosition === undefined) {
        restoreCursorPositionForDocument(document);
      } else {
        restoreCursorPositionForDocument(document, cursorPosition);
      }
    }

    const nextEditorShell = getEditorShell();
    if (preserveScroll && nextEditorShell) {
      await tick();
      nextEditorShell.scrollTop = Math.min(scrollTop, nextEditorShell.scrollHeight);
    }
  }

  async function replaceEditorContentInPlace(nextMarkdown: string) {
    const controller = getController();
    const cursorPosition = readCursorPosition(controller);
    const scrollTop = getEditorShell()?.scrollTop ?? 0;

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
      restoreCursorPosition(controller, cursorPosition);
      await tick();

      const editorShell = getEditorShell();
      if (editorShell) {
        editorShell.scrollTop = Math.min(scrollTop, editorShell.scrollHeight);
      }
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
      loadCursorPosition(document.currentNotePath, getPaneId()) ?? { anchor: 1, head: 1 };

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
    if (
      !replaceEditorDocument(getController(), sharedEditorState?.doc ?? null, {
        anchor: loadCursorPosition(document.currentNotePath, getPaneId())?.anchor ?? null,
        head: loadCursorPosition(document.currentNotePath, getPaneId())?.head ?? null,
        focus: false,
        scrollSelectionIntoView: false
      })
    ) {
      return false;
    }

    if (getDocumentSession() !== document) {
      return false;
    }

    restoreCursorPositionForDocument(document);
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
    const scrollTop = getEditorShell()?.scrollTop ?? 0;
    const cursorPosition = readCursorPosition(controller);

    setIsApplyingExternalContent(true);
    try {
      if (
        !replaceEditorDocument(controller, sharedEditorState.doc, {
          anchor: cursorPosition?.anchor ?? null,
          head: cursorPosition?.head ?? null,
          focus: false,
          scrollSelectionIntoView: false
        })
      ) {
        return false;
      }

      closeTransientUi();
      const editorShell = getEditorShell();
      if (editorShell) {
        editorShell.scrollTop = Math.min(scrollTop, editorShell.scrollHeight);
      }
      return true;
    } finally {
      setIsApplyingExternalContent(false);
    }
  }

  function dispose() {}

  return {
    destroyEditor,
    createEditor,
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
