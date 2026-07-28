import { tick } from 'svelte';
import type { ForgottenNoteRetentionPreference } from '$lib/appSettings.svelte';
import { chatApi, type ChatApi } from '$lib/features/chat/api';
import {
  createChatController,
  type ChatController
} from '$lib/features/chat/controller.svelte';
import {
  formatDiscussionDraft,
  type ChatDraftSeed
} from '$lib/features/chat/discussionContext';
import type {
  ChatAgentProposal,
  ChatSelection,
  ChatSelectionActions,
  ChatSurfaceHandle
} from '$lib/features/chat/types';
import type { NotepadFeatureHost } from '$lib/features/notepad/host';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import type { createProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
import type { ProposalPreview } from '$lib/types/proposals';
import { restoreForgottenNotes } from '$lib/features/notepad/session/session';

interface RecentlyForgottenChat<TPaneId extends string> {
  paneId: TPaneId;
  conversationId: string;
  title: string;
  forgottenPath: string;
}

export interface NotepadChatCoordinatorDeps<TPaneId extends string> {
  maxVisiblePanes: number;
  getPaneOrder: () => TPaneId[];
  getActivePaneId: () => TPaneId;
  getPaneKind: (paneId: TPaneId) => 'editor' | 'chat';
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getEditorPaneIds: () => TPaneId[];
  getPaneConversationId: (paneId: TPaneId) => string | null;
  setPaneConversationId: (
    paneId: TPaneId,
    conversationId: string | null
  ) => void;
  setStoredPaneKind: (
    paneId: TPaneId,
    kind: 'editor' | 'chat'
  ) => void;
  setActivePane: (paneId: TPaneId) => void;
  touchPaneLocation: (paneId: TPaneId) => void;
  splitWorkspace: () => Promise<void>;
  resolvePaneCommandChoice: (
    paneId: TPaneId,
    choice: 'thoughtPartner'
  ) => Promise<void>;
  setPaneKind: (
    paneId: TPaneId,
    kind: 'editor' | 'chat'
  ) => Promise<void>;
  focusPane: (paneId: TPaneId) => void;
  insertMarkdown: NotepadFeatureHost['insertMarkdown'];
  getProposalOrchestration: () => ReturnType<
    typeof createProposalOrchestration
  >;
  clearRecentlyForgottenNote: () => void;
  forgottenNoteRetentionPreference: () => ForgottenNoteRetentionPreference;
  startNewNote: () => Promise<void>;
  forgetNote: () => Promise<void>;
  unforgetNote: () => Promise<void>;
  api?: ChatApi;
}

/**
 * Owns all chat-pane state and cross-feature flows. Notepad supplies workspace
 * capabilities, but does not retain chat-controller or archive bookkeeping.
 */
export class NotepadChatCoordinator<TPaneId extends string> {
  readonly draftSeeds = $state<
    Partial<Record<TPaneId, ChatDraftSeed>>
  >({});
  readonly targetAnchors = $state<
    Partial<Record<TPaneId, string | null>>
  >({});
  recentlyForgotten = $state<RecentlyForgottenChat<TPaneId> | null>(
    null
  );

  readonly selectionActions: ChatSelectionActions;

  private readonly controllers = new Map<TPaneId, ChatController>();
  private readonly surfaceHandles = new Map<TPaneId, ChatSurfaceHandle>();
  private readonly api: ChatApi;
  private discussionSeedCounter = 0;
  private discussionInProgress = false;

  constructor(
    initialPaneIds: TPaneId[],
    private readonly deps: NotepadChatCoordinatorDeps<TPaneId>
  ) {
    this.api = deps.api ?? chatApi;
    for (const paneId of initialPaneIds) this.ensureController(paneId);
    this.selectionActions = {
      onInsertIntoNote: (selection) =>
        this.insertSelectionIntoNote(selection)
    };
  }

  ensureController(paneId: TPaneId): ChatController {
    let controller = this.controllers.get(paneId);
    if (!controller) {
      controller = createChatController(this.api, {
        onProposal: async (proposal) => {
          await this.reviewAgentProposal(paneId, proposal);
        },
        onProposalResolved: (proposalId) =>
          this.removeResolvedProposal(proposalId)
      });
      this.controllers.set(paneId, controller);
    }
    return controller;
  }

  getController(paneId: TPaneId): ChatController {
    const controller = this.controllers.get(paneId);
    if (!controller) {
      throw new Error(
        `Chat controller ${paneId} was accessed before initialization.`
      );
    }
    return controller;
  }

  getDraftSeed(paneId: TPaneId) {
    return this.draftSeeds[paneId] ?? null;
  }

  getTargetAnchor(paneId: TPaneId) {
    return this.targetAnchors[paneId] ?? null;
  }

  setSurfaceHandle(
    paneId: TPaneId,
    handle: ChatSurfaceHandle | null
  ) {
    if (handle) {
      this.surfaceHandles.set(paneId, handle);
    } else {
      this.surfaceHandles.delete(paneId);
    }
  }

  focusComposer(paneId: TPaneId) {
    return this.surfaceHandles.get(paneId)?.focusComposer() ?? false;
  }

  canUnforget(paneId: TPaneId) {
    return this.recentlyForgotten?.paneId === paneId;
  }

  canForget(paneId: TPaneId) {
    const snapshot = this.getController(paneId).getSnapshot();
    return Boolean(
      snapshot.conversation &&
        !snapshot.isInitializing &&
        !snapshot.isLoadingConversation &&
        !snapshot.isSending
    );
  }

  async reviewAgentProposal(
    paneId: TPaneId,
    proposal: ChatAgentProposal
  ): Promise<boolean> {
    let pendingProposal = proposal;
    try {
      const pending = await this.api.listPendingProposals(
        proposal.conversationId
      );
      const persisted = pending.find(
        (candidate) => candidate.id === proposal.id
      );
      if (!persisted) {
        this.removeResolvedProposal(proposal.id);
        return false;
      }
      pendingProposal = persisted;
    } catch {
      // The event payload contains a durable preview. A transient refresh
      // failure should not prevent immediate review.
    }

    const preview = storedUpdatePreview(pendingProposal);
    if (!preview) return false;
    const controller = this.getController(paneId);
    return this.deps.getProposalOrchestration().loadDurableProposal({
      proposalId: pendingProposal.id,
      noteId: pendingProposal.noteId,
      preview,
      commit: (markdown: string) =>
        controller.keepProposal(pendingProposal.id, markdown),
      dismiss: () =>
        controller.dismissProposal(pendingProposal.id)
    });
  }

  async openProjection(
    paneId: TPaneId,
    notePath: string | null,
    targetAnchor: string | null = null
  ) {
    if (!notePath) return false;
    const conversationId =
      await this.api.findConversationByProjectionPath(
        notePath.replaceAll('\\', '/')
      );
    if (!conversationId) return false;

    this.deps.touchPaneLocation(paneId);
    this.deps.setStoredPaneKind(paneId, 'chat');
    this.deps.setPaneConversationId(paneId, conversationId);
    // Touch after the kind flips so the chat location enters the session MRU.
    this.deps.touchPaneLocation(paneId);
    this.targetAnchors[paneId] = targetAnchor;
    this.deps.setActivePane(paneId);
    await this.getController(paneId).initialize(conversationId);
    await tick();
    this.deps.focusPane(paneId);
    return true;
  }

  async discussSelection(sourcePaneId: TPaneId, selectedText: string) {
    const text = selectedText.trim();
    if (!text || this.discussionInProgress) return;
    this.discussionInProgress = true;

    try {
      const order = [...this.deps.getPaneOrder()];
      let chatPaneId =
        order.find(
          (paneId) => this.deps.getPaneKind(paneId) === 'chat'
        ) ?? null;
      let openedNewChatSurface = false;
      let createdSplitPane = false;

      if (!chatPaneId && order.length < this.deps.maxVisiblePanes) {
        const previousPaneIds = new Set(order);
        await this.deps.splitWorkspace();
        chatPaneId =
          this.deps
            .getPaneOrder()
            .find((paneId) => !previousPaneIds.has(paneId)) ?? null;
        openedNewChatSurface = Boolean(chatPaneId);
        createdSplitPane = Boolean(chatPaneId);
      }

      if (!chatPaneId) {
        chatPaneId =
          order.find((paneId) => paneId !== sourcePaneId) ?? null;
        openedNewChatSurface = Boolean(
          chatPaneId &&
            this.deps.getPaneKind(chatPaneId) !== 'chat'
        );
      }
      if (!chatPaneId) return;

      const controller = this.getController(chatPaneId);
      let conversation = controller.getSnapshot().conversation;

      if (openedNewChatSurface) {
        await controller.initialize();
        const label = text.replace(/\s+/g, ' ').slice(0, 48);
        controller.startNewConversation({
          title: label ? `About: ${label}` : 'Selection discussion'
        });
        conversation = null;
      } else {
        const conversationId =
          this.deps.getPaneConversationId(chatPaneId);
        if (
          !conversation ||
          (conversationId && conversation.id !== conversationId)
        ) {
          await controller.initialize(conversationId);
          conversation = controller.getSnapshot().conversation;
        }
        if (!conversation) {
          controller.startNewConversation({
            title: 'Selection discussion'
          });
        }
      }

      if (conversation) {
        this.deps.setPaneConversationId(
          chatPaneId,
          conversation.id
        );
      }

      const sourceDocument = this.deps.getPaneDocument(sourcePaneId);
      this.discussionSeedCounter += 1;
      this.draftSeeds[chatPaneId] = {
        id: `${Date.now()}-${this.discussionSeedCounter}`,
        text: formatDiscussionDraft(text, sourceDocument.title)
      };

      if (createdSplitPane) {
        await this.deps.resolvePaneCommandChoice(
          chatPaneId,
          'thoughtPartner'
        );
      } else if (this.deps.getPaneKind(chatPaneId) !== 'chat') {
        await this.deps.setPaneKind(chatPaneId, 'chat');
      } else {
        this.deps.setActivePane(chatPaneId);
      }
      await tick();
    } finally {
      this.discussionInProgress = false;
    }
  }

  async startNewActiveItem() {
    const paneId = this.deps.getActivePaneId();
    if (this.deps.getPaneKind(paneId) !== 'chat') {
      await this.deps.startNewNote();
      return;
    }
    if (this.canUnforget(paneId)) this.recentlyForgotten = null;
    this.getController(paneId).startNewConversation();
  }

  async forgetActiveItem() {
    const paneId = this.deps.getActivePaneId();
    if (this.deps.getPaneKind(paneId) !== 'chat') {
      this.recentlyForgotten = null;
      await this.deps.forgetNote();
      return;
    }

    const controller = this.getController(paneId);
    const conversation = controller.getSnapshot().conversation;
    if (!conversation) return;
    const forgottenItem = await controller.archiveConversation(
      undefined,
      this.deps.forgottenNoteRetentionPreference()
    );
    if (!forgottenItem?.forgottenPath) return;

    this.deps.clearRecentlyForgottenNote();
    this.recentlyForgotten = {
      paneId,
      conversationId: conversation.id,
      title: conversation.title,
      forgottenPath: forgottenItem.forgottenPath
    };
  }

  async unforgetActiveItem() {
    const paneId = this.deps.getActivePaneId();
    if (this.deps.getPaneKind(paneId) !== 'chat') {
      await this.deps.unforgetNote();
      return;
    }

    const forgotten = this.recentlyForgotten;
    if (!forgotten || forgotten.paneId !== paneId) return;

    try {
      const [restored] = await restoreForgottenNotes([
        forgotten.forgottenPath
      ]);
      if (!restored) return;

      this.recentlyForgotten = null;
      const conversationId =
        restored.conversationId ?? forgotten.conversationId;
      const controller = this.getController(paneId);
      await controller.refreshList();
      const conversation =
        await controller.openConversation(conversationId);
      if (!conversation) return;

      this.deps.setPaneConversationId(
        paneId,
        conversation.id
      );
      this.targetAnchors[paneId] = null;
      this.deps.touchPaneLocation(paneId);
      await tick();
      this.deps.focusPane(paneId);
    } catch (error) {
      console.error('Failed to restore forgotten chat:', error);
    }
  }

  disposePane(paneId: TPaneId) {
    this.controllers.get(paneId)?.dispose();
    this.controllers.delete(paneId);
    this.surfaceHandles.delete(paneId);
    if (this.recentlyForgotten?.paneId === paneId) {
      this.recentlyForgotten = null;
    }
    delete this.draftSeeds[paneId];
    delete this.targetAnchors[paneId];
  }

  dispose() {
    for (const controller of this.controllers.values()) {
      controller.dispose();
    }
    this.controllers.clear();
    this.surfaceHandles.clear();
  }

  private removeResolvedProposal(proposalId: string) {
    for (const controller of this.controllers.values()) {
      controller.removeResolvedProposal(proposalId);
    }
  }

  private async insertSelectionIntoNote(selection: ChatSelection) {
    const destinationPaneId = this.deps.getEditorPaneIds()[0];
    if (!destinationPaneId) {
      throw new Error(
        'Open a note beside the conversation before inserting.'
      );
    }
    const document = this.deps.getPaneDocument(destinationPaneId);
    const result = this.deps.insertMarkdown({
      noteKey: document.key,
      expectedDocumentRevision: document.operationRevision,
      markdown: formatChatInsertion(selection),
      target: 'selection',
      focus: true,
      scrollIntoView: true
    });
    if (result.status === 'target-changed') {
      throw new Error(
        'The destination note changed. Choose the note and try again.'
      );
    }
    if (result.status === 'editor-unavailable') {
      throw new Error(
        'The destination note is not ready for insertion.'
      );
    }
  }
}

function storedUpdatePreview(
  proposal: ChatAgentProposal
): ProposalPreview | null {
  if (proposal.kind !== 'update') return null;
  const preview = proposal.preview as Partial<ProposalPreview>;
  if (
    typeof preview.reviewId !== 'string' ||
    typeof preview.notePath !== 'string' ||
    typeof preview.title !== 'string' ||
    typeof preview.baseContentHash !== 'string' ||
    typeof preview.baseEditorMarkdown !== 'string' ||
    typeof preview.proposedEditorMarkdown !== 'string' ||
    !Array.isArray(preview.hunks)
  ) {
    return null;
  }
  return preview as ProposalPreview;
}

function formatChatInsertion(selection: ChatSelection) {
  const quote = selection.text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  const backlink = selection.linkTarget
    ? `[[${selection.linkTarget}|Open in chat]]`
    : '';
  return `${quote}${backlink ? `\n> — ${backlink}` : ''}\n\n`;
}
