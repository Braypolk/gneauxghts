export type RememberMode = 'exact' | 'cleanUp' | 'integrate';
export type CleanUpApplyPolicy = 'autoApply' | 'requireApproval';
export type AiProviderKind = 'openAiCompatible' | 'llamaServer';
export type AiJobStatus =
  | 'queued'
  | 'running'
  | 'pendingApproval'
  | 'applied'
  | 'rejected'
  | 'failed'
  | 'stale';
export type RememberAiStatus = 'notRequested' | 'queued' | 'failedToQueue';

export type AiChange =
  | {
      kind: 'updateNote';
      path: string;
      baseContentHash: string;
      newTitle: string;
      newMarkdown: string;
    }
  | {
      kind: 'createNote';
      suggestedTitle: string;
      markdown: string;
    }
  | {
      kind: 'deleteNote';
      path: string;
      baseContentHash: string;
    };

export interface RememberDispatchResult {
  sourcePath: string | null;
  sourceContentHash: string | null;
  aiJobId: number | null;
  aiStatus: RememberAiStatus;
}

export interface AiSettings {
  providerKind: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
}

export interface AiModelOption {
  id: string;
}

export interface ClearInboxResult {
  cancelledJobs: number;
  removedJobs: number;
}

export interface AiDiagnosticsLastRun {
  kind: RememberMode;
  status: AiJobStatus;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  elapsedMillis: number;
  updatedAtMillis: number;
}

export interface AiDiagnosticsMetrics {
  runCount: number;
  promptTokensTotal: number;
  completionTokensTotal: number;
  totalTokensTotal: number;
  promptTokensMax: number;
  completionTokensMax: number;
  totalTokensMax: number;
  lastRun: AiDiagnosticsLastRun | null;
}

export interface AiDiagnosticsSnapshot {
  capturedAtMillis: number;
  metrics: AiDiagnosticsMetrics;
}

export interface AiSettingsUpdate {
  providerKind: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

export interface AiRunMetrics {
  elapsedMillis: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface InboxListItem {
  id: number;
  kind: RememberMode;
  status: AiJobStatus;
  title: string;
  summary: string;
  sourcePath: string;
  sourceTitle: string;
  affectedNotes: string[];
  createdAtMillis: number;
  updatedAtMillis: number;
}

export interface AiChangePreview {
  change: AiChange;
  currentTitle: string | null;
  currentMarkdown: string | null;
}

export interface InboxItemDetail {
  id: number;
  kind: RememberMode;
  status: AiJobStatus;
  title: string;
  summary: string;
  sourcePath: string;
  sourceTitle: string;
  sourceMarkdown: string;
  sourceContentHash: string;
  providerKind: AiProviderKind | null;
  model: string | null;
  requiresApproval: boolean;
  failureReason: string | null;
  metrics: AiRunMetrics | null;
  proposedChanges: AiChange[];
  changePreviews: AiChangePreview[];
  createdAtMillis: number;
  updatedAtMillis: number;
}
