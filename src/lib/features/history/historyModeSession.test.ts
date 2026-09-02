import { describe, expect, it, vi } from 'vitest';
import { HistoryModeSession } from './historyModeSession.svelte';
import type {
  HistoricalDiff,
  HistoryModePage,
  HistoryRevisionRecord,
  HistoryModeTarget,
  HistoryWorkspaceSnapshot
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
const firstPage: HistoryModePage = {
  records: [
    {
      kind: 'revision',
      recordId: 'revision-1',
      revisionId: 'revision-1',
      source: 'editor',
      occurredAtMillis: 10,
      timelineOrdinal: 1,
      timeKind: 'committed',
      modifiedAtMillis: null,
      editingSessionId: 'revision-1',
      lineCount: 1,
      characterCount: 10
    }
  ],
  nextCursor: null
};
const revisionDiff: HistoricalDiff = {
  revisionId: 'revision-1',
  comparison: 'parent',
  fromRevisionId: null,
  toRevisionId: 'revision-1',
  bodyLines: [
    {
      kind: 'added',
      text: 'saved body',
      oldLineNumber: null,
      newLineNumber: 1
    }
  ],
  propertiesLines: [],
  missingAssets: []
};

function setup(overrides: Partial<ConstructorParameters<typeof HistoryModeSession>[0]> = {}) {
  const deps: ConstructorParameters<typeof HistoryModeSession>[0] = {
    flushWorkspace: vi.fn().mockResolvedValue(undefined),
    captureWorkspace: vi.fn(() => workspace),
    readTarget: vi.fn(() => target),
    restoreWorkspace: vi.fn(),
    restoreFocus: vi.fn(),
    loadPage: vi.fn().mockResolvedValue(firstPage),
    loadDiff: vi.fn().mockResolvedValue(revisionDiff),
    ...overrides
  };
  return { session: new HistoryModeSession(deps), deps };
}

describe('HistoryModeSession', () => {
  it('crosses the save barrier before requesting role-limited history', async () => {
    const callOrder: string[] = [];
    const { session } = setup({
      flushWorkspace: vi.fn(async () => {
        callOrder.push('flush');
      }),
      loadPage: vi.fn(async () => {
        callOrder.push('history');
        return firstPage;
      })
    });

    await session.enter('notepad-pane-1');

    expect(callOrder).toEqual(['flush', 'history']);
    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-1',
      selectedComparison: 'parent',
      selectedDiff: revisionDiff
    });
  });

  it('leaves the workspace active and reports a clear error when saving fails', async () => {
    const restoreWorkspace = vi.fn();
    const loadPage = vi.fn();
    const { session } = setup({
      flushWorkspace: vi.fn().mockRejectedValue(new Error('disk full')),
      restoreWorkspace,
      loadPage
    });

    await session.enter('notepad-pane-1');

    expect(session.state).toEqual({
      phase: 'inactive',
      entryError: 'History Mode could not open because the latest changes were not saved: disk full'
    });
    expect(loadPage).not.toHaveBeenCalled();
    expect(restoreWorkspace).toHaveBeenCalledWith(workspace);
  });

  it('restores the captured workspace and focus on exit', async () => {
    const phases: string[] = [];
    let session!: HistoryModeSession;
    const restoreWorkspace = vi.fn(() => {
      phases.push(session.state.phase);
    });
    const restoreFocus = vi.fn(() => {
      phases.push(session.state.phase);
    });
    ({ session } = setup({ restoreWorkspace, restoreFocus }));
    await session.enter('notepad-pane-1');

    await session.exit();

    expect(restoreWorkspace).toHaveBeenCalledWith(workspace);
    expect(restoreFocus).toHaveBeenCalledWith(workspace);
    expect(phases).toEqual(['exiting', 'restoring']);
    expect(session.state).toEqual({ phase: 'inactive', entryError: null });
  });

  it('retries unavailable history without recapturing or replacing the original focus', async () => {
    const captureWorkspace = vi.fn(() => workspace);
    const flushWorkspace = vi.fn().mockResolvedValue(undefined);
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(firstPage);
    const { session } = setup({ captureWorkspace, flushWorkspace, loadPage });
    await session.enter('notepad-pane-1');
    await session.refresh();
    expect(session.state.phase).toBe('historyUnavailable');
    await session.retry();

    expect(captureWorkspace).toHaveBeenCalledTimes(1);
    expect(flushWorkspace).toHaveBeenCalledTimes(1);
    expect(session.state).toMatchObject({ phase: 'open', workspace });
  });

  it('transitions the target explicitly after normal external synchronization', async () => {
    const renamedTarget = {
      ...target,
      noteTitle: 'Renamed note',
      notePath: '/vault/Renamed note.md'
    };
    const readTarget = vi
      .fn()
      .mockReturnValueOnce(target)
      .mockReturnValueOnce(target)
      .mockReturnValueOnce(renamedTarget);
    const loadPage = vi.fn().mockResolvedValue(firstPage);
    const { session } = setup({ readTarget, loadPage });
    await session.enter('notepad-pane-1');

    await session.synchronizeAfterLifecycleChange();

    expect(session.state).toMatchObject({
      phase: 'open',
      target: renamedTarget
    });
    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  it('refreshes record headers while keeping the selected revision body pinned', async () => {
    const newestPage: HistoryModePage = {
      records: [
        {
          kind: 'revision',
          recordId: 'revision-2',
          revisionId: 'revision-2',
          source: 'externalEdit',
          occurredAtMillis: 20,
          timelineOrdinal: 2,
          timeKind: 'observed',
          modifiedAtMillis: null,
          editingSessionId: 'revision-2',
          lineCount: 2,
          characterCount: 20
        },
        ...firstPage.records
      ],
      nextCursor: null
    };
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(newestPage);
    const { session } = setup({ loadPage });
    await session.enter('notepad-pane-1');

    await session.refresh();

    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-1',
      selectedDiff: revisionDiff
    });
  });

  it('runs a refresh requested while a revision selection is still loading', async () => {
    let resolveSelection!: (revision: HistoricalDiff) => void;
    const selection = new Promise<HistoricalDiff>((resolve) => {
      resolveSelection = resolve;
    });
    const secondRevision: HistoricalDiff = {
      revisionId: 'revision-2',
      comparison: 'parent',
      fromRevisionId: null,
      toRevisionId: 'revision-2',
      bodyLines: [],
      propertiesLines: [],
      missingAssets: []
    };
    const selectablePage: HistoryModePage = {
      records: [
        ...firstPage.records,
        {
          kind: 'revision',
          recordId: 'revision-2',
          revisionId: 'revision-2',
          source: 'editor',
          occurredAtMillis: 5,
          timelineOrdinal: 0,
          timeKind: 'committed',
          modifiedAtMillis: null,
          editingSessionId: 'revision-2',
          lineCount: 1,
          characterCount: 10
        }
      ],
      nextCursor: null
    };
    const loadPage = vi.fn().mockResolvedValue(selectablePage);
    const loadDiff = vi
      .fn()
      .mockResolvedValueOnce(revisionDiff)
      .mockReturnValueOnce(selection);
    const { session } = setup({ loadPage, loadDiff });
    await session.enter('notepad-pane-1');

    const selecting = session.selectRevision('revision-2');
    await session.refresh();
    expect(loadPage).toHaveBeenCalledTimes(1);

    resolveSelection(secondRevision);
    await selecting;

    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-2',
      selectedDiff: secondRevision
    });
  });

  it('switches between parent and current comparisons without changing the pinned revision', async () => {
    const currentDiff: HistoricalDiff = {
      ...revisionDiff,
      comparison: 'current',
      fromRevisionId: 'revision-1',
      toRevisionId: 'revision-3'
    };
    const loadDiff = vi
      .fn()
      .mockResolvedValueOnce(revisionDiff)
      .mockResolvedValueOnce(currentDiff);
    const { session } = setup({ loadDiff });
    await session.enter('notepad-pane-1');

    await session.setComparison('current');

    expect(loadDiff).toHaveBeenLastCalledWith('note-1', 'revision-1', 'current');
    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-1',
      selectedComparison: 'current',
      selectedDiff: currentDiff
    });
  });

  it('does not substitute an adjacent revision when the selected diff fails integrity checks', async () => {
    const loadDiff = vi
      .fn()
      .mockResolvedValueOnce(revisionDiff)
      .mockRejectedValueOnce(new Error('selected revision hash mismatch'));
    const { session } = setup({ loadDiff });
    await session.enter('notepad-pane-1');

    await session.setComparison('current');

    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-1',
      selectedComparison: 'current',
      selectedDiff: null,
      error: 'That revision diff could not be opened: selected revision hash mismatch'
    });
  });

  it('keeps the selected revision pinned while refreshing its current comparison', async () => {
    const currentDiff: HistoricalDiff = {
      ...revisionDiff,
      comparison: 'current',
      fromRevisionId: 'revision-1',
      toRevisionId: 'revision-2'
    };
    const refreshedCurrentDiff: HistoricalDiff = {
      ...currentDiff,
      toRevisionId: 'revision-3'
    };
    const newestPage: HistoryModePage = {
      records: [
        {
          ...(firstPage.records[0] as HistoryRevisionRecord),
          recordId: 'revision-3',
          revisionId: 'revision-3',
          timelineOrdinal: 3
        },
        ...firstPage.records
      ],
      nextCursor: null
    };
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(newestPage);
    const loadDiff = vi
      .fn()
      .mockResolvedValueOnce(revisionDiff)
      .mockResolvedValueOnce(currentDiff)
      .mockResolvedValueOnce(refreshedCurrentDiff);
    const { session } = setup({ loadPage, loadDiff });
    await session.enter('notepad-pane-1');
    await session.setComparison('current');

    await session.refresh();

    expect(session.state).toMatchObject({
      phase: 'open',
      selectedRevisionId: 'revision-1',
      selectedComparison: 'current',
      selectedDiff: refreshedCurrentDiff
    });
  });
});
