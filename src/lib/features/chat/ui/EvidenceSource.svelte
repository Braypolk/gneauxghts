<script lang="ts">
  import InlineCitation from '$lib/components/ai-elements/inline-citation/inline-citation.svelte';
  import { formatHistoryTime, historyIntervalTimeSummary } from '$lib/features/history/historyTimeline';
  import type { ChatCitation } from '../types';
  import type { RevisionTimeEvidence } from '$lib/types/history';

  let { citation, index, href, onOpen }: {
    citation: ChatCitation;
    index: number;
    href?: string;
    onOpen?: () => void | Promise<void>;
  } = $props();

  function timeLabel(time: RevisionTimeEvidence) {
    switch (time.kind) {
      case 'knownSince': return `Known since ${formatHistoryTime(time.knownSinceMillis)}; introduction date unknown`;
      case 'committed': return `Recorded ${formatHistoryTime(time.committedAtMillis)}`;
      case 'observed': return `Observed ${formatHistoryTime(time.observedAtMillis)}`;
      case 'editingWindow': return time.clockDiscontinuity
        ? 'Recorded timing is uncertain (clock changed)'
        : `Recorded changes ${historyIntervalTimeSummary(time.firstWallMillis, time.lastWallMillis)}`;
    }
  }
  const historical = $derived(citation.kind === 'note' ? citation.passage?.historical : undefined);
  const label = $derived(citation.kind === 'web' ? 'Web source'
    : historical ? `Historical ${historical.changeKind === 'removed' ? 'removal' : 'addition'} · not current status`
    : citation.revision ? 'Retained revision · not current status'
    : citation.passage ? 'Current note passage' : 'Note context');
  const excerpt = $derived(citation.kind === 'note'
    ? citation.passage?.excerpt ?? citation.revision?.currentExcerpt ?? citation.excerpt
    : citation.excerpt);
  const times = $derived(historical ? [timeLabel(historical.timeEvidence)]
    : citation.kind === 'note' && citation.passage
      ? [...new Set(citation.passage.revisions.flatMap(revision => revision.timeEvidence ? [timeLabel(revision.timeEvidence)] : []))]
      : []);
</script>

<section class="rounded-md border border-border/70 bg-muted/15 p-3" aria-label={`Evidence from ${citation.label}`}>
  <InlineCitation {citation} {index} {href} {onOpen} />
  <p class="mt-1 text-xs text-muted-foreground">{label}</p>
  {#each times as time}<p class="text-xs text-muted-foreground">{time}</p>{/each}
  {#if excerpt}
    <blockquote class="mt-2 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm">{excerpt}</blockquote>
  {/if}
</section>
