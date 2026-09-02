<script lang="ts">
  import type { HistoryRevisionRecord } from './historyModeMachine';
  import {
    formatHistoryTime,
    historyRevisionSummary,
    historyRevisionTimeSummary
  } from './historyTimeline';

  interface Props {
    revision: HistoryRevisionRecord;
    emphasis?: 'compact' | 'prominent';
  }

  let { revision, emphasis = 'compact' }: Props = $props();
</script>

<span class={`block ${emphasis === 'prominent' ? 'text-sm font-semibold' : 'text-xs font-medium'}`}>
  {historyRevisionSummary(revision)}
</span>
<span class="mt-1 block text-xs text-muted-foreground">{historyRevisionTimeSummary(revision)}</span>
{#if revision.modifiedAtMillis !== null}
  <span class="mt-1 block text-[0.68rem] text-muted-foreground">
    File timestamp {formatHistoryTime(revision.modifiedAtMillis)} (untrusted)
  </span>
{/if}
