<script lang="ts">
  import { Popover } from 'bits-ui';
  import type { AgentUsage, ChatPart } from '../types';

  let { contextUsage, usage }: {
    contextUsage: Extract<ChatPart, { type: 'contextUsage' }> | null;
    usage: AgentUsage | null;
  } = $props();

  const percent = $derived(contextUsage?.capacityTokens
    ? contextUsage.inputTokens / contextUsage.capacityTokens : null);
  const label = $derived(percent !== null
    ? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(percent)
    : contextUsage
      ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(contextUsage.inputTokens)
      : 'unavailable');
</script>

<Popover.Root>
  <Popover.Trigger class="chat-context-trigger" aria-label="Show context usage" data-chat-menu>
    Context {label}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="chat-context-details" side="top" align="start" sideOffset={8} collisionPadding={16} aria-label="Context usage details">
      <p class="font-medium text-foreground">Context used</p>
      {#if contextUsage}
        <p class="mt-1 tabular-nums">
          {contextUsage.inputTokens.toLocaleString()}
          {#if contextUsage.capacityTokens}
            / {contextUsage.capacityTokens.toLocaleString()} tokens
          {:else}
            tokens · limit not reported
          {/if}
        </p>
        {#if percent !== null}
          <div class="chat-context-meter" aria-hidden="true">
            <span style={`width: ${Math.min(100, percent * 100)}%`}></span>
          </div>
        {/if}
        <p class="mt-2 leading-5">Input to the latest model request, including conversation, instructions, and tools.</p>
      {:else}
        <p class="mt-1 leading-5">Context usage was not reported for this response.</p>
      {/if}
      {#if usage}
        <dl class="mt-3 space-y-1 border-t border-border/70 pt-2 tabular-nums">
          <div class="flex justify-between gap-3"><dt>Run tokens</dt><dd>{usage.totalTokens.toLocaleString()}</dd></div>
          <div class="flex justify-between gap-3"><dt>Input</dt><dd>{usage.inputTokens.toLocaleString()}</dd></div>
          <div class="flex justify-between gap-3"><dt>Output</dt><dd>{usage.outputTokens.toLocaleString()}</dd></div>
          {#if usage.reasoningTokens > 0}
            <div class="flex justify-between gap-3"><dt>Reasoning</dt><dd>{usage.reasoningTokens.toLocaleString()}</dd></div>
          {/if}
          {#if usage.cachedInputTokens > 0}
            <div class="flex justify-between gap-3"><dt>Cached input</dt><dd>{usage.cachedInputTokens.toLocaleString()}</dd></div>
          {/if}
        </dl>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
