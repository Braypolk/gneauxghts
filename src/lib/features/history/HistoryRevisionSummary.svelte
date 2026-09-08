<script lang="ts">
  import type { HistoryRevisionRecord } from './historyModeMachine';
  import { historySourceLabels, historyRevisionTimeSummary } from './historyTimeline';

  let { revision, isCurrentVersion = false }: {
    revision: HistoryRevisionRecord;
    isCurrentVersion?: boolean;
  } = $props();
  const source = $derived(historySourceLabels[revision.source]);
  const time = $derived(historyRevisionTimeSummary(revision));
  const title = $derived(
    revision.revisionLabel ?? (isCurrentVersion ? 'Current version' : `Version from ${time}`)
  );
  const detail = $derived(
    revision.revisionLabel && isCurrentVersion
      ? `Current version · ${source} · ${time}`
      : revision.revisionLabel
        ? `${source} · ${time}`
        : `${source}${isCurrentVersion ? ` · ${time}` : ''}`
  );
</script>

<span class="block text-xs font-medium" title={title}>
  {title}
</span>
<span class="mt-1 block text-xs leading-relaxed text-muted-foreground">{detail}</span>
