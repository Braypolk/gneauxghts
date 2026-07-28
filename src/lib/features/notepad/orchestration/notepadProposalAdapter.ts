import { tick } from 'svelte';
import { createProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import type { PaneEditorLifecycle } from '$lib/features/notepad/pane/paneEditorLifecycle';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import {
  getNearestEditorPaneId as selectNearestEditorPaneId
} from '$lib/features/notepad/workspace/paneRoles';
import type { PaneKind } from '$lib/features/notepad/workspace/paneTypes';
import {
  getPaneIdsWithCapability,
  paneHasCapability
} from '$lib/features/notepad/workspace/paneCapabilities';
import { getDocumentPath } from '$lib/features/notepad/document/documentState';

export interface NotepadProposalAdapterDeps<TPaneId extends string> {
  maxVisiblePanes: number;
  getPaneOrder: () => TPaneId[];
  getActivePaneId: () => TPaneId;
  getPaneKind: (paneId: TPaneId) => PaneKind;
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
    kind: PaneKind
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
  const paneCanEditDocument = (paneId: TPaneId) =>
    paneHasCapability(
      deps.getPaneKind(paneId),
      'edit-document'
    );
  const paneHostsChat = (paneId: TPaneId) =>
    paneHasCapability(
      deps.getPaneKind(paneId),
      'host-chat'
    );

  function getNearestEditorPaneId(
    fromPaneId: TPaneId | null = deps.getActivePaneId()
  ): TPaneId | null {
    return selectNearestEditorPaneId(
      deps.getPaneOrder(),
      deps.getPaneKind,
      fromPaneId ?? deps.getActivePaneId()
    );
  }

  function getEditorPaneDocumentForReview(path: string | null = null) {
    const order = deps.getPaneOrder();
    if (path) {
      const paneId = order.find(
        (id) => getDocumentPath(deps.getPaneDocument(id)) === path
      );
      return paneId ? deps.getPaneDocument(paneId) : null;
    }
    const editors = getPaneIdsWithCapability(
      order,
      deps.getPaneKind,
      'edit-document'
    );
    for (const paneId of editors) {
      const document = deps.getPaneDocument(paneId);
      if (getDocumentPath(document)) return document;
    }
    if (editors[0]) return deps.getPaneDocument(editors[0]);
    const chatPane = order.find(paneHostsChat);
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
    if (!paneCanEditDocument(paneId)) {
      await deps.setPaneKind(paneId, 'editor');
    }
    return paneId;
  }

  const orchestration = createProposalOrchestration({
    getEditorPaneDocument: getEditorPaneDocumentForReview,
    getEditorForDocument: (document) => {
      const paneId = deps
        .getPaneIdsForDocument(document)
        .find(paneCanEditDocument);
      const editor = paneId ? deps.getEditor(paneId) : null;
      return editor?.isReady() ? editor : null;
    },
    getEditorsForDocument: (document) =>
      getPaneIdsWithCapability(
        deps.getPaneIdsForDocument(document),
        deps.getPaneKind,
        'edit-document'
      )
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
            .find(paneCanEditDocument) ?? null
        : getNearestEditorPaneId();
      const order = deps.getPaneOrder();
      if (!paneId) {
        if (order.length === 1 && deps.canSplitWorkspace()) {
          paneId = await createEditorPaneForReview();
        } else {
          const active = deps.getActivePaneId();
          const chatPane =
            (paneHostsChat(active) ? active : null) ??
            order.find(paneHostsChat) ??
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
        paneCanEditDocument(paneId) &&
        deps.canSplitWorkspace()
      ) {
        await deps.splitWorkspace('thoughtPartner');
        paneId = getNearestEditorPaneId() ?? paneId;
      }
      if (paneId && !getDocumentPath(deps.getPaneDocument(paneId))) {
        const source =
          document && getDocumentPath(document)
            ? document
            : deps
                .getPaneOrder()
                .map(deps.getPaneDocument)
                .find((note) => getDocumentPath(note)) ?? null;
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
            .find(paneCanEditDocument) ?? null
        : null;
      const withPath =
        withDocument ??
        deps
          .getPaneOrder()
          .find(
            (id) =>
              paneCanEditDocument(id) &&
              Boolean(getDocumentPath(deps.getPaneDocument(id)))
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
          .find(paneCanEditDocument) ?? null;
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
