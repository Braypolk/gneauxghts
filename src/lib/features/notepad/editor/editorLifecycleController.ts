import type { EditorState } from '@milkdown/kit/prose/state';
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
}

interface EditorLifecycleControllerDeps {
  getController: () => EditorController | null;
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
  onOpenLink: (rawTarget: string) => void;
  onActiveWikilinkChange: (activeWikilink: ActiveWikilink | null) => void;
  onStorePastedImage: (file: File) => Promise<StoredImageAsset>;
  closeTransientUi: () => void;
}

export function createEditorLifecycleController({
  getController,
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
  onOpenLink,
  onActiveWikilinkChange,
  onStorePastedImage,
  closeTransientUi
}: EditorLifecycleControllerDeps) {
  let slashMenuPortalCleanup: (() => void) | null = null;
  let editorStateGeneration = 0;

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
    const document = getDocumentSession();
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
          handleEditorMarkdownChange(document, nextMarkdown);
          saveEditorStateForDocument(document);
        },
        onStorePastedImage
      })
    );
    editorStateGeneration += 1;
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

    saveCursorPosition(document.currentNotePath, position);
  }

  function saveEditorStateForDocument(
    document: DocumentSession = getDocumentSession(),
    editorState: EditorState | null = readEditorState(getController())
  ) {
    document.editorState = editorState;
    document.editorStateGeneration = editorState ? editorStateGeneration : 0;
  }

  function getEditorStateForDocument(document: DocumentSession) {
    if (
      !document.editorState ||
      document.editorStateGeneration !== editorStateGeneration
    ) {
      return null;
    }

    return document.editorState;
  }

  function discardEditorStateForDocument(document: DocumentSession) {
    document.editorState = null;
    document.editorStateGeneration = 0;
  }

  function restoreCursorPositionForDocument(
    document: DocumentSession = getDocumentSession(),
    position: CursorPosition | null = loadCursorPosition(document.currentNotePath)
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
      cursorPosition = undefined
    }: ReplaceEditorContentOptions = {}
  ) {
    const editorShell = getEditorShell();
    const scrollTop = preserveScroll ? (editorShell?.scrollTop ?? 0) : 0;
    const document = getDocumentSession();

    setIsEditorReady(false);
    await destroyEditor();
    document.bodyMarkdown = nextMarkdown;
    await createEditor(nextMarkdown);

    if (restoreCursor) {
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
      saveEditorStateForDocument(document);
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
    const controller = getController();
    const cursorPosition = loadCursorPosition(document.currentNotePath) ?? { anchor: 1, head: 1 };

    setIsApplyingExternalContent(true);
    try {
      if (!replaceEditorBuffer(controller, nextMarkdown, { flushHistory: true })) {
        setIsApplyingExternalContent(false);
        await replaceEditorContent(nextMarkdown, {
          restoreCursor: true,
          cursorPosition
        });
        return;
      }

      document.bodyMarkdown = nextMarkdown;
      saveEditorStateForDocument(document);
      closeTransientUi();
      restoreCursorPosition(controller, cursorPosition);
      await tick();
    } finally {
      setIsApplyingExternalContent(false);
    }
  }

  async function restoreCachedEditorState(document: DocumentSession) {
    if (!replaceEditorState(getController(), getEditorStateForDocument(document))) {
      return false;
    }

    await tick();
    return true;
  }

  function dispose() {
    slashMenuPortalCleanup?.();
    slashMenuPortalCleanup = null;
  }

  return {
    destroyEditor,
    createEditor,
    saveCursorPositionForDocument,
    saveEditorStateForDocument,
    discardEditorStateForDocument,
    restoreCursorPositionForDocument,
    replaceEditorContent,
    replaceEditorContentInPlace,
    replaceEditorContentInPlaceForDocument,
    restoreCachedEditorState,
    dispose
  };
}
