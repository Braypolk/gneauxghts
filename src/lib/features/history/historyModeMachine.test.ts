import { describe, expect, it } from 'vitest';
import {
  createInactiveHistoryModeState,
  transitionHistoryMode,
  type HistoryModePage,
  type HistoryModeTarget,
  type HistoryWorkspaceSnapshot
} from './historyModeMachine';

const target: HistoryModeTarget = {
  noteId: 'note-1',
  noteTitle: 'A note',
  notePath: '/vault/A note.md'
};

const workspace: HistoryWorkspaceSnapshot = {
  activePaneId: 'notepad-pane-1',
  focusTarget: 'editor',
  editor: null
};

function revision(revisionId: string, occurredAtMillis: number) {
  return {
    kind: 'revision' as const,
    recordId: revisionId,
    revisionId,
    source: 'editor' as const,
    occurredAtMillis,
    timelineOrdinal: occurredAtMillis,
    timeKind: 'committed' as const,
    modifiedAtMillis: null,
    revisionLabel: null,
    lineCount: 1,
    characterCount: 10
  };
}

function page(
  records: HistoryModePage['records'],
  nextCursor: string | null = null
): HistoryModePage {
  return { records, nextCursor };
}

function diff(revisionId: string, text: string) {
  return {
    revisionId,
    comparison: 'parent' as const,
    fromRevisionId: null,
    toRevisionId: revisionId,
    bodyLines: [
      {
        kind: 'added' as const,
        text,
        oldLineNumber: null,
        newLineNumber: 1
      }
    ],
    propertiesLines: [],
    missingAssets: []
  };
}

