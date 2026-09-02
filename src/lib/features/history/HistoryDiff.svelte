<script lang="ts">
  import { ImageOff } from '@lucide/svelte';
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
        ? 'Compared with previous revision'
        : 'Compared with empty beginning'
      : 'Compared with current note'
  );

</script>

<section aria-label="Revision diff" data-testid="historical-revision-diff">
  <p class="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
    {comparisonLabel}
  </p>

  {#if diff.missingAssets.length > 0}
    <div
      class="mb-4 flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
      role="status"
      data-testid="historical-missing-assets"
    >
      <ImageOff class="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
      <p>
        Binary assets are not stored in Note Timeline history. Missing now:
        <span class="font-medium">{diff.missingAssets.join(', ')}</span>
      </p>
    </div>
  {/if}

  {#if propertiesChanged}
    <details class="mb-5 rounded-2xl border border-border bg-muted/30 px-4 py-3">
      <summary class="cursor-pointer text-sm font-medium">Properties</summary>
      <div class="mt-3">
        <HistoryDiffLines lines={diff.propertiesLines} compact />
      </div>
    </details>
  {/if}

  {#if bodyChanged}
    <HistoryDiffLines lines={diff.bodyLines} ariaLabel="Authored body changes" />
  {:else}
    <div class="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
      No authored body changes in this comparison.
    </div>
  {/if}
</section>
