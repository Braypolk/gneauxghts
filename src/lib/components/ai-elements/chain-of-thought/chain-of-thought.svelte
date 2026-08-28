<script lang="ts">
  import { ChevronDown, LoaderCircle, Wrench } from '@lucide/svelte';
  import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
  import Tool from '$lib/components/ai-elements/tool/tool.svelte';
  import ToolHeader from '$lib/components/ai-elements/tool/tool-header.svelte';
  import ToolContent from '$lib/components/ai-elements/tool/tool-content.svelte';
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

  const running = $derived(
    steps.some((step) => step.status === 'running')
  );
  const completed = $derived(
    steps.filter((step) => step.status === 'success' || step.status === 'skipped').length
  );
  const total = $derived(steps.length);

  function toolState(status: Extract<ChatPart, { type: 'tool' }>['status']) {
    if (status === 'running') return 'input-available' as const;
    if (status === 'success' || status === 'skipped') return 'output-available' as const;
    return 'output-error' as const;
  }
</script>

<Collapsible bind:open class={cn('rounded-lg border border-border/70 bg-muted/15', className)}>
  <CollapsibleTrigger
    class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
    aria-label={total > 0
      ? `Activity, ${completed} of ${total} actions complete. Toggle details`
      : 'Activity summary. Toggle details'}
  >
    <Wrench class="h-3.5 w-3.5 text-muted-foreground" />
    <span>Activity</span>
    <span class="text-muted-foreground">
      {#if total > 0}{total} {total === 1 ? 'action' : 'actions'}{:else}Summary{/if}
    </span>
    {#if running}<LoaderCircle class="ml-auto h-3 w-3 animate-spin" />{:else}<span class="ml-auto"></span>{/if}
    <ChevronDown class="h-3 w-3 text-muted-foreground transition-transform in-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
  <CollapsibleContent>
    <div class="space-y-2 border-t border-border/60 px-3 py-2.5 text-xs">
      {#each steps as step (step.id)}
        <Tool class="mb-0 border-border/60 bg-background/50 shadow-none">
          <ToolHeader
            type={step.title}
            state={toolState(step.status)}
            class="p-2.5"
          />
          <ToolContent>
            <div class="space-y-1 border-t border-border/60 px-3 py-2.5 text-muted-foreground">
              {#if step.inputSummary}<p>{step.inputSummary}</p>{/if}
              {#if step.outputSummary}<p>{step.outputSummary}</p>{/if}
              {#if step.durationMillis !== undefined}
                <p class="font-mono text-[10px]">{step.durationMillis} ms</p>
              {/if}
              {#if !step.inputSummary && !step.outputSummary}
                <p>{step.status}</p>
              {/if}
            </div>
          </ToolContent>
        </Tool>
      {/each}
    </div>
  </CollapsibleContent>
</Collapsible>
