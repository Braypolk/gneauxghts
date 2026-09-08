export type SaveWaitReason = 'recovery' | 'verification' | 'unavailable' | 'corrupt';

export type DocumentOperationKind =
  | 'saving'
  | 'forgetting';

interface DocumentOperationBase {
  token: number;
  revision: number;
}

export type DocumentOperationState =
  | (DocumentOperationBase & { kind: 'idle' })
  | (DocumentOperationBase & {
      kind: DocumentOperationKind;
      waitReason?: SaveWaitReason;
    })
  | (DocumentOperationBase & {
      kind: 'failed';
      failedOperation: DocumentOperationKind;
      message: string;
    });

export type DocumentOperationEvent =
  | {
      type: 'start';
      operation: DocumentOperationKind;
    }
  | {
      type: 'succeed';
      token: number;
    }
  | {
      type: 'fail';
      token: number;
      error: unknown;
    }
  | { type: 'savingProgress'; token: number; waitReason?: SaveWaitReason }
  | { type: 'invalidate' }
  | { type: 'contentChanged' };

export function createDocumentOperationState(): DocumentOperationState {
  return {
    kind: 'idle',
    token: 0,
    revision: 0
  };
}

/**
 * Pure operation transition. Tokens reject late async results; revisions
 * correlate persistence results with the working content they saved.
 *
 * Starting a newer operation supersedes the presentation result of an older
 * one. Callers must still serialize irreversible writes: this reducer does not
 * pretend that an already-started backend mutation can be cancelled.
 */
export function transitionDocumentOperation(
  state: DocumentOperationState,
  event: DocumentOperationEvent
): DocumentOperationState {
  switch (event.type) {
    case 'start':
      return {
        kind: event.operation,
        token: state.token + 1,
        revision: state.revision
      };
    case 'savingProgress':
      if (state.kind !== 'saving' || event.token !== state.token) return state;
      return { ...state, waitReason: event.waitReason };
    case 'succeed':
      return event.token === state.token &&
        (state.kind === 'saving' || state.kind === 'forgetting')
        ? {
            kind: 'idle',
            token: state.token,
            revision: state.revision
          }
        : state;
    case 'fail':
      return event.token === state.token &&
        (state.kind === 'saving' || state.kind === 'forgetting')
        ? {
            kind: 'failed',
            failedOperation: state.kind,
            message:
              event.error instanceof Error
                ? event.error.message
                : String(event.error),
            token: state.token,
            revision: state.revision
          }
        : state;
    case 'invalidate':
      return {
        kind: 'idle',
        token: state.token + 1,
        revision: state.revision
      };
    case 'contentChanged':
      return {
        ...state,
        revision: state.revision + 1
      };
    default:
      return assertNever(event);
  }
}

export function isDocumentOperationTokenCurrent(
  state: DocumentOperationState,
  token: number
) {
  return state.token === token;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled document operation event: ${String(value)}`);
}
