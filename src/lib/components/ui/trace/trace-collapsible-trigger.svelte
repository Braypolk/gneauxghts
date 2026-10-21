<script lang="ts">
  import * as Collapsible from '#lib/components/ui/collapsible/index.js';
  import { ChevronRight } from '@lucide/svelte';
  import { cn, type WithoutChild } from '#lib/utils.js';
  import TraceIcon from './trace-icon.svelte';
  import type { Collapsible as CollapsiblePrimitive } from 'bits-ui';

  let { ref = $bindable(null), class: className, children, ...restProps }: WithoutChild<CollapsiblePrimitive.TriggerProps> = $props();
</script>

<Collapsible.Trigger bind:ref data-slot="trace-collapsible-trigger" class={cn('group/trace-trigger flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', className)} {...restProps}>
  {@render children?.()}
  <TraceIcon class="ml-auto transition-transform group-aria-expanded/trace-trigger:rotate-90 motion-reduce:transition-none"><ChevronRight /></TraceIcon>
</Collapsible.Trigger>
