import { tick } from 'svelte';
import type { ForgottenNoteRetentionPreference } from '$lib/appSettings.svelte';
import { chatApi, type ChatApi } from '$lib/features/chat/api';
import {
  createChatController,
  type ChatController
} from '$lib/features/chat/controller.svelte';
import type {
  ChatAgentProposal,
  ChatSelection,
  ChatSelectionActions,
  ChatSurfaceHandle
} from '$lib/features/chat/types';
import type { NotepadFeatureHost } from '$lib/features/notepad/host';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import { getDocumentPath } from '$lib/features/notepad/document/documentState';
import type {
  createProposalOrchestration,
  DurableProposalReviewRequest
} from '$lib/features/proposals/proposalOrchestration';
import type { ProposalPreview } from '$lib/types/proposals';
import { restoreForgottenNotes } from '$lib/features/notepad/session/session';
import type { PaneKind } from '$lib/features/notepad/workspace/paneTypes';
import { paneHasCapability } from '$lib/features/notepad/workspace/paneCapabilities';

interface RecentlyForgottenChat<TPaneId extends string> {
  paneId: TPaneId;
  conversationId: string;
  title: string;
  forgottenPath: string;
}

export interface NotepadChatCoordinatorDeps<TPaneId extends string> {
  getPaneOrder: () => TPaneId[];
  getActivePaneId: () => TPaneId;
  getPaneKind: (paneId: TPaneId) => PaneKind;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  getEditorPaneIds: () => TPaneId[];
  getPaneConversationId: (paneId: TPaneId) => string | null;
  setPaneConversationId: (
    paneId: TPaneId,
    conversationId: string | null
  ) => void;
  setStoredPaneKind: (
    paneId: TPaneId,
    kind: PaneKind
  ) => boolean;
  setActivePane: (paneId: TPaneId) => void;
  touchPaneLocation: (paneId: TPaneId) => void;
  splitWorkspace: () => Promise<void>;
  resolvePaneCommandChoice: (
    paneId: TPaneId,
    choice: 'thoughtPartner'
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
        onProposalAvailable: async (proposal) => {
          await this.showAgentProposalIfOpen(paneId, proposal);
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

  private paneHostsChat(paneId: TPaneId): boolean {
    return paneHasCapability(
      this.deps.getPaneKind(paneId),
      'host-chat'
    );
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
    const request = await this.durableProposalReviewRequest(
      paneId,
      proposal
    );
    if (!request) return false;
    return this.deps
      .getProposalOrchestration()
      .loadDurableProposal(request);
  }

  async showAgentProposalIfOpen(
    paneId: TPaneId,
    proposal: ChatAgentProposal
  ): Promise<boolean> {
    try {
      const request = await this.durableProposalReviewRequest(
        paneId,
        proposal
      );
      if (!request) return false;
      return this.deps
        .getProposalOrchestration()
        .loadDurableProposalIfOpen(request);
    } catch {
      // Passive display is opportunistic. The proposal remains queued for an
      // explicit review if its editor or orchestration is not ready yet.
      return false;
    }
  }

  async showPendingProposalsForDocument(
    document: NoteDraftState
  ): Promise<boolean> {
    const path = getDocumentPath(document);
    if (!path) return false;
    let displayed = false;
    for (const [paneId, controller] of this.controllers) {
      const matching = controller
        .getSnapshot()
        .proposals.filter(
          (proposal) =>
            storedUpdatePreview(proposal)?.notePath === path
        );
      for (const proposal of matching) {
        try {
          displayed =
            (await this.showAgentProposalIfOpen(
              paneId,
              proposal
            )) || displayed;
        } catch {
          // Passive reconciliation must never turn editor presentation into
          // navigation failure or interrupt the note-opening lifecycle.
        }
      }
    }
    return displayed;
  }

  private async durableProposalReviewRequest(
    paneId: TPaneId,
    proposal: ChatAgentProposal
  ): Promise<DurableProposalReviewRequest | null> {
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
        return null;
      }
      pendingProposal = persisted;
    } catch {
      // The event payload contains a durable preview. A transient refresh
      // failure should not prevent immediate review.
    }

    const preview = storedUpdatePreview(pendingProposal);
    if (!preview) return null;
    const controller = this.getController(paneId);
    return {
      proposalId: pendingProposal.id,
      noteId: pendingProposal.noteId,
      preview,
      commit: (markdown: string) =>
        controller.keepProposal(pendingProposal.id, markdown),
      dismiss: () =>
        controller.dismissProposal(pendingProposal.id)
    };
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

    let chatPaneId = paneId;
    this.deps.touchPaneLocation(chatPaneId);
    if (!this.deps.setStoredPaneKind(chatPaneId, 'chat')) {
      const previousPaneIds = new Set(
        this.deps.getPaneOrder()
      );
      await this.deps.splitWorkspace();
      chatPaneId =
        this.deps
          .getPaneOrder()
          .find((candidate) => !previousPaneIds.has(candidate)) ??
        paneId;
      if (chatPaneId === paneId) return false;
      await this.deps.resolvePaneCommandChoice(
        chatPaneId,
        'thoughtPartner'
      );
      if (!this.paneHostsChat(chatPaneId)) {
        return false;
      }
    }
    this.deps.setPaneConversationId(chatPaneId, conversationId);
    // Touch after the kind flips so the chat location enters the session MRU.
    this.deps.touchPaneLocation(chatPaneId);
    this.targetAnchors[chatPaneId] = targetAnchor;
    this.deps.setActivePane(chatPaneId);
    await this.getController(chatPaneId).initialize(
      conversationId
    );
    await tick();
    this.deps.focusPane(chatPaneId);
    return true;
  }

  async startNewActiveItem() {
    const paneId = this.deps.getActivePaneId();
    if (!this.paneHostsChat(paneId)) {
      await this.deps.startNewNote();
      return;
    }
    if (this.canUnforget(paneId)) this.recentlyForgotten = null;
    this.getController(paneId).startNewConversation();
  }

  async forgetActiveItem() {
    const paneId = this.deps.getActivePaneId();
    if (!this.paneHostsChat(paneId)) {
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
    if (!this.paneHostsChat(paneId)) {
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
      if (restored.commitWarning) {
        console.warn(
          'Forgotten item was recovered with incomplete timeline synchronization:',
          restored.commitWarning
        );
      }

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
      documentHandle: document.handle,
      expectedDocumentRevision: document.operation.revision,
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
