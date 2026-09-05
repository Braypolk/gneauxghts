import type { HistoryStorageUsage, NoteHistoryHealth } from '$lib/types/history';
import type { NoteSession } from '$lib/features/notepad/model/types';
import type { EditorViewState } from '$lib/features/notepad/editor/editorViewState';

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
  timelineOrdinal: number;
  timeKind: 'knownSince' | 'committed' | 'observed';
  modifiedAtMillis: number | null;
  editingSessionId: string | null;
  revisionLabel: string | null;
  lineCount: number;
  characterCount: number;
}

export interface HistoryLifecycleRecord {
  kind: 'lifecycleEvent';
  recordId: string;
  eventId: string;
  eventKind: HistoryLifecycleEventKind;
  occurredAtMillis: number;
  timelineOrdinal: number;
  previousPath: string | null;
  path: string | null;
}

export type HistoryModeRecord = HistoryRevisionRecord | HistoryLifecycleRecord;

export interface HistoryModePage {
  records: HistoryModeRecord[];
  nextCursor: string | null;
}

export interface HistoryModeDiagnostics {
  note: NoteHistoryHealth;
  storage: HistoryStorageUsage | null;
}

export interface HistoricalRevision {
  revisionId: string;
  unmanagedFrontmatter: string | null;
  body: string;
}

export interface HistoryRestorePreview extends HistoricalRevision {
  currentAuthoredContentHash: string;
}

export interface HistoryRestoreCommit {
  revisionId: string;
  session: NoteSession;
}

export type HistoryDiffComparison = 'parent' | 'current';

