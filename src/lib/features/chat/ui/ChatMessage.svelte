<script lang="ts">
  import {
    Brain,
    Copy,
    FileInput,
    GitBranch,
    FilePenLine,
    Link,
    RotateCcw,
    ShieldAlert
  } from '@lucide/svelte';
  import ChainOfThought from '$lib/components/ai-elements/chain-of-thought/chain-of-thought.svelte';
  import MessageRoot from '$lib/components/ai-elements/message/core/message.svelte';
  import EvidenceSource from './EvidenceSource.svelte';
  import PlanContent from '$lib/components/ai-elements/plan/plan-content.svelte';
  import PlanDescription from '$lib/components/ai-elements/plan/plan-description.svelte';
  import PlanHeader from '$lib/components/ai-elements/plan/plan-header.svelte';
  import PlanRoot from '$lib/components/ai-elements/plan/plan.svelte';
  import PlanTitle from '$lib/components/ai-elements/plan/plan-title.svelte';
  import PlanTrigger from '$lib/components/ai-elements/plan/plan-trigger.svelte';
  import Sources from '$lib/components/ai-elements/sources/sources.svelte';
  import Task from '$lib/components/ai-elements/task/task.svelte';
  import ChatMarkdown from './ChatMarkdown.svelte';
  import ChatUsageInfo from './ChatUsageInfo.svelte';
  import { attachmentDataUrl } from '../attachments';
  import type {
    ChatAttachmentInput,
    AgentPermissionDecision,
    AgentPermissionRequest,
    ChatCitation,
    ChatExcerpt,
    ChatMessage as ChatMessageModel,
    ChatPart,
    ChatSelection
  } from '../types';
  import {
    safeWebCitationHref
  } from './chatPanelHelpers';
  import { materializeDurableChatParts, settleAgentActivity } from '../agentEvents';

  interface Props {
    message: ChatMessageModel;
    activity: string | null;
    selected: ChatSelection | null;
    selectedExcerpt: ChatExcerpt | null;
    canInsertSelection: boolean;
    canDecidePermission: boolean;
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
    onDecidePermission: (
      request: AgentPermissionRequest,
      decision: AgentPermissionDecision
    ) => void | Promise<void>;
    onReviewProposal?: (proposalId: string) => void | Promise<void>;
  }

  let {
    message,
    activity,
    selected,
    selectedExcerpt,
    canInsertSelection,
    canDecidePermission,
    onPreviewAttachment,
    onOpenCitation,
    onOpenWikilink,
    onRetry,
    onBranch,
    onCopyMessage,
    onCopySelection,
    onCopyLink,
    onInsertSelection,
    onToggleRemember,
    onDecidePermission,
    onReviewProposal
  }: Props = $props();

  const visibleParts = $derived<ChatPart[]>(
    settleAgentActivity(
      materializeDurableChatParts(
        message.parts.length > 0
          ? message.parts
          : [{ id: 'text', type: 'text', text: message.content }],
        {
          text: message.content,
          citations: message.citations,
          checkpoint: message.role === 'assistant' && message.status === 'completed'
        }
      ),
      message.status
    )
  );
  const usagePart = $derived(
    visibleParts.find((part) => part.type === 'usage')
  );
  const contextUsage = $derived(
    visibleParts.find((part) => part.type === 'contextUsage')
  );
  const checkpoint = $derived(
    visibleParts.find((part) => part.type === 'checkpoint')
  );
  const timestamp = $derived.by(() => {
    const date = new Date(message.createdAtMillis);
    if (!Number.isFinite(date.getTime())) return null;
    return {
      iso: date.toISOString(),
      label: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
      full: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    };
  });
  const toolParts = $derived.by(() =>
    visibleParts
      .filter((part): part is Extract<ChatPart, { type: 'tool' }> => part.type === 'tool')
      .slice()
      .sort(
        (left, right) =>
          (left.stepIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.stepIndex ?? Number.MAX_SAFE_INTEGER)
      )
  );
  function planSummary(entries: Extract<ChatPart, { type: 'plan' }>['entries']) {
    const completed = entries.filter((entry) => entry.status === 'completed').length;
    return `${completed} of ${entries.length} steps complete`;
  }

  function permissionResolutionLabel(
    resolution: Extract<ChatPart, { type: 'permission' }>['resolution']
  ) {
    switch (resolution) {
      case 'allowedOnce': return 'Allowed once';
      case 'allowedForSession': return 'Allowed for this run';
      case 'denied': return 'Denied';
      default: return 'Cancelled';
    }
  }

  function permissionIsActionable(part: Extract<ChatPart, { type: 'permission' }>) {
    return canDecidePermission &&
      part.status === 'pending' &&
      part.request.conversationId === message.conversationId &&
      part.request.messageId === message.id &&
      part.request.requestId === message.requestId &&
      part.request.runId === message.agentRunId;
  }
</script>

<MessageRoot
  from={message.role === 'user' ? 'user' : 'assistant'}
  class={`chat-message group gap-1.5 ${message.role === 'user' ? 'chat-message--user' : ''}`}
  data-chat-message-id={message.id}
  aria-label={message.role === 'user' ? 'Your message' : 'Assistant response'}
