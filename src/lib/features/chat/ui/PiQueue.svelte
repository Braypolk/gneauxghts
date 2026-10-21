<script lang="ts">
  import { Circle, ListTodo, X } from '@lucide/svelte';
  import * as Trace from '#lib/components/ui/trace/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import type { InboxState, SubmissionId } from '@earendil-works/pi-durable';

  let { inbox, disabled = false, onWithdraw }: { inbox: InboxState; disabled?: boolean; onWithdraw: (id: SubmissionId) => void } = $props();
  // Pi's inbox is the only queue. This filtered list is disposable presentation.
  const queued = $derived(inbox.items.filter(item => item.mode !== 'write'));
</script>

{#if queued.length}
  <section aria-label="Queued messages" data-testid="pi-queue" class="mb-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
    <Trace.Root class="text-xs">
      <Trace.Collapsible open>
        <Trace.CollapsibleTrigger aria-label="Queued messages">
          <Trace.Line><Trace.Icon><ListTodo /></Trace.Icon><Trace.Title>{queued.length} queued {queued.length === 1 ? 'message' : 'messages'}</Trace.Title></Trace.Line>
        </Trace.CollapsibleTrigger>
        <Trace.CollapsibleContent>
          <ul aria-label="Pending messages" class="mt-1 max-h-40 overflow-y-auto overscroll-contain">
            {#each queued as item (item.id)}
              {@const text = typeof item.content === 'string' ? item.content : item.content.filter(block => block.type === 'text').map(block => block.text).join('\n')}
              <li class="flex min-w-0 items-start gap-2" data-submission-id={String(item.id)}>
                <Trace.Line class="min-w-0 flex-1 items-start py-1">
                  <Trace.Icon class="mt-0.5"><Circle /></Trace.Icon>
                  <Trace.Title class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</Trace.Title>
                </Trace.Line>
                <Button variant="ghost" size="icon-sm" class="shrink-0" aria-label="Withdraw queued message" title="Withdraw queued message" {disabled} onclick={() => onWithdraw(item.id)}><X aria-hidden="true" /></Button>
              </li>
            {/each}
          </ul>
        </Trace.CollapsibleContent>
      </Trace.Collapsible>
    </Trace.Root>
  </section>
{/if}
