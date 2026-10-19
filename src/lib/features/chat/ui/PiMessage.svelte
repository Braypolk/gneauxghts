<script lang="ts">
  import type { Message } from '@earendil-works/pi-ai';
  import { onDestroy } from 'svelte';
  import { Copy, Check } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import PiMarkdown from './PiMarkdown.svelte';
  import { messageText } from './piConversationView';
  import { messageCopyText, messageTime } from './piMessage';
  let { message, actionMessage = message, streaming = false, admitted = false, onOpenSource }: { message: Message; actionMessage?: Message | null; streaming?: boolean; admitted?: boolean; onOpenSource?: (id: string) => void } = $props();
  const time = $derived(actionMessage && !streaming ? messageTime(actionMessage) : undefined);
  let copyState = $state<'idle' | 'copying' | 'copied' | 'error'>('idle');
  let resetCopy: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(resetCopy));
  async function copy() {
    if (!actionMessage || streaming || copyState === 'copying') return;
    clearTimeout(resetCopy);
    copyState = 'copying';
    try {
      await navigator.clipboard.writeText(messageCopyText(actionMessage));
      copyState = 'copied';
    }
    catch { copyState = 'error'; }
    resetCopy = setTimeout(() => { copyState = 'idle'; }, 2000);
  }
</script>

{#snippet actions()}
  {#if actionMessage && !streaming}
    <footer class="message-actions" data-testid="pi-message-actions">
      <Button variant="ghost" size="icon-sm" class="message-copy" aria-label="Copy message" title={copyState === 'copied' ? 'Copied' : 'Copy message'} disabled={copyState === 'copying'} onclick={copy}>
        {#if copyState === 'copied'}<Check aria-hidden="true" />{:else}<Copy aria-hidden="true" />{/if}
      </Button>
      {#if time}<time datetime={time.date.toISOString()} title={`${time.label} ${time.date.toLocaleString()}`}>{time.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>{/if}
      <span role="status" class:copy-error={copyState === 'error'} class:sr-only={copyState !== 'error'}>{copyState === 'copied' ? 'Message copied' : copyState === 'error' ? 'Could not copy. Try again.' : ''}</span>
    </footer>
  {/if}
{/snippet}

{#if message.role === 'user'}
  <article class="pi-user" data-testid="pi-user-message"><div class="pi-user-body"><p>{messageText(message)}</p></div>{@render actions()}</article>
{:else if message.role === 'assistant'}
  <article class="pi-assistant" data-testid="pi-assistant-message" data-streaming={streaming}>
    <div class="pi-assistant-body">
    {#each message.content as block, index (index)}
      {#if block.type === 'text'}
        <PiMarkdown source={block.text} admitted={admitted && !streaming && message.stopReason !== 'error' && message.stopReason !== 'aborted'} {onOpenSource} />
      {/if}
    {/each}
    {#if !streaming && message.errorMessage}
      {#if message.stopReason === 'aborted'}<p role="status" class="pi-stopped">Stopped.</p>
      {:else}<p role="status" class="pi-error">{message.errorMessage}</p>{/if}
    {/if}
    </div>
    {@render actions()}
  </article>
{/if}

<style>
  article { margin-block: 1.4rem; overflow-wrap: anywhere; }
  .pi-user { width: fit-content; max-width: 85%; margin-left: auto; }
  .pi-user-body { border-radius: 1rem; padding: .65rem 1rem; background: var(--muted); white-space: pre-wrap; }
  .message-actions { display: flex; align-items: center; gap: .35rem; min-height: 1.75rem; margin-top: .25rem; color: var(--muted-foreground); font-size: .7rem; opacity: 0; pointer-events: none; }
  .pi-user .message-actions { justify-content: flex-end; }
  article:hover .message-actions, article:focus-within .message-actions { opacity: 1; pointer-events: auto; }
  .copy-error { color: var(--destructive); }
  @media (hover: none), (any-pointer: coarse) {
    .message-actions { opacity: 1; pointer-events: auto; }
    .message-actions :global(.message-copy) { min-width: 44px; min-height: 44px; }
  }
  .pi-error { color: var(--destructive); }
  .pi-stopped { color: var(--muted-foreground); }
</style>
