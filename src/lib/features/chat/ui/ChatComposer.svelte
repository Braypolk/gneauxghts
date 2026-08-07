<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import {
    AlertCircle,
    Check,
    ChevronDown,
    FileInput,
    Globe,
    Paperclip,
    Send,
    Square,
    X
  } from '@lucide/svelte';
  import type {
    ChatController,
    ChatControllerState
  } from '../controller.svelte';
  import {
    attachmentAccept,
    attachmentDataUrl,
    filesToAttachments,
    validateAttachmentBatch
  } from '../attachments';
  import type {
    ChatActiveNoteSnapshot,
    ChatAttachmentInput,
    ChatContextNote,
    ChatProvider,
    VaultAccess
  } from '../types';
  import {
    chatComposerDraftSlot,
    chatConversationContextKey
  } from './chatPanelHelpers';
  import { createComposerDraftPersistence } from './composerDraftPersistence';
  import { configuredChatModel } from '../chatConfiguration';

  type ChatMenu = 'history' | 'vault' | 'provider';

  interface Props {
    controller: ChatController;
    snapshot: ChatControllerState;
    variant?: 'pane' | 'focused' | 'inline';
    placeholder?: string;
    titleDraft: string;
    /** Durable identity for unsent text before a conversation exists. */
    draftSlot?: string | null;
    contextNote?: ChatContextNote | null;
    getActiveNoteSnapshot?: () => Promise<ChatActiveNoteSnapshot | null>;
    configurationReady: boolean;
    openMenu: ChatMenu | null;
    actionError: string | null;
    composerElement?: HTMLTextAreaElement | null;
    onOpenMenu: (menu: ChatMenu | null) => void;
    onActionError: (message: string | null) => void;
    onDismissError: () => void;
    onPreviewAttachment: (attachment: ChatAttachmentInput) => void;
  }

  let {
    controller,
    snapshot,
    variant = 'pane',
    placeholder = 'What are you thinking about?',
    titleDraft,
    draftSlot = null,
    contextNote = null,
    getActiveNoteSnapshot,
    configurationReady,
    openMenu,
    actionError,
    composerElement = $bindable(null),
    onOpenMenu,
    onActionError,
    onDismissError,
    onPreviewAttachment
  }: Props = $props();

  const ACCESS_OPTIONS: { value: VaultAccess; label: string; hint: string }[] = [
    { value: 'none', label: 'No vault', hint: 'Chat only' },
    { value: 'approved', label: 'Approved only', hint: 'Approved notes only' },
    { value: 'full', label: 'Full vault', hint: 'All notes available' }
  ];
  const PROVIDERS: ChatProvider[] = ['openai', 'local'];

  let draft = $state('');
  let attachments = $state<ChatAttachmentInput[]>([]);
  let forceWebSearch = $state(false);
  let attachmentInput = $state<HTMLInputElement | null>(null);
  let contextAccessBusy = $state(false);
  let composerContextKey: string | null = null;
  let creatingConversationFromDraft = false;

  const conversation = $derived(snapshot.conversation);
  const effectiveProvider = $derived(
    conversation?.provider ?? snapshot.conversationDraft.provider
  );
  const effectiveVaultAccess = $derived(
    conversation?.vaultAccess ??
      snapshot.conversationDraft.vaultAccess
  );
  const canSend = $derived(
    configurationReady &&
      Boolean(draft.trim() || attachments.length > 0) &&
      !snapshot.isSending &&
      !snapshot.isInitializing &&
      !snapshot.isLoadingConversation &&
      (!conversation || conversation.status === 'active')
  );
  const canAttach = $derived(
    Boolean(
      snapshot.modelCapabilities?.images || snapshot.modelCapabilities?.files
    )
  );
  const acceptedAttachmentTypes = $derived(
    attachmentAccept(snapshot.modelCapabilities)
  );
  const contextGrant = $derived(
    contextNote?.noteId
      ? snapshot.grants.find((grant) => grant.noteId === contextNote.noteId) ??
          null
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
    if (contextExcluded) return 'Note excluded';
    if (effectiveVaultAccess === 'full') return 'Full vault';
    if (effectiveVaultAccess === 'none') return 'No vault';
    if (contextNote && contextGrant) return contextNote.noteTitle;
    return 'Approved only';
  });

  const draftPersistence = createComposerDraftPersistence({
    getDraft: (slot) => controller.getComposerDraft(slot),
    setDraft: (slot, body) => controller.setComposerDraft(slot, body),
    applyDraft: (body) => {
      draft = body;
    }
  });

  onDestroy(() => draftPersistence.dispose());

  $effect(() => {
    const conversationId = snapshot.conversation?.id ?? null;
    const nextContextKey = chatConversationContextKey(
      conversationId,
      snapshot.conversationDraft.revision
    );
    if (nextContextKey === composerContextKey) return;
    const hadContext = composerContextKey !== null;
    composerContextKey = nextContextKey;
    if (creatingConversationFromDraft) return;

    // Attachments are per-message and deliberately not carried across contexts.
    attachments = [];
    forceWebSearch = false;
    draft = '';

    const nextSlot = chatComposerDraftSlot(conversationId, draftSlot);
    if (!nextSlot) return;

    // Reaching a fresh draft from somewhere else means the user asked to start
    // over, so there is nothing to restore. Everything else is navigation.
    if (hadContext && !conversationId) {
      draftPersistence.resetSlot(nextSlot);
      return;
    }
    void draftPersistence.openSlot(nextSlot);
  });

  $effect(() => {
    draftPersistence.record(draft);
  });

  async function submit() {
    const content = draft.trim();
    if ((!content && attachments.length === 0) || snapshot.isSending) return;
    let activeNote: ChatActiveNoteSnapshot | null = null;
    try {
      activeNote = (await getActiveNoteSnapshot?.()) ?? null;
    } catch (error) {
      onActionError(
        error instanceof Error
          ? error.message
          : 'Save the active note before sending.'
      );
      return;
    }
    if (!controller.getSnapshot().conversation) {
      creatingConversationFromDraft = true;
      const created = await controller.createConversation({
        title: titleDraft.trim() || undefined
      });
      if (created) {
        // Controller subscriptions update the parent snapshot synchronously,
        // while this component's context effect flushes later. Adopt the new
        // context now so that delayed effect cannot clear the first message.
        composerContextKey = chatConversationContextKey(
          created.id,
          snapshot.conversationDraft.revision
        );
      }
      creatingConversationFromDraft = false;
      if (!created) return;
    }
    const sent = await controller.send(
      content,
      attachments,
      forceWebSearch,
      activeNote
    );
    if (sent) {
      draft = '';
      attachments = [];
      forceWebSearch = false;
      // The text is now a real message. Clear it from the pane slot it may have
      // been typed into as well as the conversation slot it graduated to.
      const sentSlot = chatComposerDraftSlot(
        controller.getSnapshot().conversation?.id ?? null,
        draftSlot
      );
      if (sentSlot) {
        draftPersistence.resetSlot(sentSlot);
      }
    }
  }

  async function addAttachments(files: File[]) {
    const capabilities = snapshot.modelCapabilities;
    if (!capabilities || files.length === 0) return;
    const validationError = validateAttachmentBatch(
      files,
      attachments,
      capabilities
    );
    if (validationError) {
      onActionError(validationError);
      return;
    }
    try {
      attachments = [...attachments, ...(await filesToAttachments(files))];
      onActionError(null);
    } catch (error) {
      onActionError(
        error instanceof Error
          ? error.message
          : 'Unable to read the attachment.'
      );
    }
  }

  function onAttachmentChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    void addAttachments(Array.from(input.files ?? []));
    input.value = '';
  }

  function chooseAttachments() {
    if (!snapshot.modelCapabilities) {
      onActionError(
        'Attachment support is still loading for the selected model.'
      );
      return;
    }
    if (!canAttach) {
      onActionError(
        'The selected model does not accept file or image attachments.'
      );
      return;
    }
    attachmentInput?.click();
  }

  function onComposerPaste(event: ClipboardEvent) {
    const images = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (images.length === 0) return;
    if (!snapshot.modelCapabilities?.images) {
      onActionError('The selected model does not accept image input.');
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

  async function updateProvider(provider: ChatProvider) {
    onOpenMenu(null);
    const model = configuredChatModel(snapshot.settings, provider);
    if (!model) {
      onActionError('Choose a tool-capable local model in Settings first.');
      return;
    }
    await controller.setProvider(provider, model);
    if (provider === 'local') forceWebSearch = false;
  }

  async function updateAccess(vaultAccess: VaultAccess) {
    onOpenMenu(null);
    await controller.setVaultAccess(vaultAccess);
  }

  async function toggleContextAccess() {
    const noteId = contextNote?.noteId;
    if (!noteId || contextAccessBusy) return;
    contextAccessBusy = true;
    onActionError(null);
    try {
      if (contextGrant) await controller.revokeNote(noteId);
      else await controller.grantNote(noteId);
    } catch (error) {
      onActionError(
        error instanceof Error ? error.message : 'Unable to change note access.'
      );
    } finally {
      contextAccessBusy = false;
    }
  }

  async function toggleContextExclusion() {
    const noteId = contextNote?.noteId;
    if (!noteId || !contextNote || contextAccessBusy) return;
    onOpenMenu(null);
    contextAccessBusy = true;
    onActionError(null);
    try {
      await controller.setNoteExcluded(
        noteId,
        contextNote.noteTitle,
        !contextExcluded
      );
    } catch (error) {
      onActionError(
        error instanceof Error
          ? error.message
          : 'Unable to change note exclusion.'
      );
    } finally {
      contextAccessBusy = false;
    }
  }
</script>

<footer class="pb-3 pt-2 sm:pb-4">
  {#if snapshot.error || actionError}
    <div class="chat-content-lane mb-2">
      <div
        class="flex items-start gap-2 rounded-[1.1rem] bg-destructive/10 px-3 py-2 text-xs text-destructive"
        role="alert"
      >
        <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span class="min-w-0 flex-1">{actionError ?? snapshot.error}</span>
        <button type="button" class="font-semibold" onclick={onDismissError}>
          Dismiss
        </button>
      </div>
    </div>
  {/if}

  <div class="chat-content-lane">
    <div
      class="rounded-[1.1rem] border border-border/80 bg-background/80 p-2 shadow-sm focus-within:border-foreground/25 focus-within:ring-2 focus-within:ring-ring/10"
    >
    {#if attachments.length > 0}
      <div class="flex flex-wrap gap-2 px-2 pb-2" aria-label="Pending attachments">
        {#each attachments as attachment, index (`${attachment.name}-${index}`)}
          <div class="chat-pending-attachment">
            <button
              type="button"
              class="chat-pending-attachment-preview"
              aria-label={`Preview ${attachment.name}`}
              title={`Preview ${attachment.name}`}
              onclick={() => onPreviewAttachment(attachment)}
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
              onclick={() =>
                (attachments = attachments.filter(
                  (_, itemIndex) => itemIndex !== index
                ))}
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
      disabled={!configurationReady ||
        conversation?.status === 'projectionConflict'}
      onkeydown={onComposerKeydown}
      onpaste={onComposerPaste}
    ></textarea>

    <div class="flex flex-wrap items-center gap-1.5 px-1 pt-1">
      {#if configurationReady}
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
            onclick={chooseAttachments}
            aria-label="Add files or images"
            title={!snapshot.modelCapabilities
              ? 'Attachment support is loading'
              : snapshot.modelCapabilities.images
                ? 'Add files or images; you can also paste images'
                : snapshot.modelCapabilities.files
                  ? 'Add files'
                  : 'Attachments are unavailable for the selected model'}
          >
            <Paperclip class="h-3.5 w-3.5" />
          </button>

        <div class="relative" data-chat-menu>
          <button
            type="button"
            class="chat-composer-chip"
            aria-label="AI provider"
            aria-expanded={openMenu === 'provider'}
            aria-haspopup="menu"
            onclick={() =>
              onOpenMenu(openMenu === 'provider' ? null : 'provider')}
          >
            <span>{effectiveProvider === 'local' ? 'Local' : 'OpenAI'}</span>
            <ChevronDown class="h-3 w-3 opacity-60" />
          </button>
          {#if openMenu === 'provider'}
            <div
              class="chat-menu chat-menu--up"
              role="menu"
              aria-label="AI provider"
            >
              {#each PROVIDERS as provider (provider)}
                <button
                  type="button"
                  class="chat-menu-item"
                  class:chat-menu-item--active={provider === effectiveProvider}
                  role="menuitem"
                  onclick={() => void updateProvider(provider)}
                >
                  <span class="min-w-0 flex-1">
                    <span class="block font-medium">
                      {provider === 'local' ? 'Local' : 'OpenAI'}
                    </span>
                    <span class="block max-w-48 truncate text-[11px] font-normal text-muted-foreground">
                      {configuredChatModel(snapshot.settings, provider) ||
                        'Configure in Settings'}
                    </span>
                  </span>
                  {#if provider === effectiveProvider}
                    <Check class="h-3.5 w-3.5 shrink-0" />
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <div class="relative" data-chat-menu>
          <button
            type="button"
            class="chat-composer-chip"
            class:chat-composer-chip--emphasis={effectiveVaultAccess ===
              'approved' &&
              contextNote &&
              !contextGrant}
            aria-label="Vault access"
            aria-expanded={openMenu === 'vault'}
            aria-haspopup="menu"
            onclick={() => onOpenMenu(openMenu === 'vault' ? null : 'vault')}
          >
            <span class="max-w-[7.5rem] truncate">{vaultLabel}</span>
            <ChevronDown class="h-3 w-3 opacity-60" />
          </button>
          {#if openMenu === 'vault'}
            <div
              class="chat-menu chat-menu--up"
              role="menu"
              aria-label="Vault access"
            >
              {#each ACCESS_OPTIONS as option (option.value)}
                <button
                  type="button"
                  class="chat-menu-item"
                  class:chat-menu-item--active={option.value ===
                    effectiveVaultAccess}
                  role="menuitem"
                  onclick={() => void updateAccess(option.value)}
                >
                  <span class="min-w-0 flex-1">
                    <span class="block font-medium">{option.label}</span>
                    <span class="block text-[11px] font-normal text-muted-foreground">
                      {option.hint}
                    </span>
                  </span>
                  {#if option.value === effectiveVaultAccess}
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
                      {contextExcluded
                        ? 'Allow this note'
                        : 'Exclude this note'}
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
        {:else if effectiveVaultAccess === 'approved' && contextNote?.noteId}
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
        {:else if effectiveVaultAccess === 'approved' &&
        contextNote &&
        !contextNote.noteId}
          <span class="px-1 text-[11px] text-muted-foreground">
            Save the note to grant access
          </span>
        {/if}

        {#if effectiveProvider === 'openai'}
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
      {:else}
        <span
          class="h-[1.65rem] w-32"
          aria-hidden="true"
        ></span>
      {/if}

      <div class="ml-auto flex items-center">
        {#if snapshot.isSending}
          <button
            type="button"
            class="chat-send-button"
            onclick={() => void controller.cancel()}
            aria-label="Stop response"
            title="Stop response"
          >
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
  </div>
</footer>
