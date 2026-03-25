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
  getCurrentPath: () => string | null;
  getAssetRootPath: () => string | null;
  setBodyMarkdown: (value: string) => void;
  setIsEditorReady: (value: boolean) => void;
  setIsApplyingExternalContent: (value: boolean) => void;
  handleEditorMarkdownChange: (nextMarkdown: string) => void;
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
  getCurrentPath,
  getAssetRootPath,
  setBodyMarkdown,
  setIsEditorReady,
  setIsApplyingExternalContent,
  handleEditorMarkdownChange,
  onOpenLink,
  onActiveWikilinkChange,
  onStorePastedImage,
  closeTransientUi
}: EditorLifecycleControllerDeps) {
  let slashMenuPortalCleanup: (() => void) | null = null;
  const editorStateByNotePath = new Map<string, { generation: number; state: EditorState }>();
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
          handleEditorMarkdownChange(nextMarkdown);
          saveEditorStateForNote();
        },
        onStorePastedImage
      })
    );
    editorStateGeneration += 1;
    setupSlashMenuPortal();
    setIsEditorReady(true);
  }

  function saveCursorPositionForNote(
    notePath: string | null = getCurrentPath(),
    position: CursorPosition | null = readCursorPosition(getController())
  ) {
    if (!notePath || !position) {
      return;
    }

    saveCursorPosition(notePath, position);
  }

  function saveEditorStateForNote(
    notePath: string | null = getCurrentPath(),
    editorState: EditorState | null = readEditorState(getController())
  ) {
    if (!notePath || !editorState) {
      return;
    }

    editorStateByNotePath.set(notePath, {
      generation: editorStateGeneration,
      state: editorState
    });
  }

  function getEditorStateForNote(notePath: string | null) {
    if (!notePath) {
      return null;
    }

    const cachedState = editorStateByNotePath.get(notePath);
    if (!cachedState || cachedState.generation !== editorStateGeneration) {
      return null;
    }

    return cachedState.state;
  }

  function discardEditorStateForNote(notePath: string | null) {
    if (!notePath) {
      return;
    }

    editorStateByNotePath.delete(notePath);
  }

  function restoreCursorPositionForNote(
    notePath: string | null = getCurrentPath(),
    position: CursorPosition | null = loadCursorPosition(notePath)
  ) {
    if (!notePath || !position) {
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

    setIsEditorReady(false);
    await destroyEditor();
    setBodyMarkdown(nextMarkdown);
    await createEditor(nextMarkdown);

    if (restoreCursor) {
      await waitForEditorPaint();
      if (cursorPosition === undefined) {
        restoreCursorPositionForNote(getCurrentPath());
      } else {
        restoreCursorPositionForNote(getCurrentPath(), cursorPosition);
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

      setBodyMarkdown(nextMarkdown);
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

  async function replaceEditorContentInPlaceForNote(nextMarkdown: string, notePath: string | null) {
    const controller = getController();
    const cursorPosition = loadCursorPosition(notePath) ?? { anchor: 1, head: 1 };

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

      setBodyMarkdown(nextMarkdown);
      closeTransientUi();
      restoreCursorPosition(controller, cursorPosition);
      await tick();
      saveEditorStateForNote(notePath);
    } finally {
      setIsApplyingExternalContent(false);
    }
  }

  async function restoreCachedEditorState(notePath: string | null) {
    if (!replaceEditorState(getController(), getEditorStateForNote(notePath))) {
      return false;
    }

    await tick();
    return true;
  }

  function dispose() {
    slashMenuPortalCleanup?.();
    slashMenuPortalCleanup = null;
    editorStateByNotePath.clear();
  }

  return {
    destroyEditor,
    createEditor,
    saveCursorPositionForNote,
    saveEditorStateForNote,
    discardEditorStateForNote,
    restoreCursorPositionForNote,
    replaceEditorContent,
    replaceEditorContentInPlace,
    replaceEditorContentInPlaceForNote,
    restoreCachedEditorState,
    dispose
  };
}
