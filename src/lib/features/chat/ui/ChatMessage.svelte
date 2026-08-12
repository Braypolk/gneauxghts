<script lang="ts">
  import {
    Brain,
    Copy,
    FileInput,
    Link,
    RotateCcw
  } from '@lucide/svelte';
  import ChainOfThought from '$lib/components/ai-elements/chain-of-thought/chain-of-thought.svelte';
  import Checkpoint from '$lib/components/ai-elements/checkpoint/checkpoint.svelte';
  import ContextContent from '$lib/components/ai-elements/context/context-content.svelte';
  import ContextContentBody from '$lib/components/ai-elements/context/context-content-body.svelte';
  import ContextContentHeader from '$lib/components/ai-elements/context/context-content-header.svelte';
  import ContextRoot from '$lib/components/ai-elements/context/context.svelte';
  import ContextTrigger from '$lib/components/ai-elements/context/context-trigger.svelte';
  import MessageContent from '$lib/components/ai-elements/message/core/message-content.svelte';
  import MessageRoot from '$lib/components/ai-elements/message/core/message.svelte';
  import InlineCitation from '$lib/components/ai-elements/inline-citation/inline-citation.svelte';
  import PlanContent from '$lib/components/ai-elements/plan/plan-content.svelte';
  import PlanDescription from '$lib/components/ai-elements/plan/plan-description.svelte';
  import PlanHeader from '$lib/components/ai-elements/plan/plan-header.svelte';
  import PlanRoot from '$lib/components/ai-elements/plan/plan.svelte';
  import PlanTitle from '$lib/components/ai-elements/plan/plan-title.svelte';
  import PlanTrigger from '$lib/components/ai-elements/plan/plan-trigger.svelte';
  import Reasoning from '$lib/components/ai-elements/reasoning/reasoning.svelte';
  import Sources from '$lib/components/ai-elements/sources/sources.svelte';
  import Task from '$lib/components/ai-elements/task/task.svelte';
  import ChatMarkdown from './ChatMarkdown.svelte';
  import { attachmentDataUrl } from '../attachments';
  import type {
    ChatAttachmentInput,
    ChatCitation,
    ChatExcerpt,
    ChatMessage as ChatMessageModel,
    ChatPart,
    ChatSelection
  } from '../types';
  import {
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
    onOpenWikilink?: (rawTarget: string) => void | Promise<void>;
    onRetry: () => void | Promise<void>;
    onBranch: () => void | Promise<void>;
    onCopyMessage: () => void | Promise<void>;
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
    onOpenWikilink,
    onRetry,
    onBranch,
    onCopyMessage,
    onCopySelection,
    onCopyLink,
    onInsertSelection,
    onToggleRemember
  }: Props = $props();

  const visibleParts = $derived<ChatPart[]>(
    message.parts.length > 0
      ? message.parts
      : [{ id: 'text', type: 'text', text: message.content }]
  );
  const usagePart = $derived(
    visibleParts.find((part) => part.type === 'usage')
  );
  const toolParts = $derived(
    visibleParts.filter((part): part is Extract<ChatPart, { type: 'tool' }> => part.type === 'tool')
  );

  function planSummary(entries: Extract<ChatPart, { type: 'plan' }>['entries']) {
    const completed = entries.filter((entry) => entry.status === 'completed').length;
    return `${completed} of ${entries.length} steps complete`;
  }
</script>

<MessageRoot
  from={message.role === 'user' ? 'user' : 'assistant'}
  class={`chat-message group max-w-full ${message.role === 'user' ? 'chat-message--user' : ''}`}
  data-chat-message-id={message.id}
