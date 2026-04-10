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
  replaceEditorState,
  restoreCursorPosition,
  resetSlashMenuPortal,
  type EditorController
} from '$lib/features/notepad/editor/editor';
import { waitForEditorPaint } from '$lib/features/notepad/navigation/navigation';
import type { StoredImageAsset } from '$lib/features/notepad/model/types';
import type { DocumentSession } from '$lib/features/notepad/session/documentSession';
import type { ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';

interface ReplaceEditorContentOptions {
  preserveScroll?: boolean;
  restoreCursor?: boolean;
  cursorPosition?: CursorPosition | null | undefined;
  expectedDocument?: DocumentSession | null;
}

interface EditorLifecycleControllerDeps {
  getController: () => EditorController | null;
  getPaneId: () => string;
  setController: (value: EditorController | null) => void;
  getShellElement: () => HTMLDivElement | null;
  getEditorShell: () => HTMLDivElement | null;
  getEditorRoot: () => HTMLDivElement | null;
  getSlashMenuPortal: () => HTMLDivElement | null;
  getAssetRootPath: () => string | null;
  getDocumentSession: () => DocumentSession;
  setIsEditorReady: (value: boolean) => void;
  setIsApplyingExternalContent: (value: boolean) => void;
  handleEditorMarkdownChange: (document: DocumentSession, nextMarkdown: string) => void;
  onTaskListToggle: () => void;
  onOpenLink: (rawTarget: string) => void;
  onActiveWikilinkChange: (activeWikilink: ActiveWikilink | null) => void;
  onStorePastedImage: (file: File) => Promise<StoredImageAsset>;
  closeTransientUi: () => void;
}

export function createEditorLifecycleController({
  getController,
  getPaneId,
  setController,
  getShellElement,
  getEditorShell,
  getEditorRoot,
  getSlashMenuPortal,
  getAssetRootPath,
  getDocumentSession,
  setIsEditorReady,
  setIsApplyingExternalContent,
  handleEditorMarkdownChange,
  onTaskListToggle,
  onOpenLink,
  onActiveWikilinkChange,
  onStorePastedImage,
  closeTransientUi
}: EditorLifecycleControllerDeps) {
  let slashMenuPortalCleanup: (() => void) | null = null;
  let sharedEditorStateGeneration = 0;

  async function destroyEditor() {
    slashMenuPortalCleanup = resetSlashMenuPortal({
      boundsElement: null,
      editorRoot: null,
      portalRoot: null,
      currentCleanup: slashMenuPortalCleanup
    });
    setController(await destroyEditorInstance(getController()));
  }

  function setupSlashMenuPortal() {
    slashMenuPortalCleanup = resetSlashMenuPortal({
      boundsElement: getShellElement(),
      editorRoot: getEditorRoot(),
      portalRoot: getSlashMenuPortal(),
      currentCleanup: slashMenuPortalCleanup
    });
  }

  async function createEditor(initialValue: string) {
    const editorRoot = getEditorRoot();
    if (!(await prepareEditor(editorRoot)) || !editorRoot) {
      return;
    }

    setController(
      await createEditorInstance({
        assetRootPath: getAssetRootPath(),
        editorRoot,
        initialValue,
        onOpenLink: (rawTarget) => {
          void onOpenLink(rawTarget);
        },
        onActiveWikilinkChange,
        onMarkdownChange: (nextMarkdown) => {
          const document = getDocumentSession();
          handleEditorMarkdownChange(document, nextMarkdown);
          saveSharedEditorStateForDocument(document);
        },
        onTaskListToggle,
        onStorePastedImage
      })
    );
    sharedEditorStateGeneration += 1;
    setupSlashMenuPortal();
    setIsEditorReady(true);
  }

  function saveCursorPositionForDocument(
    document: DocumentSession = getDocumentSession(),
    position: CursorPosition | null = readCursorPosition(getController())
  ) {
    if (!document.currentNotePath || !position) {
      return;
    }

    saveCursorPosition(document.currentNotePath, position, getPaneId());
  }

  function saveSharedEditorStateForDocument(
    document: DocumentSession = getDocumentSession(),
    editorState: EditorState | null = readEditorState(getController())
  ) {
    document.sharedEditorState = editorState;
    document.sharedEditorStateGeneration = editorState ? sharedEditorStateGeneration : 0;
  }

  function getSharedEditorStateForDocument(document: DocumentSession) {
    if (
      !document.sharedEditorState ||
      document.sharedEditorStateGeneration !== sharedEditorStateGeneration
    ) {
      return null;
    }

    return document.sharedEditorState;
  }

  function discardSharedEditorStateForDocument(document: DocumentSession) {
    document.sharedEditorState = null;
    document.sharedEditorStateGeneration = 0;
  }

  function restoreCursorPositionForDocument(
    document: DocumentSession = getDocumentSession(),
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

    document.bodyMarkdown = nextMarkdown;
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
    const document = getDocumentSession();
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

      document.bodyMarkdown = nextMarkdown;
      saveSharedEditorStateForDocument(document);
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
    document: DocumentSession
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

      document.bodyMarkdown = nextMarkdown;
      saveSharedEditorStateForDocument(document);
      closeTransientUi();
      restoreCursorPosition(controller, cursorPosition);
      await tick();
    } finally {
      setIsApplyingExternalContent(false);
    }
  }

  async function restoreSharedEditorStateForDocument(document: DocumentSession) {
    if (getDocumentSession() !== document) {
      return false;
    }

    if (
      !replaceEditorState(getController(), getSharedEditorStateForDocument(document), {
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

  function dispose() {
    slashMenuPortalCleanup?.();
    slashMenuPortalCleanup = null;
  }

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
    dispose
  };
}
