<script lang="ts">
  import { CheckCircle2, ChevronDown, Circle, LoaderCircle, Wrench } from '@lucide/svelte';
  import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
  import { cn } from '$lib/utils';
  import type { ChatPart } from '$lib/features/chat/types';

  let {
    steps,
    open = $bindable(false),
    class: className
  }: {
    steps: Array<Extract<ChatPart, { type: 'tool' }>>;
    open?: boolean;
    class?: string;
  } = $props();

  const running = $derived(steps.some((step) => step.status === 'running'));
  const completed = $derived(
    steps.filter((step) => step.status === 'success' || step.status === 'skipped').length
  );
</script>

<Collapsible bind:open class={cn('rounded-lg border border-border/70 bg-muted/15', className)}>
  <CollapsibleTrigger
    class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
    aria-label={`Activity, ${completed} of ${steps.length} steps complete. Toggle details`}
  >
    <Wrench class="h-3.5 w-3.5 text-muted-foreground" />
    <span>Activity</span>
    <span class="text-muted-foreground">{steps.length} {steps.length === 1 ? 'step' : 'steps'}</span>
    {#if running}<LoaderCircle class="ml-auto h-3 w-3 animate-spin" />{:else}<span class="ml-auto"></span>{/if}
    <ChevronDown class="h-3 w-3 text-muted-foreground transition-transform in-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
  <CollapsibleContent>
    <ol class="space-y-2 border-t border-border/60 px-3 py-2.5 text-xs">
      {#each steps as step (step.id)}
        <li class="flex items-start gap-2">
          {#if step.status === 'running'}
            <LoaderCircle class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
          {:else if step.status === 'success' || step.status === 'skipped'}
            <CheckCircle2 class="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {:else}
            <Circle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          {/if}
          <span>{step.title}</span>
          <span class="sr-only">{step.status}</span>
        </li>
      {/each}
    </ol>
  </CollapsibleContent>
</Collapsible>
