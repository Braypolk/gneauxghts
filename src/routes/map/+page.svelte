<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import GraphView from '$lib/features/graph/GraphView.svelte';
  import GraphToolbar from '$lib/features/graph/GraphToolbar.svelte';
  import type { GraphData } from '$lib/types/graph';
  import type { SemanticStatus } from '$lib/types/semantic';

  let graphData = $state<GraphData | null>(null);
  let isLoading = $state(true);
  let errorMessage = $state('');
  let waitingMessage = $state('');

  let searchQuery = $state('');
  let zoomLevel = $state(1);
  let scrubberActive = $state(false);
  let timeFilterRange = $state<[number, number] | null>(null);
  let colorGroupCount = $state(4);
  let activeLoadRequest = 0;
  let semanticPollTimer: ReturnType<typeof window.setInterval> | null = null;

  let graphViewRef = $state<GraphView | null>(null);
  const SEMANTIC_POLL_INTERVAL_MS = 1500;

  function stopSemanticPolling() {
    if (semanticPollTimer) {
      window.clearInterval(semanticPollTimer);
      semanticPollTimer = null;
    }
  }

  function semanticWaitReason(status: SemanticStatus) {
    if (!status.platformSupported || !status.settings.semanticSearchEnabled || status.indexedNotes === 0) {
      return null;
    }
    if (!status.model.loading || status.model.ready) {
      return null;
    }
    return status.model.status || 'Preparing the embedding model for the map view.';
  }

  function semanticBlockReason(status: SemanticStatus) {
    if (!status.platformSupported) {
      return status.disabledReason ?? 'Semantic search is unavailable on this platform.';
    }
    if (!status.settings.semanticSearchEnabled) {
      return 'Enable semantic search in Settings before opening the map.';
    }
    if (status.indexedNotes === 0) {
      return null;
    }
    if (status.model.ready || status.model.loading) {
      return null;
    }
    return status.lastError ?? status.model.error ?? status.model.status;
  }

  async function refreshSemanticGate(requestId: number) {
    const status = await invoke<SemanticStatus>('get_semantic_status');
    if (requestId !== activeLoadRequest) {
      return false;
    }

    const nextWaitReason = semanticWaitReason(status);
    if (nextWaitReason) {
      graphData = null;
      errorMessage = '';
      waitingMessage = nextWaitReason;
      isLoading = false;
      startSemanticPolling();
      return false;
    }

    const nextBlockReason = semanticBlockReason(status);
    if (nextBlockReason) {
      graphData = null;
      waitingMessage = '';
      errorMessage = nextBlockReason;
      isLoading = false;
      stopSemanticPolling();
      return false;
    }

    waitingMessage = '';
    stopSemanticPolling();
    return true;
  }

  function startSemanticPolling() {
    if (semanticPollTimer) {
      return;
    }

    semanticPollTimer = window.setInterval(() => {
      const requestId = activeLoadRequest;
      void (async () => {
        try {
          const isReady = await refreshSemanticGate(requestId);
          if (isReady && requestId === activeLoadRequest) {
            await loadGraphData();
          }
        } catch (err) {
          if (requestId !== activeLoadRequest) {
            return;
          }
          waitingMessage = '';
          errorMessage = String(err);
          isLoading = false;
          stopSemanticPolling();
        }
      })();
    }, SEMANTIC_POLL_INTERVAL_MS);
  }

  async function loadGraphData() {
    const requestId = ++activeLoadRequest;
    isLoading = true;
    errorMessage = '';
    waitingMessage = '';
    try {
      const isReady = await refreshSemanticGate(requestId);
      if (requestId !== activeLoadRequest || !isReady) {
        return;
      }

      const nextGraphData = await invoke<GraphData>('get_graph_data', { colorGroupCount });
      if (requestId !== activeLoadRequest) {
        return;
      }

      graphData = nextGraphData;
    } catch (err) {
      if (requestId !== activeLoadRequest) {
        return;
      }

      graphData = null;
      const message = String(err);
      if (message.includes('Map calculations are waiting for the embedding model to finish loading.')) {
        errorMessage = '';
        waitingMessage = message;
        startSemanticPolling();
      } else {
        errorMessage = message;
      }
    } finally {
      if (requestId === activeLoadRequest) {
        isLoading = false;
      }
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

  function handleColorGroupCountChange(count: number) {
    if (count === colorGroupCount) {
      return;
    }

    colorGroupCount = count;
    void loadGraphData();
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

    return () => {
      stopSemanticPolling();
    };
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
      onColorGroupCountChange={handleColorGroupCountChange}
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
    {:else if waitingMessage}
      <div class="flex h-full flex-col items-center justify-center gap-3 px-4">
        <p class="text-sm text-muted-foreground">Waiting for the embedding model to finish loading.</p>
        <p class="max-w-md text-center text-xs text-muted-foreground/70">
          Map clustering waits until the semantic model is fully ready so the app does not freeze on first load.
        </p>
        <p class="max-w-md text-center text-xs text-muted-foreground/70">{waitingMessage}</p>
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
