import type {
  BaselineInitializationPhase,
  HistoryHealthState,
  HistoryIntegrityState,
  NoteHistoryHealthState
} from '$lib/contracts/historyCommand';

export type {
  BaselineInitializationPhase,
  HistoryHealthState,
  HistoryIntegrityState
};

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
  state: NoteHistoryHealthState;
  revisionCount: number;
  lifecycleEventCount: number;
  revisionPayloadBytes: number;
}
