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
  focusTarget: 'editor'
};

function revision(revisionId: string, occurredAtMillis: number) {
  return {
    kind: 'revision' as const,
    recordId: revisionId,
    revisionId,
    source: 'editor' as const,
    occurredAtMillis,
    timeKind: 'committed' as const,
    modifiedAtMillis: null
  };
}

function page(
  records: HistoryModePage['records'],
  nextCursor: string | null = null
): HistoryModePage {
  return { records, nextCursor };
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

  it('opens on the newest revision and keeps it pinned across refreshes', () => {
    const entering = transitionHistoryMode(
      createInactiveHistoryModeState(),
      { type: 'entryStarted', requestId: 4, target, workspace }
    );
    const open = transitionHistoryMode(entering, {
      type: 'entryLoaded',
      requestId: 4,
      target,
      page: page([revision('revision-2', 20), revision('revision-1', 10)]),
      selectedRevision: {
        revisionId: 'revision-2',
        body: 'second',
        unmanagedFrontmatter: null
      }
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
      selectedRevision: { body: 'second' }
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
      selectedRevision: {
        revisionId: 'revision-3',
        body: 'third',
        unmanagedFrontmatter: null
      }
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
      selectedRevision: {
        revisionId: 'revision-1',
        body: 'first',
        unmanagedFrontmatter: null
      }
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
    expect(
      transitionHistoryMode(exiting, { type: 'exitCompleted' })
    ).toEqual(createInactiveHistoryModeState());
  });
});
