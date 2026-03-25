<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import GraphView from '$lib/components/graph/GraphView.svelte';
  import GraphToolbar from '$lib/components/graph/GraphToolbar.svelte';
  import type { GraphData } from '$lib/types/graph';

  let graphData = $state<GraphData | null>(null);
  let isLoading = $state(true);
  let errorMessage = $state('');

  let searchQuery = $state('');
  let zoomLevel = $state(1);
  let scrubberActive = $state(false);
  let timeFilterRange = $state<[number, number] | null>(null);
  let colorGroupCount = $state(4);

  let graphViewRef = $state<GraphView | null>(null);

  async function loadGraphData() {
    isLoading = true;
    errorMessage = '';
    try {
      graphData = await invoke<GraphData>('get_graph_data', { colorGroupCount });
    } catch (err) {
      errorMessage = String(err);
    } finally {
      isLoading = false;
    }
  }

  function handleFitAll() {
    graphViewRef?.fitAll();
  }

  function handleToggleScrubber() {
    scrubberActive = !scrubberActive;
    if (!scrubberActive) {
      timeFilterRange = null;
    }
  }

  function waitForNextPaint(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  onMount(() => {
    void (async () => {
      await tick();
      await waitForNextPaint();
      await waitForNextPaint();
      await loadGraphData();
    })();
  });
</script>

<div class="flex h-full flex-col gap-0 overflow-hidden">
  <div class="shrink-0 px-1 pt-1 pb-2">
    <GraphToolbar
      {searchQuery}
      onSearchChange={(q) => (searchQuery = q)}
      {zoomLevel}
      onFitAll={handleFitAll}
      {scrubberActive}
      onToggleScrubber={handleToggleScrubber}
      {colorGroupCount}
      onColorGroupCountChange={(count) => {
        colorGroupCount = count;
        void loadGraphData();
      }}
      timeRange={graphData?.timeRange ?? [0, 0]}
      {timeFilterRange}
      onTimeFilterChange={(range) => (timeFilterRange = range)}
    />
  </div>

  <div class="relative flex-1 min-h-0 overflow-hidden rounded-lg border border-border/80 bg-card/50">
    {#if isLoading}
      <div class="flex h-full items-center justify-center">
        <p class="text-sm text-muted-foreground">Loading graph...</p>
      </div>
    {:else if errorMessage}
      <div class="flex h-full flex-col items-center justify-center gap-3 px-4">
        <p class="text-sm text-muted-foreground">Unable to load the graph view.</p>
        <p class="max-w-md text-center text-xs text-muted-foreground/70">{errorMessage}</p>
        <button
          onclick={() => void loadGraphData()}
          class="mt-2 rounded-lg border border-border/80 bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent"
        >
          Retry
        </button>
      </div>
    {:else if graphData && graphData.nodes.length > 0}
      <GraphView
        bind:this={graphViewRef}
        data={graphData}
        {searchQuery}
        {zoomLevel}
        onZoomChange={(z) => (zoomLevel = z)}
        {timeFilterRange}
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