>
  <div class="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
    <div class="flex items-center gap-2">
      <span>{message.role === 'assistant' ? 'Thought partner' : 'You'}</span>
      {#if message.status === 'streaming'}
        <span class="opacity-70">{activity ?? 'Working…'}</span>
      {/if}
      {#if message.status === 'cancelled'}
        <span class="opacity-70">stopped</span>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      {#if message.content && message.status !== 'streaming'}
        <button
          type="button"
          class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Copy message as Markdown"
          title="Copy message as Markdown"
          onclick={() => void onCopyMessage()}
        >
          <Copy class="h-3.5 w-3.5" />
        </button>
      {/if}
      {#if usagePart?.type === 'usage' && usagePart.usage.totalTokens > 0}
        <ContextRoot
          usedTokens={usagePart.usage.totalTokens}
          maxTokens={Math.max(usagePart.usage.totalTokens, 1)}
          usage={{
            inputTokens: usagePart.usage.inputTokens,
            outputTokens: usagePart.usage.outputTokens,
            reasoningTokens: usagePart.usage.reasoningTokens,
            cachedInputTokens: usagePart.usage.cachedInputTokens
          }}
        >
          <ContextTrigger>
            <button
              type="button"
              class="rounded-md px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted"
              aria-label="Show token usage"
            >
              {usagePart.usage.totalTokens.toLocaleString()} tokens
            </button>
          </ContextTrigger>
          <ContextContent align="end">
            <ContextContentHeader>
              <div class="flex items-center justify-between gap-3 text-xs">
                <span class="font-medium text-foreground">Token usage</span>
                <span class="font-mono text-muted-foreground">
                  {usagePart.usage.totalTokens.toLocaleString()} total
                </span>
              </div>
            </ContextContentHeader>
            <ContextContentBody class="space-y-1.5 text-xs">
              <div class="flex justify-between gap-4">
                <span class="text-muted-foreground">Input</span>
                <span>{usagePart.usage.inputTokens.toLocaleString()}</span>
              </div>
              <div class="flex justify-between gap-4">
                <span class="text-muted-foreground">Output</span>
                <span>{usagePart.usage.outputTokens.toLocaleString()}</span>
              </div>
              {#if usagePart.usage.reasoningTokens > 0}
                <div class="flex justify-between gap-4">
                  <span class="text-muted-foreground">Reasoning</span>
                  <span>{usagePart.usage.reasoningTokens.toLocaleString()}</span>
                </div>
              {/if}
              {#if usagePart.usage.cachedInputTokens > 0}
                <div class="flex justify-between gap-4">
                  <span class="text-muted-foreground">Cached input</span>
                  <span>{usagePart.usage.cachedInputTokens.toLocaleString()}</span>
                </div>
              {/if}
            </ContextContentBody>
          </ContextContent>
        </ContextRoot>
      {/if}
    </div>
  </div>

  <div class="flex w-full flex-col gap-2.5">
    {#if toolParts.length > 0}
      <ChainOfThought steps={toolParts} open={message.status === 'streaming'} />
    {/if}
    {#each visibleParts as part (part.id)}
      {#if part.type === 'text' && part.text}
        <MessageContent
          class={`chat-message-content bg-transparent p-0 text-foreground ${message.status === 'cancelled' ? 'opacity-70' : ''}`}
        >
          {#if message.role === 'assistant'}
            <ChatMarkdown
              source={part.text}
              streaming={message.status === 'streaming'}
              {onOpenWikilink}
            />
          {:else}
            <div class="chat-user-text">{part.text}</div>
          {/if}
        </MessageContent>
      {:else if part.type === 'reasoning'}
        <Reasoning
          status={message.status === 'cancelled' && part.status === 'running' ? 'cancelled' : part.status}
          summary={part.summary}
          open={part.status === 'running'}
        />
      {:else if part.type === 'plan'}
        <PlanRoot
          open={message.status === 'streaming'}
          isStreaming={message.status === 'streaming'}
          class="border-border/70 bg-muted/15 shadow-none"
        >
          <PlanHeader class="grid-cols-[1fr_auto] px-3 py-2.5">
            <div>
              <PlanTitle class="text-sm">Plan</PlanTitle>
              <PlanDescription class="text-xs">
                {planSummary(part.entries)}
              </PlanDescription>
            </div>
            <PlanTrigger />
          </PlanHeader>
          <PlanContent class="pb-3">
            <ol class="space-y-2 border-t border-border/60 pt-3 text-xs">
              {#each part.entries as entry (entry.id)}
                <Task {entry} />
              {/each}
            </ol>
          </PlanContent>
        </PlanRoot>
      {/if}
    {/each}
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
    <Sources count={message.citations.length}>
      {#each message.citations as citation, index (citation.id)}
        <InlineCitation
          {citation}
          index={index + 1}
          href={citation.kind === 'web' ? safeWebCitationHref(citation.url) : undefined}
          onOpen={citation.kind === 'note' ? () => onOpenCitation?.(citation) : undefined}
        />
      {/each}
    </Sources>
  {/if}

  {#if message.role === 'assistant' && message.status === 'completed'}
    <Checkpoint label="Branch from here" onBranch={onBranch} />
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
</MessageRoot>
