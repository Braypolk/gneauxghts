import { invoke } from '@tauri-apps/api/core';
import { get, writable } from 'svelte/store';
import type { GraphData, GraphDataMetadata } from '$lib/types/graph';
import type { SemanticStatus } from '$lib/types/semantic';

const SEMANTIC_POLL_INTERVAL_MS = 1500;

export interface MapState {
  graphData: GraphData | null;
  isLoading: boolean;
  errorMessage: string;
  waitingMessage: string;
  searchQuery: string;
  zoomLevel: number;
  scrubberActive: boolean;
  timeFilterRange: [number, number] | null;
  colorGroupCount: number;
}

function createInitialState(): MapState {
  return {
    graphData: null,
    isLoading: true,
    errorMessage: '',
    waitingMessage: '',
    searchQuery: '',
    zoomLevel: 1,
    scrubberActive: false,
    timeFilterRange: null,
    colorGroupCount: 4
  };
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

export function createMapStore() {
  const store = writable<MapState>(createInitialState());
  const { subscribe, update } = store;
  let activeLoadRequest = 0;
  let semanticPollTimer: ReturnType<typeof window.setInterval> | null = null;
  let semanticPollInFlight = false;
  let lastGraphMetadataKey: string | null = null;

  function patch(partial: Partial<MapState>) {
    update((state) => ({ ...state, ...partial }));
  }

  function stopSemanticPolling() {
    if (semanticPollTimer) {
      window.clearInterval(semanticPollTimer);
      semanticPollTimer = null;
    }
    semanticPollInFlight = false;
  }

  async function refreshSemanticGate(requestId: number) {
    const status = await invoke<SemanticStatus>('get_semantic_status');
    if (requestId !== activeLoadRequest) {
      return false;
    }

    const nextWaitReason = semanticWaitReason(status);
    if (nextWaitReason) {
      patch({
        graphData: null,
        errorMessage: '',
        waitingMessage: nextWaitReason,
        isLoading: false
      });
      startSemanticPolling();
      return false;
    }

    const nextBlockReason = semanticBlockReason(status);
    if (nextBlockReason) {
      patch({
        graphData: null,
        waitingMessage: '',
        errorMessage: nextBlockReason,
        isLoading: false
      });
      stopSemanticPolling();
      return false;
    }

    patch({ waitingMessage: '' });
    stopSemanticPolling();
    return true;
  }

  function startSemanticPolling() {
    if (semanticPollTimer) {
      return;
    }

    semanticPollTimer = window.setInterval(() => {
      if (semanticPollInFlight) {
        return;
      }
      semanticPollInFlight = true;
      const requestId = activeLoadRequest;
      void (async () => {
        try {
          const isReady = await refreshSemanticGate(requestId);
          if (isReady && requestId === activeLoadRequest) {
            stopSemanticPolling();
            await loadGraphData({ skipGateCheck: true });
          }
        } catch (error) {
          if (requestId !== activeLoadRequest) {
            return;
          }
          patch({
            waitingMessage: '',
            errorMessage: String(error),
            isLoading: false
          });
          stopSemanticPolling();
        } finally {
          semanticPollInFlight = false;
        }
      })();
    }, SEMANTIC_POLL_INTERVAL_MS);
  }

  async function loadGraphData(options?: { skipGateCheck?: boolean }) {
    const requestId = ++activeLoadRequest;
    patch({
      isLoading: true,
      errorMessage: '',
      waitingMessage: ''
    });

    try {
      if (!options?.skipGateCheck) {
        const isReady = await refreshSemanticGate(requestId);
        if (requestId !== activeLoadRequest || !isReady) {
          return;
        }
      }

      const { colorGroupCount } = get(store);
      const metadata = await invoke<GraphDataMetadata>('get_graph_data_metadata', { colorGroupCount });
      if (requestId !== activeLoadRequest) {
        return;
      }
      const metadataKey = `${metadata.semanticRevision}:${metadata.notesRevision}:${metadata.colorGroupCount}:${metadata.invalidationEpoch}`;
      if (lastGraphMetadataKey === metadataKey && get(store).graphData) {
        return;
      }

      const nextGraphData = await invoke<GraphData>('get_graph_data', { colorGroupCount });
      if (requestId !== activeLoadRequest) {
        return;
      }

      lastGraphMetadataKey = metadataKey;
      patch({ graphData: nextGraphData });
    } catch (error) {
      if (requestId !== activeLoadRequest) {
        return;
      }

      const message = String(error);
      if (message.includes('Map calculations are waiting for the embedding model to finish loading.')) {
        patch({
          graphData: null,
          errorMessage: '',
          waitingMessage: message
        });
        startSemanticPolling();
      } else {
        patch({
          graphData: null,
          errorMessage: message
        });
      }
    } finally {
      if (requestId === activeLoadRequest) {
        patch({ isLoading: false });
      }
    }
  }

  function setSearchQuery(searchQuery: string) {
    patch({ searchQuery });
  }

  function setZoomLevel(zoomLevel: number) {
    patch({ zoomLevel });
  }

  function toggleScrubber() {
    update((state) => ({
      ...state,
      scrubberActive: !state.scrubberActive,
      timeFilterRange: state.scrubberActive ? null : state.timeFilterRange
    }));
  }

  function setTimeFilterRange(timeFilterRange: [number, number] | null) {
    patch({ timeFilterRange });
  }

  function setColorGroupCount(colorGroupCount: number) {
    let shouldReload = false;
    update((state) => {
      if (state.colorGroupCount === colorGroupCount) {
        return state;
      }
      shouldReload = true;
      return {
        ...state,
        colorGroupCount
      };
    });

    if (shouldReload) {
      void loadGraphData();
    }
  }

  function retry() {
    void loadGraphData();
  }

  function initialize() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void loadGraphData();
      });
    });
  }

  function dispose() {
    activeLoadRequest += 1;
    lastGraphMetadataKey = null;
    stopSemanticPolling();
  }

  return {
    subscribe,
    loadGraphData,
    setSearchQuery,
    setZoomLevel,
    toggleScrubber,
    setTimeFilterRange,
    setColorGroupCount,
    retry,
    initialize,
    dispose
  };
}
