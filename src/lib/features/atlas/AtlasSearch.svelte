<script lang="ts">
  import { Focus } from '@lucide/svelte';
  import SearchBar from '#lib/ui/search/SearchBar.svelte';
  import SearchDock from '#lib/ui/search/SearchDock.svelte';
  import type { AtlasStore } from './atlasStore.svelte';

  let { atlas, fitMap }: { atlas: AtlasStore; fitMap: () => void } = $props();
</script>

<SearchDock pageInset class="atlas-search-dock">
  <SearchBar class="atlas-search-bar" value={atlas.searchQuery} placeholder="Filter map nodes" ariaLabel="Search map notes"
    shortcut={{ enabled: true }} onValueChange={(value) => atlas.setSearchQuery(value)}>
    <div class="contents" data-search-focus-independent>
      <button type="button" class="shared-search-control mobile-dense-touch-target" onclick={fitMap} aria-label="Fit map to view" title="Fit view"><Focus class="h-4 w-4" /></button>
    </div>
  </SearchBar>
</SearchDock>

<style>
  :global(.atlas-surface .atlas-search-bar > svg) { display: block; }
</style>
