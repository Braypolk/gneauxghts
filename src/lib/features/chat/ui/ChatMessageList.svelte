<script lang="ts">
  import { untrack } from 'svelte';
  import { LoaderCircle } from '@lucide/svelte';
  import type { ChatController } from '../controller.svelte';
  import type {
    ChatAttachmentInput,
    ChatCitation,
    ChatConversation,
    ChatExcerpt,
    ChatMessage as ChatMessageModel,
    ChatSelection,
    ChatSelectionActions
  } from '../types';
  import ChatMessage from './ChatMessage.svelte';
  import { resolveTargetMessageId } from './chatPanelHelpers';
  import {
    createChatScrollScheduler,
    followLatestChatContent,
    isNearLatestChatContent,
    positionInitialChatScroll
  } from './chatMessageScroll';
  import { chatSelectionToMarkdown } from './chatSelectionMarkdown';

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
    onOpenWikilink?: (rawTarget: string) => void | Promise<void>;
    onPreviewAttachment: (attachment: ChatAttachmentInput) => void;
    onActionError: (message: string | null) => void;
    onReviewProposal?: (proposalId: string) => void | Promise<void>;
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
    onOpenWikilink,
    onPreviewAttachment,
    onActionError,
    onReviewProposal
  }: Props = $props();

  let messagesElement = $state<HTMLElement | null>(null);
  let selected = $state<ChatSelection | null>(null);
  let selectedMarkdown = $state<string | null>(null);
  let selectedExcerpt = $state<ChatExcerpt | null>(null);
  // One-shot guards are deliberately non-reactive to avoid effect↔state loops.
  let positionedConversationId: string | null = null;
  let appliedTargetAnchor: string | null = null;
  let previousScrollKey: string | null = null;
  let isFollowingLatest = $state(true);
  const scroll = createChatScrollScheduler();
  const scrollConversationId = $derived(conversation?.id ?? null);

  $effect.pre(() => {
    scrollConversationId;
    messagesElement;
    isInitializing;
    isLoadingConversation;
    // Cancel pending work before a root/conversation change and on teardown.
    return scroll.cancel;
  });

  // Mount restored history in bounded batches so parsing Markdown and creating
  // message components cannot monopolize a pane-opening animation frame.
  let renderedConversationId = $state<string | null>(null);
  let renderedCount = $state(0);
  const visibleMessages = $derived(
    renderedConversationId === conversation?.id
      ? conversation.messages.slice(0, renderedCount)
      : []
  );
  const isRenderingHistory = $derived(
    Boolean(conversation && visibleMessages.length < conversation.messages.length)
  );

  $effect.pre(() => {
    const current = conversation;
    const loading = isInitializing || isLoadingConversation;
    const count = current?.messages.length ?? 0;
    let frame: number | undefined;
    untrack(() => {
      if (!current || loading) {
        renderedConversationId = null;
        renderedCount = 0;
        return;
      }
      if (renderedConversationId !== current.id) {
        renderedConversationId = current.id;
        renderedCount = 0;
      }
      const renderBatch = () => {
        renderedCount = Math.min(count, renderedCount + 8);
        if (renderedCount < count) frame = requestAnimationFrame(renderBatch);
      };
      renderBatch();
    });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  });

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
    if (!current || isInitializing || isLoadingConversation) {
      positionedConversationId = null;
      appliedTargetAnchor = null;
      previousScrollKey = null;
      isFollowingLatest = true;
      return;
    }
    if (
      !root ||
      isRenderingHistory ||
      positionedConversationId === current.id
    ) return;

    positionInitialConversation(root, current);
    positionedConversationId = current.id;
    previousScrollKey = scrollKeyFor(current);
    isFollowingLatest = isNearLatestChatContent(root);

    // Correct for layout completed later in the frame (for example message
    // components with measured content) without introducing animation.
    scroll.schedule('initial', () => {
      if (
        messagesElement === root &&
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
      isRenderingHistory ||
      positionedConversationId !== current.id ||
      targetKey === appliedTargetAnchor
    ) return;
    appliedTargetAnchor = targetKey;
    isFollowingLatest = false;
    scroll.schedule('anchor', () => {
      if (messagesElement !== root || scrollConversationId !== current.id ||
        appliedTargetAnchor !== targetKey) return;
      root
        .querySelector<HTMLElement>(
          `[data-chat-message-id="${CSS.escape(messageId)}"]`
        )
        ?.scrollIntoView({
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'center'
        });
    });
  });

  $effect(() => {
    const current = conversation;
    const scrollKey = current ? scrollKeyFor(current) : null;
    const root = messagesElement;
    if (
      !current ||
      !root ||
      isRenderingHistory ||
      positionedConversationId !== current.id ||
      (scrollKey === previousScrollKey && !isSending) ||
      !isFollowingLatest
    ) return;
    previousScrollKey = scrollKey;
    scroll.schedule('follow', () => {
      if (
        messagesElement === root &&
        positionedConversationId === current.id &&
        isFollowingLatest
      ) {
        followLatestChatContent(root);
      }
    });
  });

  function updateScrollFollowing(event: Event) {
    if (isRenderingHistory) return;
    isFollowingLatest = isNearLatestChatContent(
      event.currentTarget as HTMLElement
    );
  }

  function captureSelection(event: Event) {
    const root = event.currentTarget as HTMLElement;
    queueMicrotask(() => {
      const browserSelection = window.getSelection();
      const text = browserSelection?.toString().trim() ?? '';
      const anchor = browserSelection?.anchorNode;
      if (!text || !anchor || !root.contains(anchor)) {
        selected = null;
        selectedMarkdown = null;
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
      if (!current || !message || !messageElement) return;
      selectedMarkdown = chatSelectionToMarkdown(
        browserSelection,
        messageElement
      ) ?? text;
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
      await navigator.clipboard.writeText(selectedMarkdown ?? selected.text);
      await selectionActions.onCopy?.(selected);
    } catch (error) {
      onActionError(
        error instanceof Error ? error.message : 'Unable to copy selection.'
      );
    }
  }

  async function copyMessage(message: ChatMessageModel) {
    try {
      await navigator.clipboard.writeText(message.content);
      onActionError(null);
    } catch (error) {
      onActionError(
        error instanceof Error ? error.message : 'Unable to copy message.'
      );
    }
  }

  function copyNativeSelection(event: ClipboardEvent) {
    const browserSelection = window.getSelection();
    const anchor = browserSelection?.anchorNode;
    if (!browserSelection || !anchor || !messagesElement?.contains(anchor)) return;
    const element = anchor instanceof Element ? anchor : anchor.parentElement;
    const messageElement = element?.closest<HTMLElement>('[data-chat-message-id]');
    if (!messageElement) return;
    const markdown = chatSelectionToMarkdown(browserSelection, messageElement);
    if (!markdown || !event.clipboardData) return;

    event.preventDefault();
    event.clipboardData.setData('text/plain', markdown);
    event.clipboardData.setData('text/markdown', markdown);
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

  async function openWikilink(rawTarget: string) {
    try {
      await onOpenWikilink?.(rawTarget);
      onActionError(null);
    } catch (error) {
      onActionError(
        error instanceof Error
          ? error.message
          : 'Unable to open the linked note.'
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
  class="relative min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto py-4 sm:py-5"
  role="log"
  data-pane-content
  aria-live="polite"
  aria-busy={isInitializing || isLoadingConversation || isRenderingHistory}
  onscroll={updateScrollFollowing}
  onpointerup={captureSelection}
  onkeyup={captureSelection}
  oncopy={copyNativeSelection}
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
    {#if isRenderingHistory}
      <div class="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle class="h-4 w-4 animate-spin" /> Loading conversation…
      </div>
    {/if}
    <div class="chat-content-lane flex flex-col gap-5" class:invisible={isRenderingHistory} inert={isRenderingHistory} aria-hidden={isRenderingHistory || undefined}>
      {#each visibleMessages as message (message.id)}
        <ChatMessage
          {message}
          {activity}
          {selected}
          {selectedExcerpt}
          canInsertSelection={Boolean(selectionActions.onInsertIntoNote)}
          canDecidePermission={Boolean(
            conversation.activeRequestId &&
            conversation.activeRequestId === message.requestId &&
            message.status === 'streaming'
          )}
          {onPreviewAttachment}
          onOpenCitation={openCitation}
          onOpenWikilink={openWikilink}
          onRetry={() => controller.retry(message.id)}
          onBranch={async () => { await controller.branchFromMessage(message.id); }}
          onCopyMessage={() => copyMessage(message)}
          onCopySelection={copySelection}
          onCopyLink={copyLink}
          onInsertSelection={insertSelection}
          onToggleRemember={toggleRemember}
          onDecidePermission={async (request, decision) => {
            await controller.decidePermission(request, decision);
          }}
          onReviewProposal={(proposalId) => onReviewProposal?.(proposalId)}
        />
      {/each}
    </div>
  {/if}
</div>
