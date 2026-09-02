export type HistoryMutationSource =
  | 'editor'
  | 'taskAction'
  | 'acceptedChatProposal'
  | 'externalEdit'
  | 'versionRestore'
  | 'noteCreation'
  | 'baselineInitialization'
  | 'recoveryReconciliation';

export type HistoryLifecycleEventKind =
  | 'created'
  | 'renamed'
  | 'moved'
  | 'forgotten'
  | 'recovered'
  | 'missing'
  | 'reattached'
  | 'purged';

export interface HistoryRevisionRecord {
  kind: 'revision';
  recordId: string;
  revisionId: string;
  source: HistoryMutationSource;
  occurredAtMillis: number;
  timeKind: 'knownSince' | 'committed' | 'observed';
  modifiedAtMillis: number | null;
}

export interface HistoryLifecycleRecord {
  kind: 'lifecycleEvent';
  recordId: string;
  eventId: string;
  eventKind: HistoryLifecycleEventKind;
  occurredAtMillis: number;
  previousPath: string | null;
  path: string | null;
}

export type HistoryModeRecord = HistoryRevisionRecord | HistoryLifecycleRecord;

export interface HistoryModePage {
  records: HistoryModeRecord[];
  nextCursor: string | null;
}

export interface HistoricalRevision {
  revisionId: string;
  unmanagedFrontmatter: string | null;
  body: string;
}

export interface HistoryModeTarget {
  noteId: string;
  noteTitle: string;
  notePath: string | null;
}

export interface HistoryWorkspaceSnapshot {
  activePaneId: string;
  focusTarget: 'editor' | 'title' | 'chat';
  focusElement?: HTMLElement | null;
}

export type HistoryModeState =
  | { phase: 'inactive'; entryError: string | null }
  | {
      phase: 'entering';
      requestId: number;
      origin: 'entry' | 'retry';
      target: HistoryModeTarget;
      workspace: HistoryWorkspaceSnapshot;
    }
  | {
      phase: 'open';
      target: HistoryModeTarget;
      workspace: HistoryWorkspaceSnapshot;
      records: HistoryModeRecord[];
      nextCursor: string | null;
      selectedRevisionId: string | null;
      selectedRevision: HistoricalRevision | null;
      request: { kind: 'page' | 'refresh' | 'selection'; requestId: number } | null;
      error: string | null;
    }
  | {
      phase: 'historyUnavailable';
      target: HistoryModeTarget;
      workspace: HistoryWorkspaceSnapshot;
      error: string;
    }
  | {
      phase: 'noteUnavailable';
      target: HistoryModeTarget;
      workspace: HistoryWorkspaceSnapshot;
      error: string;
    }
  | { phase: 'exiting'; workspace: HistoryWorkspaceSnapshot }
  | { phase: 'restoring'; workspace: HistoryWorkspaceSnapshot };

export type HistoryModeEvent =
  | {
      type: 'entryStarted';
      requestId: number;
      target: HistoryModeTarget;
      workspace: HistoryWorkspaceSnapshot;
    }
  | { type: 'entryRejected'; error: string }
  | { type: 'retryStarted'; requestId: number; target: HistoryModeTarget }
  | { type: 'entryFailed'; requestId: number; error: string }
  | { type: 'retryFailed'; requestId: number; error: string }
  | {
      type: 'entryLoaded';
      requestId: number;
      target: HistoryModeTarget;
      page: HistoryModePage;
      selectedRevision: HistoricalRevision | null;
    }
  | { type: 'pageStarted'; requestId: number }
  | { type: 'pageLoaded'; requestId: number; page: HistoryModePage }
  | { type: 'pageFailed'; requestId: number; error: string }
  | { type: 'refreshStarted'; requestId: number }
  | { type: 'refreshLoaded'; requestId: number; page: HistoryModePage }
  | { type: 'selectionStarted'; requestId: number; revisionId: string }
  | {
      type: 'selectionLoaded';
      requestId: number;
      revision: HistoricalRevision;
    }
  | { type: 'selectionFailed'; requestId: number; error: string }
  | { type: 'historyUnavailable'; error: string }
  | { type: 'noteUnavailable'; error: string }
  | { type: 'lifecycleChanged'; target: HistoryModeTarget }
  | { type: 'dismissEntryError' }
  | { type: 'exitStarted' }
  | { type: 'workspaceRestored' }
  | { type: 'exitRestoreFailed'; error: string }
  | { type: 'exitCompleted'; error?: string };

export function createInactiveHistoryModeState(): HistoryModeState {
  return { phase: 'inactive', entryError: null };
}

function mergeRecords(
  current: HistoryModeRecord[],
  incoming: HistoryModeRecord[]
): HistoryModeRecord[] {
  const byId = new Map(current.map((record) => [record.recordId, record]));
  for (const record of incoming) {
    byId.set(record.recordId, record);
  }
  return [...byId.values()].sort((left, right) =>
    right.occurredAtMillis - left.occurredAtMillis ||
    right.recordId.localeCompare(left.recordId)
  );
}

