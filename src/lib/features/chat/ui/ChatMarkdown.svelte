<script lang="ts">
  import { onMount } from 'svelte';
  import ChatCodeBlock from './ChatCodeBlock.svelte';
  import { parseChatMarkdownBlocks } from './chatMarkdown';

  interface Props {
    source: string;
    streaming?: boolean;
    onOpenWikilink?: (rawTarget: string) => void | Promise<void>;
  }

  let {
    source,
    streaming = false,
    onOpenWikilink
  }: Props = $props();

  const blocks = $derived(parseChatMarkdownBlocks(source));
  let root = $state<HTMLDivElement | null>(null);

  function handleClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLElement>('[data-wikilink-target]');
    const rawTarget = link?.dataset.wikilinkTarget;
    if (!rawTarget) return;
    event.preventDefault();
    void onOpenWikilink?.(rawTarget);
  }

  onMount(() => {
    root?.addEventListener('click', handleClick);
    return () => root?.removeEventListener('click', handleClick);
  });
</script>

<div
  bind:this={root}
  class="gn-markdown-surface"
  data-streaming={streaming ? 'true' : undefined}
  aria-busy={streaming}
>
  {#each blocks as block (block.key)}
    {#if block.type === 'html'}
      <div class="gn-markdown-html">{@html block.html}</div>
    {:else}
      <ChatCodeBlock code={block.code} language={block.language} />
    {/if}
  {/each}
</div>
