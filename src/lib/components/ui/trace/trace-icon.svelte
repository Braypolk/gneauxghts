<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let { ref = $bindable(null), class: className, children, ...restProps }: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props();
</script>

<span bind:this={ref} data-slot="trace-icon" aria-hidden="true" class={cn('flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:size-3.5', className)} {...restProps}>
  {@render children?.()}
</span>
