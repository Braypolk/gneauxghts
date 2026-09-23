import type { SemanticSettings, SemanticStatus } from '$lib/types/semantic';

type SearchReadiness = {
  state: 'ready' | 'working' | 'waiting' | 'attention' | 'paused' | 'off' | 'unavailable';
  guidance: string;
  title: string;
  description: string;
  action?: 'download' | 'prepare_semantic_model' | 'retry_semantic_index' | 'resume_semantic_indexing' | 'rebuild_semantic_index';
  actionLabel?: string;
};

export function searchReadiness(status: SemanticStatus, settings: SemanticSettings): SearchReadiness {
  if (!status.platformSupported) return {
    state: 'unavailable', guidance: 'Unavailable on this device', title: 'Keyword search is available',
    description: status.disabledReason ?? 'Semantic search is not supported on this device.'
  };
  if (!settings.semanticSearchEnabled) return {
    state: 'off', guidance: 'Your preference', title: 'Semantic search is off',
    description: 'Turn on Search beyond exact words to include matches by meaning. Background indexing is managed separately below.'
  };
  if (!status.model.runtimeBinaryPath) return {
    state: 'attention', guidance: 'Setup required', title: 'Local runtime is missing',
    description: 'Reinstall the app with its local runtime to use semantic search. Keyword search still works.'
  };
  if (status.model.error) return {
    state: 'attention', guidance: 'Action needed', title: 'The model needs attention',
    description: 'The local model could not start. Try preparing it again.',
    action: 'prepare_semantic_model', actionLabel: 'Prepare local model'
  };
  if (!status.modelAvailable) return {
    state: 'attention', guidance: 'Setup required', title: 'Download the search model',
    description: 'One download enables private, on-device semantic search. Keyword search already works.',
    action: 'download', actionLabel: 'Download model'
  };
  if (status.indexingPaused) return {
    state: 'paused', guidance: 'Updates paused', title: 'Automatic indexing is paused',
    description: status.indexUsable ? 'Existing matches are available. Resume to include new and edited notes.' : 'Resume indexing to make your notes available for semantic search.',
    action: 'resume_semantic_indexing', actionLabel: 'Resume indexing'
  };
  if (shouldShowSemanticRetry(status)) return {
    state: 'attention', guidance: 'Action needed', title: 'Indexing needs a retry',
    description: status.indexUsable ? 'Existing matches are available, but recent changes could not be indexed.' : 'Your notes could not be indexed. Retry to finish setting up search.',
    action: 'retry_semantic_index', actionLabel: 'Retry now'
  };
  if (status.indexingInProgress) return {
    state: 'working', guidance: 'No action needed', title: status.currentJobLabel ?? 'Indexing notes',
    description: 'Updating your search index now. You can keep using the app.'
  };
  if (status.health === 'working' || status.health === 'stale' || status.annRebuildPending) return {
    state: 'waiting', guidance: 'No action needed', title: 'Updates queued',
    description: 'Indexing will continue automatically when the app is ready.'
  };
  if (status.model.loading) return {
    state: 'waiting', guidance: 'No action needed', title: 'Getting search ready',
    description: 'The model is installed. The local runtime will load automatically.'
  };
  if (!status.indexUsable && status.indexedChunks > 0) return {
    state: 'attention', guidance: 'Action needed', title: 'Search index is unavailable',
    description: 'Rebuild the index to make your indexed notes searchable again.',
    action: 'rebuild_semantic_index', actionLabel: 'Rebuild semantic index'
  };
  return {
    state: 'ready', guidance: 'No action needed', title: status.indexedNotes > 0 ? 'Ready to use' : 'Ready for your notes',
    description: status.indexedNotes > 0
      ? 'Your index is up to date. New and edited notes will be indexed automatically.'
      : 'Setup is complete. Notes will be indexed automatically as you add them.'
  };
}

export function semanticStatusLabel(status: SemanticStatus): string {
  switch (status.health) {
    case 'paused':
      return 'Paused';
    case 'degraded':
      return status.indexUsable ? 'Degraded · using last good index' : 'Degraded';
    case 'stale':
      return status.indexUsable ? 'Stale · using last good index' : 'Stale';
    case 'working':
      if (status.progressTotal > 0) {
        return `${status.currentJobLabel ?? 'Indexing'} ${status.progressCurrent}/${status.progressTotal}`;
      }
      return status.currentJobLabel ?? 'Indexing';
    case 'fresh':
      return 'Ready';
  }
}

export function shouldShowSemanticRetry(status: SemanticStatus): boolean {
  return status.health === 'degraded' || status.retryExhausted;
}
