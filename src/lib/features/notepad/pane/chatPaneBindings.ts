import type {
  ChatActiveNoteSnapshot,
  ChatAgentProposal,
  ChatCitation,
  ChatContextNote,
  ChatController,
  ChatDraftSeed,
  ChatSelectionActions,
  ChatSurfaceHandle
} from '$lib/features/chat';
import type {
  ProposalReviewSessionSnapshot
} from '$lib/features/proposals/types';

export interface ChatPaneSessionBindings {
  controller: ChatController;
  conversationId: string | null;
  draftSeed: ChatDraftSeed | null;
  targetAnchor: string | null;
  onConversationChange: (conversationId: string | null) => void;
  onSurfaceHandleChange: (handle: ChatSurfaceHandle | null) => void;
}

export interface ChatPaneContextBindings {
  note: ChatContextNote | null;
  getActiveNoteSnapshot: () => Promise<ChatActiveNoteSnapshot | null>;
  selectionActions: ChatSelectionActions;
  onOpenCitation: (
    citation: Extract<ChatCitation, { kind: 'note' }>
  ) => void | Promise<void>;
}

export interface ChatPaneProposalBindings {
  snapshot: ProposalReviewSessionSnapshot | null;
  onKeepAll: () => void | Promise<void>;
  onUndoAll: () => void | Promise<void>;
  onReview: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onCopyCurrent: () => void | Promise<void>;
  onReloadDisk: () => void | Promise<void>;
  onReviewAgentProposal: (
    proposal: ChatAgentProposal
  ) => void | Promise<void>;
}

export interface ChatPaneBindings {
  session: ChatPaneSessionBindings;
  context: ChatPaneContextBindings;
  proposalReview: ChatPaneProposalBindings;
}
