<script lang="ts">
  import { ImageOff } from '@lucide/svelte';
  import { historyDiffSummary } from './historyTimeline';
  import HistoryDiffLines from './HistoryDiffLines.svelte';
  import type { HistoricalDiff } from './historyModeMachine';

  interface Props {
    diff: HistoricalDiff;
  }

  let { diff }: Props = $props();

  const bodyChanged = $derived(diff.bodyLines.some((line) => line.kind !== 'context'));
  const propertiesChanged = $derived(
    diff.propertiesLines.some((line) => line.kind !== 'context')
  );
  const comparisonLabel = $derived(
    diff.comparison === 'parent'
      ? diff.fromRevisionId
        ? 'Changes in this version'
        : 'Changes from the beginning'
      : 'Changes since this version'
  );

</script>

<section aria-label="Revision diff" data-testid="historical-revision-diff">
  <p class="mb-2 text-xs text-muted-foreground">
    {comparisonLabel}
  </p>

  <p class="mb-5 text-sm" data-testid="history-net-summary">{historyDiffSummary(diff)}</p>

  {#if diff.missingAssets.length > 0}
    <div
      class="mb-5 flex gap-2 text-xs text-muted-foreground"
      role="status"
      data-testid="historical-missing-assets"
    >
      <ImageOff class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <p>
        Binary assets are not stored in Note Timeline history. Missing now:
        <span class="font-medium">{diff.missingAssets.join(', ')}</span>
      </p>
    </div>
  {/if}

  {#if propertiesChanged}
    <details class="mb-5 border-b border-border/60 pb-3">
      <summary class="cursor-pointer text-sm font-medium">Properties</summary>
      <div class="mt-3">
        <HistoryDiffLines lines={diff.propertiesLines} compact />
      </div>
    </details>
  {/if}

  {#if bodyChanged}
    <HistoryDiffLines lines={diff.bodyLines} ariaLabel="Authored body changes" />
  {:else}
    <div class="py-12 text-center text-sm text-muted-foreground">
      No authored body changes in this comparison.
    </div>
  {/if}
</section>