>
  <div class="chat-message-body flex w-full flex-col gap-2.5">
    {#if toolParts.length > 0}
      <ChainOfThought steps={toolParts} />
    {/if}
    {#each visibleParts as part (part.id)}
      {#if part.type === 'text' && part.text}
        <div
          class={`chat-message-content bg-transparent p-0 text-foreground ${message.status === 'cancelled' ? 'opacity-70' : ''}`}
        >
          {#if message.role === 'assistant'}
            <ChatMarkdown
              source={part.text}
              citations={message.citations}
              streaming={message.status === 'streaming'}
              {onOpenCitation}
              {onOpenWikilink}
            />
          {:else}
            <div class="chat-user-text">{part.text}</div>
          {/if}
        </div>
      {:else if part.type === 'plan'}
        <PlanRoot
          open={message.status === 'streaming'}
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
      {:else if part.type === 'status'}
        <div
          class="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/15 px-3 py-2 text-xs text-muted-foreground"
          role="status"
          aria-label={part.label}
        >
          <RotateCcw class="h-3.5 w-3.5" />
          <span>{part.label}</span>
        </div>
      {:else if part.type === 'permission'}
        <section
          class="rounded-lg border border-amber-500/35 bg-amber-500/5 px-3 py-2.5 text-xs"
          aria-label={`Permission required: ${part.request.title}`}
        >
          <div class="flex items-start gap-2">
            <ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div class="min-w-0 flex-1">
              <div class="font-medium text-foreground">{part.request.title}</div>
              <div class="mt-0.5 break-words text-muted-foreground">
                Scope: {part.request.scope}
              </div>
              {#if part.status === 'pending'}
                <div
                  class="mt-2 flex flex-wrap gap-1.5"
                  role="group"
                  aria-label={`Decide permission for ${part.request.title}`}
                >
                  <button
                    type="button"
                    class="rounded-md border border-border px-2 py-1 font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!permissionIsActionable(part)}
                    onclick={() => void onDecidePermission(part.request, 'deny')}
                  >Deny</button>
                  <button
                    type="button"
                    class="rounded-md border border-border px-2 py-1 font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!permissionIsActionable(part)}
                    onclick={() => void onDecidePermission(part.request, 'allowOnce')}
                  >Allow once</button>
                  <button
                    type="button"
                    class="rounded-md bg-foreground px-2 py-1 font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!permissionIsActionable(part)}
                    aria-label="Allow for this agent run"
                    onclick={() => void onDecidePermission(part.request, 'allowForSession')}
                  >Allow for this run</button>
                </div>
              {:else}
                <div class="mt-2 text-muted-foreground" role="status">
                  {permissionResolutionLabel(part.resolution)}
                </div>
              {/if}
            </div>
          </div>
        </section>
      {:else if part.type === 'proposalRef'}
        <section class="rounded-lg border border-border/70 bg-muted/15 px-3 py-2.5 text-xs">
          <div class="flex items-center gap-2">
            <FilePenLine class="h-4 w-4 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <div class="font-medium text-foreground">
                {part.kind === 'create' ? 'New note prepared' : 'Note changes prepared'}
              </div>
              <div class="truncate text-muted-foreground">{part.title}</div>
            </div>
            {#if onReviewProposal}
              <button
                type="button"
                class="rounded-md border border-border px-2 py-1 font-medium text-foreground hover:bg-muted"
                onclick={() => void onReviewProposal?.(part.proposalId)}
              >Review</button>
            {/if}
          </div>
        </section>
      {:else if part.type === 'context' && (part.compacted || part.selectedNoteTitles.length > 0)}
        <details class="rounded-lg border border-border/70 bg-muted/15 px-3 py-2 text-xs">
          <summary class="cursor-pointer font-medium text-foreground">
            Context
            {#if part.selectedNoteTitles.length > 0}
              · {part.selectedNoteTitles.length} {part.selectedNoteTitles.length === 1 ? 'note' : 'notes'} included
            {/if}
          </summary>
          <div class="mt-2 space-y-1 text-muted-foreground">
            {#if part.compacted}<p>Earlier conversation context was compacted.</p>{/if}
            {#if part.selectedNoteTitles.length > 0}
              <p>{part.selectedNoteTitles.join(', ')}</p>
            {/if}
          </div>
        </details>
      {:else if part.type === 'sources'}
        <Sources count={part.citations.length}>
          {#each part.citations as citation, index (citation.id)}
            <EvidenceSource
              {citation}
              index={index + 1}
              href={citation.kind === 'web' ? safeWebCitationHref(citation.url) : undefined}
              onOpen={citation.kind === 'note' ? () => onOpenCitation?.(citation) : undefined}
            />
          {/each}
        </Sources>
      {/if}
    {/each}

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
  </div>

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

  <div class="chat-message-footer">
    {#if timestamp}
      <time datetime={timestamp.iso} title={timestamp.full}>{timestamp.label}</time>
    {/if}
    {#if message.status === 'streaming' && !toolParts.some((part) => part.status === 'running')}
      <span role="status">{activity ?? 'Working…'}</span>
    {:else if message.status === 'cancelled'}
      <span>Stopped</span>
    {/if}
    {#if message.content && message.status !== 'streaming'}
      <button
        type="button"
        class="chat-message-action"
        aria-label="Copy message as Markdown"
        title="Copy message as Markdown"
        onclick={() => void onCopyMessage()}
      >
        <Copy class="h-3.5 w-3.5" />
      </button>
    {/if}
    {#if checkpoint?.type === 'checkpoint'}
      <button
        type="button"
        class="chat-message-action chat-message-branch"
        aria-label={checkpoint.label}
        title="Create a new conversation from this point"
        onclick={() => void onBranch()}
      >
        <GitBranch class="h-3.5 w-3.5" />
      </button>
    {/if}
    {#if message.role === 'assistant' && (contextUsage || usagePart)}
      <ChatUsageInfo
        contextUsage={contextUsage?.type === 'contextUsage' ? contextUsage : null}
        usage={usagePart?.type === 'usage' ? usagePart.usage : null}
      />
    {/if}
  </div>

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
