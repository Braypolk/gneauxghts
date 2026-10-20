<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, actions }: { title: string; actions?: Snippet } = $props();
</script>

<div class="search-results-heading flex items-center justify-between gap-3 px-4 pb-2 pt-3">
  <span class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{title}</span>
  {#if actions}{@render actions()}{/if}
</div>
