import { computeDraftHash } from '$lib/features/notepad/search/draftRef';
import type { ChatContextNote } from '$lib/features/chat/types';
import type { ChatPaneBindings } from '$lib/features/notepad/pane/chatPaneBindings';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import type { createProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
import type { NotepadChatCoordinator } from './notepadChatCoordinator.svelte';

type ProposalOrchestration = ReturnType<typeof createProposalOrchestration>;

export interface NotepadChatPaneAdapterDeps<TPaneId extends string> {
  coordinator: NotepadChatCoordinator<TPaneId>;
  proposal: ProposalOrchestration;
  getPaneOrder: () => TPaneId[];
  getPaneKind: (paneId: TPaneId) => 'editor' | 'chat';
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
    const order = deps.getPaneOrder();
    const paneIndex = order.indexOf(paneId);
    const nearestEditor = order
      .filter((candidate) => deps.getPaneKind(candidate) === 'editor')
      .sort(
        (left, right) =>
          Math.abs(order.indexOf(left) - paneIndex) -
          Math.abs(order.indexOf(right) - paneIndex)
      )[0];
    return nearestEditor
      ? deps.getPaneDocument(nearestEditor)
      : deps.getPaneDocument(paneId);
  }

  function getContextNote(document: NoteDraftState): ChatContextNote | null {
    if (!document.currentNotePath && !document.title.trim()) return null;
    return {
      noteId: document.currentNoteId,
      notePath: document.currentNotePath,
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
          if (deps.getPaneKind(paneId) === 'chat') {
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
          if (!active.currentNotePath || !active.currentNoteId) return null;
          deps.flushPendingAutosave(active);
          await deps.getNoteSaveQueue(active);
          if (active.status === 'error') {
            throw new Error(
              'The active note could not be saved before sending.'
            );
          }
          return {
            noteId: active.currentNoteId,
            title: noteTitle(active),
            path: active.currentNotePath,
            body: active.bodyMarkdown,
            bodyHash: computeDraftHash(active.bodyMarkdown),
            selection: deps.getSelectedRelatedText()
          };
        },
        selectionActions: deps.coordinator.selectionActions,
        onOpenCitation: async (citation) => {
          const editorPaneId = deps.getEditorPaneIds()[0];
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
        pendingCount: deps.proposal.session.pendingCount,
        onOpenChange: (change) => void deps.proposal.showChange(change),
        onKeep: (changeId) => void deps.proposal.keep(changeId),
        onUndo: (changeId) => void deps.proposal.undo(changeId),
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
    document.title.trim() ||
    document.currentNotePath
      ?.split('/')
      .at(-1)
      ?.replace(/\.md$/i, '') ||
    'Untitled note'
  );
}
