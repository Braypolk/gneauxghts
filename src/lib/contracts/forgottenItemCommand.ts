import { invoke } from '@tauri-apps/api/core';
import { toHistoryCommandFailure } from '$lib/contracts/historyCommand';

interface ForgottenItemCommandError {
  domain: 'history' | 'chat' | 'forgotten';
  failure: unknown;
}

function isForgottenItemCommandError(error: unknown): error is ForgottenItemCommandError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'domain' in error &&
    (error.domain === 'history' || error.domain === 'chat' || error.domain === 'forgotten') &&
    'failure' in error
  );
}

export function toForgottenItemCommandFailure(error: unknown): Error {
  if (error instanceof Error) return error;
  if (!isForgottenItemCommandError(error)) {
    return new Error('Forgotten items are unavailable right now.');
  }
  if (error.domain === 'history') {
    return toHistoryCommandFailure(error.failure);
  }
  return new Error(
    error.domain === 'chat'
      ? 'Chat recovery is unavailable right now.'
      : 'Forgotten items are unavailable right now.'
  );
}

export function forgottenItemCommandMessage(error: unknown): string {
  return toForgottenItemCommandFailure(error).message;
}

export async function invokeForgottenItemCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return args === undefined
      ? await invoke<T>(command)
      : await invoke<T>(command, args);
  } catch (error) {
    throw toForgottenItemCommandFailure(error);
  }
}
