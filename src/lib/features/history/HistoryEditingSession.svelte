<script lang="ts">
  import { ChevronRight } from '@lucide/svelte';
  import {
    historyCountLabel,
    historySessionTimeSummary,
    historySourceLabels,
    type EditingSessionTimelineItem
  } from './historyTimeline';
  import HistoryRevisionSummary from './HistoryRevisionSummary.svelte';

  interface Props {
    item: EditingSessionTimelineItem;
    selectedRevisionId: string | null;
    disabled: boolean;
    expanded: boolean;
    onToggle: () => void;
    onSelectRevision: (revisionId: string) => void | Promise<void>;
  }

  let {
    item,
    selectedRevisionId,
    disabled,
    expanded,
    onToggle,
    onSelectRevision
  }: Props = $props();
</script>

<section
  class={`group rounded-2xl border transition-colors ${item.revisions.some((revision) => revision.revisionId === selectedRevisionId) ? 'border-foreground/30 bg-card shadow-sm' : 'border-border/80 bg-card/60'}`}
  data-testid={`editing-session-${item.sessionId}`}
>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-3 py-3 text-left"
    aria-expanded={expanded}
    aria-label={`${expanded ? 'Collapse' : 'Expand'} Editing Session`}
    onclick={onToggle}
  >
    <span class="min-w-0 flex-1">
      <span class="block text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Editing Session</span>
      <span class="mt-1 block text-sm font-semibold">
        {historySourceLabels[item.source]} · {historyCountLabel(item.revisions.length, 'revision')}
      </span>
      <span class="mt-1 block text-xs text-muted-foreground">
        Latest revision · {historyCountLabel(item.revisions[0].lineCount, 'line')} · {historyCountLabel(item.revisions[0].characterCount, 'character')}
      </span>
      <span class="mt-1 block text-xs text-muted-foreground">
        {historySessionTimeSummary(item.startedAtMillis, item.endedAtMillis)}
      </span>
    </span>
    <ChevronRight class={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
  </button>
  {#if expanded}
    <ol class="space-y-1 border-t border-border/70 p-2">
      {#each item.revisions as revision (revision.revisionId)}
        <li>
          <button
            type="button"
            class={`w-full rounded-xl px-3 py-2 text-left transition-colors ${selectedRevisionId === revision.revisionId ? 'bg-accent' : 'hover:bg-accent/70'}`}
            aria-pressed={selectedRevisionId === revision.revisionId}
            {disabled}
            data-revision-id={revision.revisionId}
            onclick={() => void onSelectRevision(revision.revisionId)}
          >
            <HistoryRevisionSummary {revision} />
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</section>