export interface HistoryDiffLine {
  kind: 'context' | 'added' | 'removed';
  text: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface HistoricalDiff {
  revisionId: string;
  comparison: HistoryDiffComparison;
  fromRevisionId: string | null;
  toRevisionId: string;
  bodyLines: HistoryDiffLine[];
  propertiesLines: HistoryDiffLine[];
  missingAssets: string[];
}

export interface HistoryModeTarget {
  citationRevisionId?: string;
  noteId: string;
  noteTitle: string;
  notePath: string | null;
}

export interface HistoryWorkspaceSnapshot {
  activePaneId: string;
  focusTarget: 'editor' | 'title' | 'chat';
  focusElement?: HTMLElement | null;
  editor: {
    noteId: string;
    viewState: EditorViewState;
  } | null;
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
      selectedComparison: HistoryDiffComparison;
      selectedDiff: HistoricalDiff | null;
      restorePreview?: HistoryRestorePreview | null;
      diagnostics: HistoryModeDiagnostics | null;
      request: {
        kind: 'page' | 'refresh' | 'diagnostics' | 'diff' | 'restorePreview' | 'restoreCommit';
        requestId: number;
      } | null;
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
      selectedDiff: HistoricalDiff | null;
      diagnostics: HistoryModeDiagnostics | null;
    }
  | { type: 'diagnosticsStarted'; requestId: number }
  | { type: 'diagnosticsLoaded'; requestId: number; diagnostics: HistoryModeDiagnostics }
  | { type: 'diagnosticsFailed'; requestId: number; error: string }
  | { type: 'pageStarted'; requestId: number }
  | { type: 'pageLoaded'; requestId: number; page: HistoryModePage }
  | { type: 'pageFailed'; requestId: number; error: string }
  | { type: 'refreshStarted'; requestId: number }
  | {
      type: 'refreshLoaded';
      requestId: number;
      page: HistoryModePage;
      selectedDiff?: HistoricalDiff;
    }
  | {
      type: 'historyReplaced';
      requestId: number;
      page: HistoryModePage;
      selectedDiff: HistoricalDiff;
      diagnostics: HistoryModeDiagnostics | null;
    }
  | {
      type: 'revisionNameChanged';
      requestId: number;
      revisionId: string;
      label: string | null;
    }
  | {
      type: 'diffStarted';
      requestId: number;
      revisionId: string;
      comparison: HistoryDiffComparison;
    }
  | {
      type: 'diffLoaded';
      requestId: number;
      diff: HistoricalDiff;
    }
  | { type: 'diffFailed'; requestId: number; error: string }
  | { type: 'restorePreviewStarted'; requestId: number }
  | { type: 'restorePreviewLoaded'; requestId: number; preview: HistoryRestorePreview }
  | { type: 'restoreCancelled' }
  | { type: 'restoreCommitStarted'; requestId: number }
  | {
      type: 'restoreCommitted';
      requestId: number;
      page: HistoryModePage;
      selectedDiff: HistoricalDiff;
      diagnostics: HistoryModeDiagnostics | null;
    }
  | { type: 'restoreFailed'; requestId: number; error: string }
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

export function canExitHistoryMode(state: HistoryModeState): boolean {
  return state.phase !== 'inactive' && state.phase !== 'exiting' &&
    state.phase !== 'restoring' &&
    !(state.phase === 'open' && state.request?.kind === 'restoreCommit');
}

function mergeRecords(
  current: HistoryModeRecord[],
  incoming: HistoryModeRecord[]
): HistoryModeRecord[] {
  const byId = new Map(current.map((record) => [record.recordId, record]));
  for (const record of incoming) {
    byId.set(record.recordId, record);
  }
  return [...byId.values()].sort(compareHistoryRecordsNewestFirst);
}

export function compareHistoryRecordsNewestFirst(
  left: HistoryModeRecord,
  right: HistoryModeRecord
): number {
  return (
    right.timelineOrdinal - left.timelineOrdinal
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
        selectedRevisionId: event.selectedDiff?.revisionId ?? null,
        selectedComparison: 'parent',
        selectedDiff: event.selectedDiff,
        restorePreview: null,
        diagnostics: event.diagnostics,
        request: null,
        error: null
      };
    }
    case 'diagnosticsLoaded':
      if (state.phase !== 'open' || state.request?.kind !== 'diagnostics' || state.request.requestId !== event.requestId) return state;
      return { ...state, diagnostics: event.diagnostics, request: null };
    case 'diagnosticsStarted':
    case 'pageStarted':
    case 'refreshStarted':
      if (state.phase !== 'open' || state.request !== null) return state;
      return {
        ...state,
        request: {
          kind: event.type === 'pageStarted' ? 'page' : event.type === 'diagnosticsStarted' ? 'diagnostics' : 'refresh',
          requestId: event.requestId
        },
        error: null
      };
    case 'diffStarted':
      if (state.phase !== 'open' || state.request !== null) return state;
      return {
        ...state,
        selectedRevisionId: event.revisionId,
        selectedComparison: event.comparison,
        selectedDiff: null,
        restorePreview: null,
        request: { kind: 'diff', requestId: event.requestId },
        error: null
      };
    case 'restorePreviewStarted':
      if (
        state.phase !== 'open' ||
        state.request !== null ||
        state.selectedRevisionId === null
      ) {
        return state;
      }
      return {
        ...state,
        restorePreview: null,
        request: { kind: 'restorePreview', requestId: event.requestId },
        error: null
      };
    case 'restorePreviewLoaded':
      if (
        state.phase !== 'open' ||
        state.request?.kind !== 'restorePreview' ||
        state.request.requestId !== event.requestId ||
        state.selectedRevisionId !== event.preview.revisionId
      ) {
        return state;
      }
      return { ...state, restorePreview: event.preview, request: null };
    case 'restoreCancelled':
      return state.phase === 'open' && state.request === null
        ? { ...state, restorePreview: null }
        : state;
    case 'restoreCommitStarted':
      if (
        state.phase !== 'open' ||
        state.request !== null ||
        !state.restorePreview
      ) {
        return state;
      }
      return {
        ...state,
        request: { kind: 'restoreCommit', requestId: event.requestId },
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
      const selectedRecord = state.records.find(
        (record) =>
          record.kind === 'revision' && record.revisionId === state.selectedRevisionId
      );
      const records =
        selectedRecord &&
        !event.page.records.some((record) => record.recordId === selectedRecord.recordId)
          ? mergeRecords(event.page.records, [selectedRecord])
          : event.page.records;
      return {
        ...state,
        records,
        nextCursor: event.page.nextCursor,
        selectedDiff: event.selectedDiff ?? state.selectedDiff,
        restorePreview: null,
        request: null
      };
    case 'historyReplaced':
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
        selectedRevisionId: event.selectedDiff.revisionId,
        selectedComparison: 'parent',
        selectedDiff: event.selectedDiff,
        restorePreview: null,
        diagnostics: event.diagnostics,
        request: null,
        error: null
      };
    case 'restoreCommitted':
      if (
        state.phase !== 'open' ||
        state.request?.kind !== 'restoreCommit' ||
        state.request.requestId !== event.requestId
      ) {
        return state;
      }
      return {
        ...state,
        records: event.page.records,
        nextCursor: event.page.nextCursor,
        selectedRevisionId: event.selectedDiff.revisionId,
        selectedComparison: 'parent',
        selectedDiff: event.selectedDiff,
        restorePreview: null,
        diagnostics: event.diagnostics,
        request: null,
        error: null
      };
    case 'revisionNameChanged':
      if (
        state.phase !== 'open' ||
        state.request?.kind !== 'refresh' ||
        state.request.requestId !== event.requestId
      ) {
        return state;
      }
      return {
        ...state,
        records: state.records.map((record) =>
          record.kind === 'revision' && record.revisionId === event.revisionId
            ? { ...record, revisionLabel: event.label }
            : record
        ),
        request: null,
        error: null
      };
    case 'diffLoaded':
      if (
        state.phase !== 'open' ||
        state.request?.kind !== 'diff' ||
        state.request.requestId !== event.requestId ||
        state.selectedRevisionId !== event.diff.revisionId ||
        state.selectedComparison !== event.diff.comparison
      ) {
        return state;
      }
      return { ...state, selectedDiff: event.diff, request: null };
    case 'diagnosticsFailed':
    case 'pageFailed':
    case 'diffFailed':
    case 'restoreFailed':
      if (
        state.phase !== 'open' ||
        state.request?.requestId !== event.requestId
      ) {
        return state;
      }
      return {
        ...state,
        restorePreview: event.type === 'restoreFailed' ? null : state.restorePreview,
        request: null,
        error: event.error
      };
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
      if (!canExitHistoryMode(state) || !('workspace' in state)) return state;
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
