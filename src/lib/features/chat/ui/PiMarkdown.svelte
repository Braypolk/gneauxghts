<script lang="ts">
  import { onMount } from 'svelte';
  import { renderPiMarkdown } from './piMarkdown';
  let { source, admitted = false, onOpenSource }: { source: string; admitted?: boolean; onOpenSource?: (sourceId: string) => void } = $props();
  let root: HTMLDivElement;
  const html = $derived(renderPiMarkdown(source, admitted));
  function click(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;
    const id = event.target.closest<HTMLElement>('[data-pi-source]')?.dataset.piSource;
    if (id) { event.preventDefault(); onOpenSource?.(id); }
  }
  onMount(() => { root.addEventListener('click', click); return () => root.removeEventListener('click', click); });
</script>
<!-- Delegation handles only native-admitted terminal source destinations. -->
<div class="gn-markdown-surface gn-markdown-html" bind:this={root}>{@html html}</div>
