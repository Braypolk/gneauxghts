<script lang="ts">
  import type { HistoryRevisionRecord } from './historyModeMachine';
  import { historySourceLabels, historyRevisionTimeSummary } from './historyTimeline';

  let { revision }: { revision: HistoryRevisionRecord } = $props();
  const source = $derived(revision.timeKind === 'editingWindow' ? 'Editing Window · Editor' : historySourceLabels[revision.source]);
</script>

<span class="block truncate text-xs font-medium" title={source}>
  {revision.revisionLabel ?? source}
</span>
<span class="mt-1 block text-xs leading-relaxed text-muted-foreground">{historyRevisionTimeSummary(revision)}</span>
