<script lang="ts">
  import { ExternalLink } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import type { ChatCitation } from '$lib/features/chat/types';

  let {
    citation,
    index,
    href,
    onOpen,
    class: className
  }: {
    citation: ChatCitation;
    index: number;
    href?: string;
    onOpen?: () => void | Promise<void>;
    class?: string;
  } = $props();
</script>

{#if citation.kind === 'web'}
  <a
    data-slot="inline-citation"
    class={cn('inline-flex h-5 items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-1.5 text-[10px] font-medium hover:bg-muted', className)}
    href={href}
    target="_blank"
    rel="noreferrer noopener"
    title={citation.excerpt ?? citation.url}
  >
    [{index}] {citation.label}<ExternalLink class="h-2.5 w-2.5" />
  </a>
{:else}
  <button
    type="button"
    data-slot="inline-citation"
    class={cn('inline-flex h-5 items-center rounded-full border border-border/70 bg-muted/40 px-1.5 text-[10px] font-medium hover:bg-muted', className)}
    title={citation.revision
      ? `Revision · ${new Date(citation.revision.atMillis).toLocaleString()} · ${citation.revision.source}\n${citation.revision.currentExcerpt}`
      : citation.excerpt ?? citation.notePath}
    onclick={() => void onOpen?.()}
  >
    [{index}] {citation.label}{citation.revision ? " · Revision" : ""}
  </button>
{/if}