describe('historyModeMachine', () => {
  it('refuses entry when the autosave barrier fails', () => {
    const entering = transitionHistoryMode(
      createInactiveHistoryModeState(),
      { type: 'entryStarted', requestId: 1, target, workspace }
    );

    expect(
      transitionHistoryMode(entering, {
        type: 'entryFailed',
        requestId: 1,
        error: 'The latest note changes could not be saved.'
      })
    ).toEqual({
      phase: 'inactive',
      entryError: 'The latest note changes could not be saved.'
    });
  });

  it('opens on the newest finalized window and keeps its immutable diff pinned across newer arrivals', () => {
    const entering = transitionHistoryMode(
      createInactiveHistoryModeState(),
      { type: 'entryStarted', requestId: 4, target, workspace }
    );
    const open = transitionHistoryMode(entering, {
      type: 'entryLoaded',
      requestId: 4,
      target,
      page: page([{ ...revision('revision-2', 20), timeKind: 'editingWindow',
        timeEvidence: { kind: 'editingWindow', version: 1, firstWallMillis: 10, lastWallMillis: 20,
          minWallMillis: 10, maxWallMillis: 20, clockDiscontinuity: false } }, revision('revision-1', 10)]),
      selectedDiff: diff('revision-2', 'second'),
      diagnostics: null
    });

    const refreshing = transitionHistoryMode(open, {
      type: 'refreshStarted',
      requestId: 5
    });
    const refreshed = transitionHistoryMode(refreshing, {
      type: 'refreshLoaded',
      requestId: 5,
      page: page([
        revision('revision-3', 30),
        revision('revision-2', 20),
        revision('revision-1', 10)
      ])
    });

    expect(refreshed).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-2',
      selectedDiff: { bodyLines: [{ text: 'second' }] }
    });
  });

  it('keeps a selected older revision pinned when a refresh page omits it', () => {
    const entering = transitionHistoryMode(
      createInactiveHistoryModeState(),
      { type: 'entryStarted', requestId: 4, target, workspace }
    );
    const older = revision('revision-older', 1);
    const open = transitionHistoryMode(entering, {
      type: 'entryLoaded',
      requestId: 4,
      target,
      page: page([revision('revision-2', 20), older]),
      selectedDiff: diff('revision-older', 'older'),
      diagnostics: null
    });
    const refreshing = transitionHistoryMode(open, {
      type: 'refreshStarted',
      requestId: 5
    });

    const refreshed = transitionHistoryMode(refreshing, {
      type: 'refreshLoaded',
      requestId: 5,
      page: page([revision('revision-3', 30), revision('revision-2', 20)])
    });

    expect(refreshed).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-older',
      records: [
        { revisionId: 'revision-3' },
        { revisionId: 'revision-2' },
        { revisionId: 'revision-older' }
      ]
    });
  });

  it('appends older pages without duplicating records', () => {
    const entering = transitionHistoryMode(
      createInactiveHistoryModeState(),
      { type: 'entryStarted', requestId: 1, target, workspace }
    );
    const open = transitionHistoryMode(entering, {
      type: 'entryLoaded',
      requestId: 1,
      target,
      page: page([revision('revision-3', 30), revision('revision-2', 20)], 'revision-2'),
      selectedDiff: diff('revision-3', 'third'),
      diagnostics: null
    });
    const loading = transitionHistoryMode(open, {
      type: 'pageStarted',
      requestId: 2
    });
    const loaded = transitionHistoryMode(loading, {
      type: 'pageLoaded',
      requestId: 2,
      page: page([revision('revision-2', 20), revision('revision-1', 10)])
    });

    expect(loaded.phase).toBe('open');
    if (loaded.phase !== 'open') return;
    expect(loaded.records.map((record) => record.recordId)).toEqual([
      'revision-3',
      'revision-2',
      'revision-1'
    ]);
  });

  it('uses explicit transitions when a note or its history becomes unavailable', () => {
    const entering = transitionHistoryMode(
      createInactiveHistoryModeState(),
      { type: 'entryStarted', requestId: 1, target, workspace }
    );
    const open = transitionHistoryMode(entering, {
      type: 'entryLoaded',
      requestId: 1,
      target,
      page: page([revision('revision-1', 10)]),
      selectedDiff: diff('revision-1', 'first'),
      diagnostics: null
    });

    const unavailable = transitionHistoryMode(open, {
      type: 'historyUnavailable',
      error: 'History is temporarily unavailable.'
    });
    expect(unavailable).toMatchObject({
      phase: 'historyUnavailable',
      workspace,
      target
    });

    expect(
      transitionHistoryMode(open, {
        type: 'noteUnavailable',
        error: 'This note is no longer available.'
      })
    ).toMatchObject({ phase: 'noteUnavailable', workspace, target });
  });

  it('ignores stale async results and exits through the captured workspace', () => {
    const entering = transitionHistoryMode(
      createInactiveHistoryModeState(),
      { type: 'entryStarted', requestId: 8, target, workspace }
    );
    expect(
      transitionHistoryMode(entering, {
        type: 'entryFailed',
        requestId: 7,
        error: 'stale'
      })
    ).toBe(entering);

    const exiting = transitionHistoryMode(entering, { type: 'exitStarted' });
    expect(exiting).toEqual({ phase: 'exiting', workspace });
    const restoring = transitionHistoryMode(exiting, { type: 'workspaceRestored' });
    expect(restoring).toEqual({ phase: 'restoring', workspace });
    expect(
      transitionHistoryMode(restoring, { type: 'exitCompleted' })
    ).toEqual(createInactiveHistoryModeState());
  });

  it('retries unavailable history without replacing the captured workspace', () => {
    const unavailable = {
      phase: 'historyUnavailable' as const,
      target,
      workspace,
      error: 'temporarily unavailable'
    };

    expect(
      transitionHistoryMode(unavailable, {
        type: 'retryStarted',
        requestId: 9,
        target: { ...target, noteTitle: 'Renamed note' }
      })
    ).toEqual({
      phase: 'entering',
      requestId: 9,
      origin: 'retry',
      target: { ...target, noteTitle: 'Renamed note' },
      workspace
    });
  });
});
