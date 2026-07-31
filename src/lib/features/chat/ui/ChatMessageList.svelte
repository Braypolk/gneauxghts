<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte';
  import type { ChatController } from '../controller.svelte';
  import type {
    ChatAttachmentInput,
    ChatCitation,
    ChatConversation,
    ChatExcerpt,
    ChatSelection,
    ChatSelectionActions
  } from '../types';
  import ChatMessage from './ChatMessage.svelte';
  import { resolveTargetMessageId } from './chatPanelHelpers';
  import { positionInitialChatScroll } from './chatMessageScroll';

  interface Props {
    controller: ChatController;
    conversation: ChatConversation | null;
    isInitializing: boolean;
    isLoadingConversation: boolean;
    isSending: boolean;
    activity: string | null;
    targetAnchor?: string | null;
    selectionActions?: ChatSelectionActions;
    onOpenCitation?: (
      citation: Extract<ChatCitation, { kind: 'note' }>
    ) => void | Promise<void>;
    onPreviewAttachment: (attachment: ChatAttachmentInput) => void;
    onActionError: (message: string | null) => void;
  }

  let {
    controller,
    conversation,
    isInitializing,
    isLoadingConversation,
    isSending,
    activity,
    targetAnchor = null,
    selectionActions = {},
    onOpenCitation,
    onPreviewAttachment,
    onActionError
  }: Props = $props();

  let messagesElement = $state<HTMLElement | null>(null);
  let selected = $state<ChatSelection | null>(null);
  let selectedExcerpt = $state<ChatExcerpt | null>(null);
  // One-shot guards are deliberately non-reactive to avoid effect↔state loops.
  let positionedConversationId: string | null = null;
  let appliedTargetAnchor: string | null = null;
  let previousScrollKey: string | null = null;

  const isEmpty = $derived(!conversation || conversation.messages.length === 0);

  function scrollKeyFor(current: ChatConversation) {
    const lastMessage = current.messages.at(-1);
    return lastMessage
      ? `${lastMessage.id}:${lastMessage.updatedAtMillis}:${activity ?? ''}`
      : null;
  }

  function positionInitialConversation(
    root: HTMLElement,
    current: ChatConversation
  ) {
    const messageId = resolveTargetMessageId(targetAnchor, current);
    const anchor = targetAnchor?.replace(/^\^/, '') ?? null;
    const target = messageId
      ? root.querySelector<HTMLElement>(
          `[data-chat-message-id="${CSS.escape(messageId)}"]`
        )
      : null;
    if (anchor && target) {
      positionInitialChatScroll(root, target);
      appliedTargetAnchor = `${current.id}:${anchor}`;
      return;
    }
    // Initial conversation positioning is intentionally immediate. Scheduling
    // a smooth scroll here paints the thread at the top before animating down.
    positionInitialChatScroll(root, null);
  }

  $effect(() => {
    const current = conversation;
    const root = messagesElement;
    if (!current) {
      positionedConversationId = null;
      appliedTargetAnchor = null;
      previousScrollKey = null;
      return;
    }
    if (
      !root ||
      isInitializing ||
      isLoadingConversation ||
      positionedConversationId === current.id
    ) return;

    positionInitialConversation(root, current);
    positionedConversationId = current.id;
    previousScrollKey = scrollKeyFor(current);

    // Correct for layout completed later in the frame (for example message
    // components with measured content) without introducing animation.
    requestAnimationFrame(() => {
      if (
        controller.getSnapshot().conversation?.id === current.id &&
        positionedConversationId === current.id
      ) {
        positionInitialConversation(root, current);
      }
    });
  });

  $effect(() => {
    const current = conversation;
    const messageId = resolveTargetMessageId(targetAnchor, current);
    const anchor = targetAnchor?.replace(/^\^/, '') ?? null;
    const root = messagesElement;
    const targetKey = current && anchor ? `${current.id}:${anchor}` : null;
    if (
      !current ||
      !anchor ||
      !messageId ||
      !root ||
      positionedConversationId !== current.id ||
      targetKey === appliedTargetAnchor
    ) return;
    appliedTargetAnchor = targetKey;
    requestAnimationFrame(() => {
      root
        .querySelector<HTMLElement>(
          `[data-chat-message-id="${CSS.escape(messageId)}"]`
        )
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  $effect(() => {
    const current = conversation;
    const scrollKey = current ? scrollKeyFor(current) : null;
    const root = messagesElement;
    if (
      !current ||
      !root ||
      positionedConversationId !== current.id ||
      (scrollKey === previousScrollKey && !isSending)
    ) return;
    previousScrollKey = scrollKey;
    requestAnimationFrame(() => {
      root.scrollTo({ top: root.scrollHeight, behavior: 'smooth' });
    });
  });

  function captureSelection(event: Event) {
    const root = event.currentTarget as HTMLElement;
    queueMicrotask(() => {
      const browserSelection = window.getSelection();
      const text = browserSelection?.toString().trim() ?? '';
      const anchor = browserSelection?.anchorNode;
      if (!text || !anchor || !root.contains(anchor)) {
        selected = null;
        selectedExcerpt = null;
        return;
      }
      const element = anchor instanceof Element ? anchor : anchor.parentElement;
      const messageElement = element?.closest<HTMLElement>(
        '[data-chat-message-id]'
      );
      const messageId = messageElement?.dataset.chatMessageId;
      const current = controller.getSnapshot().conversation;
      const message = current?.messages.find((item) => item.id === messageId);
      if (!current || !message) return;
      selected = {
        conversationId: current.id,
        messageId: message.id,
        text,
        linkTarget: message.linkTarget
      };
      selectedExcerpt = null;
      onActionError(null);
    });
  }

  async function copySelection() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.text);
      await selectionActions.onCopy?.(selected);
    } catch (error) {
      onActionError(
        error instanceof Error ? error.message : 'Unable to copy selection.'
      );
    }
  }

  async function ensureExcerpt() {
    if (!selected) return null;
    if (selectedExcerpt) return selectedExcerpt;
    selectedExcerpt = await controller.createExcerpt(
      selected.messageId,
      selected.text
    );
    selected = { ...selected, linkTarget: selectedExcerpt.linkTarget };
    return selectedExcerpt;
  }

  async function copyLink() {
    if (!selected) return;
    try {
      const excerpt = await ensureExcerpt();
      if (!excerpt) return;
      await navigator.clipboard.writeText(`[[${excerpt.linkTarget}]]`);
      await selectionActions.onCopyLink?.({
        ...selected,
        linkTarget: excerpt.linkTarget
      });
    } catch (error) {
      onActionError(
        error instanceof Error ? error.message : 'Unable to create a link.'
      );
    }
  }

  async function insertSelection() {
    if (!selected) return;
    try {
      const excerpt = await ensureExcerpt();
      await selectionActions.onInsertIntoNote?.({
        ...selected,
        linkTarget: excerpt?.linkTarget ?? selected.linkTarget
      });
    } catch (error) {
      onActionError(
        error instanceof Error
          ? error.message
          : 'Unable to insert this passage.'
      );
    }
  }

  async function openCitation(
    citation: Extract<ChatCitation, { kind: 'note' }>
  ) {
    try {
      await onOpenCitation?.(citation);
      onActionError(null);
    } catch (error) {
      onActionError(
        error instanceof Error
          ? error.message
          : 'Unable to open the referenced note.'
      );
    }
  }

  async function toggleRemember() {
    if (!selected) return;
    try {
      if (selectedExcerpt?.remembered) {
        selectedExcerpt = await controller.unremember(selectedExcerpt.id);
        await selectionActions.onUnremember?.(selected, selectedExcerpt);
      } else {
        const excerpt = await ensureExcerpt();
        if (!excerpt) return;
        selectedExcerpt = await controller.rememberExcerpt(excerpt.id);
        await selectionActions.onRemember?.(selected, selectedExcerpt);
      }
    } catch (error) {
      onActionError(
        error instanceof Error ? error.message : 'Unable to update memory.'
      );
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={messagesElement}
  class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5"
  role="log"
  aria-live="polite"
  onpointerup={captureSelection}
  onkeyup={captureSelection}
>
  {#if isInitializing || isLoadingConversation}
    <div class="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle class="h-4 w-4 animate-spin" /> Loading conversation…
    </div>
  {:else if isEmpty}
    <div class="mx-auto flex h-full max-w-sm flex-col items-center justify-center px-5 text-center">
      <p class="text-sm font-medium text-foreground">
        Start with what you’re working through
      </p>
      <p class="mt-2 text-sm leading-6 text-muted-foreground">
        Discuss the note beside this, ask a direct question, or work an unfinished
        thought into shape.
      </p>
    </div>
  {:else if conversation}
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
      {#each conversation.messages as message (message.id)}
        <ChatMessage
          {message}
          {activity}
          {selected}
          {selectedExcerpt}
          canInsertSelection={Boolean(selectionActions.onInsertIntoNote)}
          {onPreviewAttachment}
          onOpenCitation={openCitation}
          onRetry={() => controller.retry(message.id)}
          onCopySelection={copySelection}
          onCopyLink={copyLink}
          onInsertSelection={insertSelection}
          onToggleRemember={toggleRemember}
        />
      {/each}
    </div>
  {/if}
</div>
