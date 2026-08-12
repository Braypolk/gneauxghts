<script lang="ts">
  import { CheckCircle2, Circle, LoaderCircle } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import type { AgentPlanEntry } from '$lib/features/chat/types';

  let { entry, class: className }: { entry: AgentPlanEntry; class?: string } = $props();
</script>

<li data-slot="task" class={cn('flex items-start gap-2', className)}>
  {#if entry.status === 'completed'}
    <CheckCircle2 class="mt-0.5 h-3.5 w-3.5 shrink-0" />
  {:else if entry.status === 'inProgress'}
    <LoaderCircle class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
  {:else}
    <Circle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  {/if}
  <span class="min-w-0" class:text-muted-foreground={entry.status === 'pending'}>
    <span class="block">{entry.text}</span>
    {#if entry.detail}<span class="mt-0.5 block text-[11px] text-muted-foreground">{entry.detail}</span>{/if}
  </span>
</li>
