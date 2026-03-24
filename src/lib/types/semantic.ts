export interface SemanticSettings {
  semanticSearchEnabled: boolean;
  localOnlyMode: boolean;
  autoDownloadModel: boolean;
  lexicalWeight: number;
  semanticWeight: number;
  graphMinScore: number;
  strongestLinksOnly: boolean;
}

export interface SemanticModelInfo {
  id: string;
  label: string;
  dimensions: number;
  localOnly: boolean;
  autoDownloadSupported: boolean;
  runtimeBinaryPath: string | null;
  modelPath: string | null;
  modelRepoId: string;
  available: boolean;
  status: string;
  error: string | null;
}

export interface SemanticIndexJob {
  id: number;
  status: string;
  scannedCount: number;
  embeddedCount: number;
  errorText: string | null;
  startedAtMillis: number;
  updatedAtMillis: number;
}

export interface SemanticStatus {
  settings: SemanticSettings;
  model: SemanticModelInfo;
  platformSupported: boolean;
  disabledReason: string | null;
  modelAvailable: boolean;
  indexingPaused: boolean;
  indexingInProgress: boolean;
  indexedNotes: number;
  indexedChunks: number;
  annIndexLoaded: boolean;
  annIndexDirty: boolean;
  annRebuildPending: boolean;
  annLastDumpedAtMillis: number | null;
  annIndexedChunks: number;
  lastIndexedAtMillis: number | null;
  lastError: string | null;
  currentJobLabel: string | null;
  latestJob: SemanticIndexJob | null;
}

export interface SemanticDebugMetrics {
  runtimeSpawnCount: number;
  runtimeRestartCount: number;
  runtimeShutdownCount: number;
  runtimeReadyCount: number;
  runtimeTimeoutCount: number;
  modelPrepareCount: number;
  modelPrepareSuccessCount: number;
  modelPrepareFailureCount: number;
  modelPrepareLastMillis: number | null;
  modelWarmupCount: number;
  modelWarmupSuccessCount: number;
  modelWarmupFailureCount: number;
  modelWarmupLastMillis: number | null;
  embeddingRequestCount: number;
  embeddingRequestSuccessCount: number;
  embeddingRequestFailureCount: number;
  embeddingTextCountTotal: number;
  embeddingCharCountTotal: number;
  embeddingDurationTotalMillis: number;
  embeddingDurationMaxMillis: number;
  searchRequestCount: number;
  searchSemanticUsedCount: number;
  searchSemanticSkippedCount: number;
  searchDurationTotalMillis: number;
  searchDurationMaxMillis: number;
  annQueryCount: number;
  annQueryCandidateTotal: number;
  annQueryRerankTotal: number;
  annQueryDurationTotalMillis: number;
  annQueryDurationMaxMillis: number;
  annLoadSuccessCount: number;
  annLoadFailureCount: number;
  annRebuildCount: number;
  annRebuildPendingCount: number;
  annRebuildDurationTotalMillis: number;
  annRebuildDurationMaxMillis: number;
  annUpdateFailureCount: number;
  relatedRequestCount: number;
  relatedNoteRequestCount: number;
  relatedSelectionRequestCount: number;
  relatedCacheHitCount: number;
  relatedEdgeReuseCount: number;
  relatedSemanticQueryCount: number;
  relatedInsufficientContentCount: number;
  relatedUnavailableCount: number;
  relatedResultTotal: number;
  relatedDurationTotalMillis: number;
  relatedDurationMaxMillis: number;
  indexJobEnqueuedCount: number;
  indexJobStartedCount: number;
  indexJobCompletedCount: number;
  indexJobFailedCount: number;
  indexZeroWorkCount: number;
  indexScannedTotal: number;
  indexEmbeddedTotal: number;
  indexDurationTotalMillis: number;
  indexDurationMaxMillis: number;
}

export interface SemanticDebugEvent {
  timestampMillis: number;
  category: string;
  action: string;
  detail: string | null;
  durationMillis: number | null;
}

export interface SemanticDebugSnapshot {
  capturedAtMillis: number;
  metrics: SemanticDebugMetrics;
  recentEvents: SemanticDebugEvent[];
}

export interface SearchItem {
  notePath: string | null;
  fileName: string;
  sectionLabel: string;
  excerpt: string;
  highlightRanges: { start: number; end: number }[];
  matchText: string;
  reasonLabels: string[];
  lexicalScore: number | null;
  semanticScore: number | null;
  startLine: number | null;
  endLine: number | null;
}

export interface RelatedNoteItem {
  notePath: string;
  noteTitle: string;
  sectionLabel: string;
  excerpt: string;
  matchText: string;
  score: number;
  startLine: number;
  endLine: number;
}

export interface RelatedNotesResponse {
  status: 'ready' | 'insufficientContent' | 'unavailable';
  scope: 'note' | 'selection';
  reason: string | null;
  items: RelatedNoteItem[];
}
