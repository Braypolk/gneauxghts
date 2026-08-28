<script lang="ts">
  import { onMount } from 'svelte';
  import ChatCodeBlock from './ChatCodeBlock.svelte';
  import { parseChatMarkdownBlocks } from './chatMarkdown';
  import type { ChatCitation } from '../types';

  interface Props {
    source: string;
    citations?: ChatCitation[];
    streaming?: boolean;
    onOpenCitation?: (
      citation: Extract<ChatCitation, { kind: 'note' }>
    ) => void | Promise<void>;
    onOpenWikilink?: (rawTarget: string) => void | Promise<void>;
  }

  let {
    source,
    citations = [],
    streaming = false,
    onOpenCitation,
    onOpenWikilink
  }: Props = $props();

  const blocks = $derived(parseChatMarkdownBlocks(source, citations));
  let root = $state<HTMLDivElement | null>(null);

  function handleClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const citationElement = target.closest<HTMLElement>('[data-chat-note-citation-id]');
    const citationId = citationElement?.dataset.chatNoteCitationId;
    const citation = citations.find(
      (candidate): candidate is Extract<ChatCitation, { kind: 'note' }> =>
        candidate.kind === 'note' && candidate.id === citationId
    );
    if (citation) {
      event.preventDefault();
      void onOpenCitation?.(citation);
      return;
    }
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
