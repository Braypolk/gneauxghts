export type PaneMembershipState =
  | { kind: 'absent' }
  | { kind: 'creating'; operationId: number }
  | { kind: 'ready' }
  | { kind: 'closing'; operationId: number }
  | { kind: 'retiring'; operationId: number }
  | { kind: 'disposed' };

export type PaneMembershipEvent =
  | { type: 'createRequested'; operationId: number }
  | { type: 'creationCompleted'; operationId: number }
  | { type: 'creationFailed'; operationId: number }
  | { type: 'closeRequested'; operationId: number }
  | { type: 'closeBlocked'; operationId: number }
  | { type: 'retirementStarted'; operationId: number }
  | { type: 'disposalCompleted'; operationId: number };

export function createPaneMembershipState(
  ready = false
): PaneMembershipState {
  return ready ? { kind: 'ready' } : { kind: 'absent' };
}

export function transitionPaneMembership(
  state: PaneMembershipState,
  event: PaneMembershipEvent
): PaneMembershipState {
  switch (event.type) {
    case 'createRequested':
      return state.kind === 'absent'
        ? { kind: 'creating', operationId: event.operationId }
        : state;
    case 'creationCompleted':
      return state.kind === 'creating' &&
        state.operationId === event.operationId
        ? { kind: 'ready' }
        : state;
    case 'creationFailed':
      return state.kind === 'creating' &&
        state.operationId === event.operationId
        ? { kind: 'disposed' }
        : state;
    case 'closeRequested':
      return state.kind === 'ready'
        ? { kind: 'closing', operationId: event.operationId }
        : state;
    case 'closeBlocked':
      return state.kind === 'closing' &&
        state.operationId === event.operationId
        ? { kind: 'ready' }
        : state;
    case 'retirementStarted':
      return state.kind === 'closing' &&
        state.operationId === event.operationId
        ? { kind: 'retiring', operationId: event.operationId }
        : state;
    case 'disposalCompleted':
      return state.kind === 'retiring' &&
        state.operationId === event.operationId
        ? { kind: 'disposed' }
        : state;
    default:
      return assertNeverPaneLifecycleEvent(event);
  }
}

export type PaneEditorRuntimeState =
  | { kind: 'unmounted' }
  | { kind: 'mounting' }
  | { kind: 'mounted' }
  | { kind: 'unmounting'; disposeAfter: boolean }
  | { kind: 'disposed' };

export type PaneEditorRuntimeEvent =
  | { type: 'mountRequested' }
  | { type: 'mountCompleted' }
  | { type: 'mountFailed' }
  | { type: 'unmountRequested' }
  | { type: 'disposeRequested' }
  | { type: 'unmountCompleted' }
  | { type: 'unmountFailed' };

export function createPaneEditorRuntimeState(): PaneEditorRuntimeState {
  return { kind: 'unmounted' };
}

export function transitionPaneEditorRuntime(
  state: PaneEditorRuntimeState,
  event: PaneEditorRuntimeEvent
): PaneEditorRuntimeState {
  switch (event.type) {
    case 'mountRequested':
      return state.kind === 'unmounted'
        ? { kind: 'mounting' }
        : state;
    case 'mountCompleted':
      return state.kind === 'mounting'
        ? { kind: 'mounted' }
        : state;
    case 'mountFailed':
      return state.kind === 'mounting'
        ? { kind: 'unmounted' }
        : state;
    case 'unmountRequested':
      return state.kind === 'mounted'
        ? { kind: 'unmounting', disposeAfter: false }
        : state;
    case 'disposeRequested':
      if (state.kind === 'disposed') return state;
      if (state.kind === 'unmounted') return { kind: 'disposed' };
      return { kind: 'unmounting', disposeAfter: true };
    case 'unmountCompleted':
      if (state.kind !== 'unmounting') return state;
      return state.disposeAfter
        ? { kind: 'disposed' }
        : { kind: 'unmounted' };
    case 'unmountFailed':
      if (state.kind !== 'unmounting') return state;
      return state.disposeAfter
        ? { kind: 'disposed' }
        : { kind: 'mounted' };
    default:
      return assertNeverPaneLifecycleEvent(event);
  }
}

function assertNeverPaneLifecycleEvent(value: never): never {
  throw new Error(`Unhandled pane lifecycle event: ${String(value)}`);
}
