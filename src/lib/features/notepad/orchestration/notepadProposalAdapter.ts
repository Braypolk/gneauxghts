import { tick } from 'svelte';
import { createProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';

export interface NotepadProposalAdapterDeps<TPaneId extends string> {
  maxVisiblePanes: number;
  getPaneOrder: () => TPaneId[];
  getActivePaneId: () => TPaneId;
  getPaneKind: (paneId: TPaneId) => 'editor' | 'chat';
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  setPaneDocument: (paneId: TPaneId, document: NoteDraftState) => void;
  getPaneIdsForDocument: (document: NoteDraftState) => TPaneId[];
  getEditor: (paneId: TPaneId) => EditorCapabilityAdapter | null;
  canSplitWorkspace: () => boolean;
  splitWorkspace: (choice?: 'thoughtPartner') => Promise<void>;
  createSplitPane: () => Promise<void>;
  getPendingPaneCommandId: () => TPaneId | null;
  resolvePaneCommandChoice: (
    paneId: TPaneId,
    choice: 'typing'
  ) => Promise<void>;
  setPaneKind: (
    paneId: TPaneId,
    kind: 'editor' | 'chat'
  ) => Promise<void>;
  setActivePane: (paneId: TPaneId) => void;
  activatePane: (paneId: TPaneId) => void;
  openNote: (
    path: string,
    options: { noteId: string | null; focusEditorAfterOpen: false }
  ) => Promise<void>;
  paneLifecycle: PaneEditorLifecycle<TPaneId>;
  cancelPendingAutosave: (document: NoteDraftState) => void;
  enqueueSave: (document: NoteDraftState) => Promise<void>;
  getSaveQueue: (document: NoteDraftState) => Promise<void>;
  scheduleAutosave: (document: NoteDraftState) => void;
  refreshCurrentNote: () => Promise<void>;
}

/** Bridges proposal review to workspace panes without exposing CodeMirror. */
export function createNotepadProposalAdapter<TPaneId extends string>(
  deps: NotepadProposalAdapterDeps<TPaneId>
) {
  function getNearestEditorPaneId(
    fromPaneId: TPaneId | null = deps.getActivePaneId()
  ): TPaneId | null {
    if (fromPaneId && deps.getPaneKind(fromPaneId) === 'editor') {
      return fromPaneId;
    }
    return (
      deps
        .getPaneOrder()
        .find((paneId) => deps.getPaneKind(paneId) === 'editor') ?? null
    );
  }

  function getEditorPaneDocumentForReview(path: string | null = null) {
    const order = deps.getPaneOrder();
    if (path) {
      const paneId = order.find(
        (id) => deps.getPaneDocument(id).currentNotePath === path
      );
      return paneId ? deps.getPaneDocument(paneId) : null;
    }
    const editors = order.filter(
      (id) => deps.getPaneKind(id) === 'editor'
    );
    for (const paneId of editors) {
      const document = deps.getPaneDocument(paneId);
      if (document.currentNotePath) return document;
    }
    if (editors[0]) return deps.getPaneDocument(editors[0]);
    const chatPane = order.find(
      (id) => deps.getPaneKind(id) === 'chat'
    );
    return chatPane ? deps.getPaneDocument(chatPane) : null;
  }

  async function createEditorPaneForReview(): Promise<TPaneId | null> {
    if (
      !deps.canSplitWorkspace() ||
      deps.getPaneOrder().length >= deps.maxVisiblePanes
    ) {
      return null;
    }
    const previous = new Set(deps.getPaneOrder());
    await deps.createSplitPane();
    const paneId =
      deps.getPaneOrder().find((id) => !previous.has(id)) ?? null;
    if (!paneId) return null;
    if (deps.getPendingPaneCommandId() === paneId) {
      await deps.resolvePaneCommandChoice(paneId, 'typing');
    }
    if (deps.getPaneKind(paneId) !== 'editor') {
      await deps.setPaneKind(paneId, 'editor');
    }
    return paneId;
  }

  const orchestration = createProposalOrchestration({
    getEditorPaneDocument: getEditorPaneDocumentForReview,
    getEditorForDocument: (document) => {
      const paneId = deps
        .getPaneIdsForDocument(document)
        .find((id) => deps.getPaneKind(id) === 'editor');
      const editor = paneId ? deps.getEditor(paneId) : null;
      return editor?.isReady() ? editor : null;
    },
    getEditorsForDocument: (document) =>
      deps
        .getPaneIdsForDocument(document)
        .filter((id) => deps.getPaneKind(id) === 'editor')
        .map(deps.getEditor)
        .filter(
          (editor): editor is EditorCapabilityAdapter =>
            Boolean(editor?.isReady())
        ),
    flushBeforePreview: async (document) => {
      deps.cancelPendingAutosave(document);
      await deps.enqueueSave(document);
      await deps.getSaveQueue(document);
    },
    ensureEditorPaneForReview: async (document) => {
      let paneId = document
        ? deps
            .getPaneIdsForDocument(document)
            .find((id) => deps.getPaneKind(id) === 'editor') ?? null
        : getNearestEditorPaneId();
      const order = deps.getPaneOrder();
      if (!paneId) {
        if (order.length === 1 && deps.canSplitWorkspace()) {
          paneId = await createEditorPaneForReview();
        } else {
          const active = deps.getActivePaneId();
          const chatPane =
            (deps.getPaneKind(active) === 'chat' ? active : null) ??
            order.find((id) => deps.getPaneKind(id) === 'chat') ??
            null;
          if (chatPane) {
            await deps.setPaneKind(chatPane, 'editor');
            paneId = chatPane;
          }
        }
      }
      if (
        order.length === 1 &&
        paneId &&
        deps.getPaneKind(paneId) === 'editor' &&
        deps.canSplitWorkspace()
      ) {
        await deps.splitWorkspace('thoughtPartner');
        paneId = getNearestEditorPaneId() ?? paneId;
      }
      if (paneId && !deps.getPaneDocument(paneId).currentNotePath) {
        const source =
          document?.currentNotePath
            ? document
            : deps
                .getPaneOrder()
                .map(deps.getPaneDocument)
                .find((note) => note.currentNotePath) ?? null;
        if (source) deps.setPaneDocument(paneId, source);
      }
      await tick();
      await deps.paneLifecycle.ensurePaneEditors();
    },
    openNoteForReview: async (noteId, path) => {
      const paneId = getNearestEditorPaneId();
      if (!paneId) return null;
      deps.setActivePane(paneId);
      await deps.openNote(path, {
        noteId,
        focusEditorAfterOpen: false
      });
      await tick();
      await deps.paneLifecycle.ensurePaneEditors();
      return getEditorPaneDocumentForReview(path);
    },
    activateEditorPane: async (document) => {
      const withDocument = document
        ? deps
            .getPaneIdsForDocument(document)
            .find((id) => deps.getPaneKind(id) === 'editor') ?? null
        : null;
      const withPath =
        withDocument ??
        deps
          .getPaneOrder()
          .find(
            (id) =>
              deps.getPaneKind(id) === 'editor' &&
              Boolean(deps.getPaneDocument(id).currentNotePath)
          );
      const paneId = withPath ?? getNearestEditorPaneId();
      if (paneId) {
        deps.activatePane(paneId);
        await tick();
        await deps.paneLifecycle.ensurePaneEditors();
      }
    },
    cancelPendingAutosave: deps.cancelPendingAutosave,
    scheduleAutosave: deps.scheduleAutosave,
    reloadReviewFromDisk: deps.refreshCurrentNote,
    reopenReviewEditor: async (document) => {
      let paneId =
        deps
          .getPaneIdsForDocument(document)
          .find((id) => deps.getPaneKind(id) === 'editor') ?? null;
      if (
        !paneId &&
        deps.getPaneOrder().length < deps.maxVisiblePanes
      ) {
        paneId = await createEditorPaneForReview();
      }
      if (!paneId) {
        paneId = deps.getActivePaneId();
        await deps.setPaneKind(paneId, 'editor');
      }
      deps.setPaneDocument(paneId, document);
      await tick();
      await deps.paneLifecycle.ensurePaneEditors();
      const editor = deps.getEditor(paneId);
      return editor?.isReady() ? editor : null;
    },
    refreshDocumentAfterKeep: deps.refreshCurrentNote
  });

  return {
    orchestration,
    getNearestEditorPaneId
  };
}
