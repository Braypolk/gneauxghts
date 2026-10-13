import type { SemanticSettings, SemanticStatus } from '$lib/types/semantic';

type SearchReadiness = {
  state: 'ready' | 'working' | 'waiting' | 'attention' | 'paused' | 'off' | 'unavailable';
  guidance: string;
  title: string;
  description: string;
  action?: 'download' | 'prepare_semantic_model' | 'retry_semantic_index' | 'resume_semantic_indexing' | 'rebuild_semantic_index';
  actionLabel?: string;
};

export function searchReadiness(status: SemanticStatus, settings: SemanticSettings, isSettingUp = false): SearchReadiness {
  if (!status.platformSupported) return {
    state: 'unavailable', guidance: 'Unavailable on this device', title: 'Keyword search is available',
    description: status.disabledReason ?? 'Semantic search is not supported on this device.'
  };
  if (status.model.runtimeBundled && !status.model.runtimeBinaryPath) return {
    state: 'attention', guidance: 'App update required', title: 'The included search runtime is missing',
    description: 'Reinstall this app build to restore local search. Downloading the model cannot repair the app runtime. Keyword search is available.'
  };
  const setup = status.setupProgress;
  if (setup && setup.phase !== 'complete' && setup.phase !== 'failed') return {
    state: 'working', guidance: 'Local search setup',
    title: `${{ checking: 'Checking', downloading: 'Downloading', verifying: 'Verifying', installing: 'Installing', starting: 'Starting' }[setup.phase]} ${setup.phase === 'starting' ? 'local search' : setup.fileLabel}`,
    description: setup.phase === 'starting'
      ? 'Loading the model on your device. The first load can take a few minutes. Keyword search is available.'
      : 'These files enable private search on your device. Your notes stay on this device, and keyword search remains available.'
  };
  if (isSettingUp) return {
    state: 'working', guidance: 'Local search setup', title: setup?.phase === 'complete' ? 'Starting local search' : 'Checking local search files',
    description: 'Installing any missing search runtime and model files, then loading the model. You can keep using the app.'
  };
  if (setup?.phase === 'failed') return {
    state: 'attention', guidance: 'Setup interrupted', title: 'Local search setup could not finish',
    description: setup.failedPhase === 'starting'
      ? 'The files are installed, but local search could not start. Retry setup to load the model again. Keyword search is available.'
      : `Setup stopped while processing ${setup.fileLabel}. Try setup again; verified files will be reused. Keyword search is available.`,
    action: 'download', actionLabel: 'Retry local search setup'
  };
  if (!settings.semanticSearchEnabled) return {
    state: 'off', guidance: 'Your preference', title: 'Semantic search is off',
    description: 'Turn on Search beyond exact words to include matches by meaning. Background indexing is managed separately below.'
  };
  if (!status.model.runtimeBinaryPath) return {
    state: 'attention', guidance: 'Setup required', title: 'Set up local search',
    description: 'Download the files for private, on-device search here in the app. Keyword search works while you set up.',
    action: 'download', actionLabel: 'Set up local search'
  };
  if (!status.model.modelPath) return {
    state: 'attention', guidance: 'Setup required', title: 'Set up local search',
    description: status.model.runtimeBundled
      ? 'The search runtime is included in the app. Download the model to enable private, on-device search. Keyword search is available.'
      : 'Download the model to enable private, on-device search. Keyword search is available.',
    action: 'download', actionLabel: 'Set up local search'
  };
  if (status.model.error) return {
    state: 'attention', guidance: 'Action needed', title: 'The model needs attention',
    description: 'The local model could not start. Try preparing it again.',
    action: 'prepare_semantic_model', actionLabel: 'Prepare local model'
  };
  if (!status.modelAvailable) return {
    state: 'attention', guidance: 'Setup required', title: 'Set up local search',
    description: 'One download enables private, on-device semantic search. Keyword search already works.',
    action: 'download', actionLabel: 'Set up local search'
  };
  if (status.indexingPaused) return {
    state: 'paused', guidance: 'Updates paused', title: 'Automatic indexing is paused',
    description: status.indexUsable ? 'Existing matches are available. Resume to include new and edited notes.' : 'Resume indexing to make your notes available for semantic search.',
    action: 'resume_semantic_indexing', actionLabel: 'Resume indexing'
  };
  if (status.health === 'degraded' || status.retryExhausted) return {
    state: 'attention', guidance: 'Action needed', title: 'Indexing needs a retry',
    description: status.indexUsable ? 'Existing matches are available, but recent changes could not be indexed.' : 'Your notes could not be indexed. Retry to finish setting up search.',
    action: 'retry_semantic_index', actionLabel: 'Retry now'
  };
  if (status.migrationState === 'staging' && !status.indexingInProgress) return {
    state: 'waiting', guidance: 'No action needed', title: 'Building compatible search',
    description: 'Reconciling notes and remembered passages before activating this generation. Keyword search is available.'
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
