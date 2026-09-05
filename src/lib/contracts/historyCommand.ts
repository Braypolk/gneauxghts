import { invoke } from '@tauri-apps/api/core';

const COMMAND_FAILURES = {
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
  },
  alreadyCurrent: {
    state: 'alreadyCurrent',
    message: "This revision already matches the note's current content. Choose a different revision.",
    recoveryAction: 'correctRequest'
  }
} as const;

export type HistoryCommandErrorState = keyof typeof COMMAND_FAILURES;
export type HistoryCommandRecoveryAction =
  (typeof COMMAND_FAILURES)[HistoryCommandErrorState]['recoveryAction'];

export interface HistoryCommandError {
  state: HistoryCommandErrorState;
  message: string;
  recoveryAction: HistoryCommandRecoveryAction;
}

export const HISTORY_COMMAND_ERRORS: readonly HistoryCommandError[] =
  Object.values(COMMAND_FAILURES);

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
  return typeof value === 'string' && value in COMMAND_FAILURES;
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