function unavailableState(
  state: HistoryModeState,
  phase: 'historyUnavailable' | 'noteUnavailable',
  error: string
): HistoryModeState {
  if (
    state.phase !== 'open' &&
    state.phase !== 'historyUnavailable' &&
    state.phase !== 'noteUnavailable'
  ) {
    return state;
  }
  return { phase, target: state.target, workspace: state.workspace, error };
}

export function transitionHistoryMode(
  state: HistoryModeState,
  event: HistoryModeEvent
): HistoryModeState {
  switch (event.type) {
    case 'entryStarted':
      if (state.phase !== 'inactive') return state;
      return {
        phase: 'entering',
        requestId: event.requestId,
        origin: 'entry',
        target: event.target,
        workspace: event.workspace
      };
    case 'entryRejected':
      return state.phase === 'inactive'
        ? { phase: 'inactive', entryError: event.error }
        : state;
    case 'retryStarted':
      if (
        state.phase !== 'historyUnavailable' &&
        state.phase !== 'noteUnavailable'
      ) {
        return state;
      }
      return {
        phase: 'entering',
        requestId: event.requestId,
        origin: 'retry',
        target: event.target,
        workspace: state.workspace
      };
    case 'entryFailed':
      if (state.phase !== 'entering' || state.requestId !== event.requestId) {
        return state;
      }
      return { phase: 'inactive', entryError: event.error };
    case 'retryFailed':
      if (
        state.phase !== 'entering' ||
        state.origin !== 'retry' ||
        state.requestId !== event.requestId
      ) {
        return state;
      }
      return {
        phase: 'historyUnavailable',
        target: state.target,
        workspace: state.workspace,
        error: event.error
      };
    case 'entryLoaded': {
      if (state.phase !== 'entering' || state.requestId !== event.requestId) {
        return state;
      }
      return {
        phase: 'open',
        target: event.target,
        workspace: state.workspace,
        records: event.page.records,
        nextCursor: event.page.nextCursor,
        selectedRevisionId: event.selectedRevision?.revisionId ?? null,
        selectedRevision: event.selectedRevision,
        request: null,
        error: null
      };
    }
    case 'pageStarted':
    case 'refreshStarted':
      if (state.phase !== 'open' || state.request !== null) return state;
      return {
        ...state,
        request: {
          kind: event.type === 'pageStarted' ? 'page' : 'refresh',
          requestId: event.requestId
        },
        error: null
      };
    case 'selectionStarted':
      if (state.phase !== 'open' || state.request !== null) return state;
      return {
        ...state,
        selectedRevisionId: event.revisionId,
        request: { kind: 'selection', requestId: event.requestId },
        error: null
      };
    case 'pageLoaded':
      if (
        state.phase !== 'open' ||
        state.request?.kind !== 'page' ||
        state.request.requestId !== event.requestId
      ) {
        return state;
      }
      return {
        ...state,
        records: mergeRecords(state.records, event.page.records),
        nextCursor: event.page.nextCursor,
        request: null
      };
    case 'refreshLoaded':
      if (
        state.phase !== 'open' ||
        state.request?.kind !== 'refresh' ||
        state.request.requestId !== event.requestId
      ) {
        return state;
      }
      return {
        ...state,
        records: event.page.records,
        nextCursor: event.page.nextCursor,
        request: null
      };
    case 'selectionLoaded':
      if (
        state.phase !== 'open' ||
        state.request?.kind !== 'selection' ||
        state.request.requestId !== event.requestId ||
        state.selectedRevisionId !== event.revision.revisionId
      ) {
        return state;
      }
      return { ...state, selectedRevision: event.revision, request: null };
    case 'pageFailed':
    case 'selectionFailed':
      if (
        state.phase !== 'open' ||
        state.request?.requestId !== event.requestId
      ) {
        return state;
      }
      return { ...state, request: null, error: event.error };
    case 'historyUnavailable':
      return unavailableState(state, 'historyUnavailable', event.error);
    case 'noteUnavailable':
      return unavailableState(state, 'noteUnavailable', event.error);
    case 'lifecycleChanged':
      if (
        state.phase !== 'open' &&
        state.phase !== 'historyUnavailable' &&
        state.phase !== 'noteUnavailable'
      ) {
        return state;
      }
      return { ...state, target: event.target };
    case 'dismissEntryError':
      return state.phase === 'inactive'
        ? createInactiveHistoryModeState()
        : state;
    case 'exitStarted':
      if (
        state.phase === 'inactive' ||
        state.phase === 'exiting' ||
        state.phase === 'restoring'
      ) {
        return state;
      }
      return { phase: 'exiting', workspace: state.workspace };
    case 'workspaceRestored':
      return state.phase === 'exiting'
        ? { phase: 'restoring', workspace: state.workspace }
        : state;
    case 'exitRestoreFailed':
      return state.phase === 'exiting'
        ? { phase: 'inactive', entryError: event.error }
        : state;
    case 'exitCompleted':
      return state.phase === 'restoring'
        ? { phase: 'inactive', entryError: event.error ?? null }
        : state;
  }
}
