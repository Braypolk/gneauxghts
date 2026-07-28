<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import MarkdownIt from 'markdown-it';
  import {
    AlertCircle,
    Brain,
    Check,
    ChevronDown,
    Copy,
    ExternalLink,
    FileInput,
    Globe,
    History,
    Link,
    LoaderCircle,
    Paperclip,
    RotateCcw,
    Send,
    Square,
    X
  } from '@lucide/svelte';
  import type { ChatController, ChatControllerState } from './controller.svelte';
  import { mergeDiscussionDraft, type ChatDraftSeed } from './discussionContext';
  import type {
    ChatCitation,
    ChatActiveNoteSnapshot,
    ChatAttachmentInput,
    ChatContextNote,
    ChatExcerpt,
    ChatSelection,
    ChatSelectionActions,
    VaultAccess,
    ChatAgentProposal,
    ChatProvider
  } from './types';
  import ProposedChangesCard from '$lib/features/proposals/ProposedChangesCard.svelte';
  import AttachmentPreview from './AttachmentPreview.svelte';
  import type {
    PendingProposalChange,
    ProposalReviewSessionSnapshot
  } from '$lib/features/proposals/types';
  import { reviewBelongsToConversation } from './proposalVisibility';
  import {
    attachmentAccept,
    attachmentDataUrl,
    filesToAttachments,
    validateAttachmentBatch
  } from './attachments';

  interface Props {
    controller: ChatController;
    conversationId?: string | null;
    autoInitialize?: boolean;
    variant?: 'pane' | 'focused' | 'inline';
    showConversationPicker?: boolean;
    selectionActions?: ChatSelectionActions;
    onConversationChange?: (conversationId: string | null) => void;
    onOpenCitation?: (citation: Extract<ChatCitation, { kind: 'note' }>) => void | Promise<void>;
    placeholder?: string;
    draftSeed?: ChatDraftSeed | null;
    contextNote?: ChatContextNote | null;
    getActiveNoteSnapshot?: () => Promise<ChatActiveNoteSnapshot | null>;
    targetAnchor?: string | null;
    proposalSnapshot?: ProposalReviewSessionSnapshot | null;
    proposalPendingCount?: number;
    onProposalOpenChange?: (change: PendingProposalChange) => void | Promise<void>;
    onProposalKeep?: (changeId: string) => void | Promise<void>;
    onProposalUndo?: (changeId: string) => void | Promise<void>;
    onProposalKeepAll?: () => void | Promise<void>;
    onProposalUndoAll?: () => void | Promise<void>;
    onProposalReview?: () => void | Promise<void>;
    onProposalRetry?: () => void | Promise<void>;
    onProposalCopyCurrent?: () => void | Promise<void>;
    onProposalReloadDisk?: () => void | Promise<void>;
    onReviewAgentProposal?: (proposal: ChatAgentProposal) => void | Promise<void>;
  }

  let {
    controller,
    conversationId = null,
    autoInitialize = true,
    variant = 'pane',
    showConversationPicker = true,
    selectionActions = {},
    onConversationChange,
    onOpenCitation,
    placeholder = 'What are you thinking about?',
    draftSeed = null,
    contextNote = null,
    getActiveNoteSnapshot,
    targetAnchor = null,
    proposalSnapshot = null,
    proposalPendingCount = 0,
    onProposalOpenChange,
    onProposalKeep,
    onProposalUndo,
    onProposalKeepAll,
    onProposalUndoAll,
    onProposalReview,
    onProposalRetry,
    onProposalCopyCurrent,
    onProposalReloadDisk,
    onReviewAgentProposal
  }: Props = $props();

  const ACCESS_OPTIONS: { value: VaultAccess; label: string; hint: string }[] = [
    { value: 'none', label: 'No vault', hint: 'Chat only' },
    { value: 'approved', label: 'Approved only', hint: 'Approved notes only' },
    { value: 'full', label: 'Full vault', hint: 'All notes available' }
  ];
  const PROVIDERS: ChatProvider[] = ['openai', 'local'];

  const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
  let snapshot = $state<ChatControllerState>({
    settings: null,
    conversations: [],
    conversationDraft: {
      revision: 0,
      title: ''
    },
    grants: [],
    policies: [],
    conversation: null,
    isInitializing: false,
    isLoadingConversation: false,
    isSending: false,
    error: null,
    activity: null,
    proposals: [],
    modelCapabilities: null
  });
  let draft = $state('');
  let titleDraft = $state('');
  let titleInput = $state<HTMLInputElement | null>(null);
  let titleFocused = $state(false);
  let titleCommitPending = false;
  let creatingConversationFromDraft = false;
  let titleContextKey: string | null = null;
  let attachments = $state<ChatAttachmentInput[]>([]);
  let forceWebSearch = $state(false);
  let selected = $state<ChatSelection | null>(null);
  let selectedExcerpt = $state<ChatExcerpt | null>(null);
  let actionError = $state<string | null>(null);
  let messagesElement = $state<HTMLElement | null>(null);
  let composerElement = $state<HTMLTextAreaElement | null>(null);
  let attachmentInput = $state<HTMLInputElement | null>(null);
  let previewAttachment = $state<ChatAttachmentInput | null>(null);
  let previousLastMessageId = $state<string | null>(null);
  // One-shot apply guards — not UI state; plain lets avoid effect↔state loops.
  let appliedDraftSeedId: string | null = null;
  let contextAccessBusy = $state(false);
  let appliedTargetAnchor: string | null = null;
  let reportedConversationId: string | null | undefined;
  let openMenu = $state<'history' | 'vault' | 'provider' | null>(null);
  let proposalDrafts = $state<Record<string, string>>({});

  const conversation = $derived(snapshot.conversation);
  const visibleProposalSnapshot = $derived(
    reviewBelongsToConversation(
      proposalSnapshot,
      snapshot.proposals,
      conversation?.id
    )
      ? proposalSnapshot
      : null
  );
  const canSend = $derived(
    Boolean(draft.trim() || attachments.length > 0) &&
      !snapshot.isSending &&
      !snapshot.isInitializing &&
      !snapshot.isLoadingConversation &&
      (!conversation || conversation.status === 'active')
  );
  const canAttach = $derived(
    Boolean(snapshot.modelCapabilities?.images || snapshot.modelCapabilities?.files)
  );
  const acceptedAttachmentTypes = $derived(attachmentAccept(snapshot.modelCapabilities));
  const isEmpty = $derived(!conversation || conversation.messages.length === 0);
  const proposalsAwaitingReview = $derived.by(() =>
    snapshot.proposals.filter((proposal) => !proposalIsOpenInEditor(proposal))
  );
  const contextGrant = $derived(
    contextNote?.noteId
      ? snapshot.grants.find((grant) => grant.noteId === contextNote.noteId) ?? null
      : null
  );
  const contextExcluded = $derived(
    Boolean(
      contextNote?.noteId &&
        snapshot.policies.some(
          (policy) =>
            policy.noteId === contextNote?.noteId &&
            policy.disposition === 'excluded'
        )
    )
  );
  const vaultLabel = $derived.by(() => {
    if (!conversation) return 'No vault';
    if (contextExcluded) return 'Note excluded';
    if (conversation.vaultAccess === 'full') return 'Full vault';
    if (conversation.vaultAccess === 'none') return 'No vault';
    if (contextNote && contextGrant) return contextNote.noteTitle;
    return 'Approved only';
  });

  function proposalMarkdown(proposal: ChatAgentProposal) {
    const preview = proposal.preview as { proposedEditorMarkdown?: unknown };
    const initial = typeof preview.proposedEditorMarkdown === 'string' ? preview.proposedEditorMarkdown : '';
    return proposalDrafts[proposal.id] ?? initial;
  }

  function proposalIsOpenInEditor(proposal: ChatAgentProposal) {
    if (proposal.kind !== 'update') return false;
    const notePath = (proposal.preview as { notePath?: unknown }).notePath;
    return (
      typeof notePath === 'string' &&
      visibleProposalSnapshot?.source === `chat:${proposal.id}` &&
      Boolean(
        visibleProposalSnapshot?.changes.some(
          (change) => change.path === notePath && change.status === 'pending'
        )
      )
    );
  }

  async function keepAgentProposal(proposal: ChatAgentProposal) {
    await controller.keepProposal(proposal.id, proposalMarkdown(proposal));
  }

  async function dismissAgentProposal(proposal: ChatAgentProposal) {
    await controller.dismissProposal(proposal.id);
  }

  function providerModel(provider: ChatProvider) {
    if (provider === 'local') return snapshot.settings?.localModel ?? '';
    return snapshot.settings?.openaiModel ?? snapshot.settings?.model ?? 'gpt-5.6-terra';
  }

  function syncConversationTitle(next: ChatControllerState) {
    const nextContextKey = next.conversation
      ? `conversation:${next.conversation.id}`
      : `draft:${next.conversationDraft.revision}`;
    if (nextContextKey !== titleContextKey) {
      titleContextKey = nextContextKey;
      titleDraft = next.conversation?.title ?? next.conversationDraft.title;
      if (!creatingConversationFromDraft) {
        draft = '';
        attachments = [];
        forceWebSearch = false;
      }
      return;
    }
    if (!titleFocused && !titleCommitPending && next.conversation) {
      titleDraft = next.conversation.title;
    }
  }

  async function commitConversationTitle() {
    titleFocused = false;
    const current = controller.getSnapshot().conversation;
    const nextTitle = titleDraft.trim();

    if (!current) {
      titleDraft = nextTitle;
      controller.setConversationDraftTitle(nextTitle);
      return;
    }
    if (!nextTitle) {
      titleDraft = current.title;
      return;
    }
    if (nextTitle === current.title) {
      titleDraft = nextTitle;
      return;
    }

    titleCommitPending = true;
    const renamed = await controller.renameConversation(nextTitle);
    titleCommitPending = false;
    titleDraft = renamed
      ? controller.getSnapshot().conversation?.title ?? nextTitle
      : controller.getSnapshot().conversation?.title ?? current.title;
  }

  function onTitleKeydown(event: KeyboardEvent) {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    titleInput?.blur();
    composerElement?.focus();
  }

  async function updateProvider(provider: ChatProvider) {
    openMenu = null;
    const model = providerModel(provider);
    if (!model) {
      actionError = 'Choose a tool-capable local model in Settings first.';
      return;
    }
    await controller.setProvider(provider, model);
    if (provider === 'local') forceWebSearch = false;
  }

  $effect(() => {
    const anchor = targetAnchor?.replace(/^\^/, '') ?? null;
    const current = conversation;
    const root = messagesElement;
    if (!anchor || !current || !root || anchor === appliedTargetAnchor) return;
    const messageId = anchor.startsWith('msg_')
      ? anchor.slice(4)
      : current.excerptMessageIds[anchor];
    if (!messageId) return;
    appliedTargetAnchor = anchor;
    requestAnimationFrame(() => {
      root.querySelector<HTMLElement>(`[data-chat-message-id="${CSS.escape(messageId)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  $effect(() => {
    const seed = draftSeed;
    if (!seed || seed.id === appliedDraftSeedId) return;
    appliedDraftSeedId = seed.id;
    const merged = mergeDiscussionDraft(untrack(() => draft), seed.text);
    draft = merged;
    requestAnimationFrame(() => {
      composerElement?.focus();
      composerElement?.setSelectionRange(merged.length, merged.length);
    });
  });

  onMount(() => {
    snapshot = controller.getSnapshot();
    syncConversationTitle(snapshot);
    const unsubscribe = controller.subscribe((next) => {
      snapshot = next;
      syncConversationTitle(next);
      const nextConversationId = next.conversation?.id ?? null;
      if (nextConversationId !== reportedConversationId) {
        reportedConversationId = nextConversationId;
        onConversationChange?.(nextConversationId);
      }
      const lastMessageId = next.conversation?.messages.at(-1)?.id ?? null;
      if (lastMessageId !== previousLastMessageId || next.isSending) {
        previousLastMessageId = lastMessageId;
        requestAnimationFrame(() => messagesElement?.scrollTo({ top: messagesElement.scrollHeight, behavior: 'smooth' }));
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

  function rendered(content: string) {
    return markdown.render(content);
  }

  /** Absolute http(s) href for web citations — not an app route, so no resolve(). */
  function webCitationHref(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '#';
      return parsed.href;
    } catch {
      return '#';
    }
  }

  function toggleMenu(menu: 'history' | 'vault' | 'provider') {
    openMenu = openMenu === menu ? null : menu;
  }

  async function submit() {
    const content = draft.trim();
    if ((!content && attachments.length === 0) || snapshot.isSending) return;
    let activeNote: ChatActiveNoteSnapshot | null = null;
    try {
      activeNote = await getActiveNoteSnapshot?.() ?? null;
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Save the active note before sending.';
      return;
    }
    if (!controller.getSnapshot().conversation) {
      creatingConversationFromDraft = true;
      const created = await controller.createConversation({
        title: titleDraft.trim() || undefined
      });
      creatingConversationFromDraft = false;
      if (!created) return;
    }
    const sent = await controller.send(content, attachments, forceWebSearch, activeNote);
    if (sent) {
      draft = '';
      attachments = [];
      forceWebSearch = false;
    }
  }

  async function addAttachments(files: File[]) {
    const capabilities = snapshot.modelCapabilities;
    if (!capabilities || files.length === 0) return;
    const validationError = validateAttachmentBatch(files, attachments, capabilities);
    if (validationError) {
      actionError = validationError;
      return;
    }
    try {
      attachments = [...attachments, ...await filesToAttachments(files)];
      actionError = null;
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Unable to read the attachment.';
    }
  }

  function onAttachmentChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    void addAttachments(Array.from(input.files ?? []));
    input.value = '';
  }

  function onComposerPaste(event: ClipboardEvent) {
    const images = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (images.length === 0) return;
    if (!snapshot.modelCapabilities?.images) {
      actionError = 'The selected model does not accept image input.';
      return;
    }
    if (!event.clipboardData?.getData('text/plain')) event.preventDefault();
    void addAttachments(images);
  }

  function onComposerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void submit();
  }

  function openAttachmentPreview(attachment: ChatAttachmentInput) {
    previewAttachment = attachment;
  }

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
      const messageElement = element?.closest<HTMLElement>('[data-chat-message-id]');
      const messageId = messageElement?.dataset.chatMessageId;
      const current = controller.getSnapshot().conversation;
      const message = current?.messages.find((item) => item.id === messageId);
      if (!current || !message) return;
      selected = { conversationId: current.id, messageId: message.id, text, linkTarget: message.linkTarget };
      selectedExcerpt = null;
      actionError = null;
    });
  }

  async function copySelection() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.text);
      await selectionActions.onCopy?.(selected);
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Unable to copy selection.';
    }
  }

  async function ensureExcerpt() {
    if (!selected) return null;
    if (selectedExcerpt) return selectedExcerpt;
    selectedExcerpt = await controller.createExcerpt(selected.messageId, selected.text);
    selected = { ...selected, linkTarget: selectedExcerpt.linkTarget };
    return selectedExcerpt;
  }

  async function copyLink() {
    if (!selected) return;
    try {
      const excerpt = await ensureExcerpt();
      if (!excerpt) return;
      await navigator.clipboard.writeText(`[[${excerpt.linkTarget}]]`);
      await selectionActions.onCopyLink?.({ ...selected, linkTarget: excerpt.linkTarget });
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Unable to create a link.';
    }
  }

  async function insertSelection() {
    if (!selected) return;
    try {
      const excerpt = await ensureExcerpt();
      await selectionActions.onInsertIntoNote?.({ ...selected, linkTarget: excerpt?.linkTarget ?? selected.linkTarget });
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Unable to insert this passage.';
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
      actionError = error instanceof Error ? error.message : 'Unable to update memory.';
    }
  }

  async function updateAccess(vaultAccess: VaultAccess) {
    openMenu = null;
    if (conversation) await controller.setVaultAccess(vaultAccess);
  }

  async function openConversation(id: string) {
    openMenu = null;
    await controller.openConversation(id);
  }

  async function toggleContextAccess() {
    const noteId = contextNote?.noteId;
    if (!noteId || contextAccessBusy) return;
    contextAccessBusy = true;
    actionError = null;
    try {
      if (contextGrant) await controller.revokeNote(noteId);
      else await controller.grantNote(noteId);
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Unable to change note access.';
    } finally {
      contextAccessBusy = false;
    }
  }

  async function toggleContextExclusion() {
    const noteId = contextNote?.noteId;
    if (!noteId || !contextNote || contextAccessBusy) return;
    openMenu = null;
    contextAccessBusy = true;
    actionError = null;
    try {
      await controller.setNoteExcluded(
        noteId,
        contextNote.noteTitle,
        !contextExcluded
      );
    } catch (error) {
      actionError =
        error instanceof Error ? error.message : 'Unable to change note exclusion.';
    } finally {
      contextAccessBusy = false;
    }
  }
</script>

<section class={`chat-panel chat-panel--${variant} flex h-full min-h-0 w-full flex-col overflow-hidden`} aria-label="Thought partner chat">
  <header class="chat-panel-header relative flex min-h-[3.25rem] shrink-0 items-center gap-1 px-4 pt-4 pb-1 sm:px-5">
    <div class="flex min-w-0 items-center gap-0.5">
      {#if showConversationPicker}
        <div class="relative" data-chat-menu>
          <button
            type="button"
            class="chat-icon-button"
            class:chat-icon-button--active={openMenu === 'history'}
            aria-label="Conversations"
            aria-expanded={openMenu === 'history'}
            aria-haspopup="menu"
            title={conversation?.title ?? 'Conversations'}
            disabled={snapshot.conversations.length === 0}
            onclick={() => toggleMenu('history')}
          >
            <History class="h-4 w-4" />
          </button>
          {#if openMenu === 'history' && snapshot.conversations.length > 0}
            <div class="chat-menu chat-menu--down" role="menu" aria-label="Conversations">
              {#each snapshot.conversations as item (item.id)}
                <button
                  type="button"
                  class="chat-menu-item"
                  class:chat-menu-item--active={item.id === conversation?.id}
                  role="menuitem"
                  onclick={() => void openConversation(item.id)}
                >
                  <span class="min-w-0 flex-1 truncate">{item.title}</span>
                  {#if item.id === conversation?.id}
                    <Check class="h-3.5 w-3.5 shrink-0" />
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
    <div class="pointer-events-none absolute inset-x-14 top-3 flex justify-center sm:inset-x-16 sm:top-4">
      <div class="pointer-events-auto w-full max-w-[24rem] min-w-0">
        <input
          bind:this={titleInput}
          bind:value={titleDraft}
          type="text"
          class="w-full bg-transparent text-center text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/55 sm:text-2xl"
          placeholder="New chat"
          aria-label="Chat title"
          onfocus={() => (titleFocused = true)}
          onblur={() => void commitConversationTitle()}
          onkeydown={onTitleKeydown}
        />
      </div>
    </div>
  </header>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={messagesElement}
    class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5"
    role="log"
    aria-live="polite"
    onpointerup={captureSelection}
    onkeyup={captureSelection}
  >
    {#if snapshot.isInitializing || snapshot.isLoadingConversation}
      <div class="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle class="h-4 w-4 animate-spin" /> Loading conversation…
      </div>
    {:else if isEmpty}
      <div class="mx-auto flex h-full max-w-sm flex-col items-center justify-center px-5 text-center">
        <p class="text-sm font-medium text-foreground">Start with what you’re working through</p>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">
          Discuss the note beside this, ask a direct question, or work an unfinished thought into shape.
        </p>
      </div>
    {:else if conversation}
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
        {#each conversation.messages as message (message.id)}
          <article
            class:chat-message--user={message.role === 'user'}
            class="chat-message group"
            data-chat-message-id={message.id}
          >
            <div class="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <span>{message.role === 'assistant' ? 'Thought partner' : 'You'}</span>
              {#if message.status === 'streaming'}<span class="opacity-70">{snapshot.activity ?? 'Working…'}</span>{/if}
              {#if message.status === 'cancelled'}<span class="opacity-70">stopped</span>{/if}
            </div>
            <div class="chat-message-content text-[0.94rem] leading-7 text-foreground" class:opacity-70={message.status === 'cancelled'}>
              <!-- markdown-it is configured with html:false, which escapes raw HTML -->
              {@html rendered(message.content)}
            </div>
            {#if message.attachments.length > 0}
              <div class="mt-2 flex flex-wrap gap-2" aria-label="Attachments">
                {#each message.attachments as attachment (attachment.id)}
                  {#if attachment.kind === 'image'}
                    <button
                      type="button"
                      class="chat-attachment-image"
                      aria-label={`Preview ${attachment.name}`}
                      title={`Preview ${attachment.name}`}
                      onclick={() => openAttachmentPreview(attachment)}
                    >
                      <img
                        src={attachmentDataUrl(attachment)}
                        alt={attachment.name}
                      />
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="chat-attachment-file"
                      aria-label={`Preview ${attachment.name}`}
                      title={`Preview ${attachment.name}`}
                      onclick={() => openAttachmentPreview(attachment)}
                    >
                      <FileInput class="h-3.5 w-3.5" />
                      <span class="max-w-52 truncate">{attachment.name}</span>
                    </button>
                  {/if}
                {/each}
              </div>
            {/if}

            {#if message.citations.length > 0}
              <div class="mt-3 flex flex-wrap gap-1.5" aria-label="Sources">
                {#each message.citations as citation (citation.id)}
                  {#if citation.kind === 'web'}
                    <a
                      class="chat-citation"
                      href={webCitationHref(citation.url)}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={citation.excerpt ?? citation.url}
                    >
                      {citation.label}<ExternalLink class="h-3 w-3" />
                    </a>
                  {:else}
                    <button type="button" class="chat-citation" title={citation.excerpt ?? citation.notePath} onclick={() => void onOpenCitation?.(citation)}>
                      [[{citation.label}]]
                    </button>
                  {/if}
                {/each}
              </div>
            {/if}

            {#if (message.status === 'error' || message.status === 'cancelled') && message.role === 'assistant'}
              <div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                {#if message.errorMessage}<span>{message.errorMessage}</span>{/if}
                <button type="button" class="inline-flex items-center gap-1 font-medium text-foreground hover:underline" onclick={() => void controller.retry(message.id)}>
                  <RotateCcw class="h-3 w-3" /> Retry
                </button>
              </div>
            {/if}

            {#if selected?.messageId === message.id}
              <div class="mt-3 flex flex-wrap items-center gap-0.5 rounded-full border border-border/70 bg-background/90 p-1 shadow-sm">
                <button type="button" class="chat-selection-action" onclick={() => void copySelection()}><Copy class="h-3.5 w-3.5" /> Copy</button>
                <button type="button" class="chat-selection-action" onclick={() => void copyLink()}><Link class="h-3.5 w-3.5" /> Copy link</button>
                {#if selectionActions.onInsertIntoNote}
                  <button type="button" class="chat-selection-action" onclick={() => void insertSelection()}><FileInput class="h-3.5 w-3.5" /> Insert</button>
                {/if}
                <button type="button" class="chat-selection-action" onclick={() => void toggleRemember()}><Brain class="h-3.5 w-3.5" /> {selectedExcerpt?.remembered ? 'Unremember' : 'Remember'}</button>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </div>

  <div class="chat-panel-bottom shrink-0">
    {#if proposalsAwaitingReview.length > 0}
      <div class="mx-auto max-h-[45vh] max-w-3xl space-y-2 overflow-y-auto px-4 pt-2 sm:px-6" aria-label="Pending note proposals">
        {#each proposalsAwaitingReview as proposal (proposal.id)}
          <section class="rounded-2xl border border-border bg-background/95 p-3 shadow-sm">
            <div class="mb-2 flex items-center gap-2">
              <FileInput class="h-4 w-4 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{proposal.kind === 'create' ? 'Create' : 'Update'} “{proposal.title}”</p>
                <p class="text-[11px] text-muted-foreground">Review required before writing</p>
              </div>
            </div>
            {#if proposal.kind === 'create'}
              <textarea
                class="block max-h-52 min-h-28 w-full resize-y rounded-xl border border-border bg-muted/20 p-2 font-mono text-xs leading-5 outline-none focus:border-foreground/25"
                value={proposalMarkdown(proposal)}
                oninput={(event) => {
                  proposalDrafts = {
                    ...proposalDrafts,
                    [proposal.id]: (event.currentTarget as HTMLTextAreaElement).value
                  };
                }}
                aria-label={`Proposed Markdown for ${proposal.title}`}
              ></textarea>
              <div class="mt-2 flex justify-end gap-2">
                <button type="button" class="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent" onclick={() => void dismissAgentProposal(proposal)}>Undo</button>
                <button type="button" class="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background" onclick={() => void keepAgentProposal(proposal)}>Keep</button>
              </div>
            {:else}
              <p class="rounded-xl bg-muted/35 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                Open this update in the note editor to review its highlighted changes before applying it.
              </p>
              <div class="mt-2 flex justify-end gap-2">
                <button type="button" class="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent" onclick={() => void dismissAgentProposal(proposal)}>Undo</button>
                <button type="button" class="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50" disabled={!onReviewAgentProposal} onclick={() => void onReviewAgentProposal?.(proposal)}>Review in editor</button>
              </div>
            {/if}
          </section>
        {/each}
      </div>
    {/if}

    {#if visibleProposalSnapshot != null}
      <ProposedChangesCard
        snapshot={visibleProposalSnapshot}
        pendingCount={proposalPendingCount}
        onOpenChange={onProposalOpenChange ?? (() => {})}
        onKeep={onProposalKeep ?? (() => {})}
        onUndo={onProposalUndo ?? (() => {})}
        onKeepAll={onProposalKeepAll ?? (() => {})}
        onUndoAll={onProposalUndoAll ?? (() => {})}
        onReview={onProposalReview ?? (() => {})}
        onRetry={onProposalRetry}
        onCopyCurrent={onProposalCopyCurrent}
        onReloadDisk={onProposalReloadDisk}
      />
    {/if}

    <footer class="px-4 pb-3 pt-2 sm:px-6 sm:pb-4">
      {#if snapshot.error || actionError}
        <div class="mb-2 flex items-start gap-2 rounded-[1.1rem] bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
          <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span class="min-w-0 flex-1">{actionError ?? snapshot.error}</span>
          <button type="button" class="font-semibold" onclick={() => { actionError = null; controller.clearError(); }}>Dismiss</button>
        </div>
      {/if}

      <div class="mx-auto max-w-3xl rounded-[1.1rem] border border-border/80 bg-background/80 p-2 shadow-sm focus-within:border-foreground/25 focus-within:ring-2 focus-within:ring-ring/10">
        {#if attachments.length > 0}
          <div class="flex flex-wrap gap-2 px-2 pb-2" aria-label="Pending attachments">
            {#each attachments as attachment, index (`${attachment.name}-${index}`)}
              <div class="chat-pending-attachment">
                <button
                  type="button"
                  class="chat-pending-attachment-preview"
                  aria-label={`Preview ${attachment.name}`}
                  title={`Preview ${attachment.name}`}
                  onclick={() => openAttachmentPreview(attachment)}
                >
                  {#if attachment.kind === 'image'}
                    <img src={attachmentDataUrl(attachment)} alt="" />
                  {:else}
                    <FileInput class="h-4 w-4 shrink-0 text-muted-foreground" />
                  {/if}
                  <span class="max-w-36 truncate">{attachment.name}</span>
                </button>
                <button
                  type="button"
                  class="chat-pending-attachment-remove"
                  aria-label={`Remove ${attachment.name}`}
                  title="Remove attachment"
                  onclick={() => attachments = attachments.filter((_, itemIndex) => itemIndex !== index)}
                >
                  <X class="h-3 w-3" />
                </button>
              </div>
            {/each}
          </div>
        {/if}
        <textarea
          bind:this={composerElement}
          bind:value={draft}
          rows={variant === 'inline' ? 2 : 3}
          class="block max-h-40 min-h-12 w-full resize-none bg-transparent px-2.5 py-1.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
          {placeholder}
          disabled={snapshot.isInitializing || conversation?.status === 'projectionConflict'}
          onkeydown={onComposerKeydown}
          onpaste={onComposerPaste}
        ></textarea>

        <div class="flex flex-wrap items-center gap-1.5 px-1 pt-1">
          {#if conversation}
            {#if canAttach}
              <input
                bind:this={attachmentInput}
                class="sr-only"
                type="file"
                multiple
                accept={acceptedAttachmentTypes}
                onchange={onAttachmentChange}
                aria-label="Choose attachments"
              />
              <button
                type="button"
                class="chat-composer-chip"
                onclick={() => attachmentInput?.click()}
                aria-label="Add files or images"
                title={snapshot.modelCapabilities?.images
                  ? 'Add files or images; you can also paste images'
                  : 'Add files'}
              >
                <Paperclip class="h-3.5 w-3.5" />
              </button>
            {/if}
            <div class="relative" data-chat-menu>
              <button
                type="button"
                class="chat-composer-chip"
                aria-label="AI provider"
                aria-expanded={openMenu === 'provider'}
                aria-haspopup="menu"
                onclick={() => toggleMenu('provider')}
              >
                <span>{conversation.provider === 'local' ? 'Local' : 'OpenAI'}</span>
                <ChevronDown class="h-3 w-3 opacity-60" />
              </button>
              {#if openMenu === 'provider'}
                <div class="chat-menu chat-menu--up" role="menu" aria-label="AI provider">
                  {#each PROVIDERS as provider}
                    <button
                      type="button"
                      class="chat-menu-item"
                      class:chat-menu-item--active={provider === conversation.provider}
                      role="menuitem"
                      onclick={() => void updateProvider(provider)}
                    >
                      <span class="min-w-0 flex-1">
                        <span class="block font-medium">{provider === 'local' ? 'Local' : 'OpenAI'}</span>
                        <span class="block max-w-48 truncate text-[11px] font-normal text-muted-foreground">{providerModel(provider) || 'Configure in Settings'}</span>
                      </span>
                      {#if provider === conversation.provider}<Check class="h-3.5 w-3.5 shrink-0" />{/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>

            <div class="relative" data-chat-menu>
              <button
                type="button"
                class="chat-composer-chip"
                class:chat-composer-chip--emphasis={conversation.vaultAccess === 'approved' && contextNote && !contextGrant}
                aria-label="Vault access"
                aria-expanded={openMenu === 'vault'}
                aria-haspopup="menu"
                onclick={() => toggleMenu('vault')}
              >
                <span class="max-w-[7.5rem] truncate">{vaultLabel}</span>
                <ChevronDown class="h-3 w-3 opacity-60" />
              </button>
              {#if openMenu === 'vault'}
                <div class="chat-menu chat-menu--up" role="menu" aria-label="Vault access">
                  {#each ACCESS_OPTIONS as option (option.value)}
                    <button
                      type="button"
                      class="chat-menu-item"
                      class:chat-menu-item--active={option.value === conversation.vaultAccess}
                      role="menuitem"
                      onclick={() => void updateAccess(option.value)}
                    >
                      <span class="min-w-0 flex-1">
                        <span class="block font-medium">{option.label}</span>
                        <span class="block text-[11px] font-normal text-muted-foreground">{option.hint}</span>
                      </span>
                      {#if option.value === conversation.vaultAccess}
                        <Check class="h-3.5 w-3.5 shrink-0" />
                      {/if}
                    </button>
                  {/each}
                  {#if contextNote?.noteId}
                    <div class="my-1 border-t border-border/70"></div>
                    <button
                      type="button"
                      class="chat-menu-item"
                      class:chat-menu-item--active={contextExcluded}
                      role="menuitem"
                      onclick={() => void toggleContextExclusion()}
                    >
                      <span class="min-w-0 flex-1">
                        <span class="block font-medium">
                          {contextExcluded ? 'Allow this note' : 'Exclude this note'}
                        </span>
                        <span class="block max-w-52 truncate text-[11px] font-normal text-muted-foreground">
                          {contextExcluded
                            ? 'Restore eligibility under the selected scope'
                            : `Never send “${contextNote.noteTitle}” to AI`}
                        </span>
                      </span>
                      {#if contextExcluded}
                        <Check class="h-3.5 w-3.5 shrink-0" />
                      {/if}
                    </button>
                  {/if}
                </div>
              {/if}
            </div>

            {#if contextExcluded && contextNote?.noteId}
              <div
                class="chat-composer-chip"
                title="This note is excluded from every AI vault scope"
              >
                <span>{contextAccessBusy ? '…' : 'Note excluded'}</span>
                <button
                  type="button"
                  class="chat-grant-dismiss"
                  disabled={contextAccessBusy}
                  aria-label="Allow note for AI"
                  title="Remove note exclusion"
                  onclick={() => void toggleContextExclusion()}
                >
                  <X class="h-3 w-3" />
                </button>
              </div>
            {:else if conversation.vaultAccess === 'approved' && contextNote?.noteId}
              {#if contextGrant}
                <div
                  class="chat-composer-chip chat-composer-chip--granted group"
                  title="This note is available to approved-only chats"
                >
                  <span>{contextAccessBusy ? '…' : 'Note allowed'}</span>
                  <button
                    type="button"
                    class="chat-grant-dismiss"
                    disabled={contextAccessBusy}
                    aria-label="Disallow note"
                    title="Disallow note"
                    onclick={() => void toggleContextAccess()}
                  >
                    <X class="h-3 w-3" />
                  </button>
                </div>
              {:else}
                <button
                  type="button"
                  class="chat-composer-chip chat-composer-chip--action"
                  disabled={contextAccessBusy}
                  title="Allow approved-only chats to use this note"
                  onclick={() => void toggleContextAccess()}
                >
                  {contextAccessBusy ? '…' : 'Allow note'}
                </button>
              {/if}
            {:else if conversation.vaultAccess === 'approved' && contextNote && !contextNote.noteId}
              <span class="px-1 text-[11px] text-muted-foreground">Save the note to grant access</span>
            {/if}

            {#if conversation.provider === 'openai'}
              <button
                type="button"
                class="chat-composer-chip"
                class:chat-composer-chip--on={forceWebSearch}
                aria-pressed={forceWebSearch}
                title={forceWebSearch
                  ? 'Web search required for this message'
                  : 'Require web search for this message; otherwise it is used automatically when allowed'}
                onclick={() => (forceWebSearch = !forceWebSearch)}
              >
                <Globe class="h-3.5 w-3.5" />
                <span class="hidden sm:inline">Web</span>
              </button>
            {/if}
          {/if}

          <div class="ml-auto flex items-center">
            {#if snapshot.isSending}
              <button type="button" class="chat-send-button" onclick={() => void controller.cancel()} aria-label="Stop response" title="Stop response">
                <Square class="h-3.5 w-3.5 fill-current" />
              </button>
            {:else}
              <button
                type="button"
                class="chat-send-button"
                class:opacity-40={!canSend && Boolean(conversation)}
                disabled={!canSend}
                onclick={() => void submit()}
                aria-label="Send message"
                title="Send message"
              >
                <Send class="h-4 w-4" />
              </button>
            {/if}
          </div>
        </div>
      </div>
    </footer>
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

<style>
  .chat-panel-header {
    /* History on the left + reserved split fan and close/split chrome on the right. */
    padding-right: 15.5rem;
  }

  .chat-panel-bottom {
    background: linear-gradient(
      to top,
      color-mix(in oklab, var(--card) 72%, transparent) 55%,
      transparent
    );
  }

  .chat-icon-button {
    display: inline-flex;
    height: 2rem;
    width: 2rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    color: var(--muted-foreground);
    transition: background-color 160ms ease, color 160ms ease;
  }
  .chat-icon-button:hover:not(:disabled),
  .chat-icon-button--active {
    background: var(--accent);
    color: var(--accent-foreground);
  }
  .chat-icon-button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .chat-composer-chip {
    display: inline-flex;
    max-width: 100%;
    align-items: center;
    gap: 0.25rem;
    border-radius: 9999px;
    background: color-mix(in oklab, var(--muted) 72%, transparent);
    padding: 0.3rem 0.55rem;
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--muted-foreground);
    transition: background-color 160ms ease, color 160ms ease;
  }
  .chat-attachment-file {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: color-mix(in oklab, var(--muted) 65%, transparent);
    padding: 0.4rem 0.55rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
    transition: background-color 160ms ease, color 160ms ease;
  }
  .chat-attachment-file:hover,
  .chat-attachment-file:focus-visible {
    background: var(--accent);
    color: var(--accent-foreground);
    outline: none;
  }
  .chat-attachment-image {
    display: block;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
    border-radius: 0.75rem;
    transition: border-color 160ms ease, box-shadow 160ms ease;
  }
  .chat-attachment-image:hover,
  .chat-attachment-image:focus-visible {
    border-color: color-mix(in oklab, var(--foreground) 35%, var(--border));
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--ring) 20%, transparent);
    outline: none;
  }
  .chat-attachment-image img {
    display: block;
    max-height: 13rem;
    max-width: 100%;
    object-fit: contain;
  }
  .chat-pending-attachment {
    display: inline-flex;
    max-width: 14rem;
    align-items: center;
    gap: 0.4rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: color-mix(in oklab, var(--muted) 65%, transparent);
    padding: 0.3rem 0.4rem;
    font-size: 0.72rem;
  }
  .chat-pending-attachment img {
    height: 2rem;
    width: 2rem;
    border-radius: 0.4rem;
    object-fit: cover;
  }
  .chat-pending-attachment-preview {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 0.4rem;
    border-radius: 0.5rem;
  }
  .chat-pending-attachment-preview:focus-visible {
    outline: 2px solid color-mix(in oklab, var(--ring) 45%, transparent);
    outline-offset: 2px;
  }
  .chat-pending-attachment .chat-pending-attachment-remove {
    display: inline-flex;
    height: 1.25rem;
    width: 1.25rem;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    color: var(--muted-foreground);
  }
  .chat-pending-attachment .chat-pending-attachment-remove:hover {
    background: var(--accent);
    color: var(--accent-foreground);
  }
  .chat-composer-chip:hover:not(:disabled) {
    background: var(--accent);
    color: var(--accent-foreground);
  }
  .chat-composer-chip--on,
  .chat-composer-chip--emphasis {
    background: var(--foreground);
    color: var(--background);
  }
  .chat-composer-chip--emphasis:hover:not(:disabled) {
    background: var(--foreground);
    color: var(--background);
    opacity: 0.9;
  }
  .chat-composer-chip--action {
    background: transparent;
    color: var(--foreground);
  }
  .chat-composer-chip--action:hover:not(:disabled) {
    background: var(--accent);
  }
  .chat-composer-chip--granted {
    gap: 0.15rem;
    padding-right: 0.3rem;
  }
  .chat-grant-dismiss {
    display: inline-flex;
    height: 1.1rem;
    width: 1.1rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    color: var(--muted-foreground);
    opacity: 0;
    transition: opacity 160ms ease, background-color 160ms ease, color 160ms ease;
  }
  .chat-composer-chip--granted:hover .chat-grant-dismiss,
  .chat-composer-chip--granted:focus-within .chat-grant-dismiss,
  .chat-grant-dismiss:focus-visible {
    opacity: 1;
  }
  .chat-grant-dismiss:hover:not(:disabled),
  .chat-grant-dismiss:focus-visible {
    background: color-mix(in oklab, var(--foreground) 12%, transparent);
    color: var(--foreground);
  }
  .chat-grant-dismiss:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .chat-composer-chip:disabled {
    opacity: 0.45;
    cursor: default;
  }
  @media (hover: none) {
    .chat-grant-dismiss {
      opacity: 0.7;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .chat-grant-dismiss {
      transition: none;
    }
  }

  .chat-menu {
    position: absolute;
    z-index: 40;
    display: flex;
    min-width: 11.5rem;
    max-width: min(18rem, 70vw);
    max-height: 16rem;
    flex-direction: column;
    gap: 0.15rem;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 1.1rem;
    background: color-mix(in oklab, var(--popover, var(--card)) 96%, transparent);
    padding: 0.35rem;
    box-shadow:
      0px 1px 2px 0px hsl(0 0% 0% / 0.18),
      0px 8px 10px -1px hsl(0 0% 0% / 0.18);
    backdrop-filter: blur(10px);
  }
  .chat-menu--down {
    top: calc(100% + 0.35rem);
    left: 0;
  }
  .chat-menu--up {
    bottom: calc(100% + 0.35rem);
    left: 0;
  }

  .chat-menu-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-radius: 0.5rem;
    padding: 0.45rem 0.55rem;
    text-align: left;
    font-size: 0.78rem;
    color: var(--foreground);
  }
  .chat-menu-item:hover {
    background: var(--accent);
  }
  .chat-menu-item--active {
    background: color-mix(in oklab, var(--accent) 80%, transparent);
  }

  .chat-message {
    max-width: min(94%, 44rem);
    padding: 0.15rem 0;
  }
  .chat-message--user {
    align-self: flex-end;
    border-radius: 1.1rem;
    background: color-mix(in oklab, var(--muted) 78%, transparent);
    padding: 0.7rem 1rem;
  }
  .chat-message-content :global(p) {
    margin: 0 0 0.65rem;
  }
  .chat-message-content :global(p:last-child) {
    margin-bottom: 0;
  }
  .chat-message-content :global(ul),
  .chat-message-content :global(ol) {
    margin: 0.45rem 0;
    padding-left: 1.35rem;
  }
  .chat-message-content :global(pre) {
    overflow-x: auto;
    border-radius: 0.5rem;
    background: var(--muted);
    padding: 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.5;
  }
  .chat-message-content :global(code:not(pre code)) {
    border-radius: 0.4rem;
    background: var(--muted);
    padding: 0.1rem 0.3rem;
    font-family: var(--font-mono);
    font-size: 0.85em;
  }
  .chat-message-content :global(a) {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .chat-citation {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border-radius: 9999px;
    background: color-mix(in oklab, var(--muted) 70%, transparent);
    padding: 0.2rem 0.55rem;
    font-size: 0.68rem;
    color: var(--muted-foreground);
  }
  .chat-citation:hover {
    background: var(--accent);
    color: var(--accent-foreground);
  }

  .chat-selection-action {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border-radius: 9999px;
    padding: 0.35rem 0.55rem;
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .chat-selection-action:hover {
    background: var(--accent);
    color: var(--accent-foreground);
  }

  .chat-send-button {
    display: inline-flex;
    height: 2rem;
    width: 2rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: var(--foreground);
    color: var(--background);
    transition: opacity 160ms ease;
  }
  .chat-send-button:disabled {
    cursor: default;
    opacity: 0.4;
  }

  .chat-panel--inline {
    border-radius: 1.1rem;
    border: 1px solid var(--border);
    background: var(--card);
  }

  @media (prefers-reduced-motion: reduce) {
    .chat-icon-button,
    .chat-composer-chip,
    .chat-send-button {
      transition: none;
    }
  }
</style>
