<script lang="ts">
  import { onMount } from 'svelte';
  import MarkdownIt from 'markdown-it';
  import {
    AlertCircle,
    Brain,
    Copy,
    ExternalLink,
    FileInput,
    Link,
    LoaderCircle,
    Plus,
    RotateCcw,
    Send,
    Square
  } from '@lucide/svelte';
  import type { ChatController, ChatControllerState } from './controller';
  import { mergeDiscussionDraft, type ChatDraftSeed } from './discussionContext';
  import type { ChatCitation, ChatContextNote, ChatExcerpt, ChatMode, ChatSelection, ChatSelectionActions, VaultAccess } from './types';

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
    contextNote = null
  }: Props = $props();

  const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
  let snapshot = $state<ChatControllerState>({
    settings: null,
    conversations: [],
    grants: [],
    conversation: null,
    isInitializing: false,
    isLoadingConversation: false,
    isSending: false,
    error: null
  });
  let draft = $state('');
  let useWebSearch = $state(false);
  let selected = $state<ChatSelection | null>(null);
  let selectedExcerpt = $state<ChatExcerpt | null>(null);
  let actionError = $state<string | null>(null);
  let messagesElement = $state<HTMLElement | null>(null);
  let composerElement = $state<HTMLTextAreaElement | null>(null);
  let previousLastMessageId = $state<string | null>(null);
  let appliedDraftSeedId = $state<string | null>(null);
  let contextAccessBusy = $state(false);

  const conversation = $derived(snapshot.conversation);
  const canSend = $derived(Boolean(draft.trim()) && !snapshot.isSending && conversation?.status === 'active');
  const isEmpty = $derived(!conversation || conversation.messages.length === 0);
  const contextGrant = $derived(
    contextNote?.noteId
      ? snapshot.grants.find((grant) => grant.noteId === contextNote.noteId) ?? null
      : null
  );

  $effect(() => {
    const seed = draftSeed;
    if (!seed || seed.id === appliedDraftSeedId) return;
    appliedDraftSeedId = seed.id;
    draft = mergeDiscussionDraft(draft, seed.text);
    requestAnimationFrame(() => {
      composerElement?.focus();
      composerElement?.setSelectionRange(draft.length, draft.length);
    });
  });

  onMount(() => {
    snapshot = controller.getSnapshot();
    const unsubscribe = controller.subscribe((next) => {
      snapshot = next;
      onConversationChange?.(next.conversation?.id ?? null);
      const lastMessageId = next.conversation?.messages.at(-1)?.id ?? null;
      if (lastMessageId !== previousLastMessageId || next.isSending) {
        previousLastMessageId = lastMessageId;
        requestAnimationFrame(() => messagesElement?.scrollTo({ top: messagesElement.scrollHeight, behavior: 'smooth' }));
      }
    });
    if (autoInitialize) void controller.initialize(conversationId);
    return unsubscribe;
  });

  function rendered(content: string) {
    return markdown.render(content);
  }

  async function submit() {
    const content = draft.trim();
    if (!content || snapshot.isSending) return;
    if (!controller.getSnapshot().conversation) {
      const created = await controller.createConversation();
      if (!created) return;
    }
    const activeConversation = controller.getSnapshot().conversation;
    const sent = await controller.send(content, activeConversation?.mode === 'research' && useWebSearch);
    if (sent) draft = '';
  }

  function onComposerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void submit();
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

  async function updateMode(mode: ChatMode) {
    if (conversation) await controller.setPreferences(mode, conversation.vaultAccess);
  }

  async function updateAccess(vaultAccess: VaultAccess) {
    if (conversation) await controller.setPreferences(conversation.mode, vaultAccess);
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
</script>

<section class={`chat-panel chat-panel--${variant} flex h-full min-h-0 flex-col overflow-hidden rounded-[1.4rem] border border-border/80 bg-card/65`} aria-label="Thought partner chat">
  <header class="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2.5">
    <div class="mr-auto flex min-w-0 items-center gap-2">
      <Brain class="h-4 w-4 shrink-0 text-foreground/80" />
      {#if showConversationPicker && snapshot.conversations.length > 0}
        <select
          class="max-w-48 truncate rounded-lg border-0 bg-transparent px-1 py-1 text-sm font-semibold text-foreground outline-none"
          value={conversation?.id ?? ''}
          aria-label="Conversation"
          onchange={(event) => void controller.openConversation(event.currentTarget.value)}
        >
          {#each snapshot.conversations as item (item.id)}
            <option value={item.id}>{item.title}</option>
          {/each}
        </select>
      {:else}
        <span class="truncate text-sm font-semibold text-foreground">{conversation?.title ?? 'Thought partner'}</span>
      {/if}
      <button type="button" class="chat-icon-button" onclick={() => void controller.createConversation()} aria-label="New conversation" title="New conversation">
        <Plus class="h-4 w-4" />
      </button>
    </div>

    {#if conversation}
      <select class="chat-control" value={conversation.mode} aria-label="Thinking mode" onchange={(event) => void updateMode(event.currentTarget.value as ChatMode)}>
        <option value="auto">Auto</option>
        <option value="explore">Explore</option>
        <option value="challenge">Challenge</option>
        <option value="research">Research</option>
        <option value="make">Make</option>
      </select>
      <select class="chat-control" value={conversation.vaultAccess} aria-label="Vault access" onchange={(event) => void updateAccess(event.currentTarget.value as VaultAccess)}>
        <option value="none">No vault</option>
        <option value="limited">Limited</option>
        <option value="full">Full vault</option>
      </select>
    {/if}
  </header>

  {#if conversation?.vaultAccess === 'limited' && contextNote}
    <div class="flex items-center gap-2 border-b border-border/60 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
      <span class="min-w-0 flex-1 truncate">
        {#if contextNote.noteId}
          {contextGrant ? 'Limited chats can use' : 'Allow Limited access to'} <span class="font-medium text-foreground">[[{contextNote.noteTitle}]]</span>
        {:else}
          Save <span class="font-medium text-foreground">{contextNote.noteTitle}</span> before granting chat access.
        {/if}
      </span>
      {#if contextNote.noteId}
        <button
          type="button"
          class="shrink-0 rounded-full border border-border px-2.5 py-1 font-medium text-foreground hover:bg-accent disabled:opacity-50"
          disabled={contextAccessBusy}
          title="Limited note access persists for future chats in this vault"
          onclick={() => void toggleContextAccess()}
        >
          {contextAccessBusy ? 'Updating…' : contextGrant ? 'Remove access' : 'Allow this note'}
        </button>
      {/if}
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={messagesElement}
    class="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
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
        <div class="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-foreground"><Brain class="h-5 w-5" /></div>
        <h2 class="text-base font-semibold text-foreground">Think something through</h2>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">Ask directly, explore an unfinished idea, challenge an assumption, or shape a thought into something useful.</p>
      </div>
    {:else if conversation}
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {#each conversation.messages as message (message.id)}
          <article
            class:chat-message--user={message.role === 'user'}
            class="chat-message group"
            data-chat-message-id={message.id}
          >
            <div class="mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <span>{message.role === 'assistant' ? 'Thought partner' : message.role}</span>
              {#if message.status === 'streaming'}<span class="font-normal normal-case">thinking…</span>{/if}
              {#if message.status === 'cancelled'}<span class="font-normal normal-case">stopped</span>{/if}
            </div>
            <div class="chat-message-content text-[0.94rem] leading-7 text-foreground" class:opacity-70={message.status === 'cancelled'}>
              {@html rendered(message.content)}
            </div>

            {#if message.citations.length > 0}
              <div class="mt-3 flex flex-wrap gap-1.5" aria-label="Sources">
                {#each message.citations as citation (citation.id)}
                  {#if citation.kind === 'web'}
                    <a class="chat-citation" href={citation.url} target="_blank" rel="noreferrer" title={citation.excerpt ?? citation.url}>
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
              <div class="mt-3 flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-background/80 p-1 shadow-sm">
                <button type="button" class="chat-selection-action" onclick={() => void copySelection()}><Copy class="h-3.5 w-3.5" /> Copy</button>
                <button type="button" class="chat-selection-action" onclick={() => void copyLink()}><Link class="h-3.5 w-3.5" /> Copy link</button>
                {#if selectionActions.onInsertIntoNote}
                  <button type="button" class="chat-selection-action" onclick={() => void insertSelection()}><FileInput class="h-3.5 w-3.5" /> Insert into note</button>
                {/if}
                <button type="button" class="chat-selection-action" onclick={() => void toggleRemember()}><Brain class="h-3.5 w-3.5" /> {selectedExcerpt?.remembered ? 'Unremember' : 'Remember'}</button>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </div>

  <footer class="border-t border-border/70 p-3">
    {#if snapshot.error || actionError}
      <div class="mb-2 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
        <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span class="min-w-0 flex-1">{actionError ?? snapshot.error}</span>
        <button type="button" class="font-semibold" onclick={() => { actionError = null; controller.clearError(); }}>Dismiss</button>
      </div>
    {/if}
    <div class="mx-auto max-w-3xl rounded-[1.1rem] border border-input bg-background/90 p-2 shadow-sm focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-ring/10">
      <textarea
        bind:this={composerElement}
        bind:value={draft}
        rows={variant === 'inline' ? 2 : 3}
        class="block max-h-40 min-h-12 w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
        {placeholder}
        disabled={snapshot.isInitializing || conversation?.status === 'projectionConflict'}
        onkeydown={onComposerKeydown}
      ></textarea>
      <div class="flex items-center justify-between gap-2 px-1 pt-1">
        <div>
          {#if conversation?.mode === 'research'}
            <label class="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" bind:checked={useWebSearch} class="accent-foreground" /> Search the web
            </label>
          {/if}
        </div>
        {#if snapshot.isSending}
          <button type="button" class="chat-send-button" onclick={() => void controller.cancel()} aria-label="Stop response" title="Stop response"><Square class="h-3.5 w-3.5 fill-current" /></button>
        {:else}
          <button type="button" class="chat-send-button" class:opacity-40={!canSend && Boolean(conversation)} disabled={!draft.trim()} onclick={() => void submit()} aria-label="Send message" title="Send message"><Send class="h-4 w-4" /></button>
        {/if}
      </div>
    </div>
  </footer>
</section>

<style>
  .chat-icon-button { display: inline-flex; height: 1.75rem; width: 1.75rem; align-items: center; justify-content: center; border-radius: 9999px; color: var(--muted-foreground); }
  .chat-icon-button:hover { background: var(--accent); color: var(--accent-foreground); }
  .chat-control { max-width: 8rem; border: 1px solid var(--border); border-radius: 9999px; background: color-mix(in oklab, var(--background) 70%, transparent); padding: 0.3rem 0.55rem; font-size: 0.7rem; color: var(--muted-foreground); outline: none; }
  .chat-message { max-width: min(92%, 42rem); border-radius: 1.15rem; background: color-mix(in oklab, var(--background) 68%, transparent); padding: 0.85rem 1rem; }
  .chat-message--user { align-self: flex-end; background: var(--accent); }
  .chat-message-content :global(p) { margin: 0 0 0.65rem; }
  .chat-message-content :global(p:last-child) { margin-bottom: 0; }
  .chat-message-content :global(ul), .chat-message-content :global(ol) { margin: 0.45rem 0; padding-left: 1.35rem; }
  .chat-message-content :global(pre) { overflow-x: auto; border-radius: 0.7rem; background: var(--muted); padding: 0.75rem; font-family: var(--font-mono); font-size: 0.8rem; line-height: 1.5; }
  .chat-message-content :global(code:not(pre code)) { border-radius: 0.3rem; background: var(--muted); padding: 0.1rem 0.3rem; font-family: var(--font-mono); font-size: 0.85em; }
  .chat-message-content :global(a) { text-decoration: underline; text-underline-offset: 2px; }
  .chat-citation { display: inline-flex; align-items: center; gap: 0.25rem; border: 1px solid var(--border); border-radius: 9999px; padding: 0.2rem 0.5rem; font-size: 0.68rem; color: var(--muted-foreground); }
  .chat-citation:hover { background: var(--accent); color: var(--accent-foreground); }
  .chat-selection-action { display: inline-flex; align-items: center; gap: 0.3rem; border-radius: 0.6rem; padding: 0.35rem 0.5rem; font-size: 0.7rem; font-weight: 500; color: var(--muted-foreground); }
  .chat-selection-action:hover { background: var(--accent); color: var(--accent-foreground); }
  .chat-send-button { display: inline-flex; height: 2rem; width: 2rem; align-items: center; justify-content: center; border-radius: 9999px; background: var(--foreground); color: var(--background); }
  .chat-send-button:disabled { cursor: default; opacity: 0.4; }
  .chat-panel--inline { border-radius: 1rem; }
</style>
