<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type {
    ChatController,
    ChatControllerState
  } from './controller.svelte';
  import type { ChatDraftSeed } from './discussionContext';
  import type {
    ChatActiveNoteSnapshot,
    ChatAgentProposal,
    ChatAttachmentInput,
    ChatCitation,
    ChatContextNote,
    ChatSelectionActions,
    ChatSurfaceHandle
  } from './types';
  import type { ProposalReviewSessionSnapshot } from '$lib/features/proposals/types';
  import { reviewBelongsToConversation } from './proposalVisibility';
  import AttachmentPreview from './AttachmentPreview.svelte';
  import ChatComposer from './ui/ChatComposer.svelte';
  import ChatHeader from './ui/ChatHeader.svelte';
  import ChatMessageList from './ui/ChatMessageList.svelte';
  import ChatProposalRegion from './ui/ChatProposalRegion.svelte';
  import './ui/chatPanel.css';

  interface Props {
    controller: ChatController;
    conversationId?: string | null;
    autoInitialize?: boolean;
    variant?: 'pane' | 'focused' | 'inline';
    showConversationPicker?: boolean;
    selectionActions?: ChatSelectionActions;
    onConversationChange?: (conversationId: string | null) => void;
    onSurfaceHandleChange?: (handle: ChatSurfaceHandle | null) => void;
    onOpenCitation?: (
      citation: Extract<ChatCitation, { kind: 'note' }>
    ) => void | Promise<void>;
    placeholder?: string;
    draftSeed?: ChatDraftSeed | null;
    contextNote?: ChatContextNote | null;
    getActiveNoteSnapshot?: () => Promise<ChatActiveNoteSnapshot | null>;
    targetAnchor?: string | null;
    proposalSnapshot?: ProposalReviewSessionSnapshot | null;
    onProposalKeepAll?: () => void | Promise<void>;
    onProposalUndoAll?: () => void | Promise<void>;
    onProposalReview?: () => void | Promise<void>;
    onProposalRetry?: () => void | Promise<void>;
    onProposalCopyCurrent?: () => void | Promise<void>;
    onProposalReloadDisk?: () => void | Promise<void>;
    onReviewAgentProposal?: (
      proposal: ChatAgentProposal
    ) => void | Promise<void>;
  }

  let {
    controller,
    conversationId = null,
    autoInitialize = true,
    variant = 'pane',
    showConversationPicker = true,
    selectionActions = {},
    onConversationChange,
    onSurfaceHandleChange,
    onOpenCitation,
    placeholder = 'What are you thinking about?',
    draftSeed = null,
    contextNote = null,
    getActiveNoteSnapshot,
    targetAnchor = null,
    proposalSnapshot = null,
    onProposalKeepAll,
    onProposalUndoAll,
    onProposalReview,
    onProposalRetry,
    onProposalCopyCurrent,
    onProposalReloadDisk,
    onReviewAgentProposal
  }: Props = $props();

  // The first render must reflect the controller, not a duplicated placeholder
  // state. A placeholder briefly styled full-vault chats as approved-only while
  // the component waited for onMount to copy the real snapshot.
  let snapshot = $state<ChatControllerState>(
    untrack(() => controller.getSnapshot())
  );
  let titleDraft = $state('');
  let actionError = $state<string | null>(null);
  let previewAttachment = $state<ChatAttachmentInput | null>(null);
  let composerElement = $state<HTMLTextAreaElement | null>(null);
  let reportedConversationId: string | null | undefined;
  let openMenu = $state<'history' | 'vault' | 'provider' | null>(null);

  const visibleProposalSnapshot = $derived(
    reviewBelongsToConversation(
      proposalSnapshot,
      snapshot.proposals,
      snapshot.conversation?.id
    )
      ? proposalSnapshot
      : null
  );

  $effect(() => {
    const notify = onSurfaceHandleChange;
    const element = composerElement;
    if (!notify) return;
    if (!element) {
      notify(null);
      return;
    }
    const handle: ChatSurfaceHandle = {
      focusComposer() {
        element.focus({ preventScroll: true });
        return true;
      }
    };
    notify(handle);
    return () => notify(null);
  });

  onMount(() => {
    const unsubscribe = controller.subscribe((next) => {
      snapshot = next;
      const nextConversationId = next.conversation?.id ?? null;
      if (nextConversationId !== reportedConversationId) {
        reportedConversationId = nextConversationId;
        onConversationChange?.(nextConversationId);
      }
    });

    if (
      autoInitialize &&
      !controller.getSnapshot().settings &&
      !controller.getSnapshot().isInitializing
    ) {
      void controller.initialize(conversationId);
    } else if (
      autoInitialize &&
      conversationId &&
      controller.getSnapshot().conversation?.id !== conversationId
    ) {
      void controller.openConversation(conversationId);
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-chat-menu]')) return;
      openMenu = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') openMenu = null;
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      unsubscribe();
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  });

  function dismissError() {
    actionError = null;
    controller.clearError();
  }
</script>

<section
  class={`chat-panel chat-panel--${variant} flex h-full min-h-0 w-full flex-col overflow-hidden`}
  aria-label="Thought partner chat"
>
  <ChatHeader
    {controller}
    {snapshot}
    {showConversationPicker}
    bind:titleDraft
    {openMenu}
    onOpenMenu={(menu) => (openMenu = menu)}
    onFocusComposer={() => composerElement?.focus()}
  />

  <ChatMessageList
    {controller}
    conversation={snapshot.conversation}
    isInitializing={snapshot.isInitializing}
    isLoadingConversation={snapshot.isLoadingConversation}
    isSending={snapshot.isSending}
    activity={snapshot.activity}
    {targetAnchor}
    {selectionActions}
    {onOpenCitation}
    onPreviewAttachment={(attachment) => (previewAttachment = attachment)}
    onActionError={(message) => (actionError = message)}
  />

  <div class="chat-panel-bottom shrink-0">
    <ChatProposalRegion
      {controller}
      proposals={snapshot.proposals}
      {visibleProposalSnapshot}
      {onProposalKeepAll}
      {onProposalUndoAll}
      {onProposalReview}
      {onProposalRetry}
      {onProposalCopyCurrent}
      {onProposalReloadDisk}
      {onReviewAgentProposal}
    />

    <ChatComposer
      {controller}
      {snapshot}
      {variant}
      {placeholder}
      {titleDraft}
      {draftSeed}
      {contextNote}
      {getActiveNoteSnapshot}
      {openMenu}
      {actionError}
      bind:composerElement
      onOpenMenu={(menu) => (openMenu = menu)}
      onActionError={(message) => (actionError = message)}
      onDismissError={dismissError}
      onPreviewAttachment={(attachment) => (previewAttachment = attachment)}
    />
  </div>
</section>

{#if previewAttachment}
  {#key previewAttachment}
    <AttachmentPreview
      attachment={previewAttachment}
      onClose={() => (previewAttachment = null)}
    />
  {/key}
{/if}
