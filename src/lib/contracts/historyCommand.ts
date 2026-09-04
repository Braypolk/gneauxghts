import { invoke } from '@tauri-apps/api/core';

export const HISTORY_MUTATION_SOURCES = [
  'editor',
  'taskAction',
  'acceptedChatProposal',
  'externalEdit',
  'versionRestore',
  'noteCreation',
  'baselineInitialization',
  'recoveryReconciliation'
] as const;

export const HISTORY_LIFECYCLE_KINDS = [
  'created',
  'renamed',
  'moved',
  'forgotten',
  'recovered',
  'missing',
  'reattached',
  'purged'
] as const;

export const HISTORY_TIME_KINDS = [
  'knownSince',
  'committed',
  'observed'
] as const;

export const HISTORY_HEALTH_STATES = [
  'healthy',
  'initializing',
  'degraded',
  'warning',
  'unavailable',
  'corrupt'
] as const;

export const HISTORY_NOTE_HEALTH_STATES = [
  'healthy',
  'initializing',
  'degraded',
  'unavailable',
  'corrupt'
] as const;

export const HISTORY_INTEGRITY_STATES = [
  'verified',
  'unavailable',
  'corrupt'
] as const;

export const BASELINE_INITIALIZATION_PHASES = [
  'notStarted',
  'initializing',
  'complete',
  'degraded'
] as const;

export const HISTORY_COMMAND_ERROR_STATES = [
  'unavailable',
  'corrupt',
  'stale',
  'ineligible',
  'missing',
  'invalidRequest'
] as const;

export const HISTORY_COMMAND_RECOVERY_ACTIONS = [
  'retry',
  'refresh',
  'recoverNote',
  'backUpAndReset',
  'correctRequest'
] as const;

export type HistoryMutationSource = (typeof HISTORY_MUTATION_SOURCES)[number];
export type HistoryLifecycleEventKind = (typeof HISTORY_LIFECYCLE_KINDS)[number];
export type HistoryTimeKind = (typeof HISTORY_TIME_KINDS)[number];
export type HistoryCursor = string | null;
export type HistoryHealthState = (typeof HISTORY_HEALTH_STATES)[number];
export type NoteHistoryHealthState = (typeof HISTORY_NOTE_HEALTH_STATES)[number];
export type HistoryIntegrityState = (typeof HISTORY_INTEGRITY_STATES)[number];
export type BaselineInitializationPhase =
  (typeof BASELINE_INITIALIZATION_PHASES)[number];
export type HistoryCommandErrorState = (typeof HISTORY_COMMAND_ERROR_STATES)[number];
export type HistoryCommandRecoveryAction =
  (typeof HISTORY_COMMAND_RECOVERY_ACTIONS)[number];

export interface HistoryCommandError {
  state: HistoryCommandErrorState;
  message: string;
  recoveryAction: HistoryCommandRecoveryAction;
}

const COMMAND_FAILURES: Record<HistoryCommandErrorState, HistoryCommandError> = {
  unavailable: {
    state: 'unavailable',
    message: 'History is unavailable right now.',
    recoveryAction: 'retry'
  },
  corrupt: {
    state: 'corrupt',
    message: 'History data is damaged and must be reset before it can be used.',
    recoveryAction: 'backUpAndReset'
  },
  stale: {
    state: 'stale',
    message: 'History changed before this action finished.',
    recoveryAction: 'refresh'
  },
  ineligible: {
    state: 'ineligible',
    message: 'This note must be recovered before its history can be used.',
    recoveryAction: 'recoverNote'
  },
  missing: {
    state: 'missing',
    message: 'The requested history item is no longer available.',
    recoveryAction: 'refresh'
  },
  invalidRequest: {
    state: 'invalidRequest',
    message: 'The history request is invalid.',
    recoveryAction: 'correctRequest'
  }
};

export const HISTORY_COMMAND_ERRORS = HISTORY_COMMAND_ERROR_STATES.map(
  (state) => COMMAND_FAILURES[state]
);

export class HistoryCommandFailure extends Error {
  readonly state: HistoryCommandErrorState;
  readonly recoveryAction: HistoryCommandRecoveryAction;

  constructor(error: HistoryCommandError) {
    super(error.message);
    this.name = 'HistoryCommandFailure';
    this.state = error.state;
    this.recoveryAction = error.recoveryAction;
  }
}

function isHistoryCommandErrorState(value: unknown): value is HistoryCommandErrorState {
  return HISTORY_COMMAND_ERROR_STATES.includes(value as HistoryCommandErrorState);
}

export function toHistoryCommandFailure(error: unknown): HistoryCommandFailure {
  if (error instanceof HistoryCommandFailure) return error;
  const state =
    typeof error === 'object' && error !== null && 'state' in error &&
    isHistoryCommandErrorState(error.state)
      ? error.state
      : 'unavailable';
  return new HistoryCommandFailure(COMMAND_FAILURES[state]);
}

export function historyCommandMessage(error: unknown): string {
  return toHistoryCommandFailure(error).message;
}

export async function invokeHistoryCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return args === undefined
      ? await invoke<T>(command)
      : await invoke<T>(command, args);
  } catch (error) {
    throw toHistoryCommandFailure(error);
  }
}
