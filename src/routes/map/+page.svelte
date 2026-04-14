<script lang="ts">
  import { onMount } from 'svelte';
  import GraphView from '$lib/features/graph/GraphView.svelte';
  import GraphToolbar from '$lib/features/graph/GraphToolbar.svelte';
  import { createMapStore } from '$lib/features/graph/mapStore';

  let graphViewRef = $state<GraphView | null>(null);
  const mapStore = createMapStore();

  function handleFitAll() {
    graphViewRef?.fitAll();
  }

  onMount(() => {
    mapStore.initialize();
    return () => {
      mapStore.dispose();
    };
  });
</script>

<div class="flex h-full flex-col gap-0 overflow-hidden">
  <div class="shrink-0 px-1 pt-1 pb-2">
    <GraphToolbar
      searchQuery={$mapStore.searchQuery}
      onSearchChange={(q) => mapStore.setSearchQuery(q)}
      zoomLevel={$mapStore.zoomLevel}
      onFitAll={handleFitAll}
      scrubberActive={$mapStore.scrubberActive}
      onToggleScrubber={mapStore.toggleScrubber}
      colorGroupCount={$mapStore.colorGroupCount}
      onColorGroupCountChange={(count) => mapStore.setColorGroupCount(count)}
      timeRange={$mapStore.graphData?.timeRange ?? [0, 0]}
      timeFilterRange={$mapStore.timeFilterRange}
      onTimeFilterChange={(range) => mapStore.setTimeFilterRange(range)}
    />
  </div>

  <div class="relative flex-1 min-h-0 overflow-hidden rounded-lg border border-border/80 bg-card/50">
    {#if $mapStore.isLoading}
      <div class="flex h-full items-center justify-center">
        <p class="text-sm text-muted-foreground">Loading graph...</p>
      </div>
    {:else if $mapStore.waitingMessage}
      <div class="flex h-full flex-col items-center justify-center gap-3 px-4">
        <p class="text-sm text-muted-foreground">Waiting for the embedding model to finish loading.</p>
        <p class="max-w-md text-center text-xs text-muted-foreground/70">
          Map clustering waits until the semantic model is fully ready so the app does not freeze on first load.
        </p>
        <p class="max-w-md text-center text-xs text-muted-foreground/70">{$mapStore.waitingMessage}</p>
      </div>
    {:else if $mapStore.errorMessage}
      <div class="flex h-full flex-col items-center justify-center gap-3 px-4">
        <p class="text-sm text-muted-foreground">Unable to load the graph view.</p>
        <p class="max-w-md text-center text-xs text-muted-foreground/70">{$mapStore.errorMessage}</p>
        <button
          onclick={mapStore.retry}
          class="mt-2 rounded-lg border border-border/80 bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent"
        >
          Retry
        </button>
      </div>
    {:else if $mapStore.graphData && $mapStore.graphData.nodes.length > 0}
      <GraphView
        bind:this={graphViewRef}
        data={$mapStore.graphData}
        searchQuery={$mapStore.searchQuery}
        onZoomChange={(z) => mapStore.setZoomLevel(z)}
        timeFilterRange={$mapStore.timeFilterRange}
      />
    {:else}
      <div class="flex h-full flex-col items-center justify-center gap-2 px-4">
        <p class="text-sm text-muted-foreground">No notes indexed yet.</p>
        <p class="max-w-sm text-center text-xs text-muted-foreground/70">
          The graph view requires semantic indexing to be enabled and at least a few notes to be indexed.
          Check Settings to configure semantic search.
        </p>
      </div>
    {/if}
  </div>
</div>
