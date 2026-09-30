<script lang="ts">
  import { ChevronDown, LoaderCircle, Wrench } from '@lucide/svelte';
  import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
  import { cn } from '$lib/utils';
  import type { ChatPart } from '$lib/features/chat/types';

  type Step = Extract<ChatPart, { type: 'tool' }>;
  let {
    steps,
    open = $bindable(false),
    class: className
  }: {
    steps: Step[];
    open?: boolean;
    class?: string;
  } = $props();

  const active = $derived(steps.findLast((step) => step.status === 'running'));
  const completed = $derived(
    steps.filter((step) => step.status === 'success' || step.status === 'skipped').length
  );
  const failed = $derived(steps.filter((step) => step.status === 'error' || step.status === 'denied').length);
  const total = $derived(steps.length);
  const expandable = $derived(total > 1 || steps.some((step) => details(step).length > 0));
  const title = $derived(active?.title ?? (total === 1 ? steps[0].title : 'Activity'));

  function statusLabel(status: Step['status']) {
    return { running: 'Running', success: 'Completed', error: 'Failed', denied: 'Denied', skipped: 'Skipped' }[status];
  }

  function details(step: Step) {
    const redundant = new Set([step.title, step.status, statusLabel(step.status)].map((text) => text.toLowerCase()));
    return [...new Set([step.inputSummary, step.outputSummary]
      .map((text) => text?.trim())
      .filter((text): text is string => typeof text === 'string' && text.length > 0 && !redundant.has(text.toLowerCase())))];
  }
</script>

{#snippet summary()}
  {#if active}
    <LoaderCircle class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
  {:else}
    <Wrench class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
  {/if}
  <span class="min-w-0 flex-1">{title}</span>
  <span class="shrink-0 text-muted-foreground">
    {#if total === 1}{statusLabel(steps[0].status)}{:else}{total} actions{#if failed > 0} · {failed} failed{/if}{/if}
  </span>
{/snippet}

{#if expandable}
  <Collapsible bind:open class={cn('text-xs', className)}>
    <CollapsibleTrigger
      class="flex w-full items-center gap-2 rounded-md py-1.5 text-left hover:bg-muted/30"
      aria-label={`Activity, ${completed} of ${total} actions complete. Toggle details`}
    >
      {@render summary()}
      <ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground transition-transform in-data-[state=open]:rotate-180" aria-hidden="true" />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ol class="ml-1.5 space-y-3 border-l border-border/60 py-2 pl-4">
        {#each steps as step (step.id)}
          <li class="space-y-1">
            {#if total > 1}
              <div class="flex items-start justify-between gap-3">
                <span>{step.title}</span>
                <span class="shrink-0 text-muted-foreground">{statusLabel(step.status)}</span>
              </div>
            {/if}
            {#each details(step) as detail}
              <p class="whitespace-pre-wrap break-words text-muted-foreground">{detail}</p>
            {/each}
          </li>
        {/each}
      </ol>
    </CollapsibleContent>
  </Collapsible>
{:else}
  <div class={cn('flex items-center gap-2 py-1.5 text-xs', className)}>
    {@render summary()}
  </div>
{/if}
