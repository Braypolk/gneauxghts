import { computeDraftHash } from '$lib/features/notepad/search/draftRef';
import type { ChatContextNote, ChatCitation } from '$lib/features/chat/types';
import type { ChatPaneBindings } from '$lib/features/notepad/pane/chatPaneBindings';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import {
  getChatContextPaneId,
  getNearestEditorPaneId
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
  setPaneDocument: (paneId: TPaneId, document: NoteDraftState) => void;
  getPaneConversationId: (paneId: TPaneId) => string | null;
  setPaneConversationId: (
    paneId: TPaneId,
    conversationId: string | null
  ) => void;
  touchPaneLocation: (paneId: TPaneId) => void;
  getPaneSelectedText: (paneId: TPaneId) => string | null;
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
  openRevisionCitation: (paneId: TPaneId, citation: Extract<ChatCitation, { kind: 'note' }>) => Promise<void>;
  openWikilink: (
    paneId: TPaneId,
    rawTarget: string
  ) => void | Promise<void>;
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
  function getContextPaneId(paneId: TPaneId) {
    return getChatContextPaneId(
      deps.getPaneOrder(),
      deps.getPaneKind,
      paneId
    );
  }

  function getContextDocument(paneId: TPaneId) {
    return deps.getPaneDocument(getContextPaneId(paneId));
  }

  /**
   * While a chat follows a sibling editor, keep this pane's retained document
   * aligned with that editor. Closing the editor then leaves the chat on the
   * most recent note instead of a stale pre-split retain.
   */
  function syncRetainedContext(paneId: TPaneId) {
    if (!paneHasCapability(deps.getPaneKind(paneId), 'host-chat')) {
      return;
    }
    const contextPaneId = getContextPaneId(paneId);
    if (contextPaneId === paneId) {
      return;
    }
    const contextDocument = deps.getPaneDocument(contextPaneId);
    const retained = deps.getPaneDocument(paneId);
    if (contextDocument.key === retained.key) {
      return;
    }
    deps.setPaneDocument(paneId, contextDocument);
  }

  function syncRetainedContexts() {
    for (const paneId of deps.getPaneOrder()) {
      syncRetainedContext(paneId);
    }
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
        draftSlot: `pane:${paneId}`,
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
          // Body, path, and selection all come from the same pane so a message
          // can never quote one note while describing another.
          const contextPaneId = getContextPaneId(paneId);
          const active = deps.getPaneDocument(contextPaneId);
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
            selection: deps.getPaneSelectedText(contextPaneId)
          };
        },
        selectionActions: deps.coordinator.selectionActions,
        onOpenCitation: async (citation) => {
          if (citation.revision) {
            await deps.openRevisionCitation(paneId, citation);
            return;
          }
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
        },
        onOpenWikilink: async (rawTarget) => {
          const editorPaneId = getNearestEditorPaneId(
            deps.getPaneOrder(),
            deps.getPaneKind,
            paneId
          );
          await deps.openWikilink(editorPaneId ?? paneId, rawTarget);
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
    getBindings,
    syncRetainedContexts
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
