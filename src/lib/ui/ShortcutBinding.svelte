<script lang="ts">
  import { getShortcutBindingParts } from '$lib/keyboardShortcuts.svelte';

  let { binding }: { binding: string } = $props();

  const parts = $derived(getShortcutBindingParts(binding));
</script>

<span class="inline-flex items-center gap-1 font-mono">
  {#each parts as part, i}
    <span>{part}</span>
    {#if i < parts.length - 1}
      <span class="text-muted-foreground/40">+</span>
    {/if}
  {/each}
</span>
