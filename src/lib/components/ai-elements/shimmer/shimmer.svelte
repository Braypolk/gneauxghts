<script lang="ts">
  import { cn } from '$lib/utils';

  let {
    class: className,
    children
  }: { class?: string; children?: import('svelte').Snippet } = $props();
</script>

<span
  data-slot="shimmer"
  class={cn(
    'animate-pulse bg-gradient-to-r from-muted-foreground/45 via-foreground/80 to-muted-foreground/45 bg-[length:200%_100%] bg-clip-text text-transparent',
    className
  )}
>
  {@render children?.()}
</span>
