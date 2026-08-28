<script lang="ts">
  import { Check, FileText, History } from '@lucide/svelte';
  import type {
    ChatController,
    ChatControllerState
  } from '../controller.svelte';
  import { chatConversationContextKey } from './chatPanelHelpers';

  type ChatMenu = 'history' | 'vault' | 'provider' | 'model' | 'reasoning';

  interface Props {
    controller: ChatController;
    snapshot: ChatControllerState;
    showConversationPicker?: boolean;
    titleDraft?: string;
    /** Note this chat reasons about, shown so the binding is never ambiguous. */
    contextNoteTitle?: string | null;
    openMenu: ChatMenu | null;
    onOpenMenu: (menu: ChatMenu | null) => void;
    onFocusComposer: () => void;
  }

  let {
    controller,
    snapshot,
    showConversationPicker = true,
    titleDraft = $bindable(''),
    contextNoteTitle = null,
    openMenu,
    onOpenMenu,
    onFocusComposer
  }: Props = $props();

  let titleInput = $state<HTMLInputElement | null>(null);
  let titleFocused = $state(false);
  let titleCommitPending = false;
  let titleContextKey: string | null = null;

  $effect(() => {
    const next = snapshot;
    const nextContextKey = chatConversationContextKey(
      next.conversation?.id,
      next.conversationDraft.revision
    );
    if (nextContextKey !== titleContextKey) {
      titleContextKey = nextContextKey;
      titleDraft = next.conversation?.title ?? next.conversationDraft.title;
      return;
    }
    if (!titleFocused && !titleCommitPending && next.conversation) {
      titleDraft = next.conversation.title;
    }
  });

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
    onFocusComposer();
  }

  async function openConversation(id: string) {
    onOpenMenu(null);
    await controller.openConversation(id);
  }
</script>

<header
  class="chat-panel-header relative flex shrink-0 items-center gap-1 px-4 pt-4 pb-1 sm:px-5"
  class:chat-panel-header--with-context={Boolean(contextNoteTitle)}
>
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
          title={snapshot.conversation?.title ?? 'Conversations'}
          disabled={snapshot.conversations.length === 0}
          onclick={() =>
            onOpenMenu(openMenu === 'history' ? null : 'history')}
        >
          <History class="h-4 w-4" />
        </button>
        {#if openMenu === 'history' && snapshot.conversations.length > 0}
          <div
            class="chat-menu chat-menu--down"
            role="menu"
            aria-label="Conversations"
          >
            {#each snapshot.conversations as item (item.id)}
              <button
                type="button"
                class="chat-menu-item"
                class:chat-menu-item--active={item.id === snapshot.conversation?.id}
                role="menuitem"
                onclick={() => void openConversation(item.id)}
              >
                <span class="min-w-0 flex-1 truncate">{item.title}</span>
                {#if item.id === snapshot.conversation?.id}
                  <Check class="h-3.5 w-3.5 shrink-0" />
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="pointer-events-none absolute inset-x-14 top-3 flex flex-col items-center sm:inset-x-16 sm:top-4">
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
    {#if contextNoteTitle}
      <p
        class="flex min-w-0 max-w-full items-center gap-1 text-xs text-muted-foreground"
        title={`Chat context: ${contextNoteTitle}`}
      >
        <FileText class="h-3 w-3 shrink-0" aria-hidden="true" />
        <span class="truncate">{contextNoteTitle}</span>
      </p>
    {/if}
  </div>
</header>
