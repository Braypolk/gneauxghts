type LifecycleState =
  | { kind: 'uninitialized' }
  | { kind: 'initializing'; sequence: number }
  | { kind: 'ready' }
  | { kind: 'unavailable' }
  | { kind: 'disposed' };

type SelectionState =
  | { kind: 'idle' }
  | {
      kind: 'loading';
      conversationId: string;
      operationId: number;
    }
  | {
      kind: 'creating';
      operationId: number;
    }
  | {
      kind: 'archiving';
      conversationId: string;
      operationId: number;
    };

type RequestState =
  | { kind: 'idle'; lastTerminalRequestId?: string }
  | {
      kind: 'submitting';
      conversationId: string;
      operationId: number;
      activity: string | null;
    }
  | {
      kind: 'streaming' | 'cancelling';
      conversationId: string;
      requestId: string;
      messageId: string | null;
      activity: string | null;
    };

export interface ChatControllerMachineState {
  lifecycle: LifecycleState;
  selection: SelectionState;
  request: RequestState;
}

type LifecycleEvent =
  | { type: 'initialize'; sequence: number }
  | { type: 'initialized'; sequence: number }
  | { type: 'initializationFailed'; sequence: number }
  | { type: 'dispose' };

type SelectionEvent =
  | { type: 'startLoading'; conversationId: string; operationId: number }
  | { type: 'startCreating'; operationId: number }
  | { type: 'startArchiving'; conversationId: string; operationId: number }
  | { type: 'opened'; conversationId: string; operationId: number }
  | { type: 'created'; operationId: number }
  | { type: 'archived'; operationId: number }
  | { type: 'failed'; operationId: number };

type RequestEvent =
  | {
      type: 'submit';
      conversationId: string;
      operationId: number;
      activity?: string | null;
    }
  | {
      type: 'accepted';
      conversationId: string;
      requestId: string;
      messageId?: string | null;
      operationId: number;
    }
  | {
      type: 'started';
      conversationId: string;
      requestId: string;
      messageId: string;
    }
  | {
      type: 'activity';
      conversationId: string;
      requestId: string;
      messageId: string;
      activity: string;
    }
  | { type: 'cancel'; conversationId: string; requestId: string }
  | { type: 'cancelFailed'; conversationId: string; requestId: string }
  | { type: 'terminal'; conversationId: string; requestId: string }
  | { type: 'submissionFailed'; conversationId: string; operationId: number }
  | { type: 'restore'; conversationId: string; requestId: string | null }
  | { type: 'reset' };

export type ChatControllerMachineEvent =
  | LifecycleEvent
  | SelectionEvent
  | RequestEvent;

export function createChatControllerMachineState(): ChatControllerMachineState {
  return {
    lifecycle: { kind: 'uninitialized' },
    selection: { kind: 'idle' },
    request: { kind: 'idle' }
  };
}

export function transitionChatControllerMachine(
  state: ChatControllerMachineState,
  event: ChatControllerMachineEvent
): ChatControllerMachineState {
  if (state.lifecycle.kind === 'disposed') return state;
  if (event.type === 'dispose') {
    return {
      lifecycle: { kind: 'disposed' },
      selection: { kind: 'idle' },
      request: { kind: 'idle' }
    };
  }
  switch (event.type) {
    case 'initialize':
    case 'initialized':
    case 'initializationFailed': {
      const lifecycle = transitionLifecycle(state.lifecycle, event);
      return lifecycle === state.lifecycle ? state : { ...state, lifecycle };
    }
    case 'startLoading':
    case 'startCreating':
    case 'startArchiving':
    case 'opened':
    case 'created':
    case 'archived':
    case 'failed': {
      const selection = transitionSelection(state.selection, event);
      return selection === state.selection ? state : { ...state, selection };
    }
    default: {
      const request = transitionRequest(state.request, event);
      return request === state.request ? state : { ...state, request };
    }
  }
}

export function isChatSelectionBusy(state: ChatControllerMachineState) {
  return state.selection.kind !== 'idle';
}

export function isChatRequestBusy(state: ChatControllerMachineState) {
  return state.request.kind !== 'idle';
}

function transitionLifecycle(
  state: LifecycleState,
  event: LifecycleEvent
): LifecycleState {
  if (state.kind === 'disposed') return state;
  switch (event.type) {
    case 'initialize':
      return { kind: 'initializing', sequence: event.sequence };
    case 'initialized':
      return state.kind === 'initializing' && state.sequence === event.sequence
        ? { kind: 'ready' }
        : state;
    case 'initializationFailed':
      return state.kind === 'initializing' && state.sequence === event.sequence
        ? { kind: 'unavailable' }
        : state;
    case 'dispose':
      return { kind: 'disposed' };
    default:
      return assertNeverChatEvent(event);
  }
}

