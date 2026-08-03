import { computeDraftHash } from '$lib/features/notepad/search/draftRef';
import type { ChatContextNote } from '$lib/features/chat/types';
import type { ChatPaneBindings } from '$lib/features/notepad/pane/chatPaneBindings';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import {
  getNearestEditorPaneId,
  getRetainedPaneContext
} from '$lib/features/notepad/workspace/paneRoles';
import type { PaneKind } from '$lib/features/notepad/workspace/paneTypes';
import { paneHasCapability } from '$lib/features/notepad/workspace/paneCapabilities';
import {
  getDocumentMarkdown,
  getDocumentNoteId,
  getDocumentPath,
  getDocumentTitle
} from '$lib/features/notepad/document/documentState';
import type { createProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
import type { NotepadChatCoordinator } from './notepadChatCoordinator.svelte';

type ProposalOrchestration = ReturnType<typeof createProposalOrchestration>;

export interface NotepadChatPaneAdapterDeps<TPaneId extends string> {
  coordinator: NotepadChatCoordinator<TPaneId>;
  proposal: ProposalOrchestration;
  getPaneOrder: () => TPaneId[];
  getPaneKind: (paneId: TPaneId) => PaneKind;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getPaneConversationId: (paneId: TPaneId) => string | null;
  setPaneConversationId: (
    paneId: TPaneId,
    conversationId: string | null
  ) => void;
  touchPaneLocation: (paneId: TPaneId) => void;
  getSelectedRelatedText: () => string | null;
  getEditorPaneIds: () => TPaneId[];
  setActivePane: (paneId: TPaneId) => void;
  openNote: (
    notePath: string,
    options: {
      noteId: string;
      revealEditorAfterOpen?: boolean;
      focusEditorAfterOpen: true;
    }
  ) => Promise<void>;
  flushPendingAutosave: (document: NoteDraftState) => void;
  getNoteSaveQueue: (document: NoteDraftState) => Promise<void>;
}

/**
 * Owns the boundary between a notepad pane and the reusable ChatPanel API.
 * View-model construction remains presentation-only; save, navigation, and
 * proposal policies stay together here.
 */
export function createNotepadChatPaneAdapter<TPaneId extends string>(
  deps: NotepadChatPaneAdapterDeps<TPaneId>
) {
  function getContextDocument(paneId: TPaneId) {
    return getRetainedPaneContext(
      paneId,
      deps.getPaneDocument
    );
  }

  function getContextNote(document: NoteDraftState): ChatContextNote | null {
    const notePath = getDocumentPath(document);
    if (!notePath && !getDocumentTitle(document).trim()) return null;
    return {
      noteId: getDocumentNoteId(document),
      notePath,
      noteTitle: noteTitle(document)
    };
  }

  function getBindings(paneId: TPaneId): ChatPaneBindings {
    const contextDocument = getContextDocument(paneId);
    return {
      session: {
        controller: deps.coordinator.getController(paneId),
        conversationId: deps.getPaneConversationId(paneId),
        draftSeed: deps.coordinator.getDraftSeed(paneId),
        targetAnchor: deps.coordinator.getTargetAnchor(paneId),
        onConversationChange: (conversationId) => {
          deps.setPaneConversationId(paneId, conversationId);
          if (
            paneHasCapability(
              deps.getPaneKind(paneId),
              'host-chat'
            )
          ) {
            deps.touchPaneLocation(paneId);
          }
        },
        onSurfaceHandleChange: (handle) => {
          deps.coordinator.setSurfaceHandle(paneId, handle);
        }
      },
      context: {
        note: getContextNote(contextDocument),
        getActiveNoteSnapshot: async () => {
          const active = getContextDocument(paneId);
          const notePath = getDocumentPath(active);
          const noteId = getDocumentNoteId(active);
          if (!notePath || !noteId) return null;
          deps.flushPendingAutosave(active);
          await deps.getNoteSaveQueue(active);
          if (active.operation.kind === 'failed') {
            throw new Error(
              'The active note could not be saved before sending.'
            );
          }
          return {
            noteId,
            title: noteTitle(active),
            path: notePath,
            body: getDocumentMarkdown(active),
            bodyHash: computeDraftHash(
              getDocumentMarkdown(active)
            ),
            selection: deps.getSelectedRelatedText()
          };
        },
        selectionActions: deps.coordinator.selectionActions,
        onOpenCitation: async (citation) => {
          const editorPaneId = getNearestEditorPaneId(
            deps.getPaneOrder(),
            deps.getPaneKind,
            paneId
          );
          if (editorPaneId) {
            deps.setActivePane(editorPaneId);
            await deps.openNote(citation.notePath, {
              noteId: citation.noteId,
              focusEditorAfterOpen: true
            });
            return;
          }
          deps.setActivePane(paneId);
          await deps.openNote(citation.notePath, {
            noteId: citation.noteId,
            revealEditorAfterOpen: true,
            focusEditorAfterOpen: true
          });
        }
      },
      proposalReview: {
        snapshot: deps.proposal.session.snapshot,
        onKeepAll: () => void deps.proposal.keepAll(),
        onUndoAll: () => void deps.proposal.undoAll(),
        onReview: () => void deps.proposal.reviewNext(),
        onRetry: () => void deps.proposal.retryCommit(),
        onCopyCurrent: () => void deps.proposal.copyCurrent(),
        onReloadDisk: () => void deps.proposal.reloadDisk(),
        onReviewAgentProposal: (proposal) =>
          void deps.coordinator.reviewAgentProposal(paneId, proposal)
      }
    };
  }

  return {
    getBindings
  };
}

function noteTitle(document: NoteDraftState) {
  return (
    getDocumentTitle(document).trim() ||
    getDocumentPath(document)
      ?.split('/')
      .at(-1)
      ?.replace(/\.md$/i, '') ||
    'Untitled note'
  );
}
