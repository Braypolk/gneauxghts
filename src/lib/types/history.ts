export type HistoryHealthState =
  | 'healthy'
  | 'initializing'
  | 'degraded'
  | 'warning'
  | 'unavailable'
  | 'corrupt';

export type HistoryIntegrityState = 'verified' | 'unavailable' | 'corrupt';
export type BaselineInitializationPhase =
  | 'notStarted'
  | 'initializing'
  | 'complete'
  | 'degraded';

export interface BaselineInitializationProgress {
  phase: BaselineInitializationPhase;
  discoveredNotes: number;
  baselineRevisions: number;
  readyNotes: number;
  failedNotes: number;
  lastError?: string | null;
}

export interface HistoryStorageUsage {
  allocatedBytes: number;
  reclaimableBytes: number;
}

export interface HistoryResetDiagnostic {
  operationId: string;
  previousGeneration: number;
  generation: number;
  resetAtMillis: number;
  initialization: BaselineInitializationProgress;
}

export interface HistoryHealthReport {
  state: HistoryHealthState;
  integrity: HistoryIntegrityState;
  initialization: BaselineInitializationProgress;
  storage?: HistoryStorageUsage;
  pendingRepairs: number;
  canRetry: boolean;
  canReset: boolean;
  lastReset?: HistoryResetDiagnostic;
}

export interface NoteHistoryHealth {
  noteId: string;
  state: 'healthy' | 'initializing' | 'degraded' | 'unavailable' | 'corrupt';
  revisionCount: number;
  lifecycleEventCount: number;
  revisionPayloadBytes: number;
}
