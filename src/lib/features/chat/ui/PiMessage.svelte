<script lang="ts">
  import type { Message } from '@earendil-works/pi-ai';
  import PiMarkdown from './PiMarkdown.svelte';
  import { messageText } from './piConversationView';
  let { message, streaming = false, admitted = false, onOpenSource }: { message: Message; streaming?: boolean; admitted?: boolean; onOpenSource?: (id: string) => void } = $props();
</script>

{#if message.role === 'user'}
  <article class="pi-user" data-testid="pi-user-message"><p>{messageText(message)}</p></article>
{:else if message.role === 'assistant'}
  <article class="pi-assistant" data-testid="pi-assistant-message" data-streaming={streaming}>
    {#each message.content as block, index (index)}
      {#if block.type === 'thinking' && block.thinking}
        <details class="pi-reasoning" data-testid="pi-reasoning"><summary>Reasoning</summary><pre>{block.thinking}</pre></details>
      {:else if block.type === 'text'}
        <PiMarkdown source={block.text} admitted={admitted && !streaming && message.stopReason !== 'error' && message.stopReason !== 'aborted'} {onOpenSource} />
      {:else if block.type === 'toolCall'}
        <details class="pi-tool"><summary>{block.name}</summary><pre>{JSON.stringify(block.arguments, null, 2)}</pre></details>
      {/if}
    {/each}
    {#if !streaming && message.errorMessage}<p role="status" class="pi-error">{message.errorMessage}</p>{/if}
  </article>
{:else if message.role === 'toolResult'}
  <details class="pi-tool" data-testid="pi-tool-result" data-error={message.isError}>
    <summary>{message.toolName} · {message.isError ? 'Failed' : 'Complete'}{message.durationMs === undefined ? '' : ` · ${(message.durationMs / 1000).toFixed(1)}s`}</summary>
    <pre>{messageText(message)}</pre>
    {#if message.details}<pre>{JSON.stringify(message.details, null, 2)}</pre>{/if}
  </details>
{/if}

<style>
  article { margin-block: 1.4rem; overflow-wrap: anywhere; }
  .pi-user { max-width: 85%; margin-left: auto; border-radius: 1rem; padding: .65rem 1rem; background: var(--muted); white-space: pre-wrap; }
  details { margin-block: .65rem; color: var(--muted-foreground); font-size: .82rem; }
  summary { cursor: pointer; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; margin-top: .5rem; }
  .pi-error, [data-error='true'] { color: var(--destructive); }
</style>
