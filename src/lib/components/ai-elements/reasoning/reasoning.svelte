<script lang="ts">
  import { Brain, ChevronDown, LoaderCircle } from '@lucide/svelte';
  import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
  import { cn } from '$lib/utils';
  import Shimmer from '../shimmer/shimmer.svelte';
  import type { AgentReasoningStatus } from '$lib/features/chat/types';

  let {
    status,
    summary,
    open = false,
    class: className
  }: {
    status: AgentReasoningStatus;
    summary?: string;
    open?: boolean;
    class?: string;
  } = $props();
</script>

<Collapsible {open} class={cn('rounded-lg border border-border/70 bg-muted/15', className)}>
  <CollapsibleTrigger class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs">
    {#if status === 'running'}
      <LoaderCircle class="h-3.5 w-3.5 animate-spin" />
      <Shimmer>Reasoning</Shimmer>
    {:else}
      <Brain class="h-3.5 w-3.5 text-muted-foreground" />
      <span>Reasoning</span>
    {/if}
    <span class="ml-auto text-[10px] capitalize text-muted-foreground">{status}</span>
    <ChevronDown class="h-3 w-3 text-muted-foreground transition-transform in-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
  <CollapsibleContent class="border-t border-border/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
    {summary ?? 'Private model reasoning is not exposed. Only user-safe summaries appear here when a provider supplies one.'}
  </CollapsibleContent>
</Collapsible>
