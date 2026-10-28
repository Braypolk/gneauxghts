<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, actions }: { title: string; actions?: Snippet } = $props();
</script>

<div class="search-results-heading flex min-h-11 shrink-0 items-center justify-between gap-3 px-4">
  <span class="menu-heading text-muted-foreground">{title}</span>
  {#if actions}{@render actions()}{/if}
</div>
