<script lang="ts">
  import { BookOpen, Search, Wrench, Brain } from '@lucide/svelte';
  import * as Trace from '$lib/components/ui/trace';
  import { activitySummary, formatToolValue, toolCommitWarning, toolFailed, toolLabel, toolOutput, toolStatus, toolSubject, type ActivityGroup } from './piActivity';
  let { group, generationStatus }: { group: ActivityGroup; generationStatus?: string } = $props();
  const tools = $derived(group.items.filter(item => item.kind === 'tool'));
  const failures = $derived(tools.filter(toolFailed).length);
  const running = $derived(tools.some(tool => ['Running', 'Pending'].includes(toolStatus(tool))));
  const appliedBeforeStop = $derived(tools.filter(tool => tool.publication && tool.result?.isError));
  let open = $state(false);
  const headerProgress = $derived(!running && generationStatus && (!open || generationStatus !== 'Thinking') ? generationStatus : undefined);
</script>

{#snippet reasoning(text: string, streaming: boolean, latest: boolean, bounded = false)}
  <Trace.Collapsible data-testid="pi-reasoning" data-streaming={streaming}>
    <Trace.CollapsibleTrigger class="w-fit">
      <Trace.Line class="w-auto" status={latest && streaming && generationStatus === 'Thinking' ? 'running' : undefined}>
        <Trace.Icon><Brain /></Trace.Icon>
        <Trace.Title>{latest && streaming && generationStatus === 'Thinking' ? 'Thinking…' : 'Reasoning'}</Trace.Title>
      </Trace.Line>
    </Trace.CollapsibleTrigger>
    <Trace.CollapsibleContent>
      {#if bounded}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scroll region needs keyboard access.) -->
        <div class="activity-scroll" role="region" aria-label="Reasoning" tabindex="0" data-testid="pi-reasoning-scroll" onwheel={event => event.stopPropagation()}><pre>{text}</pre></div>
      {:else}<pre>{text}</pre>{/if}
    </Trace.CollapsibleContent>
  </Trace.Collapsible>
{/snippet}

<Trace.Root class="my-4 text-[.82rem]">
  {#if tools.length === 0}
    {#each group.items as item (item.key)}{#if item.kind === 'reasoning'}{@render reasoning(item.text, item.streaming, item === group.items.at(-1), true)}{/if}{/each}
  {:else}
    <Trace.Collapsible bind:open data-testid="pi-tool-activity">
      <Trace.CollapsibleTrigger class="w-fit">
        <Trace.Line class="w-auto" status={headerProgress || running && !open ? 'running' : failures ? 'error' : undefined}>
          <Trace.Icon>{#if headerProgress === 'Thinking'}<Brain />{:else}<Wrench />{/if}</Trace.Icon>
          <Trace.Title data-testid={headerProgress ? 'pi-tool-generation-status' : undefined}>{headerProgress ? `${headerProgress}…` : running && open ? 'Tool activity' : activitySummary(group.items)}</Trace.Title>
          {#if failures}<span class="activity-failure">{failures} failed</span>{/if}
        </Trace.Line>
      </Trace.CollapsibleTrigger>
      <Trace.CollapsibleContent>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scroll region needs keyboard access.) -->
        <div class="activity-scroll" role="region" aria-label="Tool activity" tabindex="0" data-testid="pi-tool-activity-scroll" onwheel={event => event.stopPropagation()}>
          <Trace.Root>
            {#each group.items as item (item.key)}
              {#if item.kind === 'reasoning'}{@render reasoning(item.text, item.streaming, item === group.items.at(-1))}
              {:else}
                {@const status = toolStatus(item)}
                {@const subject = toolSubject(item)}
                {@const output = toolOutput(item)}
                <Trace.Collapsible data-testid="pi-tool-result" data-error={toolFailed(item)} data-tool-call-id={item.key}>
                  <Trace.CollapsibleTrigger class="w-fit">
                    <Trace.Line class="w-auto" status={toolFailed(item) ? 'error' : status === 'Running' ? 'running' : status === 'Pending' ? 'pending' : undefined}>
                      <Trace.Icon>{#if item.name === 'search_notes'}<Search />{:else if item.name === 'read_note'}<BookOpen />{:else}<Wrench />{/if}</Trace.Icon>
                      <Trace.Title><span class="tool-description"><span>{toolLabel(item)}</span>{#if subject}<span class="tool-subject" title={subject}>{subject}</span>{/if}</span></Trace.Title>
                      {#if status !== 'Complete'}<span class="tool-status" data-running={status === 'Running'}>{status}</span>{/if}
                    </Trace.Line>
                  </Trace.CollapsibleTrigger>
                  <Trace.CollapsibleContent>
                    <div class="tool-detail">
                      <p class="detail-label">{item.name}</p>
                      {#if item.arguments}<p class="detail-label">Arguments</p><pre>{formatToolValue(item.arguments)}</pre>{/if}
                      {#if output}<p class="detail-label">Output</p><pre>{output}</pre>{/if}
                      {#if item.result?.details ?? item.live?.details}<p class="detail-label">Details</p><pre>{formatToolValue(item.result?.details ?? item.live?.details)}</pre>{/if}
                      {#each item.live?.diagnostics ?? [] as diagnostic}<p>{diagnostic.severity}: {diagnostic.message}</p>{/each}
                    </div>
                  </Trace.CollapsibleContent>
                </Trace.Collapsible>
              {/if}
            {/each}
          </Trace.Root>
        </div>
      </Trace.CollapsibleContent>
    </Trace.Collapsible>
  {/if}
</Trace.Root>
{#each appliedBeforeStop as tool (tool.key)}
  <p role="status" class="edit-notice" data-testid="pi-edit-applied">{tool.name === 'create_note' ? 'Note created before the response stopped.' : 'Edit applied before the response stopped.'}</p>
{/each}
{#each tools as tool (tool.key)}
  {@const warning = toolCommitWarning(tool)}
  {#if warning}<p role="status" class="edit-notice" data-testid="pi-edit-warning">{tool.name === 'create_note' ? 'Note created.' : 'Edit saved.'} {warning}</p>{/if}
{/each}

<style>
  .edit-notice { margin-block: .5rem; font-size: .85rem; }
  .activity-scroll { max-height: min(22rem, 45dvh); overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; margin-top: .35rem; padding: .25rem .5rem .25rem .75rem; border-left: 1px solid var(--border); }
  .activity-scroll:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
  .tool-description { display: flex; gap: .4rem; min-width: 0; }
  .tool-description > span:first-child { flex-shrink: 0; }
  .tool-subject { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: .7; }
  .tool-status { flex-shrink: 0; font-size: .7rem; }
  [data-running='true'] { color: var(--foreground); }
  .activity-failure { flex-shrink: 0; color: var(--destructive); }
  .tool-detail { padding: .4rem 0 .5rem 1.45rem; }
  .detail-label { margin-top: .5rem; font-size: .72rem; font-weight: 600; }
  pre { margin-block: .4rem; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-mono, monospace); font-size: .75rem; line-height: 1.6; }
  @media (max-width: 480px) { .tool-description { display: block; } .tool-subject { display: block; } }
</style>
