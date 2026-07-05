import type { ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';
import {
  createEditorLifecycleController
} from '$lib/features/notepad/editor/editorLifecycleController';
import { createWikilinkRuntime } from '$lib/features/notepad/wikilinks/runtime';
import {
  getSharedEditorResources,
  getSharedEditorState,
  setSharedEditorState
} from '$lib/features/notepad/session/noteRuntime';
import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
import type {
  EditorSnapshot,
  SharedEditorResources
} from '$lib/features/notepad/editor/editor';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import type { NavigationContext } from '$lib/features/notepad/navigation/openFlow';
import type { WikilinkAutocompleteState } from '$lib/features/notepad/wikilinks/state';

export interface PaneControllerSetupDeps<TPaneId extends string> {
  getPaneRuntime: (paneId: TPaneId) => PaneRuntime;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  activatePaneSession: (paneId: TPaneId) => unknown;
  cancelPendingAutosave: (note?: NoteDraftState) => void;
  closeEditorTransientUi: (paneId: TPaneId) => void;
  handleEditorMarkdownChange: (
    paneId: string,
    document: NoteDraftState,
    nextMarkdown: string,
    editorState: EditorSnapshot | null
  ) => void;
  getNavigationContext: (paneId?: TPaneId) => NavigationContext;
  openNotePath: (
    notePath: string | null,
    options?: {
      noteId?: string | null;
      currentNoteAlreadySaved?: boolean;
      focusEditorAfterOpen?: boolean;
    }
  ) => Promise<void>;
  openWikilink: (paneId: TPaneId, rawTarget: string) => void | Promise<void>;
  handleActiveWikilinkChange: (paneId: TPaneId, next: ActiveWikilink | null) => void;
  setWikilinkAutocomplete: (paneId: TPaneId, value: WikilinkAutocompleteState) => void;
}

export type PaneControllers = {
  editorLifecycleController: ReturnType<typeof createEditorLifecycleController>;
  wikilinkController: ReturnType<typeof createWikilinkRuntime>;
};

/**
 * Build the per-pane (editor + wikilink) controllers. Centralised so the
 * Notepad component does not have to define a closure-heavy factory inline.
 */
export function createPaneControllers<TPaneId extends string>(
  paneId: TPaneId,
  deps: PaneControllerSetupDeps<TPaneId>
): PaneControllers {
  const editorLifecycleController = createEditorLifecycleController({
    getController: () => deps.getPaneRuntime(paneId).controller,
    getPaneId: () => paneId,
    setController: (value) => {
      deps.getPaneRuntime(paneId).setController(value);
    },
    getShellElement: () => deps.getPaneRuntime(paneId).refs.paneCard,
    getEditorShell: () => deps.getPaneRuntime(paneId).refs.editorShell,
    getEditorRoot: () => deps.getPaneRuntime(paneId).refs.editorRoot,
    getDocumentSession: () => deps.getPaneDocument(paneId),
    getSharedEditorState,
    setSharedEditorState,
    setIsEditorReady: (value) => deps.getPaneRuntime(paneId).setIsEditorReady(value),
    setIsApplyingExternalContent: (value) =>
      deps.getPaneRuntime(paneId).setIsApplyingExternalContent(value),
    handleEditorMarkdownChange: deps.handleEditorMarkdownChange,
    getSharedEditorResources: (document: NoteDraftState): SharedEditorResources =>
      getSharedEditorResources(document),
    getViewCallbacks: () => ({
      onOpenLink: (rawTarget) => {
        deps.activatePaneSession(paneId);
        void deps.openWikilink(paneId, rawTarget);
      },
      onActiveWikilinkChange: (activeWikilink) => {
        deps.handleActiveWikilinkChange(paneId, activeWikilink);
      }
    }),
    closeTransientUi: () => deps.closeEditorTransientUi(paneId)
  });

  const wikilinkController = createWikilinkRuntime({
    getState: () => deps.getPaneRuntime(paneId).ui.wikilinkAutocomplete,
    setState: (value) => deps.setWikilinkAutocomplete(paneId, value),
    getCurrentNoteId: () => deps.getPaneDocument(paneId).currentNoteId,
    getCurrentPath: () => deps.getPaneDocument(paneId).currentNotePath,
    getCurrentTitle: () => deps.getPaneDocument(paneId).title,
    getCurrentMarkdown: () => deps.getPaneDocument(paneId).bodyMarkdown,
    getEditorController: () => deps.getPaneRuntime(paneId).controller,
    cancelPendingAutosave: deps.cancelPendingAutosave,
    openNotePath: async (noteId, notePath, options) => {
      deps.activatePaneSession(paneId);
      return deps.openNotePath(notePath, { noteId, ...options });
    },
    getNavigationContext: () => deps.getNavigationContext(paneId),
    saveCursorPositionForNote: () => {
      editorLifecycleController.saveCursorPositionForDocument();
    }
  });

  return { editorLifecycleController, wikilinkController };
}
