<script lang="ts">
  import {
    Brain,
    Copy,
    ExternalLink,
    FileInput,
    Link,
    RotateCcw
  } from '@lucide/svelte';
  import { attachmentDataUrl } from '../attachments';
  import type {
    ChatAttachmentInput,
    ChatCitation,
    ChatExcerpt,
    ChatMessage as ChatMessageModel,
    ChatSelection
  } from '../types';
  import {
    renderChatMarkdown,
    safeWebCitationHref
  } from './chatPanelHelpers';

  interface Props {
    message: ChatMessageModel;
    activity: string | null;
    selected: ChatSelection | null;
    selectedExcerpt: ChatExcerpt | null;
    canInsertSelection: boolean;
    onPreviewAttachment: (attachment: ChatAttachmentInput) => void;
    onOpenCitation?: (
      citation: Extract<ChatCitation, { kind: 'note' }>
    ) => void | Promise<void>;
    onRetry: () => void | Promise<void>;
    onCopySelection: () => void | Promise<void>;
    onCopyLink: () => void | Promise<void>;
    onInsertSelection: () => void | Promise<void>;
    onToggleRemember: () => void | Promise<void>;
  }

  let {
    message,
    activity,
    selected,
    selectedExcerpt,
    canInsertSelection,
    onPreviewAttachment,
    onOpenCitation,
    onRetry,
    onCopySelection,
    onCopyLink,
    onInsertSelection,
    onToggleRemember
  }: Props = $props();
</script>

<article
  class:chat-message--user={message.role === 'user'}
  class="chat-message group"
  data-chat-message-id={message.id}
>
  <div class="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
    <span>{message.role === 'assistant' ? 'Thought partner' : 'You'}</span>
    {#if message.status === 'streaming'}
      <span class="opacity-70">{activity ?? 'Working…'}</span>
    {/if}
    {#if message.status === 'cancelled'}
      <span class="opacity-70">stopped</span>
    {/if}
  </div>

  <div
    class="chat-message-content text-[0.94rem] leading-7 text-foreground"
    class:opacity-70={message.status === 'cancelled'}
  >
    <!-- markdown-it is configured with html:false, which escapes raw HTML -->
    {@html renderChatMarkdown(message.content)}
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
            onclick={() => onPreviewAttachment(attachment)}
          >
            <img src={attachmentDataUrl(attachment)} alt={attachment.name} />
          </button>
        {:else}
          <button
            type="button"
            class="chat-attachment-file"
            aria-label={`Preview ${attachment.name}`}
            title={`Preview ${attachment.name}`}
            onclick={() => onPreviewAttachment(attachment)}
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
            href={safeWebCitationHref(citation.url)}
            target="_blank"
            rel="noreferrer noopener"
            title={citation.excerpt ?? citation.url}
          >
            {citation.label}<ExternalLink class="h-3 w-3" />
          </a>
        {:else}
          <button
            type="button"
            class="chat-citation"
            title={citation.excerpt ?? citation.notePath}
            onclick={() => void onOpenCitation?.(citation)}
          >
            [[{citation.label}]]
          </button>
        {/if}
      {/each}
    </div>
  {/if}

  {#if (message.status === 'error' || message.status === 'cancelled') && message.role === 'assistant'}
    <div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      {#if message.errorMessage}<span>{message.errorMessage}</span>{/if}
      <button
        type="button"
        class="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
        onclick={() => void onRetry()}
      >
        <RotateCcw class="h-3 w-3" /> Retry
      </button>
    </div>
  {/if}

  {#if selected?.messageId === message.id}
    <div class="mt-3 flex flex-wrap items-center gap-0.5 rounded-full border border-border/70 bg-background/90 p-1 shadow-sm">
      <button
        type="button"
        class="chat-selection-action"
        onclick={() => void onCopySelection()}
      >
        <Copy class="h-3.5 w-3.5" /> Copy
      </button>
      <button
        type="button"
        class="chat-selection-action"
        onclick={() => void onCopyLink()}
      >
        <Link class="h-3.5 w-3.5" /> Copy link
      </button>
      {#if canInsertSelection}
        <button
          type="button"
          class="chat-selection-action"
          onclick={() => void onInsertSelection()}
        >
          <FileInput class="h-3.5 w-3.5" /> Insert
        </button>
      {/if}
      <button
        type="button"
        class="chat-selection-action"
        onclick={() => void onToggleRemember()}
      >
        <Brain class="h-3.5 w-3.5" />
        {selectedExcerpt?.remembered ? 'Unremember' : 'Remember'}
      </button>
    </div>
  {/if}
</article>
