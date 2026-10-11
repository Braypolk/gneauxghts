<script lang="ts">
  import type { Snippet } from 'svelte';
  import PaneHeader from '$lib/ui/PaneHeader.svelte';
  import { Check, History } from '@lucide/svelte';
  import { hiddenFloatingPanelStyle, positionFloatingPanel } from '$lib/ui/floatingPanel';
  import type {
    ChatController,
    ChatControllerState
  } from '../controller.svelte';
  import { chatConversationContextKey } from './chatPanelHelpers';

  type ChatMenu = 'history' | 'vault' | 'model' | 'reasoning';

  interface Props {
    controller: ChatController;
    snapshot: ChatControllerState;
    showConversationPicker?: boolean;
    right?: Snippet;
    split?: boolean;
    workspace?: boolean;
    titleDraft?: string;
    openMenu: ChatMenu | null;
    onOpenMenu: (menu: ChatMenu | null) => void;
    onFocusComposer: () => void;
  }

  let {
    controller,
    snapshot,
    showConversationPicker = true,
    right,
    split = false,
    workspace = false,
    titleDraft = $bindable(''),
    openMenu,
    onOpenMenu,
    onFocusComposer
  }: Props = $props();

  let titleInput = $state<HTMLInputElement | null>(null);
  let historyButton = $state<HTMLButtonElement | null>(null);
  let historyMenu = $state<HTMLDivElement | null>(null);
  let historyMenuStyle = $state(hiddenFloatingPanelStyle);

  $effect(() => {
    if (openMenu !== 'history' || !historyButton || !historyMenu) return;
    return positionFloatingPanel(historyButton, historyMenu, (style) => { historyMenuStyle = style; });
  });
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

<PaneHeader
  titleText={titleDraft}
  titlePlaceholder="New chat"
  {right}
  {split}
  {workspace}
>
  {#snippet left()}
    {#if showConversationPicker}
      <div class="relative" data-chat-menu>
        <button
          bind:this={historyButton}
          type="button"
          class="mobile-touch-target pane-header-action"
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
            bind:this={historyMenu}
            class="chat-menu conversation-menu"
            style={historyMenuStyle}
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
  {/snippet}
  {#snippet title()}
    <input
      bind:this={titleInput}
      bind:value={titleDraft}
      type="text"
      size="1"
      placeholder="New chat"
      aria-label="Chat title"
      onfocus={() => (titleFocused = true)}
      onblur={() => void commitConversationTitle()}
      onkeydown={onTitleKeydown}
    />
  {/snippet}
</PaneHeader>

<style>
  .conversation-menu {
    --floating-panel-max-height: min(16rem, calc(100dvh - var(--command-bar-clearance, 5rem) - var(--pane-header-block-size, 4rem) - 6rem));
  }
</style>
