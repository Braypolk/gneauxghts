<script lang="ts">
  import SearchNoteResult from '#lib/ui/search/SearchNoteResult.svelte';
  import SearchResultsHeading from '#lib/ui/search/SearchResultsHeading.svelte';
  import type { RelatedResult, RelatedView } from './store.svelte';
  import type { RelatedNoteItem } from '#lib/types/semantic.js';
  import { hasSplitNoteDestination } from '../navigation/splitNoteDestination';
  let { result, view = 'related', activeIndex = -1, onSelect, onPoint, onRefresh, onOpenInSplit }: {
    result: RelatedResult | null;
    view?: RelatedView;
    activeIndex?: number;
    onSelect: (item: RelatedNoteItem) => void;
    onPoint?: (index: number) => void;
    onRefresh: () => void;
    onOpenInSplit?: (item: RelatedNoteItem) => void;
  } = $props();
</script>
<div class="related-results" aria-busy={result?.isLoading ?? false}>
  <SearchResultsHeading title={view === 'backlinks' ? 'Backlinks' : 'Related'}>
    {#snippet actions()}
      <button type="button" class="mobile-touch-target shrink-0 rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
        disabled={result?.isLoading} onclick={onRefresh}>{result?.status === 'unavailable' ? 'Retry' : 'Refresh'}</button>
    {/snippet}
  </SearchResultsHeading>
  {#if result?.isLoading || result?.isStale}
    <p class="px-4 pb-2 text-xs text-muted-foreground" role="status">{result.isLoading ? (view === 'backlinks' ? 'Finding backlinks…' : 'Finding related notes…') : 'Matches may have changed. Refresh to update.'}</p>
  {/if}
  {#if result && result.items.length > 0}
    <ul class="m-0 list-none p-0">
      {#each result.items as item, index (item.noteId ?? item.notePath)}
        <li>
          <SearchNoteResult title={item.noteTitle} label={`Open ${view === 'backlinks' ? 'backlink' : 'related note'}: ${item.noteTitle}`}
            onOpenInSplit={onOpenInSplit && hasSplitNoteDestination(item) ? () => onOpenInSplit?.(item) : undefined}
            active={index === activeIndex} onPoint={() => onPoint?.(index)} onFocus={() => onPoint?.(index)} onSelect={() => onSelect(item)}>
            {#snippet detail()}
              {#if item.sectionLabel && item.sectionLabel !== 'Title'}<span class="block max-w-full truncate text-xs text-muted-foreground">{item.sectionLabel}</span>{/if}
              <span class="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{item.excerpt}</span>
            {/snippet}
          </SearchNoteResult>
        </li>
      {/each}
    </ul>
  {:else if result && !result.isLoading}
    <p class="px-4 py-5 text-sm leading-6 text-muted-foreground" role="status">{result.reason ?? 'No clear matches yet.'}</p>
  {/if}
  {#if result?.status === 'unavailable' && result.items.length > 0}
    <p class="px-4 py-2 text-xs text-muted-foreground" role="status">{result.reason} Showing previous matches.</p>
  {/if}
</div>
