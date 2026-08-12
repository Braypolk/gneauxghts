<script lang="ts">
  import { ChevronDown, Library } from '@lucide/svelte';
  import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
  import { cn } from '$lib/utils';

  let {
    count,
    children,
    class: className
  }: { count: number; children?: import('svelte').Snippet; class?: string } = $props();
</script>

<Collapsible class={cn('mt-3', className)}>
  <CollapsibleTrigger class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
    <Library class="h-3.5 w-3.5" />
    {count} {count === 1 ? 'source' : 'sources'}
    <ChevronDown class="h-3 w-3 transition-transform in-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
  <CollapsibleContent class="mt-2 flex flex-wrap gap-1.5">
    {@render children?.()}
  </CollapsibleContent>
</Collapsible>
