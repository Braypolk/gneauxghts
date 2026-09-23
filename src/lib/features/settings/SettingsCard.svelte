<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'summary' | 'metric';

  let {
    variant = 'summary',
    class: className = '',
    anchor,
    children
  }: {
    variant?: Variant;
    class?: string;
    anchor?: string;
    children: Snippet;
  } = $props();

  const variantClass: Record<Variant, string> = {
    summary: 'min-w-0 rounded-lg border border-border/70 bg-background/50 px-4 py-4 break-words',
    metric: 'min-w-0 border-l border-border px-4 py-2 break-words'
  };
</script>

<div data-settings-anchor={anchor} class={`${variantClass[variant]} ${className}`}>
  {@render children()}
</div>
