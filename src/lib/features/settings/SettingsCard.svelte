<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'summary' | 'metric';

  let {
    variant = 'summary',
    class: className = '',
    children
  }: {
    variant?: Variant;
    class?: string;
    children: Snippet;
  } = $props();

  const variantClass: Record<Variant, string> = {
    summary: 'rounded-3xl border border-border/70 bg-background/70 px-5 py-4',
    metric: 'rounded-2xl border border-border/70 bg-card/70 px-4 py-3'
  };
</script>

<div class={`${variantClass[variant]} ${className}`}>
  {@render children()}
</div>
