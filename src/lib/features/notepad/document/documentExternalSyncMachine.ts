import type { ExternalDocumentChange } from './documentState';

interface DocumentExternalSyncBase {
  /** Monotonic per-document sequence used to mint conflict identities. */
  sequence: number;
}

export type DocumentExternalSyncState =
  | (DocumentExternalSyncBase & { kind: 'noConflict' })
  | (DocumentExternalSyncBase & {
      kind: 'conflict';
      conflictId: number;
      phase: 'awaitingChoice' | 'applyingExternal';
      external: ExternalDocumentChange;
    });

export type DocumentExternalSyncEvent =
  | { type: 'boundaryApplied' }
  | {
      type: 'externalCaptured';
      external: ExternalDocumentChange;
    }
  | { type: 'keepWorking'; conflictId: number }
  | { type: 'beginApplyingExternal'; conflictId: number }
  | {
      type: 'externalApplied';
      conflictId: number;
    }
  | { type: 'externalApplyFailed'; conflictId: number };

type DocumentExternalConflictState = Extract<
  DocumentExternalSyncState,
  { kind: 'conflict' }
>;

export function createDocumentExternalSyncState(): DocumentExternalSyncState {
  return { kind: 'noConflict', sequence: 0 };
}

function isCurrentConflict(
  state: DocumentExternalSyncState,
  conflictId: number,
  phase?: 'awaitingChoice' | 'applyingExternal'
): state is DocumentExternalConflictState {
  return (
    state.kind === 'conflict' &&
    state.conflictId === conflictId &&
    (phase === undefined || state.phase === phase)
  );
}

export function transitionDocumentExternalSync(
  state: DocumentExternalSyncState,
  event: DocumentExternalSyncEvent
): DocumentExternalSyncState {
  switch (event.type) {
    case 'boundaryApplied':
      return { kind: 'noConflict', sequence: state.sequence };

    case 'externalCaptured': {
      const conflictId = state.sequence + 1;
      return {
        kind: 'conflict',
        sequence: conflictId,
        conflictId,
        phase: 'awaitingChoice',
        external: event.external
      };
    }

    case 'keepWorking':
      return isCurrentConflict(
        state,
        event.conflictId,
        'awaitingChoice'
      )
        ? { kind: 'noConflict', sequence: state.sequence }
        : state;

    case 'beginApplyingExternal':
      return isCurrentConflict(
        state,
        event.conflictId,
        'awaitingChoice'
      )
        ? { ...state, phase: 'applyingExternal' }
        : state;

    case 'externalApplied':
      if (
        !isCurrentConflict(
          state,
          event.conflictId,
          'applyingExternal'
        )
      ) {
        return state;
      }
      return { kind: 'noConflict', sequence: state.sequence };

    case 'externalApplyFailed':
      return isCurrentConflict(
        state,
        event.conflictId,
        'applyingExternal'
      )
        ? { ...state, phase: 'awaitingChoice' }
        : state;
    default:
      return assertNeverExternalSyncEvent(event);
  }
}

export function isDocumentExternalConflictCurrent(
  state: DocumentExternalSyncState,
  conflictId: number,
  phase?: 'awaitingChoice' | 'applyingExternal'
) {
  return isCurrentConflict(state, conflictId, phase);
}

function assertNeverExternalSyncEvent(value: never): never {
  throw new Error(`Unhandled external-sync event: ${String(value)}`);
}