function transitionSelection(
  state: SelectionState,
  event: SelectionEvent
): SelectionState {
  switch (event.type) {
    case 'startLoading':
      return {
        kind: 'loading',
        conversationId: event.conversationId,
        operationId: event.operationId
      };
    case 'startCreating':
      return { kind: 'creating', operationId: event.operationId };
    case 'startArchiving':
      return {
        kind: 'archiving',
        conversationId: event.conversationId,
        operationId: event.operationId
      };
    case 'opened':
      return state.kind === 'loading' &&
        state.operationId === event.operationId &&
        state.conversationId === event.conversationId
        ? { kind: 'idle' }
        : state;
    case 'created':
      return state.kind === 'creating' && state.operationId === event.operationId
        ? { kind: 'idle' }
        : state;
    case 'archived':
      return state.kind === 'archiving' && state.operationId === event.operationId
        ? { kind: 'idle' }
        : state;
    case 'failed':
      return state.kind !== 'idle' &&
        state.operationId === event.operationId
        ? { kind: 'idle' }
        : state;
    default:
      return assertNeverChatEvent(event);
  }
}

function transitionRequest(
  state: RequestState,
  event: RequestEvent
): RequestState {
  switch (event.type) {
    case 'submit':
      return state.kind === 'idle'
        ? {
            kind: 'submitting',
            conversationId: event.conversationId,
            operationId: event.operationId,
            activity: event.activity ?? null
          }
        : state;
    case 'accepted':
      if (
        state.kind === 'submitting' &&
        state.conversationId === event.conversationId &&
        state.operationId === event.operationId
      ) {
        return {
          kind: 'streaming',
          conversationId: event.conversationId,
          requestId: event.requestId,
          messageId: event.messageId ?? null,
          activity: state.activity
        };
      }
      return state.kind === 'streaming' &&
        state.conversationId === event.conversationId &&
        state.requestId === event.requestId
        ? {
            ...state,
            messageId: state.messageId ?? event.messageId ?? null
          }
        : state;
    case 'started':
      if (
        state.kind === 'idle' &&
        state.lastTerminalRequestId === event.requestId
      ) {
        return state;
      }
      return state.kind === 'idle' ||
        (state.kind === 'submitting' &&
          state.conversationId === event.conversationId) ||
        ((state.kind === 'streaming' || state.kind === 'cancelling') &&
          state.conversationId === event.conversationId &&
          state.requestId === event.requestId)
        ? {
            kind: state.kind === 'cancelling' ? 'cancelling' : 'streaming',
            conversationId: event.conversationId,
            requestId: event.requestId,
            messageId: event.messageId,
            activity: 'activity' in state ? state.activity : null
          }
        : state;
    case 'activity':
      if (state.kind === 'idle') {
        return state.lastTerminalRequestId === event.requestId
          ? state
          : {
              kind: 'streaming',
              conversationId: event.conversationId,
              requestId: event.requestId,
              messageId: event.messageId,
              activity: event.activity
            };
      }
      return (state.kind === 'streaming' || state.kind === 'cancelling') &&
        state.conversationId === event.conversationId &&
        state.requestId === event.requestId
        ? { ...state, activity: event.activity }
        : state;
    case 'cancel':
      return state.kind === 'streaming' &&
        state.conversationId === event.conversationId &&
        state.requestId === event.requestId
        ? { ...state, kind: 'cancelling' }
        : state;
    case 'cancelFailed':
      return state.kind === 'cancelling' &&
        state.conversationId === event.conversationId &&
        state.requestId === event.requestId
        ? { ...state, kind: 'streaming' }
        : state;
    case 'terminal':
      if (state.kind === 'idle') {
        return state.lastTerminalRequestId === event.requestId
          ? state
          : { kind: 'idle', lastTerminalRequestId: event.requestId };
      }
      if (
        state.kind === 'submitting' &&
        state.conversationId === event.conversationId
      ) {
        return { kind: 'idle', lastTerminalRequestId: event.requestId };
      }
      return (state.kind === 'streaming' || state.kind === 'cancelling') &&
        state.conversationId === event.conversationId &&
        state.requestId === event.requestId
        ? { kind: 'idle', lastTerminalRequestId: event.requestId }
        : state;
    case 'submissionFailed':
      return state.kind === 'submitting' &&
        state.conversationId === event.conversationId &&
        state.operationId === event.operationId
        ? { kind: 'idle' }
        : state;
    case 'restore':
      return event.requestId
        ? {
            kind: 'streaming',
            conversationId: event.conversationId,
            requestId: event.requestId,
            messageId: null,
            activity: null
          }
        : { kind: 'idle' };
    case 'reset':
      return { kind: 'idle' };
    default:
      return assertNeverChatEvent(event);
  }
}

function assertNeverChatEvent(value: never): never {
  throw new Error(`Unhandled chat machine event: ${String(value)}`);
}
