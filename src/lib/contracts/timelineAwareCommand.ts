import { invoke } from '@tauri-apps/api/core';
import { toHistoryCommandFailure } from '$lib/contracts/historyCommand';

interface TimelineAwareCommandError {
  domain: string;
  failure: unknown;
}

function isTimelineAwareCommandError(error: unknown): error is TimelineAwareCommandError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'domain' in error &&
    typeof error.domain === 'string' &&
    'failure' in error
  );
}

export function toTimelineAwareCommandFailure(
  error: unknown,
  operationMessage: string
): Error {
  if (error instanceof Error) return error;
  if (isTimelineAwareCommandError(error) && error.domain === 'history') {
    return toHistoryCommandFailure(error.failure);
  }
  return new Error(operationMessage);
}

export async function invokeTimelineAwareCommand<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  operationMessage: string
): Promise<T> {
  try {
    return args === undefined
      ? await invoke<T>(command)
      : await invoke<T>(command, args);
  } catch (error) {
    throw toTimelineAwareCommandFailure(error, operationMessage);
  }
}
